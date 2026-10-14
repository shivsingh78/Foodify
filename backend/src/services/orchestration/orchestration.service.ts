import { randomUUID } from "node:crypto";
import { buildPaginationMeta } from "@foodify/validation";
import { Types, type UpdateQuery } from "mongoose";
import { defaultDispatchConfig } from "../../config/dispatch.js";
import { defaultOrchestrationConfig, type OrchestrationConfig } from "../../config/orchestration.js";
import { emitToUser } from "../../events/socket.js";
import DeliveryAssignment from "../../models/deliveryAssignment.model.js";
import DispatchJob from "../../models/dispatchJob.model.js";
import Order, { type IShopOrder } from "../../models/order.model.js";
import OrchestrationIncident, {
  HISTORY_LIMIT,
  type HistoryEvent,
  type IOrchestrationIncident,
  type IncidentDocument,
} from "../../models/orchestrationIncident.model.js";
import OrchestrationState, { STATE_ID } from "../../models/orchestrationState.model.js";
import Shop from "../../models/shop.model.js";
import User from "../../models/user.model.js";
import { AppError } from "../../utils/AppError.js";
import { enqueueDispatch, recomputeEtaForDelay } from "../dispatch/dispatch.service.js";
import { notify } from "../notification.service.js";
import { logEvent, sanitizeError } from "./log.js";
import { metrics } from "./metrics.js";

const ANOMALY = "preparation_overdue" as const;
const id = (v: unknown) => String(v);
const isDuplicateKey = (e: unknown) => typeof e === "object" && e !== null && "code" in e && e.code === 11000;

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const historyEntry = (event: HistoryEvent, detail?: string, actor?: string) => ({
  at: new Date(),
  event,
  ...(detail && { detail: detail.slice(0, 300) }),
  ...(actor && { actor: new Types.ObjectId(actor) }),
});

/** `$push` that keeps only the newest HISTORY_LIMIT entries. */
const pushHistory = (...entries: ReturnType<typeof historyEntry>[]) => ({ $push: { history: { $each: entries, $slice: -HISTORY_LIMIT } } });

/**
 * When the food was expected to be ready: the owner's estimate (`readyAt`), or for orders created before it was
 * stored, the preparation start plus the default preparation time.
 */
export const expectedReadyAt = (so: Pick<IShopOrder, "readyAt" | "preparingAt">): Date | null => {
  if (so.readyAt) return so.readyAt;
  if (so.preparingAt) return new Date(so.preparingAt.getTime() + defaultDispatchConfig().defaultPrepMinutes * 60_000);
  return null;
};

/** Minutes past the expected ready time, or null when the shop order is not a stuck-preparation candidate. */
export const overdueMinutes = (
  so: Pick<IShopOrder, "status" | "readyAt" | "preparingAt" | "pickedUpAt">,
  now: Date,
  cfg: Pick<OrchestrationConfig, "preparationTimeoutMs">,
  /** Activation baseline: orders expected ready before it are pre-existing and not handled automatically. */
  baseline?: Date,
): number | null => {
  if (so.status !== "preparing" || so.pickedUpAt) return null;
  const ready = expectedReadyAt(so);
  if (!ready) return null;
  if (baseline && ready < baseline) return null;
  const overdueMs = now.getTime() - ready.getTime();
  return overdueMs >= cfg.preparationTimeoutMs ? Math.floor(overdueMs / 60_000) : null;
};

/* ------------------------------------------------------------------ */
/* Notifications and real-time events                                  */
/* ------------------------------------------------------------------ */

/** Flips a per-recipient flag exactly once, atomically; only the caller that flipped it may send. */
const claimNotification = async (incidentId: unknown, who: keyof IOrchestrationIncident["notified"]): Promise<boolean> => {
  const r = await OrchestrationIncident.updateOne({ _id: incidentId, [`notified.${who}`]: false }, { $set: { [`notified.${who}`]: true } });
  return r.modifiedCount === 1;
};

