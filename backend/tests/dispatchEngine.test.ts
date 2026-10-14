import { describe, expect, it } from "vitest";
import { defaultDispatchConfig, type DispatchConfig } from "../src/config/dispatch.js";
import { computeEta, travelMinutes } from "../src/services/dispatch/eta.service.js";
import { rankCandidates, type Candidate } from "../src/services/dispatch/ranking.service.js";
import { percentile } from "../src/services/dispatch/metrics.service.js";
import { haversineKm, isValidLonLat } from "../src/utils/geoMath.js";

const now = new Date("2026-01-01T12:00:00Z");
const pickup: [number, number] = [73.85, 18.52];
const dropoff: [number, number] = [73.9, 18.52]; // ~5.3 km east
const at = (dLat: number): [number, number] => [73.85, 18.52 + dLat]; // 0.01° ≈ 1.11 km
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

const cfg = (over: Partial<DispatchConfig> = {}): DispatchConfig => ({
  ...defaultDispatchConfig(),
  avgSpeedKmh: 20,
  routeFactor: 1.3,
  locationMaxAgeMs: 120_000,
  maxPickupDistanceKm: 5,
  maxActiveDeliveries: 1,
  pickupBufferMinutes: 3,
  handoffBufferMinutes: 3,
  ...over,
});
const cand = (id: string, over: Partial<Candidate> = {}): Candidate => ({
  id, role: "deliveryBoy", isOnline: true, location: at(0.01), locationUpdatedAt: new Date(now.getTime() - 10_000), activeDeliveries: 0, ...over,
});
const readyAt = new Date(now.getTime() + 10 * 60_000);
const rank = (candidates: Candidate[], c = cfg(), excluded?: Set<string>) =>
  rankCandidates({ candidates, pickup, dropoff, readyAt, now, excluded }, c);
const only = (key: keyof DispatchConfig["weights"]): DispatchConfig["weights"] => ({ travel: 0, freshness: 0, workload: 0, prep: 0, delivery: 0, [key]: 1 });

describe("geo math", () => {
  it("computes distances and validates coordinates", () => {
    expect(haversineKm([73.85, 18.52], [73.85, 18.53])).toBeCloseTo(1.112, 2);
    expect(isValidLonLat([73.85, 18.52])).toBe(true);
    for (const bad of [undefined, null, [0, 0], [NaN, 1], [181, 0], [0, 91], [1], "x"]) expect(isValidLonLat(bad)).toBe(false);
  });
});

describe("candidate eligibility", () => {
  it("rejects offline, wrong-role, invalid-location, stale, at-capacity, too-far and excluded partners", () => {
    const { ranked, rejected } = rank(
      [
        cand("ok"),
        cand("offline", { isOnline: false }),
        cand("customer", { role: "user" }),
        cand("nocoords", { location: undefined }),
        cand("zero", { location: [0, 0] }),
        cand("nan", { location: [NaN, 1] }),
        cand("stale", { locationUpdatedAt: minutesAgo(10) }),
        cand("neverReported", { locationUpdatedAt: null }),
        cand("future", { locationUpdatedAt: new Date(now.getTime() + 3_600_000) }),
        cand("busy", { activeDeliveries: 1 }),
        cand("far", { location: at(0.1) }),
        cand("declined"),
      ],
      cfg(),
      new Set(["declined"]),
    );
    expect(ranked.map((r) => r.partnerId)).toEqual(["ok"]);
    const reason = Object.fromEntries(rejected.map((r) => [r.partnerId, r.reason]));
    expect(reason).toEqual({
      offline: "offline", customer: "not_delivery_partner", nocoords: "invalid_location", zero: "invalid_location", nan: "invalid_location",
      stale: "stale_location", neverReported: "stale_location", future: "stale_location", busy: "at_capacity", far: "too_far", declined: "excluded",
    });
  });

  it("returns an empty ranking when nobody is eligible", () => {
    expect(rank([cand("a", { isOnline: false }), cand("b", { locationUpdatedAt: minutesAgo(30) })]).ranked).toEqual([]);
    expect(rank([]).ranked).toEqual([]);
  });
});

