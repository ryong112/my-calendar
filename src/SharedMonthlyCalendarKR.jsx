import { useEffect, useMemo, useState } from "react";
import { db, watchAuth, signIn, signOutUser } from "./firebase";
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, where } from "firebase/firestore";

const ADMIN_EMAILS = ["ryong112@gmail.com"];
const CENTER_ID = "gw-rehab-center";
const GROUPS = [
  { id: "public", name: "공공과", color: "#2563eb", tint: "#eff6ff" },
  { id: "regional", name: "지역센터", color: "#7c3aed", tint: "#f5f3ff" },
  { id: "assistive", name: "보조기기센터", color: "#059669", tint: "#ecfdf5" },
  { id: "repair", name: "수리지원센터", color: "#ea580c", tint: "#fff7ed" },
  { id: "general", name: "공통·기타", color: "#475569", tint: "#f1f5f9" },
];

export default function SharedMonthlyCalendarKR() {
  const today = useMemo(() => atMidnight(new Date()), []);
  const [viewDate, setViewDate] = useState(today);
  const [selectedDate, setSelectedDate] = useState(today);
  const [events, setEvents] = useState({});
  const [filter, setFilter] = useState("all");
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const isAdmin = Boolean(user && ADMIN_EMAILS.includes(user.email || ""));

  useEffect(() => watchAuth(setUser), []);
  useEffect(() => onSnapshot(
    query(collection(db, "events"), where("centerId", "==", CENTER_ID)),
    (snapshot) => {
      const grouped = {};
      snapshot.forEach((entry) => {
        const data = entry.data();
        if (!data.dateKey) return;
        (grouped[data.dateKey] ||= []).push({
          id: entry.id, title: data.title || "제목 없는 일정", body: data.body || "",
          group: hasGroup(data.group) ? data.group : "general", startTime: data.startTime || "",
          endTime: data.endTime || "", location: data.location || "",
          createdAt: data.createdAt?.toMillis?.() || 0,
        });
      });
      Object.values(grouped).forEach((items) => items.sort(sortEvents));
      setEvents(grouped); setLoading(false); setError("");
    },
    (reason) => { console.error(reason); setError("일정을 불러오지 못했습니다. 잠시 후 새로고침해 주세요."); setLoading(false); },
  ), []);

  const visibleEvents = useMemo(() => filter === "all" ? events : Object.fromEntries(
    Object.entries(events).map(([key, items]) => [key, items.filter((item) => item.group === filter)]),
  ), [events, filter]);
  const monthEvents = useMemo(() => eventsInMonth(visibleEvents, viewDate), [visibleEvents, viewDate]);
  const selectedEvents = visibleEvents[toKey(selectedDate)] || [];
  const todayEvents = visibleEvents[toKey(today)] || [];
  const nextEvent = monthEvents.find((item) => item.date >= today) || monthEvents[0];

  const openForm = (date) => {
    if (!isAdmin) return;
    setDraft({ dateKey: toKey(date), title: "", body: "", group: hasGroup(filter) ? filter : "public", startTime: "", endTime: "", location: "" });
  };
  const save = async (formEvent) => {
    formEvent.preventDefault();
    if (!draft.title.trim() || saving) return;
    setSaving(true);
    try {
      await addDoc(collection(db, "events"), { ...draft, title: draft.title.trim(), body: draft.body.trim(), location: draft.location.trim(), centerId: CENTER_ID, createdAt: serverTimestamp() });
      const date = fromKey(draft.dateKey); setSelectedDate(date); setViewDate(date); setDraft(null);
    } finally { setSaving(false); }
  };
  const remove = async (id) => {
    if (isAdmin && window.confirm("이 일정을 삭제할까요?")) await deleteDoc(doc(db, "events", id));
  };

  return <div className="min-h-screen bg-slate-100 text-slate-950">
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-5 px-4 py-6 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <div className="flex items-center gap-4"><div className="grid h-12 w-12 place-items-center rounded-2xl bg-blue-600 text-2xl text-white shadow-lg shadow-blue-200">▦</div><div><p className="text-sm font-bold text-blue-600">통합 일정 공유</p><h1 className="text-2xl font-black tracking-tight sm:text-3xl">기관장 일정 보드</h1><p className="mt-1 text-sm text-slate-500">공공과 · 지역센터 · 보조기기센터 · 수리지원센터</p></div></div>
        <div className="flex items-center gap-2">{user && <span className="hidden rounded-xl bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700 sm:block">● 관리자 접속 중</span>}{user ? <button className="button-secondary" onClick={signOutUser}>로그아웃</button> : <button className="button-primary" onClick={signIn}>관리자 로그인</button>}</div>
      </div>
    </header>
    <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
      <section className="mb-6 grid gap-3 sm:grid-cols-3">
        <Summary color="bg-blue-600" label="이번 달 전체 일정" value={`${monthEvents.length}건`} note={filter === "all" ? "전체 기관 기준" : getGroup(filter).name} />
        <Summary color="bg-emerald-600" label="오늘 일정" value={`${todayEvents.length}건`} note={formatDate(today, true)} />
        <Summary color="bg-violet-600" label="가장 가까운 일정" value={nextEvent ? shortDate(nextEvent.date) : "없음"} note={nextEvent?.title || "등록된 일정이 없습니다"} />
      </section>
      <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-2"><button className="icon-button" onClick={() => setViewDate(addMonths(viewDate, -1))}>‹</button><div className="min-w-36 text-center"><p className="text-[10px] font-bold tracking-[.2em] text-slate-400">MONTHLY SCHEDULE</p><h2 className="text-2xl font-black">{viewDate.getFullYear()}년 {viewDate.getMonth() + 1}월</h2></div><button className="icon-button" onClick={() => setViewDate(addMonths(viewDate, 1))}>›</button><button className="button-secondary ml-1" onClick={() => { const now = atMidnight(new Date()); setViewDate(now); setSelectedDate(now); }}>오늘</button></div>
          <div className="flex flex-wrap gap-2"><Filter active={filter === "all"} label="전체 기관" onClick={() => setFilter("all")} />{GROUPS.map((group) => <Filter key={group.id} {...group} active={filter === group.id} label={group.name} onClick={() => setFilter(group.id)} />)}</div>
        </div>
      </section>
      {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="overflow-x-auto"><div className="min-w-[820px]">
          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">{["일", "월", "화", "수", "목", "금", "토"].map((day, index) => <div key={day} className={`py-3 text-center text-sm font-black ${index === 0 ? "text-red-500" : index === 6 ? "text-blue-500" : "text-slate-600"}`}>{day}</div>)}</div>
          <div className="grid grid-cols-7">{calendarDays(viewDate).map((date) => <Day key={toKey(date)} date={date} events={visibleEvents[toKey(date)] || []} faded={date.getMonth() !== viewDate.getMonth()} today={sameDay(date, today)} selected={sameDay(date, selectedDate)} select={() => setSelectedDate(date)} add={() => openForm(date)} />)}</div>
        </div></div>{loading && <p className="border-t p-3 text-center text-sm text-slate-500">일정을 불러오는 중입니다…</p>}</section>
        <aside><section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:sticky xl:top-5">
          <div className="mb-5 flex items-start justify-between gap-3"><div><p className="text-sm font-bold text-blue-600">선택한 날짜</p><h2 className="mt-1 text-xl font-black">{formatDate(selectedDate)}</h2></div><button className={isAdmin ? "button-primary" : "button-disabled"} onClick={() => openForm(selectedDate)} disabled={!isAdmin}>＋ 일정</button></div>
          {selectedEvents.length ? <div className="space-y-3">{selectedEvents.map((event) => <Event key={event.id} event={event} admin={isAdmin} remove={() => remove(event.id)} />)}</div> : <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-7 text-center"><p className="font-bold text-slate-600">등록된 일정이 없습니다</p><p className="mt-1 text-sm text-slate-400">{isAdmin ? "일정 버튼을 눌러 등록하세요." : "등록 즉시 실시간으로 표시됩니다."}</p></div>}
          <div className="mt-6 border-t border-slate-100 pt-5"><div className="mb-3 flex justify-between"><h3 className="font-black">이달 일정 목록</h3><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold">{monthEvents.length}건</span></div><div className="max-h-[360px] space-y-2 overflow-y-auto">{monthEvents.map((event) => <MonthItem key={`${event.dateKey}-${event.id}`} event={event} select={() => setSelectedDate(event.date)} />)}</div></div>
        </section></aside>
      </div>
    </main>
    {draft && <EventForm draft={draft} setDraft={setDraft} saving={saving} close={() => setDraft(null)} save={save} />}
  </div>;
}

function Day({ date, events, faded, today, selected, select, add }) {
  const holiday = getHoliday(date);
  return <button className={`min-h-36 border-b border-r border-slate-200 p-2.5 text-left transition hover:bg-blue-50/50 ${faded ? "bg-slate-50/80" : "bg-white"} ${selected ? "z-10 ring-2 ring-inset ring-blue-500" : ""}`} onClick={select} onDoubleClick={add}><div className="mb-2 flex items-center justify-between"><span className={`grid h-7 min-w-7 place-items-center rounded-full text-sm font-black ${today ? "bg-blue-600 text-white" : faded ? "text-slate-300" : holiday || date.getDay() === 0 ? "text-red-500" : date.getDay() === 6 ? "text-blue-500" : "text-slate-700"}`}>{date.getDate()}</span>{holiday && <span className="text-[10px] font-bold text-red-500">{holiday}</span>}</div><div className="space-y-1.5">{events.slice(0, 3).map((event) => { const group = getGroup(event.group); return <div key={event.id} className="truncate rounded-md border-l-4 px-2 py-1 text-xs font-bold text-slate-700 shadow-sm" style={{ backgroundColor: group.tint, borderColor: group.color }}>{event.startTime && <span className="mr-1 opacity-60">{event.startTime}</span>}{event.title}</div>; })}{events.length > 3 && <p className="px-1 text-[11px] font-bold text-slate-400">+ {events.length - 3}개 더보기</p>}</div></button>;
}
function Event({ event, admin, remove }) { const group = getGroup(event.group); return <article className="overflow-hidden rounded-xl border border-slate-200 shadow-sm"><div className="h-1" style={{ backgroundColor: group.color }} /><div className="p-4"><div className="flex justify-between gap-3"><div><span className="rounded-full px-2 py-1 text-[11px] font-black" style={{ color: group.color, backgroundColor: group.tint }}>{group.name}</span><h3 className="mt-2 font-black">{event.title}</h3></div>{admin && <button className="text-sm text-slate-400 hover:text-red-600" onClick={remove}>삭제</button>}</div>{(event.startTime || event.location) && <p className="mt-3 text-sm font-semibold text-slate-600">{event.startTime && `⏱ ${event.startTime}${event.endTime ? `–${event.endTime}` : ""}`}{event.location && `  📍 ${event.location}`}</p>}{event.body && <p className="mt-3 whitespace-pre-wrap border-t pt-3 text-sm leading-6 text-slate-600">{event.body}</p>}</div></article>; }
function MonthItem({ event, select }) { const group = getGroup(event.group); return <button className="flex w-full gap-3 rounded-xl border border-slate-100 p-3 text-left hover:bg-slate-50" onClick={select}><div className="w-9 text-center"><b className="text-lg">{event.date.getDate()}</b><p className="text-[10px] text-slate-400">{weekday(event.date)}</p></div><div className="min-w-0"><p className="truncate text-sm font-bold">{event.title}</p><p className="mt-1 text-xs text-slate-500"><i className="mr-1 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: group.color }} />{group.name}{event.startTime && ` · ${event.startTime}`}</p></div></button>; }
function EventForm({ draft, setDraft, saving, close, save }) { const change = (key, value) => setDraft((old) => ({ ...old, [key]: value })); return <div className="fixed inset-0 z-50 flex items-center justify-center p-4"><button className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={close} /><form className="relative max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl sm:p-8" onSubmit={save}><div className="mb-6 flex justify-between"><div><p className="text-sm font-bold text-blue-600">새로운 공유 일정</p><h2 className="text-2xl font-black">일정 등록</h2></div><button type="button" className="icon-button" onClick={close}>×</button></div><div className="space-y-5"><fieldset><legend className="form-label">담당 기관 *</legend><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{GROUPS.map((group) => <button key={group.id} type="button" onClick={() => change("group", group.id)} className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-bold ${draft.group === group.id ? "border-slate-900 ring-1 ring-slate-900" : "border-slate-200"}`}><i className="h-3 w-3 rounded-full" style={{ backgroundColor: group.color }} />{group.name}</button>)}</div></fieldset><div className="grid gap-4 sm:grid-cols-2"><Input label="날짜 *" type="date" value={draft.dateKey} change={(value) => change("dateKey", value)} required /><Input label="장소" value={draft.location} change={(value) => change("location", value)} placeholder="예: 본관 회의실" /></div><div className="grid grid-cols-2 gap-4"><Input label="시작 시간" type="time" value={draft.startTime} change={(value) => change("startTime", value)} /><Input label="종료 시간" type="time" value={draft.endTime} change={(value) => change("endTime", value)} /></div><Input label="일정 제목 *" value={draft.title} change={(value) => change("title", value)} placeholder="예: 지역센터 운영회의" required /><label><span className="form-label">상세 내용</span><textarea className="form-input min-h-28" value={draft.body} onChange={(e) => change("body", e.target.value)} placeholder="참석자, 준비사항 등을 입력하세요." /></label></div><div className="mt-7 flex justify-end gap-2 border-t pt-5"><button type="button" className="button-secondary" onClick={close}>취소</button><button className="button-primary" disabled={saving || !draft.title.trim()}>{saving ? "저장 중…" : "일정 저장"}</button></div></form></div>; }
function Input({ label, change, ...props }) { return <label><span className="form-label">{label}</span><input className="form-input" onChange={(event) => change(event.target.value)} {...props} /></label>; }
function Summary({ color, label, value, note }) { return <div className={`${color} rounded-2xl p-5 text-white shadow-lg`}><p className="text-sm font-bold opacity-80">{label}</p><div className="mt-2 flex items-end justify-between gap-3"><b className="text-3xl font-black">{value}</b><span className="max-w-[60%] truncate text-xs opacity-80">{note}</span></div></div>; }
function Filter({ active, label, color, onClick }) { return <button className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold ${active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600"}`} onClick={onClick}>{color && <i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />}{label}</button>; }

function hasGroup(id) { return GROUPS.some((group) => group.id === id); }
function getGroup(id) { return GROUPS.find((group) => group.id === id) || GROUPS.at(-1); }
function atMidnight(date) { const result = new Date(date); result.setHours(0, 0, 0, 0); return result; }
function toKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function fromKey(key) { const [year, month, day] = key.split("-").map(Number); return new Date(year, month - 1, day); }
function sameDay(a, b) { return toKey(a) === toKey(b); }
function addMonths(date, count) { return new Date(date.getFullYear(), date.getMonth() + count, 1); }
function calendarDays(viewDate) { const start = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1); start.setDate(start.getDate() - start.getDay()); return Array.from({ length: 42 }, (_, index) => { const day = new Date(start); day.setDate(start.getDate() + index); return atMidnight(day); }); }
function sortEvents(a, b) { if (a.startTime !== b.startTime) return !a.startTime ? 1 : !b.startTime ? -1 : a.startTime.localeCompare(b.startTime); return a.createdAt - b.createdAt; }
function eventsInMonth(events, viewDate) { const start = toKey(new Date(viewDate.getFullYear(), viewDate.getMonth(), 1)); const end = toKey(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0)); return Object.entries(events).flatMap(([dateKey, items]) => dateKey >= start && dateKey <= end ? items.map((item) => ({ ...item, dateKey, date: fromKey(dateKey) })) : []).sort((a, b) => a.dateKey.localeCompare(b.dateKey) || sortEvents(a, b)); }
function weekday(date) { return `${["일", "월", "화", "수", "목", "금", "토"][date.getDay()]}요일`; }
function formatDate(date, short = false) { return `${short ? "" : `${date.getFullYear()}년 `}${date.getMonth() + 1}월 ${date.getDate()}일 ${weekday(date)}`; }
function shortDate(date) { return `${date.getMonth() + 1}/${date.getDate()} ${weekday(date)}`; }
function getHoliday(date) { return ({ "1-1": "신정", "3-1": "삼일절", "5-5": "어린이날", "6-6": "현충일", "8-15": "광복절", "10-3": "개천절", "10-9": "한글날", "12-25": "성탄절" })[`${date.getMonth() + 1}-${date.getDate()}`] || ""; }
