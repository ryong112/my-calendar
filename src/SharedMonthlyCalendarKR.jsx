import { useEffect, useMemo, useState } from "react";
import { db, watchAuth, signIn, signOutUser, getAuthErrorMessage, finishRedirectSignIn } from "./firebase";
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, where } from "firebase/firestore";
import { getHolidayPreset } from "@hyunbinseo/holidays-kr";

const ADMIN_EMAILS = ["ryong112@gmail.com"];
const CENTER_ID = "gw-rehab-center";
const GROUPS = [
  { id: "public", name: "공공과", color: "#2563eb", tint: "#eff6ff" },
  { id: "regional", name: "지역센터", color: "#7c3aed", tint: "#f5f3ff" },
  { id: "assistive", name: "보조기기센터", color: "#059669", tint: "#ecfdf5" },
  { id: "repair", name: "수리지원센터", color: "#ea580c", tint: "#fff7ed" },
  { id: "general", name: "공통·기타", color: "#475569", tint: "#f1f5f9" },
];
const EVENT_TYPES = [
  { id: "business", name: "출장", icon: "🚗" },
  { id: "meeting", name: "회의", icon: "👥" },
  { id: "education", name: "교육", icon: "📘" },
  { id: "vacation", name: "휴가", icon: "🌿" },
  { id: "visit", name: "방문", icon: "📍" },
  { id: "other", name: "기타", icon: "•" },
];
const PRIORITIES = [
  { id: "normal", name: "일반", icon: "" },
  { id: "important", name: "중요", icon: "★" },
  { id: "urgent", name: "긴급", icon: "!" },
];

