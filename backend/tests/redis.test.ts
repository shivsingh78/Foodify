import express from "express";
import RedisMock from "ioredis-mock";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const redis = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock("../src/config/redis.js", async () => {
  const { default: Mock } = await import("ioredis-mock");
  redis.client = new Mock();
  return { getRedis: () => redis.client, isRedisReady: () => true, closeRedis: async () => undefined };
});

import { cacheStats, invalidateCache, withCache } from "../src/services/cache.service.js";
import { errorHandler } from "../src/middlewares/error.js";
import { rateLimit } from "../src/middlewares/rateLimit.js";

const client = () => redis.client as InstanceType<typeof RedisMock>;

beforeEach(async () => {
  await client().flushall();
  cacheStats.hits = 0;
  cacheStats.misses = 0;
});

describe("Redis cache", () => {
  it("serves repeated reads from the cache and counts hits/misses", async () => {
    const loader = vi.fn(async () => ({ items: [1, 2, 3] }));
    expect(await withCache("items:pune", 60, loader)).toEqual({ items: [1, 2, 3] });
    expect(await withCache("items:pune", 60, loader)).toEqual({ items: [1, 2, 3] });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(cacheStats).toMatchObject({ hits: 1, misses: 1 });
  });

  it("sets an explicit TTL", async () => {
    await withCache("items:pune", 60, async () => 1);
    const ttl = await client().ttl("foodify:cache:items:pune");
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });

  it("invalidates by prefix so the next read reloads", async () => {
    const loader = vi.fn(async () => "v");
    await withCache("items:pune", 60, loader);
    await withCache("items:delhi", 60, loader);
    await withCache("shops:pune", 60, loader);
    await invalidateCache("items:");
    await withCache("items:pune", 60, loader);
    await withCache("shops:pune", 60, loader); // untouched prefix stays cached
    expect(loader).toHaveBeenCalledTimes(4);
  });
});

describe("Redis rate limiter", () => {
  it("enforces limits through shared Redis state", async () => {
    process.env.ENABLE_RATE_LIMIT_IN_TESTS = "true";
    const app = express();
    app.get("/x", rateLimit({ name: "redis-test", windowSeconds: 60, max: 2 }), (_req, res) => void res.json({ ok: true }));
    app.use(errorHandler);

    expect((await request(app).get("/x")).status).toBe(200);
    expect((await request(app).get("/x")).status).toBe(200);
    expect((await request(app).get("/x")).status).toBe(429);
    const keys = await client().keys("foodify:rl:*");
    expect(keys.length).toBe(1);
    expect(await client().pttl(keys[0] as string)).toBeGreaterThan(0);
    delete process.env.ENABLE_RATE_LIMIT_IN_TESTS;
  });
});
