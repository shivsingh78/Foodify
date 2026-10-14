import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/events/socket.js", () => ({ emitToUser: () => 0, initSocket: vi.fn(), closeSocket: vi.fn(), userRoom: (id: string) => `user:${id}` }));
vi.mock("../src/utils/mail.js", () => ({ sendOtpMail: vi.fn(async () => undefined), sendDeliveryOtpMail: vi.fn(async () => undefined) }));

import { defaultDispatchConfig } from "../src/config/dispatch.js";
import DeliveryOffer from "../src/models/deliveryOffer.model.js";
import DispatchJob from "../src/models/dispatchJob.model.js";
import Shop from "../src/models/shop.model.js";
import User from "../src/models/user.model.js";
import { runDispatchTick } from "../src/services/dispatch/dispatch.service.js";
import { setupShop } from "./fixtures.js";
import { app, createUserWithRole, useTestDb } from "./helpers.js";

useTestDb();

// The reported case: the shop was saved ~500 km away (19.22681, 79.80362) while the restaurant,
// customer and partners are actually in Bhopal.
const BHOPAL = { latitude: 23.256924, longitude: 77.472351 };
const WRONG = { latitude: 19.22681, longitude: 79.80362 };
const bhopalAddress = { text: "Shiv Park, Bhopal", ...BHOPAL };

const edit = (cookie: string, fields: Record<string, string>) => {
  let req = request(app).post("/api/shop/create-edit").set("Cookie", cookie);
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  return req;
};
const base = { name: "Bhopal Kitchen", city: "Bhopal", state: "MP", address: "Shiv Park" };

describe("owner can correct the shop pickup location", () => {
  it("stores the picked point as GeoJSON [longitude, latitude], and keeps it when no point is sent", async () => {
    const { owner, shop } = await setupShop("Bhopal");
    const res = await edit(owner.cookie, { ...base, latitude: String(BHOPAL.latitude), longitude: String(BHOPAL.longitude) });
    expect(res.status).toBe(200);
    expect((await Shop.findById(shop._id).lean())!.location).toEqual({ type: "Point", coordinates: [BHOPAL.longitude, BHOPAL.latitude] });

    expect((await edit(owner.cookie, { ...base, name: "Renamed" })).status).toBe(200); // older clients: no point sent
    const after = (await Shop.findById(shop._id).lean())!;
    expect(after.name).toBe("Renamed");
    expect(after.location!.coordinates).toEqual([BHOPAL.longitude, BHOPAL.latitude]);
  });

  it("rejects half or placeholder coordinates without changing the shop", async () => {
    const { owner, shop } = await setupShop("Bhopal");
    await Shop.updateOne({ _id: shop._id }, { location: { type: "Point", coordinates: [BHOPAL.longitude, BHOPAL.latitude] } });
    for (const bad of [{ latitude: "23.2" }, { latitude: "0", longitude: "0" }, { latitude: "95", longitude: "77" }, { latitude: "abc", longitude: "77" }]) {
      expect((await edit(owner.cookie, { ...base, ...bad })).status).toBe(400);
    }
    expect((await Shop.findById(shop._id).lean())!.location!.coordinates).toEqual([BHOPAL.longitude, BHOPAL.latitude]);
  });

  it("only the shop's own owner can change it", async () => {
    const customer = await createUserWithRole("user");
    const rider = await createUserWithRole("deliveryBoy");
    for (const who of [customer, rider]) {
      expect((await edit(who.cookie, { ...base, latitude: "1", longitude: "1" })).status).toBe(403);
    }
  });

  it("a wrongly placed shop gets no offers; after correcting it, the nearby partner is offered the order", async () => {
    const { owner, shop, items } = await setupShop("Bhopal");
    await Shop.updateOne({ _id: shop._id }, { location: { type: "Point", coordinates: [WRONG.longitude, WRONG.latitude] } });
    const partners = [];
    for (let i = 0; i < 2; i++) {
      const r = await createUserWithRole("deliveryBoy");
      await User.updateOne({ _id: r.user._id }, { isOnline: true, locationUpdatedAt: new Date(), location: { type: "Point", coordinates: [BHOPAL.longitude, BHOPAL.latitude + i * 0.001] } });
      partners.push(r);
    }
    const customer = await createUserWithRole("user");
    const placed = await request(app).post("/api/order/place-order").set("Cookie", customer.cookie)
      .send({ paymentMethod: "cod", deliveryAddress: bhopalAddress, cartItems: [{ id: String(items[0]?._id), quantity: 1 }] });
    const orderId = placed.body._id as string;
    const status = (s: string) => request(app).post(`/api/order/update-status/${orderId}/${shop._id}`).set("Cookie", owner.cookie).send({ status: s });
    await status("preparing");
    await status("out of delivery");
    const tick = async () => {
      await DispatchJob.updateMany({ status: "queued" }, { nextRunAt: new Date() });
      await runDispatchTick({ ...defaultDispatchConfig(), retryDelayMs: 60_000 });
    };

    await tick();
    expect(await DeliveryOffer.countDocuments({})).toBe(0);
    const before = await request(app).get("/api/order/dispatch-diagnosis").set("Cookie", owner.cookie);
    expect(before.body.orders[0]).toMatchObject({ pickup: "shop_location", partners: { total: 2, too_far: 2 } });

    // the owner fixes the pin on the edit-shop page
    expect((await edit(owner.cookie, { ...base, latitude: String(BHOPAL.latitude), longitude: String(BHOPAL.longitude) })).status).toBe(200);
    await tick();
    const offers = await DeliveryOffer.find({ status: "PENDING" }).lean();
    expect(offers).toHaveLength(1); // still one partner at a time
    expect(String(offers[0]!.partner)).toBe(partners[0]!.user._id); // the nearer one
  });
});
