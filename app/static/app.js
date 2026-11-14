"use strict";
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) { if (key.includes("-")) node.setAttribute(key, value); else node[key] = value; }
  node.append(...children.filter((c) => c != null)); return node;
};
const HOUR = 3600000, DAY = 24 * HOUR;
const ago = (days, hour = 20, minute = 0) => { const d = new Date(Date.now() - days * DAY); d.setHours(hour, minute, 0, 0); return d.toISOString(); };
const localDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return localDate(d); };
const fmtWhen = (iso) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const fmtDate = (iso) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
const fmtClock = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); };
const SOURCE_LABELS = { typed: "Typed", vexo: "Vexo band · reviewed", watch: "Apple Watch · reviewed", mic: "Browser mic · reviewed", upload: "Audio file · reviewed" };

const MODES = {
  reflection: { description: "Personal reflection: keep your own words with their source, revisit them later, and get only the support you chose. Cycle timing is optional self-reported context — never a cause, diagnosis, or judgment." },
  routine: { description: "Resume a routine: recover your stated intention and the last thing you recorded. A recorded action is not proof it happened — Threadline asks when progress is unknown." },
};
const day = tomorrow();

let mode = "reflection", busy = false;
// Everything below starts empty and holds only what this person captured, typed or saved.
const emptyThread = () => ({ reflection: { question: "", notes: [], prefs: [] }, routine: { question: "", notes: [], prefs: [] } });
let sessions = emptyThread();
const agent = { offer: null, events: [], proposal: null, skip: [], log: [], created: null, duration: 30, window: "afternoon" };
// Stored in this browser per band (localStorage); nothing is stored on the server.
let threadKey = "", threadLoaded = false;
function loadThread(key) {
  threadKey = key; threadLoaded = false;
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(`threadline.thread.v1.${key}`) || "null"); } catch { saved = null; }
  sessions = emptyThread();
  if (saved) for (const m of ["reflection", "routine"]) Object.assign(sessions[m], { notes: saved[m]?.notes || [], prefs: saved[m]?.prefs || [] });
  Object.assign(agent, { offer: null, events: saved?.events || [], proposal: null, skip: [], log: [], created: null });
  threadLoaded = true;
}
function saveThread() {
  if (!threadLoaded) return;
  try {
    localStorage.setItem(`threadline.thread.v1.${threadKey}`, JSON.stringify({
      reflection: { notes: sessions.reflection.notes, prefs: sessions.reflection.prefs },
      routine: { notes: sessions.routine.notes }, events: agent.events,
    }));
  } catch { message("This browser blocked storage, so notes will be lost on refresh.", true); }
}
const capture = { active: false, band: null, ws: null, recorder: null, stream: null, startedAt: null, timer: 0, review: null, finals: [] };

function message(text, error = false) { $("status").textContent = text; $("status").classList.toggle("error", error); }
function newId(prefix) { return `${prefix}-${crypto.randomUUID().slice(0, 8)}`; }

/* ---------- Thread ---------- */
function renderTimeline() {
  const session = sessions[mode];
  if (typeof scheduleGraph === "function") scheduleGraph();
  saveThread();
  $("sample-label").textContent = `Your statements only — stored in this browser${threadKey.startsWith("band-") ? ` for Vexo-HACK-${threadKey.slice(5).padStart(2, "0")}` : ""}. Nothing is stored on the server.`;
  $("timeline").replaceChildren();
  for (const note of session.notes) {
    const time = el("time", { dateTime: note.at, textContent: fmtWhen(note.at) }, el("span", { className: "note-id", textContent: note.id }));
    const badge = el("span", { className: `badge ${note.source}`, textContent: SOURCE_LABELS[note.source] || note.source });
    const text = el("p", { textContent: note.text });
    const li = el("li", { id: `note-${note.id}` }, time, el("div", { className: "meta" }, badge, el("span", { className: "speaker", textContent: "Speaker: you" })), text);
    if (note.context) li.append(el("p", { className: "context", textContent: note.context }));
    {
      const edit = el("button", { type: "button", className: "text-button", textContent: "Correct" });
      const del = el("button", { type: "button", className: "text-button", textContent: "Delete" });
      edit.addEventListener("click", () => editNote(li, note));
      del.addEventListener("click", () => { session.notes = session.notes.filter((n) => n !== note); renderTimeline(); message("Note deleted from this session."); });
      li.append(el("div", { className: "row tight" }, edit, del));
    }
    $("timeline").append(li);
  }
  if (!session.notes.length) $("timeline").append(el("p", { className: "empty", textContent: "Nothing yet. Capture a conversation or type a note — only what you save appears here." }));
}
function editNote(li, note) {
  const area = el("textarea", { value: note.text, rows: 2, maxLength: 4000 });
  const save = el("button", { type: "button", className: "secondary", textContent: "Save correction" });
  save.addEventListener("click", () => { const value = area.value.trim(); if (value) { note.text = value; note.corrected = true; } renderTimeline(); message("Correction saved."); });
  li.querySelector("p").replaceWith(area); li.querySelector(".row.tight").replaceWith(el("div", { className: "row tight" }, save)); area.focus();
}
function addNotes(items) {
  const session = sessions[mode];
  const added = items.map((item) => ({ id: newId("n"), context: "", ...item }));
  session.notes.push(...added); renderTimeline();
  for (const note of added) checkPreferences(note);
  return added;
}

/* ---------- Preferences ---------- */
function renderPrefs() {
  saveThread();
  $("prefs-section").hidden = mode !== "reflection";
  const list = $("prefs"); list.replaceChildren();
  for (const pref of sessions[mode].prefs) {
    const remove = el("button", { type: "button", className: "text-button", textContent: "Remove" });
    remove.addEventListener("click", () => { sessions[mode].prefs = sessions[mode].prefs.filter((p) => p !== pref); renderPrefs(); });
    list.append(el("li", {},
      el("p", { textContent: `“${pref.text}”` }),
      el("p", { className: "caption", textContent: `Matches: ${pref.triggers.join(", ")} · ${pref.action === "schedule" ? "offers schedule help" : "shows earlier notes only"} · saved ${fmtDate(pref.at)}` }),
      remove));
  }
  if (!sessions[mode].prefs.length) list.append(el("li", { className: "empty", textContent: "No preferences saved. Threadline will not offer help on its own." }));
}
$("pref-save").addEventListener("click", () => {
  const text = $("pref-text").value.trim(), triggers = $("pref-triggers").value.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (!text || !triggers.length) return message("Write the preference and at least one matching word.", true);
  sessions[mode].prefs.push({ id: newId("pref"), text, triggers, action: $("pref-action").value, at: new Date().toISOString(), source: "typed" });
  $("pref-text").value = ""; $("pref-triggers").value = ""; renderPrefs(); message("Preference saved for this session.");
});

function checkPreferences(note) {
  if (mode !== "reflection") return;
  const lower = note.text.toLowerCase();
  for (const pref of sessions.reflection.prefs) {
    const hit = pref.triggers.find((word) => lower.includes(word));
    if (!hit) continue;
    const terms = [...pref.triggers, "evening", "free"];
    const evidence = sessions.reflection.notes
      .filter((n) => n.id !== note.id && terms.some((t) => n.text.toLowerCase().includes(t)))
      .sort((a, b) => (b.text.toLowerCase().includes("helped") - a.text.toLowerCase().includes("helped")) || (new Date(a.at) - new Date(b.at)))
      .slice(0, 2);
    agent.offer = { note, pref, hit, evidence, status: "offered" };
    renderSupport(); $("support").scrollIntoView({ behavior: "smooth", block: "nearest" });
    return;
  }
}