describe("ranking score (lower is better)", () => {
  it("prefers the closer partner when everything else is equal", () => {
    const { ranked } = rank([cand("far", { location: at(0.03) }), cand("near", { location: at(0.005) })]);
    expect(ranked.map((r) => r.partnerId)).toEqual(["near", "far"]);
    expect(ranked[0]!.score).toBeLessThan(ranked[1]!.score);
  });

  it("is deterministic regardless of input order, with ties broken by partner id", () => {
    const pool = [cand("c"), cand("a"), cand("b"), cand("d", { location: at(0.02) })];
    const first = rank(pool).ranked.map((r) => [r.partnerId, r.score]);
    for (const shuffled of [[...pool].reverse(), [pool[2], pool[0], pool[3], pool[1]] as Candidate[]]) {
      expect(rank(shuffled).ranked.map((r) => [r.partnerId, r.score])).toEqual(first);
    }
    expect(first.slice(0, 3).map((r) => r[0])).toEqual(["a", "b", "c"]); // identical scores → id order
  });

  it("responds to travel time", () => {
    const c = cfg({ weights: only("travel") });
    const [a, b] = [rank([cand("x", { location: at(0.01) })], c).ranked[0]!, rank([cand("x", { location: at(0.03) })], c).ranked[0]!];
    expect(b.score).toBeGreaterThan(a.score);
    expect(a.reasons.pickupTravelMinutes).toBeCloseTo(travelMinutes(at(0.01), pickup, c), 5);
  });

  it("responds to location freshness", () => {
    const c = cfg({ weights: only("freshness") });
    const fresh = rank([cand("x", { locationUpdatedAt: new Date(now.getTime() - 5_000) })], c).ranked[0]!;
    const older = rank([cand("x", { locationUpdatedAt: new Date(now.getTime() - 90_000) })], c).ranked[0]!;
    expect(older.score).toBeGreaterThan(fresh.score);
    expect(older.reasons.locationAgeSeconds).toBe(90);
  });

  it("responds to workload (when capacity allows more than one delivery)", () => {
    const c = cfg({ weights: only("workload"), maxActiveDeliveries: 3 });
    const idle = rank([cand("x", { activeDeliveries: 0 })], c).ranked[0]!;
    const loaded = rank([cand("x", { activeDeliveries: 2 })], c).ranked[0]!;
    expect(loaded.score).toBeGreaterThan(idle.score);
  });

  it("responds to preparation timing: arriving just as food is ready beats arriving far too early", () => {
    const c = cfg({ weights: only("prep") });
    // readyAt is 10 min away. ~2.6 km ≈ 10 min of travel; 0.1 km ≈ 0.4 min.
    const justInTime = rank([cand("jit", { location: at(0.0231) })], c).ranked[0]!;
    const tooEarly = rank([cand("early", { location: at(0.001) })], c).ranked[0]!;
    expect(tooEarly.reasons.waitAtRestaurantMinutes).toBeGreaterThan(8);
    expect(justInTime.reasons.waitAtRestaurantMinutes).toBeLessThan(1);
    expect(tooEarly.score).toBeGreaterThan(justInTime.score);
    // and arriving late (food waiting) is penalised harder than waiting
    const late = rank([cand("late", { location: at(0.045) })], { ...c, maxPickupDistanceKm: 10 }).ranked[0]!; // ~4.9 km ≈ 19 min
    expect(late.reasons.foodWaitingMinutes).toBeGreaterThan(8);
    expect(late.score).toBeGreaterThan(tooEarly.score);
  });

  it("responds to estimated end-to-end delivery time", () => {
    const c = cfg({ weights: only("delivery") });
    const quick = rankCandidates({ candidates: [cand("x")], pickup, dropoff: [73.86, 18.52], readyAt, now }, c).ranked[0]!;
    const slow = rankCandidates({ candidates: [cand("x")], pickup, dropoff: [73.95, 18.52], readyAt, now }, c).ranked[0]!;
    expect(slow.score).toBeGreaterThan(quick.score);
  });

  it("explains itself: contributions add up to the score", () => {
    const r = rank([cand("x")]).ranked[0]!;
    const sum = Object.values(r.reasons.contributions).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(r.score, 12);
    expect(r.eta.deliveryAt.getTime()).toBeGreaterThan(r.eta.partnerArrivalAt.getTime());
  });
});

describe("ETA engine", () => {
  const c = cfg();
  it("separates partner arrival, pickup and customer delivery", () => {
    const e = computeEta({ now, readyAt, pickup, dropoff, partner: at(0.01) }, c);
    const toRest = travelMinutes(at(0.01), pickup, c);
    const leg = travelMinutes(pickup, dropoff, c);
    expect(e.partnerArrivalAt!.getTime()).toBeCloseTo(now.getTime() + toRest * 60_000, -1);
    // food is not ready for 10 min, so pickup waits for the kitchen (+3 min buffer)
    expect(e.pickupAt.getTime()).toBe(readyAt.getTime() + 3 * 60_000);
    expect(e.deliveryAt.getTime()).toBeCloseTo(e.pickupAt.getTime() + (leg + 3) * 60_000, -2);
    expect(e.components.waitAtRestaurantMinutes).toBeCloseTo(10 - toRest, 3);
  });

  it("waits for the partner when they arrive after the food is ready", () => {
    const e = computeEta({ now, readyAt: now, pickup, dropoff, partner: at(0.03) }, c);
    expect(e.pickupAt.getTime()).toBe(e.partnerArrivalAt!.getTime() + 3 * 60_000);
    expect(e.components.waitAtRestaurantMinutes).toBe(0);
  });

  it("works without a known partner position and after pickup", () => {
    const noPartner = computeEta({ now, readyAt, pickup, dropoff }, c);
    expect(noPartner.partnerArrivalAt).toBeNull();
    expect(noPartner.pickupAt.getTime()).toBe(readyAt.getTime() + 3 * 60_000);
    const picked = computeEta({ now, readyAt, pickup, dropoff, pickedUp: true }, c);
    expect(picked.pickupAt).toEqual(now);
    expect(picked.deliveryAt.getTime()).toBeCloseTo(now.getTime() + (travelMinutes(pickup, dropoff, c) + 3) * 60_000, -2);
  });

  it("scales with the configured speed model", () => {
    const slow = computeEta({ now, readyAt: now, pickup, dropoff }, cfg({ avgSpeedKmh: 10 }));
    const fast = computeEta({ now, readyAt: now, pickup, dropoff }, cfg({ avgSpeedKmh: 40 }));
    expect(slow.deliveryAt.getTime()).toBeGreaterThan(fast.deliveryAt.getTime());
  });
});

describe("percentile", () => {
  it("uses nearest-rank on sorted data", () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(xs, 50)).toBe(5);
    expect(percentile(xs, 95)).toBe(10);
    expect(percentile([], 50)).toBeNull();
  });
});
