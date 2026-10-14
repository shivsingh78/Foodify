/**
 * Builds the Firebase web config from Vite env vars. The API key, auth domain and
 * project must all belong to the SAME Firebase project; mixing them (for example a key
 * from one project with another project's authDomain) breaks the popup sign-in flow.
 */
export const buildFirebaseConfig = (env) => {
  const apiKey = env.VITE_FIREBASE_APIKEY
  const projectId = env.VITE_FIREBASE_PROJECT_ID
  if (!apiKey || !projectId) {
    throw new Error(
      'Firebase is not configured: set VITE_FIREBASE_APIKEY and VITE_FIREBASE_PROJECT_ID in the server runtime environment (served via /runtime-config.js) or, for local development, in frontend/.env (see .env.example).',
    )
  }
  const config = {
    apiKey,
    projectId,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`,
  }
  // Optional identifiers; Google sign-in does not need them.
  if (env.VITE_FIREBASE_APP_ID) config.appId = env.VITE_FIREBASE_APP_ID
  if (env.VITE_FIREBASE_MESSAGING_SENDER_ID) config.messagingSenderId = env.VITE_FIREBASE_MESSAGING_SENDER_ID
  return config
}