/* ---------- Support offer ---------- */
const sourceLink = (id) => el("a", { href: `#note-${id}`, className: "src", textContent: id });
function renderSupport() {
  const box = $("support"), offer = agent.offer;
  box.hidden = mode !== "reflection" || !offer;
  if (box.hidden) return;
  const why = el("ul", { className: "why" },
    el("li", {}, el("strong", { textContent: "You just said: " }), `“${offer.note.text}” `, el("span", { className: "caption", textContent: `${fmtWhen(offer.note.at)} · ${SOURCE_LABELS[offer.note.source]} ` }), sourceLink(offer.note.id)),
    el("li", {}, el("strong", { textContent: "You saved: " }), `“${offer.pref.text}” `, el("span", { className: "caption", textContent: `saved ${fmtDate(offer.pref.at)}` })),
    ...offer.evidence.map((n) => el("li", {}, el("strong", { textContent: "Earlier you said: " }), `“${n.text}” `, el("span", { className: "caption", textContent: `${fmtDate(n.at)} · ${SOURCE_LABELS[n.source]} ` }), sourceLink(n.id))));
  const children = [
    el("p", { className: "eyebrow", textContent: "Support you asked for" }),
    el("h3", { textContent: offer.pref.action === "schedule" ? "Want to look at tomorrow and make some space?" : "Here's what you said before." }),
    el("p", { className: "caption", textContent: "Why this is showing:" }), why,
    el("p", { className: "caption", textContent: `Matched by your own word “${offer.hit}” using a local rule — no AI, and no inference about your mood, cycle, or judgment.` }),
  ];
  if (offer.status === "offered" && offer.pref.action === "schedule") {
    const yes = el("button", { type: "button", className: "primary", innerHTML: "Review my schedule <span aria-hidden=\"true\">→</span>" });
    const no = el("button", { type: "button", className: "text-button", textContent: "Not now — just keep the note" });
    yes.addEventListener("click", () => { offer.status = "accepted"; renderSupport(); renderCalendar(); $("calendar").scrollIntoView({ behavior: "smooth", block: "start" }); });
    no.addEventListener("click", () => { offer.status = "declined"; renderSupport(); message("Okay. Your note is saved and nothing else will happen."); });
    children.push(yes, no);
  } else if (offer.status === "declined") {
    children.push(el("p", { className: "done", textContent: "Declined. Your note stays in your thread; no action taken." }));
  }
  box.replaceChildren(...children);
}

