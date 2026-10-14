import type { DispatchConfig } from "../../config/dispatch.js";
import { haversineKm, type LonLat } from "../../utils/geoMath.js";

/**
 * ETA model. No routing API is used: travel time is
 *   haversine distance × routeFactor ÷ averageSpeed
 * so every value here is an ESTIMATE based on assumed speed, not measured traffic.
 */
export const travelMinutes = (from: LonLat, to: LonLat, cfg: Pick<DispatchConfig, "routeFactor" | "avgSpeedKmh">): number =>
  ((haversineKm(from, to) * cfg.routeFactor) / cfg.avgSpeedKmh) * 60;

const addMinutes = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60_000);

export interface EtaInput {
  now: Date;
  /** When the restaurant expects the food to be ready. */
  readyAt: Date;
  pickup: LonLat;
  dropoff: LonLat;
  /** Current partner position; absent when no partner is assigned yet. */
  partner?: LonLat | null;
  /** True once the partner has collected the order: only the last leg remains. */
  pickedUp?: boolean;
}

export interface EtaResult {
  /** Partner reaches the restaurant (null when no partner position is known, or already picked up). */
  partnerArrivalAt: Date | null;
  /** Order is collected: later of partner arrival and food ready, plus a pickup buffer. */
  pickupAt: Date;
  /** Order reaches the customer: pickup + restaurant→customer travel + hand-off buffer. */
  deliveryAt: Date;
  components: {
    partnerToRestaurantMinutes: number | null;
    waitAtRestaurantMinutes: number;
    pickupBufferMinutes: number;
    restaurantToCustomerMinutes: number;
    handoffBufferMinutes: number;
  };
}

export const computeEta = (input: EtaInput, cfg: DispatchConfig): EtaResult => {
  const legMinutes = travelMinutes(input.pickup, input.dropoff, cfg);

  if (input.pickedUp) {
    return {
      partnerArrivalAt: null,
      pickupAt: input.now,
      deliveryAt: addMinutes(input.now, legMinutes + cfg.handoffBufferMinutes),
      components: {
        partnerToRestaurantMinutes: null,
        waitAtRestaurantMinutes: 0,
        pickupBufferMinutes: 0,
        restaurantToCustomerMinutes: legMinutes,
        handoffBufferMinutes: cfg.handoffBufferMinutes,
      },
    };
  }

  const toRestaurant = input.partner ? travelMinutes(input.partner, input.pickup, cfg) : null;
  const partnerArrivalAt = toRestaurant === null ? null : addMinutes(input.now, toRestaurant);
  const earliestAtRestaurant = partnerArrivalAt ?? input.readyAt;
  const pickupStart = new Date(Math.max(earliestAtRestaurant.getTime(), input.readyAt.getTime(), input.now.getTime()));
  const pickupAt = addMinutes(pickupStart, cfg.pickupBufferMinutes);
  return {
    partnerArrivalAt,
    pickupAt,
    deliveryAt: addMinutes(pickupAt, legMinutes + cfg.handoffBufferMinutes),
    components: {
      partnerToRestaurantMinutes: toRestaurant,
      waitAtRestaurantMinutes: Math.max(0, (input.readyAt.getTime() - (partnerArrivalAt ?? input.now).getTime()) / 60_000),
      pickupBufferMinutes: cfg.pickupBufferMinutes,
      restaurantToCustomerMinutes: legMinutes,
      handoffBufferMinutes: cfg.handoffBufferMinutes,
    },
  };
};
