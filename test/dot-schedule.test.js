import test from "node:test";
import assert from "node:assert/strict";
import { createHandler, parseSchedule } from "../api/dot-schedule.js";
const valid = { requestKey: "google:synthetic-example-event-001", title: "예시 일정 (오후)", startDateKey: "2030-06-12", group: "repair", eventType: "visit", body: "오후 예정. 정확한 시각 미정." };
const token = "s".repeat(43);
const env = {
  DOT_CALENDAR_TOKEN: token, DOT_FIREBASE_API_KEY: "fake-api-key", DOT_FIREBASE_PROJECT_ID: "example-project",
  DOT_FIREBASE_WRITER_UID: "writer", DOT_FIREBASE_WRITER_REFRESH_TOKEN: "test-only-refresh",
};
async function call(handler, override = {}) {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(s) { this.code = s; return this; }, json(body) { this.body = body; return this; } };
  await handler({ method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: valid, ...override }, res);
  assert.equal(res.headers["Cache-Control"], "no-store");
  return res;
}
test("date-only afternoon text, fixed defaults and deterministic no-browser ID", () => {
  const a = parseSchedule(valid);
  assert.match(a.id, /^dot_[0-9a-f]{64}$/);
  assert.equal(a.event.startTime, "");
  assert.equal(a.event.endDateKey, valid.startDateKey);
  assert.match(a.event.body, /오후 예정/);
  assert.equal(a.event.status, "planned");
  assert.deepEqual(a, parseSchedule(JSON.stringify(valid)));
});
test("rejects unauthorized fields, inconsistent datetimes and invalid dates", () => {
  for (const diff of [{ centerId: "elsewhere" }, { group: "all" }, { startDateKey: "2026-02-30" }, { endTime: "12:20" }, { requestKey: "../unsafe" }, { startTime: "16:00", endTime: "14:00" }, { endDateKey: "2026-11-03" }, { title: "" }]) {
    assert.throws(() => parseSchedule({ ...valid, ...diff }));
  }
});
test("deny GET, wrong bearer, wrong content type, disabled configuration without upstream", async () => {
  const noCall = () => assert.fail("unexpected upstream");
  const h = createHandler({ env, fetcher: noCall });
  assert.equal((await call(h, { method: "GET" })).code, 405);
  assert.equal((await call(h, { headers: { authorization: "Bearer " + "x".repeat(43) } })).code, 401);
  assert.equal((await call(h, { headers: { authorization: "Bearer " + token } })).code, 415);
  assert.equal((await call(h, { body: { ...valid, owner: "x" } })).code, 400);
  assert.equal((await call(createHandler({ env: {}, fetcher: noCall }))).code, 503);
});
test("create, same-key exact replay, and conflict after changed content", async () => {
  const db = new Map();
  let signedIn = 0;
  const h = createHandler({ env, fetcher: async (url, opt) => {
    if (url.startsWith("https://securetoken.googleapis.com/")) {
      assert.equal(new URL(url).pathname, "/v1/token");
      assert.equal(opt.headers["Content-Type"], "application/x-www-form-urlencoded");
      assert.equal(new URLSearchParams(opt.body).get("grant_type"), "refresh_token");
      assert.equal(new URLSearchParams(opt.body).get("refresh_token"), "test-only-refresh");
      signedIn++;
      return new Response(JSON.stringify({ user_id: "writer", id_token: "fake-id-token" }));
    }
    assert.match(url, /^https:\/\/firestore\.googleapis\.com\//);
    assert.equal(opt.headers.Authorization, "Bearer fake-id-token");
    if (opt.method === "GET") return new Response(JSON.stringify(db.get(url.split("/").at(-1))));
    assert.equal(opt.method, "POST");
    const id = new URL(url).searchParams.get("documentId");
    if (db.has(id)) return new Response("", { status: 409 });
    const obj = JSON.parse(opt.body);
    assert.equal(obj.fields.source.stringValue, "dot");
    assert.doesNotMatch(opt.body, /test-only-refresh|requestKey/);
    db.set(id, obj);
    return new Response("{}", { status: 200 });
  } });
  const first = await call(h);
  assert.equal(first.code, 201);
  assert.deepEqual((await call(h)).body, { id: first.body.id, created: false });
  assert.equal((await call(h, { body: { ...valid, title: "changed" } })).code, 409);
  assert.equal(db.size, 1);
  assert.equal(signedIn, 3);
});
test("refuses a credential for the wrong Firebase UID; upstream secrets are not reflected", async () => {
  let n = 0;
  const h = createHandler({ env, fetcher: async () => {
    n++;
    return new Response(JSON.stringify({ user_id: "wrong", id_token: "private" }));
  } });
  assert.deepEqual((await call(h)).body, { error: "writer_unavailable" });
  assert.equal(n, 1);
});