const adminIds = async (): Promise<string[]> => (await User.find({ role: "admin" }).select("_id").limit(50).lean()).map((a) => id(a._id));

/** Socket events carry ids and states only; a socket failure can never repeat a recovery action. */
const emitSafe = (userIds: string[], event: string, payload: Record<string, unknown>) => {
  for (const userId of new Set(userIds)) {
    try {
      emitToUser(userId, event, payload);
    } catch {
      /* real-time delivery is best effort; the database is the source of truth */
    }
  }
};

const eventPayload = (incident: Pick<IncidentDocument, "_id" | "order" | "shopOrderId" | "status" | "attempts">) => ({
  incidentId: id(incident._id),
  orderId: id(incident.order),
  shopOrderId: id(incident.shopOrderId),
  anomalyType: ANOMALY,
  status: incident.status,
  attempts: incident.attempts,
});

/* ------------------------------------------------------------------ */
/* Detection                                                           */
/* ------------------------------------------------------------------ */

let scanCursor: Types.ObjectId | null = null;
const MAX_BATCHES_PER_SCAN = 20;

/**
 * Finds shop orders stuck in preparation and records one incident for each. Orders are read in `_id` order,
 * `batchSize` at a time, resuming after the last order seen so a large backlog cannot starve newer orders.
 * Idempotent: the partial unique index makes a repeated or concurrent scan a no-op for known incidents.
 */
export const detectOverdueOrders = async (cfg: OrchestrationConfig, now: Date, baseline: Date): Promise<number> => {
  const readyCutoff = new Date(now.getTime() - cfg.preparationTimeoutMs);
  const defaultPrepMs = defaultDispatchConfig().defaultPrepMinutes * 60_000;
  const legacyCutoff = new Date(readyCutoff.getTime() - defaultPrepMs);
  let created = 0;

  for (let batch = 0; batch < MAX_BATCHES_PER_SCAN; batch++) {
    const orders = await Order.find({
      ...(scanCursor && { _id: { $gt: scanCursor } }),
      shopOrders: {
        $elemMatch: {
          status: "preparing",
          pickedUpAt: null,
          $or: [
            { readyAt: { $gte: baseline, $lte: readyCutoff } },
            { readyAt: null, preparingAt: { $gte: new Date(baseline.getTime() - defaultPrepMs), $lte: legacyCutoff } },
          ],
        },
      },
    })
      .sort({ _id: 1 })
      .limit(cfg.batchSize)
      .select("shopOrders._id shopOrders.shop shopOrders.owner shopOrders.status shopOrders.readyAt shopOrders.preparingAt shopOrders.pickedUpAt")
      .lean();

    for (const order of orders) {
      for (const so of order.shopOrders) {
        const overdue = overdueMinutes(so, now, cfg, baseline);
        if (overdue === null) continue;
        if (await createIncident(order._id, so, overdue, cfg, now)) created++;
      }
    }
    if (orders.length < cfg.batchSize) {
      scanCursor = null; // reached the end: next scan starts over
      break;
    }
    scanCursor = orders[orders.length - 1]!._id as Types.ObjectId;
  }
  metrics.inc("scans");
  return created;
};

