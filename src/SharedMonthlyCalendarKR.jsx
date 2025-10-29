// src/SharedMonthlyCalendarKR.jsx
import React, { useEffect, useMemo, useState } from "react";
import { db, watchAuth, signIn, signOutUser } from "./firebase";
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  where,
  serverTimestamp,
} from "firebase/firestore";

export default function SharedMonthlyCalendarKR() {
  // ====== 환경(센터/권한) ======
  const ADMIN_EMAILS = ["ryong112@gmail.com"]; // ← 관리자 이메일로 바꾸세요 (여러명 가능)
  const CENTER_ID = "gw-rehab-center";         // ← 센터 식별자(원하면 다른 문자열로)

  // ====== 상태 ======
  const today = useMemo(() => new Date(), []);
  const [viewDate, setViewDate] = useState(() => stripTime(today));
  const [selectedDate, setSelectedDate] = useState(() => stripTime(today));

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [draftDate, setDraftDate] = useState(() => toKey(today));

  // events: { [dateKey]: Array<{id,title,body,createdAt}> }
  const [events, setEvents] = useState({});
  const [user, setUser] = useState(null);
  const isAdmin = !!(user && ADMIN_EMAILS.includes(user.email || ""));

  // 인증 상태 구독
  useEffect(() => {
    const off = watchAuth((u) => setUser(u));
    return () => off && off();
  }, []);

  // Firestore 실시간 구독 (센터별 모든 일정)
  useEffect(() => {
    const q = query(collection(db, "events"), where("centerId", "==", CENTER_ID));
    const unsub = onSnapshot(q, (snap) => {
      const map = {};
      snap.forEach((ds) => {
        const data = ds.data();
        const k = data.dateKey; // "YYYY-MM-DD"
        const ev = {
          id: ds.id,
          title: data.title || "",
          body: data.body || "",
          createdAt: data.createdAt ? data.createdAt.toMillis() : 0,
        };
        if (!map[k]) map[k] = [];
        map[k].push(ev);
      });
      // 날짜별 시간순 정렬
      Object.keys(map).forEach((k) => map[k].sort((a, b) => a.createdAt - b.createdAt));
      setEvents(map);
    });
    return () => unsub();
  }, []);

  // 달력 그리드
  const monthMatrix = useMemo(() => buildMonthMatrix(viewDate), [viewDate]);

  // 이달 전체 일정 목록 (현재 보이는 달 기준)
  const monthEvents = useMemo(() => {
    const y = viewDate.getFullYear();
    const m = viewDate.getMonth();
    const startKey = `${y}-${String(m + 1).padStart(2, "0")}-01`;
    const endDate = new Date(y, m + 1, 0).getDate();
    const endKey = `${y}-${String(m + 1).padStart(2, "0")}-${String(endDate).padStart(2, "0")}`;
    const items = [];
    Object.keys(events).forEach((k) => {
      if (k >= startKey && k <= endKey) {
        (events[k] || []).forEach((ev) => items.push({ dateKey: k, dateObj: fromKey(k), ...ev }));
      }
    });
    items.sort((a, b) => {
      const ad = a.dateObj.getTime();
      const bd = b.dateObj.getTime();
      return ad !== bd ? ad - bd : a.createdAt - b.createdAt;
    });
    return items;
  }, [events, viewDate]);

  // 버튼/모달 핸들러
  const handlePrevMonth = () => setViewDate((d) => addMonths(d, -1));
  const handleNextMonth = () => setViewDate((d) => addMonths(d, 1));
  const handleToday = () => setViewDate(stripTime(new Date()));

  const openAddModal = (dateKey) => {
    if (!isAdmin) return;
    setDraftDate(dateKey);
    setDraftTitle("");
    setDraftBody("");
    setIsModalOpen(true);
  };
  const closeModal = () => setIsModalOpen(false);

  const addEvent = async () => {
    const title = draftTitle.trim();
    const body = draftBody.trim();
    if (!isAdmin || !title) return;

    await addDoc(collection(db, "events"), {
      centerId: CENTER_ID,
      dateKey: draftDate,
      title,
      body,
      createdAt: serverTimestamp(),
    });

    setIsModalOpen(false);
    setSelectedDate(fromKey(draftDate));
  };

  const removeEvent = async (dateKey, id) => {
    if (!isAdmin) return;
    await deleteDoc(doc(db, "events", id));
  };

  const selectedKey = toKey(selectedDate);
  const selectedEvents = events[selectedKey] || [];
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth() + 1;

  // ====== UI ======
  const weekDays = ["일", "월", "화", "수", "목", "금", "토"];

  return (
    <div className="min-h-screen w-full bg-neutral-950 text-neutral-100 p-6">
      <div className="mx-auto max-w-6xl">
        {/* 헤더 */}
        <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold">
              {year}년 {month}월
            </h1>
            <p className="text-neutral-400 text-sm mt-1">
              원하는 날짜 셀을 <span className="font-semibold">더블클릭</span>하여 일정 추가
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={handlePrevMonth} className="px-3 py-2 rounded-2xl bg-neutral-800 hover:bg-neutral-700 transition shadow">
              이전 달
            </button>
            <button onClick={handleToday} className="px-3 py-2 rounded-2xl bg-neutral-800 hover:bg-neutral-700 transition shadow">
              오늘
            </button>
            <button onClick={handleNextMonth} className="px-3 py-2 rounded-2xl bg-neutral-800 hover:bg-neutral-700 transition shadow">
              다음 달
            </button>

            {/* 로그인/로그아웃 */}
            {user ? (
              <button onClick={signOutUser} className="px-3 py-2 rounded-2xl bg-neutral-700 hover:bg-neutral-600">로그아웃</button>
            ) : (
              <button onClick={signIn} className="px-3 py-2 rounded-2xl bg-emerald-700 hover:bg-emerald-600">관리자 로그인</button>
            )}
          </div>
        </header>

        {/* 본문: 달력 + 사이드바 */}
        <main className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 달력 */}
          <section className="lg:col-span-2">
            <div className="rounded-3xl overflow-hidden shadow-xl ring-1 ring-neutral-800">
              {/* 요일 헤더 */}
              <div className="grid grid-cols-7 bg-neutral-900">
                {weekDays.map((d) => (
                  <div key={d} className="p-3 text-center text-sm font-semibold text-neutral-300">{d}</div>
                ))}
              </div>

              {/* 날짜 그리드 */}
              <div className="grid grid-cols-7">
                {monthMatrix.map((cell, idx) => {
                  const isCurrentMonth = cell.date.getMonth() === viewDate.getMonth();
                  const isToday = sameDay(cell.date, today);
                  const key = toKey(cell.date);
                  const count = (events[key] || []).length;

                  const weekday = cell.date.getDay();
                  const holidayName = getKoreanHolidayName(cell.date);
                  const isHoliday = !!holidayName;

                  return (
                    <div
                      key={idx}
                      onDoubleClick={() => openAddModal(key)}
                      onClick={() => setSelectedDate(cell.date)}
                      className={[
                        "h-28 sm:h-32 border border-neutral-900 p-2 cursor-pointer select-none",
                        isCurrentMonth ? "bg-neutral-950" : "bg-neutral-950/50",
                        "hover:bg-neutral-900/60 transition relative",
                      ].join(" ")}
                    >
                      <div className="flex items-center justify-between">
                        <div
                          className={[
                            "text-sm font-medium",
                            isCurrentMonth
                              ? (isHoliday || weekday === 0 || weekday === 6) ? "text-red-400" : "text-neutral-100"
                              : "text-neutral-500",
                          ].join(" ")}
                        >
                          {cell.date.getDate()}
                        </div>
                        <div className="flex items-center gap-1">
                          {isToday && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-600/20 text-emerald-300 border border-emerald-700/40">오늘</span>
                          )}
                          {isHoliday && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-900/30 text-red-300 border border-red-800/40" title={holidayName}>
                              {holidayName.length > 5 ? "공휴일" : holidayName}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* 일정 배지 */}
                      {count > 0 && (
                        <div className="absolute bottom-2 right-2 text-xs px-2 py-1 rounded-full bg-neutral-800/80 border border-neutral-700/40 text-neutral-200">
                          {count}건
                        </div>
                      )}

                      {/* 일정 미리보기(2개) */}
                      <div className="mt-2 space-y-1">
                        {(events[key] || []).slice(0, 2).map((ev) => (
                          <div key={ev.id} className="truncate text-xs px-2 py-1 rounded-md bg-neutral-900/60 border border-neutral-800/60">
                            • {ev.title}
                          </div>
                        ))}
                        {(events[key] || []).length > 2 && (
                          <div className="text-[11px] text-neutral-500">그 외 {(events[key] || []).length - 2}건…</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          {/* 사이드바 */}
          <aside className="lg:col-span-1">
            <div className="rounded-3xl p-5 bg-neutral-950 shadow-xl ring-1 ring-neutral-800 sticky top-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">
                  {selectedDate.getFullYear()}년 {selectedDate.getMonth() + 1}월 {selectedDate.getDate()}일
                </h2>

                <button
                  className={
                    "px-3 py-2 rounded-2xl " +
                    (isAdmin ? "bg-emerald-700 hover:bg-emerald-600" : "bg-neutral-800 opacity-50 cursor-not-allowed")
                  }
                  onClick={() => isAdmin && openAddModal(toKey(selectedDate))}
                  disabled={!isAdmin}
                >
                  + 일정추가
                </button>
              </div>

              {selectedEvents.length === 0 ? (
                <p className="text-neutral-400 text-sm">등록된 일정이 없습니다. 더블클릭 또는 ‘+ 일정추가’를 눌러 추가하세요.</p>
              ) : (
                <ul className="space-y-3">
                  {selectedEvents.map((ev) => (
                    <li key={ev.id} className="p-3 rounded-2xl bg-neutral-900 border border-neutral-800">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-medium">{ev.title}</div>
                          {ev.body && <p className="text-sm text-neutral-300 whitespace-pre-wrap mt-1">{ev.body}</p>}
                          <div className="text-[11px] text-neutral-500 mt-2">등록: {formatDatetime(ev.createdAt)}</div>
                        </div>
                        {isAdmin && (
                          <button
                            onClick={() => removeEvent(toKey(selectedDate), ev.id)}
                            className="text-xs px-2 py-1 rounded-xl bg-red-700/80 hover:bg-red-600 transition"
                            title="삭제"
                          >
                            삭제
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {/* 안내 + 이달 전체 일정 */}
              <div className="mt-6 text-xs text-neutral-500 leading-5">
                <p className="mb-2 font-semibold text-neutral-300">공유/배포 안내</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>현재 버전은 Firestore에 저장되어, 모두가 동일한 달력을 봅니다.</li>
                  <li>읽기는 전체 공개, 작성/삭제는 관리자 로그인 필요(구글).</li>
                </ol>
              </div>

              <div className="mt-6">
                <h3 className="text-base font-semibold mb-3">이달 전체 일정</h3>
                {monthEvents.length === 0 ? (
                  <p className="text-sm text-neutral-400">이번 달 등록된 일정이 없습니다.</p>
                ) : (
                  <ul className="space-y-2 max-h-[48vh] overflow-auto pr-1">
                    {monthEvents.map((item) => (
                      <li
                        key={item.id + item.dateKey}
                        className="p-3 rounded-xl bg-neutral-900 border border-neutral-800 hover:bg-neutral-800/70 cursor-pointer"
                        onClick={() => setSelectedDate(item.dateObj)}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium">{item.title}</div>
                            {item.body && <div className="text-xs text-neutral-300 mt-1 line-clamp-2">{item.body}</div>}
                          </div>
                          <div className="text-xs text-neutral-400 whitespace-nowrap">{item.dateKey}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </aside>
        </main>
      </div>

      {/* 모달 */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/70" onClick={closeModal} />
          <div className="relative z-10 w-[92vw] max-w-lg rounded-3xl bg-neutral-950 p-5 shadow-2xl ring-1 ring-neutral-800">
            <h3 className="text-xl font-semibold mb-4">일정 추가</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-neutral-300 mb-1">날짜</label>
                <input
                  type="date"
                  value={draftDate}
                  onChange={(e) => setDraftDate(e.target.value)}
                  className="w-full bg-neutral-900 border border-neutral-700 rounded-2xl px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>
              <div>
                <label className="block text-sm text-neutral-300 mb-1">제목 *</label>
                <input
                  type="text"
                  placeholder="예) 서울 본원 출장 (오전)"
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  className="w-full bg-neutral-900 border border-neutral-700 rounded-2xl px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>
              <div>
                <label className="block text-sm text-neutral-300 mb-1">내용</label>
                <textarea
                  placeholder="상세 내용/장소/연락처 등"
                  value={draftBody}
                  onChange={(e) => setDraftBody(e.target.value)}
                  rows={5}
                  className="w-full bg-neutral-900 border border-neutral-700 rounded-2xl px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-600 resize-y"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={closeModal} className="px-4 py-2 rounded-2xl bg-neutral-800 hover:bg-neutral-700">취소</button>
              <button
                onClick={addEvent}
                className={"px-4 py-2 rounded-2xl " + (isAdmin ? "bg-emerald-700 hover:bg-emerald-600" : "bg-neutral-800 opacity-50 cursor-not-allowed")}
                disabled={!isAdmin}
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ========================= 유틸리티 ========================= */
function stripTime(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function sameDay(a,b) { return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }
function addMonths(d, diff) { const x = new Date(d); x.setDate(1); x.setMonth(x.getMonth()+diff); return stripTime(x); }
function startOfMonth(d){ return stripTime(new Date(d.getFullYear(), d.getMonth(), 1)); }
function endOfMonth(d){ return stripTime(new Date(d.getFullYear(), d.getMonth()+1, 0)); }

function buildMonthMatrix(viewDate){
  const start = startOfMonth(viewDate);
  const end = endOfMonth(viewDate);
  const startWeekday = start.getDay();
  const days = [];
  if (startWeekday > 0) {
    for (let i = startWeekday - 1; i >= 0; i--) {
      const d = new Date(start);
      d.setDate(start.getDate() - (i + 1));
      days.push({ date: stripTime(d) });
    }
  }
  for (let d = 1; d <= end.getDate(); d++) {
    days.push({ date: new Date(viewDate.getFullYear(), viewDate.getMonth(), d) });
  }
  while (days.length % 7 !== 0 || days.length < 42) {
    const last = days[days.length - 1].date;
    const next = new Date(last);
    next.setDate(last.getDate() + 1);
    days.push({ date: stripTime(next) });
  }
  return days;
}

function toKey(d){ const date = typeof d==="string" ? new Date(d) : d; const y=date.getFullYear(); const m=String(date.getMonth()+1).padStart(2,"0"); const dd=String(date.getDate()).padStart(2,"0"); return `${y}-${m}-${dd}`; }
function fromKey(key){ const [y,m,d]=key.split("-").map((v)=>parseInt(v,10)); return new Date(y,(m||1)-1,d||1); }

function formatDatetime(ts){
  const d = new Date(ts);
  const yy=d.getFullYear(); const mm=String(d.getMonth()+1).padStart(2,"0"); const dd=String(d.getDate()).padStart(2,"0");
  const hh=String(d.getHours()).padStart(2,"0"); const mi=String(d.getMinutes()).padStart(2,"0");
  return `${yy}.${mm}.${dd} ${hh}:${mi}`;
}

/* 한국 주말/공휴일(양력 고정일) */
function getKoreanHolidayName(date){
  const m = date.getMonth()+1; const d = date.getDate();
  const fixed = {
    "1-1":"신정","3-1":"삼일절","5-5":"어린이날","6-6":"현충일",
    "8-15":"광복절","10-3":"개천절","10-9":"한글날","12-25":"성탄절"
  };
  const key = `${m}-${d}`;
  return fixed[key] || "";
}
