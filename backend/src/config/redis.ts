import { Redis } from "ioredis";
import { env } from "./env.js";

let client: Redis | null = null;
let warned = false;

/**
 * Returns the shared Redis client, or null when REDIS_URL is not configured.
 * Callers must treat Redis as optional: cache and rate limiting degrade
 * gracefully when it is absent or down.
 */
export const getRedis = (): Redis | null => {
  if (!env.REDIS_URL) return null;
  if (client) return client;

  client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: (attempt) => Math.min(attempt * 200, 5000),
  });
  client.on("error", (error: Error) => {
    if (!warned) {
      warned = true;
      console.warn(`⚠️  Redis unavailable, falling back: ${error.message}`);
    }
  });
  client.on("ready", () => {
    warned = false;
    console.log("✅ Redis connected");
  });
  return client;
};

export const isRedisReady = (): boolean => client?.status === "ready";

export const closeRedis = async (): Promise<void> => {
  if (client) {
    await client.quit().catch(() => undefined);
    client = null;
  }
};
