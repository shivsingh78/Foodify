import { initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  getAuth,
  setPersistence,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_APIKEY,
  authDomain: "foodify-95238.firebaseapp.com",
  projectId: "foodify-95238",
  storageBucket: "foodify-95238.firebasestorage.app",
  messagingSenderId: "943042935233",
  appId: "1:943042935233:web:7095944b1ba6d52c215740",
  measurementId: "G-1CW2YJ0YX3"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const authPersistenceReady = setPersistence(
  auth,
  browserLocalPersistence
);

export { app, auth, authPersistenceReady };