import mongoose from "mongoose";
import { defaultOrchestrationConfig, type OrchestrationConfig } from "../../config/orchestration.js";
import { logEvent, sanitizeError } from "./log.js";
import { metrics } from "./metrics.js";
import { runOrchestrationTick } from "./orchestration.service.js";

let timer: NodeJS.Timeout | null = null;
let inFlight: Promise<void> | null = null;

const tick = (cfg: OrchestrationConfig): Promise<void> => {
  // Local guard against overlapping ticks in this process. Cross-instance safety does not depend on it:
  // detection is deduplicated by a unique index and incidents are claimed with atomic, leased updates in MongoDB.
  if (inFlight) return inFlight;
  inFlight = (async () => {
    if (mongoose.connection.readyState !== 1) return;
    const started = Date.now();
    try {
      const { detected, processed } = await runOrchestrationTick(cfg);
      if (detected || processed) logEvent("tick", { detected, processed, durationMs: Date.now() - started });
    } catch (error) {
      metrics.inc("workerErrors");
      logEvent("tick_failed", { error: sanitizeError(error) }, "error");
    } finally {
      metrics.recordRun(Date.now() - started);
    }
  })().finally(() => void (inFlight = null));
  return inFlight;
};

/**
 * Order orchestration worker. It coordinates only through MongoDB (unique index + leased claims), so it is
 * safe with several API instances and is unaffected by Redis being down or unconfigured.
 */
export const startOrchestrationWorker = (cfg: OrchestrationConfig = defaultOrchestrationConfig()): void => {
  if (!cfg.enabled) {
    logEvent("orchestration_disabled");
    return;
  }
  if (timer) return;
  logEvent("orchestration_started", {
    checkIntervalMs: cfg.checkIntervalMs,
    preparationTimeoutMinutes: cfg.preparationTimeoutMs / 60_000,
    maxRecoveryAttempts: cfg.maxRecoveryAttempts,
    retryDelaySeconds: cfg.retryDelayMs / 1000,
    batchSize: cfg.batchSize,
    coordination: "mongodb",
  });
  timer = setInterval(() => void tick(cfg), cfg.checkIntervalMs);
  timer.unref();
  void tick(cfg);
};

/** Stops scheduling and waits (bounded) for the tick in progress so shutdown does not cut an attempt in half. */
export const stopOrchestrationWorker = async (timeoutMs = 5000): Promise<void> => {
  if (timer) clearInterval(timer);
  timer = null;
  if (inFlight) await Promise.race([inFlight, new Promise((resolve) => setTimeout(resolve, timeoutMs).unref())]);
};
