import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/events/socket.js", () => ({ emitToUser: () => 0, initSocket: vi.fn(), closeSocket: vi.fn(), userRoom: (id: string) => `user:${id}` }));
vi.mock("../src/utils/mail.js", () => ({ sendOtpMail: vi.fn(async () => undefined), sendDeliveryOtpMail: vi.fn(async () => undefined) }));

import { defaultDispatchConfig } from "../src/config/dispatch.js";
import DeliveryAssignment from "../src/models/deliveryAssignment.model.js";
import DeliveryOffer from "../src/models/deliveryOffer.model.js";
import DispatchJob from "../src/models/dispatchJob.model.js";
import Order from "../src/models/order.model.js";
import User from "../src/models/user.model.js";
import { runDispatchTick } from "../src/services/dispatch/dispatch.service.js";
import { address, setupShop } from "./fixtures.js";
import { app, createUserWithRole, useTestDb } from "./helpers.js";

useTestDb();

const cfg = (over = {}) => ({ ...defaultDispatchConfig(), retryDelayMs: 60_000, ...over });
const tick = async (over = {}) => {
  await DispatchJob.updateMany({ status: { $in: ["queued", "waiting_offer"] } }, { nextRunAt: new Date() });
  await runDispatchTick(cfg(over));
};
/** Lets every live offer run out, as when the partner did not answer in time. */
const letOffersExpire = () => DeliveryOffer.updateMany({ status: "PENDING" }, { expiresAt: new Date(Date.now() - 1000) });
const rider = async (dLat = 0.001) => {
  const r = await createUserWithRole("deliveryBoy");
  await User.updateOne({ _id: r.user._id }, { isOnline: true, locationUpdatedAt: new Date(), location: { type: "Point", coordinates: [address.longitude, address.latitude + dLat] } });
  return r;
};
const world = async () => {
  const shop = await setupShop();
  const customer = await createUserWithRole("user");
  const placed = await request(app).post("/api/order/place-order").set("Cookie", customer.cookie)
    .send({ paymentMethod: "cod", deliveryAddress: address, cartItems: [{ id: String(shop.items[0]?._id), quantity: 1 }] });
  const orderId = placed.body._id as string;
  const shopOrderId = String((await Order.findById(orderId))!.shopOrders[0]!._id);
  const status = (s: string) => request(app).post(`/api/order/update-status/${orderId}/${shop.shop._id}`).set("Cookie", shop.owner.cookie).send({ status: s });
  const retry = (cookie = shop.owner.cookie) => request(app).post(`/api/order/retry-dispatch/${orderId}/${shopOrderId}`).set("Cookie", cookie);
  expect((await status("preparing")).status).toBe(200);
  return { ...shop, customer, orderId, shopOrderId, status, retry };
};
const offersFor = (partnerId: string, status?: string) => DeliveryOffer.countDocuments({ partner: partnerId, ...(status && { status }) });

