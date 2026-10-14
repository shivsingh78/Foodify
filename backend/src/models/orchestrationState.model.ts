import mongoose from "mongoose";

/**
 * Single shared document (`_id: "orchestration"`) that makes activation safe across restarts and instances.
 *
 * - `activatedAt` is the activation baseline: only shop orders expected ready at or after it are detected
 *   automatically. Orders that were already overdue are left to an administrator (the backlog endpoints).
 * - `lastHeartbeatAt` is touched on every tick by any instance. If no instance has ticked for longer than
 *   ORCHESTRATION_MAX_DOWNTIME_MINUTES (engine switched off, rolled back, or fully down), the baseline moves
 *   forward to "now" on the next start, so a re-enable never turns the downtime into a burst of notifications.
 */
export interface IOrchestrationState {
  _id: string;
  activatedAt: Date;
  lastHeartbeatAt: Date;
}

export const STATE_ID = "orchestration";

const schema = new mongoose.Schema<IOrchestrationState>(
  { _id: { type: String, required: true }, activatedAt: { type: Date, required: true }, lastHeartbeatAt: { type: Date, required: true } },
  { timestamps: true },
);

const OrchestrationState = mongoose.model<IOrchestrationState>("OrchestrationState", schema);
export default OrchestrationState;
