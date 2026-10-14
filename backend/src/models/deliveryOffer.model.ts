import mongoose, { type HydratedDocument, type Types } from "mongoose";

/**
 * PENDING → ACCEPTED | DECLINED | EXPIRED | CANCELLED   (all but PENDING are terminal)
 * CANCELLED = the offer became moot (order cancelled/already assigned, partner busy, job closed).
 */
export const OFFER_STATUSES = ["PENDING", "ACCEPTED", "DECLINED", "EXPIRED", "CANCELLED"] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export interface IDeliveryOffer {
  order: Types.ObjectId;
  shopOrderId: Types.ObjectId;
  partner: Types.ObjectId;
  status: OfferStatus;
  /** Dispatch attempt number that created this offer (1-based). */
  round: number;
  expiresAt: Date;
  respondedAt?: Date | null;
  reason?: string | null;
  /** Ranking/ETA snapshot at offer time, for diagnostics and metrics. No addresses or contact details. */
  snapshot?: {
    score: number;
    pickupTravelMinutes: number;
    locationAgeSeconds: number;
    partnerArrivalAt: Date;
    deliveryAt: Date;
  };
  createdAt: Date;
}
export type DeliveryOfferDocument = HydratedDocument<IDeliveryOffer>;

const schema = new mongoose.Schema<IDeliveryOffer>(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true },
    shopOrderId: { type: mongoose.Schema.Types.ObjectId, required: true },
    partner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: OFFER_STATUSES, default: "PENDING", required: true },
    round: { type: Number, required: true },
    expiresAt: { type: Date, required: true },
    respondedAt: { type: Date, default: null },
    reason: { type: String, default: null },
    snapshot: {
      score: Number,
      pickupTravelMinutes: Number,
      locationAgeSeconds: Number,
      partnerArrivalAt: Date,
      deliveryAt: Date,
    },
  },
  { timestamps: true },
);

// At most one live offer per shop order, even if two workers race to create one.
schema.index({ order: 1, shopOrderId: 1 }, { unique: true, partialFilterExpression: { status: "PENDING" } });
// A partner has at most one live offer at a time.
schema.index({ partner: 1 }, { unique: true, partialFilterExpression: { status: "PENDING" } });
schema.index({ status: 1, expiresAt: 1 });
schema.index({ order: 1, shopOrderId: 1, createdAt: -1 });

const DeliveryOffer = mongoose.model<IDeliveryOffer>("DeliveryOffer", schema);
export default DeliveryOffer;
