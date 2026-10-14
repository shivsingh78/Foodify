import { createHash, randomInt, timingSafeEqual } from "node:crypto";

export const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

/** Cryptographically secure numeric code with a fixed number of digits. */
export const generateNumericCode = (digits: number): string =>
  randomInt(0, 10 ** digits).toString().padStart(digits, "0");

export const safeEqual = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
};

export const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
