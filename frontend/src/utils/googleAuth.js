import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import { auth } from "../../firebase";

const createGoogleProvider = () => {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return provider;
};

let googleAuthInProgress = null;

const startGoogleAuth = async () => {
  try {
    return await signInWithPopup(auth, createGoogleProvider());
  } catch (error) {
    if (error.code !== "auth/invalid-credential") {
      throw error;
    }

    await signOut(auth);
    return signInWithPopup(auth, createGoogleProvider());
  }
};

export const signInWithGoogle = () => {
  if (googleAuthInProgress) return googleAuthInProgress;

  googleAuthInProgress = startGoogleAuth().finally(() => {
    googleAuthInProgress = null;
  });

  return googleAuthInProgress;
};

/**
 * Development-only diagnostics at the original error boundary, before the error is turned
 * into a friendly message. Logs the Firebase code/message/stack only; never tokens or cookies.
 */
export const logAuthErrorInDev = (context, error) => {
  if (!import.meta.env.DEV) return
  console.error(`[auth-debug] ${context}`, {
    code: error?.code,
    name: error?.name,
    message: error?.message,
    status: error?.response?.status,
    origin: globalThis.location?.origin,
    authDomain: auth.config?.authDomain,
    stack: error?.stack,
  })
}
