import { z } from "zod";

/** 24-character hex MongoDB ObjectId. */
export const objectIdSchema = z
  .string()
  .regex(/^[a-fA-F0-9]{24}$/, "Invalid identifier");

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Please provide a valid email"));

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be at most 128 characters");

export const mobileSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9]{10,15}$/, "Mobile number must be 10 to 15 digits");

export const latitudeSchema = z.coerce.number().min(-90).max(90);
export const longitudeSchema = z.coerce.number().min(-180).max(180);

export const idParamSchema = (name: string) =>
  z.strictObject({ [name]: objectIdSchema });
