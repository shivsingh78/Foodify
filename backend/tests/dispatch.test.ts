import mongoose from "mongoose";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const emitted = vi.hoisted(() => [] as { userId: string; event: string; payload: unknown }[]);
vi.mock("../src/events/socket.js", () => ({
  emitToUser: (userId: string, event: string, payload: unknown) => void emitted.push({ userId, event, payload }),
  initSocket: vi.fn(),
  closeSocket: vi.fn(),
  userRoom: (id: string) => `user:${id}`,
}));
vi.mock("../src/utils/mail.js", () => ({ sendOtpMail: vi.fn(async () => undefined), sendDeliveryOtpMail: vi.fn(async () => undefined) }));

import { defaultDispatchConfig } from "../src/config/dispatch.js";
import DeliveryAssignment from "../src/models/deliveryAssignment.model.js";
import DeliveryOffer from "../src/models/deliveryOffer.model.js";
import DispatchJob from "../src/models/dispatchJob.model.js";
import Notification from "../src/models/notification.model.js";
import Order from "../src/models/order.model.js";
import User from "../src/models/user.model.js";
import {
  expireDueOffers,
  processJob,
  recoverState,
  refreshEtaOnPartnerMove,
  runDispatchTick,
} from "../src/services/dispatch/dispatch.service.js";
import { getDispatchMetrics } from "../src/services/dispatch/metrics.service.js";
import { address, setupShop } from "./fixtures.js";
import { app, createUserWithRole, useTestDb } from "./helpers.js";

useTestDb();
beforeEach(() => void (emitted.length = 0));

const cfg = (over = {}) => ({ ...defaultDispatchConfig(), retryDelayMs: 60_000, ...over });
/** One worker pass. Queued jobs are forced due first, so tests do not have to wait out the retry delay. */
const tick = async (over = {}) => {
  await DispatchJob.updateMany({ status: "queued" }, { nextRunAt: new Date() });
  return runDispatchTick(cfg(over));
};

const makeRider = async (dLat = 0.001, over: Record<string, unknown> = {}) => {
  const r = await createUserWithRole("deliveryBoy");
  await User.updateOne(
    { _id: r.user._id },
    { isOnline: true, locationUpdatedAt: new Date(), location: { type: "Point", coordinates: [address.longitude, address.latitude + dLat] }, ...over },
  );
  return r;
};

const world = async (opts: { prepMinutes?: number } = {}) => {
  const shop = await setupShop();
  const customer = await createUserWithRole("user");
  const placed = await request(app)
    .post("/api/order/place-order")
    .set("Cookie", customer.cookie)
    .send({ paymentMethod: "cod", deliveryAddress: address, cartItems: [{ id: String(shop.items[0]?._id), quantity: 1 }] });
  const orderId = placed.body._id as string;
  const shopId = String(shop.shop._id);
  const status = (s: string, extra = {}) =>
    request(app).post(`/api/order/update-status/${orderId}/${shopId}`).set("Cookie", shop.owner.cookie).send({ status: s, ...extra });
  const prep = await status("preparing", opts.prepMinutes ? { prepMinutes: opts.prepMinutes } : {});
  expect(prep.status).toBe(200);
  const order = await Order.findById(orderId);
  const shopOrderId = String(order?.shopOrders[0]?._id);
  return { ...shop, customer, orderId, shopId, shopOrderId, status };
};

const offers = (c: string) => request(app).get("/api/order/get-assignments").set("Cookie", c);
const accept = (c: string, id: string) => request(app).post(`/api/order/accept-order/${id}`).set("Cookie", c);
const decline = (c: string, id: string) => request(app).post(`/api/order/decline-offer/${id}`).set("Cookie", c);
const offerFor = async (c: string) => (await offers(c)).body[0]?.offerId as string | undefined;
const jobOf = (w: { orderId: string; shopOrderId: string }) => DispatchJob.findOne({ order: w.orderId, shopOrderId: w.shopOrderId });

