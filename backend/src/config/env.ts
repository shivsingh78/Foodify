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
    // Built SPA to serve; defaults to ../frontend/dist in production when it exists.
    FRONTEND_DIST: optional,
    // Enforce (instead of report-only) the Content-Security-Policy applied to the SPA.
    CSP_ENFORCE: z.enum(["true", "false"]).default("false"),

    // Public browser config served at /runtime-config.js. Not secrets: Firebase web config and the
    // Razorpay key id are visible in any browser. Project id / key id fall back to the server-side ones.
    VITE_FIREBASE_APIKEY: optional,
    VITE_FIREBASE_PROJECT_ID: optional,
    VITE_FIREBASE_AUTH_DOMAIN: optional,
    VITE_RAZORPAY_KEY_ID: optional,
    VITE_GEOAPIFY_MAPS_API_KEY: optional,
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
    DISPATCH_MAX_PICKUP_DISTANCE_KM: tunable(10, 0.5, 50),
    /** Partners whose service area names the restaurant's city/district may be this far away (still a safety bound). */
    DISPATCH_SERVICE_AREA_MAX_KM: tunable(50, 1, 200),
    DISPATCH_AVG_SPEED_KMH: tunable(20, 5, 80),
    DISPATCH_ROUTE_FACTOR: tunable(1.3, 1, 3),
    DISPATCH_DEFAULT_PREP_MINUTES: tunable(15, 1, 120),
    DISPATCH_PICKUP_BUFFER_MINUTES: tunable(3, 0, 30),
    DISPATCH_HANDOFF_BUFFER_MINUTES: tunable(3, 0, 30),
    DISPATCH_WORKER_CONCURRENCY: tunable(5, 1, 50),
    DISPATCH_WORKER_INTERVAL_MS: tunable(2000, 200, 60000),

    // Self-healing order orchestration (all optional; defaults documented in the README)
    // Off unless explicitly enabled; see the README rollout procedure.
    ORCHESTRATION_ENABLED: z.enum(["true", "false"]).default("false"),
    ORCHESTRATION_CHECK_INTERVAL_MS: tunable(30_000, 5_000, 600_000),
    /** Grace period after a shop order's expected ready time before it counts as stuck. */
    ORCHESTRATION_PREPARATION_TIMEOUT_MINUTES: tunable(10, 1, 240),
    ORCHESTRATION_MAX_RECOVERY_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
    ORCHESTRATION_RETRY_DELAY_SECONDS: tunable(120, 10, 3600),
    /** If no instance ran the engine for this long, the activation baseline moves to the next start. */
    ORCHESTRATION_MAX_DOWNTIME_MINUTES: tunable(15, 1, 1440),
    ORCHESTRATION_BATCH_SIZE: z.coerce.number().int().min(10).max(500).default(100),

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