/** Returns true only for the caller that actually created the incident. */
const createIncident = async (orderId: Types.ObjectId, so: Pick<IShopOrder, "_id" | "shop" | "owner" | "status" | "readyAt" | "preparingAt">, overdue: number, cfg: OrchestrationConfig, now: Date, origin?: { actor: string }): Promise<boolean> => {
  const ready = expectedReadyAt(so);
  let upsertedId: unknown;
  try {
    const r = await OrchestrationIncident.updateOne(
      { order: orderId, shopOrderId: so._id, anomalyType: ANOMALY, active: true },
      {
        $setOnInsert: {
          shop: so.shop,
          status: "open",
          detectedAt: now,
          observed: { orderStatus: so.status, expectedReadyAt: ready, overdueMinutes: overdue },
          attempts: 0,
          attemptLimit: cfg.maxRecoveryAttempts,
          nextAttemptAt: now,
          notified: { owner: false, customer: false, partner: false, admins: false },
          history: [historyEntry("detected", origin ? `added from the pre-activation backlog; ${overdue} min overdue` : `preparation exceeded expected time by ${overdue} min`, origin?.actor)],
        },
      },
      { upsert: true },
    );
    if (r.upsertedCount !== 1) return false;
    upsertedId = r.upsertedId;
  } catch (error) {
    if (isDuplicateKey(error)) return false; // a concurrent scan created it first
    throw error;
  }
  metrics.inc("anomaliesDetected");
  logEvent("anomaly_detected", { orderId: id(orderId), shopOrderId: id(so._id), anomalyType: ANOMALY, overdueMinutes: overdue });
  emitSafe([...(so.owner ? [id(so.owner)] : []), ...(await adminIds())], "orderAnomalyDetected", {
    incidentId: id(upsertedId),
    orderId: id(orderId),
    shopOrderId: id(so._id),
    anomalyType: ANOMALY,
    status: "open",
    attempts: 0,
  });
  return true;
};

/* ------------------------------------------------------------------ */
/* Recovery                                                            */
/* ------------------------------------------------------------------ */

const claimNextIncident = (token: string, now: Date, leaseMs: number) =>
  OrchestrationIncident.findOneAndUpdate(
    {
      active: true,
      $or: [{ status: "open", nextAttemptAt: { $lte: now } }, { status: "recovering", lockedUntil: { $lt: now } }], // second: a crashed worker's lease expired
    },
    // Counting the attempt at claim time bounds retries even if a worker crashes mid-attempt.
    { $set: { status: "recovering", lockedBy: token, lockedUntil: new Date(now.getTime() + leaseMs), lastAttemptAt: now }, $inc: { attempts: 1 } },
    { new: true, sort: { nextAttemptAt: 1 } },
  );

const closeIncident = async (
  incident: IncidentDocument,
  filter: Record<string, unknown>,
  status: "recovered" | "resolved",
  outcome: string,
  history: ReturnType<typeof historyEntry>[],
  now: Date,
  extra: Record<string, unknown> = {},
): Promise<boolean> => {
  const r = await OrchestrationIncident.updateOne(
    { _id: incident._id, active: true, ...filter },
    { $set: { status, active: false, outcome, resolvedAt: now, lockedBy: null, lockedUntil: null, ...extra }, ...pushHistory(...history) },
  );
  return r.modifiedCount === 1;
};

/** The order left "preparing" without our help (or never will): close the incident and touch nothing else. */
const closeBecauseOrderChanged = async (incident: IncidentDocument, filter: Record<string, unknown>, status: string | undefined, now: Date): Promise<void> => {
  const progressed = status === "out of delivery" || status === "delivered";
  const closed = await closeIncident(
    incident,
    filter,
    progressed ? "recovered" : "resolved",
    progressed ? "order_progressed" : "order_closed",
    [historyEntry("skipped_state_changed", `order is now "${status ?? "missing"}"; no action taken`), ...(progressed ? [historyEntry("recovered", "order moved on by itself")] : [])],
    now,
    progressed ? {} : { resolutionReason: "Order cancelled or no longer exists (closed automatically)" },
  );
  if (!closed) return;
  metrics.inc("skippedStateChanged");
  if (progressed) {
    metrics.inc("recovered");
    metrics.recordRecoveryLatency(now.getTime() - incident.detectedAt.getTime());
    const owner = (await Order.findById(incident.order).select("shopOrders._id shopOrders.owner").lean())?.shopOrders.find((s) => id(s._id) === id(incident.shopOrderId))?.owner;
    emitSafe([...(owner ? [id(owner)] : []), ...(await adminIds())], "orderRecoverySucceeded", eventPayload({ ...incident.toObject(), _id: incident._id, status: "recovered" } as IncidentDocument));
  }
  logEvent("incident_closed", { incidentId: id(incident._id), orderStatus: status ?? "missing", outcome: progressed ? "recovered" : "resolved" });
};

