import "dotenv/config";
import { z } from "zod";
import { isFreeMailSender } from "./emailSender.js";
import { normalizePrivateKey, validateFirebaseCredentials } from "./firebaseCredentials.js";

const optional = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

const tunable = (def: number, min: number, max: number) => z.coerce.number().min(min).max(max).default(def);

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(5000),
    FRONTEND_URL: optional,
    MONGODB_URL: z.string().min(1, "MONGODB_URL is required"),
    JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
    REDIS_URL: optional,

    RESEND_API_KEY: optional,
    // "you@yourdomain.com" or "Foodify <you@yourdomain.com>"
    EMAIL_FROM: optional,

    FIREBASE_PROJECT_ID: optional,
    FIREBASE_CLIENT_EMAIL: optional,
    FIREBASE_PRIVATE_KEY: optional,

    RAZORPAY_KEY_ID: optional,
    RAZORPAY_KEY_SECRET: optional,

    GEOAPIFY_API_KEY: optional,

    // Dispatch & ETA engine (all optional; defaults documented in the README)
    DISPATCH_ENABLE_WORKER: z.enum(["true", "false"]).default("true"),
    DISPATCH_OFFER_TIMEOUT_SECONDS: tunable(30, 5, 300),
    DISPATCH_MAX_ATTEMPTS: tunable(10, 1, 100),
    DISPATCH_MAX_WAIT_MINUTES: tunable(10, 1, 240),
    DISPATCH_RETRY_DELAY_SECONDS: tunable(10, 1, 600),
    DISPATCH_LOCATION_MAX_AGE_SECONDS: tunable(120, 10, 3600),
    DISPATCH_MAX_PICKUP_DISTANCE_KM: tunable(5, 0.5, 50),
    DISPATCH_AVG_SPEED_KMH: tunable(20, 5, 80),
    DISPATCH_ROUTE_FACTOR: tunable(1.3, 1, 3),
    DISPATCH_DEFAULT_PREP_MINUTES: tunable(15, 1, 120),
    DISPATCH_PICKUP_BUFFER_MINUTES: tunable(3, 0, 30),
    DISPATCH_HANDOFF_BUFFER_MINUTES: tunable(3, 0, 30),
    DISPATCH_WORKER_CONCURRENCY: tunable(5, 1, 50),
    DISPATCH_WORKER_INTERVAL_MS: tunable(2000, 200, 60000),

    CLOUDINARY_CLOUD_NAME: optional,
    CLOUDINARY_API_KEY: optional,
    CLOUDINARY_API_SECRET: optional,
  })
  .superRefine((env, ctx) => {
    if (env.EMAIL_FROM && isFreeMailSender(env.EMAIL_FROM)) {
      ctx.addIssue({
        code: "custom",
        path: ["EMAIL_FROM"],
        message:
          'EMAIL_FROM cannot be a Gmail/Yahoo/Outlook-style address: Resend only sends from "onboarding@resend.dev" (testing) or from a domain you verified at resend.com/domains',
      });
    }
    if (env.RESEND_API_KEY && !env.EMAIL_FROM) {
      ctx.addIssue({ code: "custom", path: ["EMAIL_FROM"], message: "EMAIL_FROM is required when RESEND_API_KEY is set" });
    }
    if (env.EMAIL_FROM && !/^(?:[^<>]+<)?[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/.test(env.EMAIL_FROM)) {
      ctx.addIssue({ code: "custom", path: ["EMAIL_FROM"], message: 'EMAIL_FROM must look like "you@domain.com" or "Name <you@domain.com>"' });
    }
    // Firebase is optional, but a partial or malformed configuration is a mistake worth failing fast on.
    const firebaseValues = [env.FIREBASE_PROJECT_ID, env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY];
    if (firebaseValues.some(Boolean)) {
      for (const message of validateFirebaseCredentials({
        projectId: env.FIREBASE_PROJECT_ID,
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
        privateKey: env.FIREBASE_PRIVATE_KEY,
      })) {
        ctx.addIssue({ code: "custom", path: ["FIREBASE"], message });
      }
    }
    if (env.NODE_ENV === "production") {
      if (env.JWT_SECRET.length < 32) {
        ctx.addIssue({
          code: "custom",
          path: ["JWT_SECRET"],
          message: "JWT_SECRET must be at least 32 characters in production",
        });
      }
      if (!env.FRONTEND_URL) {
        ctx.addIssue({
          code: "custom",
          path: ["FRONTEND_URL"],
          message: "FRONTEND_URL is required in production",
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const details = parsed.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(`Invalid environment configuration:\n${details}`);
}

export const env: Env = parsed.data;
export const isProduction = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";
