import { initializeApp } from "firebase/app";
import { buildFirebaseConfig } from "./src/utils/firebaseConfig.js";
import { readPublicConfig } from "./src/runtimeConfig.js";
import {
  browserLocalPersistence,
  getAuth,
  setPersistence,
} from "firebase/auth";

const firebaseConfig = buildFirebaseConfig(readPublicConfig());

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const authPersistenceReady = setPersistence(
  auth,
  browserLocalPersistence
);

export { app, auth, authPersistenceReady };