const escalate = async (incident: IncidentDocument, token: string, reason: string, cfg: OrchestrationConfig, now: Date): Promise<void> => {
  const r = await OrchestrationIncident.updateOne(
    { _id: incident._id, active: true, status: "recovering", lockedBy: token },
    {
      $set: { status: "escalated", escalatedAt: now, escalationReason: reason, outcome: "escalated", lockedBy: null, lockedUntil: null, nextAttemptAt: new Date(now.getTime() + cfg.escalatedWatchMs) },
      ...pushHistory(historyEntry("escalated", reason)),
    },
  );
  if (r.modifiedCount !== 1) return; // lost the lease; whoever holds it decides
  metrics.inc("escalated");
  logEvent("incident_escalated", { incidentId: id(incident._id), orderId: id(incident.order), attempts: incident.attempts, reason });
  await notifyAdminsOnce(incident, reason);
};

/** Admins are told once per escalation, even if this runs twice. */
const notifyAdminsOnce = async (incident: Pick<IncidentDocument, "_id" | "order" | "shopOrderId" | "attempts">, reason: string): Promise<void> => {
  if (!(await claimNotification(incident._id, "admins"))) return;
  const admins = await adminIds();
  if (admins.length === 0) logEvent("no_admins_to_notify", { incidentId: id(incident._id) }, "warn");
  for (const adminId of admins) {
    await notify({
      userId: adminId,
      type: "incident_escalated",
      title: "Order needs attention",
      message: `An order has been in preparation far longer than expected and automatic recovery did not help (${reason}).`,
      orderId: incident.order as Types.ObjectId,
      shopOrderId: incident.shopOrderId as Types.ObjectId,
    });
  }
  await OrchestrationIncident.updateOne({ _id: incident._id }, pushHistory(historyEntry("notified", `admins (${admins.length})`)));
  emitSafe(admins, "orderIncidentEscalated", { ...eventPayload({ ...incident, status: "escalated" } as IncidentDocument) });
};

/** First attempt only: tell the people involved once, in the app's existing notification channel. */
const notifyStakeholders = async (incident: IncidentDocument, orderUser: Types.ObjectId, so: IShopOrder, etaUpdated: boolean): Promise<string[]> => {
  const sent: string[] = [];
  const base = { orderId: incident.order as Types.ObjectId, shopOrderId: incident.shopOrderId as Types.ObjectId };
  if (await claimNotification(incident._id, "owner")) {
    await notify({ userId: so.owner, type: "order_delayed", title: "Order is running late", message: "An order has been in preparation longer than expected. Please update its status when it is ready.", ...base });
    sent.push("owner");
  }
  if (await claimNotification(incident._id, "customer")) {
    await notify({ userId: orderUser, type: "order_delayed", title: "Your order is taking longer than expected", message: "The restaurant is still preparing your order. We have asked them for an update.", ...base });
    sent.push("customer");
  }
  if (so.assignedDeliveryBoy && !so.pickedUpAt && (await claimNotification(incident._id, "partner"))) {
    await notify({ userId: so.assignedDeliveryBoy, type: "order_delayed", title: "Pickup is delayed", message: `The order is still being prepared${etaUpdated ? "; the estimated delivery time was updated" : ""}.`, ...base });
    sent.push("delivery partner");
  }
  return sent;
};

