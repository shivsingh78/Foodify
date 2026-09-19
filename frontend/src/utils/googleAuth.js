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