export default function SharedMonthlyCalendarKR() {
  const today = useMemo(() => atMidnight(new Date()), []);
  const [viewDate, setViewDate] = useState(today);
  const [selectedDate, setSelectedDate] = useState(today);
  const [events, setEvents] = useState({});
  const [filter, setFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [holidays, setHolidays] = useState({});
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [authError, setAuthError] = useState("");
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const isAdmin = Boolean(user && ADMIN_EMAILS.includes(user.email || ""));

  useEffect(() => watchAuth(setUser), []);
  useEffect(() => {
    finishRedirectSignIn().catch((reason) => setAuthError(getAuthErrorMessage(reason)));
  }, []);
  useEffect(() => {
    let active = true;
    const year = viewDate.getFullYear();
    Promise.all([year - 1, year, year + 1].map((value) => getHolidayPreset(String(value)).catch(() => ({}))))
      .then((presets) => { if (active) setHolidays(Object.assign({}, ...presets)); });
    return () => { active = false; };
  }, [viewDate]);
  useEffect(() => onSnapshot(
    query(collection(db, "events"), where("centerId", "==", CENTER_ID)),
    (snapshot) => {
      const grouped = {};
      snapshot.forEach((entry) => {
        const data = entry.data();
        const startDateKey = data.startDateKey || data.dateKey;
        const endDateKey = data.endDateKey || data.dateKey;
        if (!startDateKey) return;
        const normalizedEvent = {
          id: entry.id, title: data.title || "제목 없는 일정", body: data.body || "",
          group: hasGroup(data.group) ? data.group : "general", startTime: data.startTime || "",
          endTime: data.endTime || "", location: data.location || "",
          eventType: hasEventType(data.eventType) ? data.eventType : "other",
          priority: hasPriority(data.priority) ? data.priority : "normal",
          startDateKey, endDateKey,
          createdAt: data.createdAt?.toMillis?.() || 0,
        };
        dateKeysBetween(startDateKey, endDateKey).forEach((dateKey) => {
          (grouped[dateKey] ||= []).push(normalizedEvent);
        });
      });
      Object.values(grouped).forEach((items) => items.sort(sortEvents));
      setEvents(grouped); setLoading(false); setError("");
    },
    (reason) => { console.error(reason); setError("일정을 불러오지 못했습니다. 잠시 후 새로고침해 주세요."); setLoading(false); },
  ), []);

  const visibleEvents = useMemo(() => Object.fromEntries(
    Object.entries(events).map(([key, items]) => [key, items.filter((item) =>
      (filter === "all" || item.group === filter) && (typeFilter === "all" || item.eventType === typeFilter),
    )]),
  ), [events, filter, typeFilter]);
  const monthEvents = useMemo(() => eventsInMonth(visibleEvents, viewDate), [visibleEvents, viewDate]);
  const selectedEvents = visibleEvents[toKey(selectedDate)] || [];
  const todayEvents = visibleEvents[toKey(today)] || [];
  const nextEvent = monthEvents.find((item) => item.date >= today) || monthEvents[0];

  const openForm = (date) => {
    if (!isAdmin) return;
    const dateKey = toKey(date);
    setDraft({ startDateKey: dateKey, endDateKey: dateKey, title: "", body: "", group: hasGroup(filter) ? filter : "public", eventType: hasEventType(typeFilter) ? typeFilter : "meeting", priority: "normal", startTime: "", endTime: "", location: "" });
  };
  const save = async (formEvent) => {
    formEvent.preventDefault();
    if (!draft.title.trim() || draft.endDateKey < draft.startDateKey || saving) return;
    setSaving(true);
    try {
      await addDoc(collection(db, "events"), { ...draft, dateKey: draft.startDateKey, title: draft.title.trim(), body: draft.body.trim(), location: draft.location.trim(), centerId: CENTER_ID, createdAt: serverTimestamp() });
      const date = fromKey(draft.startDateKey); setSelectedDate(date); setViewDate(date); setDraft(null);
    } finally { setSaving(false); }
  };
  const remove = async (id) => {
    if (isAdmin && window.confirm("이 일정을 삭제할까요?")) await deleteDoc(doc(db, "events", id));
  };
  const handleSignIn = async () => {
    setAuthError("");
    try {
      await signIn();
    } catch (reason) {
      setAuthError(getAuthErrorMessage(reason));
    }
  };

  return <div className="min-h-screen bg-slate-100 text-slate-950 lg:flex lg:h-dvh lg:flex-col lg:overflow-hidden">
    <header className="shrink-0 border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-6">
        <div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-2xl bg-blue-600 text-2xl text-white shadow-lg shadow-blue-200">▦</div><div><p className="text-xs font-bold text-blue-600">통합 일정 공유</p><h1 className="text-2xl font-black tracking-tight">일정공유달력</h1><p className="text-xs text-slate-500">공공과 · 지역센터 · 보조기기센터 · 수리지원센터</p></div></div>
        <div className="flex items-center gap-2">{user && <span className={`hidden rounded-xl px-3 py-2 text-sm font-bold sm:block ${isAdmin ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>● {isAdmin ? "관리자 접속 중" : "등록 권한 없는 계정"}</span>}{user ? <button className="button-secondary" onClick={signOutUser}>로그아웃</button> : <button className="button-primary" onClick={handleSignIn}>관리자 로그인</button>}</div>
      </div>
    </header>
    <main className="mx-auto w-full max-w-[1600px] px-4 py-4 sm:px-6 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:px-6 lg:py-3">
      <section className="summary-grid mb-3 grid shrink-0 gap-3 sm:grid-cols-3">
        <Summary color="bg-blue-600" label="이번 달 전체 일정" value={`${monthEvents.length}건`} note={filter === "all" ? "전체 구분 기준" : getGroup(filter).name} />
        <Summary color="bg-emerald-600" label="오늘 일정" value={`${todayEvents.length}건`} note={formatDate(today, true)} />
        <Summary color="bg-violet-600" label="가장 가까운 일정" value={nextEvent ? shortDate(nextEvent.date) : "없음"} note={nextEvent?.title || "등록된 일정이 없습니다"} />
      </section>
      <section className="mb-3 shrink-0 rounded-2xl border border-slate-200 bg-white p-2.5 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-2"><button className="icon-button" onClick={() => setViewDate(addMonths(viewDate, -1))}>‹</button><div className="min-w-36 text-center"><p className="text-[10px] font-bold tracking-[.2em] text-slate-400">MONTHLY SCHEDULE</p><h2 className="text-2xl font-black">{viewDate.getFullYear()}년 {viewDate.getMonth() + 1}월</h2></div><button className="icon-button" onClick={() => setViewDate(addMonths(viewDate, 1))}>›</button><button className="button-secondary ml-1" onClick={() => { const now = atMidnight(new Date()); setViewDate(now); setSelectedDate(now); }}>오늘</button></div>
          <div className="flex flex-wrap gap-2"><Filter active={filter === "all"} label="전체 구분" onClick={() => setFilter("all")} />{GROUPS.map((group) => <Filter key={group.id} {...group} active={filter === group.id} label={group.name} onClick={() => setFilter(group.id)} />)}<select className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} aria-label="일정 카테고리 필터"><option value="all">모든 카테고리</option>{EVENT_TYPES.map((type) => <option key={type.id} value={type.id}>{type.icon} {type.name}</option>)}</select></div>
        </div>
      </section>
      {(error || authError) && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{authError || error}</div>}
      <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:flex lg:min-h-0 lg:flex-col"><div className="overflow-x-auto lg:flex lg:min-h-0 lg:flex-1 lg:flex-col"><div className="min-w-[680px] lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">{["일", "월", "화", "수", "목", "금", "토"].map((day, index) => <div key={day} className={`py-3 text-center text-sm font-black ${index === 0 ? "text-red-500" : index === 6 ? "text-blue-500" : "text-slate-600"}`}>{day}</div>)}</div>
          <div className="calendar-grid grid grid-cols-7 lg:min-h-0 lg:flex-1">{calendarDays(viewDate).map((date) => <Day key={toKey(date)} date={date} holidayNames={holidays[toKey(date)] || []} events={visibleEvents[toKey(date)] || []} faded={date.getMonth() !== viewDate.getMonth()} today={sameDay(date, today)} selected={sameDay(date, selectedDate)} select={() => setSelectedDate(date)} add={() => openForm(date)} />)}</div>
        </div></div>{loading && <p className="border-t p-3 text-center text-sm text-slate-500">일정을 불러오는 중입니다…</p>}</section>
        <aside className="lg:min-h-0"><section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:flex lg:h-full lg:min-h-0 lg:flex-col">
          <div className="mb-5 flex items-start justify-between gap-3"><div><p className="text-sm font-bold text-blue-600">선택한 날짜</p><h2 className="mt-1 text-xl font-black">{formatDate(selectedDate)}</h2></div><button className={isAdmin ? "button-primary" : "button-disabled"} onClick={() => openForm(selectedDate)} disabled={!isAdmin}>＋ 일정</button></div>
          {selectedEvents.length ? <div className="max-h-48 space-y-3 overflow-y-auto">{selectedEvents.map((event) => <Event key={event.id} event={event} admin={isAdmin} remove={() => remove(event.id)} />)}</div> : <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center"><p className="font-bold text-slate-600">등록된 일정이 없습니다</p><p className="mt-1 text-sm text-slate-400">{isAdmin ? "일정 버튼을 눌러 등록하세요." : "등록 즉시 실시간으로 표시됩니다."}</p></div>}
          <div className="mt-4 flex min-h-0 flex-1 flex-col border-t border-slate-100 pt-4"><div className="mb-3 flex shrink-0 justify-between"><h3 className="font-black">이달 일정 목록</h3><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold">{monthEvents.length}건</span></div><div className="min-h-0 flex-1 space-y-2 overflow-y-auto">{monthEvents.map((event) => <MonthItem key={`${event.startDateKey}-${event.id}`} event={event} select={() => setSelectedDate(event.date)} />)}</div></div>
        </section></aside>
      </div>
    </main>
    {draft && <EventForm draft={draft} setDraft={setDraft} saving={saving} close={() => setDraft(null)} save={save} />}
  </div>;
}

function Day({ date, holidayNames, events, faded, today, selected, select, add }) {
  const holiday = holidayNames.join("·");
  return <button className={`min-h-28 overflow-hidden border-b border-r border-slate-200 p-2 text-left transition hover:bg-blue-50/50 lg:min-h-0 ${faded ? "bg-slate-50/80" : "bg-white"} ${selected ? "z-10 ring-2 ring-inset ring-blue-500" : ""}`} onClick={select} onDoubleClick={add}><div className="mb-1.5 flex items-center justify-between gap-1"><span className={`grid h-6 min-w-6 place-items-center rounded-full text-xs font-black ${today ? "bg-blue-600 text-white" : faded ? "text-slate-300" : holiday || date.getDay() === 0 ? "text-red-500" : date.getDay() === 6 ? "text-blue-500" : "text-slate-700"}`}>{date.getDate()}</span>{holiday && <span className="truncate text-[9px] font-bold text-red-500" title={holiday}>{holiday}</span>}</div><div className="space-y-1">{events.slice(0, 3).map((event) => { const group = getGroup(event.group); const type = getEventType(event.eventType); const priority = getPriority(event.priority); const multiDay = event.startDateKey !== event.endDateKey; return <div key={event.id} className={`truncate rounded border-l-4 px-1.5 py-0.5 text-[11px] font-bold text-slate-700 shadow-sm ${event.priority === "urgent" ? "ring-1 ring-red-400" : event.priority === "important" ? "ring-1 ring-amber-400" : ""}`} style={{ backgroundColor: group.tint, borderColor: group.color }}>{priority.icon && <span className={event.priority === "urgent" ? "mr-1 text-red-600" : "mr-1 text-amber-500"}>{priority.icon}</span>}<span className="mr-1 opacity-60">{type.icon}</span>{multiDay && <span className="mr-1 opacity-60">{toKey(date) === event.startDateKey ? "시작" : toKey(date) === event.endDateKey ? "종료" : "계속"}</span>}{event.startTime && toKey(date) === event.startDateKey && <span className="mr-1 opacity-60">{event.startTime}</span>}{event.title}</div>; })}{events.length > 3 && <p className="px-1 text-[10px] font-bold text-slate-400">+ {events.length - 3}개 더보기</p>}</div></button>;
}
function Event({ event, admin, remove }) { const group = getGroup(event.group); const type = getEventType(event.eventType); const priority = getPriority(event.priority); return <article className={`overflow-hidden rounded-xl border shadow-sm ${event.priority === "urgent" ? "border-red-300" : event.priority === "important" ? "border-amber-300" : "border-slate-200"}`}><div className="h-1" style={{ backgroundColor: event.priority === "urgent" ? "#dc2626" : event.priority === "important" ? "#f59e0b" : group.color }} /><div className="p-3"><div className="flex justify-between gap-3"><div><div className="flex flex-wrap gap-1.5"><span className="rounded-full px-2 py-1 text-[11px] font-black" style={{ color: group.color, backgroundColor: group.tint }}>{group.name}</span><span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-black text-slate-600">{type.icon} {type.name}</span>{priority.id !== "normal" && <span className={`rounded-full px-2 py-1 text-[11px] font-black ${priority.id === "urgent" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>{priority.icon} {priority.name}</span>}</div><h3 className="mt-2 font-black">{event.title}</h3></div>{admin && <button className="text-sm text-slate-400 hover:text-red-600" onClick={remove}>삭제</button>}</div><p className="mt-2 text-xs font-semibold text-slate-500">📅 {formatRange(event.startDateKey, event.endDateKey)}</p>{(event.startTime || event.location) && <p className="mt-2 text-sm font-semibold text-slate-600">{event.startTime && `⏱ ${event.startTime}${event.endTime ? `–${event.endTime}` : ""}`}{event.location && `  📍 ${event.location}`}</p>}{event.body && <p className="mt-2 whitespace-pre-wrap border-t pt-2 text-sm leading-5 text-slate-600">{event.body}</p>}</div></article>; }
function MonthItem({ event, select }) { const group = getGroup(event.group); const type = getEventType(event.eventType); const priority = getPriority(event.priority); return <button className="flex w-full gap-3 rounded-xl border border-slate-100 p-3 text-left hover:bg-slate-50" onClick={select}><div className="w-9 text-center"><b className="text-lg">{event.date.getDate()}</b><p className="text-[10px] text-slate-400">{weekday(event.date)}</p></div><div className="min-w-0"><p className="truncate text-sm font-bold">{priority.icon && <span className={event.priority === "urgent" ? "mr-1 text-red-600" : "mr-1 text-amber-500"}>{priority.icon}</span>}{event.title}</p><p className="mt-1 truncate text-xs text-slate-500"><i className="mr-1 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: group.color }} />{group.name} · {type.icon} {type.name}{event.startTime && ` · ${event.startTime}`}</p></div></button>; }
function EventForm({ draft, setDraft, saving, close, save }) { const change = (key, value) => setDraft((old) => ({ ...old, [key]: value })); const invalidRange = draft.endDateKey < draft.startDateKey; return <div className="fixed inset-0 z-50 flex items-center justify-center p-4"><button className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={close} /><form className="relative max-h-[94vh] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl sm:p-6" onSubmit={save}><div className="mb-4 flex justify-between"><div><p className="text-sm font-bold text-blue-600">새로운 공유 일정</p><h2 className="text-2xl font-black">일정 등록</h2></div><button type="button" className="icon-button" onClick={close}>×</button></div><div className="space-y-4"><fieldset><legend className="form-label">구분 *</legend><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{GROUPS.map((group) => <button key={group.id} type="button" onClick={() => change("group", group.id)} className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold ${draft.group === group.id ? "border-slate-900 ring-1 ring-slate-900" : "border-slate-200"}`}><i className="h-3 w-3 rounded-full" style={{ backgroundColor: group.color }} />{group.name}</button>)}</div></fieldset><div className="grid grid-cols-2 gap-4"><fieldset><legend className="form-label">카테고리 *</legend><div className="grid grid-cols-2 gap-1.5">{EVENT_TYPES.map((type) => <button key={type.id} type="button" onClick={() => change("eventType", type.id)} className={`rounded-lg border px-2 py-1.5 text-xs font-bold ${draft.eventType === type.id ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200"}`}>{type.icon} {type.name}</button>)}</div></fieldset><fieldset><legend className="form-label">중요도 *</legend><div className="space-y-1.5">{PRIORITIES.map((priority) => <button key={priority.id} type="button" onClick={() => change("priority", priority.id)} className={`block w-full rounded-lg border px-2 py-1.5 text-xs font-bold ${draft.priority === priority.id ? priority.id === "urgent" ? "border-red-500 bg-red-50 text-red-700" : priority.id === "important" ? "border-amber-500 bg-amber-50 text-amber-700" : "border-slate-700 bg-slate-100" : "border-slate-200"}`}>{priority.icon} {priority.name}</button>)}</div></fieldset></div><div className="grid grid-cols-2 gap-4"><Input label="시작일 *" type="date" value={draft.startDateKey} change={(value) => { change("startDateKey", value); if (value > draft.endDateKey) change("endDateKey", value); }} required /><Input label="종료일 *" type="date" min={draft.startDateKey} value={draft.endDateKey} change={(value) => change("endDateKey", value)} required /></div>{invalidRange && <p className="text-sm font-bold text-red-600">종료일은 시작일보다 빠를 수 없습니다.</p>}<Input label="장소" value={draft.location} change={(value) => change("location", value)} placeholder="예: 본관 회의실" /><div className="grid grid-cols-2 gap-4"><Input label="시작 시간" type="time" value={draft.startTime} change={(value) => change("startTime", value)} /><Input label="종료 시간" type="time" value={draft.endTime} change={(value) => change("endTime", value)} /></div><Input label="일정 제목 *" value={draft.title} change={(value) => change("title", value)} placeholder="예: 지역센터 운영회의" required /><label><span className="form-label">상세 내용</span><textarea className="form-input min-h-24" value={draft.body} onChange={(e) => change("body", e.target.value)} placeholder="참석자, 준비사항 등을 입력하세요." /></label></div><div className="mt-5 flex justify-end gap-2 border-t pt-4"><button type="button" className="button-secondary" onClick={close}>취소</button><button className="button-primary" disabled={saving || !draft.title.trim() || invalidRange}>{saving ? "저장 중…" : "일정 저장"}</button></div></form></div>; }
function Input({ label, change, ...props }) { return <label><span className="form-label">{label}</span><input className="form-input" onChange={(event) => change(event.target.value)} {...props} /></label>; }
function Summary({ color, label, value, note }) { return <div className={`${color} rounded-2xl p-5 text-white shadow-lg`}><p className="text-sm font-bold opacity-80">{label}</p><div className="mt-2 flex items-end justify-between gap-3"><b className="text-3xl font-black">{value}</b><span className="max-w-[60%] truncate text-xs opacity-80">{note}</span></div></div>; }
function Filter({ active, label, color, onClick }) { return <button className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold ${active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600"}`} onClick={onClick}>{color && <i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />}{label}</button>; }

function hasGroup(id) { return GROUPS.some((group) => group.id === id); }
function getGroup(id) { return GROUPS.find((group) => group.id === id) || GROUPS.at(-1); }
function hasEventType(id) { return EVENT_TYPES.some((type) => type.id === id); }
function getEventType(id) { return EVENT_TYPES.find((type) => type.id === id) || EVENT_TYPES.at(-1); }
function hasPriority(id) { return PRIORITIES.some((priority) => priority.id === id); }
function getPriority(id) { return PRIORITIES.find((priority) => priority.id === id) || PRIORITIES[0]; }
function atMidnight(date) { const result = new Date(date); result.setHours(0, 0, 0, 0); return result; }
function toKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function fromKey(key) { const [year, month, day] = key.split("-").map(Number); return new Date(year, month - 1, day); }
function sameDay(a, b) { return toKey(a) === toKey(b); }
function addMonths(date, count) { return new Date(date.getFullYear(), date.getMonth() + count, 1); }
function calendarDays(viewDate) { const start = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1); start.setDate(start.getDate() - start.getDay()); return Array.from({ length: 42 }, (_, index) => { const day = new Date(start); day.setDate(start.getDate() + index); return atMidnight(day); }); }
function sortEvents(a, b) { if (a.startTime !== b.startTime) return !a.startTime ? 1 : !b.startTime ? -1 : a.startTime.localeCompare(b.startTime); return a.createdAt - b.createdAt; }
function eventsInMonth(events, viewDate) { const start = toKey(new Date(viewDate.getFullYear(), viewDate.getMonth(), 1)); const end = toKey(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0)); const unique = new Map(); Object.entries(events).forEach(([dateKey, items]) => { if (dateKey < start || dateKey > end) return; items.forEach((item) => { if (!unique.has(item.id)) unique.set(item.id, { ...item, dateKey, date: fromKey(dateKey) }); }); }); return [...unique.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey) || sortEvents(a, b)); }
function dateKeysBetween(startKey, endKey) { const start = fromKey(startKey); const end = fromKey(endKey || startKey); if (end < start) return [startKey]; const keys = []; const cursor = new Date(start); while (cursor <= end && keys.length < 731) { keys.push(toKey(cursor)); cursor.setDate(cursor.getDate() + 1); } return keys; }
function formatRange(startKey, endKey) { const start = fromKey(startKey); const end = fromKey(endKey || startKey); if (startKey === (endKey || startKey)) return `${start.getMonth() + 1}월 ${start.getDate()}일`; const nights = Math.max(0, Math.round((end - start) / 86400000)); return `${start.getMonth() + 1}.${start.getDate()} – ${end.getMonth() + 1}.${end.getDate()} (${nights}박 ${nights + 1}일)`; }
function weekday(date) { return `${["일", "월", "화", "수", "목", "금", "토"][date.getDay()]}요일`; }
function formatDate(date, short = false) { return `${short ? "" : `${date.getFullYear()}년 `}${date.getMonth() + 1}월 ${date.getDate()}일 ${weekday(date)}`; }
function shortDate(date) { return `${date.getMonth() + 1}/${date.getDate()} ${weekday(date)}`; }