/** Makes sure a still-preparing, unassigned order has a dispatch job; never creates offers or touches live ones. */
const ensureDispatch = async (order: { _id: unknown; paymentMethod: string; payment: boolean }, so: IShopOrder): Promise<"enqueued" | "not_needed"> => {
  if (so.assignedDeliveryBoy || so.assignment) return "not_needed";
  if (order.paymentMethod !== "cod" && !order.payment) return "not_needed";
  const [job, assignment] = await Promise.all([
    DispatchJob.exists({ order: order._id, shopOrderId: so._id }),
    DeliveryAssignment.exists({ order: order._id, shopOrderId: so._id, status: "assigned" }),
  ]);
  if (job || assignment) return "not_needed";
  await enqueueDispatch(order._id, so._id, so.readyAt ?? new Date());
  return "enqueued";
};

/** Runs one recovery attempt for an incident this worker has claimed. */
export const processClaimedIncident = async (incident: IncidentDocument, token: string, cfg: OrchestrationConfig = defaultOrchestrationConfig(), now = new Date()): Promise<void> => {
  const mine = { status: "recovering", lockedBy: token };
  const startedAt = Date.now();
  try {
    // Re-read the order: the state may have changed since detection or since the previous attempt.
    const order = await Order.findById(incident.order);
    const so = order?.shopOrders.id(incident.shopOrderId);
    if (!order || !so || so.status !== "preparing" || so.pickedUpAt) {
      await closeBecauseOrderChanged(incident, mine, so?.status, now);
      return;
    }
    if (incident.attempts > incident.attemptLimit) {
      await escalate(incident, token, "recovery attempts exhausted", cfg, now);
      return;
    }

    metrics.inc("attempts");
    const events: ReturnType<typeof historyEntry>[] = [historyEntry("attempt_started", `attempt ${incident.attempts} of ${incident.attemptLimit}`)];
    let etaUpdated = false;
    let failure: string | null = null;

    try {
      const eta = await recomputeEtaForDelay(order._id, so._id, now);
      etaUpdated = eta.updated;
      events.push(historyEntry(eta.updated ? "eta_recalculated" : "eta_skipped", eta.reason));
    } catch (error) {
      failure = sanitizeError(error);
      events.push(historyEntry("attempt_failed", `eta: ${failure}`));
    }
    try {
      if ((await ensureDispatch(order, so)) === "enqueued") events.push(historyEntry("dispatch_enqueued", "no dispatch job existed"));
    } catch (error) {
      failure = sanitizeError(error);
      events.push(historyEntry("attempt_failed", `dispatch: ${failure}`));
    }
    try {
      const sent = await notifyStakeholders(incident, order.user as Types.ObjectId, so, etaUpdated);
      if (sent.length) events.push(historyEntry("notified", sent.join(", ")));
    } catch (error) {
      failure = sanitizeError(error);
      events.push(historyEntry("attempt_failed", `notify: ${failure}`));
    }
    if (failure) metrics.inc("attemptFailures");

    // Nothing above can make the order leave "preparing" (only the owner can), so the attempt either schedules
    // another look or, when the budget is spent, hands over to a human.
    const exhausted = incident.attempts >= incident.attemptLimit;
    const update: UpdateQuery<IOrchestrationIncident> = exhausted
      ? { $set: { failureReason: failure, outcome: "attempts_exhausted" }, ...pushHistory(...events) }
      : {
          $set: { status: "open", lockedBy: null, lockedUntil: null, nextAttemptAt: new Date(now.getTime() + cfg.retryDelayMs), failureReason: failure, outcome: "retry_scheduled" },
          ...pushHistory(...events, historyEntry("retry_scheduled", `next check in ${Math.round(cfg.retryDelayMs / 1000)}s`)),
        };
    const written = await OrchestrationIncident.updateOne({ _id: incident._id, active: true, ...mine }, update);
    if (written.modifiedCount !== 1) {
      logEvent("lease_lost", { incidentId: id(incident._id) }, "warn");
      return;
    }
    const owner = so.owner ? id(so.owner) : undefined;
    emitSafe(owner ? [owner] : [], "orderRecoveryAttempted", { ...eventPayload(incident), status: exhausted ? "recovering" : "open", etaUpdated });
    logEvent("recovery_attempted", { incidentId: id(incident._id), attempt: incident.attempts, etaUpdated, failed: Boolean(failure), durationMs: Date.now() - startedAt });
    if (exhausted) await escalate(incident, token, "recovery attempts exhausted", cfg, now);
  } catch (error) {
    // Unexpected (e.g. the database blipped): record it and retry later. The attempt was already counted, so this is bounded.
    metrics.inc("workerErrors");
    logEvent("process_failed", { incidentId: id(incident._id), error: sanitizeError(error) }, "error");
    const exhausted = incident.attempts >= incident.attemptLimit;
    await OrchestrationIncident.updateOne(
      { _id: incident._id, active: true, ...mine },
      exhausted
        ? { $set: { failureReason: sanitizeError(error) }, ...pushHistory(historyEntry("attempt_failed", sanitizeError(error))) }
        : { $set: { status: "open", lockedBy: null, lockedUntil: null, nextAttemptAt: new Date(now.getTime() + cfg.retryDelayMs), failureReason: sanitizeError(error) }, ...pushHistory(historyEntry("attempt_failed", sanitizeError(error))) },
    ).catch(() => undefined);
    if (exhausted) await escalate(incident, token, "recovery attempts exhausted", cfg, now).catch(() => undefined);
  }
};