/* ---------- Schedule agent (your busy times in this browser; approved blocks export as .ics) ---------- */
const WINDOWS = { afternoon: ["12:00", "17:00", "tomorrow afternoon"], evening: ["17:00", "21:00", "tomorrow evening"], morning: ["08:00", "12:00", "tomorrow morning"] };
function logStep(text, kind = "") { agent.log.push({ text, kind }); }
async function postJSON(url, body) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}
async function findSlot() {
  const [start, end] = WINDOWS[agent.window];
  logStep(`Checking your Threadline schedule (${agent.events.filter((e) => e.date === day).length} busy times entered) for ${agent.duration} minutes ${WINDOWS[agent.window][2]}…`);
  const { ok, data } = await postJSON("/api/schedule/find-slot", { events: agent.events, date: day, window_start: start, window_end: end, duration_minutes: agent.duration, skip: agent.skip });
  if (!ok) { logStep("The planner rejected the request. Nothing changed.", "bad"); agent.proposal = null; return; }
  for (const c of data.checked) logStep(`${fmtClock(c.start)}–${fmtClock(c.end)}: ${c.status === "free" ? "free" : `${c.status} (${c.detail})`}`, c.status === "free" ? "good" : "muted");
  agent.proposal = data.slot;
  logStep(data.slot ? `Proposed ${fmtClock(data.slot.start)}–${fmtClock(data.slot.end)}. Waiting for your approval.` : "No free time in that window. Nothing was created — try another window or length.", data.slot ? "" : "bad");
}
async function bookProposal() {
  const p = agent.proposal;
  logStep(`You approved ${fmtClock(p.start)}–${fmtClock(p.end)}. Re-checking before creating…`);
  const { ok, status, data } = await postJSON("/api/schedule/book", { events: agent.events, event: { title: "Quiet time (protected)", date: p.date, start: p.start, end: p.end } });
  if (ok) {
    agent.events.push(data.event); agent.created = data.event; agent.proposal = null;
    logStep(`Created “${data.event.title}” ${fmtClock(data.event.start)}–${fmtClock(data.event.end)} in your Threadline schedule.`, "good");
    message("Created in your Threadline schedule. Download the .ics to add it to your own calendar.");
    saveThread();
  } else if (status === 409) {
    const names = (data.conflicts || []).map((c) => `“${c.title}”`).join(", ");
    logStep(`Conflict: ${names} now occupies that time. Nothing was created.`, "bad");
    logStep("Your preference and request are unchanged. Looking again…");
    agent.proposal = null; await findSlot();
  } else { logStep("Booking failed. Nothing was created.", "bad"); }
}
function icsFor(e) {
  const stamp = (d, t) => `${d.replaceAll("-", "")}T${t.replace(":", "")}00`;
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Threadline//EN", "BEGIN:VEVENT", `UID:${e.id}@threadline`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
    `DTSTART:${stamp(e.date, e.start)}`, `DTEND:${stamp(e.date, e.end)}`, `SUMMARY:${e.title}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
}
function renderCalendar() {
  const box = $("calendar");
  box.hidden = mode !== "reflection" || agent.offer?.status !== "accepted";
  saveThread();
  if (box.hidden) return;
  const events = agent.events.filter((e) => e.date === day).sort((a, b) => a.start.localeCompare(b.start));
  const list = el("ul", { className: "events" }, ...events.map((e) => {
    const remove = el("button", { type: "button", className: "text-button", textContent: "Remove", "aria-label": `Remove ${e.title}` });
    remove.addEventListener("click", () => { agent.events = agent.events.filter((x) => x !== e); if (agent.created?.id === e.id) agent.created = null; renderCalendar(); });
    return el("li", { className: e.created_by === "threadline" ? "mine" : "" },
      el("span", { className: "when", textContent: `${fmtClock(e.start)}–${fmtClock(e.end)}` }), el("span", { textContent: e.title }),
      e.created_by === "threadline" ? el("span", { className: "badge typed", textContent: "created by Threadline" }) : null, remove);
  }));
  if (!events.length) list.append(el("li", { className: "empty", textContent: "No busy times entered for tomorrow." }));
  const dateLabel = new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
  const busyTitle = el("input", { type: "text", placeholder: "What's on (e.g. team sync)", maxLength: 120, "aria-label": "Busy time title" });
  const busyStart = el("input", { type: "time", value: "13:00", "aria-label": "Starts" }), busyEnd = el("input", { type: "time", value: "14:00", "aria-label": "Ends" });
  const addBusy = el("button", { type: "button", className: "secondary", textContent: "Add busy time" });
  addBusy.addEventListener("click", () => {
    if (!busyTitle.value.trim() || busyEnd.value <= busyStart.value) return message("Give the busy time a name and an end after its start.", true);
    agent.events.push({ id: newId("cal"), title: busyTitle.value.trim(), date: day, start: busyStart.value, end: busyEnd.value });
    logStep(`You added “${busyTitle.value.trim()}” ${fmtClock(busyStart.value)}–${fmtClock(busyEnd.value)}.`, "muted");
    renderCalendar();
  });
  const duration = el("select", { id: "cal-duration" }, ...[15, 30, 60].map((m) => el("option", { value: m, textContent: m === 30 ? "thirty minutes" : `${m} minutes`, selected: m === agent.duration })));
  const windowSel = el("select", { id: "cal-window" }, ...Object.entries(WINDOWS).map(([k, w]) => el("option", { value: k, textContent: w[2], selected: k === agent.window })));
  duration.addEventListener("change", () => { agent.duration = Number(duration.value); });
  windowSel.addEventListener("change", () => { agent.window = windowSel.value; });
  const find = el("button", { type: "button", className: "secondary", textContent: "Find a time" });
  find.addEventListener("click", () => run(async () => { agent.skip = []; agent.proposal = null; await findSlot(); }));
  const children = [
    el("p", { className: "eyebrow", textContent: "Approved action" }),
    el("h3", { textContent: `Your schedule · ${dateLabel}` }),
    el("p", { className: "caption", textContent: "Threadline does not read your calendar. Add tomorrow's busy times here (kept in this browser); an approved block downloads as an .ics file for your own calendar." }),
    list,
    el("div", { className: "busy-form" }, busyTitle, busyStart, busyEnd, addBusy),
    el("div", { className: "ask-line" }, el("span", { textContent: "Find " }), duration, el("span", { textContent: " " }), windowSel, find),
  ];
  if (agent.log.length) children.push(el("ol", { className: "agent-log", "aria-label": "What Threadline checked" }, ...agent.log.map((st) => el("li", { className: st.kind, textContent: st.text }))));
  if (agent.proposal) {
    const pr = agent.proposal;
    const approve = el("button", { type: "button", className: "primary", innerHTML: `Create quiet time ${fmtClock(pr.start)}–${fmtClock(pr.end)} <span aria-hidden="true">✓</span>` });
    const other = el("button", { type: "button", className: "secondary", textContent: "Try another time" });
    approve.addEventListener("click", () => run(bookProposal));
    other.addEventListener("click", () => run(async () => { agent.skip.push(pr.start); logStep(`You declined ${fmtClock(pr.start)}.`); await findSlot(); }));
    children.push(el("div", { className: "proposal" }, approve, el("div", { className: "row" }, other)));
  }
  if (agent.created) {
    const ics = el("a", { href: URL.createObjectURL(new Blob([icsFor(agent.created)], { type: "text/calendar" })), download: "threadline-quiet-time.ics", className: "secondary ics", textContent: "Download .ics for your calendar" });
    const undo = el("button", { type: "button", className: "text-button", textContent: "Undo — remove the quiet time" });
    undo.addEventListener("click", () => { agent.events = agent.events.filter((e) => e.id !== agent.created.id); logStep("Removed the quiet time block."); agent.created = null; renderCalendar(); });
    children.push(el("p", { className: "done", textContent: `Done: “${agent.created.title}” ${fmtClock(agent.created.start)}–${fmtClock(agent.created.end)} is in your Threadline schedule.` }), el("div", { className: "row" }, ics, undo));
  }
  box.replaceChildren(...children);
}
async function run(task) { if (busy) return; setBusy(true); try { await task(); } catch (error) { message(error.message || "Something went wrong.", true); } finally { setBusy(false); renderCalendar(); } }

/* ---------- Capture & review ---------- */
// Continuous live capture from the Vexo band (USB or Bluetooth, official Vexo Open kit) or this browser's
// microphone, with optional camera video kept in this browser. Audio streams through Threadline's server to
// Deepgram; the provider key never reaches the page. If Deepgram or the band link drops, capture reconnects
// by itself and keeps everything heard so far.
const SOURCE_LABELS_LIVE = { vexo: "Vexo band", browser: "Browser microphone" };
let kit = null, logic = null, bandNumber = null, tokenRequired = true, configuredBand = null;
const loadKit = async () => {
  kit = kit || await import("/static/vendor/vexo-open/js/src/index.js");
  logic = logic || await import("/static/vendor/vexo-open/dashboard/logic.js");  // the dashboard's own wording
  return kit;
};
const RECENT_KEY = "threadline.bands.v1";
const recentBands = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { return []; } };
function rememberBand(number) { try { localStorage.setItem(RECENT_KEY, JSON.stringify([number, ...recentBands().filter((n) => n !== number)].slice(0, 6))); } catch { /* storage off */ } }
const bandLabel = (n = bandNumber) => `Vexo-HACK-${String(n).padStart(2, "0")}`;
const pair = { state: "idle", attempt: 0, busy: false, slow: 0 };

fetch("/api/device").then((r) => r.json()).then((d) => {
  configuredBand = d.vexo_band_number; tokenRequired = d.token_required !== false;
  if (!tokenRequired) { $("token").placeholder = "Not needed on this local server"; $("token").disabled = true; $("provider-summary").textContent = "· local server — no token needed"; }
  const fromUrl = new URLSearchParams(location.search).get("band");
  const start = (fromUrl && /^\d{1,3}$/.test(fromUrl) && Number(fromUrl) > 0) ? Number(fromUrl) : recentBands()[0] || configuredBand;
  if (start) chooseBand(start, false); else { loadThread("browser"); render(); }
  renderPair(); setRecUI();
}).catch(() => renderPair());

function chooseBand(number, remember = true) {
  if (capture.band || pair.busy) return;
  bandNumber = number;
  $("pick-number").value = String(number).padStart(2, "0");
  if (remember) rememberBand(number);
  const url = new URL(location.href); url.searchParams.set("band", String(number).padStart(2, "0")); history.replaceState(null, "", url);
  loadThread(`band-${number}`); render();
  renderPair(); renderArchive(); bandStatus("");
}
$("pick-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const raw = $("pick-number").value.trim();
  if (!/^\d{1,3}$/.test(raw) || Number(raw) < 1) { $("pick-message").textContent = "A band number is one to three digits, like 07 or 42."; return; }
  $("pick-message").textContent = ""; chooseBand(Number(raw));
});
function setPairState(state, text) { pair.state = state; $("pair").dataset.state = state; $("pair-status").textContent = text; }
function renderPair() {
  const linked = Boolean(capture.band), recon = capture.band?.reconnecting;
  $("pair-name").textContent = bandNumber ? bandLabel() : "No band chosen";
  $("step-name").textContent = bandNumber ? bandLabel() : "your band";
  if (!pair.busy) setPairState(linked ? (recon ? "busy" : capture.band.transportKind === "sim" ? "sim" : "connected") : "idle",
    linked ? (recon ? "Reconnecting…" : capture.band.transportKind === "sim" ? "Pretend band · kit sample recording" : capture.band.transportKind === "serial" ? "Connected by USB" : "Connected by Bluetooth") : "Not connected");
  if (capture.active && linked && !recon) { $("pair").dataset.state = "mic"; }
  $("pick-form").hidden = linked || pair.busy;
  $("connect-steps").hidden = linked;
  $("btn-ble").hidden = $("btn-serial").hidden = linked || pair.busy;
  $("btn-ble").disabled = $("btn-serial").disabled = !bandNumber;
  $("btn-cancel").hidden = !pair.busy;
  $("band-disconnect").hidden = !linked;
  $("usb-help").hidden = linked;
  $("band-info").hidden = !linked;
  const recent = recentBands().filter((n) => n !== bandNumber);
  $("recent-bands").replaceChildren(...(recent.length ? [el("span", { className: "caption", textContent: "Paired here before:" })] : []),
    ...recent.map((n) => { const b = el("button", { type: "button", className: "chip", textContent: bandLabel(n) }); b.addEventListener("click", () => chooseBand(n)); return b; }));
}
function bandStatus(text, error = false) { $("band-state").textContent = text || ""; $("band-state").classList.toggle("error", error); renderPair(); }
const isVexo = () => $("source").value === "vexo";
function setRecUI() {
  const live = capture.active, vexo = isVexo();
  $("rec-start").disabled = busy || live || (vexo && (!capture.band || capture.band.reconnecting));
  $("rec-stop").disabled = !live;
  $("source").disabled = live; $("cam-on").disabled = live;
  $("band-disconnect").disabled = live;
  $("rec-start").classList.toggle("recording", live);
  renderPair();
}
function recState(text, error = false) { $("rec-state").textContent = text; $("rec-state").classList.toggle("error", error); }
$("source").addEventListener("change", () => setRecUI());

(async () => {  // what this browser can do, worded like the dashboard
  try {
    await loadKit();
    const noBle = logic.bluetoothProblem({ reason: kit.WebBluetoothTransport.unavailableReason(), secure: window.isSecureContext, iOS: /iPhone|iPad|iPod/.test(navigator.userAgent) });
    if (noBle) { $("no-ble").hidden = false; $("no-ble").textContent = noBle; $("btn-ble").disabled = true; }
    if (kit.WebSerialTransport.unavailableReason()) { $("btn-serial").disabled = true; $("usb-help").textContent = "USB cable connection needs Chrome or Edge on a laptop."; }
  } catch { /* kit failed to load: buttons will report it */ }
})();

async function connectBand(kind) {
  if (!bandNumber || capture.band || pair.busy) return;
  const mine = ++pair.attempt, wanted = bandLabel();
  pair.busy = true;
  setPairState("busy", "Connecting…");
  bandStatus(kind === "ble" ? `Pick ${wanted} in the list, then press Pair.` : kind === "serial" ? "Pick “Vexo Open band” in the list, then press Connect." : "Starting the pretend band…");
  let connected = null;
  try {
    await loadKit();
    pair.slow = setTimeout(() => { if (mine === pair.attempt && pair.busy) bandStatus(logic.stillConnectingMessage(kind, wanted)); }, logic.STILL_CONNECTING_MS);
    let transport = kind;
    // The library filters Bluetooth to this exact name and refuses a band whose number differs.
    connected = await kit.Band.connect(bandNumber, { transport, autoReconnect: true });
    if (connected.number !== bandNumber) { await connected.disconnect(); throw Object.assign(new Error(`That is ${connected.name}, not ${wanted}. Disconnected without changing it.`), { code: "wrong-band" }); }
  } catch (e) {
    if (mine === pair.attempt) { pair.busy = false; bandStatus(logic ? logic.connectProblem(e, { kind, wanted }) : e.message, true); }
  } finally { clearTimeout(pair.slow); }
  if (mine !== pair.attempt) { connected?.disconnect().catch(() => {}); return; }  // Cancel was pressed meanwhile
  pair.busy = false;
  if (!connected) return renderPair();
  rememberBand(bandNumber);
  attachBand(connected);
  bandStatus(`Connected to ${connected.name}. It flashes white.`);
  $("info-link").textContent = { serial: "USB cable", ble: "Bluetooth", sim: "Pretend (simulator)" }[connected.transportKind] || connected.transportKind;
  $("info-fw").textContent = connected.info?.firmware || "—";
  try { await connected.configure({ events: true, battery: true }); } catch { /* keep going */ }
  setRecUI();
}
$("btn-ble").addEventListener("click", () => connectBand("ble"));
$("btn-serial").addEventListener("click", () => connectBand("serial"));
$("btn-cancel").addEventListener("click", () => { pair.attempt += 1; pair.busy = false; clearTimeout(pair.slow); bandStatus(logic?.CANCELLED_MESSAGE || "Cancelled."); });
function attachBand(band) {
  capture.band = band;
  band.on("disconnect", (e) => {
    capture.band = null; $("band-info").hidden = true;
    if (capture.active) stopLive(`Band link ended (${e.reason}${e.reconnect ? ", gave up reconnecting" : ""}). Capture stopped; everything heard so far is kept for review.`);
    bandStatus(e.reason === "closed" ? "" : (logic ? logic.disconnectMessage(e.reason, band.name) : `Band disconnected (${e.reason}).`), e.reason !== "closed"); setRecUI();
  });
  band.on("reconnecting", (e) => { bandStatus(logic ? logic.reconnectingMessage(e.seconds, e.reason) : `Reconnecting for up to ${e.seconds} s.`, true); setRecUI(); if (capture.active) recState("Band reconnecting… capture continues as soon as it is back.", true); });
  band.on("reconnected", () => { bandStatus("Back. The band reconnected by itself."); setRecUI(); if (capture.active) { capture.audioStarted = Date.now(); capture.warnedSilent = false; recState("Band is back. Listening again."); } });
  band.on("double-tap", () => { if (band.transportKind === "sim") return;  // the pretend band double-taps by itself
    if (capture.active) stopLive(); else if (!busy) $("rec-start").click(); });
  band.on("stream-taken", (e) => { recState(`${e.message} Close the Vexo dashboard tab, then press “Take it back”.`, true); $("rec-takeback").hidden = false; });
  band.on("notice", (e) => { if (e.kind === "low-battery" || e.kind === "critical-battery") bandStatus(`Band battery is low (${e.kind}). Plug in the cable.`, true); });
  // Audio goes to whichever Deepgram socket is open right now (sockets are replaced on reconnect).
  attachSignals(band);
  band.on("audio", (a) => { const ws = capture.ws; if (capture.active && !capture.stopping && ws && ws.readyState === 1) { ws.send(a.opus); capture.packets += 1; } });
}
$("band-disconnect").addEventListener("click", async () => { try { await capture.band?.disconnect(); } catch { /* already gone */ } capture.band = null; bandStatus("Disconnected."); setRecUI(); });

$("rec-start").addEventListener("click", async () => {
  if (capture.active) return;
  if (!$("rec-consent").checked) return recState("Confirm recording consent first.", true);
  const token = $("token").value.trim();
  if (tokenRequired && !token) { $("token").closest("details").open = true; $("token").focus(); return recState("Enter the app access token (Live providers, above) to stream audio.", true); }
  const source = $("source").value, vexo = source === "vexo", camera = $("cam-on").checked;
  if (vexo && !capture.band) return recState("Connect the band first.", true);
  let stream = null;
  if (!vexo || camera) {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return recState("This browser cannot record from the microphone or camera.", true);
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: !vexo, video: camera }); }
    catch { return recState(`${camera ? "Camera" : "Microphone"} permission was not granted. Nothing was recorded.`, true); }
  }
  Object.assign(capture, { active: true, token, source, vexo, stream, startedAt: new Date(), finals: [], stopping: false, packets: 0, chunks: 0,
    warnedSilent: false, lastError: "", reconnects: 0, audioStarted: Date.now() });
  $("rec-takeback").hidden = true;
  $("live").hidden = false; $("live-lines").replaceChildren(); $("live-interim").textContent = ""; $("live-source").textContent = (vexo ? `${capture.band.name} · ${({ serial: "USB", ble: "Bluetooth", sim: "pretend" })[capture.band.transportKind] || ""}` : SOURCE_LABELS_LIVE[source]) + (camera ? " + camera" : "");
  if (camera) startVideo(stream);
  capture.marks = [];
  if (vexo) { try { await capture.band.configure({ audio: true }); await startSignals(); } catch (e) { capture.active = false; setRecUI(); return recState(`The band refused the microphone: ${e.message}`, true); } }
  else {
    const audioOnly = new MediaStream(stream.getAudioTracks());
    capture.recorder = new MediaRecorder(audioOnly);
    capture.recorder.ondataavailable = (e) => { const ws = capture.ws; if (e.data.size && ws && ws.readyState === 1 && !capture.stopping) { ws.send(e.data); capture.chunks += 1; } };
  }
  capture.timer = setInterval(tick, 500); renderPair();
  openSocket();
  setRecUI();
});
function tick() {
  const s = Math.round((Date.now() - capture.startedAt) / 1000), count = capture.vexo ? capture.packets : capture.chunks;
  $("live-timer").textContent = `● live · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} · ${count} ${capture.vexo ? "audio packets" : "audio chunks"}${capture.reconnects ? ` · ${capture.reconnects} reconnect${capture.reconnects > 1 ? "s" : ""}` : ""}`;
  if (count === 0 && capture.ws?.readyState === 1 && Date.now() - capture.audioStarted > 4000 && !capture.warnedSilent && !capture.band?.reconnecting) {
    capture.warnedSilent = true;
    recState(capture.vexo ? "No audio is arriving from the band. If the Vexo dashboard (or another tab) is connected to it, close that, then press “Take it back”." : "No audio is arriving from the microphone. Check the browser's microphone permission and input device.", true);
    if (capture.vexo) $("rec-takeback").hidden = false;
  }
}
function openSocket() {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/live-transcribe`);
  ws.binaryType = "arraybuffer"; capture.ws = ws;
  const opened = Date.now();
  ws.onopen = () => ws.send(JSON.stringify({ token: capture.token, source: capture.vexo ? "vexo" : "browser" }));
  ws.onmessage = (event) => {
    if (ws !== capture.ws || !capture.active) return;
    const msg = JSON.parse(event.data);
    if (msg.type === "ready") {
      ws.offset = (Date.now() - capture.startedAt) / 1000;  // Deepgram times restart at 0 for each socket
      if (capture.recorder && capture.recorder.state === "inactive") capture.recorder.start(250);
      recState(capture.vexo ? "● Listening through the band's microphone (solid blue light). Streaming to Deepgram." : "● Listening through this browser's microphone. Streaming to Deepgram.");
    } else if (msg.type === "result") {
      if (msg.is_final) {
        if (msg.transcript.trim()) {
          const shift = ws.offset || 0;
          const final = { ...msg, start: msg.start + shift, words: msg.words.map((w) => ({ ...w, start: (w.start || 0) + shift, end: (w.end || 0) + shift })) };
          final.activity = signals.activity; capture.finals.push(final); addLiveLine(final);
        }
        $("live-interim").textContent = "";
      } else $("live-interim").textContent = msg.transcript;
    } else if (msg.type === "error") { capture.lastError = msg.message; recState(msg.message, true); }
    else if (msg.type === "closed") ws.closedCleanly = true;
  };
  ws.onclose = () => {
    if (ws !== capture.ws) return;
    if (capture.active && !capture.stopping) {
      // Unexpected drop (network, provider limit): keep recording on a fresh socket.
      const quick = Date.now() - opened < 3000;
      capture.reconnects += 1;
      if (capture.reconnects > 20 || (quick && capture.lastError && /token|configure|Set DEEPGRAM|Another live transcript/i.test(capture.lastError))) return finishLive();
      recState("Transcription connection dropped — reconnecting. Recording continues.", true);
      if (capture.recorder && capture.recorder.state === "recording") capture.recorder.stop();  // a new WebM stream needs its own header
      setTimeout(() => { if (capture.active && !capture.stopping) openSocket(); }, quick ? 2000 : 300);
    } else finishLive();
  };
}
function addLiveLine(msg) {
  const speakers = [...new Set(msg.words.map((w) => w.speaker).filter((s) => s != null))];
  const at = new Date(capture.startedAt.getTime() + msg.start * 1000);
  $("live-lines").append(el("li", {},
    el("span", { className: "caption", textContent: `${at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })} · ${speakers.length ? speakers.map((s) => `Speaker ${s}`).join(", ") : "Speaker ?"}` }),
    el("p", { textContent: msg.transcript })));
  $("live-lines").lastChild.scrollIntoView({ block: "nearest" });
}
async function stopLive(reason) {
  if (!capture.active || capture.stopping) return;
  capture.stopping = true;
  recState(reason || "Stopping… waiting for the last words from Deepgram.");
  if (capture.band && !capture.band.reconnecting) { try { await capture.band.configure({ audio: false }); } catch { /* band gone */ } await stopSignals(); }
  if (capture.recorder && capture.recorder.state !== "inactive") capture.recorder.stop();
  stopVideo();
  capture.stream?.getTracks().forEach((t) => t.stop());
  const ws = capture.ws;
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "stop" })); else finishLive();
  setTimeout(() => { if (capture.ws === ws && ws) ws.close(); }, 6000);
}
$("rec-stop").addEventListener("click", () => stopLive());
$("rec-takeback").addEventListener("click", async () => {
  if (!capture.band) return;
  try {
    await capture.band.takeBack();
    if (capture.active) await capture.band.configure({ audio: true });
    capture.warnedSilent = false; capture.audioStarted = Date.now();
    $("rec-takeback").hidden = true; recState("Took the microphone back. Listening through the band.");
  } catch (e) { recState(`Could not take the band back: ${e.message}`, true); }
});
function finishLive() {
  if (!capture.active) return;
  clearInterval(capture.timer); $("live-timer").textContent = `stopped · ${$("live-timer").textContent.replace("● live · ", "")}`;
  const { finals, source, startedAt } = capture;
  if (finals.length) archiveSession(finals, { startedAt, source, marks: capture.marks || [] });
  if (capture.band && !capture.stopping && !capture.band.reconnecting) capture.band.configure({ audio: false }).catch(() => {});
  if (capture.recorder && capture.recorder.state !== "inactive") capture.recorder.stop();
  stopVideo();
  capture.stream?.getTracks().forEach((t) => t.stop());
  Object.assign(capture, { active: false, ws: null, recorder: null, stream: null, stopping: false });
  setRecUI();
  if (!capture.vexo) $("signals").hidden = true;
  if (!finals.length) { const err = capture.lastError; capture.lastError = ""; return recState(err ? `Capture ended: ${err}` : "Capture ended. No speech was transcribed; nothing was saved.", Boolean(err)); }
  openReview(segmentsFromWords(finals.flatMap((f) => f.words), finals.map((f) => f.transcript).join(" ")), source === "vexo" ? "vexo" : "mic", startedAt,
    `${SOURCE_LABELS_LIVE[source]} · Deepgram live transcript · ${finals.length} lines. Speaker labels separate voices; they do not prove identity.`);
  recState("Capture stopped. Review below: choose which speaker is you before anything is saved.");
}

