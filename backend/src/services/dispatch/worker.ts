import mongoose from "mongoose";
import User from "../../models/user.model.js";
import { defaultDispatchConfig } from "../../config/dispatch.js";
import { env } from "../../config/env.js";
import { recoverPickupNotices } from "../pickupNotice.service.js";
import { recoverState, registerKick, runDispatchTick } from "./dispatch.service.js";

let timer: NodeJS.Timeout | null = null;
let running = false;
let rerun = false;
let lastRecovery = 0;
let lastTickAt: Date | null = null;
let lastTickError: string | null = null;
let lastNoticeSweep = 0;
const NOTICE_SWEEP_INTERVAL_MS = 10_000;
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
      lastTickAt = new Date();
      await runDispatchTick(defaultDispatchConfig(), env.DISPATCH_WORKER_CONCURRENCY);
      if (Date.now() - lastNoticeSweep > NOTICE_SWEEP_INTERVAL_MS) {
        lastNoticeSweep = Date.now();
        const n = await recoverPickupNotices();
        if (n) console.log(`Recovered ${n} pickup notice(s)`);
      }
      if (Date.now() - lastRecovery > RECOVERY_INTERVAL_MS) {
        lastRecovery = Date.now();
        const r = await recoverState();
        if (r.repaired || r.enqueued) console.log(`Dispatch recovery: repaired=${r.repaired} enqueued=${r.enqueued}`);
      }
    } while (rerun);
    lastTickError = null;
  } catch (error) {
    lastTickError = error instanceof Error ? error.name : "ERROR";
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
  if (env.DISPATCH_ENABLE_WORKER !== "true") {
    console.warn(JSON.stringify({ component: "dispatch", event: "worker_disabled", reason: "DISPATCH_ENABLE_WORKER is not true; this instance will not create offers" }));
    return;
  }
  if (timer) return;
  void checkGeoIndex();
  console.log(JSON.stringify({ component: "dispatch", event: "worker_started", intervalMs: env.DISPATCH_WORKER_INTERVAL_MS, concurrency: env.DISPATCH_WORKER_CONCURRENCY }));
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

/** For diagnostics: is the dispatch worker running in THIS process, and when did it last run? */
export const dispatchWorkerState = () => ({
  enabled: env.DISPATCH_ENABLE_WORKER === "true",
  running: timer !== null,
  lastTickAt,
  lastTickError,
  intervalMs: env.DISPATCH_WORKER_INTERVAL_MS,
});

/** Partner search uses `$near`, which fails on every job without the 2dsphere index on users.location. */
export const geoIndexPresent = async (): Promise<boolean> => {
  try {
    const indexes = await User.collection.indexes();
    return indexes.some((i) => (i.key as Record<string, unknown>).location === "2dsphere");
  } catch {
    return false;
  }
};

/** Mongoose builds indexes in the background and never fails start-up if a build fails, so check and say so loudly. */
const checkGeoIndex = async () => {
  const buildError = await User.init().then(
    () => null,
    (error: unknown) => {
      const e = error as { name?: string; codeName?: string; code?: unknown };
      return [e?.name, e?.codeName ?? e?.code].filter(Boolean).join(":");
    },
  );
  if (await geoIndexPresent()) return;
  console.error(JSON.stringify({
    component: "dispatch",
    event: "geo_index_missing",
    impact: "no delivery partner can be found, so no offers are created",
    indexBuildError: buildError,
    hint: "usually users whose 'location' is not a valid GeoJSON Point; fix those documents, then restart",
  }));
};
