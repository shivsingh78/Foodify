import type { Env } from "./env.js";

/**
 * The ONLY values exposed to browsers through /runtime-config.js. Every field is a
 * public client-side identifier (Firebase web config, Razorpay *key id*), never a
 * secret. Add a field here deliberately; nothing is read from process.env wholesale.
 */
export type PublicConfig = Partial<
  Record<"VITE_FIREBASE_APIKEY" | "VITE_FIREBASE_PROJECT_ID" | "VITE_FIREBASE_AUTH_DOMAIN" | "VITE_RAZORPAY_KEY_ID" | "VITE_GEOAPIFY_MAPS_API_KEY", string>
>;

export const buildPublicConfig = (env: Pick<Env, "VITE_GEOAPIFY_MAPS_API_KEY" | "VITE_FIREBASE_APIKEY" | "VITE_FIREBASE_PROJECT_ID" | "VITE_FIREBASE_AUTH_DOMAIN" | "VITE_RAZORPAY_KEY_ID" | "FIREBASE_PROJECT_ID" | "RAZORPAY_KEY_ID">): PublicConfig => {
  const entries: [keyof PublicConfig, string | undefined][] = [
    ["VITE_FIREBASE_APIKEY", env.VITE_FIREBASE_APIKEY],
    // Same Firebase project / Razorpay account as the server side, so reuse those ids when not set explicitly.
    ["VITE_FIREBASE_PROJECT_ID", env.VITE_FIREBASE_PROJECT_ID ?? env.FIREBASE_PROJECT_ID],
    ["VITE_FIREBASE_AUTH_DOMAIN", env.VITE_FIREBASE_AUTH_DOMAIN],
    ["VITE_RAZORPAY_KEY_ID", env.VITE_RAZORPAY_KEY_ID ?? env.RAZORPAY_KEY_ID],
    // A dedicated, domain-restricted browser key for map tiles. Never falls back to the server-side GEOAPIFY_API_KEY.
    ["VITE_GEOAPIFY_MAPS_API_KEY", env.VITE_GEOAPIFY_MAPS_API_KEY],
  ];
  return Object.fromEntries(entries.filter(([, value]) => value)) as PublicConfig;
};

/** JS that assigns the config to window; JSON.stringify output is made safe to embed in a script. */
export const renderRuntimeConfig = (config: PublicConfig): string => {
  const json = JSON.stringify(config)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return `window.__FOODIFY_CONFIG__ = Object.freeze(${json});\n`;
};
