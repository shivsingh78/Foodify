import { env } from "./env.js";

/** Tunables for candidate eligibility, ranking and ETA. Read once; tests pass their own copy. */
export interface DispatchConfig {
  offerTimeoutMs: number;
  /** Offers that may be placed for one order (declines and expiries each use one). */
  maxAttempts: number;
  /** Total time dispatch may keep looking for a partner before giving up (reset when the owner retries). */
  maxWaitMs: number;
  retryDelayMs: number;
  locationMaxAgeMs: number;
  maxPickupDistanceKm: number;
  /** Larger limit for partners whose service area matches the restaurant's city/district. */
  serviceAreaMaxDistanceKm: number;
  /** Assumed average speed. An estimate, not measured traffic data. */
  avgSpeedKmh: number;
  /** Straight-line (Haversine) distance is multiplied by this to approximate road distance. */
  routeFactor: number;
  defaultPrepMinutes: number;
  pickupBufferMinutes: number;
  handoffBufferMinutes: number;
  /** Partner capacity. The database allows one active assignment per partner (partial unique index), so this is 1. */
  maxActiveDeliveries: number;
  maxCandidates: number;
  /** Relative weights; normalised to sum to 1. Lower total score = better candidate. */
  weights: { travel: number; freshness: number; workload: number; prep: number; delivery: number };
  /** Values that map each factor onto 0..1 (a factor at its normaliser contributes its full weight). */
  normalizers: { travelMinutes: number; prepMismatchMinutes: number; deliveryMinutes: number };
}

export const defaultDispatchConfig = (): DispatchConfig => ({
  offerTimeoutMs: env.DISPATCH_OFFER_TIMEOUT_SECONDS * 1000,
  maxAttempts: env.DISPATCH_MAX_ATTEMPTS,
  maxWaitMs: env.DISPATCH_MAX_WAIT_MINUTES * 60_000,
  retryDelayMs: env.DISPATCH_RETRY_DELAY_SECONDS * 1000,
  locationMaxAgeMs: env.DISPATCH_LOCATION_MAX_AGE_SECONDS * 1000,
  maxPickupDistanceKm: env.DISPATCH_MAX_PICKUP_DISTANCE_KM,
  serviceAreaMaxDistanceKm: Math.max(env.DISPATCH_SERVICE_AREA_MAX_KM, env.DISPATCH_MAX_PICKUP_DISTANCE_KM),
  avgSpeedKmh: env.DISPATCH_AVG_SPEED_KMH,
  routeFactor: env.DISPATCH_ROUTE_FACTOR,
  defaultPrepMinutes: env.DISPATCH_DEFAULT_PREP_MINUTES,
  pickupBufferMinutes: env.DISPATCH_PICKUP_BUFFER_MINUTES,
  handoffBufferMinutes: env.DISPATCH_HANDOFF_BUFFER_MINUTES,
  maxActiveDeliveries: 1,
  maxCandidates: 50,
  weights: { travel: 0.4, freshness: 0.1, workload: 0.15, prep: 0.2, delivery: 0.15 },
  normalizers: { travelMinutes: 30, prepMismatchMinutes: 15, deliveryMinutes: 60 },
});
