import test from "node:test";
import assert from "node:assert/strict";
import { normalizeGoogle, googleBody, toBusy, forAgent, addDaysTo, label } from "../app/static/calendar.js";

test("google items are normalized; cancelled and undated are dropped", () => {
  const out = normalizeGoogle([
    { id: "a", summary: "Dentist", start: { dateTime: "2026-11-14T15:00:00-05:00" }, end: { dateTime: "2026-11-14T16:00:00-05:00" } },
    { id: "b", start: { date: "2026-11-16" }, end: { date: "2026-11-17" } },
    { id: "c", summary: "Gone", status: "cancelled", start: { date: "2026-11-16" } },
    { id: "d", summary: "No start" },
  ]);
  assert.deepEqual(out.map((e) => [e.id, e.title, e.allDay, e.source]), [["a", "Dentist", false, "google"], ["b", "(no title)", true, "google"]]);
});

test("google body: all-day gets an exclusive end; timed uses UTC instants", () => {
  assert.deepEqual(googleBody({ title: "Pick up", start: "2026-11-16", end: "2026-11-16", allDay: true }).end, { date: "2026-11-17" });
  const t = googleBody({ title: "Call", notes: "n", start: "2026-11-14T12:00:00Z", end: "2026-11-14T12:30:00Z" });
  assert.equal(t.start.dateTime, "2026-11-14T12:00:00.000Z");
  assert.equal(t.description, "n");
});

test("busy times: timed single-day events only", () => {
  const d = (h, m = 0) => new Date(2026, 10, 14, h, m).toISOString();
  const busy = toBusy([
    { id: "1", title: "Standup", start: d(9), end: d(9, 30), allDay: false, source: "apple" },
    { id: "2", title: "Holiday", start: "2026-11-14", end: "2026-11-15", allDay: true, source: "google" },
    { id: "3", title: "Overnight", start: d(22), end: new Date(2026, 10, 15, 6).toISOString(), allDay: false, source: "google" },
  ]);
  assert.deepEqual(busy.map((b) => [b.id, b.date, b.start, b.end]), [["apple:1", "2026-11-14", "09:00", "09:30"]]);
});

test("assistant context is limited to the next days and capped", () => {
  const now = new Date(2026, 10, 14, 8);
  const ev = (n, dayOffset) => ({ title: `e${n}`, start: new Date(2026, 10, 14 + dayOffset, 10).toISOString(), end: new Date(2026, 10, 14 + dayOffset, 11).toISOString() });
  const out = forAgent([ev(1, 0), ev(2, 2), ev(3, 9), ev(4, -5)], { now, days: 3 });
  assert.deepEqual(out.map((e) => e.title), ["e1", "e2"]);
  assert.equal(forAgent(Array.from({ length: 50 }, (_, i) => ev(i, 1)), { now }).length, 30);
});

test("helpers", () => { assert.equal(addDaysTo("2026-11-30", 2), "2026-12-02"); assert.equal(label("apple"), "Apple Calendar"); });
