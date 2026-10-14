import { env } from "./env.js";

/** Tunables for the self-healing order orchestration engine. Read once; tests pass their own copy. */
export interface OrchestrationConfig {
  enabled: boolean;
  checkIntervalMs: number;
  /** Time past a shop order's expected ready time before it is treated as stuck in preparation. */
  preparationTimeoutMs: number;
  maxRecoveryAttempts: number;
  retryDelayMs: number;
  batchSize: number;
  /** Longest gap without any instance running the engine before the activation baseline is moved forward. */
  maxDowntimeMs: number;
  /** How long a worker may hold an incident before another instance may take it over. */
  leaseMs: number;
  /** How often an escalated incident is re-checked (only to close it if the order moved on). */
  escalatedWatchMs: number;
}

export const defaultOrchestrationConfig = (): OrchestrationConfig => ({
  enabled: env.ORCHESTRATION_ENABLED === "true",
  checkIntervalMs: env.ORCHESTRATION_CHECK_INTERVAL_MS,
  preparationTimeoutMs: env.ORCHESTRATION_PREPARATION_TIMEOUT_MINUTES * 60_000,
  maxRecoveryAttempts: env.ORCHESTRATION_MAX_RECOVERY_ATTEMPTS,
  retryDelayMs: env.ORCHESTRATION_RETRY_DELAY_SECONDS * 1000,
  batchSize: env.ORCHESTRATION_BATCH_SIZE,
  maxDowntimeMs: env.ORCHESTRATION_MAX_DOWNTIME_MINUTES * 60_000,
  leaseMs: 60_000,
  escalatedWatchMs: 5 * 60_000,
});
