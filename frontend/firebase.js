import { initializeApp } from "firebase/app";
import { buildFirebaseConfig } from "./src/utils/firebaseConfig.js";
import {
  browserLocalPersistence,
  getAuth,
  setPersistence,
} from "firebase/auth";

const firebaseConfig = buildFirebaseConfig(import.meta.env);

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const authPersistenceReady = setPersistence(
  auth,
  browserLocalPersistence
);

export { app, auth, authPersistenceReady };