/**
 * Public browser configuration. In production the server injects `window.__FOODIFY_CONFIG__`
 * (via /runtime-config.js, loaded before this bundle) so values can change without rebuilding.
 * `import.meta.env` is the build-time fallback used by local development.
 */
export const PUBLIC_CONFIG_KEYS = [
  'VITE_API_URL',
  'VITE_FIREBASE_APIKEY',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_RAZORPAY_KEY_ID',
]

export const readPublicConfig = (
  buildEnv = import.meta.env,
  runtime = typeof window === 'undefined' ? undefined : window.__FOODIFY_CONFIG__,
) =>
  Object.fromEntries(
    PUBLIC_CONFIG_KEYS.map((key) => [key, runtime?.[key] || buildEnv?.[key] || undefined]).filter(([, value]) => value),
  )

/** API/Socket.IO base URL. Empty means same-origin (the combined deployment). */
export const resolveServerUrl = (config) => (config.VITE_API_URL ?? '').replace(/\/+$/, '')
