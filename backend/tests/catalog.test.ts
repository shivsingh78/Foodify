import mongoose from "mongoose";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import Item from "../src/models/item.model.js";
import Order from "../src/models/order.model.js";
import { address, setupShop } from "./fixtures.js";
import { app, createUserWithRole, useTestDb } from "./helpers.js";

vi.mock("../src/utils/mail.js", () => ({
  sendOtpMail: vi.fn(async () => undefined),
  sendDeliveryOtpMail: vi.fn(async () => undefined),
}));

useTestDb();

const deleteItem = (cookie: string, id: string) =>
  request(app).delete(`/api/item/delete/${id}`).set("Cookie", cookie);

describe("shop and item ownership", () => {
  it("customers cannot create shops or items", async () => {
    const customer = await createUserWithRole("user");
    const shop = await request(app)
      .post("/api/shop/create-edit")
      .set("Cookie", customer.cookie)
      .field("name", "x")
      .field("city", "Pune")
      .field("state", "MH")
      .field("address", "a");
    expect(shop.status).toBe(403);
    const item = await request(app).post("/api/item/add-item").set("Cookie", customer.cookie).send({});
    expect(item.status).toBe(403);
  });

  it("an owner cannot edit or delete another owner's item", async () => {
    const { items } = await setupShop();
    const attacker = await createUserWithRole("owner");
    await setupShop(); // attacker needs a shop of their own for the ownership check to be the blocker
    const intruder = (await setupShop()).owner;

    const edit = await request(app)
      .post(`/api/item/edit-item/${items[0]?._id}`)
      .set("Cookie", intruder.cookie)
      .field("name", "Hacked")
      .field("category", "Pizza")
      .field("foodType", "veg")
      .field("price", "1");
    expect(edit.status).toBe(403);
    expect((await Item.findById(items[0]?._id))?.name).toBe("Margherita");

    expect((await deleteItem(intruder.cookie, String(items[0]?._id))).status).toBe(403);
    expect(await Item.findById(items[0]?._id)).not.toBeNull();
    expect((await deleteItem(attacker.cookie, String(items[0]?._id))).status).toBe(400); // no shop at all
  });

  it("an owner can edit and delete their own item, and the shop reference is removed", async () => {
    const { owner, items, shop } = await setupShop();
    const edit = await request(app)
      .post(`/api/item/edit-item/${items[0]?._id}`)
      .set("Cookie", owner.cookie)
      .field("name", "Renamed")
      .field("category", "Pizza")
      .field("foodType", "veg")
      .field("price", "250")
      .field("isAvailable", "false");
    expect(edit.status).toBe(200);
    const updated = await Item.findById(items[0]?._id);
    expect(updated?.price).toBe(250);
    expect(updated?.isAvailable).toBe(false);

    const del = await deleteItem(owner.cookie, String(items[0]?._id));
    expect(del.status).toBe(200);
    const refreshed = await mongoose.model("Shop").findById(shop._id).lean<{ items: unknown[] }>();
    expect(refreshed?.items).toHaveLength(1);
  });

  it("rejects the old state-changing GET delete route", async () => {
    const { owner, items } = await setupShop();
    const res = await request(app).get(`/api/item/delete/${items[0]?._id}`).set("Cookie", owner.cookie);
    expect(res.status).toBe(404);
    expect(await Item.findById(items[0]?._id)).not.toBeNull();
  });

  it("rejects state-changing requests from a foreign origin", async () => {
    const { owner, items } = await setupShop();
    const res = await request(app)
      .delete(`/api/item/delete/${items[0]?._id}`)
      .set("Cookie", owner.cookie)
      .set("Origin", "https://evil.example");
    expect(res.status).toBe(403);
    expect(await Item.findById(items[0]?._id)).not.toBeNull();
  });
});