/* Camera: explicit opt-in, previewed live, recorded only in this browser (never uploaded). */
function startVideo(stream) {
  const tracks = stream.getVideoTracks(); if (!tracks.length) return;
  clearVideo();
  const preview = $("cam-preview"); preview.srcObject = new MediaStream(tracks); preview.hidden = false; preview.play().catch(() => {});
  const mixed = new MediaStream([...tracks, ...stream.getAudioTracks()]);
  capture.videoChunks = [];
  capture.videoRecorder = new MediaRecorder(mixed);
  capture.videoRecorder.ondataavailable = (e) => { if (e.data.size) capture.videoChunks.push(e.data); };
  capture.videoRecorder.onstop = () => {
    const blob = new Blob(capture.videoChunks, { type: capture.videoRecorder.mimeType || "video/webm" });
    capture.videoUrl = URL.createObjectURL(blob);
    const ext = blob.type.includes("mp4") ? "mp4" : "webm";
    $("cam-result").hidden = false;
    $("cam-download").href = capture.videoUrl; $("cam-download").download = `threadline-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.${ext}`;
    $("cam-size").textContent = `${Math.round(blob.size / 1024 / 1024 * 10) / 10} MB, in this browser only`;
  };
  capture.videoRecorder.start(1000);
}
function stopVideo() {
  if (capture.videoRecorder && capture.videoRecorder.state !== "inactive") capture.videoRecorder.stop();
  const preview = $("cam-preview"); preview.srcObject = null; preview.hidden = true;
}
function clearVideo() { if (capture.videoUrl) URL.revokeObjectURL(capture.videoUrl); capture.videoUrl = ""; $("cam-result").hidden = true; }
$("cam-delete").addEventListener("click", () => { clearVideo(); recState("Video deleted from this page."); });

