import { defaultOrchestrationConfig } from "../../config/orchestration.js";
import OrchestrationIncident from "../../models/orchestrationIncident.model.js";
import OrchestrationState, { STATE_ID } from "../../models/orchestrationState.model.js";

/** Process-local counters (reset on restart) plus durable counts read from the incident collection. */
const counters = {
  scans: 0,
  anomaliesDetected: 0,
  attempts: 0,
  attemptFailures: 0,
  skippedStateChanged: 0,
  recovered: 0,
  escalated: 0,
  workerErrors: 0,
  lastRunMs: 0,
  lastRunAt: null as Date | null,
  latencySamples: 0,
  latencyTotalMs: 0,
};

export const metrics = {
  inc: (key: "scans" | "anomaliesDetected" | "attempts" | "attemptFailures" | "skippedStateChanged" | "recovered" | "escalated" | "workerErrors", by = 1) => {
    counters[key] += by;
  },
  /** Detection-to-recovery latency for an incident that closed as recovered. */
  recordRecoveryLatency: (ms: number) => {
    counters.latencySamples++;
    counters.latencyTotalMs += Math.max(0, ms);
  },
  recordRun: (durationMs: number, at = new Date()) => {
    counters.lastRunMs = durationMs;
    counters.lastRunAt = at;
  },
  reset: () => {
    for (const k of Object.keys(counters) as (keyof typeof counters)[]) {
      (counters[k] as number | Date | null) = typeof counters[k] === "number" ? 0 : null;
    }
  },
};

export const getOrchestrationMetrics = async () => {
  const byStatus = await OrchestrationIncident.aggregate<{ _id: string; count: number }>([{ $group: { _id: "$status", count: { $sum: 1 } } }]);
  const incidents = Object.fromEntries(byStatus.map((r) => [r._id, r.count]));
  const state = await OrchestrationState.findById(STATE_ID).lean();
  return {
    enabled: defaultOrchestrationConfig().enabled,
    activatedAt: state?.activatedAt ?? null,
    lastHeartbeatAt: state?.lastHeartbeatAt ?? null,
    // Durable (all instances)
    incidents,
    openIncidents: (incidents.open ?? 0) + (incidents.recovering ?? 0) + (incidents.escalated ?? 0),
    // This instance since start-up
    process: {
      ...counters,
      avgDetectionToRecoveryMs: counters.latencySamples ? Math.round(counters.latencyTotalMs / counters.latencySamples) : null,
    },
  };
};
