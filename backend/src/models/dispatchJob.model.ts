import mongoose, { type HydratedDocument, type Types } from "mongoose";

/**
 * Durable dispatch task for one shop order; it doubles as the outbox, so a crash never loses a dispatch.
 *
 * queued ──claim──▶ processing ──offer sent──▶ waiting_offer ──decline/expiry──▶ queued
 *   processing ──▶ assigned | exhausted | cancelled   (terminal; `exhausted` can be reopened by the owner)
 */
export const JOB_STATUSES = ["queued", "processing", "waiting_offer", "assigned", "exhausted", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export interface IDispatchJob {
  order: Types.ObjectId;
  shopOrderId: Types.ObjectId;
  status: JobStatus;
  /** Offers placed so far for this order (the 'dispatch attempts per order' metric). */
  attempts: number;
  nextRunAt: Date;
  lockedBy?: string | null;
  lockedUntil?: Date | null;
  /** Partners that declined or let an offer expire for this order. */
  excludedPartners: Types.ObjectId[];
  readyAt: Date;
  /** Dispatch-start timestamp: the beginning of the "assignment latency" metric. */
  startedAt: Date;
  /** Start of the current search window for DISPATCH_MAX_WAIT_MINUTES; reset when an exhausted dispatch is reopened. */
  windowStartedAt: Date;
  assignedAt?: Date | null;
  assignedTo?: Types.ObjectId | null;
  /** Worker failures (exceptions) for this job; part of the operational metrics. */
  failures: number;
  lastError?: string | null;
  /** Searches that found no eligible partner (observability only; does not count as an offer attempt). */
  noCandidateRounds?: number;
  lastNoCandidateAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
export type DispatchJobDocument = HydratedDocument<IDispatchJob>;

const schema = new mongoose.Schema<IDispatchJob>(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true },
    shopOrderId: { type: mongoose.Schema.Types.ObjectId, required: true },
    status: { type: String, enum: JOB_STATUSES, default: "queued", required: true },
    attempts: { type: Number, default: 0 },
    nextRunAt: { type: Date, required: true },
    lockedBy: { type: String, default: null },
    lockedUntil: { type: Date, default: null },
    excludedPartners: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    readyAt: { type: Date, required: true },
    startedAt: { type: Date, required: true },
    windowStartedAt: { type: Date, required: true },
    assignedAt: { type: Date, default: null },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    failures: { type: Number, default: 0 },
    lastError: { type: String, default: null },
    noCandidateRounds: { type: Number, default: 0 },
    lastNoCandidateAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// One job per shop order: enqueueing twice is a no-op.
schema.index({ order: 1, shopOrderId: 1 }, { unique: true });
// Worker claim query.
schema.index({ status: 1, nextRunAt: 1 });
schema.index({ startedAt: -1 });

const DispatchJob = mongoose.model<IDispatchJob>("DispatchJob", schema);
export default DispatchJob;
