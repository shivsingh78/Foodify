import type { OrderStatus } from "@foodify/validation";
import { AppError } from "../utils/AppError.js";

/**
 * Allowed transitions of one shop order.
 * `delivered` is intentionally absent from the owner-reachable targets: it can
 * only be reached through delivery-OTP verification (see `completeDelivery`).
 */
const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ["preparing", "cancelled"],
  preparing: ["out of delivery", "cancelled"],
  "out of delivery": ["delivered"],
  delivered: [],
  cancelled: [],
};

export const canTransition = (from: OrderStatus, to: OrderStatus): boolean =>
  TRANSITIONS[from].includes(to);

export const assertTransition = (from: OrderStatus, to: OrderStatus): void => {
  if (!canTransition(from, to)) {
    throw AppError.conflict(`Cannot change order status from "${from}" to "${to}"`, "INVALID_TRANSITION");
  }
};

export const isTerminal = (status: OrderStatus): boolean => TRANSITIONS[status].length === 0;