/** Escalated incidents are only watched: if the order moved on by itself they close; nothing else is done. */
export const watchEscalated = async (cfg: OrchestrationConfig = defaultOrchestrationConfig(), now = new Date()): Promise<number> => {
  const due = await OrchestrationIncident.find({ active: true, status: "escalated", nextAttemptAt: { $lte: now } }).sort({ nextAttemptAt: 1 }).limit(cfg.batchSize);
  let closed = 0;
  for (const incident of due) {
    const order = await Order.findById(incident.order).select("shopOrders._id shopOrders.status shopOrders.pickedUpAt").lean();
    const so = order?.shopOrders.find((s) => id(s._id) === id(incident.shopOrderId));
    if (so && so.status === "preparing" && !so.pickedUpAt) {
      await OrchestrationIncident.updateOne({ _id: incident._id, status: "escalated" }, { $set: { nextAttemptAt: new Date(now.getTime() + cfg.escalatedWatchMs) } });
      continue;
    }
    await closeBecauseOrderChanged(incident, { status: "escalated" }, so?.status, now);
    closed++;
  }
  return closed;
};

/**
 * Establishes (first run) or reads the activation baseline and records a heartbeat, in one atomic update, so
 * any number of instances starting together agree on a single baseline. See OrchestrationState.
 */
export const ensureActivationBaseline = async (cfg: Pick<OrchestrationConfig, "maxDowntimeMs">, now = new Date()): Promise<{ baseline: Date; change: "created" | "moved" | null }> => {
  const run = () =>
    OrchestrationState.findOneAndUpdate(
      { _id: STATE_ID },
      [
        {
          $set: {
            activatedAt: {
              $cond: [
                { $or: [{ $eq: [{ $type: "$activatedAt" }, "missing"] }, { $gt: [{ $subtract: [now, "$lastHeartbeatAt"] }, cfg.maxDowntimeMs] }] },
                now,
                "$activatedAt",
              ],
            },
            lastHeartbeatAt: now,
          },
        },
      ],
      { upsert: true, new: false },
    ).lean();
  let previous;
  try {
    previous = await run();
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    previous = await run(); // another instance created the document first
  }
  if (!previous) return { baseline: now, change: "created" };
  if (now.getTime() - previous.lastHeartbeatAt.getTime() > cfg.maxDowntimeMs) return { baseline: now, change: "moved" };
  return { baseline: previous.activatedAt, change: null };
};

