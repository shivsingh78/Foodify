import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { env } from "./env.js";
import { normalizePrivateKey } from "./firebaseCredentials.js";
import { AppError } from "../utils/AppError.js";

let app: App | null = null;

/**
 * Lazily initialises Firebase Admin so the API can start (and every non-Google
 * route can work) without Firebase credentials. Google auth then fails
 * explicitly with a 503 instead of crashing the process.
 */
export const getFirebaseAuth = (): Auth => {
  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = env;
  if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
    throw new AppError(503, "Google authentication is not configured on the server", "FIREBASE_NOT_CONFIGURED");
  }
  if (!app) {
    try {
      app =
        getApps()[0] ??
        initializeApp({
          credential: cert({
            projectId: FIREBASE_PROJECT_ID,
            clientEmail: FIREBASE_CLIENT_EMAIL,
            privateKey: normalizePrivateKey(FIREBASE_PRIVATE_KEY),
          }),
        });
    } catch (error) {
      // Log the Firebase error code only; the message could be derived from credential content.
      console.error("Firebase Admin initialisation failed:", (error as { code?: string }).code ?? "unknown");
      throw new AppError(503, "Google authentication is misconfigured on the server", "FIREBASE_CREDENTIALS_INVALID");
    }
  }
  return getAuth(app);
};
