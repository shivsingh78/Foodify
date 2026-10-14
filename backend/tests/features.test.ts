import mongoose from "mongoose";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Notification from "../src/models/notification.model.js";
import Order from "../src/models/order.model.js";
import { getOwnerAnalytics } from "../src/services/analytics.service.js";
import { cacheStats, invalidateCache, withCache } from "../src/services/cache.service.js";
import { recommendItems } from "../src/services/recommendation.service.js";
import { rateLimit, resetRateLimits } from "../src/middlewares/rateLimit.js";
import { address, setupShop } from "./fixtures.js";
import { app, createUserWithRole, useTestDb } from "./helpers.js";
import express from "express";
import { errorHandler } from "../src/middlewares/error.js";

vi.mock("../src/utils/mail.js", () => ({
  sendOtpMail: vi.fn(async () => undefined),
  sendDeliveryOtpMail: vi.fn(async () => undefined),
}));

useTestDb();

describe("notifications", () => {
  it("lists only the caller's notifications and supports read state", async () => {
    const a = await createUserWithRole("user");
    const b = await createUserWithRole("user");
    const [n1] = await Notification.create([
      { user: a.user._id, type: "order_status", title: "t1", message: "m1" },
      { user: a.user._id, type: "order_status", title: "t2", message: "m2" },
      { user: b.user._id, type: "order_status", title: "other", message: "private" },
    ]);

    const list = await request(app).get("/api/notifications").set("Cookie", a.cookie);
    expect(list.body.notifications).toHaveLength(2);
    expect(list.body.unreadCount).toBe(2);
    expect(JSON.stringify(list.body)).not.toContain("private");

    // Another user's notification looks like it does not exist.
    const foreign = await request(app).post(`/api/notifications/${n1?._id}/read`).set("Cookie", b.cookie);
    expect(foreign.status).toBe(404);
    expect((await Notification.findById(n1?._id))?.read).toBe(false);

    expect((await request(app).post(`/api/notifications/${n1?._id}/read`).set("Cookie", a.cookie)).status).toBe(200);
    const unread = await request(app).get("/api/notifications?unreadOnly=true").set("Cookie", a.cookie);
    expect(unread.body.notifications).toHaveLength(1);

    const all = await request(app).post("/api/notifications/read-all").set("Cookie", a.cookie);
    expect(all.body.updated).toBe(1);
    expect((await request(app).get("/api/notifications").set("Cookie", b.cookie)).body.unreadCount).toBe(1);
  });

  it("requires authentication", async () => {
    expect((await request(app).get("/api/notifications")).status).toBe(401);
  });

  it("creates notifications when orders are placed and progress", async () => {
    const { owner, shop, items } = await setupShop();
    const customer = await createUserWithRole("user");
    const placed = await request(app)
      .post("/api/order/place-order")
      .set("Cookie", customer.cookie)
      .send({ paymentMethod: "cod", deliveryAddress: address, cartItems: [{ id: String(items[0]?._id), quantity: 1 }] });
    expect(await Notification.countDocuments({ user: owner.user._id, type: "order_placed" })).toBe(1);

    await request(app)
      .post(`/api/order/update-status/${placed.body._id}/${shop._id}`)
      .set("Cookie", owner.cookie)
      .send({ status: "preparing" });
    expect(await Notification.countDocuments({ user: customer.user._id, type: "order_status" })).toBe(1);
  });
});