function segmentsFromWords(words, text) {
  if (!words?.length) return text ? [{ speaker: null, text, offset: 0 }] : [];
  const out = [];
  for (const w of words) {
    const last = out[out.length - 1], token = w.punctuated_word || w.word;
    if (last && last.speaker === (w.speaker ?? null)) last.text += ` ${token}`;
    else out.push({ speaker: w.speaker ?? null, text: token, offset: w.start || 0 });
  }
  return out;
}
async function transcribe(blob, source) {
  const headers = liveHeaders();
  setBusy(true); recState("Sending audio to Deepgram…");
  try {
    const startedAt = capture.startedAt || new Date();
    const data = await request("/api/transcribe", { method: "POST", headers: { ...headers, "Content-Type": (blob.type || "audio/webm").split(";")[0] }, body: blob });
    const segments = segmentsFromWords(data.words, data.text);
    if (!segments.length) throw new Error("No speech was detected. Nothing was saved.");
    openReview(segments, source, startedAt, "Deepgram transcript · speaker labels separate voices but do not prove identity.");
    recState("Transcript ready for review.");
  } finally { setBusy(false); }
}
$("transcribe").addEventListener("click", async () => {
  try { const file = $("audio").files[0]; if (!file) throw new Error("Choose an audio file first."); capture.startedAt = new Date(); await transcribe(file, "upload"); $("audio").value = ""; }
  catch (e) { recState(e.message, true); }
});
function openReview(segments, source, startedAt, label) {
  capture.review = { source, startedAt, segments: segments.map((s) => ({ ...s, who: "unsure" })) };
  const speakers = [...new Set(segments.map((s) => s.speaker))];
  $("who").replaceChildren(el("option", { value: "", textContent: "Choose…" }), ...speakers.map((s) => el("option", { value: String(s), textContent: s === null ? "Unlabeled speaker" : `Speaker ${s}` })), el("option", { value: "none", textContent: "None of these is me" }));
  $("review-source").textContent = label;
  $("review").hidden = false; renderSegments(); $("review").scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function renderSegments() {
  const r = capture.review; $("segments").replaceChildren();
  r.segments.forEach((seg, i) => {
    const who = el("select", { "aria-label": `Who said segment ${i + 1}` }, ...[["unsure", "Not sure — don't save"], ["me", "Me"], ["other", "Someone else — don't save"]].map(([v, t]) => el("option", { value: v, textContent: t, selected: seg.who === v })));
    const text = el("textarea", { value: seg.text, rows: 2, maxLength: 4000, "aria-label": `Text of segment ${i + 1}` });
    who.addEventListener("change", () => { seg.who = who.value; renderSegments(); });
    text.addEventListener("input", () => { seg.text = text.value; });
    $("segments").append(el("li", { className: seg.who }, el("div", { className: "seg-top" }, el("span", { className: "caption", textContent: `${seg.speaker === null ? "Unlabeled" : `Speaker ${seg.speaker}`} · +${Math.round(seg.offset)}s` }), who), text));
  });
}
$("who").addEventListener("change", () => {
  const value = $("who").value; if (!value) return;
  for (const seg of capture.review.segments) seg.who = value === "none" ? "other" : String(seg.speaker) === value ? "me" : "other";
  renderSegments();
});
$("review-save").addEventListener("click", () => {
  const r = capture.review, mine = r.segments.filter((s) => s.who === "me" && s.text.trim());
  if (!mine.length) return message("Mark at least one segment as “Me”, or discard.", true);
  const dropped = r.segments.length - mine.length;
  addNotes(mine.map((s) => ({ text: s.text.trim(), at: new Date(r.startedAt.getTime() + s.offset * 1000).toISOString(), source: r.source })));
  capture.review = null; $("review").hidden = true;
  message(`Saved ${mine.length} statement${mine.length > 1 ? "s" : ""} as yours.${dropped ? ` ${dropped} other segment${dropped > 1 ? "s were" : " was"} dropped, not stored.` : ""}`);
});
$("review-discard").addEventListener("click", () => { capture.review = null; $("review").hidden = true; message("Transcript discarded. Nothing was saved."); });

/* ---------- Ask ---------- */
function showAnswer(answer, sources = [], provenance = "") {
  const children = [];
  if (provenance) children.push(el("p", { className: "provenance", textContent: provenance }));
  children.push(el("p", { textContent: answer }));
  const links = el("div", { className: "sources" });
  for (const id of sources) {
    const note = sessions[mode].notes.find((n) => n.id === id); if (!note) continue;
    links.append(el("a", { href: `#note-${id}`, textContent: `Source: ${id}` }));
  }
  if (links.childElementCount) children.push(links);
  $("answer").replaceChildren(...children);
}
function setBusy(value) {
  busy = value;
  document.querySelectorAll("button").forEach((button) => { if (button.id !== "rec-stop") button.disabled = value; });
  $("run").firstChild.textContent = value ? "Working… " : "Revisit my notes ";
  if (!value) setRecUI();
}
function liveHeaders() {
  if (!$("live-on").checked) throw new Error("Open “Live providers” and enable them to use Deepgram or Gemini.");
  if (!$("consent").checked) throw new Error("Confirm permission before sending notes or audio.");
  if (tokenRequired && !$("token").value.trim()) throw new Error("Enter the app access token for live processing.");
  return tokenRequired ? { "X-App-Token": $("token").value.trim() } : {};
}
async function request(url, options) {
  const response = await fetch(url, options), data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "The request could not be completed.");
  return data;
}
function updateProviderSummary() { $("provider-summary").textContent = $("live-on").checked ? "· on — requests go to configured providers" : "· off — local demo only"; }
$("live-on").addEventListener("change", updateProviderSummary);
$("check-config").addEventListener("click", async () => {
  try {
    const token = $("token").value.trim(); if (tokenRequired && !token) throw new Error("Enter the access token first.");
    const c = await request("/api/config", { headers: tokenRequired ? { "X-App-Token": token } : {} });
    $("config-result").textContent = `Gemini: ${c.reflection_ready ? "configured" : "not configured"} · Deepgram: ${c.transcription_ready ? "configured" : "not configured"} · Vexo band: ${c.wearable_connected ? "connected" : "not connected"}`;
  } catch (e) { $("config-result").textContent = e.message; }
});