/** One full pass: detect, close finished escalations, then work through due incidents (bounded by batchSize). */
export const runOrchestrationTick = async (cfg: OrchestrationConfig = defaultOrchestrationConfig(), now = new Date(), token = `${process.pid}-${randomUUID().slice(0, 8)}`) => {
  // Defence in depth: the worker is not started when disabled, but nothing may run here either.
  if (!cfg.enabled) return { detected: 0, processed: 0, disabled: true as const };
  const { baseline, change } = await ensureActivationBaseline(cfg, now);
  if (change) logEvent("activation_baseline", { baseline: baseline.toISOString(), change });
  const detected = await detectOverdueOrders(cfg, now, baseline);
  await watchEscalated(cfg, now);
  let processed = 0;
  for (; processed < cfg.batchSize; processed++) {
    const claimed = await claimNextIncident(token, now, cfg.leaseMs);
    if (!claimed) break;
    await processClaimedIncident(claimed, token, cfg, now);
  }
  return { detected, processed, disabled: false as const };
};

/* ------------------------------------------------------------------ */
/* Administration                                                      */
/* ------------------------------------------------------------------ */

export const listIncidents = async ({ page, limit, status, anomalyType }: { page: number; limit: number; status?: string; anomalyType?: string }) => {
  const filter = { ...(status && { status }), ...(anomalyType && { anomalyType }) };
  const [incidents, total] = await Promise.all([
    OrchestrationIncident.find(filter).select("-history").sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    OrchestrationIncident.countDocuments(filter),
  ]);
  return { incidents, pagination: buildPaginationMeta(page, limit, total) };
};

export const getIncident = async (incidentId: string) => {
  const incident = await OrchestrationIncident.findById(incidentId).lean();
  if (!incident) throw AppError.notFound("Incident not found");
  const shop = incident.shop ? await Shop.findById(incident.shop).select("name").lean() : null;
  return { ...incident, shopName: shop?.name ?? null };
};

/** Closes an incident with a documented reason. Allowed from any unresolved state. */
export const resolveIncident = async (adminId: string, incidentId: string, reason: string) => {
  const now = new Date();
  const updated = await OrchestrationIncident.findOneAndUpdate(
    { _id: incidentId, active: true },
    {
      $set: { status: "resolved", active: false, outcome: "resolved_by_admin", resolvedAt: now, resolvedBy: adminId, resolutionReason: reason, lockedBy: null, lockedUntil: null },
      ...pushHistory(historyEntry("resolved_by_admin", reason, adminId)),
    },
    { new: true },
  ).lean();
  if (!updated) {
    if (!(await OrchestrationIncident.exists({ _id: incidentId }))) throw AppError.notFound("Incident not found");
    throw AppError.conflict("Incident is already closed", "INCIDENT_CLOSED");
  }
  logEvent("incident_resolved", { incidentId, by: adminId });
  return updated;
};

/**
 * Gives an escalated incident exactly one more attempt. The attempt runs through the normal worker path, so it
 * re-verifies the order's current state and cannot do anything an automatic attempt could not.
 */
export const retryIncident = async (adminId: string, incidentId: string) => {
  const updated = await OrchestrationIncident.findOneAndUpdate(
    { _id: incidentId, active: true, status: "escalated" },
    [
      {
        $set: {
          status: "open",
          nextAttemptAt: new Date(),
          attemptLimit: { $add: ["$attempts", 1] },
          "notified.admins": false,
          outcome: "manual_retry",
          history: { $slice: [{ $concatArrays: ["$history", [{ at: new Date(), event: "manual_retry", actor: new Types.ObjectId(adminId) }]] }, -HISTORY_LIMIT] },
        },
      },
    ],
    { new: true },
  ).lean();
  if (!updated) {
    if (!(await OrchestrationIncident.exists({ _id: incidentId }))) throw AppError.notFound("Incident not found");
    throw AppError.conflict("Only escalated incidents can be retried", "INCIDENT_NOT_RETRYABLE");
  }
  logEvent("incident_manual_retry", { incidentId, by: adminId });
  return updated;
};

/* ------------------------------------------------------------------ */
/* Pre-activation backlog (administrator-driven)                       */
/* ------------------------------------------------------------------ */