describe("dispatch lifecycle", () => {
  it("starts dispatch when preparation starts, stores the ready time, and offers to ONE ranked partner", async () => {
    const w = await world({ prepMinutes: 20 });
    const near = await makeRider(0.001);
    const far = await makeRider(0.02);

    const job = await jobOf(w);
    expect(job).toMatchObject({ status: "queued", attempts: 0 });
    const order = await Order.findById(w.orderId);
    const so = order?.shopOrders[0];
    expect((so!.readyAt!.getTime() - so!.preparingAt!.getTime()) / 60_000).toBe(20);

    await tick();
    const all = await DeliveryOffer.find({});
    expect(all).toHaveLength(1);
    expect(String(all[0]?.partner)).toBe(near.user._id); // closer partner ranks first
    expect(all[0]?.snapshot?.score).toBeGreaterThan(0);
    expect((await jobOf(w))?.status).toBe("waiting_offer");
    expect(await offerFor(far.cookie)).toBeUndefined();
    // Only the chosen partner is told about the offer.
    const sent = emitted.filter((e) => e.event === "newAssignment");
    expect(sent.map((e) => e.userId)).toEqual([near.user._id]);
  });

  it("accepts: one assignment, order stamped, job assigned, ETA frozen, customer notified", async () => {
    const w = await world();
    const rider = await makeRider();
    await tick();
    const offerId = (await offerFor(rider.cookie))!;

    const res = await accept(rider.cookie, offerId);
    expect(res.status).toBe(200);
    const order = await Order.findById(w.orderId);
    const so = order!.shopOrders[0]!;
    expect(String(so.assignedDeliveryBoy)).toBe(rider.user._id);
    expect(await DeliveryAssignment.countDocuments({ shopOrderId: w.shopOrderId, status: "assigned" })).toBe(1);
    expect((await DeliveryOffer.findById(offerId))?.status).toBe("ACCEPTED");
    const job = await jobOf(w);
    expect(job).toMatchObject({ status: "assigned" });
    expect(String(job?.assignedTo)).toBe(rider.user._id);
    expect(job!.assignedAt!.getTime()).toBeGreaterThanOrEqual(job!.startedAt.getTime());
    expect(so.etaAtAssignment?.deliveryAt).toBeInstanceOf(Date);
    expect(so.etaAtAssignment!.deliveryAt.getTime()).toBeGreaterThan(so.etaAtAssignment!.pickupAt.getTime());
    expect(so.etaAtAssignment!.basis).toBe("assignment");
    expect(await Notification.countDocuments({ user: w.customer.user._id, type: "delivery_assigned" })).toBe(1);
    expect(emitted.some((e) => e.event === "etaUpdated" && e.userId === w.customer.user._id)).toBe(true);
    // repeating the request is idempotent
    const again = await accept(rider.cookie, offerId);
    expect(again.status).toBe(200);
    expect(await DeliveryAssignment.countDocuments({ shopOrderId: w.shopOrderId })).toBe(1);
  });

  it("never offers to ineligible partners (stale, offline, busy, too far, customers) and retries until one qualifies", async () => {
    const w = await world();
    await makeRider(0.001, { locationUpdatedAt: new Date(Date.now() - 10 * 60_000) }); // stale
    await makeRider(0.001, { isOnline: false });
    await makeRider(0.2); // far away
    const busy = await makeRider(0.001);
    await DeliveryAssignment.create({ order: new mongoose.Types.ObjectId(), shopOrderId: new mongoose.Types.ObjectId(), assignedTo: busy.user._id, status: "assigned" });

    await tick();
    expect(await DeliveryOffer.countDocuments({})).toBe(0);
    expect(await jobOf(w)).toMatchObject({ status: "queued", attempts: 0 }); // no offer placed: no attempt used

    const good = await makeRider(0.002);
    await tick();
    const offer = await DeliveryOffer.findOne({});
    expect(String(offer?.partner)).toBe(good.user._id);
  });

  it("decline moves to the next candidate and a declined partner is not offered again", async () => {
    const w = await world();
    const a = await makeRider(0.001);
    const b = await makeRider(0.002);
    await tick();
    const first = (await offerFor(a.cookie))!;
    expect((await decline(a.cookie, first)).status).toBe(200);
    expect((await decline(a.cookie, first)).status).toBe(200); // idempotent
    expect((await DeliveryOffer.findById(first))?.status).toBe("DECLINED");
    expect((await accept(a.cookie, first)).status).toBe(409); // terminal states stay terminal

    await tick();
    expect(await offerFor(b.cookie)).toBeDefined();
    expect(await offerFor(a.cookie)).toBeUndefined();
    expect((await jobOf(w))?.excludedPartners.map(String)).toEqual([a.user._id]);
  });

  it("expires unanswered offers on the SERVER clock, even if the expiry sweep never ran", async () => {
    const w = await world();
    const a = await makeRider(0.001);
    const b = await makeRider(0.002);
    await tick();
    const offerId = (await offerFor(a.cookie))!;
    await DeliveryOffer.updateOne({ _id: offerId }, { expiresAt: new Date(Date.now() - 1000) }); // time passes; no sweep

    const late = await accept(a.cookie, offerId);
    expect(late.status).toBe(409);
    expect(late.body.code).toBe("OFFER_EXPIRED");
    expect((await DeliveryOffer.findById(offerId))?.status).toBe("EXPIRED");
    expect(await Order.countDocuments({ "shopOrders.assignedDeliveryBoy": a.user._id })).toBe(0);

    await tick();
    expect(await offerFor(b.cookie)).toBeDefined(); // next candidate
    expect(w.orderId).toBeDefined();
  });

  it("the expiry sweep expires, notifies the partner and requeues", async () => {
    const w = await world();
    const a = await makeRider();
    await tick();
    const offerId = (await offerFor(a.cookie))!;
    await DeliveryOffer.updateOne({ _id: offerId }, { expiresAt: new Date(Date.now() - 1) });
    expect(await expireDueOffers()).toBe(1);
    expect(await expireDueOffers()).toBe(0); // idempotent
    expect(emitted.some((e) => e.event === "offerExpired" && e.userId === a.user._id)).toBe(true);
    expect((await jobOf(w))?.status).toBe("queued");
  });

  it("stops after the maximum number of offers, tells the owner, and can be reopened", async () => {
    const w = await world();
    const riders = [await makeRider(0.001), await makeRider(0.002), await makeRider(0.003)];
    for (let i = 0; i < 2; i++) {
      await tick({ maxAttempts: 2 });
      for (const rider of riders) {
        const offerId = await offerFor(rider.cookie);
        if (offerId) await decline(rider.cookie, offerId);
      }
    }
    await tick({ maxAttempts: 2 });
    expect(await jobOf(w)).toMatchObject({ status: "exhausted", attempts: 2 });
    expect(await DeliveryOffer.countDocuments({})).toBe(2);
    expect(await Notification.countDocuments({ user: w.owner.user._id, title: "No delivery partner found" })).toBe(1);
    expect(emitted.some((e) => e.event === "dispatchExhausted" && e.userId === w.owner.user._id)).toBe(true);

    await tick({ maxAttempts: 2 });
    expect(await DeliveryOffer.countDocuments({})).toBe(2); // exhausted jobs do not run on their own
    expect((await w.status("out of delivery")).status).toBe(200); // owner retries: fresh attempts
    await tick({ maxAttempts: 2 });
    expect(await DeliveryOffer.countDocuments({})).toBe(3);
    expect(await jobOf(w)).toMatchObject({ status: "waiting_offer", attempts: 1 });
  });

  it("gives up when no partner appears within the maximum wait, and the owner can retry", async () => {
    const w = await world();
    await tick(); // nobody available: waits, uses no attempt
    expect(await jobOf(w)).toMatchObject({ status: "queued", attempts: 0 });
    await DispatchJob.updateOne({ order: w.orderId }, { windowStartedAt: new Date(Date.now() - 11 * 60_000) });
    await tick();
    expect((await jobOf(w))?.status).toBe("exhausted");
    expect(await Notification.countDocuments({ user: w.owner.user._id, title: "No delivery partner found" })).toBe(1);

    const rider = await makeRider();
    await w.status("out of delivery");
    await tick();
    expect(await offerFor(rider.cookie)).toBeDefined(); // reopened with a fresh search window
  });

  it("cancelling the order closes the job and withdraws a pending offer", async () => {
    const w = await world();
    const rider = await makeRider();
    await tick();
    const offerId = (await offerFor(rider.cookie))!;
    expect((await w.status("cancelled")).status).toBe(200);
    expect((await DeliveryOffer.findById(offerId))?.status).toBe("CANCELLED");
    expect((await jobOf(w))?.status).toBe("cancelled");
    expect(emitted.some((e) => e.event === "offerExpired" && e.userId === rider.user._id)).toBe(true);
    const late = await accept(rider.cookie, offerId);
    expect(late.status).toBe(409);
    expect(await DeliveryAssignment.countDocuments({})).toBe(0);
  });

  it("cancelling after assignment releases the partner", async () => {
    const w = await world();
    const rider = await makeRider();
    await tick();
    await accept(rider.cookie, (await offerFor(rider.cookie))!);
    await w.status("cancelled");
    expect(await DeliveryAssignment.countDocuments({ status: "assigned" })).toBe(0);
    expect(emitted.some((e) => e.event === "assignmentCancelled" && e.userId === rider.user._id)).toBe(true);
  });
});

