import DeliveryOffer from "../../models/deliveryOffer.model.js";
import DispatchJob from "../../models/dispatchJob.model.js";
import Order from "../../models/order.model.js";

const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;

/** Nearest-rank percentile of an ascending-sorted list. */
export const percentile = (sorted: number[], p: number): number | null =>
  sorted.length === 0 ? null : (sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))] as number);

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

const SAMPLE_CAP = 20_000;

/**
 * Operational metrics, derived from persisted records only (no extra writes).
 * Output contains counts and durations, never addresses, names, contact details or locations.
 *
 *  assignmentLatencySeconds : assignedAt − startedAt of jobs that ended `assigned`. startedAt = the moment the
 *                             order entered dispatch (owner set it to "preparing"). Includes waiting for retries.
 *  assignmentSuccessRate    : assigned ÷ (assigned + exhausted), over finished jobs; cancelled/in-flight excluded.
 *  attemptsPerOrder         : mean `attempts` (dispatch runs that tried to place an offer) over all jobs.
 *  offers                   : offers created in the window by terminal state.
 *  workerFailures           : sum of exceptions caught while processing jobs (each one is retried).
 *  etaAccuracy              : error = deliveredAt − etaAtAssignment.deliveryAt, in minutes (positive = late).
 *                             etaAtAssignment is frozen when the partner is assigned and never rewritten, so
 *                             later revisions cannot hide an earlier miss. Only delivered orders with both
 *                             timestamps count.
 */
export const getDispatchMetrics = async (days: number, now = new Date()) => {
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const jobs = await DispatchJob.find({ startedAt: { $gte: since } })
    .select("status attempts startedAt assignedAt failures")
    .limit(SAMPLE_CAP)
    .lean();
  const latencies = jobs
    .filter((j) => j.status === "assigned" && j.assignedAt)
    .map((j) => ((j.assignedAt as Date).getTime() - j.startedAt.getTime()) / 1000)
    .filter((s) => s >= 0)
    .sort((a, b) => a - b);
  const byStatus: Record<string, number> = {};
  for (const j of jobs) byStatus[j.status] = (byStatus[j.status] ?? 0) + 1;
  const finished = (byStatus.assigned ?? 0) + (byStatus.exhausted ?? 0);

  const offerRows = await DeliveryOffer.aggregate<{ _id: string; n: number }>([
    { $match: { createdAt: { $gte: since } } },
    { $group: { _id: "$status", n: { $sum: 1 } } },
  ]);
  const offers = { PENDING: 0, ACCEPTED: 0, DECLINED: 0, EXPIRED: 0, CANCELLED: 0 } as Record<string, number>;
  for (const r of offerRows) offers[r._id] = r.n;

  const delivered = await Order.aggregate<{ predicted: Date; actual: Date }>([
    { $match: { "shopOrders.deliveredAt": { $gte: since } } },
    { $unwind: "$shopOrders" },
    { $match: { "shopOrders.status": "delivered", "shopOrders.deliveredAt": { $gte: since }, "shopOrders.etaAtAssignment.deliveryAt": { $ne: null } } },
    { $project: { _id: 0, predicted: "$shopOrders.etaAtAssignment.deliveryAt", actual: "$shopOrders.deliveredAt" } },
    { $limit: SAMPLE_CAP },
  ]);
  const errors = delivered.filter((d) => d.predicted && d.actual).map((d) => (d.actual.getTime() - d.predicted.getTime()) / 60_000);
  const absSorted = errors.map(Math.abs).sort((a, b) => a - b);

  const r = (n: number | null) => (n === null ? null : round(n));
  return {
    windowDays: days,
    generatedAt: now,
    jobs: { total: jobs.length, byStatus },
    assignmentLatencySeconds: {
      count: latencies.length,
      average: r(mean(latencies)),
      p50: r(percentile(latencies, 50)),
      p95: r(percentile(latencies, 95)),
    },
    assignmentSuccessRate: finished ? round((byStatus.assigned ?? 0) / finished, 4) : null,
    offers,
    attemptsPerOrder: r(mean(jobs.map((j) => j.attempts))),
    ordersExhausted: byStatus.exhausted ?? 0,
    workerFailures: jobs.reduce((s, j) => s + (j.failures ?? 0), 0),
    etaAccuracy: {
      sampleCount: errors.length,
      meanAbsoluteErrorMinutes: r(mean(absSorted)),
      medianAbsoluteErrorMinutes: r(percentile(absSorted, 50)),
      meanSignedErrorMinutes: r(mean(errors)),
      note: "Compares delivery time with the ETA frozen at partner assignment; estimates assume an average speed.",
    },
  };
};
