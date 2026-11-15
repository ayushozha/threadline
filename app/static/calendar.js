// Calendar connections. Google runs entirely in this browser (Google's own sign-in, token kept in memory only).
// Apple goes through the server's stateless CalDAV adapter (credentials sent per request, never stored).
// Nothing here writes without the page asking after a tap.
export const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

const pad = (n) => String(n).padStart(2, "0");
export const dayOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const clockOf = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const addDaysTo = (day, n) => { const [y, m, d] = day.split("-").map(Number); return dayOf(new Date(y, m - 1, d + n)); };

/* ---------- pure helpers (unit-tested) ---------- */
export function normalizeGoogle(items = []) {
  return items.filter((e) => e.status !== "cancelled" && (e.start?.dateTime || e.start?.date)).map((e) => {
    const allDay = Boolean(e.start.date && !e.start.dateTime);
    return { id: e.id, title: e.summary || "(no title)", start: e.start.dateTime || e.start.date, end: e.end?.dateTime || e.end?.date || e.start.dateTime || e.start.date, allDay, source: "google" };
  });
}
export function googleBody({ title, notes = "", start, end, allDay = false }) {
  const body = { summary: title, description: notes || undefined, source: { title: "Threadline", url: "https://threadline.ayushojha.com" } };
  if (allDay) { const s = start.slice(0, 10); let e = end.slice(0, 10); if (e <= s) e = addDaysTo(s, 1); return { ...body, start: { date: s }, end: { date: e } }; }
  return { ...body, start: { dateTime: new Date(start).toISOString() }, end: { dateTime: new Date(end).toISOString() } };
}
// Timed events that sit inside one local day → the planner's busy-time shape. All-day items don't block time.
export function toBusy(events) {
  const out = [];
  for (const e of events) {
    if (e.allDay) continue;
    const s = new Date(e.start), t = new Date(e.end);
    if (isNaN(s) || isNaN(t) || t <= s || dayOf(s) !== dayOf(t)) continue;
    out.push({ id: `${e.source}:${e.id}`, title: e.title.slice(0, 120), date: dayOf(s), start: clockOf(s), end: clockOf(t), created_by: e.source });
  }
  return out;
}
// Small read-only context for the assistant: next few days, titles and times only.
export function forAgent(events, { now = new Date(), days = 3, max = 30 } = {}) {
  const until = new Date(now.getTime() + days * 86400000);
  return events.filter((e) => { const s = new Date(e.start); return s >= new Date(now.getTime() - 3600000) && s <= until; })
    .sort((a, b) => new Date(a.start) - new Date(b.start)).slice(0, max)
    .map((e) => ({ title: e.title.slice(0, 120), start: String(e.start).slice(0, 40), end: String(e.end).slice(0, 40) }));
}
export const label = (source) => (source === "google" ? "Google Calendar" : source === "apple" ? "Apple Calendar" : "calendar");

/* ---------- Google ---------- */
let gis;
function loadGis() {
  gis ||= new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const s = document.createElement("script"); s.src = "https://accounts.google.com/gsi/client"; s.async = true;
    s.onload = () => resolve(); s.onerror = () => reject(new Error("Couldn't load Google sign-in (blocked or offline)."));
    document.head.append(s);
  });
  return gis;
}
export async function googleSignIn(clientId) {
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId, scope: GOOGLE_SCOPE,
      callback: (r) => (r.error ? reject(new Error(r.error_description || r.error)) : resolve({ token: r.access_token, expiresAt: Date.now() + (r.expires_in || 3600) * 1000 })),
      error_callback: (e) => reject(new Error(e?.type === "popup_closed" ? "Sign-in window closed." : e?.message || "Google sign-in failed.")),
    });
    client.requestAccessToken({ prompt: "" });
  });
}
async function gfetch(token, url, init = {}) {
  const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  if (r.status === 401) throw Object.assign(new Error("Google sign-in expired. Connect again."), { expired: true });
  if (!r.ok) throw new Error(`Google Calendar said ${r.status}.`);
  return r.status === 204 ? null : r.json();
}
export async function googleList(token, startDay, endDay) {
  const q = new URLSearchParams({ timeMin: new Date(`${startDay}T00:00:00`).toISOString(), timeMax: new Date(`${addDaysTo(endDay, 1)}T00:00:00`).toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "100" });
  return normalizeGoogle((await gfetch(token, `${API}?${q}`)).items);
}
export async function googleCreate(token, ev) {
  const made = await gfetch(token, API, { method: "POST", body: JSON.stringify(googleBody(ev)) });
  return { id: made.id, link: made.htmlLink };
}

/* ---------- Apple (via the server's CalDAV adapter) ---------- */
export async function appleList(post, auth, startDay, endDay) {
  const data = await post("/api/apple/events", { auth, start: startDay, end: endDay });
  return data.events.map((e) => ({ ...e, source: "apple" }));
}
export async function appleCreate(post, auth, ev) {
  const start = ev.allDay ? ev.start.slice(0, 10) : new Date(ev.start).toISOString(), end = ev.allDay ? ev.end.slice(0, 10) : new Date(ev.end).toISOString();
  return post("/api/apple/create", { auth, title: ev.title, notes: ev.notes || "", start, end, all_day: Boolean(ev.allDay) });
}