/** The baseline to compare against; with no engine run yet, everything overdue right now is "pre-existing". */
const currentBaseline = async (now: Date): Promise<Date> => (await OrchestrationState.findById(STATE_ID).lean())?.activatedAt ?? now;

/**
 * Overdue `preparing` shop orders that the engine deliberately does NOT handle by itself because they were
 * already late before activation (or before the last baseline move). Read-only; carries ids and timing only.
 */
export const listBacklog = async ({ page, limit }: { page: number; limit: number }, cfg: OrchestrationConfig = defaultOrchestrationConfig(), now = new Date()) => {
  const baseline = await currentBaseline(now);
  const readyCutoff = new Date(now.getTime() - cfg.preparationTimeoutMs);
  const defaultPrepMs = defaultDispatchConfig().defaultPrepMinutes * 60_000;
  const filter = {
    shopOrders: {
      $elemMatch: {
        status: "preparing",
        pickedUpAt: null,
        $or: [
          { readyAt: { $lt: baseline, $lte: readyCutoff } },
          { readyAt: null, preparingAt: { $lt: new Date(baseline.getTime() - defaultPrepMs), $lte: new Date(readyCutoff.getTime() - defaultPrepMs) } },
        ],
      },
    },
  };
  const [orders, total] = await Promise.all([
    Order.find(filter).select("shopOrders._id shopOrders.shop shopOrders.status shopOrders.readyAt shopOrders.preparingAt shopOrders.pickedUpAt").sort({ _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
    Order.countDocuments(filter),
  ]);
  const items: { orderId: string; shopOrderId: string; shopId: string; expectedReadyAt: Date; overdueMinutes: number; hasActiveIncident: boolean }[] = [];
  for (const order of orders) {
    for (const so of order.shopOrders) {
      const ready = expectedReadyAt(so);
      const overdue = overdueMinutes(so, now, cfg);
      if (!ready || overdue === null || ready >= baseline) continue;
      items.push({
        orderId: id(order._id),
        shopOrderId: id(so._id),
        shopId: id(so.shop),
        expectedReadyAt: ready,
        overdueMinutes: overdue,
        hasActiveIncident: Boolean(await OrchestrationIncident.exists({ order: order._id, shopOrderId: so._id, anomalyType: ANOMALY, active: true })),
      });
    }
  }
  return { baseline, items, pagination: buildPaginationMeta(page, limit, total) };
};

/**
 * Deliberately opens an incident for one pre-existing overdue order. From there the normal worker handles it
 * (re-verifying state, notifying once, escalating). Refused while the engine is off, because nothing would run it.
 */
export const processBacklogItem = async (adminId: string, orderId: string, shopOrderId: string, cfg: OrchestrationConfig = defaultOrchestrationConfig(), now = new Date()) => {
  if (!cfg.enabled) throw AppError.conflict("Order orchestration is disabled; enable it before processing the backlog", "ORCHESTRATION_DISABLED");
  const order = await Order.findById(orderId).select("shopOrders._id shopOrders.shop shopOrders.owner shopOrders.status shopOrders.readyAt shopOrders.preparingAt shopOrders.pickedUpAt").lean();
  const so = order?.shopOrders.find((s) => id(s._id) === shopOrderId);
  if (!order || !so) throw AppError.notFound("Order not found");
  const overdue = overdueMinutes(so, now, cfg);
  if (overdue === null) throw AppError.conflict("This order is not currently overdue in preparation", "NOT_OVERDUE");
  const created = await createIncident(order._id, so, overdue, cfg, now, { actor: adminId });
  if (!created) throw AppError.conflict("An unresolved incident already exists for this order", "INCIDENT_EXISTS");
  logEvent("backlog_item_processed", { orderId, shopOrderId, by: adminId });
  return OrchestrationIncident.findOne({ order: order._id, shopOrderId: so._id, anomalyType: ANOMALY, active: true }).select("-history").lean();
};
