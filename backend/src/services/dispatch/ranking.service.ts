import type { DispatchConfig } from "../../config/dispatch.js";
import { haversineKm, isValidLonLat, type LonLat } from "../../utils/geoMath.js";
import { computeEta, travelMinutes } from "./eta.service.js";

export interface Candidate {
  id: string;
  role: string;
  /** Socket-connected and reporting. Derived server-side, never from the client. */
  isOnline: boolean;
  location?: unknown;
  locationUpdatedAt?: Date | null;
  activeDeliveries: number;
}

export type RejectionReason =
  | "not_delivery_partner"
  | "excluded"
  | "offline"
  | "invalid_location"
  | "stale_location"
  | "at_capacity"
  | "too_far";

export interface RankedCandidate {
  partnerId: string;
  /** Lower is better. 0 = best conceivable, 1 = every factor at its normaliser. */
  score: number;
  reasons: {
    pickupTravelMinutes: number;
    pickupDistanceKm: number;
    locationAgeSeconds: number;
    activeDeliveries: number;
    /** Minutes the partner would wait for the kitchen. */
    waitAtRestaurantMinutes: number;
    /** Minutes the finished food would wait for the partner. */
    foodWaitingMinutes: number;
    estimatedDeliveryMinutes: number;
    /** Weighted contribution of each factor to `score`. */
    contributions: { travel: number; freshness: number; workload: number; prep: number; delivery: number };
  };
  eta: { partnerArrivalAt: Date; deliveryAt: Date };
}

export interface RankingInput {
  candidates: Candidate[];
  pickup: LonLat;
  dropoff: LonLat;
  readyAt: Date;
  now: Date;
  excluded?: ReadonlySet<string>;
}

export interface RankingResult {
  ranked: RankedCandidate[];
  rejected: { partnerId: string; reason: RejectionReason }[];
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Deterministic eligibility + ranking: identical inputs always give identical output.
 *
 *   score = wT·travel/Nt + wF·age/maxAge + wW·active/capacity + wP·mismatch/Np + wD·deliveryMin/Nd   (each term capped at 1)
 *   mismatch = 0.5·waitAtRestaurant + 1.0·foodWaiting   (arriving late hurts more than arriving early)
 *
 * Weights are normalised to sum to 1. Ties are broken by partner id (ascending).
 */
export const rankCandidates = (input: RankingInput, cfg: DispatchConfig): RankingResult => {
  const { weights: w, normalizers: n } = cfg;
  const wSum = w.travel + w.freshness + w.workload + w.prep + w.delivery;
  const rejected: RankingResult["rejected"] = [];
  const ranked: RankedCandidate[] = [];

  for (const c of input.candidates) {
    const reject = (reason: RejectionReason) => void rejected.push({ partnerId: c.id, reason });
    if (c.role !== "deliveryBoy") { reject("not_delivery_partner"); continue; }
    if (input.excluded?.has(c.id)) { reject("excluded"); continue; }
    if (!c.isOnline) { reject("offline"); continue; }
    if (!isValidLonLat(c.location)) { reject("invalid_location"); continue; }
    const ageMs = c.locationUpdatedAt ? input.now.getTime() - c.locationUpdatedAt.getTime() : Number.POSITIVE_INFINITY;
    // A timestamp in the future means a bad clock or tampering: treat as unusable.
    if (ageMs > cfg.locationMaxAgeMs || ageMs < -5_000) { reject("stale_location"); continue; }
    if (c.activeDeliveries >= cfg.maxActiveDeliveries) { reject("at_capacity"); continue; }
    const distanceKm = haversineKm(c.location, input.pickup);
    if (distanceKm > cfg.maxPickupDistanceKm) { reject("too_far"); continue; }

    const toRestaurant = travelMinutes(c.location, input.pickup, cfg);
    const eta = computeEta({ now: input.now, readyAt: input.readyAt, pickup: input.pickup, dropoff: input.dropoff, partner: c.location }, cfg);
    const arrival = eta.partnerArrivalAt as Date;
    const wait = Math.max(0, (input.readyAt.getTime() - arrival.getTime()) / 60_000);
    const late = Math.max(0, (arrival.getTime() - input.readyAt.getTime()) / 60_000);
    const deliveryMinutes = (eta.deliveryAt.getTime() - input.now.getTime()) / 60_000;
    const ageSeconds = Math.max(0, ageMs) / 1000;

    const contributions = {
      travel: (w.travel / wSum) * clamp01(toRestaurant / n.travelMinutes),
      freshness: (w.freshness / wSum) * clamp01(Math.max(0, ageMs) / cfg.locationMaxAgeMs),
      workload: (w.workload / wSum) * clamp01(c.activeDeliveries / cfg.maxActiveDeliveries),
      prep: (w.prep / wSum) * clamp01((0.5 * wait + 1.0 * late) / n.prepMismatchMinutes),
      delivery: (w.delivery / wSum) * clamp01(deliveryMinutes / n.deliveryMinutes),
    };
    ranked.push({
      partnerId: c.id,
      score: contributions.travel + contributions.freshness + contributions.workload + contributions.prep + contributions.delivery,
      reasons: {
        pickupTravelMinutes: toRestaurant,
        pickupDistanceKm: distanceKm,
        locationAgeSeconds: ageSeconds,
        activeDeliveries: c.activeDeliveries,
        waitAtRestaurantMinutes: wait,
        foodWaitingMinutes: late,
        estimatedDeliveryMinutes: deliveryMinutes,
        contributions,
      },
      eta: { partnerArrivalAt: arrival, deliveryAt: eta.deliveryAt },
    });
  }

  // Float noise must not decide ranking: compare at 1e-9 resolution, then by id.
  ranked.sort((a, b) => Math.round((a.score - b.score) * 1e9) || (a.partnerId < b.partnerId ? -1 : a.partnerId > b.partnerId ? 1 : 0));
  return { ranked, rejected };
};