describe("a partner who only missed the offer timeout", () => {
  it("is offered the order again when nobody else is available (the single-partner case)", async () => {
    const w = await world();
    const r = await rider();
    await tick();
    expect(await offersFor(r.user._id, "PENDING")).toBe(1);

    await letOffersExpire();
    await tick(); // expires the offer and excludes the partner
    await tick(); // nobody new: the timed-out partner gets another chance
    expect(await offersFor(r.user._id, "EXPIRED")).toBe(1);
    expect(await offersFor(r.user._id, "PENDING")).toBe(1);
    expect(await DispatchJob.findOne({ order: w.orderId }).lean()).toMatchObject({ status: "waiting_offer", attempts: 2 });

    // and they can accept it
    const offerId = (await request(app).get("/api/order/get-assignments").set("Cookie", r.cookie)).body[0].offerId;
    expect((await request(app).post(`/api/order/accept-order/${offerId}`).set("Cookie", r.cookie)).status).toBe(200);
    expect(await DeliveryAssignment.countDocuments({ shopOrderId: w.shopOrderId, status: "assigned" })).toBe(1);
  });

  it("is not re-offered while an untried partner is available (fresh partners first)", async () => {
    await world();
    const near = await rider(0.001);
    const other = await rider(0.004);
    await tick();
    expect(await offersFor(near.user._id, "PENDING")).toBe(1);
    await letOffersExpire();
    await tick();
    await tick();
    expect(await offersFor(other.user._id, "PENDING")).toBe(1);
    expect(await offersFor(near.user._id, "PENDING")).toBe(0);
    expect(await DeliveryOffer.countDocuments({ status: "PENDING" })).toBe(1); // still one at a time
  });

  it("a partner who DECLINED is never re-offered that order", async () => {
    const w = await world();
    const r = await rider();
    await tick();
    const offerId = (await request(app).get("/api/order/get-assignments").set("Cookie", r.cookie)).body[0].offerId;
    expect((await request(app).post(`/api/order/decline-offer/${offerId}`).set("Cookie", r.cookie)).status).toBe(200);
    await tick();
    await tick();
    expect(await offersFor(r.user._id)).toBe(1);
    expect((await DispatchJob.findOne({ order: w.orderId }).lean())!.noCandidateRounds).toBeGreaterThan(0);
  });

  it("re-offers stay bounded by the attempt limit", async () => {
    const w = await world();
    const r = await rider();
    for (let i = 0; i < 12; i++) {
      await tick({ maxAttempts: 3 });
      await letOffersExpire();
    }
    await tick({ maxAttempts: 3 });
    expect(await offersFor(r.user._id)).toBe(3);
    expect((await DispatchJob.findOne({ order: w.orderId }).lean())!.status).toBe("exhausted");
  });
});

describe("restaurant: find a delivery partner again", () => {
  it("restarts an exhausted 'out of delivery' order that the status flow can no longer restart", async () => {
    const w = await world();
    expect((await w.status("out of delivery")).status).toBe(200);
    await DispatchJob.updateOne({ order: w.orderId }, { status: "exhausted", attempts: 10, windowStartedAt: new Date(Date.now() - 3600_000) });
    expect((await w.status("out of delivery")).status).toBe(409); // the old advice did not work

    const r = await rider();
    const res = await w.retry();
    expect(res.status).toBe(200);
    expect(res.body.dispatch).toMatchObject({ status: "queued", attempts: 0 });
    await runDispatchTick(cfg()); // due immediately: no forcing needed
    expect(await offersFor(r.user._id, "PENDING")).toBe(1);
    expect(await DispatchJob.countDocuments({ order: w.orderId })).toBe(1);
  });

  it("is idempotent and never duplicates jobs or offers", async () => {
    const w = await world();
    const r = await rider();
    await tick();
    for (let i = 0; i < 3; i++) expect((await w.retry()).status).toBe(200);
    await runDispatchTick(cfg());
    expect(await DispatchJob.countDocuments({ order: w.orderId })).toBe(1);
    expect(await DeliveryOffer.countDocuments({ status: "PENDING" })).toBe(1);
    expect(await offersFor(r.user._id)).toBe(1);
  });

  it("is refused for assigned, finished or someone else's orders", async () => {
    const w = await world();
    const customer = await createUserWithRole("user");
    const otherOwner = await createUserWithRole("owner");
    expect((await w.retry(customer.cookie)).status).toBe(403);
    expect((await w.retry(otherOwner.cookie)).status).toBe(404);

    const r = await rider();
    await tick();
    const offerId = (await request(app).get("/api/order/get-assignments").set("Cookie", r.cookie)).body[0].offerId;
    await request(app).post(`/api/order/accept-order/${offerId}`).set("Cookie", r.cookie);
    expect((await w.retry()).status).toBe(409);

    const cancelled = await world();
    await cancelled.status("cancelled");
    expect((await cancelled.retry()).status).toBe(409);
  });
});
