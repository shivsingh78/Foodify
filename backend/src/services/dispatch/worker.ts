import mongoose from "mongoose";
import { defaultDispatchConfig } from "../../config/dispatch.js";
import { env } from "../../config/env.js";
import { recoverState, registerKick, runDispatchTick } from "./dispatch.service.js";

let timer: NodeJS.Timeout | null = null;
let running = false;
let rerun = false;
let lastRecovery = 0;
const RECOVERY_INTERVAL_MS = 60_000;

const tick = async () => {
  if (running) {
    rerun = true; // coalesce: run once more right after the current tick
    return;
  }
  running = true;
  try {
    do {
      rerun = false;
      if (mongoose.connection.readyState !== 1) break;
      await runDispatchTick(defaultDispatchConfig(), env.DISPATCH_WORKER_CONCURRENCY);
      if (Date.now() - lastRecovery > RECOVERY_INTERVAL_MS) {
        lastRecovery = Date.now();
        const r = await recoverState();
        if (r.repaired || r.enqueued) console.log(`Dispatch recovery: repaired=${r.repaired} enqueued=${r.enqueued}`);
      }
    } while (rerun);
  } catch (error) {
    console.error("Dispatch tick failed:", error instanceof Error ? error.name : error);
  } finally {
    running = false;
  }
};

/**
 * In-process dispatch worker. Safe to run in several API instances: jobs are claimed with leases and every
 * state change is a conditional update, so duplicate execution is harmless.
 */
export const startDispatchWorker = (): void => {
  if (timer || env.DISPATCH_ENABLE_WORKER !== "true") return;
  registerKick(() => void setImmediate(() => void tick()));
  timer = setInterval(() => void tick(), env.DISPATCH_WORKER_INTERVAL_MS);
  timer.unref();
  void tick(); // resume anything left over from before a restart
};

export const stopDispatchWorker = (): void => {
  if (timer) clearInterval(timer);
  timer = null;
  registerKick(null);
};
