import type { NextFunction, Request, Response } from "express";
import { getRedis, isRedisReady } from "../config/redis.js";
import { isTest } from "../config/env.js";
import { AppError } from "../utils/AppError.js";

type Options = {
  /** Namespace so different routes keep independent counters. */
  name: string;
  windowSeconds: number;
  max: number;
  /** Extra discriminator besides the client IP, e.g. the email being targeted. */
  keyFn?: (req: Request) => string | undefined;
};

type Counter = { count: number; resetAt: number };
const memory = new Map<string, Counter>();

const memoryHit = (key: string, windowMs: number): { count: number; ttlMs: number } => {
  const now = Date.now();
  const existing = memory.get(key);
  if (!existing || existing.resetAt <= now) {
    memory.set(key, { count: 1, resetAt: now + windowMs });
    return { count: 1, ttlMs: windowMs };
  }
  existing.count++;
  return { count: existing.count, ttlMs: existing.resetAt - now };
};

// Keep the in-memory fallback from growing without bound.
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of memory) if (value.resetAt <= now) memory.delete(key);
}, 60_000).unref();

/** Visible for tests. */
export const resetRateLimits = () => memory.clear();

const redisHit = async (key: string, windowSeconds: number) => {
  const redis = getRedis();
  if (!redis || !isRedisReady()) return null;
  try {
    const results = await redis.multi().incr(key).pttl(key).exec();
    const count = Number(results?.[0]?.[1]);
    let ttlMs = Number(results?.[1]?.[1]);
    if (count === 1 || ttlMs < 0) {
      await redis.pexpire(key, windowSeconds * 1000);
      ttlMs = windowSeconds * 1000;
    }
    return { count, ttlMs };
  } catch {
    return null;
  }
};

/**
 * Fixed-window rate limiter. Uses Redis when available (shared across API
 * instances) and falls back to per-process memory otherwise, so the limit is
 * still enforced if Redis is unavailable.
 */
export const rateLimit = (options: Options) => {
  const { name, windowSeconds, max, keyFn } = options;
  return async (req: Request, res: Response, next: NextFunction) => {
    if (isTest && process.env.ENABLE_RATE_LIMIT_IN_TESTS !== "true") return next();

    const subject = [req.ip ?? "unknown", keyFn?.(req)].filter(Boolean).join(":");
    const key = `foodify:rl:${name}:${subject}`;
    const hit =
      (await redisHit(key, windowSeconds)) ?? memoryHit(key, windowSeconds * 1000);

    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, max - hit.count)));
    if (hit.count > max) {
      res.setHeader("Retry-After", String(Math.ceil(hit.ttlMs / 1000)));
      throw AppError.tooMany();
    }
    next();
  };
};

const emailKey = (req: Request): string | undefined =>
  typeof req.body?.email === "string" ? req.body.email.toLowerCase() : undefined;

export const limits = {
  /** Credential endpoints: slows brute-force and credential stuffing. */
  auth: rateLimit({ name: "auth", windowSeconds: 15 * 60, max: 20, keyFn: emailKey }),
  /** OTP sending triggers emails, so it is stricter. */
  otpSend: rateLimit({ name: "otp-send", windowSeconds: 15 * 60, max: 5, keyFn: emailKey }),
  otpVerify: rateLimit({ name: "otp-verify", windowSeconds: 15 * 60, max: 10, keyFn: emailKey }),
  payment: rateLimit({ name: "payment", windowSeconds: 10 * 60, max: 30 }),
  orderWrite: rateLimit({ name: "order-write", windowSeconds: 60, max: 30 }),
  deliveryOtp: rateLimit({ name: "delivery-otp", windowSeconds: 15 * 60, max: 15 }),
  /** Geocoding proxy: protects our Geoapify quota. */
  geo: rateLimit({ name: "geo", windowSeconds: 60, max: 60 }),
  applications: rateLimit({ name: "applications", windowSeconds: 60, max: 30 }),
  api: rateLimit({ name: "api", windowSeconds: 60, max: 300 }),
};
