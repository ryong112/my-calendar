// src/firebase.js
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";

const apiKey = import.meta.env.VITE_FIREBASE_API_KEY;
const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN;
const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;

// 환경변수 누락 시 친절한 경고 (앱은 일단 뜨게)
if (!apiKey || !projectId) {
  console.error("[Firebase] .env가 설정되지 않았습니다. (apiKey/projectId 확인)");
}

const firebaseConfig = { apiKey, authDomain, projectId };
const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
const provider = new GoogleAuthProvider();

export function watchAuth(callback) {
  return onAuthStateChanged(auth, callback);
}
export async function signIn() {
  await signInWithPopup(auth, provider);
}
export async function signOutUser() {
  await signOut(auth);
}