describe("owner analytics", () => {
  const mkOrder = (
    owner: string,
    item: { _id: unknown; name: string },
    status: string,
    price: number,
    qty: number,
    extra: Record<string, unknown> = {},
  ) =>
    Order.create({
      user: new mongoose.Types.ObjectId(),
      paymentMethod: "cod",
      deliveryAddress: address,
      totalAmount: price * qty,
      shopOrders: [
        {
          shop: new mongoose.Types.ObjectId(),
          owner,
          subtotal: price * qty,
          status,
          deliveredAt: status === "delivered" ? new Date() : null,
          shopOrderItems: [{ item: item._id, name: item.name, price, quantity: qty }],
        },
      ],
      ...extra,
    });

  it("aggregates revenue, statuses and top products for the owner only", async () => {
    const { owner } = await setupShop();
    const other = await createUserWithRole("owner");
    const pizza = { _id: new mongoose.Types.ObjectId(), name: "Pizza" };
    const burger = { _id: new mongoose.Types.ObjectId(), name: "Burger" };

    await mkOrder(owner.user._id, pizza, "delivered", 200, 2); // 400
    await mkOrder(owner.user._id, pizza, "delivered", 200, 1); // 200
    await mkOrder(owner.user._id, burger, "delivered", 100, 1); // 100
    await mkOrder(owner.user._id, burger, "cancelled", 100, 5);
    await mkOrder(owner.user._id, burger, "pending", 100, 1);
    await mkOrder(owner.user._id, pizza, "delivered", 999, 1, { paymentMethod: "online", payment: false }); // unpaid: ignored
    await mkOrder(other.user._id, pizza, "delivered", 5000, 1); // someone else's

    const a = await getOwnerAnalytics(owner.user._id, 30);
    expect(a.totalOrders).toBe(5);
    expect(a.completedOrders).toBe(3);
    expect(a.cancelledOrders).toBe(1);
    expect(a.cancellationRate).toBe(20);
    expect(a.totalRevenue).toBe(700);
    expect(a.averageOrderValue).toBe(233.33);
    expect(a.ordersByStatus).toEqual([
      { status: "cancelled", count: 1 },
      { status: "delivered", count: 3 },
      { status: "pending", count: 1 },
    ]);
    expect(a.revenueByDay).toHaveLength(1);
    expect(a.revenueByDay[0]).toMatchObject({ revenue: 700, orders: 3 });
    expect(a.topProducts[0]).toMatchObject({ name: "Pizza", quantity: 3, revenue: 600 });
  });

  it("is exposed only to owners", async () => {
    const customer = await createUserWithRole("user");
    expect((await request(app).get("/api/analytics/owner").set("Cookie", customer.cookie)).status).toBe(403);
    const owner = await createUserWithRole("owner");
    const res = await request(app).get("/api/analytics/owner?days=7").set("Cookie", owner.cookie);
    expect(res.status).toBe(200);
    expect(res.body.totalOrders).toBe(0);
    expect((await request(app).get("/api/analytics/owner?days=0").set("Cookie", owner.cookie)).status).toBe(400);
  });
});

describe("recommendations", () => {
  it("ranks by popularity for new users and by category affinity for returning users", async () => {
    const { items } = await setupShop("Pune", [
      { name: "Pizza A", price: 100, category: "Pizza" },
      { name: "Burger A", price: 100, category: "Burgers" },
      { name: "Hidden", price: 100, category: "Pizza", isAvailable: false },
    ]);
    const buyer = await createUserWithRole("user");
    const newcomer = await createUserWithRole("user");
    const shopId = (await mongoose.model("Item").findById(items[0]?._id).lean<{ shop: unknown }>())?.shop;

    const order = (userId: string, item: (typeof items)[number], qty: number) =>
      Order.create({
        user: userId,
        paymentMethod: "cod",
        deliveryAddress: address,
        totalAmount: 1,
        shopOrders: [
          {
            shop: shopId,
            owner: new mongoose.Types.ObjectId(),
            subtotal: 1,
            status: "delivered",
            shopOrderItems: [{ item: item._id, name: item.name, price: 100, quantity: qty }],
          },
        ],
      });
    await order(newcomer.user._id, items[1] as (typeof items)[number], 10); // burgers are most popular overall
    await order(buyer.user._id, items[0] as (typeof items)[number], 3); // buyer prefers pizza

    const forNewcomer = await recommendItems(newcomer.user._id, "Pune", 5);
    expect(forNewcomer.map((i) => i.name)).not.toContain("Hidden");
    expect(forNewcomer[0]?.name).toBe("Burger A");

    const fresh = await createUserWithRole("user");
    expect((await recommendItems(fresh.user._id, "Pune", 5))[0]?.name).toBe("Burger A");
    expect((await recommendItems(buyer.user._id, "Pune", 5))[0]?.reason).toBeTruthy();
  });
});

describe("rate limiting", () => {
  const build = (max: number) => {
    const limited = express();
    process.env.ENABLE_RATE_LIMIT_IN_TESTS = "true";
    limited.get("/x", rateLimit({ name: "t", windowSeconds: 60, max }), (_req, res) => void res.json({ ok: true }));
    limited.use(errorHandler);
    return limited;
  };
  beforeEach(() => resetRateLimits());

  it("rejects requests over the limit with 429 and Retry-After", async () => {
    const limited = build(3);
    for (let i = 0; i < 3; i++) expect((await request(limited).get("/x")).status).toBe(200);
    const blocked = await request(limited).get("/x");
    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
    delete process.env.ENABLE_RATE_LIMIT_IN_TESTS;
  });
});

describe("cache", () => {
  it("degrades to the loader when Redis is not configured", async () => {
    const loader = vi.fn(async () => 42);
    const before = cacheStats.misses;
    expect(await withCache("k", 10, loader)).toBe(42);
    expect(await withCache("k", 10, loader)).toBe(42);
    expect(loader).toHaveBeenCalledTimes(2);
    expect(cacheStats.misses).toBe(before + 2);
    await expect(invalidateCache("k")).resolves.toBeUndefined();
  });
});
