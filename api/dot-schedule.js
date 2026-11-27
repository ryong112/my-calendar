import { createHash, timingSafeEqual } from "node:crypto";

const CENTER_ID = "gw-rehab-center";
const GROUPS = new Set(["public", "regional", "assistive", "repair", "general"]);
const TYPES = new Set(["business", "meeting", "education", "vacation", "visit", "other"]);
const FIELDS = new Set(["requestKey", "title", "startDateKey", "endDateKey", "startTime", "endTime", "location", "body", "group", "eventType", "status"]);
const sha = (value) => createHash("sha256").update(value).digest();
const date = (value) => {
  if (!/^20\d\d-\d\d-\d\d$/.test(value)) return false;
  const millis = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(millis) && new Date(millis).toISOString().slice(0, 10) === value;
};
const time = (value) => !value || (value.length === 5 && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value));

export function parseSchedule(body) {
  if (typeof body === "string") {
    if (Buffer.byteLength(body) > 8192) throw new Error("invalid");
    body = JSON.parse(body);
  }
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some((key) => !FIELDS.has(key) || typeof body[key] !== "string") ||
      Buffer.byteLength(JSON.stringify(body)) > 8192) throw new Error("invalid");
  const { requestKey, group, eventType, startDateKey } = body;
  const endDateKey = body.endDateKey ?? startDateKey;
  const startTime = body.startTime ?? "";
  const endTime = body.endTime ?? "";
  const status = body.status ?? "planned";
  const title = body.title?.trim();
  const location = body.location?.trim() ?? "";
  const details = body.body?.trim() ?? "";
  if (!requestKey || requestKey.length < 8 || requestKey.length > 200 || /[^a-zA-Z0-9:_-]/.test(requestKey) ||
      !title || title.length > 140 || location.length > 200 || details.length > 1200 ||
      !GROUPS.has(group) || !TYPES.has(eventType) || !["planned", "confirmed"].includes(status) ||
      !date(startDateKey) || !date(endDateKey) || endDateKey < startDateKey ||
      (Date.parse(endDateKey) - Date.parse(startDateKey)) / 86400000 > 31 ||
      !time(startTime) || !time(endTime) || (endTime && !startTime) ||
      (startDateKey === endDateKey && endTime && endTime <= startTime)) throw new Error("invalid");
  const id = "dot_" + sha(CENTER_ID + ":" + requestKey).toString("hex");
  return { id, event: {
    centerId: CENTER_ID, dateKey: startDateKey, startDateKey, endDateKey, startTime, endTime,
    title, body: details, location, group, eventType, status, priority: "normal", source: "dot",
  } };
}

function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(body);
}
const jsonHeaders = { "Content-Type": "application/json" };

export function createHandler({ env = process.env, fetcher = globalThis.fetch, clock = () => new Date() } = {}) {
  return async (req, res) => {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return send(res, 405, { error: "method_not_allowed" });
    }
    const { DOT_CALENDAR_TOKEN, DOT_FIREBASE_API_KEY, DOT_FIREBASE_PROJECT_ID, DOT_FIREBASE_WRITER_UID, DOT_FIREBASE_WRITER_REFRESH_TOKEN } = env;
    if (!DOT_CALENDAR_TOKEN || !/^[A-Za-z0-9_-]{43,128}$/.test(DOT_CALENDAR_TOKEN) ||
        !DOT_FIREBASE_API_KEY || !/^[a-z][a-z0-9-]+$/.test(DOT_FIREBASE_PROJECT_ID ?? "") ||
        !DOT_FIREBASE_WRITER_UID || !DOT_FIREBASE_WRITER_REFRESH_TOKEN) {
      return send(res, 503, { error: "not_configured" });
    }
    const bearer = typeof req.headers.authorization === "string" && req.headers.authorization.match(/^Bearer ([A-Za-z0-9_-]{43,128})$/i);
    if (!bearer || !timingSafeEqual(sha(bearer[1]), sha(DOT_CALENDAR_TOKEN))) return send(res, 401, { error: "unauthorized" });
    if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] ?? "")) {
      return send(res, 415, { error: "json_required" });
    }
    let parsed;
    try { parsed = parseSchedule(req.body); } catch { return send(res, 400, { error: "invalid_schedule" }); }
    const { id, event } = parsed;
    const upstream = (url, options) => fetcher(url, { ...options, redirect: "error", signal: AbortSignal.timeout(6000) });
    try {
      const auth = await upstream("https://securetoken.googleapis.com/v1/token?key=" + encodeURIComponent(DOT_FIREBASE_API_KEY), {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: DOT_FIREBASE_WRITER_REFRESH_TOKEN }).toString(),
      });
      const principal = auth.ok ? await auth.json() : null;
      if (!principal?.id_token || principal.user_id !== DOT_FIREBASE_WRITER_UID) return send(res, 502, { error: "writer_unavailable" });
      const resource = "https://firestore.googleapis.com/v1/projects/" + DOT_FIREBASE_PROJECT_ID + "/databases/(default)/documents/events";
      const headers = { ...jsonHeaders, Authorization: "Bearer " + principal.id_token };
      const fields = Object.fromEntries(Object.entries(event).map(([key, value]) => [key, { stringValue: value }]));
      const now = { timestampValue: clock().toISOString() };
      const response = await upstream(resource + "?documentId=" + id, {
        method: "POST", headers, body: JSON.stringify({ fields: { ...fields, createdAt: now, updatedAt: now } }),
      });
      if (response.ok) return send(res, 201, { id, created: true });
      if (response.status === 409) {
        const existing = await upstream(resource + "/" + id, { method: "GET", headers });
        const document = existing.ok ? await existing.json() : null;
        if (!document) return send(res, 502, { error: "verification_unavailable" });
        if (Object.entries(event).every(([key, value]) => document.fields?.[key]?.stringValue === value)) {
          return send(res, 200, { id, created: false });
        }
        return send(res, 409, { error: "request_key_conflict", id });
      }
      return send(res, 502, { error: "write_unavailable" });
    } catch {
      return send(res, 502, { error: "upstream_unavailable" });
    }
  };
}

export default createHandler();
