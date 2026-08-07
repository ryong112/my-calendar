// src/App.jsx
import React, { useEffect, useState } from "react";
import SharedMonthlyCalendarKR from "./SharedMonthlyCalendarKR";
import { finishAuthHelperRedirect, getAuthErrorMessage, isAuthHelperPage, signInFromAuthHelper } from "./firebase";

export default function App() {
  if (isAuthHelperPage()) return <AuthHelper />;
  return <SharedMonthlyCalendarKR />;
}

function AuthHelper() {
  const [status, setStatus] = useState("ready");
  const [message, setMessage] = useState("");

  useEffect(() => {
    finishAuthHelperRedirect()
      .then((result) => {
        if (result) {
          setStatus("success");
          setMessage("로그인이 완료되었습니다. 달력으로 돌아갑니다.");
        }
      })
      .catch((error) => {
        setStatus("error");
        setMessage(getAuthErrorMessage(error));
      });
  }, []);

  const startLogin = async () => {
    setStatus("loading");
    setMessage("");
    try {
      await signInFromAuthHelper();
      setStatus("success");
      setMessage("로그인이 완료되었습니다. 달력으로 돌아갑니다.");
    } catch (error) {
      setStatus("error");
      setMessage(getAuthErrorMessage(error));
    }
  };

  return (
    <main className="grid min-h-dvh place-items-center bg-slate-100 p-5 text-slate-950">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-xl">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-blue-600 text-3xl text-white shadow-lg shadow-blue-200">▦</div>
        <p className="mt-6 text-sm font-bold text-blue-600">일정공유달력</p>
        <h1 className="mt-1 text-2xl font-black">관리자 로그인</h1>
        <p className="mt-3 text-sm leading-6 text-slate-500">Google 계정으로 로그인하면 문서함 안의 달력에서도 일정을 등록하고 관리할 수 있습니다.</p>
        <button className="button-primary mt-7 w-full py-3" onClick={startLogin} disabled={status === "loading" || status === "success"}>
          {status === "loading" ? "Google 로그인 여는 중…" : status === "success" ? "로그인 완료" : "Google 계정으로 계속"}
        </button>
        {message && <p className={`mt-4 rounded-xl px-4 py-3 text-sm font-bold ${status === "error" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>{message}</p>}
        <p className="mt-5 text-xs leading-5 text-slate-400">이 창은 인증이 완료되면 자동으로 닫힙니다.</p>
      </section>
    </main>
  );
}