describe("concurrency safety", () => {
  it("duplicate dispatch workers create a single offer", async () => {
    const w = await world();
    await makeRider(0.001);
    await makeRider(0.002);
    await Promise.all(Array.from({ length: 6 }, () => tick()));
    expect(await DeliveryOffer.countDocuments({ status: "PENDING" })).toBe(1);
    expect(await DeliveryOffer.countDocuments({})).toBe(1);
    expect((await jobOf(w))?.status).toBe("waiting_offer");
  });

  it("two partners racing for the same order: exactly one wins (late accept after expiry vs next offer)", async () => {
    const w = await world();
    const a = await makeRider(0.001);
    const b = await makeRider(0.002);
    await tick();
    const offerA = (await offerFor(a.cookie))!;
    await DeliveryOffer.updateOne({ _id: offerA }, { expiresAt: new Date(Date.now() - 1) });
    await expireDueOffers();
    await tick();
    const offerB = (await offerFor(b.cookie))!;

    const results = await Promise.all([accept(a.cookie, offerA), accept(b.cookie, offerB), accept(a.cookie, offerA)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect(results[1]!.status).toBe(200);
    expect(await DeliveryAssignment.countDocuments({ shopOrderId: w.shopOrderId, status: "assigned" })).toBe(1);
    const order = await Order.findById(w.orderId);
    expect(String(order?.shopOrders[0]?.assignedDeliveryBoy)).toBe(b.user._id);
  });

  it("the database itself rejects a second active assignment for one order, or a second for one partner", async () => {
    const order = new mongoose.Types.ObjectId();
    const so = new mongoose.Types.ObjectId();
    const p1 = new mongoose.Types.ObjectId();
    await DeliveryAssignment.create({ order, shopOrderId: so, assignedTo: p1, status: "assigned" });
    await expect(DeliveryAssignment.create({ order, shopOrderId: so, assignedTo: new mongoose.Types.ObjectId(), status: "assigned" })).rejects.toMatchObject({ code: 11000 });
    await expect(DeliveryAssignment.create({ order: new mongoose.Types.ObjectId(), shopOrderId: new mongoose.Types.ObjectId(), assignedTo: p1, status: "assigned" })).rejects.toMatchObject({ code: 11000 });
    const pending = { order, shopOrderId: so, round: 1, expiresAt: new Date(Date.now() + 1e5) };
    await DeliveryOffer.create({ ...pending, partner: p1 });
    await expect(DeliveryOffer.create({ ...pending, partner: new mongoose.Types.ObjectId() })).rejects.toMatchObject({ code: 11000 });
  });

  it("two orders compete for one partner: only one is offered, and the busy partner is skipped afterwards", async () => {
    const w1 = await world();
    const w2 = await world();
    const rider = await makeRider();
    await Promise.all([tick(), tick()]);
    expect(await DeliveryOffer.countDocuments({ status: "PENDING" })).toBe(1);
    const offerId = (await offerFor(rider.cookie))!;
    expect((await accept(rider.cookie, offerId)).status).toBe(200);

    await tick();
    expect(await DeliveryOffer.countDocuments({ status: "PENDING" })).toBe(0); // rider is at capacity
    expect(await DeliveryAssignment.countDocuments({ status: "assigned" })).toBe(1);
    const jobs = await Promise.all([jobOf(w1), jobOf(w2)]);
    expect(jobs.map((j) => j?.status).sort()).toEqual(["assigned", "queued"]);
  });

  it("cancellation racing with acceptance never leaves an active assignment on a cancelled order", async () => {
    for (let i = 0; i < 5; i++) {
      const w = await world();
      const rider = await makeRider();
      await tick();
      const offerId = (await offerFor(rider.cookie))!;
      const [acc] = await Promise.all([accept(rider.cookie, offerId), w.status("cancelled")]);
      const order = await Order.findById(w.orderId);
      expect(order?.shopOrders[0]?.status).toBe("cancelled");
      expect(await DeliveryAssignment.countDocuments({ shopOrderId: w.shopOrderId, status: "assigned" })).toBe(0);
      expect([200, 409]).toContain(acc.status);
      await DeliveryAssignment.deleteMany({});
      await DeliveryOffer.deleteMany({});
      await User.updateOne({ _id: rider.user._id }, { role: "user" });
    }
  });

  it("a stale worker cannot overwrite a newer owner or touch an assigned order", async () => {
    const w = await world();
    await makeRider();
    const claimed = await DispatchJob.findOneAndUpdate({ order: w.orderId }, { status: "processing", lockedBy: "new-worker", lockedUntil: new Date(Date.now() + 60_000) }, { new: true });
    await processJob(claimed!, "old-worker", cfg());
    expect(await DeliveryOffer.countDocuments({})).toBe(0);
    expect(await jobOf(w)).toMatchObject({ status: "processing", lockedBy: "new-worker", attempts: 0 });

    // assigned order: a late worker only records the fact
    const rider = await makeRider(0.002);
    await DispatchJob.updateOne({ order: w.orderId }, { status: "processing", lockedBy: "w2" });
    await Order.updateOne({ _id: w.orderId, "shopOrders._id": w.shopOrderId }, { $set: { "shopOrders.$.assignedDeliveryBoy": rider.user._id } });
    await processJob((await jobOf(w))!, "w2", cfg());
    expect(await DeliveryOffer.countDocuments({})).toBe(0);
    expect((await jobOf(w))?.status).toBe("assigned");
  });
});

describe("recovery after restarts", () => {
  it("re-creates a job that was never written, reclaims an abandoned lease, and repairs a half-finished assignment", async () => {
    const w = await world();
    const rider = await makeRider();
    await DispatchJob.deleteMany({}); // crash before the job upsert
    expect(await recoverState()).toMatchObject({ enqueued: 1 });
    expect((await jobOf(w))?.status).toBe("queued");
    expect((await recoverState()).enqueued).toBe(0); // idempotent

    await DispatchJob.updateOne({ order: w.orderId }, { status: "processing", lockedBy: "dead-worker", lockedUntil: new Date(Date.now() - 1000) });
    await tick();
    expect(await DeliveryOffer.countDocuments({ partner: rider.user._id })).toBe(1);

    // assignment row exists but the order was never stamped (crash between the two writes)
    await DeliveryOffer.deleteMany({});
    await DispatchJob.updateOne({ order: w.orderId }, { status: "assigned" });
    const a = await DeliveryAssignment.create({ order: w.orderId, shopOrderId: w.shopOrderId, assignedTo: rider.user._id, status: "assigned" });
    await DeliveryAssignment.updateOne({ _id: a._id }, { $set: { updatedAt: new Date(Date.now() - 60_000) } }, { timestamps: false });
    expect(await recoverState()).toMatchObject({ repaired: 1 });
    expect(String((await Order.findById(w.orderId))?.shopOrders[0]?.assignedDeliveryBoy)).toBe(rider.user._id);
  });
});

describe("ETA revisions", () => {
  it("revises on material movement and pickup, throttled, and never rewrites the assignment-time prediction", async () => {
    const w = await world();
    const rider = await makeRider(0.01);
    await tick();
    await accept(rider.cookie, (await offerFor(rider.cookie))!);
    const first = (await Order.findById(w.orderId))!.shopOrders[0]!;
    const frozen = first.etaAtAssignment!.deliveryAt.getTime();

    const t0 = new Date(Date.now() + 120_000);
    const near: [number, number] = [address.longitude, address.latitude + 0.0005];
    await refreshEtaOnPartnerMove(rider.user._id, near, t0); // first sample for this partner
    const sameSpot = await refreshEtaOnPartnerMove(rider.user._id, near, new Date(t0.getTime() + 5_000));
    expect(sameSpot).toBe(false); // < 30 s and < 250 m: throttled

    const farther: [number, number] = [address.longitude + 0.03, address.latitude + 0.03];
    const moved = await refreshEtaOnPartnerMove(rider.user._id, farther, new Date(t0.getTime() + 120_000));
    expect(moved).toBe(true);
    const revised = (await Order.findById(w.orderId))!.shopOrders[0]!;
    expect(revised.eta?.basis).toBe("partner_moved");
    expect(revised.eta!.deliveryAt.getTime()).not.toBe(frozen);
    expect(revised.etaAtAssignment!.deliveryAt.getTime()).toBe(frozen);
    expect(emitted.filter((e) => e.event === "etaUpdated").length).toBeGreaterThanOrEqual(2);

    expect((await w.status("out of delivery")).status).toBe(200);
    const picked = (await Order.findById(w.orderId))!.shopOrders[0]!;
    expect(picked.eta?.basis).toBe("pickup");
    expect(picked.pickedUpAt).toBeInstanceOf(Date);
    expect(picked.etaAtAssignment!.deliveryAt.getTime()).toBe(frozen);
  });
});

describe("authorization", () => {
  it("customers, owners, other partners and anonymous users cannot accept or decline offers", async () => {
    const w = await world();
    const rider = await makeRider();
    const other = await makeRider(0.003);
    await tick();
    const offerId = (await offerFor(rider.cookie))!;
    expect((await accept(w.customer.cookie, offerId)).status).toBe(403);
    expect((await accept(w.owner.cookie, offerId)).status).toBe(403);
    expect((await request(app).post(`/api/order/accept-order/${offerId}`)).status).toBe(401);
    expect((await accept(other.cookie, offerId)).status).toBe(404);
    expect((await decline(other.cookie, offerId)).status).toBe(404);
    expect((await DeliveryOffer.findById(offerId))?.status).toBe("PENDING");
    expect((await offers(other.cookie)).body).toEqual([]);
  });

  it("dispatch status is visible to the customer, the shop owner and admins only", async () => {
    const w = await world();
    const rider = await makeRider();
    const stranger = await createUserWithRole("user");
    const strangerOwner = (await setupShop()).owner;
    const admin = await createUserWithRole("admin");
    const url = `/api/order/dispatch-status/${w.orderId}/${w.shopOrderId}`;
    const get = (c: string) => request(app).get(url).set("Cookie", c);
    expect((await get(w.customer.cookie)).status).toBe(200);
    expect((await get(w.owner.cookie)).body.dispatch.status).toBe("queued");
    expect((await get(admin.cookie)).status).toBe(200);
    for (const c of [stranger.cookie, strangerOwner.cookie, rider.cookie]) expect((await get(c)).status).toBe(404);
    expect((await request(app).get(url)).status).toBe(401);
    expect(JSON.stringify((await get(w.customer.cookie)).body)).not.toMatch(/email|mobile|password/);
  });

  it("owners cannot choose a partner or dispatch directly; unknown fields are rejected", async () => {
    const w = await world();
    const rider = await makeRider();
    const res = await request(app)
      .post(`/api/order/update-status/${w.orderId}/${w.shopId}`)
      .set("Cookie", w.owner.cookie)
      .send({ status: "out of delivery", assignedDeliveryBoy: rider.user._id });
    expect(res.status).toBe(400);
  });

  it("only admins can read dispatch metrics", async () => {
    const customer = await createUserWithRole("user");
    const owner = await createUserWithRole("owner");
    const admin = await createUserWithRole("admin");
    expect((await request(app).get("/api/analytics/dispatch")).status).toBe(401);
    expect((await request(app).get("/api/analytics/dispatch").set("Cookie", customer.cookie)).status).toBe(403);
    expect((await request(app).get("/api/analytics/dispatch").set("Cookie", owner.cookie)).status).toBe(403);
    expect((await request(app).get("/api/analytics/dispatch?days=7").set("Cookie", admin.cookie)).status).toBe(200);
  });
});

describe("metrics", () => {
  it("measures assignment latency, offer outcomes, attempts and ETA error from persisted records, without PII", async () => {
    const w = await world();
    const a = await makeRider(0.001);
    const b = await makeRider(0.002);
    await tick();
    await decline(a.cookie, (await offerFor(a.cookie))!);
    await tick();
    await accept(b.cookie, (await offerFor(b.cookie))!);

    // pretend the dispatch took exactly 42 s and the delivery finished 5 min after the frozen ETA
    const job = (await jobOf(w))!;
    await DispatchJob.updateOne({ _id: job._id }, { startedAt: new Date(job.assignedAt!.getTime() - 42_000) });
    const so = (await Order.findById(w.orderId))!.shopOrders[0]!;
    await Order.updateOne(
      { _id: w.orderId, "shopOrders._id": w.shopOrderId },
      { $set: { "shopOrders.$.status": "delivered", "shopOrders.$.deliveredAt": new Date(so.etaAtAssignment!.deliveryAt.getTime() + 5 * 60_000) } },
    );

    const m = await getDispatchMetrics(7);
    expect(m.assignmentLatencySeconds).toMatchObject({ count: 1, average: 42, p50: 42, p95: 42 });
    expect(m.assignmentSuccessRate).toBe(1);
    expect(m.offers).toMatchObject({ ACCEPTED: 1, DECLINED: 1, EXPIRED: 0 });
    expect(m.attemptsPerOrder).toBe(2);
    expect(m.etaAccuracy).toMatchObject({ sampleCount: 1, meanAbsoluteErrorMinutes: 5, medianAbsoluteErrorMinutes: 5, meanSignedErrorMinutes: 5 });
    const text = JSON.stringify(m);
    expect(text).not.toContain(address.text);
    expect(text).not.toMatch(/@|mobile|latitude|longitude|coordinates/);
  });

  it("ignores orders without an assignment-time ETA or a delivery time, and counts exhausted jobs", async () => {
    const w = await world();
    await DispatchJob.updateOne({ order: w.orderId }, { windowStartedAt: new Date(Date.now() - 11 * 60_000) });
    await tick();
    await Order.updateOne({ _id: w.orderId, "shopOrders._id": w.shopOrderId }, { $set: { "shopOrders.$.status": "delivered" } }); // no deliveredAt, no ETA
    const m = await getDispatchMetrics(7);
    expect(m.etaAccuracy).toMatchObject({ sampleCount: 0, meanAbsoluteErrorMinutes: null });
    expect(m.ordersExhausted).toBe(1);
    expect(m.assignmentSuccessRate).toBe(0);
    expect(m.assignmentLatencySeconds.count).toBe(0);
  });
});
