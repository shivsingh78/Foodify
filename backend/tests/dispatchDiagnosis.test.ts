import mongoose from "mongoose";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/events/socket.js", () => ({ emitToUser: () => 0, initSocket: vi.fn(), closeSocket: vi.fn(), userRoom: (id: string) => `user:${id}` }));
vi.mock("../src/utils/mail.js", () => ({ sendOtpMail: vi.fn(async () => undefined), sendDeliveryOtpMail: vi.fn(async () => undefined) }));

import { defaultDispatchConfig } from "../src/config/dispatch.js";
import DeliveryAssignment from "../src/models/deliveryAssignment.model.js";
import DeliveryOffer from "../src/models/deliveryOffer.model.js";
import DispatchJob from "../src/models/dispatchJob.model.js";
import Order from "../src/models/order.model.js";
import User from "../src/models/user.model.js";
import { runDispatchTick } from "../src/services/dispatch/dispatch.service.js";
import { startDispatchWorker, stopDispatchWorker } from "../src/services/dispatch/worker.js";
import { address, setupShop } from "./fixtures.js";
import { app, createUserWithRole, useTestDb } from "./helpers.js";

useTestDb();
afterAll(async () => void (await User.createIndexes().catch(() => undefined)));
beforeEach(async () => void (await User.createIndexes()));

const tick = async () => {
  await DispatchJob.updateMany({ status: "queued" }, { nextRunAt: new Date() });
  await runDispatchTick({ ...defaultDispatchConfig(), retryDelayMs: 60_000 });
};
const rider = async (over: Record<string, unknown> = {}, dLat = 0) => {
  const r = await createUserWithRole("deliveryBoy");
  await User.updateOne({ _id: r.user._id }, { isOnline: true, locationUpdatedAt: new Date(), location: { type: "Point", coordinates: [address.longitude, address.latitude + dLat] }, ...over });
  return r;
};
const outForDelivery = async () => {
  const shop = await setupShop();
  const customer = await createUserWithRole("user");
  const placed = await request(app).post("/api/order/place-order").set("Cookie", customer.cookie)
    .send({ paymentMethod: "cod", deliveryAddress: address, cartItems: [{ id: String(shop.items[0]?._id), quantity: 1 }] });
  const orderId = placed.body._id as string;
  const status = (s: string) => request(app).post(`/api/order/update-status/${orderId}/${shop.shop._id}`).set("Cookie", shop.owner.cookie).send({ status: s });
  expect((await status("preparing")).status).toBe(200);
  expect((await status("out of delivery")).status).toBe(200);
  return { ...shop, customer, orderId };
};
const diagnosis = (cookie: string) => request(app).get("/api/order/dispatch-diagnosis").set("Cookie", cookie);

describe("missing geo index on users.location (silent dispatch failure)", () => {
  it("no offer is ever created; the failure is now classified, logged once, and visible in the diagnosis", async () => {
    const r = await rider();
    const w = await outForDelivery();
    await User.collection.dropIndex("location_2dsphere");
    const errors = vi.spyOn(console, "error");

    await tick();
    await tick();
    expect(await DeliveryOffer.countDocuments({})).toBe(0);
    const job = await DispatchJob.findOne({ order: w.orderId }).lean();
    expect(job!.lastError).toMatch(/MongoServerError/);
    expect(job!.failures).toBe(2);
    const lines = errors.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("job_failed"));
    expect(lines).toHaveLength(1); // first failure, not every tick
    expect(JSON.parse(lines[0]!)).toMatchObject({ component: "dispatch", event: "job_failed", hint: "the 2dsphere index on users.location is missing" });
    expect(lines[0]).not.toMatch(/coordinates|73\.85|18\.52/); // no location data leaked from the Mongo message
    errors.mockRestore();

    const owner = await diagnosis(w.owner.cookie);
    expect(owner.status).toBe(200);
    expect(owner.body.usersLocationGeoIndex).toBe(false);
    expect(owner.body.orders[0]).toMatchObject({ orderId: w.orderId, orderStatus: "out of delivery", job: { status: "queued", failures: 2 } });
    expect(owner.body.orders[0].partners).toMatchObject({ total: 1, eligible: 1 }); // the partner WOULD qualify
    const self = await request(app).get("/api/order/my-dispatch-eligibility").set("Cookie", r.cookie);
    expect(self.body.problems).toContain("server_geo_index_missing");

    // restoring the index (what a restart does once the index can be built) unblocks dispatch
    await User.createIndexes();
    await tick();
    expect(await DeliveryOffer.countDocuments({ partner: r.user._id, status: "PENDING" })).toBe(1);
  });
});

describe("geo index health at start-up", () => {
  it("one malformed legacy user location makes the 2dsphere build fail, and the worker reports it at start-up", async () => {
    await User.collection.dropIndex("location_2dsphere");
    await User.collection.insertOne({ fullName: "legacy", email: `legacy${Date.now()}@x.com`, role: "user", location: { type: "Point", coordinates: [] } });
    await expect(User.collection.createIndex({ location: "2dsphere" })).rejects.toThrow(/geo keys|Point/i);

    const errors = vi.spyOn(console, "error");
    startDispatchWorker();
    await new Promise((r) => setTimeout(r, 300));
    stopDispatchWorker();
    const line = errors.mock.calls.map((c) => String(c[0])).find((l) => l.includes("geo_index_missing"));
    errors.mockRestore();
    expect(line).toBeTruthy();
    expect(JSON.parse(line!)).toMatchObject({ component: "dispatch", event: "geo_index_missing" });

    await User.collection.deleteMany({ fullName: "legacy" });
  });
});

