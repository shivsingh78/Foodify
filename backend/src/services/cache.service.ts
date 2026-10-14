import { getRedis, isRedisReady } from "../config/redis.js";

/**
 * Read-through cache on Redis. Redis is optional: when it is not configured or
 * is down every call degrades to a plain loader call (cache miss).
 */
export const cacheStats = { hits: 0, misses: 0, errors: 0 };

const PREFIX = "foodify:cache:";

export const withCache = async <T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>,
): Promise<T> => {
  const redis = getRedis();
  if (!redis || !isRedisReady()) {
    cacheStats.misses++;
    return loader();
  }
  const fullKey = PREFIX + key;
  try {
    const cached = await redis.get(fullKey);
    if (cached !== null) {
      cacheStats.hits++;
      return JSON.parse(cached) as T;
    }
  } catch {
    cacheStats.errors++;
  }
  cacheStats.misses++;
  const value = await loader();
  try {
    await redis.set(fullKey, JSON.stringify(value), "EX", ttlSeconds);
  } catch {
    cacheStats.errors++;
  }
  return value;
};

/** Deletes every cached key that starts with `prefix` (e.g. `items:city:pune`). */
export const invalidateCache = async (prefix: string): Promise<void> => {
  const redis = getRedis();
  if (!redis || !isRedisReady()) return;
  try {
    const keys: string[] = [];
    let cursor = "0";
    do {
      const [next, batch] = await redis.scan(cursor, "MATCH", `${PREFIX}${prefix}*`, "COUNT", 200);
      cursor = next;
      keys.push(...batch);
    } while (cursor !== "0");
    if (keys.length > 0) await redis.del(...keys);
  } catch {
    cacheStats.errors++;
  }
};

export const cityKey = (city: string): string => city.trim().toLowerCase();
