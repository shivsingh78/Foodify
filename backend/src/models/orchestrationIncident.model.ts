import mongoose, { type HydratedDocument, type Types } from "mongoose";

/**
 * One detected problem with one shop order.
 *
 *   open ──claim──▶ recovering ──attempt done, retries left──▶ open (nextAttemptAt = now + retry delay)
 *                       │──order left "preparing" on its own──▶ recovered   (closed)
 *                       │──order cancelled / missing──────────▶ resolved    (closed, system reason)
 *                       └──attempts exhausted─────────────────▶ escalated   (admins notified once)
 *   escalated ──admin retry──▶ open (one more attempt) · ──admin resolve / order moved on──▶ resolved | recovered
 *
 * `active` is true for open | recovering | escalated and backs the partial unique index, so the same
 * unresolved anomaly can never be recorded twice, even with several workers or after a restart.
 */
export const INCIDENT_STATUSES = ["open", "recovering", "recovered", "escalated", "resolved"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];
export const ANOMALY_TYPES = ["preparation_overdue"] as const;
export type AnomalyType = (typeof ANOMALY_TYPES)[number];

export const HISTORY_EVENTS = [
  "detected",
  "attempt_started",
  "skipped_state_changed",
  "eta_recalculated",
  "eta_skipped",
  "dispatch_enqueued",
  "notified",
  "attempt_failed",
  "retry_scheduled",
  "recovered",
  "escalated",
  "resolved_by_admin",
  "manual_retry",
] as const;
export type HistoryEvent = (typeof HISTORY_EVENTS)[number];

/** Bounded so a long-lived incident can never grow its document without limit. */
export const HISTORY_LIMIT = 50;

export interface IIncidentHistory {
  at: Date;
  event: HistoryEvent;
  /** Short, sanitized, non-personal description. */
  detail?: string;
  /** Admin user id for manual actions. */
  actor?: Types.ObjectId;
}

export interface IOrchestrationIncident {
  order: Types.ObjectId;
  shopOrderId: Types.ObjectId;
  shop?: Types.ObjectId | null;
  anomalyType: AnomalyType;
  status: IncidentStatus;
  active: boolean;
  detectedAt: Date;
  observed: { orderStatus: string; expectedReadyAt?: Date | null; overdueMinutes: number };
  attempts: number;
  /** Attempts allowed before escalation; raised by one for each admin manual retry. */
  attemptLimit: number;
  lastAttemptAt?: Date | null;
  nextAttemptAt: Date;
  lockedBy?: string | null;
  lockedUntil?: Date | null;
  outcome?: string | null;
  failureReason?: string | null;
  /** Each recipient is notified at most once per incident (admins: once per escalation). */
  notified: { owner: boolean; customer: boolean; partner: boolean; admins: boolean };
  escalatedAt?: Date | null;
  escalationReason?: string | null;
  resolvedAt?: Date | null;
  resolvedBy?: Types.ObjectId | null;
  resolutionReason?: string | null;
  history: IIncidentHistory[];
  createdAt: Date;
  updatedAt: Date;
}
export type IncidentDocument = HydratedDocument<IOrchestrationIncident>;

const historySchema = new mongoose.Schema<IIncidentHistory>(
  {
    at: { type: Date, required: true },
    event: { type: String, enum: HISTORY_EVENTS, required: true },
    detail: { type: String, maxlength: 300 },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { _id: false },
);

const schema = new mongoose.Schema<IOrchestrationIncident>(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true },
    shopOrderId: { type: mongoose.Schema.Types.ObjectId, required: true },
    shop: { type: mongoose.Schema.Types.ObjectId, ref: "Shop", default: null },
    anomalyType: { type: String, enum: ANOMALY_TYPES, required: true },
    status: { type: String, enum: INCIDENT_STATUSES, default: "open", required: true },
    active: { type: Boolean, default: true },
    detectedAt: { type: Date, required: true },
    observed: {
      orderStatus: String,
      expectedReadyAt: { type: Date, default: null },
      overdueMinutes: Number,
    },
    attempts: { type: Number, default: 0 },
    attemptLimit: { type: Number, required: true },
    lastAttemptAt: { type: Date, default: null },
    nextAttemptAt: { type: Date, required: true },
    lockedBy: { type: String, default: null },
    lockedUntil: { type: Date, default: null },
    outcome: { type: String, default: null },
    failureReason: { type: String, default: null, maxlength: 300 },
    notified: {
      owner: { type: Boolean, default: false },
      customer: { type: Boolean, default: false },
      partner: { type: Boolean, default: false },
      admins: { type: Boolean, default: false },
    },
    escalatedAt: { type: Date, default: null },
    escalationReason: { type: String, default: null },
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    resolutionReason: { type: String, default: null, maxlength: 500 },
    history: { type: [historySchema], default: [] },
  },
  { timestamps: true },
);

// Deduplication: at most one unresolved incident per anomaly on a shop order.
schema.index({ order: 1, shopOrderId: 1, anomalyType: 1 }, { unique: true, partialFilterExpression: { active: true } });
// Worker claim query and admin listing.
schema.index({ active: 1, status: 1, nextAttemptAt: 1 });
schema.index({ status: 1, createdAt: -1 });

const OrchestrationIncident = mongoose.model<IOrchestrationIncident>("OrchestrationIncident", schema);
export default OrchestrationIncident;