document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => {
  if (busy) return; sessions[mode].question = $("question").value; mode = button.dataset.mode;
  $("note").value = ""; capture.review = null; $("review").hidden = true; render(); showAnswer("Ask a question to revisit this thread."); message("Keyword search · no AI request");
}));
$("question").addEventListener("input", () => { sessions[mode].question = $("question").value; });
$("note-form").addEventListener("submit", (event) => {
  event.preventDefault(); const text = $("note").value.trim(); if (!text || busy) return;
  $("note").value = ""; addNotes([{ text, at: new Date().toISOString(), source: "typed" }]); message("Note added to this session.");
});
$("clear").addEventListener("click", () => {
  if (busy || !confirm("Delete every note in this mode for this band? This cannot be undone.")) return;
  Object.assign(sessions[mode], { notes: [] }); $("note").value = ""; $("audio").value = "";
  if (mode === "reflection") Object.assign(agent, { offer: null, proposal: null, skip: [], log: [], created: null });
  render(); showAnswer("Your session notes have been cleared."); message("Fresh session · no saved notes");
});
$("question-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const question = $("question").value.trim(), notes = sessions[mode].notes;
  if (busy || !question) return;
  if (!notes.length) return message("Add a note before asking a question.", true);
  if (!$("live-on").checked) {
    const stop = new Set(["what", "did", "the", "and", "when", "last", "time", "where", "was", "with", "that", "this", "for", "about", "felt", "feel"]);
    const words = (question.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []).filter((w) => !stop.has(w));
    const matches = notes.filter((note) => words.some((word) => note.text.toLowerCase().includes(word)));
    const selected = matches.length ? matches : notes.slice(-3);
    showAnswer(`${matches.length ? "Your notes that share words with the question:" : "No direct keyword match. Your latest notes:"}\n\n${selected.map((n) => `${fmtDate(n.at)} — “${n.text}”`).join("\n\n")}`, selected.map((n) => n.id), "Local keyword match · not AI · no interpretation");
    return message("Keyword search on this page · nothing sent");
  }
  try {
    const headers = liveHeaders(); setBusy(true); message("Sending this question and these notes to Gemini…");
    const data = await request("/api/reflect", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ mode, question, notes: notes.slice(-30).map(({ id, text, at, source, context }) => ({ id, text, at, source, context })) }) });
    showAnswer(data.answer, Array.isArray(data.sources) ? data.sources : [], "Gemini response via server · check the linked sources");
    message("Live response · check the linked notes");
  } catch (error) { message(error.message || "Unable to complete request.", true); }
  finally { setBusy(false); }
});

function render() {
  $("mode-description").textContent = MODES[mode].description;
  $("question").value = sessions[mode].question;
  document.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
  renderTimeline(); renderPrefs(); renderSupport(); renderCalendar(); setRecUI(); renderArchive();
}