describe("dispatch diagnosis from the live database", () => {
  it("explains each partner with the worker's own rules (admin view), and only counts for the owner", async () => {
    const admin = await createUserWithRole("admin");
    const ok = await rider();
    const stale = await rider({ locationUpdatedAt: new Date(Date.now() - 10 * 60_000) });
    const offline = await rider({ isOnline: false });
    const far = await rider({}, 0.2); // ~22 km
    const busy = await rider();
    const neverReported = await createUserWithRole("deliveryBoy");
    await DeliveryAssignment.create({ order: new mongoose.Types.ObjectId(), shopOrderId: new mongoose.Types.ObjectId(), assignedTo: busy.user._id, status: "assigned" });
    const w = await outForDelivery();

    const a = await diagnosis(admin.cookie);
    expect(a.status).toBe(200);
    const mine = a.body.orders.find((o: { orderId: string }) => o.orderId === w.orderId);
    const reason = Object.fromEntries(mine.perPartner.map((p: { partnerId: string; result: string }) => [p.partnerId, p.result]));
    expect(reason).toEqual({
      [ok.user._id]: "eligible",
      [stale.user._id]: "stale_location",
      [offline.user._id]: "offline",
      [far.user._id]: "too_far",
      [busy.user._id]: "at_capacity",
      [neverReported.user._id]: "offline",
    });
    expect(mine.perPartner.find((p: { partnerId: string }) => p.partnerId === far.user._id).distanceKm).toBeGreaterThan(20);
    expect(mine.pickup).toBe("customer_address (shop has no location)");
    expect(a.body.usersLocationGeoIndex).toBe(true);
    expect(a.body.worker).toMatchObject({ enabled: true, running: false });
    expect(a.body.rules).toMatchObject({ maxLocationAgeSeconds: 120, maxPickupDistanceKm: 10, partnerCapacity: 1 });

    const o = await diagnosis(w.owner.cookie);
    expect(o.body.orders).toHaveLength(1);
    expect(o.body.orders[0].perPartner).toBeUndefined();
    expect(o.body.orders[0].partners).toMatchObject({ total: 6, eligible: 1, stale_location: 1, offline: 2, too_far: 1, at_capacity: 1 });
    const body = JSON.stringify(o.body);
    for (const p of [ok, stale, offline, far, busy]) expect(body).not.toContain(p.user._id);
    expect(body).not.toMatch(/73\.85|18\.52|email|mobile|Street/);
  });

  it("reports the live offer and a partner who already holds another offer", async () => {
    const admin = await createUserWithRole("admin");
    const r1 = await rider();
    const w = await outForDelivery();
    await tick();
    const a = await diagnosis(admin.cookie);
    const o = a.body.orders.find((x: { orderId: string }) => x.orderId === w.orderId);
    expect(o.liveOffer).toMatchObject({ partnerId: r1.user._id });
    expect(o.liveOffer.expiresInSeconds).toBeGreaterThan(0);
    expect(o.job).toMatchObject({ status: "waiting_offer", attempts: 1 });

    const w2 = await outForDelivery();
    const second = (await diagnosis(admin.cookie)).body.orders.find((x: { orderId: string }) => x.orderId === w2.orderId);
    expect(second.perPartner.find((p: { partnerId: string }) => p.partnerId === r1.user._id).result).toBe("has_pending_offer_for_another_order");
  });

  it("lets a partner see exactly why they get no offers, without anyone else's data", async () => {
    const busy = await rider();
    await DeliveryAssignment.create({ order: new mongoose.Types.ObjectId(), shopOrderId: new mongoose.Types.ObjectId(), assignedTo: busy.user._id, status: "assigned" });
    const res = await request(app).get("/api/order/my-dispatch-eligibility").set("Cookie", busy.cookie);
    expect(res.status).toBe(200);
    expect(res.body.canReceiveOffers).toBe(false);
    expect(res.body.problems.some((p: string) => p.startsWith("busy_with_an_active_delivery"))).toBe(true);

    const fresh = await rider();
    const ok = await request(app).get("/api/order/my-dispatch-eligibility").set("Cookie", fresh.cookie);
    expect(ok.body).toMatchObject({ canReceiveOffers: true, problems: [], isOnline: true, activeDelivery: null });

    const silent = await createUserWithRole("deliveryBoy");
    const none = await request(app).get("/api/order/my-dispatch-eligibility").set("Cookie", silent.cookie);
    expect(none.body.problems).toEqual(expect.arrayContaining([expect.stringMatching(/^offline/), expect.stringMatching(/^no_location_reported/), expect.stringMatching(/^location_stale/)]));
  });

  it("is restricted: customers and partners cannot read the diagnosis, owners only see their own orders", async () => {
    const w = await outForDelivery();
    const customer = await createUserWithRole("user");
    const r = await rider();
    expect((await diagnosis(customer.cookie)).status).toBe(403);
    expect((await diagnosis(r.cookie)).status).toBe(403);
    expect((await request(app).get("/api/order/dispatch-diagnosis")).status).toBe(401);
    expect((await request(app).get("/api/order/my-dispatch-eligibility").set("Cookie", customer.cookie)).status).toBe(403);
    const otherOwner = await createUserWithRole("owner");
    expect((await diagnosis(otherOwner.cookie)).body.orders).toEqual([]);
    expect((await diagnosis(w.owner.cookie)).body.orders.map((o: { orderId: string }) => o.orderId)).toEqual([w.orderId]);
    void Order;
  });
});