describe("search, filters and pagination", () => {
  const seed = () =>
    setupShop(
      "Pune",
      Array.from({ length: 25 }, (_, i) => ({
        name: i % 2 ? `Pizza ${i}` : `Burger ${i}`,
        price: 10 * (i + 1),
        category: i % 2 ? "Pizza" : "Burgers",
        foodType: i % 3 ? "veg" : "non veg",
        isAvailable: i !== 4,
      })),
    );
  const search = (cookie: string, qs: string) =>
    request(app).get(`/api/item/search-item?${qs}`).set("Cookie", cookie);

  it("paginates with consistent metadata", async () => {
    await seed();
    const { cookie } = await createUserWithRole("user");
    const page1 = await search(cookie, "city=pune&limit=10&sort=price_asc");
    expect(page1.status).toBe(200);
    expect(page1.body.items).toHaveLength(10);
    expect(page1.body.pagination).toEqual({ page: 1, limit: 10, total: 25, totalPages: 3, hasNextPage: true });
    expect(page1.body.items[0].price).toBe(10);

    const page3 = await search(cookie, "city=pune&limit=10&page=3&sort=price_asc");
    expect(page3.body.items).toHaveLength(5);
    expect(page3.body.pagination.hasNextPage).toBe(false);
  });

  it("filters by text, category, price range, availability and sorts", async () => {
    await seed();
    const { cookie } = await createUserWithRole("user");
    const byText = await search(cookie, "city=Pune&query=pizza&limit=50");
    expect(byText.body.items.every((i: { category: string }) => i.category === "Pizza")).toBe(true);
    expect(byText.body.pagination.total).toBe(12);

    const range = await search(cookie, "city=Pune&minPrice=50&maxPrice=100&sort=price_desc&limit=50");
    expect(range.body.items.map((i: { price: number }) => i.price)).toEqual([100, 90, 80, 70, 60, 50]);

    const unavailable = await search(cookie, "city=Pune&available=false");
    expect(unavailable.body.pagination.total).toBe(1);
    const available = await search(cookie, "city=Pune&available=true&limit=50");
    expect(available.body.pagination.total).toBe(24);
  });

  it("treats regex characters in the query literally", async () => {
    await seed();
    const { cookie } = await createUserWithRole("user");
    const res = await search(cookie, "city=Pune&query=.*");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
  });

  it("validates query parameters and scopes by city", async () => {
    await seed();
    const { cookie } = await createUserWithRole("user");
    expect((await search(cookie, "limit=1000&city=Pune")).status).toBe(400);
    expect((await search(cookie, "query=x")).status).toBe(400);
    expect((await search(cookie, "city=Mumbai")).body.items).toHaveLength(0);
  });
});

describe("ratings", () => {
  const deliveredOrderFor = async (userId: string, itemId: unknown) =>
    Order.create({
      user: userId,
      paymentMethod: "cod",
      deliveryAddress: address,
      totalAmount: 100,
      shopOrders: [
        {
          shop: new mongoose.Types.ObjectId(),
          owner: new mongoose.Types.ObjectId(),
          subtotal: 100,
          status: "delivered",
          shopOrderItems: [{ item: itemId, name: "x", price: 100, quantity: 1 }],
        },
      ],
    });

  it("requires a delivered order and keeps one rating per customer", async () => {
    const { items } = await setupShop();
    const a = await createUserWithRole("user");
    const b = await createUserWithRole("user");
    const rate = (cookie: string, rating: number) =>
      request(app).post("/api/item/rating").set("Cookie", cookie).send({ itemId: String(items[0]?._id), rating });

    expect((await rate(a.cookie, 5)).status).toBe(403);

    await deliveredOrderFor(a.user._id, items[0]?._id);
    await deliveredOrderFor(b.user._id, items[0]?._id);
    expect((await rate(a.cookie, 5)).body.rating).toEqual({ average: 5, count: 1 });
    // Re-rating replaces rather than duplicates.
    expect((await rate(a.cookie, 3)).body.rating).toEqual({ average: 3, count: 1 });
    expect((await rate(b.cookie, 5)).body.rating).toEqual({ average: 4, count: 2 });
    expect((await rate(a.cookie, 6)).status).toBe(400);
  });
});
