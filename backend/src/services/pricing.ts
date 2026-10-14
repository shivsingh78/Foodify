export const FREE_DELIVERY_THRESHOLD = 500;
export const DELIVERY_FEE = 40;

export const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Mirrors the checkout screen: orders above the threshold ship free. */
export const calculateDeliveryFee = (itemsTotal: number): number =>
  itemsTotal > FREE_DELIVERY_THRESHOLD ? 0 : DELIVERY_FEE;
