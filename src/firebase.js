// src/firebase.js
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithCredential,
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
  if (!isEmbedded()) return signInWithPopup(auth, provider);

  const nonce = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  const helperUrl = new URL(window.location.href);
  helperUrl.search = "";
  helperUrl.hash = "";
  helperUrl.searchParams.set("authHelper", "1");
  helperUrl.searchParams.set("nonce", nonce);

  const popup = window.open(
    helperUrl.toString(),
    "calendar-google-auth",
    "popup=yes,width=520,height=680,menubar=no,toolbar=no,location=no,status=no",
  );

  if (!popup) {
    const error = new Error("로그인 창이 차단되었습니다. 브라우저에서 팝업을 허용해 주세요.");
    error.code = "auth/popup-blocked";
    throw error;
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", receiveCredential);
      window.clearInterval(closedWatcher);
      window.clearTimeout(timeout);
      callback(value);
    };
    const receiveCredential = async (event) => {
      if (event.origin !== window.location.origin || event.source !== popup) return;
      if (event.data?.type !== "calendar-auth-result" || event.data?.nonce !== nonce) return;
      if (event.data.error) {
        finish(reject, new Error(event.data.error));
        return;
      }
      try {
        const credential = GoogleAuthProvider.credential(event.data.idToken, event.data.accessToken);
        const result = await signInWithCredential(auth, credential);
        finish(resolve, result);
      } catch (error) {
        finish(reject, error);
      }
    };
    const closedWatcher = window.setInterval(() => {
      if (popup.closed) finish(reject, new Error("로그인 창이 닫혔습니다."));
    }, 500);
    const timeout = window.setTimeout(() => {
      popup.close();
      finish(reject, new Error("로그인 시간이 초과되었습니다. 다시 시도해 주세요."));
    }, 180000);
    window.addEventListener("message", receiveCredential);
  });
}

export function isAuthHelperPage() {
  return new URLSearchParams(window.location.search).get("authHelper") === "1";
}

export async function signInFromAuthHelper() {
  const nonce = new URLSearchParams(window.location.search).get("nonce");
  if (!nonce || !window.opener) throw new Error("원래 달력 창을 찾을 수 없습니다.");

  try {
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    window.opener.postMessage({
      type: "calendar-auth-result",
      nonce,
      idToken: credential?.idToken || null,
      accessToken: credential?.accessToken || null,
    }, window.location.origin);
    window.setTimeout(() => window.close(), 350);
    return result;
  } catch (error) {
    window.opener.postMessage({
      type: "calendar-auth-result",
      nonce,
      error: getAuthErrorMessage(error),
    }, window.location.origin);
    throw error;
  }
}

export function getAuthErrorMessage(error) {
  const messages = {
    "auth/popup-blocked": "로그인 창이 차단되었습니다. 팝업을 허용한 뒤 다시 시도해 주세요.",
    "auth/popup-closed-by-user": "Google 로그인 창이 완료되기 전에 닫혔습니다.",
    "auth/unauthorized-domain": "현재 사이트 주소가 Firebase 로그인 허용 주소에 등록되지 않았습니다.",
    "auth/cancelled-popup-request": "이미 로그인 창이 열려 있습니다.",
  };
  return messages[error?.code] || error?.message || "로그인 중 문제가 발생했습니다.";
}

function isEmbedded() {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export async function signOutUser() {
  await signOut(auth);
}
