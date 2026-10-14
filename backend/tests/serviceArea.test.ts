import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/events/socket.js", () => ({ emitToUser: () => 0, initSocket: vi.fn(), closeSocket: vi.fn(), userRoom: (id: string) => `user:${id}` }));
vi.mock("../src/utils/mail.js", () => ({ sendOtpMail: vi.fn(async () => undefined), sendDeliveryOtpMail: vi.fn(async () => undefined) }));

import { defaultDispatchConfig } from "../src/config/dispatch.js";
import DeliveryOffer from "../src/models/deliveryOffer.model.js";
import DispatchJob from "../src/models/dispatchJob.model.js";
import Order from "../src/models/order.model.js";
import User from "../src/models/user.model.js";
import { runDispatchTick } from "../src/services/dispatch/dispatch.service.js";
import { partnerDistanceLimitKm, rankCandidates, serviceAreaCovers } from "../src/services/dispatch/ranking.service.js";
import { address, setupShop } from "./fixtures.js";
import { app, createUserWithRole, useTestDb } from "./helpers.js";

useTestDb();

describe("service area matching", () => {
  it("matches the restaurant's city as whole words, case- and punctuation-insensitive", () => {
    expect(serviceAreaCovers("Bhopal", "Bhopal")).toBe(true);
    expect(serviceAreaCovers("Arera Colony, Bhopal", "bhopal")).toBe(true);
    expect(serviceAreaCovers("bhopal district", "Bhopal ")).toBe(true);
    expect(serviceAreaCovers("New Delhi", "Delhi")).toBe(true);
    expect(serviceAreaCovers("Indore", "Bhopal")).toBe(false);
    expect(serviceAreaCovers("Bhopalpur", "Bhopal")).toBe(false);
    for (const [a, c] of [["", "Bhopal"], ["Bhopal", ""], [undefined, "Bhopal"], ["Bhopal", null]]) expect(serviceAreaCovers(a, c)).toBe(false);
  });

  it("gives service-area partners the larger distance limit, everyone else the normal one", () => {
    const cfg = { maxPickupDistanceKm: 10, serviceAreaMaxDistanceKm: 50 };
    expect(partnerDistanceLimitKm("Bhopal", "Bhopal", cfg)).toBe(50);
    expect(partnerDistanceLimitKm("Indore", "Bhopal", cfg)).toBe(10);
    expect(partnerDistanceLimitKm(undefined, "Bhopal", cfg)).toBe(10);
  });

  it("ranking applies each partner's own limit and still prefers the closer partner", () => {
    const now = new Date();
    const base = { role: "deliveryBoy", isOnline: true, locationUpdatedAt: now, activeDeliveries: 0 };
    const { ranked, rejected } = rankCandidates(
      {
        candidates: [
          { ...base, id: "cityFar", location: [73.85, 18.72], maxDistanceKm: 50 }, // ~22 km, covers the city
          { ...base, id: "plainFar", location: [73.85, 18.72] }, // ~22 km, no service area match
          { ...base, id: "near", location: [73.85, 18.53] },
        ],
        pickup: [73.85, 18.52],
        dropoff: [73.86, 18.52],
        readyAt: now,
        now,
      },
      defaultDispatchConfig(),
    );
    expect(ranked.map((r) => r.partnerId)).toEqual(["near", "cityFar"]);
    expect(rejected).toEqual([{ partnerId: "plainFar", reason: "too_far" }]);
  });
});

const rider = async (dLat: number, serviceArea?: string) => {
  const r = await createUserWithRole("deliveryBoy");
  await User.updateOne(
    { _id: r.user._id },
    { isOnline: true, locationUpdatedAt: new Date(), location: { type: "Point", coordinates: [address.longitude, address.latitude + dLat] }, ...(serviceArea && { deliveryProfile: { serviceArea } }) },
  );
  return r;
};
const world = async () => {
  const shop = await setupShop("Pune");
  const customer = await createUserWithRole("user");
  const placed = await request(app).post("/api/order/place-order").set("Cookie", customer.cookie)
    .send({ paymentMethod: "cod", deliveryAddress: address, cartItems: [{ id: String(shop.items[0]?._id), quantity: 1 }] });
  const orderId = placed.body._id as string;
  const shopOrderId = String((await Order.findById(orderId))!.shopOrders[0]!._id);
  const status = (s: string) => request(app).post(`/api/order/update-status/${orderId}/${shop.shop._id}`).set("Cookie", shop.owner.cookie).send({ status: s });
  const summary = (cookie = shop.owner.cookie) => request(app).get(`/api/order/dispatch-summary/${orderId}/${shopOrderId}`).set("Cookie", cookie);
  expect((await status("preparing")).status).toBe(200);
  return { ...shop, customer, orderId, shopOrderId, status, summary };
};
const tick = async () => {
  await DispatchJob.updateMany({ status: "queued" }, { nextRunAt: new Date() });
  await runDispatchTick(defaultDispatchConfig());
};

describe("dispatch with service areas", () => {
  it("offers to a partner ~22 km away whose service area is the restaurant's city", async () => {
    const cityPartner = await rider(0.2, "Shivaji Nagar, Pune");
    await world();
    await tick();
    const offers = await DeliveryOffer.find({}).lean();
    expect(offers.map((o) => String(o.partner))).toEqual([cityPartner.user._id]);
  });

  it("does not offer to a partner that far away without a matching service area, or beyond the safety cap", async () => {
    await rider(0.2, "Mumbai");
    await rider(0.2);
    await rider(0.6, "Pune"); // ~67 km: beyond DISPATCH_SERVICE_AREA_MAX_KM (50)
    const w = await world();
    await tick();
    expect(await DeliveryOffer.countDocuments({})).toBe(0);
    expect((await DispatchJob.findOne({ order: w.orderId }).lean())!.noCandidateRounds).toBe(1);
  });

  it("a nearby partner still gets the first offer, one at a time", async () => {
    await rider(0.2, "Pune");
    const near = await rider(0.002);
    await world();
    await tick();
    const offers = await DeliveryOffer.find({}).lean();
    expect(offers).toHaveLength(1);
    expect(String(offers[0]!.partner)).toBe(near.user._id);
  });
});

describe("restaurant order card summary", () => {
  it("shows counts and offer state only, to the shop's owner only", async () => {
    await rider(0.002);
    await rider(0.2, "Pune");
    await rider(0.2, "Mumbai"); // not available
    const w = await world();

    const before = await w.summary();
    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({ orderStatus: "preparing", assigned: false, searching: true, availablePartners: 2, offerPending: false, offerExpiresInSeconds: null });

    await tick();
    const after = await w.summary();
    expect(after.body).toMatchObject({ availablePartners: 2, offerPending: true });
    expect(after.body.offerExpiresInSeconds).toBeGreaterThan(0);
    expect(JSON.stringify(after.body)).not.toMatch(/fullName|mobile|email|partnerId|coordinates|[0-9a-f]{24}/);

    expect((await w.summary(w.customer.cookie)).status).toBe(403);
    const otherOwner = await createUserWithRole("owner");
    expect((await w.summary(otherOwner.cookie)).status).toBe(404);
  });
});
