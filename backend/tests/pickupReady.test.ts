import mongoose from "mongoose";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const emitted = vi.hoisted(() => [] as { userId: string; event: string; payload: unknown }[]);
const failing = vi.hoisted(() => ({ event: null as string | null }));
vi.mock("../src/events/socket.js", () => ({
  emitToUser: (userId: string, event: string, payload: unknown) => {
    if (failing.event === event) throw new Error("socket down");
    emitted.push({ userId, event, payload });
  },
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
import { getDispatchStatus, registerKick, runDispatchTick } from "../src/services/dispatch/dispatch.service.js";
import { notify } from "../src/services/notification.service.js";
import { deliverPickupNotice, recoverPickupNotices } from "../src/services/pickupNotice.service.js";
import { address, setupShop } from "./fixtures.js";
import { app, createUserWithRole, useTestDb } from "./helpers.js";

useTestDb();
beforeEach(() => {
  emitted.length = 0;
  failing.event = null;
  registerKick(null);
});

const cfg = () => ({ ...defaultDispatchConfig(), retryDelayMs: 60_000 });
/** One worker pass that does NOT force queued jobs due: it honours the retry delay like production. */
const tickAsIs = () => runDispatchTick(cfg());
/** One worker pass with queued jobs forced due (used only to set the scene). */
const tickForced = async () => {
  await DispatchJob.updateMany({ status: "queued" }, { nextRunAt: new Date() });
  return runDispatchTick(cfg());
};

const makeRider = async (dLat = 0.001) => {
  const r = await createUserWithRole("deliveryBoy");
  await User.updateOne(
    { _id: r.user._id },
    { isOnline: true, locationUpdatedAt: new Date(), location: { type: "Point", coordinates: [address.longitude, address.latitude + dLat] } },
  );
  return r;
};

const world = async () => {
  const shop = await setupShop();
  const customer = await createUserWithRole("user");
  const placed = await request(app)
    .post("/api/order/place-order")
    .set("Cookie", customer.cookie)
    .send({ paymentMethod: "cod", deliveryAddress: address, cartItems: [{ id: String(shop.items[0]?._id), quantity: 1 }] });
  const orderId = placed.body._id as string;
  const shopId = String(shop.shop._id);
  const status = (s: string) => request(app).post(`/api/order/update-status/${orderId}/${shopId}`).set("Cookie", shop.owner.cookie).send({ status: s });
  expect((await status("preparing")).status).toBe(200);
  const shopOrderId = String((await Order.findById(orderId))!.shopOrders[0]!._id);
  return { ...shop, customer, orderId, shopId, shopOrderId, status };
};
const offerFor = async (c: string) => (await request(app).get("/api/order/get-assignments").set("Cookie", c)).body[0]?.offerId as string | undefined;
const jobOf = (w: { orderId: string; shopOrderId: string }) => DispatchJob.findOne({ order: w.orderId, shopOrderId: w.shopOrderId });
const readyNotes = (userId: string) => Notification.countDocuments({ user: userId, title: "Order ready for pickup" });
const readyEvents = () => emitted.filter((e) => e.event === "deliveryReadyForPickup");

/** An order whose partner has already accepted it. */
const assignedWorld = async () => {
  const w = await world();
  const rider = await makeRider();
  await tickForced();
  expect((await request(app).post(`/api/order/accept-order/${await offerFor(rider.cookie)}`).set("Cookie", rider.cookie)).status).toBe(200);
  emitted.length = 0;
  return { ...w, rider };
};

describe("out of delivery: partner already assigned", () => {
  it("persists exactly one notification and sends exactly one targeted event, keeping pickup and ETA behaviour", async () => {
    const w = await assignedWorld();
    const other = await makeRider(0.002);
    const res = await w.status("out of delivery");
    expect(res.status).toBe(200);

    expect(await readyNotes(w.rider.user._id)).toBe(1);
    expect(readyEvents()).toHaveLength(1);
    expect(readyEvents()[0]).toMatchObject({ userId: w.rider.user._id, payload: { orderId: w.orderId, shopOrderId: w.shopOrderId, status: "out of delivery" } });
    expect(emitted.some((e) => e.event === "notification" && e.userId === w.rider.user._id)).toBe(true);
    // nobody else is told: not other riders, not the customer
    expect(readyEvents().every((e) => e.userId === w.rider.user._id)).toBe(true);
    expect(await Notification.countDocuments({ user: other.user._id })).toBe(0);
    expect(JSON.stringify(readyEvents())).not.toMatch(/Street|address|items|subtotal/);
    expect(await Notification.countDocuments({ user: w.customer.user._id, title: "Order out of delivery" })).toBe(1); // customer flow unchanged

    const so = (await Order.findById(w.orderId))!.shopOrders[0]!;
    expect(so.status).toBe("out of delivery");
    expect(so.pickedUpAt).toBeInstanceOf(Date);
    expect(so.eta?.basis).toBe("pickup");
    expect(so.etaAtAssignment?.basis).toBe("assignment");
  });

  it("creates no second dispatch job, assignment or offer, and no other rider gets one", async () => {
    const w = await assignedWorld();
    const other = await makeRider(0.002);
    await w.status("out of delivery");
    await tickAsIs();
    await tickForced();
    expect(await DispatchJob.countDocuments({ order: w.orderId })).toBe(1);
    expect((await jobOf(w))?.status).toBe("assigned");
    expect(await DeliveryAssignment.countDocuments({ shopOrderId: w.shopOrderId })).toBe(1);
    expect(await DeliveryOffer.countDocuments({ shopOrderId: w.shopOrderId })).toBe(1);
    expect(await offerFor(other.cookie)).toBeUndefined();
    expect(emitted.some((e) => e.event === "newAssignment")).toBe(false);
  });

  it("does not repeat the notification or event on duplicate, retried or concurrent status requests", async () => {
    const w = await assignedWorld();
    const results = await Promise.all([w.status("out of delivery"), w.status("out of delivery"), w.status("out of delivery")]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect((await w.status("out of delivery")).status).toBe(409);
    expect(await readyNotes(w.rider.user._id)).toBe(1);
    expect(readyEvents()).toHaveLength(1);
    expect((await Order.findById(w.orderId))!.shopOrders[0]!.status).toBe("out of delivery");
  });

  it("deduplicates by key at the notification layer, so a replayed call cannot double-persist", async () => {
    const user = await createUserWithRole("deliveryBoy");
    const input = { userId: user.user._id, type: "order_status" as const, title: "x", message: "y", dedupeKey: "k1" };
    await notify(input);
    await notify(input);
    await notify({ ...input, dedupeKey: "k2" });
    await notify({ ...input, dedupeKey: undefined });
    await notify({ ...input, dedupeKey: undefined });
    expect(await Notification.countDocuments({ user: user.user._id })).toBe(4); // k1 once, k2 once, two un-keyed
    expect(emitted.filter((e) => e.event === "notification")).toHaveLength(4);
  });

  it("keeps the order lifecycle intact when the socket fails", async () => {
    const w = await assignedWorld();
    failing.event = "deliveryReadyForPickup";
    const res = await w.status("out of delivery");
    expect(res.status).toBe(200);
    const so = (await Order.findById(w.orderId))!.shopOrders[0]!;
    expect(so.status).toBe("out of delivery");
    expect(String(so.assignedDeliveryBoy)).toBe(w.rider.user._id);
    expect(await DeliveryAssignment.countDocuments({ shopOrderId: w.shopOrderId, status: "assigned" })).toBe(1);
    expect(await readyNotes(w.rider.user._id)).toBe(1); // persisted before the event, so the partner still finds it in the app
    expect((await w.status("out of delivery")).status).toBe(409); // and a retry does not re-send
    expect(await readyNotes(w.rider.user._id)).toBe(1);
  });
});

describe("out of delivery: no partner assigned yet", () => {
  it("brings a waiting dispatch job forward, kicks the worker, and offers to the eligible partner immediately", async () => {
    const w = await world();
    await tickAsIs(); // nobody around: the job backs off for the retry delay
    const waiting = await jobOf(w);
    expect(waiting).toMatchObject({ status: "queued", attempts: 0, noCandidateRounds: 1 });
    expect(waiting!.nextRunAt.getTime()).toBeGreaterThan(Date.now() + 30_000);

    const rider = await makeRider();
    const kick = vi.fn();
    registerKick(kick);
    expect((await w.status("out of delivery")).status).toBe(200);
    expect(kick).toHaveBeenCalled();
    expect((await jobOf(w))!.nextRunAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(await DispatchJob.countDocuments({ order: w.orderId })).toBe(1);

    await tickAsIs(); // what the kicked worker runs; retry delay no longer holds the job back
    const offers = await DeliveryOffer.find({ shopOrderId: w.shopOrderId });
    expect(offers).toHaveLength(1);
    expect(String(offers[0]!.partner)).toBe(rider.user._id);
    expect(emitted.filter((e) => e.event === "newAssignment").map((e) => e.userId)).toEqual([rider.user._id]);
    expect(readyEvents()).toHaveLength(0); // no partner yet: nobody gets the ready-for-pickup event
  });

  it("reopens an exhausted dispatch with fresh attempts", async () => {
    const w = await world();
    await DispatchJob.updateOne({ order: w.orderId }, { status: "exhausted", attempts: 10 });
    await w.status("out of delivery");
    expect(await jobOf(w)).toMatchObject({ status: "queued", attempts: 0 });
    expect(await DispatchJob.countDocuments({ order: w.orderId })).toBe(1);
  });

  it("does not disturb a job that holds a live offer", async () => {
    const w = await world();
    const rider = await makeRider();
    await tickForced();
    const before = await jobOf(w);
    expect(before?.status).toBe("waiting_offer");
    await w.status("out of delivery");
    const after = await jobOf(w);
    expect(after).toMatchObject({ status: "waiting_offer", attempts: 1 });
    expect(after!.nextRunAt.getTime()).toBe(before!.nextRunAt.getTime());
    expect(await DeliveryOffer.countDocuments({ shopOrderId: w.shopOrderId })).toBe(1);
    expect(await offerFor(rider.cookie)).toBeTruthy();
  });

  it("keeps the sequential one-offer-at-a-time strategy with two available partners", async () => {
    const w = await world();
    const near = await makeRider(0.001);
    const far = await makeRider(0.01);
    await w.status("out of delivery");
    await tickAsIs();
    expect(await DeliveryOffer.countDocuments({ shopOrderId: w.shopOrderId })).toBe(1);
    expect(await offerFor(near.cookie)).toBeTruthy();
    expect(await offerFor(far.cookie)).toBeUndefined();

    const declined = await request(app).post(`/api/order/decline-offer/${await offerFor(near.cookie)}`).set("Cookie", near.cookie);
    expect(declined.status).toBe(200);
    await tickForced();
    expect(await offerFor(far.cookie)).toBeTruthy();
    expect(await DeliveryOffer.countDocuments({ shopOrderId: w.shopOrderId, status: "PENDING" })).toBe(1);
  });

  it("never offers to busy, offline or stale partners, and makes 'no eligible partner' observable", async () => {
    const w = await world();
    const offline = await makeRider();
    await User.updateOne({ _id: offline.user._id }, { isOnline: false });
    const stale = await makeRider();
    await User.updateOne({ _id: stale.user._id }, { locationUpdatedAt: new Date(Date.now() - 10 * 60_000) });
    const busy = await makeRider();
    await DeliveryAssignment.create({ order: new mongoose.Types.ObjectId(), shopOrderId: new mongoose.Types.ObjectId(), assignedTo: busy.user._id, status: "assigned" }); // busy elsewhere

    await w.status("out of delivery");
    await tickAsIs();
    expect(await DeliveryOffer.countDocuments({})).toBe(0);
    const status = await getDispatchStatus(w.owner.user._id, "owner", w.orderId, w.shopOrderId);
    expect(status.dispatch).toMatchObject({ status: "queued", attempts: 0, noCandidateRounds: 1 });
    expect((status.dispatch as { lastNoCandidateAt: Date }).lastNoCandidateAt).toBeInstanceOf(Date);
    // and the status endpoint exposes it to the owner
    const api = await request(app).get(`/api/order/dispatch-status/${w.orderId}/${w.shopOrderId}`).set("Cookie", w.owner.cookie);
    expect(api.status).toBe(200);
    expect(api.body.dispatch.noCandidateRounds).toBe(1);
  });
});

describe("crash recovery of the pickup notice", () => {
  const noticeOf = async (orderId: string) => (await Order.findById(orderId))!.shopOrders[0]!;
  const dispatchWork = async (w: { orderId: string; shopOrderId: string }) => ({
    jobs: await DispatchJob.countDocuments({ order: w.orderId }),
    offers: await DeliveryOffer.countDocuments({ shopOrderId: w.shopOrderId }),
    assignments: await DeliveryAssignment.countDocuments({ shopOrderId: w.shopOrderId }),
  });
  /** What the status update committed before a crash: the new status and the intent, in one write, nothing else. */
  const commitOnly = (orderId: string) =>
    Order.updateOne(
      { _id: orderId },
      { $set: { "shopOrders.0.status": "out of delivery", "shopOrders.0.pickupNoticeStatus": "pending", "shopOrders.0.pickupNoticeAttempts": 0, "shopOrders.0.pickupNoticeNextAt": new Date() } },
    );
  const later = (ms: number) => new Date(Date.now() + ms);

  it("records the intent in the same atomic write as the status change", async () => {
    const w = await assignedWorld();
    await w.status("out of delivery");
    expect((await noticeOf(w.orderId)).pickupNoticeStatus).toBe("done"); // delivered inline in the normal case
    expect((await noticeOf(w.orderId)).pickupNoticeAttempts).toBe(1);
  });

  it("recovers a crash right after the status commit: the retry gets 409, the worker still delivers exactly once", async () => {
    const w = await assignedWorld();
    await commitOnly(w.orderId); // process died here
    expect((await w.status("out of delivery")).status).toBe(409); // the original gap: a retry cannot help
    expect(await readyNotes(w.rider.user._id)).toBe(0);

    expect(await recoverPickupNotices(later(1000))).toBe(1);
    expect(await readyNotes(w.rider.user._id)).toBe(1);
    expect(readyEvents()).toHaveLength(1);
    expect(readyEvents()[0]!.userId).toBe(w.rider.user._id);
    expect((await noticeOf(w.orderId)).pickupNoticeStatus).toBe("done");

    expect(await recoverPickupNotices(later(60_000))).toBe(0); // nothing left
    expect(await readyNotes(w.rider.user._id)).toBe(1);
    expect(await dispatchWork(w)).toEqual({ jobs: 1, offers: 1, assignments: 1 });
  });

  it("recovers when persisting the notification fails during the request", async () => {
    const w = await assignedWorld();
    const spy = vi.spyOn(Notification, "create").mockRejectedValue(new Error("db blip"));
    expect((await w.status("out of delivery")).status).toBe(200);
    spy.mockRestore();
    expect(await readyNotes(w.rider.user._id)).toBe(0);
    expect((await noticeOf(w.orderId)).pickupNoticeStatus).toBe("pending");

    expect(await recoverPickupNotices(later(10_000))).toBe(1);
    expect(await readyNotes(w.rider.user._id)).toBe(1);
    expect(readyEvents()).toHaveLength(1);
  });

  it("does not duplicate when the crash came after the notification was saved but before it was marked done", async () => {
    const w = await assignedWorld();
    await commitOnly(w.orderId);
    await Notification.create({
      user: w.rider.user._id,
      type: "order_status",
      title: "Order ready for pickup",
      message: "x",
      dedupeKey: `ready-for-pickup:${w.orderId}:${w.shopOrderId}`,
    });
    await recoverPickupNotices(later(1000));
    expect(await readyNotes(w.rider.user._id)).toBe(1);
    expect((await noticeOf(w.orderId)).pickupNoticeStatus).toBe("done");
    expect(readyEvents()).toHaveLength(0); // already announced once; no second live event
  });

  it("is safe with several recovery workers at once", async () => {
    const w = await assignedWorld();
    await commitOnly(w.orderId);
    const t = later(1000);
    await Promise.all([1, 2, 3, 4, 5].map(() => recoverPickupNotices(t)));
    expect(await readyNotes(w.rider.user._id)).toBe(1);
    expect(readyEvents()).toHaveLength(1);
  });

  it("treats a missed live event as recoverable: the persisted notification exists and nothing is re-sent", async () => {
    const w = await assignedWorld();
    await commitOnly(w.orderId);
    failing.event = "deliveryReadyForPickup";
    await recoverPickupNotices(later(1000)); // emit throws, notice still completes
    failing.event = null;
    expect(await readyNotes(w.rider.user._id)).toBe(1);
    expect((await noticeOf(w.orderId)).pickupNoticeStatus).toBe("done");
    await recoverPickupNotices(later(60_000));
    expect(readyEvents()).toHaveLength(0);
    expect(await readyNotes(w.rider.user._id)).toBe(1);
  });

  it("backs off, stays bounded, and gives up after the maximum number of attempts", async () => {
    const w = await assignedWorld();
    await commitOnly(w.orderId);
    const spy = vi.spyOn(Notification, "create").mockRejectedValue(new Error("db down"));
    const t0 = Date.now();
    await recoverPickupNotices(new Date(t0 + 1000));
    expect((await noticeOf(w.orderId)).pickupNoticeAttempts).toBe(1);
    expect(await recoverPickupNotices(new Date(t0 + 2000))).toBe(0); // before the backoff elapses: not retried
    expect((await noticeOf(w.orderId)).pickupNoticeAttempts).toBe(1);
    for (let i = 1; i <= 14; i++) await recoverPickupNotices(new Date(t0 + i * 6 * 60_000));
    spy.mockRestore();
    const n = await noticeOf(w.orderId);
    expect(n.pickupNoticeStatus).toBe("failed");
    expect(n.pickupNoticeAttempts).toBe(10);
    expect(await recoverPickupNotices(new Date(t0 + 24 * 3600_000))).toBe(0);
    expect(await readyNotes(w.rider.user._id)).toBe(0);
    expect(n.status).toBe("out of delivery"); // the order lifecycle was never touched
  });

  it("sends nothing when there is no partner, or the order already moved on, and never creates dispatch work", async () => {
    const w = await assignedWorld(); // created first: its worker pass must not see the second order's job
    const noPartner = await world();
    await commitOnly(noPartner.orderId);
    expect(await deliverPickupNotice(noPartner.orderId, noPartner.shopOrderId, later(1000))).toBe("skipped");
    expect(await Notification.countDocuments({ title: "Order ready for pickup" })).toBe(0);
    expect(await dispatchWork(noPartner)).toMatchObject({ jobs: 1, assignments: 0 });

    await commitOnly(w.orderId);
    await Order.updateOne({ _id: w.orderId }, { $set: { "shopOrders.0.status": "delivered" } });
    expect(await deliverPickupNotice(w.orderId, w.shopOrderId, later(1000))).toBe("skipped");
    expect(await readyNotes(w.rider.user._id)).toBe(0);
    expect(await dispatchWork(w)).toEqual({ jobs: 1, offers: 1, assignments: 1 });
  });

  it("targets only the assigned partner, even if another partner is nearby", async () => {
    const w = await assignedWorld();
    const other = await makeRider(0.0005);
    await commitOnly(w.orderId);
    await recoverPickupNotices(later(1000));
    expect(readyEvents().map((e) => e.userId)).toEqual([w.rider.user._id]);
    expect(await Notification.countDocuments({ user: other.user._id })).toBe(0);
    expect(await offerFor(other.cookie)).toBeUndefined();
  });
});

describe("restaurant marks out of delivery before the partner has accepted (regression)", () => {
  it("tells the partner once they accept, and creates no extra offer, job or assignment", async () => {
    const w = await world();
    const rider = await makeRider(0);
    await tickForced();
    const offerId = (await offerFor(rider.cookie))!;
    expect(offerId).toBeTruthy();

    expect((await w.status("out of delivery")).status).toBe(200); // partner is still only an offer
    expect(await readyNotes(rider.user._id)).toBe(0);
    expect(readyEvents()).toHaveLength(0);

    const accept = () => request(app).post(`/api/order/accept-order/${offerId}`).set("Cookie", rider.cookie);
    expect((await accept()).status).toBe(200);
    expect(await readyNotes(rider.user._id)).toBe(1);
    expect(readyEvents()).toHaveLength(1);
    expect(readyEvents()[0]!.userId).toBe(rider.user._id);

    expect((await accept()).status).toBe(200); // repeated accept is idempotent
    await tickAsIs();
    expect(await readyNotes(rider.user._id)).toBe(1);
    expect(readyEvents()).toHaveLength(1);
    expect(await DeliveryOffer.countDocuments({ shopOrderId: w.shopOrderId })).toBe(1);
    expect(await DeliveryAssignment.countDocuments({ shopOrderId: w.shopOrderId })).toBe(1);
    expect(await DispatchJob.countDocuments({ order: w.orderId })).toBe(1);
    expect((await Order.findById(w.orderId))!.shopOrders[0]!.status).toBe("out of delivery");
  });

  it("does not send the notice when the order is still preparing at acceptance", async () => {
    const w = await world();
    const rider = await makeRider(0);
    await tickForced();
    await request(app).post(`/api/order/accept-order/${await offerFor(rider.cookie)}`).set("Cookie", rider.cookie);
    expect(await readyNotes(rider.user._id)).toBe(0);
    expect(readyEvents()).toHaveLength(0);
    void w;
  });
});