/* ---------- Band signals ---------- */
// What the band itself reports while capturing: loudness, movement state, steps, taps, battery.
// These describe the device and the room, never the wearer's feelings.
const signals = { level: 0, activity: "", steps0: null, steps: 0, taps: 0, battery: "" };
function attachSignals(band) {
  band.on("mic-level", (e) => { signals.level = Math.max(0, Math.min(1, (52 - e.rmsDb) / 40)); $("sig-loud").style.width = `${Math.round(signals.level * 100)}%`; });
  band.on("activity", (e) => {
    if (signals.steps0 == null) signals.steps0 = e.steps;
    signals.activity = e.state; signals.steps = e.steps - signals.steps0;
    $("sig-activity").textContent = e.state + (e.cadence ? ` · ${e.cadence}/min` : "");
    $("sig-steps").textContent = `${signals.steps} this session`;
  });
  band.on("battery", (e) => { signals.battery = `${e.percent}%${e.charging ? " · charging" : ""}`; $("sig-battery").textContent = signals.battery; $("info-battery").textContent = signals.battery; });
  band.on("tap", () => {
    if (!capture.active) return;
    signals.taps += 1; $("sig-taps").textContent = String(signals.taps);
    const t = (Date.now() - capture.startedAt) / 1000;
    capture.marks.push(t);
    $("live-lines").append(el("li", { className: "mark" }, el("span", { className: "caption", textContent: `${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })} · marked on the band` }), el("p", { textContent: "★ Moment marked" })));
  });
}
async function startSignals() {
  Object.assign(signals, { level: 0, activity: "", steps0: null, steps: 0, taps: 0 });
  ["sig-activity", "sig-steps", "sig-battery"].forEach((id) => { $(id).textContent = "—"; }); $("sig-taps").textContent = "0";
  $("signals").hidden = false;
  try { await capture.band.configure({ micLevel: 0.1, activity: true, battery: true }); } catch (e) { $("sig-activity").textContent = `unavailable (${e.code || e.message})`; }
}
async function stopSignals() {
  if (capture.band && !capture.band.reconnecting) { try { await capture.band.configure({ micLevel: false, activity: false }); } catch { /* gone */ } }
  $("sig-loud").style.width = "0%";
}

/* ---------- Stored transcripts (this browser, per band) ---------- */
const archiveKey = () => `threadline.transcripts.v1.${bandNumber ? `band-${bandNumber}` : "browser"}`;
function loadArchive() { try { return JSON.parse(localStorage.getItem(archiveKey()) || "[]"); } catch { return []; } }
function saveArchive(list) { try { localStorage.setItem(archiveKey(), JSON.stringify(list.slice(0, 50))); return true; } catch { return false; } }
function archiveSession(finals, meta) {
  const lines = finals.map((f) => {
    const speakers = [...new Set(f.words.map((w) => w.speaker).filter((s) => s != null))];
    return { at: new Date(meta.startedAt.getTime() + f.start * 1000).toISOString(), offset: f.start, speakers, text: f.transcript, activity: f.activity || "", marked: meta.marks.some((m) => m >= f.start - 1 && m <= f.start + (f.duration || 0) + 1) };
  });
  const entry = { id: newId("t"), startedAt: meta.startedAt.toISOString(), endedAt: new Date().toISOString(), source: meta.source, device: meta.device || capture.band?.name || (meta.source === "browser" ? "Browser microphone" : bandNumber ? bandLabel() : ""), marks: meta.marks.length, lines };
  const ok = saveArchive([entry, ...loadArchive()]);
  renderArchive();
  return ok;
}
function renderArchive() {
  const list = loadArchive(), box = $("archive"); box.replaceChildren();
  $("archive-caption").textContent = `Every captured session's full transcript${bandNumber ? ` for ${bandLabel()}` : ""}, stored in this browser only. Nothing is stored on the server.`;
  if (!list.length) { box.append(el("li", { className: "empty", textContent: "No transcripts yet. Start a live capture." })); return; }
  for (const entry of list) {
    const mins = Math.max(1, Math.round((new Date(entry.endedAt) - new Date(entry.startedAt)) / 60000));
    const lines = el("ol", { className: "archive-lines" }, ...entry.lines.map((l) => el("li", { className: l.marked ? "marked" : "" },
      el("span", { className: "caption", textContent: `${new Date(l.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })} · ${l.speakers.length ? l.speakers.map((s) => `Speaker ${s}`).join(", ") : "Speaker ?"}${l.activity ? ` · ${l.activity}` : ""}${l.marked ? " · ★ marked" : ""}` }),
      el("p", { textContent: l.text }))));
    const exp = el("button", { type: "button", className: "text-button", textContent: "Export .txt" });
    const review = el("button", { type: "button", className: "text-button", textContent: "Save statements from this" });
    const del = el("button", { type: "button", className: "text-button", textContent: "Delete" });
    exp.addEventListener("click", () => {
      const text = entry.lines.map((l) => `[${new Date(l.at).toLocaleString()}] ${l.speakers.map((s) => `Speaker ${s}`).join(", ") || "Speaker ?"}${l.marked ? " ★" : ""}: ${l.text}`).join("\n");
      const a = el("a", { href: URL.createObjectURL(new Blob([text], { type: "text/plain" })), download: `threadline-transcript-${entry.startedAt.slice(0, 16).replace(/[:T]/g, "-")}.txt` });
      document.body.append(a); a.click(); a.remove();
    });
    review.addEventListener("click", () => openReview(entry.lines.map((l) => ({ speaker: l.speakers[0] ?? null, text: l.text, offset: l.offset })), entry.source === "browser" ? "mic" : "vexo", new Date(entry.startedAt), `${entry.device} · stored transcript from ${new Date(entry.startedAt).toLocaleString()}.`));
    del.addEventListener("click", () => { if (confirm("Delete this transcript from this browser?")) { saveArchive(loadArchive().filter((e) => e.id !== entry.id)); renderArchive(); } });
    box.append(el("li", {}, el("details", {},
      el("summary", {}, el("strong", { textContent: new Date(entry.startedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) }), ` · ${entry.device} · ${entry.lines.length} lines · ${mins} min${entry.marks ? ` · ${entry.marks} ★` : ""}`),
      lines, el("div", { className: "row tight" }, review, exp, del))));
  }
}
$("archive-clear").addEventListener("click", () => { if (confirm("Delete every stored transcript for this band from this browser?")) { saveArchive([]); renderArchive(); } });

