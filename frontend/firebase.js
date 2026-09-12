// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_APIKEY,
  authDomain: "foodify-7cd3e.firebaseapp.com",
  projectId: "foodify-7cd3e",
  storageBucket: "foodify-7cd3e.firebasestorage.app",
  messagingSenderId: "890758037711",
  appId: "1:890758037711:web:5ac97da8517f1a811977ba"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth=getAuth(app)

export {app,auth}