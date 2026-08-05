import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyAzR9UQyV0xIwYgU9xoTuiEfqwhIiDvIrU",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "dona-lu-4242d.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "dona-lu-4242d",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "dona-lu-4242d.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "87878437306",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:87878437306:web:6bb76b8dadd3e7dbd43583",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