/* ---------- Knowledge graph (rebuilds as statements are saved) ---------- */
const graph = { timer: 0, version: 0, data: null, selected: null, signature: "" };
const TYPE_COLORS = { person: "#0E7C86", feeling: "#E8452C", time: "#D99A1E", place: "#6B5BD6", commitment: "#16161A", preference: "#3B4BDB", topic: "#8A8A92" };
function graphEngine() { return document.querySelector("input[name=graph-engine]:checked")?.value || "local"; }
function scheduleGraph(delay = 1500) {
  if (mode !== "reflection") { $("graph-panel").hidden = true; return; }
  $("graph-panel").hidden = false;
  clearTimeout(graph.timer); graph.timer = setTimeout(buildGraph, delay);
}
async function buildGraph() {
  const notes = sessions.reflection.notes.slice(-60).map(({ id, text, at, source, context }) => ({ id, text, at, source, context, speaker: "me", device: source === "vexo" && bandNumber ? bandLabel() : "" }));
  const engine = graphEngine(), signature = engine + "|" + notes.map((n) => n.id + n.text).join("|");
  if (!notes.length) { graph.data = null; drawGraph(); $("graph-status").textContent = "No saved statements yet"; return; }
  if (signature === graph.signature && graph.data) return;
  const version = ++graph.version;
  $("graph-status").textContent = engine === "gemini" ? "Updating with Gemini…" : "Updating…";
  try {
    const token = $("token").value.trim();
    const data = await request("/api/graph", { method: "POST", headers: { "Content-Type": "application/json", ...(tokenRequired && token ? { "X-App-Token": token } : {}) }, body: JSON.stringify({ mode: engine, notes }) });
    if (version !== graph.version) return;
    graph.data = data; graph.signature = signature;
    $("graph-status").textContent = `${data.engine === "gemini" ? "Gemini" : "Keywords · no AI"} · ${data.nodes.length} nodes · ${notes.length} statements · ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    drawGraph();
  } catch (e) { if (version === graph.version) $("graph-status").textContent = `Graph not updated: ${e.message}`; }
}
document.querySelectorAll("input[name=graph-engine]").forEach((r) => r.addEventListener("change", () => scheduleGraph(0)));
function drawGraph() {
  const svg = $("graph-svg"), NS = "http://www.w3.org/2000/svg", W = 600, H = 420;
  svg.replaceChildren();
  const data = graph.data;
  if (!data || !data.nodes.length) { const t = document.createElementNS(NS, "text"); t.setAttribute("x", W / 2); t.setAttribute("y", H / 2); t.setAttribute("text-anchor", "middle"); t.setAttribute("class", "g-empty"); t.textContent = "Save a statement to start your graph"; svg.append(t); return; }
  const nodes = data.nodes.map((n, i) => ({ ...n, x: W / 2 + 160 * Math.cos((i / data.nodes.length) * Math.PI * 2), y: H / 2 + 130 * Math.sin((i / data.nodes.length) * Math.PI * 2), vx: 0, vy: 0 }));
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const edges = data.edges.filter((e) => byId[e.source] && byId[e.target]);
  for (let step = 0; step < 220; step++) {  // small force layout: repel all, pull linked, centre
    for (const a of nodes) for (const b of nodes) { if (a === b) continue; const dx = a.x - b.x, dy = a.y - b.y, d2 = Math.max(dx * dx + dy * dy, 30); a.vx += (dx / d2) * 260; a.vy += (dy / d2) * 260; }
    for (const e of edges) { const a = byId[e.source], b = byId[e.target], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, f = (d - 80) * 0.03; a.vx += (dx / d) * f; a.vy += (dy / d) * f; b.vx -= (dx / d) * f; b.vy -= (dy / d) * f; }
    for (const n of nodes) { n.vx += (W / 2 - n.x) * 0.012; n.vy += (H / 2 - n.y) * 0.016; n.x = Math.max(70, Math.min(W - 70, n.x + n.vx * 0.5)); n.y = Math.max(34, Math.min(H - 40, n.y + n.vy * 0.5)); n.vx *= 0.6; n.vy *= 0.6; }
  }
  const maxW = Math.max(...nodes.map((n) => n.weight || 1));
  for (const e of edges) { const a = byId[e.source], b = byId[e.target], line = document.createElementNS(NS, "line"); Object.entries({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: "g-edge", "stroke-width": 1 + Math.min(3, (e.weight || 1) - 1) }).forEach(([k, v]) => line.setAttribute(k, v)); svg.append(line); }
  for (const n of nodes) {
    const g = document.createElementNS(NS, "g"); g.setAttribute("class", `g-node${graph.selected === n.id ? " selected" : ""}`); g.setAttribute("tabindex", "0"); g.setAttribute("role", "button"); g.setAttribute("aria-label", `${n.type}: ${n.label}`);
    const r = 6 + 8 * Math.sqrt((n.weight || 1) / maxW);
    const c = document.createElementNS(NS, "circle"); c.setAttribute("cx", n.x); c.setAttribute("cy", n.y); c.setAttribute("r", r); c.setAttribute("fill", TYPE_COLORS[n.type] || "#8A8A92");
    const t = document.createElementNS(NS, "text"); t.setAttribute("x", n.x); t.setAttribute("y", n.y + r + 13); t.setAttribute("text-anchor", "middle"); t.textContent = n.label.length > 22 ? n.label.slice(0, 21) + "…" : n.label;
    g.append(c, t);
    const pick = () => { graph.selected = n.id; drawGraph(); showGraphNode(n, edges, byId); };
    g.addEventListener("click", pick); g.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); pick(); } });
    svg.append(g);
  }
}
function showGraphNode(n, edges, byId) {
  const notes = sessions.reflection.notes, links = edges.filter((e) => e.source === n.id || e.target === n.id);
  $("graph-detail").replaceChildren(
    el("p", { className: "eyebrow", textContent: `${n.type} · ${n.sources.length} statement${n.sources.length === 1 ? "" : "s"}` }),
    el("h3", { textContent: n.label }),
    links.length ? el("p", { className: "caption", textContent: "Linked with: " + links.map((e) => byId[e.source === n.id ? e.target : e.source].label).join(", ") }) : null,
    el("ul", { className: "why" }, ...n.sources.map((id) => notes.find((x) => x.id === id)).filter(Boolean).map((x) => el("li", {}, `“${x.text}” `, el("span", { className: "caption", textContent: `${fmtDate(x.at)} · ${SOURCE_LABELS[x.source] || x.source} ` }), sourceLink(x.id)))),
    el("p", { className: "caption", textContent: "A link means two things came up in the same saved statement. It is not a cause or a diagnosis." }));
}


/* ---------- Apple Watch (companion app streams to this server; this page follows it by code) ---------- */
const watch = { ws: null, code: "", finals: [], startedAt: null, device: "Apple Watch" };
function watchState(state, text) { $("watch-pair").dataset.state = state; $("watch-status").textContent = text; }
function watchMsg(text, error = false) { $("watch-msg").textContent = text; $("watch-msg").classList.toggle("error", error); }
$("watch-pair-btn").addEventListener("click", async () => {
  if (watch.ws) return;
  try {
    const token = $("token").value.trim();
    const headers = tokenRequired && token ? { "X-App-Token": token } : {};
    if (tokenRequired && !token) throw new Error("Enter the app access token (Live providers, above) first.");
    const data = await request("/api/watch/pair", { method: "POST", headers });
    watch.code = data.code;
    $("watch-code").textContent = data.code.replace(/(\d{3})(\d{3})/, "$1 $2");
    $("watch-code-box").hidden = false; $("watch-pair-btn").hidden = true; $("watch-unpair").hidden = false;
    watchState("busy", "Waiting for your watch…"); watchMsg(`Code expires in ${Math.round(data.expires_in / 60)} minutes if unused.`);
    openWatchFeed(token);
  } catch (e) { watchMsg(e.message.includes("Not Found") ? "Apple Watch pairing is not available on this server yet." : e.message, true); }
});
function openWatchFeed(token) {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/watch/feed`);
  watch.ws = ws;
  ws.onopen = () => ws.send(JSON.stringify({ token, code: watch.code }));
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "watch_connected") {
      watch.device = msg.device || "Apple Watch"; watch.finals = []; watch.startedAt = new Date();
      watchState("connected", `${watch.device} · streaming`); watchMsg("Connected. Recording happens on the watch.");
      $("watch-code-box").hidden = true;
      $("live").hidden = false; $("live-lines").replaceChildren(); $("live-interim").textContent = ""; $("live-source").textContent = watch.device; $("signals").hidden = true;
    } else if (msg.type === "result") {
      if (msg.is_final && msg.transcript.trim()) {
        watch.finals.push(msg);
        const speakers = [...new Set(msg.words.map((w) => w.speaker).filter((s) => s != null))];
        $("live-lines").append(el("li", {}, el("span", { className: "caption", textContent: `${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })} · ${watch.device} · ${speakers.length ? speakers.map((s) => `Speaker ${s}`).join(", ") : "Speaker ?"}` }), el("p", { textContent: msg.transcript })));
        $("live-lines").lastChild.scrollIntoView({ block: "nearest" });
        $("live-interim").textContent = "";
      } else if (!msg.is_final) $("live-interim").textContent = msg.transcript;
    } else if (msg.type === "watch_disconnected") {
      watchState("busy", "Watch stopped · waiting for it again");
      finishWatchSession();
    } else if (msg.type === "error") { watchMsg(msg.message, true); }
  };
  ws.onclose = () => { if (watch.ws === ws) { watch.ws = null; finishWatchSession(); watchState("idle", "Not paired"); $("watch-pair-btn").hidden = false; $("watch-unpair").hidden = true; $("watch-code-box").hidden = true; } };
}
function finishWatchSession() {
  if (!watch.finals.length) return;
  const finals = watch.finals.map((f) => ({ ...f, start: f.start || 0 })); watch.finals = [];
  archiveSession(finals, { startedAt: watch.startedAt || new Date(), source: "watch", marks: [], device: watch.device });
  openReview(segmentsFromWords(finals.flatMap((f) => f.words), finals.map((f) => f.transcript).join(" ")), "watch", watch.startedAt || new Date(), `${watch.device} · Deepgram live transcript. Speaker labels separate voices; they do not prove identity.`);
  recState("Watch recording ended. Review below: choose which speaker is you before anything is saved.");
}
$("watch-unpair").addEventListener("click", () => { const ws = watch.ws; watch.ws = null; ws?.close(); finishWatchSession(); watchState("idle", "Not paired"); watchMsg("Unpaired."); $("watch-pair-btn").hidden = false; $("watch-unpair").hidden = true; $("watch-code-box").hidden = true; });

render();
