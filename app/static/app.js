"use strict";
import { claimBandAudio, queueBandAudio, pcmWav } from './band-capture.mjs';
import { createUtteranceCollector, createSerialQueue } from './transcript-flow.mjs';
import { createVisionController } from './vision.mjs';
import { sampleSeed, moodSeries } from './sample-data.mjs';
import { renderDashboard } from './dashboard.mjs';
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

let mode = "reflection", busy = false, workspaceVersion = 0;
// Everything below starts empty and holds only what this person captured, typed or saved.
const emptyThread = () => ({ reflection: { question: "", notes: [], prefs: [] }, routine: { question: "", notes: [], prefs: [] } });
let sessions = emptyThread();
const agent = { offer: null, events: [], proposal: null, skip: [], log: [], created: null, duration: 30, window: "afternoon" };
// Stored in this browser per band (localStorage); nothing is stored on the server.
let threadKey = "", threadLoaded = false;
// Per-day record built only from real inputs: saved statements, reviewed conversations, band and watch readings.
const DEFAULT_ENERGY_WORDS = "tired, exhausted, drained, wiped, overloaded, no energy, low energy, worn out";
const life = { days: {}, cycle: { starts: [], notify: false, haptic: false, notifiedFor: "" }, energyWords: DEFAULT_ENERGY_WORDS };
const todayKey = (d = new Date()) => localDate(d);
function dayRec(key = todayKey()) { return (life.days[key] ||= { energy: [], others: 0, mine: 0, hrSum: 0, hrN: 0, hrMin: null, hrMax: null, watchSteps: null, bandSteps: 0 }); }
function loadThread(key) {
  workspaceVersion += 1;
  stopVision();
  decisions.clear();
  $("agent-feed").replaceChildren(el("li", { className: "agent-empty", textContent: "Ready for your next thought. Suggestions appear here as you talk." }));
  for (const id of ["today-summary-out", "day-summary-out"]) $(id).replaceChildren(el("p", { className: "caption", textContent: "Your summary updates from your saved words." }));
  threadKey = key; threadLoaded = false;
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(`threadline.thread.v1.${key}`) || "null"); } catch { saved = null; }
  sessions = emptyThread();
  if (saved) for (const m of ["reflection", "routine"]) Object.assign(sessions[m], { notes: saved[m]?.notes || [], prefs: saved[m]?.prefs || [] });
  Object.assign(agent, { offer: null, events: saved?.events || [], proposal: null, skip: [], log: [], created: null });
  life.days = saved?.days || {}; life.cycle = { starts: [], notify: false, haptic: false, notifiedFor: "", ...(saved?.cycle || {}) };
  life.energyWords = saved?.energyWords || DEFAULT_ENERGY_WORDS;
  Object.assign(life, { positiveWords: saved?.positiveWords || "", energy: saved?.energy || null, tasks: saved?.tasks || [], energyLog: saved?.energyLog || [], actions: saved?.actions || [], checkins: saved?.checkins || { asked: false, optedIn: false, lastTap: 0 }, voice: saved?.voice || null });
  life.taskDrafts = saved?.taskDrafts || [];
  threadLoaded = true;
  seedSample(key);
}
/* Sample data fills empty screens for the demo; every item is flagged sample and labelled. */
const sampleOffKey = (key) => `threadline.sample.off.${key}`;
function sampleOff(key = threadKey) { try { return localStorage.getItem(sampleOffKey(key)) === "1"; } catch { return false; } }
function seedSample(key) {
  if (sampleOff(key)) return;
  const seed = sampleSeed(new Date());
  const notes = sessions.reflection.notes;
  if (!notes.length) notes.push(...seed.notes);
  if (!(life.tasks || []).length) life.tasks = seed.tasks;
  if (!(life.energyLog || []).length) life.energyLog = seed.energyLog;
  if (!(life.actions || []).length) life.actions = seed.actions;
  if (!life.energy) life.energy = seed.energy;
  for (const [day, rec] of Object.entries(seed.days)) if (!life.days[day]) life.days[day] = rec;
  try { if (!JSON.parse(localStorage.getItem(`threadline.transcripts.v1.${key}`) || "[]").length) localStorage.setItem(`threadline.transcripts.v1.${key}`, JSON.stringify(seed.archive)); } catch { /* storage off */ }
  renderSampleBanner();
}
function hasSample() {
  return sessions.reflection.notes.some((n) => n.sample) || (life.tasks || []).some((t) => t.sample) || (life.actions || []).some((a) => a.sample)
    || (life.energyLog || []).some((e) => e.sample) || loadArchive().some((e) => e.sample);
}
function renderSampleBanner() { const b = $("sample-banner"); if (b) b.hidden = !hasSample(); }
function clearSample() {
  try { localStorage.setItem(sampleOffKey(threadKey), "1"); } catch { /* storage off */ }
  sessions.reflection.notes = sessions.reflection.notes.filter((n) => !n.sample);
  for (const k of ["tasks", "energyLog", "actions"]) life[k] = (life[k] || []).filter((x) => !x.sample);
  if (life.energy?.sample) life.energy = null;
  for (const [day, rec] of Object.entries(life.days)) if (rec.sample) delete life.days[day];
  saveArchive(loadArchive().filter((e) => !e.sample));
  saveThread(); render(); renderArchive(); renderEnergy(); renderTasks(); renderToday(); renderDays(); renderSampleBanner();
}
/* The owner's Apple Health history (uploaded from the iPhone) — shown on the default profile only. */
const ownerHealth = { byDay: {}, latest: null, importedAt: null, days: 0 };
let ownerMood = moodSeries({}, 30);
const moodOf = (k) => ownerMood.days.find((d) => d.date === k) || null;
const moodWord = (v) => v > 0.5 ? "very pleasant" : v > 0.2 ? "pleasant" : v < -0.5 ? "very unpleasant" : v < -0.2 ? "unpleasant" : "neutral";
function drawDashboard() {
  try {
    renderDashboard($("dashboard"), { health: healthOn() ? ownerHealth.byDay : {}, mood: ownerMood, careHistory: typeof care !== "undefined" ? care.history : [],
      transcripts: loadArchive(), tasks: life.tasks || [], who: "Dad" });
  } catch (e) { $("dashboard").textContent = `Dashboard unavailable: ${e.message}`; }
}
window.addEventListener("hashchange", () => { if (location.hash === "#dashboard") drawDashboard(); });
function renderMood() {
  if (!$("mood-chart")) return;
  const days = ownerMood.days, t = days.at(-1), NS = "http://www.w3.org/2000/svg", W = 600, H = 180, x = (i) => 10 + (i / (days.length - 1)) * (W - 20), y = (v) => H / 2 - v * (H / 2 - 14);
  $("mood-today").replaceChildren(...(t ? [["This morning", `${t.morningLabel} · ${moodWord(t.morning)} (${t.morning > 0 ? "+" : ""}${t.morning})`], ["This evening", `${t.eveningLabel} · ${moodWord(t.evening)} (${t.evening > 0 ? "+" : ""}${t.evening})`], ["Evening agitation", `${["none", "mild", "moderate", "severe"][t.agitation]} (NPI-Q ${t.agitation})`], ["Repeated questions", String(t.repeats)]].map(([k, v]) => el("div", {}, el("small", { textContent: k }), el("b", { textContent: v }))) : []));
  const svg = $("mood-chart"), mk = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
  const kids = [mk("line", { x1: 0, x2: W, y1: H / 2, y2: H / 2, class: "zero" })];
  days.forEach((d, i) => { if (d.agitation) kids.push(mk("rect", { x: x(i) - 5, y: H - d.agitation * 14, width: 10, height: d.agitation * 14, class: "ag" })); });
  for (const [f, cls] of [["morning", "am"], ["evening", "pm"]]) kids.push(mk("polyline", { points: days.map((d, i) => `${x(i)},${y(d[f])}`).join(" "), class: cls }));
  svg.replaceChildren(...kids);
  $("mood-weeks").replaceChildren(...ownerMood.weeks.slice().reverse().map((w) => el("li", { className: w.score >= 11 ? "high" : w.score >= 6 ? "mid" : "low" },
    el("b", { textContent: `${w.score}` }), el("span", { textContent: ` week ending ${parseDay(w.weekEnding).toLocaleDateString([], { month: "short", day: "numeric" })} · ${w.band}` }))));
}
const r1 = (v) => (Math.round(v * 10) / 10).toLocaleString(), r0 = (v) => Math.round(v).toLocaleString();
const hm = (v) => `${Math.floor(v)} h ${String(Math.round((v % 1) * 60)).padStart(2, "0")} m`;
const HEALTH_COLS = [
  ["steps", "Steps", r0], ["distance_km", "Distance (km)", r1], ["active_energy_kcal", "Active energy (kcal)", r0], ["exercise_min", "Exercise (min)", r0],
  ["flights_climbed", "Flights climbed", r0], ["stand_hours", "Stand hours", r0], ["stand_min", "Stand (min)", r0],
  ["heart_rate", "Heart rate (avg)", r0], ["resting_heart_rate", "Resting HR", r0], ["hrv_sdnn", "HRV (ms)", r0], ["respiratory_rate", "Breathing (/min)", r1],
  ["oxygen_saturation", "Blood oxygen (%)", r0], ["sleep_hours", "Sleep", hm], ["wrist_temp_c", "Wrist temp (°C)", (v) => v.toFixed(2)],
  ["walking_speed_kmh", "Walking speed (km/h)", r1], ["walking_steadiness", "Walking steadiness (%)", r0], ["audio_exposure_db", "Noise (dB)", r0],
  ["mindful_min", "Mindful (min)", r0], ["workouts", "Workouts", (v, h) => `${h.workout_count ?? 1} · ${Math.round(v)} min`], ["mood", "Logged mood (valence)", (v) => v.toFixed(2)],
  ["menstrual_flow", "Period logged", () => "yes"],
];
function healthOn() { return isDefaultProfile() || !configuredBand; }
function hDay(key) { return healthOn() ? ownerHealth.byDay[key] || null : null; }
function hLatest() { return healthOn() ? ownerHealth.latest : null; }
async function loadOwnerHealth() {
  try {
    const r = await fetch("/api/health/summary?days=365"); if (!r.ok) return;
    const d = await r.json();
    ownerHealth.byDay = Object.fromEntries((d.daily || []).map((x) => [x.date, x]));
    const keys = Object.keys(ownerHealth.byDay).sort();
    ownerHealth.latest = ownerHealth.byDay[todayKey()] || (keys.length ? ownerHealth.byDay[keys.at(-1)] : null);
    ownerHealth.importedAt = d.imported_at; ownerHealth.days = keys.length;
    ownerMood = moodSeries(ownerHealth.byDay, 30);
    drawDashboard();
    renderEnergy(); renderToday(); renderDays(); renderIntegrations();
  } catch { /* offline: screens keep live readings only */ }
}
/* Live watch readings win; the latest Health day fills whatever the watch hasn't sent. */
function sensorsWithHealth() {
  const h = hLatest() || {}, live = Object.fromEntries(Object.entries(watch.sensors || {}).filter(([, v]) => v != null));
  return { heart_rate: h.heart_rate, hrv_sdnn_ms: h.hrv_sdnn, resting_hr: h.resting_heart_rate, respiratory_rate: h.respiratory_rate, spo2: h.oxygen_saturation,
    sleep_hours_last_night: h.sleep_hours, env_noise_db: h.audio_exposure_db, exercise_min_today: h.exercise_min, mindful_min_today: h.mindful_min, ...live };
}
function saveThread() {
  if (!threadLoaded) return;
  try {
    localStorage.setItem(`threadline.thread.v1.${threadKey}`, JSON.stringify({
      reflection: { notes: sessions.reflection.notes, prefs: sessions.reflection.prefs },
      routine: { notes: sessions.routine.notes }, events: agent.events,
      days: life.days, cycle: life.cycle, energyWords: life.energyWords,
      positiveWords: life.positiveWords, energy: life.energy, tasks: life.tasks, taskDrafts: life.taskDrafts, energyLog: life.energyLog, actions: life.actions, checkins: life.checkins, voice: life.voice,
    }));
  } catch { message("This browser blocked storage, so notes will be lost on refresh.", true); }
}
const capture = { active: false, band: null, ws: null, recorder: null, stream: null, startedAt: null, timer: 0, review: null, finals: [] };
const utterances = createUtteranceCollector();
function flushUtterance() {
  clearTimeout(capture.utteranceTimer);
  const statement = utterances.flush();
  if (statement) acceptUtterance(statement);
}
function acceptUtterance(statement) {
  delete statement.speaker;
  if ($("vision-consent").checked && capture.camStream) vision.queueCheck(statement.text);
  if (statement.speaker_confirmed) {
    addNotes([statement]);
    for (const line of capture.finals) if (statement.lineIds.includes(line.id)) line.saved = true;
    $("agent-status").textContent = "Your words saved. Updating your day…";
  } else agentDecide(statement);
}
function collectUtterance(msg, at, speaker) {
  const source = capture.vexo ? "vexo" : "mic";
  const statement = { id: newId("n"), text: msg.transcript, at: at.toISOString(), source,
    speaker, speaker_confirmed: capture.solo, lineIds: [msg.id] };
  for (const ready of utterances.push(statement, msg.speech_final || msg.provider === "gemini")) acceptUtterance(ready);
  clearTimeout(capture.utteranceTimer);
  capture.utteranceTimer = setTimeout(flushUtterance, 1200);
}

function message(text, error = false) { $("status").textContent = text; $("status").classList.toggle("error", error); }
function newId(prefix) { return `${prefix}-${crypto.randomUUID().slice(0, 8)}`; }

/* ---------- Thread ---------- */
function renderTimeline() {
  const session = sessions[mode];
  if (typeof scheduleGraph === "function") scheduleGraph();
  rebuildWordRecords(); saveThread(); renderEnergy(); renderDays(); renderToday(); scheduleDaySummary();
  $("sample-label").textContent = `Your statements only — stored in this browser${threadKey.startsWith("band-") ? ` for Vexo-HACK-${threadKey.slice(5).padStart(2, "0")}` : ""}. Nothing is stored on the server.`;
  $("timeline").replaceChildren();
  for (const note of session.notes) {
    const time = el("time", { dateTime: note.at, textContent: fmtWhen(note.at) }, el("span", { className: "note-id", textContent: note.id }));
    const badge = el("span", { className: `badge ${note.source}`, textContent: SOURCE_LABELS[note.source] || note.source });
    const text = el("p", { textContent: note.text });
    const li = el("li", { id: `note-${note.id}` }, time, el("div", { className: "meta" }, badge, el("span", { className: "speaker", textContent: note.speaker ? note.speaker : "Speaker: you" })), text);
    if (note.context) li.append(el("p", { className: "context", textContent: note.context }));
    {
      const edit = el("button", { type: "button", className: "text-button", textContent: "Correct" });
      const del = el("button", { type: "button", className: "text-button", textContent: "Delete" });
      edit.addEventListener("click", () => editNote(li, note));
      del.addEventListener("click", () => { session.notes = session.notes.filter((n) => n !== note); removeNoteSuggestions(note.id); renderTimeline(); message("Note deleted from this session."); });
      li.append(el("div", { className: "row tight" }, edit, del));
    }
    $("timeline").append(li);
  }
  if (!session.notes.length) $("timeline").append(el("p", { className: "empty", textContent: "Nothing yet. Capture a conversation or type a note — only what you save appears here." }));
}
function editNote(li, note) {
  const area = el("textarea", { value: note.text, rows: 2, maxLength: 4000 });
  const save = el("button", { type: "button", className: "secondary", textContent: "Save correction" });
  save.addEventListener("click", () => { const value = area.value.trim(); if (value) { note.text = value; note.corrected = true; delete note.energySignal; } removeNoteSuggestions(note.id); renderTimeline(); agentDecide({ ...note, speaker_confirmed: true }); message("Correction saved."); });
  li.querySelector("p").replaceWith(area); li.querySelector(".row.tight").replaceWith(el("div", { className: "row tight" }, save)); area.focus();
}
function addNotes(items) {
  const session = sessions[mode];
  const added = items.filter(item => !item.id || !session.notes.some(n => n.id === item.id)).map((item) => ({ id: newId("n"), context: "", ...item }));
  session.notes.push(...added);
  renderTimeline(); renderDays();
  for (const note of added) agentDecide({ id: note.id, text: note.text, at: note.at, source: note.source, speaker_confirmed: true });
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
      el("p", { className: "caption", textContent: `Matches: ${pref.triggers.join(", ")} · ${pref.action === "schedule" ? "offers schedule help" : pref.action === "update" ? `offers your update${pref.updateTo ? ` to ${pref.updateTo}` : ""}` : "shows earlier notes only"} · saved ${fmtDate(pref.at)}` }),
      remove));
  }
  if (!sessions[mode].prefs.length) list.append(el("li", { className: "empty", textContent: "Task drafts and self-reported energy update automatically. Add preferences for other kinds of support." }));
}
$("pref-action").addEventListener("change", () => { $("pref-update-fields").hidden = $("pref-action").value !== "update"; });
$("pref-save").addEventListener("click", () => {
  const text = $("pref-text").value.trim(), triggers = $("pref-triggers").value.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (!text || !triggers.length) return message("Write the preference and at least one matching word.", true);
  const action = $("pref-action").value, update = $("pref-update-text").value.trim();
  if (action === "update" && !update) return message("Write the update you pre-approve sending.", true);
  sessions[mode].prefs.push({ id: newId("pref"), text, triggers, action, update, updateTo: $("pref-update-to").value.trim(), at: new Date().toISOString(), source: "typed" });
  $("pref-text").value = ""; $("pref-triggers").value = ""; $("pref-update-text").value = ""; renderPrefs(); message("Preference saved.");
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
    el("h3", { textContent: offer.pref.action === "schedule" ? "Want to look at tomorrow and make some space?" : offer.pref.action === "update" ? `Send your update${offer.pref.updateTo ? ` to ${offer.pref.updateTo}` : ""}?` : "Here's what you said before." }),
    el("p", { className: "caption", textContent: "Why this is showing:" }), why,
    el("p", { className: "caption", textContent: offer.decided ? `Decided by ${offer.decided} from your own words and preferences — no inference about your mood, cycle, or judgment.` : `Matched by your own word “${offer.hit}” using a local rule — no AI, and no inference about your mood, cycle, or judgment.` }),
  ];
  if (offer.status === "offered" && offer.pref.action === "schedule") {
    const yes = el("button", { type: "button", className: "primary", innerHTML: "Review my schedule <span aria-hidden=\"true\">→</span>" });
    const no = el("button", { type: "button", className: "text-button", textContent: "Not now — just keep the note" });
    yes.addEventListener("click", () => { offer.status = "accepted"; renderSupport(); renderCalendar(); $("calendar").scrollIntoView({ behavior: "smooth", block: "start" }); });
    no.addEventListener("click", () => { offer.status = "declined"; renderSupport(); message("Okay. Your note is saved and nothing else will happen."); });
    children.push(yes, no);
  } else if (offer.status === "offered" && offer.pref.action === "update") {
    // Pre-approved by you; Threadline still never sends anything itself — your own messaging app does.
    const msg = el("blockquote", { className: "update-msg", textContent: offer.pref.update });
    const share = el("button", { type: "button", className: "primary", innerHTML: "Share… <span aria-hidden=\"true\">↗</span>" });
    const sms = el("a", { className: "secondary ics", href: `sms:?&body=${encodeURIComponent(offer.pref.update)}`, textContent: "Open Messages" });
    const copy = el("button", { type: "button", className: "secondary", textContent: "Copy" });
    const no = el("button", { type: "button", className: "text-button", textContent: "Not now" });
    share.addEventListener("click", async () => { try { await navigator.share({ text: offer.pref.update }); offer.status = "shared"; renderSupport(); logAction(`Shared your pre-approved update${offer.pref.updateTo ? ` with ${offer.pref.updateTo}` : ""}`); } catch { message("Sharing was cancelled or isn't available here — use Copy or Open Messages."); } });
    copy.addEventListener("click", async () => { try { await navigator.clipboard.writeText(offer.pref.update); message("Copied. Paste it to your close friends."); } catch { message("Copy failed; select the text instead.", true); } });
    no.addEventListener("click", () => { offer.status = "declined"; renderSupport(); });
    children.push(msg, el("div", { className: "row" }, share, sms, copy), no);
  } else if (offer.status === "shared") {
    children.push(el("p", { className: "done", textContent: "Handed to your share sheet. Threadline did not send anything itself." }));
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
    agent.events.push(data.event); agent.created = data.event; agent.proposal = null; logAction(`Protected quiet time ${fmtClock(data.event.start)}–${fmtClock(data.event.end)} tomorrow`);
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
let kit = null, logic = null, bandNumber = null, configuredBand = null;
const service = { ready: false, loading: null, reflection: false, transcription: false };
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

fetch("/api/device").then((r) => r.json()).then(async (d) => {
  configuredBand = d.vexo_band_number;
  try { localStorage.removeItem("threadline.token"); } catch { /* storage off */ }
  const fromUrl = new URLSearchParams(location.search).get("band");
  const start = (fromUrl && /^\d{1,3}$/.test(fromUrl) && Number(fromUrl) > 0) ? Number(fromUrl) : recentBands()[0] || configuredBand;
  if (start) chooseBand(start, false); else { loadThread("browser"); render(); }
  renderPair(); setRecUI();
  await ensureService();
}).catch(() => { renderPair(); recState("Couldn't connect to Threadline. Reload to try again.", true); });

async function ensureService() {
  if (service.ready) return;
  if (service.loading) return service.loading;
  service.loading = (async () => {
    const d = await request("/api/device");
    if (d.guest_sessions) await request("/api/session", { method: "POST" });
    else if (d.token_required) throw new Error("Threadline is not available yet. Please try again shortly.");
    const c = await request("/api/config");
    service.reflection = c.reflection_ready;
    service.transcription = c.transcription_ready;
    service.ready = true;
    renderIntegrations();
  })();
  try { await service.loading; } finally { service.loading = null; }
}

function chooseBand(number, remember = true) {
  if (capture.band || pair.busy) return;
  bandNumber = number;
  $("pick-number").value = String(number).padStart(2, "0");
  if (remember) rememberBand(number);
  const url = new URL(location.href); url.searchParams.set("band", String(number).padStart(2, "0")); history.replaceState(null, "", url);
  loadThread(`band-${number}`); render(); renderProfile(); setTimeout(() => { resumeWatch(); if (demoWanted()) startDemoFeed(); else stopDemoFeed(); }, 0);
  renderPair(); renderArchive(); bandStatus("");
}
$("pick-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const raw = $("pick-number").value.trim();
  if (!/^\d{1,3}$/.test(raw) || Number(raw) < 1) { $("pick-message").textContent = "A band number is one to three digits, like 07 or 42."; return; }
  $("pick-message").textContent = ""; chooseBand(Number(raw));
});
function setPairState(state, text) {
  pair.state = state; $("pair").dataset.state = state; $("pair-status").textContent = text;
  if ($("side-band")) { $("side-band").dataset.state = state; $("side-band-name").textContent = bandNumber ? bandLabel() : "No band"; $("side-band-state").textContent = text; }
  if ($("nav-live")) $("nav-live").hidden = !capture.active;
  chip("band", state === "connected" || state === "mic", state === "busy" ? text : capture.band ? `${capture.band.name}${capture.active ? " · recording" : ""}` : "not connected");
}
function chip(id, on, text) { const c = $(`chip-${id}`); if (!c) return; c.dataset.on = String(on); $(`chip-${id}-v`).textContent = text; }
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
  $("rec-start").disabled = busy || live || Boolean(vexo && capture.band?.reconnecting);  // no band → records from the computer mic
  $("rec-stop").disabled = !live;
  $("source").disabled = live; $("cam-on").disabled = live; $("capture-identity").disabled = live;
  $("cam-device").disabled = live; $("cam-connect").disabled = live;
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

async function connectBand(kind, port = null) {
  if (!bandNumber || capture.band || pair.busy) return;
  const quiet = Boolean(port);  // automatic reconnect to the remembered USB port: no chooser, no error noise
  const mine = ++pair.attempt, wanted = bandLabel();
  pair.busy = true;
  setPairState("busy", "Connecting…");
  bandStatus(quiet ? `Reconnecting ${wanted} on the USB cable…` : kind === "ble" ? `Pick ${wanted} in the list, then press Pair.` : kind === "serial" ? "Pick “Vexo Open band” in the list, then press Connect." : "Starting the pretend band…");
  let connected = null;
  try {
    await loadKit();
    pair.slow = setTimeout(() => { if (mine === pair.attempt && pair.busy) bandStatus(logic.stillConnectingMessage(kind, wanted)); }, logic.STILL_CONNECTING_MS);
    let transport = kind;
    if (port) {  // a port this site was already allowed to use: open it directly, no chooser
      const Remembered = class extends kit.WebSerialTransport { async open() { await this._start(port); } };
      transport = new Remembered();
    }
    // The library filters Bluetooth to this exact name and refuses a band whose number differs.
    connected = await kit.Band.connect(bandNumber, { transport, autoReconnect: true });
    if (connected.number !== bandNumber) { await connected.disconnect(); throw Object.assign(new Error(`That is ${connected.name}, not ${wanted}. Disconnected without changing it.`), { code: "wrong-band" }); }
  } catch (e) {
    if (mine === pair.attempt) { pair.busy = false; if (quiet) { setPairState("idle", ""); bandStatus(""); } else bandStatus(logic ? logic.connectProblem(e, { kind, wanted }) : e.message, true); }
  } finally { clearTimeout(pair.slow); }
  if (mine !== pair.attempt) { connected?.disconnect().catch(() => {}); return; }  // Cancel was pressed meanwhile
  pair.busy = false;
  if (!connected) return renderPair();
  rememberBand(bandNumber);
  attachBand(connected);
  showConnect(true);
  if (!capture.active) $("source").value = "vexo";  // the band is the microphone again
  setTimeout(maybeAutoStart, 1200);
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
  band.on("reconnected", async (event) => {
    setTimeout(maybeAutoStart, 1500);
    bandStatus("The band reconnected."); setRecUI();
    if (capture.active && !capture.stopping) {
      capture.lastPacketAt = Date.now(); capture.warnedSilent = false;
      capture.decoder?.restart(); capture.pcmChunks = [];
      try {
        await claimBandAudio(band);
        recState(event.failed?.length ? "Band audio restarted. Some other readings could not be restored." : "Band audio restarted. Waiting for sound.");
      } catch { recState("The band reconnected, but audio did not restart. Press Take it back.", true); $("rec-takeback").hidden = false; }
    }
  });
  band.on("double-tap", () => { if (band.transportKind === "sim") return;  // the pretend band double-taps by itself
    if (capture.active) { autoRec.userStopped = true; stopLive(); } else if (!busy) { autoRec.userStopped = false; $("rec-start").click(); } });
  band.on("stream-taken", (e) => { recState(`${e.message} Close the Vexo dashboard tab, then press “Take it back”.`, true); $("rec-takeback").hidden = false; });
  band.on("notice", (e) => { if (e.kind === "low-battery" || e.kind === "critical-battery") bandStatus(`Band battery is low (${e.kind}). Plug in the cable.`, true); });
  // Audio goes to whichever Deepgram socket is open right now (sockets are replaced on reconnect).
  attachSignals(band);
  band.on("audio", (a) => {
    if (!capture.active || capture.stopping) return;
    capture.bandPackets = (capture.bandPackets || 0) + 1;
    capture.lastPacketAt = Date.now();
    capture.decoder?.push(a);
    if (capture.warnedSilent) { capture.warnedSilent = false; recState("Band audio is arriving again."); $("rec-takeback").hidden = true; }
    if (capture.pcm) return;  // decoded PCM is queued from the decoder instead (Deepgram linear16)
    if (queueBandAudio(capture.audioQueue, a)) capture.droppedPackets += 1;
    flushBandAudio();
  });
}
function flushBandAudio() {
  const ws = capture.ws;
  if (!ws?.providerReady || ws.readyState !== 1 || !capture.active || capture.stopping) return;
  if (ws.audioFormat !== (capture.vexo ? (capture.pcm ? "vexo_pcm" : "vexo") : "browser")) return;
  while (capture.audioQueue.length && ws.bufferedAmount < 128 * 1024) {
    const packet = capture.audioQueue.shift();
    if (!ws.hasAudio) { ws.offset = Math.max(0, (packet.time - capture.startedAt.getTime()) / 1000); ws.hasAudio = true; }
    try { ws.send(packet.opus); capture.packets += 1; }
    catch { capture.audioQueue.unshift(packet); ws.close(); break; }
  }
}
function recoverSpeech() {
  if (capture.fallbackBusy) return capture.fallbackPending;
  if (!capture.active || !capture.pcmChunks?.length || !$("rec-consent").checked) return;
  const origin = capture.startedAt, chunks = capture.pcmChunks.slice();
  const duration = chunks.reduce((n, chunk) => n + chunk.length, 0) / 16000;
  const start = Math.max(0, (Date.now() - origin) / 1000 - duration);
  capture.fallbackBusy = true; capture.lastFallbackAt = Date.now();
  $("speech-status").textContent = "Checking the last few seconds of speech…";
  capture.fallbackPending = (async () => { try {
    const data = await request("/api/transcribe/fallback", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: pcmWav(chunks) });
    if (!capture.active || capture.startedAt !== origin) return;
    const text = data.text?.trim();
    if (text && !capture.finals.some(f => f.start >= start - 2 && f.transcript.trim() === text)) {
      const line = { transcript: text, start, duration, words: [], is_final: true, provider: "gemini" };
      capture.finals.push(line); addLiveLine(line); capture.lastTextAt = Date.now();
    }
    $("speech-status").textContent = text ? "Recovered speech shown above. Check it before saving." : "No clear speech recovered. Bring the band closer to your mouth and try again.";
  } catch { $("speech-status").textContent = "Couldn't check recent speech. Live transcription continues."; }
  finally { capture.fallbackBusy = false; }
  })();
  return capture.fallbackPending;
}
$("recover-speech").addEventListener("click", recoverSpeech);
$("band-disconnect").addEventListener("click", async () => { try { await capture.band?.disconnect(); } catch { /* already gone */ } capture.band = null; bandStatus("Disconnected."); setRecUI(); });

$("rec-start").addEventListener("click", async () => {
  if (capture.active) return;
  if (!$("rec-consent").checked) return recState("Confirm recording consent first.", true);
  try { await ensureService(); } catch (e) { return recState(e.message, true); }
  if (!service.transcription) return recState("Transcription is temporarily unavailable. Please try again later.", true);
  // The Vexo band is the recorder. No band → say exactly what to do; never fall back to another microphone.
  if ($("source").value === "vexo" && !capture.band) { $("pair").scrollIntoView({ behavior: "smooth", block: "start" }); return recState("The Vexo band isn't connected yet. Close the Vexo dashboard tab, then press Connect (or Connect by USB cable) above and pick Vexo-HACK-73. Recording starts by itself once it connects.", true); }
  const source = $("source").value, vexo = source === "vexo", camera = $("cam-on").checked;
  let stream = null;
  if (!vexo || camera) {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return recState("This browser cannot record from the microphone or camera.", true);
    try {
      // Audio comes from the band when it records, so the camera's own microphone is never requested.
      const audio = vexo ? null : await navigator.mediaDevices.getUserMedia({ audio: true });
      const video = camera ? (capture.camStream || await navigator.mediaDevices.getUserMedia({ video: cameraConstraint() })) : null;
      if (video) capture.camStream = video;
      stream = new MediaStream([...(audio ? audio.getTracks() : []), ...(video ? video.getVideoTracks() : [])]);
    } catch { return recState(`${camera ? "Camera" : "Microphone"} permission was not granted. Nothing was recorded.`, true); }
  }
  Object.assign(capture, { active: true, source, vexo, stream, startedAt: new Date(), finals: [], stopping: false, packets: 0, chunks: 0,
    warnedSilent: false, lastError: "", reconnects: 0, audioStarted: Date.now(), lastPacketAt: Date.now(), audioQueue: [], droppedPackets: 0, audioClaimed: false,
    pcmChunks: [], lastSpeechAt: 0, lastTextAt: Date.now(), lastFallbackAt: Date.now(), fallbackBusy: false, fallbackPending: null, finishing: false, interimCount: 0, firstTextMs: null, archiveId: newId("t") });
  capture.solo = $("capture-identity").value === "solo"; utterances.reset();
  if (vexo && await kit.canDecodeAudio()) capture.decoder = new kit.BandAudio((samples) => {
    if (!capture.active || capture.stopping) return;
    capture.lastDecodedAt = Date.now();
    capture.pcmChunks.push(samples.slice());
    if (capture.pcm) {  // Send the official decoder's 16 kHz PCM16 to the matching Deepgram connection.
      const pcm = new Int16Array(kit.toInt16(samples));
      capture.audioQueue.push({ opus: new Uint8Array(pcm.buffer), time: Date.now() });
      if (capture.audioQueue.length > 400) { capture.audioQueue.shift(); capture.droppedPackets += 1; }
      flushBandAudio();
    }
    while (capture.pcmChunks.length > 600) capture.pcmChunks.shift();
    const rms = Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);
    capture.rmsDb = rms ? 20 * Math.log10(rms) : -96;
    if (capture.rmsDb > -42) capture.lastSpeechAt = Date.now();
    signals.level = Math.max(0, Math.min(1, (capture.rmsDb + 60) / 40));
    $("sig-loud").style.width = `${Math.round(signals.level * 100)}%`; pushWave(signals.level);
  }, { rate: 16000, onError: () => switchToBandOpus("Audio decoder stopped") });
  capture.pcm = Boolean(capture.decoder);
  capture.bandPackets = 0; capture.lastDecodedAt = Date.now();
  $("rec-takeback").hidden = true;
  $("live").hidden = false; $("live-lines").replaceChildren(); $("live-interim").textContent = ""; capture.sourceLabel = (vexo ? `${capture.band.name} · ${({ serial: "USB", ble: "Bluetooth", sim: "pretend" })[capture.band.transportKind] || ""}` : SOURCE_LABELS_LIVE[source]) + (camera ? " + camera" : "");
  if (camera) startVideo(stream);
  capture.marks = [];
  if (!vexo) {
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
  $("live-timer").textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  $("live-source").textContent = `${capture.sourceLabel || ""} · ${count} ${capture.vexo ? "packets" : "chunks"}${capture.reconnects ? ` · ${capture.reconnects} reconnect${capture.reconnects > 1 ? "s" : ""}` : ""}${capture.droppedPackets ? ` · ${capture.droppedPackets} packets missed while offline` : ""}`;
  if (capture.vexo) flushBandAudio();
  if (capture.vexo && capture.pcm && Date.now() - capture.lastDecodedAt > 5000 && Date.now() - capture.lastPacketAt < 1000) switchToBandOpus("Band packets arrived but decoding stalled");
  if (capture.vexo && capture.packets) {
    const age = Math.round((Date.now() - capture.lastTextAt) / 1000);
    $("speech-status").textContent = `${capture.bandPackets || 0} received · ${capture.packets} sent as ${capture.ws?.audioFormat === "vexo_pcm" ? "PCM16" : "Opus"} · ${capture.interimCount} speech updates · ${capture.finals.length} finished lines${capture.firstTextMs != null ? ` · first text ${(capture.firstTextMs / 1000).toFixed(1)}s after stream start` : ""}${capture.rmsDb != null ? ` · mic ${Math.round(capture.rmsDb)} dBFS` : ""}${age > 10 ? ` · last text ${age}s ago` : ""}`;
    if (!capture.fallbackBusy && capture.decoder && capture.lastSpeechAt > capture.lastTextAt && Date.now() - capture.lastTextAt > 8000 && Date.now() - capture.lastFallbackAt > 8000) recoverSpeech();
  }
  if (capture.vexo && capture.ws?.providerReady && Date.now() - (capture.lastPacketAt || capture.audioStarted) > 5000 && !capture.warnedSilent && !capture.band?.reconnecting) {
    capture.warnedSilent = true;
    recState(capture.vexo ? "No audio is arriving from the band. If the Vexo dashboard (or another tab) is connected to it, close that, then press “Take it back”." : "No audio is arriving from the microphone. Check the browser's microphone permission and input device.", true);
    if (capture.vexo) $("rec-takeback").hidden = false;
  }
}
function switchToBandOpus(reason) {
  if (!capture.active || capture.stopping || !capture.pcm) return;
  capture.pcm = false; capture.decoder?.close(); capture.decoder = null; capture.audioQueue = [];
  $("speech-status").textContent = `${reason}. Reconnecting with the band's original Opus audio…`;
  // Each connection has one encoding for its lifetime; close before routing different bytes.
  capture.ws?.close(4000, "audio format changed");
}
function openSocket() {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/live-transcribe`);
  ws.audioFormat = capture.vexo ? (capture.pcm ? "vexo_pcm" : "vexo") : "browser";
  ws.binaryType = "arraybuffer"; capture.ws = ws;
  const opened = Date.now();
  ws.onopen = () => ws.send(JSON.stringify({ source: ws.audioFormat, ...(publishKey() ? { publish_key: publishKey() } : {}) }));
  ws.onmessage = async (event) => {
    if (ws !== capture.ws || !capture.active) return;
    const msg = JSON.parse(event.data);
    if (msg.type === "ready") {
      capture.streamReadyAt = performance.now();
      ws.providerReady = true; capture.lastError = "";
      ws.offset = (Date.now() - capture.startedAt) / 1000;  // Deepgram times restart at 0 for each socket
      if (capture.vexo) {
        try {
          if (!capture.audioClaimed) {
            capture.lastPacketAt = Date.now();
            await claimBandAudio(capture.band);
            if (!capture.active || capture.stopping) { await capture.band.configure({ audio: false }); return; }
            capture.audioClaimed = true;
            await startSignals();
          }
          flushBandAudio();
        } catch { capture.lastError = "Couldn't start the band's microphone. Reconnect your band and try again."; return stopLive(capture.lastError); }
      }
      if (capture.recorder && capture.recorder.state === "inactive") capture.recorder.start(250);
      recState(capture.vexo ? "● Listening through the band's microphone (solid blue light). Streaming to Deepgram." : "● Listening through this browser's microphone. Streaming to Deepgram.");
    } else if (msg.type === "result") {
      if (msg.transcript?.trim() && capture.firstTextMs == null) capture.firstTextMs = Math.round(performance.now() - capture.streamReadyAt);
      if (msg.is_final && msg.transcript?.trim()) capture.lastTextAt = Date.now();
      if (!msg.is_final && msg.transcript?.trim()) capture.interimCount += 1;
      if (msg.is_final) {
        if (msg.transcript.trim()) {
          const shift = ws.offset || 0;
          const final = { ...msg, start: msg.start + shift, words: msg.words.map((w) => ({ ...w, start: (w.start || 0) + shift, end: (w.end || 0) + shift })) };
          final.activity = signals.activity;
          if (watch.sensors?.heart_rate != null && Date.now() - watch.sensorsAt < 10000) final.hr = Math.round(watch.sensors.heart_rate);
          capture.finals.push(final); addLiveLine(final);
        }
        $("live-interim").textContent = "";
      } else $("live-interim").textContent = msg.transcript;
    } else if (msg.type === "utterance_end") flushUtterance();
    else if (msg.type === "error") { capture.lastError = msg.message; recState(msg.message, true); }
    else if (msg.type === "closed") ws.closedCleanly = true;
  };
  ws.onclose = () => {
    if (ws !== capture.ws) return;
    flushUtterance();
    ws.providerReady = false;
    if (capture.active && !capture.stopping) {
      // Unexpected drop (network, provider limit): keep recording on a fresh socket.
      const quick = Date.now() - opened < 3000;
      capture.reconnects += 1;
      if (capture.reconnects > 20 || (capture.lastError && /session expired|limit reached/i.test(capture.lastError)) || (quick && capture.lastError && /token|configure|Set DEEPGRAM|Another live transcript/i.test(capture.lastError))) return finishLive();
      recState("Connection dropped — reconnecting. Up to two seconds of band audio is buffered.", true);
      if (capture.recorder && capture.recorder.state === "recording") capture.recorder.stop();  // a new WebM stream needs its own header
      setTimeout(() => { if (capture.active && !capture.stopping) openSocket(); }, quick ? 2000 : 300);
    } else finishLive();
  };
}
function addLiveLine(msg) {
  msg.id ||= newId("line");
  const speakers = [...new Set(msg.words.map((w) => w.speaker).filter((x) => x != null))];
  const who = speakers.length ? speakers[0] : null;
  const at = new Date(capture.startedAt.getTime() + msg.start * 1000);
  $("live-interim").textContent = "";
  $("live-lines").append(el("li", { className: `line spk-${who ?? "x"}` },
    el("span", { className: "avatar", "aria-hidden": "true", textContent: who ?? "?" }),
    el("div", {},
      el("div", { className: "line-meta" }, el("b", { textContent: who == null ? "Speaker ?" : `Speaker ${who}` }),
        el("span", { textContent: ` · ${at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}${msg.activity ? ` · ${msg.activity}` : ""}${msg.hr ? ` · ♥ ${msg.hr}` : ""}` })),
      el("p", { textContent: msg.transcript }))));
  if (location.hash === "#live" || !location.hash) { const box = $("live-lines"); box.scrollTop = box.scrollHeight; }
  archiveSession(capture.finals, { startedAt: capture.startedAt, source: capture.source, marks: capture.marks || [], id: capture.archiveId });
  const voice = voiceMetrics(capture.finals); if (voice) life.voice = voice;
  renderEnergy(); renderToday();
  collectUtterance(msg, at, who);
}
async function stopLive(reason) {
  if (!capture.active || capture.stopping) return;
  capture.stopping = true;
  capture.audioQueue = [];
  capture.decoder?.close(); capture.decoder = null;
  recState(reason || "Stopping… waiting for the last words from Deepgram.");
  if (capture.band && !capture.band.reconnecting) { try { await capture.band.configure({ audio: false }); } catch { /* band gone */ } await stopSignals(); }
  if (capture.recorder && capture.recorder.state !== "inactive") capture.recorder.stop();
  stopVideo();
  capture.stream?.getTracks().forEach((t) => t.stop()); releaseCamera();
  const ws = capture.ws;
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "stop" })); else finishLive();
  setTimeout(() => { if (capture.ws === ws && ws) ws.close(); }, 6000);
}
$("rec-stop").addEventListener("click", () => { autoRec.userStopped = true; stopLive(); });
$("rec-takeback").addEventListener("click", async () => {
  if (!capture.band) return;
  try {
    if (capture.active) await claimBandAudio(capture.band);
    else await capture.band.takeBack();
    capture.warnedSilent = false; capture.audioStarted = capture.lastPacketAt = Date.now();
    $("rec-takeback").hidden = true; recState("Took the microphone back. Listening through the band.");
  } catch (e) { recState(`Could not take the band back: ${e.message}`, true); }
});
async function finishLive() {
  setTimeout(maybeAutoRestart, 4000);
  if (!capture.active || capture.finishing) return;
  capture.finishing = true;
  if (capture.vexo && (capture.fallbackBusy || capture.lastSpeechAt > capture.lastTextAt)) {
    recState("Checking the last words before opening your transcript…");
    await recoverSpeech();
  }
  flushUtterance();
  clearInterval(capture.timer); $("live-timer").textContent = `stopped · ${$("live-timer").textContent.replace("● live · ", "")}`;
  const { finals, source, startedAt } = capture;
  if (finals.length) { archiveSession(finals, { startedAt, source, marks: capture.marks || [], id: capture.archiveId }); const vm = voiceMetrics(finals); if (vm) { life.voice = vm; saveThread(); renderEnergy(); } }
  if (capture.band && !capture.stopping && !capture.band.reconnecting) capture.band.configure({ audio: false }).catch(() => {});
  if (capture.recorder && capture.recorder.state !== "inactive") capture.recorder.stop();
  stopVideo();
  capture.stream?.getTracks().forEach((t) => t.stop()); releaseCamera();
  Object.assign(capture, { active: false, ws: null, recorder: null, stream: null, stopping: false, audioQueue: [], audioClaimed: false });
  capture.decoder?.close(); capture.decoder = null; capture.pcmChunks = [];
  setRecUI();
  if (!capture.vexo) $("signals").hidden = true;
  if (!finals.length) { const err = capture.lastError; capture.lastError = ""; return recState(err ? `Capture ended: ${err}` : "Capture ended. No speech was transcribed; nothing was saved.", Boolean(err)); }
  const segments = finals.filter(f => !f.saved).flatMap(f => segmentsFromWords(f.words, f.transcript).map(s => ({ ...s, offset: f.words?.length ? s.offset : f.start, provider: f.provider || "deepgram" })));
  if (!segments.length) { recState("Recording stopped. Your words are saved and your day is up to date."); return; }
  openReview(segments, source === "vexo" ? "vexo" : "mic", startedAt,
    `${SOURCE_LABELS_LIVE[source]} · ${transcriptProviders(finals)} · ${finals.length} lines. Speaker labels separate voices; they do not prove identity.`);
  recState("Recording stopped. Review the remaining conversation to add it to your personal thread.");
}

/* Camera: explicit opt-in, previewed live, recorded only in this browser (never uploaded). */
function startVideo(stream) {
  chip("cam", true, `${stream.getVideoTracks()[0]?.label || "camera"} · recording`);
  const tracks = stream.getVideoTracks(); if (!tracks.length) return;
  clearVideo();
  const preview = $("cam-preview"); preview.srcObject = new MediaStream(tracks); preview.hidden = false; preview.play().catch(() => {});
  if ($("vision-consent").checked) vision.start(preview);
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
  stopVision();
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
  // Everyone present consented, so every line is saved automatically, labelled by speaker. No review step.
  const items = segments.filter((seg) => (seg.text || "").trim()).map((seg) => ({
    text: seg.text.trim(), at: new Date(startedAt.getTime() + (seg.offset || 0) * 1000).toISOString(), source,
    speaker: seg.speaker == null ? "Unlabeled" : `Speaker ${seg.speaker}` }));
  if (items.length) addNotes(items);
  capture.review = null; $("review").hidden = true;
  message(`Saved ${items.length} line${items.length === 1 ? "" : "s"} automatically · ${label.split("·")[0].trim()}`);
  return;
}
function openReviewManual(segments, source, startedAt, label) {
  capture.review = { source, startedAt, segments: segments.map((s) => ({ ...s, who: "unsure" })) };
  const speakers = [...new Set(segments.map((s) => s.speaker))];
  $("who").replaceChildren(el("option", { value: "", textContent: "Choose…" }), ...speakers.map((s) => el("option", { value: String(s), textContent: s === null ? "Unlabeled speaker" : `Speaker ${s}` })), el("option", { value: "none", textContent: "None of these is me" }));
  $("review-source").textContent = label;
  renderWhoButtons();
  $("review").hidden = false; renderSegments(); $("review").scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function renderWhoButtons() {
  const r = capture.review; if (!r) return;
  const counts = {}; for (const seg of r.segments) counts[String(seg.speaker)] = (counts[String(seg.speaker)] || 0) + 1;
  const chosen = $("who").value;
  const make = (value, label, sub) => { const b = el("button", { type: "button", role: "radio", "aria-checked": String(chosen === value), className: `who-btn${chosen === value ? " on" : ""}` }, value !== "none" ? el("span", { className: "avatar", "aria-hidden": "true", textContent: value === "null" ? "?" : value }) : null, el("span", { textContent: label }), sub ? el("small", { textContent: sub }) : null);
    b.addEventListener("click", () => { $("who").value = value; $("who").dispatchEvent(new Event("change")); renderWhoButtons(); }); return b; };
  $("who-buttons").replaceChildren(...Object.entries(counts).map(([k, n]) => make(k, `${k === "null" ? "Unlabeled" : `Speaker ${k}`} is me`, `${n} line${n > 1 ? "s" : ""}`)), make("none", "None of these is me", ""));
}
function renderReviewSummary() {
  const r = capture.review; if (!r) return;
  const mine = r.segments.filter((x) => x.who === "me").length, other = r.segments.filter((x) => x.who === "other").length, unsure = r.segments.length - mine - other;
  $("review-summary").replaceChildren(...[el("span", {}, el("b", { textContent: String(mine) }), ` your line${mine === 1 ? "" : "s"}`), el("span", {}, el("b", { textContent: String(other) }), " excluded from your thread"), unsure ? el("span", {}, el("b", { textContent: String(unsure) }), " not sure — excluded from your thread") : null].filter(Boolean));
  $("review-save").textContent = mine ? `Save ${mine} statement${mine > 1 ? "s" : ""}` : "Save my statements";
}
function renderSegments() {
  const r = capture.review; $("segments").replaceChildren(); renderReviewSummary();
  r.segments.forEach((seg, i) => {
    const who = el("select", { "aria-label": `Who said segment ${i + 1}` }, ...[["unsure", "Not sure — exclude"], ["me", "Me"], ["other", "Someone else — exclude"]].map(([v, t]) => el("option", { value: v, textContent: t, selected: seg.who === v })));
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
  const rec = dayRec(todayKey(r.startedAt)); rec.others += r.segments.filter((x) => x.who === "other").length; rec.mine += mine.length;
  addNotes(mine.map((s) => ({ text: s.text.trim(), at: new Date(r.startedAt.getTime() + s.offset * 1000).toISOString(), source: r.source })));
  capture.review = null; $("review").hidden = true;
  message(`Saved ${mine.length} statement${mine.length > 1 ? "s" : ""} as yours.${dropped ? ` ${dropped} other segments excluded from your thread.` : ""} The original transcript remains in Transcripts until deleted.`);
});
$("review-discard").addEventListener("click", () => { capture.review = null; $("review").hidden = true; message("Nothing added to your personal thread. Delete the original in Transcripts if you no longer want it."); });

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
  if (!$("rec-consent").checked) throw new Error("Allow recording and processing on Your band before sending notes or audio.");
  if (!service.ready) throw new Error("Threadline is still connecting. Try again in a moment.");
  return {};
}
async function renewSession() {
  // Visitor sessions expire; renew silently instead of showing "Demo session missing or expired".
  const r = await fetch("/api/session", { method: "POST" });
  return r.ok;
}
async function request(url, options, retried = false) {
  const response = await fetch(url, options), data = await response.json().catch(() => ({}));
  if (response.status === 401 && !retried && url !== "/api/session" && /Demo session/i.test(String(data.detail || "")) && await renewSession()) return request(url, options, true);
  if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : `The request could not be completed (${response.status}).`);
  return data;
}

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
  life.taskDrafts = [];
  if (mode === "reflection") Object.assign(agent, { offer: null, proposal: null, skip: [], log: [], created: null });
  render(); showAnswer("Your session notes have been cleared."); message("Fresh session · no saved notes");
});
$("question-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const question = $("question").value.trim(), notes = sessions[mode].notes;
  if (busy || !question) return;
  if (!notes.length) return message("Add a note before asking a question.", true);
  if (!service.reflection || !$("rec-consent").checked) {
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
  if ($("mode-description")) $("mode-description").textContent = MODES[mode].description;
  $("question").value = sessions[mode].question;
  document.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
  renderTimeline(); renderPrefs(); renderSupport(); renderCalendar(); setRecUI(); renderArchive(); renderDays(); renderEnergy(); renderTasks(); renderIntegrations(); renderToday();
}

/* ---------- Band signals ---------- */
// What the band itself reports while capturing: loudness, movement state, steps, taps, battery.
// These describe the device and the room, never the wearer's feelings.
const signals = { level: 0, activity: "", steps0: null, steps: 0, taps: 0, battery: "" };
function attachSignals(band) {
  band.on("mic-level", (e) => { signals.level = Math.max(0, Math.min(1, (52 - e.rmsDb) / 40)); $("sig-loud").style.width = `${Math.round(signals.level * 100)}%`; pushWave(signals.level); });
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
  if (signals.steps > 0) { dayRec().bandSteps += signals.steps; signals.steps = 0; renderDays(); }
  if (capture.band && !capture.band.reconnecting) { try { await capture.band.configure({ micLevel: false, activity: false }); } catch { /* gone */ } }
  $("sig-loud").style.width = "0%";
}

/* ---------- Stored transcripts (this browser, per band) ---------- */
const archiveKey = () => `threadline.transcripts.v1.${bandNumber ? `band-${bandNumber}` : "browser"}`;
function loadArchive() { try { return JSON.parse(localStorage.getItem(archiveKey()) || "[]"); } catch { return []; } }
function saveArchive(list) { try { localStorage.setItem(archiveKey(), JSON.stringify(list.slice(0, 50))); return true; } catch { return false; } }
function transcriptProviders(lines) { return [...new Set(lines.map(l => l.provider === "gemini" ? "Gemini recovery" : "Deepgram"))].join(" + "); }
function archiveSession(finals, meta) {
  const lines = finals.map((f) => {
    const speakers = [...new Set(f.words.map((w) => w.speaker).filter((s) => s != null))];
    return { at: new Date(meta.startedAt.getTime() + f.start * 1000).toISOString(), offset: f.start, speakers, text: f.transcript, provider: f.provider || "deepgram", activity: f.activity || "", hr: f.hr ?? null, marked: meta.marks.some((m) => m >= f.start - 1 && m <= f.start + (f.duration || 0) + 1) };
  });
  const entry = { id: meta.id || newId("t"), startedAt: meta.startedAt.toISOString(), endedAt: new Date().toISOString(), source: meta.source, device: meta.device || capture.band?.name || (meta.source === "browser" ? "Browser microphone" : bandNumber ? bandLabel() : ""), marks: meta.marks.length, lines };
  const ok = saveArchive([entry, ...loadArchive().filter(item => item.id !== entry.id)]);
  renderArchive();
  renderToday();
  return ok;
}
function renderArchive() {
  const list = loadArchive(), box = $("archive"), q = ($("archive-search")?.value || "").trim().toLowerCase();
  $("archive-caption").textContent = `Every captured session's full transcript${bandNumber ? ` for ${bandLabel()}` : ""}, stored in this browser only. Nothing is stored on the server.`;
  const shown = q ? list.filter((e) => e.lines.some((l) => l.text.toLowerCase().includes(q))) : list;
  box.replaceChildren();
  if (!shown.length) { box.append(el("li", { className: "empty", textContent: q ? "No session mentions that." : "No transcripts yet. Start a live capture." })); $("archive-detail").replaceChildren(el("p", { className: "caption", textContent: list.length ? "Choose a session to read its transcript." : "Transcripts appear here after a live session." })); return; }
  if (!shown.some((e) => e.id === archiveSel)) archiveSel = shown[0].id;
  for (const entry of shown) {
    const mins = Math.max(1, Math.round((new Date(entry.endedAt) - new Date(entry.startedAt)) / 60000));
    const a = el("button", { type: "button", className: `session${entry.id === archiveSel ? " current" : ""}`, "aria-pressed": String(entry.id === archiveSel) },
      el("span", { className: "s-top" }, el("b", { textContent: new Date(entry.startedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) }), entry.marks ? el("span", { className: "s-star", textContent: `★ ${entry.marks}` }) : null),
      el("span", { className: "caption", textContent: `${entry.device} · ${mins} min · ${entry.lines.length} lines` }));
    a.addEventListener("click", () => { archiveSel = entry.id; renderArchive(); });
    box.append(el("li", {}, a));
  }
  const entry = shown.find((e) => e.id === archiveSel);
  const exp = el("button", { type: "button", className: "secondary", textContent: "Export .txt" });
  const review = el("button", { type: "button", className: "primary-sm", textContent: "Save statements from this" });
  const del = el("button", { type: "button", className: "secondary danger", textContent: "Delete" });
  exp.addEventListener("click", () => {
    const text = entry.lines.map((l) => `[${new Date(l.at).toLocaleString()}] ${l.speakers.map((s) => `Speaker ${s}`).join(", ") || "Speaker ?"}${l.marked ? " ★" : ""}: ${l.text}`).join("\n");
    const a = el("a", { href: URL.createObjectURL(new Blob([text], { type: "text/plain" })), download: `threadline-transcript-${entry.startedAt.slice(0, 16).replace(/[:T]/g, "-")}.txt` });
    document.body.append(a); a.click(); a.remove();
  });
  review.addEventListener("click", () => { location.hash = "live"; openReview(entry.lines.map((l) => ({ speaker: l.speakers[0] ?? null, text: l.text, offset: l.offset })), entry.source === "browser" ? "mic" : entry.source === "watch" ? "watch" : "vexo", new Date(entry.startedAt), `${entry.device} · stored transcript from ${new Date(entry.startedAt).toLocaleString()}.`); });
  del.addEventListener("click", () => { if (confirm("Delete this transcript from this browser?")) { saveArchive(loadArchive().filter((e) => e.id !== entry.id)); archiveSel = ""; renderArchive(); } });
  const mark = (text) => { if (!q) return [text]; const i = text.toLowerCase().indexOf(q); return i < 0 ? [text] : [text.slice(0, i), el("mark", { textContent: text.slice(i, i + q.length) }), text.slice(i + q.length)]; };
  $("archive-detail").replaceChildren(
    el("header", { className: "ad-head" }, el("div", {}, el("h3", { textContent: new Date(entry.startedAt).toLocaleString([], { weekday: "long", hour: "numeric", minute: "2-digit" }) }), el("div", { className: "caption", textContent: `${entry.device} · ${transcriptProviders(entry.lines)} · speaker labels are not identities` })), el("div", { className: "row tight" }, review, exp, del)),
    el("ol", { className: "script" }, ...entry.lines.map((l) => el("li", { className: `line spk-${l.speakers[0] ?? "x"}${l.marked ? " marked" : ""}` },
      el("span", { className: "avatar", "aria-hidden": "true", textContent: l.speakers[0] ?? "?" }),
      el("div", {}, el("div", { className: "line-meta" }, el("b", { textContent: l.speakers.length ? `Speaker ${l.speakers[0]}` : "Speaker ?" }), el("span", { textContent: ` · ${new Date(l.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}${l.activity ? ` · ${l.activity}` : ""}${l.hr ? ` · ♥ ${l.hr}` : ""}${l.marked ? " · ★ marked" : ""}` })), el("p", {}, ...mark(l.text)))))));
}
let archiveSel = "";
$("archive-search").addEventListener("input", () => renderArchive());
$("archive-clear").addEventListener("click", () => { if (confirm("Delete every stored transcript for this band from this browser?")) { saveArchive([]); renderArchive(); } });

/* ---------- Knowledge graph (rebuilds as statements are saved) ---------- */
const graph = { timer: 0, version: 0, data: null, selected: null, signature: "" };
const TYPE_COLORS = { person: "#0E7C86", feeling: "#E8452C", time: "#D99A1E", place: "#6B5BD6", commitment: "#16161A", preference: "#3B4BDB", topic: "#8A8A92" };
function graphEngine() { return service.reflection && $("rec-consent").checked ? "gemini" : "local"; }
function scheduleGraph(delay = 8000) {
  if (mode !== "reflection") { $("graph-panel").hidden = true; return; }
  $("graph-panel").hidden = false;
  if (graph.timer && delay) return;
  clearTimeout(graph.timer); graph.timer = setTimeout(() => { graph.timer = 0; buildGraph(); }, delay);
}
async function buildGraph() {
  const notes = sessions.reflection.notes.slice(-60).map(({ id, text, at, source, context }) => ({ id, text, at, source, context, speaker: "me", device: source === "vexo" && bandNumber ? bandLabel() : "" }));
  const engine = graphEngine(), signature = engine + "|" + notes.map((n) => n.id + n.text).join("|");
  const version = ++graph.version, scope = workspaceVersion;
  if (!notes.length) { graph.data = null; graph.signature = ""; drawGraph(); $("graph-status").textContent = "No saved statements yet"; return; }
  if (signature === graph.signature && graph.data) return;
  $("graph-status").textContent = engine === "gemini" ? "Updating with Gemini…" : "Updating…";
  try {
    await ensureService();
    if (engine === "gemini") liveHeaders();
    const data = await request("/api/graph", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: engine, notes }) });
    if (version !== graph.version || scope !== workspaceVersion || !notes.every(n => sessions.reflection.notes.some(current => current.id === n.id && current.text === n.text))) { scheduleGraph(); return; }
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
const watch = { ws: null, code: "", finals: [], startedAt: null, device: "Apple Watch", sensors: null, sensorsAt: 0, owningLive: false };
setInterval(() => { if (watch.sensorsAt) { const s = Math.round((Date.now() - watch.sensorsAt) / 1000); $("ws-age").hidden = false; $("ws-age").textContent = s < 5 ? "Live from the watch" : `Last reading ${s} s ago`; } }, 1000);
function watchState(state, text) { $("watch-pair").dataset.state = state; $("watch-status").textContent = text; chip("watch", state === "connected", state === "idle" ? "not paired" : text); }
function watchMsg(text, error = false) { $("watch-msg").textContent = text; $("watch-msg").classList.toggle("error", error); }
$("watch-pair-btn").addEventListener("click", async () => {
  if (watch.ws) return;
  try {
    const token = "", headers = {};
    const data = await request("/api/watch/pair", { method: "POST", headers });
    watch.code = data.code;
    $("watch-code").textContent = data.code.replace(/(\d{3})(\d{3})/, "$1 $2");
    $("watch-code-box").hidden = false; $("watch-pair-btn").hidden = true; $("watch-unpair").hidden = false; $("watch-claim-form").hidden = true;
    watchState("busy", "Waiting for your watch…"); watchMsg(`Code expires in ${Math.round(data.expires_in / 60)} minutes if unused.`);
    openWatchFeed(token);
  } catch (e) { watchMsg(e.message.includes("Not Found") ? "Apple Watch pairing is not available on this server yet." : e.message, true); }
});
async function openWatchFeed(token) {
  await renewSession().catch(() => false);  // the feed socket uses the visitor session cookie
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/watch/feed`);
  watch.ws = ws;
  ws.onopen = () => ws.send(JSON.stringify({ token, code: watch.code }));
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "watch_connected") {
      watch.device = msg.device || "Apple Watch"; watch.finals = []; watch.startedAt = new Date();
      watchState("connected", `${watch.device} · connected`); watchMsg("Connected. Readings stream from the watch.");
      $("watch-code-box").hidden = true; watch.owningLive = false;
    } else if (msg.type === "sensors") {
      applyWatchSensors(msg);
    } else if (msg.type === "cycle") {
      let added = 0;
      for (const d of msg.period_starts || []) if (/^\d{4}-\d{2}-\d{2}$/.test(d) && !life.cycle.starts.some((x) => x.date === d)) { life.cycle.starts.push({ date: d, source: "health" }); added += 1; }
      renderDays(); watchMsg(added ? `Added ${added} period start date${added > 1 ? "s" : ""} from Apple Health.` : "Cycle dates from Apple Health are already here.");
    } else if (msg.type === "log_mood_sent") { $("mood-msg").textContent = "On your watch now — confirm there to save it in Apple Health.";
    } else if (msg.type === "mood_failed") { $("mood-msg").textContent = "The watch couldn't save it (needs watchOS 11 and Health permission).";
    } else if (msg.type === "mood_logged") { $("mood-msg").textContent = "Saved to Apple Health (State of Mind) after your confirmation."; logAction("Saved a mood to Apple Health (you confirmed on the watch)");
    } else if (msg.type === "mood_declined") { $("mood-msg").textContent = "Not saved — you declined on the watch.";
    } else if (msg.type === "haptic_sent") {
      watchMsg("Tapped your watch.");
    } else if (msg.type === "result") {
      if (capture.active) return;  // the band is recording; the watch only adds readings
      if (!watch.owningLive) { watch.owningLive = true; watch.startedAt = watch.startedAt || new Date(); $("live").hidden = false; $("live-lines").replaceChildren(); $("live-interim").textContent = ""; $("live-source").textContent = `${watch.device} · microphone`; $("signals").hidden = true; }
      if (msg.is_final && msg.transcript.trim()) {
        watch.finals.push(msg);
        const speakers = [...new Set(msg.words.map((w) => w.speaker).filter((s) => s != null))];
        $("live-lines").append(el("li", {}, el("span", { className: "caption", textContent: `${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })} · ${watch.device} · ${speakers.length ? speakers.map((s) => `Speaker ${s}`).join(", ") : "Speaker ?"}` }), el("p", { textContent: msg.transcript })));
        { const box = $("live-lines"); box.scrollTop = box.scrollHeight; }
        $("live-interim").textContent = "";
      } else if (!msg.is_final) $("live-interim").textContent = msg.transcript;
    } else if (msg.type === "watch_disconnected") {
      watchState("busy", "Watch stopped · waiting for it again");
      finishWatchSession();
    } else if (msg.type === "error") { if (/Unknown or expired/i.test(msg.message)) { rememberWatch(null); watchMsg("Your watch needs to pair again: open Threadline on it for a new code.", true); } else watchMsg(msg.message, true); }
  };
  ws.onclose = () => { if (watch.ws === ws) { watch.ws = null; finishWatchSession(); watchState("idle", "Not paired"); $("watch-pair-btn").hidden = true;  /* page-started codes need operator access; guests pair from the watch */ $("watch-unpair").hidden = true; $("watch-code-box").hidden = true; $("watch-claim-form").hidden = false; } };
}
function finishWatchSession() {
  if (!watch.finals.length) return;
  const finals = watch.finals.map((f) => ({ ...f, start: f.start || 0 })); watch.finals = [];
  archiveSession(finals, { startedAt: watch.startedAt || new Date(), source: "watch", marks: [], device: watch.device });
  openReview(segmentsFromWords(finals.flatMap((f) => f.words), finals.map((f) => f.transcript).join(" ")), "watch", watch.startedAt || new Date(), `${watch.device} · Deepgram live transcript. Speaker labels separate voices; they do not prove identity.`);
  recState("Watch recording ended. Everything was saved automatically.");
}
$("watch-unpair").addEventListener("click", () => { rememberWatch(null); setTimeout(startDemoFeed, 500); const ws = watch.ws; watch.ws = null; ws?.close(); finishWatchSession(); watchState("idle", "Not paired"); watchMsg("Unpaired."); $("watch-pair-btn").hidden = true;  /* page-started codes need operator access; guests pair from the watch */ $("watch-unpair").hidden = true; $("watch-code-box").hidden = true; $("watch-claim-form").hidden = false; });


/* Consented visual context. Frames stay in memory and are not written to the transcript store. */
const vision = createVisionController({
  getContext: () => {
    const saved = sessions.reflection.notes.slice(-6).map(({ id, text, at, source }) => ({ id, text, at, source }));
    const recent = capture.active ? capture.finals.slice(-6).map(f => ({ id: f.id, text: f.transcript,
      at: new Date(capture.startedAt.getTime() + f.start * 1000).toISOString(), source: "live conversation; speaker unverified" })) : [];
    let budget = 12000;
    const transcript = [...saved, ...recent].slice(-12).reverse().filter(line => {
      if (line.text.length > budget) return false;
      budget -= line.text.length; return true;
    }).reverse();
    return { active: Boolean(capture.camStream?.getVideoTracks().some(t => t.readyState === "live")),
      allowed: $("vision-consent").checked && $("rec-consent").checked, scope: workspaceVersion,
      transcript, question: $("vision-question").value.trim() };
  },
  request,
  onStatus: text => { $("vision-status").textContent = text; },
  onResult: (data, frames) => {
    const evidence = new Map(frames.map(frame => [frame.id, frame]));
    $("vision-answer").replaceChildren(el("p", { className: "provenance", textContent: "Gemini · camera snapshots + recent words · check the evidence" }),
      el("p", { textContent: data.answer }),
      el("p", {}, el("b", { textContent: "Next step: " }), data.next_step),
      ...(data.uncertainties?.length ? [el("p", { className: "caption", textContent: `Still unknown: ${data.uncertainties.join(" ")}` })] : []));
    $("vision-evidence").replaceChildren(...(data.observations || []).map(observation => {
      const frame = evidence.get(observation.frame_id);
      return el("figure", {}, ...(frame ? [el("img", { src: frame.dataUrl, alt: observation.description }),
        el("span", { className: "caption", textContent: new Date(frame.at).toLocaleTimeString() })] : []), el("figcaption", { textContent: observation.description }));
    }));
  },
});
function stopVision() {
  vision.stop();
  $("vision-status").textContent = "Visual help stopped. Connect a camera and allow snapshots to start.";
  $("vision-evidence").replaceChildren();
  $("vision-answer").replaceChildren(el("p", { className: "caption", textContent: "Visual session stopped. Images were cleared from this page." }));
}
function syncVision() {
  if ($("vision-consent").checked && $("rec-consent").checked && capture.camStream) vision.start($("cam-preview"));
  else stopVision();
}
$("vision-consent").addEventListener("change", syncVision);
$("rec-consent").addEventListener("change", syncVision);
$("vision-check").addEventListener("click", () => vision.analyze($("vision-question").value.trim()));
$("vision-question-form").addEventListener("submit", event => { event.preventDefault(); vision.analyze($("vision-question").value.trim()); });

/* Camera choice: any camera the browser sees, e.g. "GoPro Webcam" from the GoPro Webcam app. */
function cameraConstraint() { const id = $("cam-device").value; return id ? { deviceId: { exact: id } } : true; }
async function listCameras() {
  try {
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
    const current = $("cam-device").value;
    $("cam-device").replaceChildren(el("option", { value: "", textContent: "Default camera" }), ...cams.map((c, i) => el("option", { value: c.deviceId, textContent: c.label || `Camera ${i + 1} (connect to see its name)`, selected: c.deviceId === current })));
    const gopro = cams.find((c) => /gopro/i.test(c.label));
    if (gopro && !current) $("cam-device").value = gopro.deviceId;
  } catch { /* no device list */ }
}
function releaseCamera() { stopVision(); capture.camStream?.getTracks().forEach((t) => t.stop()); capture.camStream = null; if (!capture.active) { $("cam-preview").srcObject = null; $("cam-preview").hidden = true; } chip("cam", false, $("cam-on").checked ? "ready to connect" : "off"); }
$("cam-on").addEventListener("change", () => { $("cam-pick").hidden = !$("cam-on").checked; $("vision-panel").hidden = !$("cam-on").checked; if ($("cam-on").checked) listCameras(); else releaseCamera(); chip("cam", false, $("cam-on").checked ? "ready to connect" : "off"); });
$("cam-device").addEventListener("change", () => { if (capture.camStream) $("cam-connect").click(); });
$("cam-connect").addEventListener("click", async () => {
  if (capture.active) return;
  try {
    capture.camStream?.getTracks().forEach((t) => t.stop());
    capture.camStream = await navigator.mediaDevices.getUserMedia({ video: cameraConstraint() });
    const track = capture.camStream.getVideoTracks()[0];
    $("cam-preview").srcObject = capture.camStream; $("cam-preview").hidden = false; $("cam-preview").play().catch(() => {});
    $("vision-panel").hidden = false;
    if ($("vision-consent").checked) vision.start($("cam-preview"));
    else $("vision-status").textContent = "Camera preview only. Allow visual help to send selected snapshots to Gemini.";
    await listCameras();
    chip("cam", true, track?.label || "connected");
    $("chip-cam").hidden = false;
    track?.addEventListener("ended", () => { stopVision(); chip("cam", false, "disconnected"); recState("The camera disconnected.", true); });
  } catch (e) { chip("cam", false, "not allowed"); recState(`Camera unavailable: ${e.message}`, true); }
});
navigator.mediaDevices?.addEventListener?.("devicechange", () => { if ($("cam-on").checked) listCameras(); });


/* ---------- Your days + cycle (only real inputs; stored in this browser per band) ---------- */
const DAY_MS = 86400000;
const parseDay = (s) => new Date(`${s}T12:00:00`);
function cycleInfo() {
  const starts = [...new Set(life.cycle.starts.map((x) => x.date))].sort();
  if (!starts.length) return { starts };
  const last = starts[starts.length - 1];
  const dayOf = (key) => { const d = Math.floor((parseDay(key) - parseDay(last)) / DAY_MS) + 1; return d >= 1 ? d : null; };
  const gaps = starts.slice(1).map((d, i) => Math.round((parseDay(d) - parseDay(starts[i])) / DAY_MS)).filter((g) => g >= 15 && g <= 60).slice(-6);
  if (!gaps.length) return { starts, last, dayOf };
  const avg = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
  const spread = Math.max(...gaps) - Math.min(...gaps);
  const next = new Date(parseDay(last).getTime() + avg * DAY_MS);
  return { starts, last, dayOf, avg, spread, next, cycles: gaps.length };
}
function renderDays() {
  if (!$("days-body")) return;
  $("days-panel").hidden = mode !== "reflection";
  $("energy-words").value = life.energyWords;
  const info = cycleInfo(), rows = [];
  // Columns come from the data: every metric found in the Health history gets its own column automatically.
  const DAYS = 30, keys = [...Array(DAYS)].map((_, i) => todayKey(new Date(Date.now() - i * DAY_MS)));
  const present = new Set(); for (const k of keys) for (const m of Object.keys(hDay(k) || {})) present.add(m);
  const cols = HEALTH_COLS.filter(([m]) => present.has(m));
  for (const m of present) if (!["date", "workout_types", "workout_count"].includes(m) && !HEALTH_COLS.some(([x]) => x === m)) cols.push([m, m.replace(/_/g, " "), (v) => (Math.round(v * 10) / 10).toLocaleString()]);
  $("days-head").replaceChildren(el("tr", {}, el("th", { scope: "col", textContent: "Day" }), el("th", { scope: "col", textContent: "Conversation lines" }), el("th", { scope: "col", textContent: "Low-energy words" }), el("th", { scope: "col", textContent: "Mood AM / PM" }), el("th", { scope: "col", textContent: "Evening agitation" }), el("th", { scope: "col", textContent: "Repeated questions" }),
    ...cols.map(([, label]) => el("th", { scope: "col", textContent: label })), present.has("workout_types") ? el("th", { scope: "col", textContent: "Workout types" }) : null));
  let filled = 0;
  for (const [i, key] of keys.entries()) {
    const r = life.days[key], h = hDay(key) || {};
    if (Object.keys(h).length > 1) filled += 1;
    const label = i === 0 ? "Today" : i === 1 ? "Yesterday" : parseDay(key).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
    const fmt = (m, f) => { if (m === "steps" && r?.watchSteps != null) return `${r.watchSteps.toLocaleString()} watch`; if (m === "heart_rate" && r?.hrN) return `${Math.round(r.hrSum / r.hrN)} (${r.hrMin}–${r.hrMax})`; const v = h[m]; return v == null ? "—" : f(v, h); };
    rows.push(el("tr", {}, el("th", { scope: "row", textContent: label }),
      el("td", { textContent: r && (r.others || r.mine) ? `${(r.others || 0) + (r.mine || 0)}` : "—" }),
      el("td", { textContent: r?.energy?.length ? `${r.energy.length} (${[...new Set(r.energy.map((e) => e.word))].join(", ")})` : "—" }),
      el("td", { textContent: moodOf(key) ? `${moodOf(key).morningLabel} / ${moodOf(key).eveningLabel}` : "—" }),
      el("td", { textContent: moodOf(key) ? ["none", "mild", "moderate", "severe"][moodOf(key).agitation] : "—" }),
      el("td", { textContent: moodOf(key) ? String(moodOf(key).repeats) : "—" }),
      ...cols.map(([m, , f]) => el("td", { textContent: fmt(m, f) })),
      present.has("workout_types") ? el("td", { textContent: h.workout_types ? Object.entries(h.workout_types).map(([k, v]) => `${k.replace(/([a-z])([A-Z])/g, "$1 $2")} ${Math.round(v)} min`).join(", ") : "—" }) : null));
  }
  $("days-status").textContent = ownerHealth.days ? `${filled} of the last ${DAYS} days have Health data · ${cols.length} metrics · from ${ownerHealth.days} days imported` : "Waiting for Health data…";
  $("days-body").replaceChildren(...rows);
  // cycle
  $("cycle-dates").replaceChildren(...info.starts.slice(-8).reverse().map((d) => {
    const src = life.cycle.starts.find((x) => x.date === d)?.source;
    const rm = el("button", { type: "button", className: "text-button", textContent: "Remove", "aria-label": `Remove ${d}` });
    rm.addEventListener("click", () => { life.cycle.starts = life.cycle.starts.filter((x) => x.date !== d); renderDays(); });
    return el("li", {}, el("span", { textContent: parseDay(d).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) }), src === "health" ? el("span", { className: "badge vexo", textContent: "Apple Health" }) : null, rm);
  }));
  $("cycle-estimate").textContent = !info.starts.length ? "Add the first day of your last periods, or share them from Apple Health on the watch."
    : !info.avg ? `Cycle day ${info.dayOf(todayKey()) ?? "—"} today. Add one more start date to estimate the next one.`
    : `Cycle day ${info.dayOf(todayKey())} today. Next period estimated around ${info.next.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} — from your last ${info.cycles} cycle${info.cycles > 1 ? "s" : ""} (average ${info.avg} days${info.spread ? `, they varied by ${info.spread} day${info.spread > 1 ? "s" : ""}` : ""}).`;
  $("cycle-notify").checked = life.cycle.notify; $("cycle-haptic").checked = life.cycle.haptic;
  saveThread();
  maybeNotifyCycle(info);
}
function maybeNotifyCycle(info = cycleInfo()) {
  if (!life.cycle.notify || !info.next) return;
  const daysLeft = Math.ceil((info.next - new Date()) / DAY_MS), key = todayKey(info.next);
  if (daysLeft > 2 || daysLeft < -3 || life.cycle.notifiedFor === key) return;
  const text = `Your period is estimated around ${info.next.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}, from your own dates.`;
  try { if ("Notification" in window && Notification.permission === "granted") new Notification("Threadline", { body: text }); } catch { /* not allowed */ }
  if (life.cycle.haptic) sendHaptic("notification", "Cycle estimate reminder");
  logAction("Cycle reminder from your own dates");
  life.cycle.notifiedFor = key; saveThread();
  message(text);
}
function sendHaptic(kind, reason) {
  if (watch.ws?.readyState === 1) watch.ws.send(JSON.stringify({ type: "haptic", kind, reason }));
}
$("cycle-add").addEventListener("click", () => {
  const d = $("cycle-date").value;
  if (!d || parseDay(d) > new Date()) return message("Pick a start date that isn't in the future.", true);
  if (!life.cycle.starts.some((x) => x.date === d)) life.cycle.starts.push({ date: d, source: "typed" });
  $("cycle-date").value = ""; renderDays();
});
$("cycle-notify").addEventListener("change", async () => {
  life.cycle.notify = $("cycle-notify").checked;
  if (life.cycle.notify && "Notification" in window && Notification.permission === "default") { try { await Notification.requestPermission(); } catch { /* ignored */ } }
  if (life.cycle.notify && "Notification" in window && Notification.permission === "denied") message("This browser blocks notifications for the site; the reminder will show on the page instead.", true);
  renderDays();
});
$("cycle-haptic").addEventListener("change", () => { life.cycle.haptic = $("cycle-haptic").checked; if (life.cycle.haptic && !watch.ws) message("Pair the Apple Watch (Devices) so it can tap your wrist.", true); renderDays(); });
$("energy-words").addEventListener("change", () => { life.energyWords = $("energy-words").value; saveThread(); });
const daySummary = { timer: null, running: false, signature: "", scope: -1 };
function scheduleDaySummary() {
  if (daySummary.timer) return;
  daySummary.timer = setTimeout(() => { daySummary.timer = null; summarizeToday(); }, 10000);
}
$("day-summary").addEventListener("click", () => summarizeToday());
async function summarizeToday() {
  if (daySummary.running) { scheduleDaySummary(); return; }
  const key = todayKey(), r = life.days[key];
  const notes = sessions.reflection.notes.filter((n) => todayKey(new Date(n.at)) === key).slice(-30).map(({ id, text, at, source, context }) => ({ id, text, at, source, context }));
  const outputs = [$("today-summary-out"), $("day-summary-out")];
  const signature = JSON.stringify(notes), scope = workspaceVersion;
  if (!notes.length) { for (const out of outputs) { out.hidden = false; out.replaceChildren(el("p", { className: "caption", textContent: "Your summary will update automatically as your words are saved." })); } daySummary.signature = signature; return; }
  if (signature === daySummary.signature && scope === daySummary.scope) return;
  if (!service.reflection || !$("rec-consent").checked) return;
  const info = cycleInfo();
  const readings = [r?.energy.length ? `${r.energy.length} low-energy words` : "", r?.others ? `${r.others} lines from other people in reviewed conversations` : "",
    r?.watchSteps != null ? `${r.watchSteps} steps on the watch` : "", r?.hrN ? `average heart rate ${Math.round(r.hrSum / r.hrN)}` : "", info.dayOf ? `self-reported cycle day ${info.dayOf(key)}` : ""].filter(Boolean).join("; ");
  try {
    daySummary.running = true;
    const headers = liveHeaders();
    const data = await request("/api/reflect", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ mode: "reflection", question: `Summarize my day in 3 short bullet points using my own statements. Device readings for context (numbers only, not feelings): ${readings || "none"}.`, notes }) });
    if (scope !== workspaceVersion || !notes.every(n => sessions.reflection.notes.some(current => current.id === n.id && current.text === n.text))) { scheduleDaySummary(); return; }
    for (const out of outputs) { out.hidden = false; out.replaceChildren(el("p", { className: "provenance", textContent: "Updated automatically · Gemini · from your saved words" }), el("p", { textContent: data.answer }), el("div", { className: "sources" }, ...(data.sources || []).filter(id => notes.some(n => n.id === id)).map(sourceLink))); }
    daySummary.signature = signature; daySummary.scope = scope;
    if (signature !== JSON.stringify(sessions.reflection.notes.filter(n => todayKey(new Date(n.at)) === key).slice(-30).map(({ id, text, at, source, context }) => ({ id, text, at, source, context })))) scheduleDaySummary();
  } catch { if (scope === workspaceVersion) for (const out of outputs) { out.hidden = false; out.replaceChildren(el("p", { className: "caption", textContent: "Summary update unavailable. Your transcript and saved words are still here." })); } }
  finally { daySummary.running = false; }
}


/* ---------- Views (sidebar) ---------- */
const VIEW_TITLES = { dashboard: "Dashboard", today: "Your day", transcripts: "Transcripts", live: "Your band", energy: "Energy", tasks: "Plan with your energy", thread: "Thread", days: "Daily log", graph: "Graph", devices: "Your band", integrations: "Integrations", care: "Care" };
function showView(name) {
  if (name.startsWith("note-")) {
    const target = name; showView("thread");
    requestAnimationFrame(() => document.getElementById(target)?.scrollIntoView({ block: "center" })); return;
  }
  if (name === "watch") {  // Apple Watch pairing lives at #watch; the redesign keeps it out of the menu
    document.querySelectorAll(".view").forEach((v) => { v.hidden = v.dataset.view !== "devices"; });
    document.querySelectorAll("[data-view-link]").forEach((a) => a.setAttribute("aria-current", "false"));
    $("view-title").textContent = "Apple Watch"; careOnView("watch"); return;
  }
  if (!VIEW_TITLES[name] || name === "devices" || name === "integrations") name = "live";
  document.querySelectorAll(".view").forEach((v) => { v.hidden = v.dataset.view !== name; });
  document.querySelectorAll("[data-view-link]").forEach((a) => a.setAttribute("aria-current", a.dataset.viewLink === name ? "page" : "false"));
  $("view-title").textContent = VIEW_TITLES[name];
  if (name === "graph" && typeof drawGraph === "function") { drawGraph(); scheduleGraph(0); }
  if (name === "today") renderToday(); if (name === "transcripts") renderArchive();
  careOnView(name);
  if (name === "energy") renderEnergy(); if (name === "integrations") renderIntegrations(); if (name === "tasks") renderTasks();
}
window.addEventListener("hashchange", () => showView(location.hash.slice(1)));
// chips and inner links (#pair, #watch-pair) lead to Devices
document.addEventListener("click", (e) => { const a = e.target.closest("a[href='#pair'], a[href='#watch-pair']"); if (a) { e.preventDefault(); location.hash = "live"; } });
// first view is shown at the end of the script, after every view's code has loaded

/* Recorder waveform from the band's loudness */
const WAVE_BARS = 48, waveLevels = new Array(WAVE_BARS).fill(0);
$("wave").replaceChildren(...waveLevels.map(() => el("span")));
function pushWave(level) {
  waveLevels.shift(); waveLevels.push(level);
  [...$("wave").children].forEach((b, i) => { b.style.height = `${4 + Math.round(waveLevels[i] * 40)}px`; });
}


/* ---------- Agent: Gemini Decisions API chooses what would help; rules are enforced on the server ---------- */
function agentEngine() { return service.reflection && $("rec-consent").checked ? "gemini" : "local"; }
function agentPayload(statement) {
  const info = cycleInfo(), r = life.days[todayKey()];
  return {
    statement,
    recent: sessions.reflection.notes.filter((n) => n.id !== statement.id).slice(-20).map(({ id, text, at }) => ({ id, text, at })),
    preferences: sessions.reflection.prefs.slice(-20).map(({ id, text, triggers, action }) => ({ id, text, triggers, action })),
    today: { low_energy_words: r?.energy.length || 0, lines_from_others: r?.others || 0, steps: r?.watchSteps ?? (r?.bandSteps || null), heart_rate_avg: r?.hrN ? Math.round(r.hrSum / r.hrN) : null,
      cycle_day: info.dayOf ? info.dayOf(todayKey()) : null, next_period_estimate: info.next ? todayKey(info.next) : null,
      hrv_sdnn_ms: watch.sensors?.hrv_sdnn_ms ?? null, resting_hr: watch.sensors?.resting_hr ?? null, sleep_hours: watch.sensors?.sleep_hours_last_night ?? null },
    tasks: (life.tasks || []).slice(-40).map((t) => ({ id: t.id, title: t.title, due: t.due, big_decision: Boolean(t.big), done: Boolean(t.done) })),
    voice: life.voice ? { words_per_min: life.voice.words_per_min, avg_pause_s: life.voice.avg_pause_s, loudness: life.voice.loudness, talk_share: life.voice.talk_share } : {},
    devices: { band: Boolean(capture.band), watch: Boolean(watch.ws && $("watch-pair").dataset.state === "connected") },
    engine: agentEngine(),
  };
}
const decisions = createSerialQueue(async ({ statement, scope }) => {
  if (scope !== workspaceVersion) return;
  $("agent-status").textContent = `Reading your words${decisions.length ? ` · ${decisions.length} queued` : ""}…`;
  try {
    await ensureService();
    const d = await request("/api/agent/decide", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(agentPayload(statement)) });
    if (scope !== workspaceVersion) return;
    if (statement.speaker_confirmed && !sessions.reflection.notes.some(n => n.id === statement.id && n.text === statement.text)) return;
    if (d.energy_signal && statement.speaker_confirmed) applyEnergySignal(d.energy_signal, statement);
    actOnDecision(d, statement);
    $("agent-status").textContent = decisions.length ? `${decisions.length} thoughts waiting · transcript stays live` : "Up to date with your words.";
  } catch {
    if (scope !== workspaceVersion) return;
    $("agent-status").textContent = "Couldn't analyze that thought. Its transcript is saved; new speech continues.";
    if (statement.speaker_confirmed) checkPreferences(sessions.reflection.notes.find(n => n.id === statement.id) || statement);
  }
}, { max: 100 });
function agentDecide(statement) {
  if ([...statement.text.trim()].length < 4) return;
  if (!decisions.enqueue({ statement, scope: workspaceVersion })) $("agent-status").textContent = "Analysis queue full. Speech is still being saved; review the transcript for pending actions.";
}
function actOnDecision(d, statement) {
  const feed = $("agent-feed");
  if (d.energy_signal && !statement.speaker_confirmed) {
    feed.querySelector(".agent-empty")?.remove();
    const confirm = el("button", { type: "button", className: "secondary", textContent: "That was me — use this self-report" });
    const card = el("li", { className: "act" }, el("div", {}, el("b", { textContent: "A self-report in the conversation" }), el("p", { textContent: statement.text }), el("p", { className: "caption", textContent: "Confirm the speaker before adding this to your energy history." }), confirm));
    confirm.addEventListener("click", () => {
      addNotes([statement]); applyEnergySignal(d.energy_signal, statement);
      card.replaceChildren(el("p", { className: "done", textContent: "Added your self-report to Energy." }));
    });
    feed.prepend(card);
    while (feed.children.length > 12) feed.lastChild.remove();
  }
  const engine = d.engine === "gemini" ? `Gemini${d.confidence != null ? ` · ${Math.round(d.confidence * 100)}%` : ""}` : `local rules${d.fallback_reason ? " (Gemini unavailable)" : ""}`;
  const label = { none: "Just listening", create_task: "Task from your conversation", offer_schedule: "Offer: make space in your schedule", offer_update: "Offer: send your pre-approved update", show_evidence: "Showing what you said before", watch_tap: "Tapped your watch", ask_checkin: "Asking how you'd like support", hold_decision: "Suggest: hold a big decision", move_to_today: "Suggest: move a task to today", calendar_note: "Suggest: add a calendar note", music: "Suggest: music for your energy" }[d.action] || d.action;
  if (d.action === "none") return; // Background conversation is not an action to announce.
  feed.querySelector(".agent-empty")?.remove();
  feed.prepend(el("li", { className: d.action === "none" ? "" : d.auto ? "auto" : "act" },
    el("div", {}, el("b", { textContent: label }), el("div", { textContent: d.message || "" }),
      el("div", { className: "why-line", textContent: `${d.reason || ""}${d.reason ? " · " : ""}${engine}${statement.speaker_confirmed ? "" : " · speaker not yet confirmed"}` }))));
  while (feed.children.length > 12) feed.lastChild.remove();
  const task = (life.tasks || []).find((t) => t.id === d.task_id);
  const li = feed.firstChild;
  const btn = (label, fn) => { const b = el("button", { type: "button", className: "secondary", textContent: label }); b.addEventListener("click", () => { if (fn() === false) return; b.closest(".row")?.replaceChildren(el("span", { className: "done", textContent: "Done ✓" })); }); return b; };
  if (d.action === "create_task" && d.draft_task) {
    const existing = (life.taskDrafts || []).find(x => x.title.toLocaleLowerCase() === d.draft_task.title.toLocaleLowerCase());
    const draft = existing || { ...d.draft_task, id: newId("draft"), statement };
    if (!existing) { (life.taskDrafts ||= []).push(draft); life.taskDrafts = life.taskDrafts.slice(-30); }
    li.firstChild.append(draftControls(draft));
    renderTasks(); saveThread();
  }
  if (d.action === "hold_decision" && task) li.firstChild.append(el("div", { className: "row tight" }, btn(`Hold “${task.title}”`, () => holdTask(task, d.note || `Held — you said “${statement.text.slice(0, 60)}”`)), el("a", { className: "secondary ics", href: gcalLink(`Decide: ${task.title}`, `Held by Threadline on a low-energy day. ${d.reason || ""}`, todayKey(new Date(Date.now() + 3 * DAY_MS))), target: "_blank", rel: "noopener", textContent: "Calendar note" })));
  if (d.action === "move_to_today" && task) li.firstChild.append(el("div", { className: "row tight" }, btn(`Move “${task.title}” to today`, () => { task.due = todayKey(); task.heldUntil = null; renderTasks(); logAction(`Moved “${task.title}” to today`); })));
  if (d.action === "calendar_note") li.firstChild.append(el("div", { className: "row tight" }, el("a", { className: "secondary ics", href: gcalLink(task ? task.title : "Note from Threadline", d.note || statement.text, task?.due), target: "_blank", rel: "noopener", textContent: "Add to Google Calendar" })));
  if (d.action === "music" && d.music) { const m = d.music.mood || "calm"; li.firstChild.append(el("div", { className: "row tight" }, el("a", { className: "secondary ics", href: `https://music.apple.com/search?term=${encodeURIComponent(m + " music")}`, target: "_blank", rel: "noopener", textContent: `Apple Music · ${m}` }), el("a", { className: "secondary ics", href: `https://open.spotify.com/search/${encodeURIComponent(m + " music")}`, target: "_blank", rel: "noopener", textContent: `Spotify · ${m}` }))); }
  // Act: low-risk actions happen now; anything outward waits for one tap.
  if (d.action === "watch_tap") sendHaptic("notification", (d.message || "Threadline").slice(0, 80));
  const pref = sessions.reflection.prefs.find((p) => p.id === d.preference_id);
  if ((d.action === "offer_schedule" || d.action === "offer_update" || d.action === "show_evidence") && (pref || d.action === "show_evidence")) {
    if (agent.offer?.status === "offered" && agent.offer.pref?.id === pref?.id) return;  // don't repeat the same offer
    const evidence = (d.evidence || []).map((id) => sessions.reflection.notes.find((n) => n.id === id)).filter(Boolean);
    agent.offer = { note: { id: statement.id, text: statement.text, at: statement.at, source: statement.source }, pref: pref || { text: "Show me what I said before.", action: "remind", at: new Date().toISOString() }, hit: d.reason || "", evidence, status: "offered", decided: engine };
    renderSupport();
  }
}
function draftControls(draft) {
  const title = el("input", { type: "text", value: draft.title, maxLength: 200, "aria-label": "Task from your words" });
  const save = el("button", { type: "button", className: "secondary", textContent: "Save task" });
  const dismiss = el("button", { type: "button", className: "text-button", textContent: "Dismiss" });
  const box = el("div", { "data-draft": draft.id }, title, el("div", { className: "row tight" }, save, dismiss));
  title.addEventListener("input", () => { draft.title = title.value; saveThread(); });
  save.addEventListener("click", () => {
    if (!(life.taskDrafts || []).some(d => d.id === draft.id)) return;
    const value = title.value.trim(); if (!value) return title.focus();
    if (!(life.tasks || []).some(t => t.title.toLocaleLowerCase() === value.toLocaleLowerCase() && !t.done)) {
      (life.tasks ||= []).push({ id: newId("t"), title: value, due: draft.due, big: false, done: false, note: `From your confirmed words: ${draft.statement.text}` });
      logAction(`Saved task: ${value}`);
    }
    removeDraft(draft.id, "Task saved.");
  });
  dismiss.addEventListener("click", () => removeDraft(draft.id, "Suggestion dismissed."));
  return box;
}
function removeDraft(id, message) {
  life.taskDrafts = (life.taskDrafts || []).filter(d => d.id !== id);
  document.querySelectorAll("[data-draft]").forEach(box => { if (box.dataset.draft === id) box.replaceWith(el("p", { className: "caption", textContent: message })); });
  renderTasks(); saveThread();
}
function removeNoteSuggestions(id) {
  const removed = new Set((life.taskDrafts || []).filter(d => d.statement.id === id).map(d => d.id));
  life.taskDrafts = (life.taskDrafts || []).filter(d => d.statement.id !== id);
  document.querySelectorAll("[data-draft]").forEach(box => { if (removed.has(box.dataset.draft)) box.remove(); });
  renderTasks();
}


/* ---------- Energy (from your words, with voice / band / watch as context) ---------- */
const DEFAULT_POSITIVE_WORDS = "energised, energized, motivated, productive, great day, good energy, excited, clicked";
const ENERGY_COLORS = { low: "#8E8CD8", steady: "#5E9C7A", positive: "#E9A23B", unknown: "#B9B9B2" };
function rebuildWordRecords() {
  for (const record of Object.values(life.days)) { record.energy = []; record.mine = 0; }
  const notes = sessions.reflection.notes;
  for (const note of notes) {
    const record = dayRec(todayKey(new Date(note.at))); record.mine += 1;
    if (note.energySignal?.state === "low") record.energy.push({ word: note.energySignal.quote, id: note.id });
  }
  life.energyLog = notes.filter(n => n.energySignal).map(n => ({ id: n.id, at: n.at, state: n.energySignal.state, word: n.energySignal.quote })).sort((a, b) => a.at.localeCompare(b.at));
  const latest = life.energyLog.at(-1);
  life.energy = latest ? { ...latest, text: latest.word } : null;
}
function applyEnergySignal(signal, statement) {
  const note = sessions.reflection.notes.find(n => n.id === signal.source_id && n.text === signal.quote);
  if (!note || signal.source_id !== statement.id || !["low", "positive", "steady"].includes(signal.state)) return;
  note.energySignal = { state: signal.state, quote: signal.quote };
  rebuildWordRecords(); saveThread(); renderEnergy(); renderDays(); renderToday();
  if (signal.state === "low") gentleCheckin({ word: signal.quote, tense: false });
}
/* Check-ins: ask once; if opted in, a gentle watch tap next time (at most every 10 minutes). */
function gentleCheckin(c) {
  const ck = (life.checkins ||= { asked: false, optedIn: false, lastTap: 0 });
  if (!ck.asked) {
    ck.asked = true; saveThread();
    const text = `You described low energy: “${c.word}”. Would you like gentle check-ins when you say this again?`;
    try { if ("Notification" in window && Notification.permission === "granted") new Notification("Threadline", { body: text }); } catch { /* blocked */ }
    showCheckinPrompt(text);
    return;
  }
  if (ck.optedIn && Date.now() - ck.lastTap > 10 * 60000) {
    ck.lastTap = Date.now(); saveThread();
    sendHaptic("directionUp", "Gentle check-in"); logAction(`Gentle check-in tap on your watch (“${c.word}”, you opted in)`);
    feedNote("Gentle check-in", `A soft tap on your watch — you said “${c.word}”. You opted in to these.`, "auto");
  }
}
function showCheckinPrompt(text) {
  const yes = el("button", { type: "button", className: "primary-sm", textContent: "Yes, gentle check-ins" });
  const no = el("button", { type: "button", className: "text-button", textContent: "No thanks" });
  const box = el("div", { className: "checkin-prompt" }, el("p", { textContent: text }), el("p", { className: "caption", textContent: "A check-in is a soft tap on your Apple Watch — no message, nothing sent to anyone." }), el("div", { className: "row tight" }, yes, no));
  yes.addEventListener("click", async () => { life.checkins.optedIn = true; saveThread(); box.replaceChildren(el("p", { className: "done", textContent: "Check-ins on. You can turn them off in Energy." })); if ("Notification" in window && Notification.permission === "default") { try { await Notification.requestPermission(); } catch { /* ignore */ } } renderEnergy(); });
  no.addEventListener("click", () => { life.checkins.optedIn = false; saveThread(); box.replaceChildren(el("p", { className: "caption", textContent: "Okay — no check-ins. Threadline won't ask again." })); renderEnergy(); });
  $("agent-feed").querySelector(".agent-empty")?.remove();
  $("agent-feed").prepend(el("li", { className: "act" }, box));
}
function feedNote(title, text, kind = "") { $("agent-feed").querySelector(".agent-empty")?.remove(); $("agent-feed").prepend(el("li", { className: kind }, el("div", {}, el("b", { textContent: title }), el("div", { textContent: text })))); }

/* Voice measurements from the live transcript (timings only; the most-heard speaker stands in until you confirm who you are) */
function voiceMetrics(finals) {
  const words = finals.flatMap((f) => f.words).filter((w) => w.start != null && w.end != null);
  if (words.length < 6) return null;
  const by = {}; for (const w of words) (by[w.speaker ?? "x"] ||= []).push(w);
  const [mainKey, main] = Object.entries(by).sort((a, b) => b[1].length - a[1].length)[0];
  let speaking = 0, pauses = [];
  for (let i = 1; i < main.length; i++) { const gap = main[i].start - main[i - 1].end; if (gap > 0.25 && gap < 3) pauses.push(gap); else if (gap >= 0 && gap <= 0.25) speaking += main[i].end - main[i].start; }
  const span = main[main.length - 1].end - main[0].start - pauses.filter((g) => g >= 3).reduce((a, b) => a + b, 0);
  return { words_per_min: span > 5 ? Math.round(main.length / (span / 60)) : null, avg_pause_s: pauses.length ? Math.round((pauses.reduce((a, b) => a + b, 0) / pauses.length) * 10) / 10 : null,
    loudness: signals.level ? Math.round(signals.level * 100) / 100 : null, talk_share: Math.round((main.length / words.length) * 100) / 100, speaker: mainKey };
}
function renderEnergy() {
  if (!$("energy-now")) return;
  const e = life.energy, state = e?.state || "unknown";
  $("energy-now").dataset.energy = state;
  $("energy-label").textContent = { low: "Low", positive: "Positive", steady: "Steady", unknown: "Unknown" }[state];
  $("energy-since").textContent = e ? `since ${new Date(e.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "no signal yet";
  $("energy-why").textContent = e ? `Your self-report: “${e.text}”.` : "Updates from explicit self-reports in your saved words. Voice and movement are context, not an emotion detector.";
  $("positive-words").value = life.positiveWords || DEFAULT_POSITIVE_WORDS;
  const v = life.voice, w = sensorsWithHealth(), r = life.days[todayKey()] || {}, info = cycleInfo(), h = hLatest() || {};
  const rows = (pairs) => pairs.filter(([, val]) => val != null && val !== "").flatMap(([k, val]) => [el("dt", { textContent: k }), el("dd", { textContent: String(val) })]);
  const fill = (id, pairs, empty) => { const items = rows(pairs); $(id).replaceChildren(...(items.length ? items : [el("dt", { className: "empty", textContent: empty })])); };
  fill("sig-voice", [["Speaking pace", v?.words_per_min ? `${v.words_per_min} wpm` : null], ["Pauses", v?.avg_pause_s ? `${v.avg_pause_s} s avg` : null], ["Loudness", v?.loudness != null ? `${Math.round(v.loudness * 100)}%` : null], ["Most-heard speaker's share", v?.talk_share != null ? `${Math.round(v.talk_share * 100)}%` : null]], "Record a session to measure");
  fill("sig-body", [["Heart rate", w.heart_rate != null ? `${Math.round(w.heart_rate)} bpm` : null], ["HRV (SDNN)", w.hrv_sdnn_ms != null ? `${Math.round(w.hrv_sdnn_ms)} ms` : null], ["Resting HR", w.resting_hr != null ? `${Math.round(w.resting_hr)} bpm` : null], ["Breathing", w.respiratory_rate != null ? `${Math.round(w.respiratory_rate)} /min` : null], ["Blood oxygen", w.spo2 != null ? `${Math.round(w.spo2)}%` : null], ["Sleep last night", w.sleep_hours_last_night != null ? `${Math.floor(w.sleep_hours_last_night)} h ${Math.round((w.sleep_hours_last_night % 1) * 60)}` : null], ["Noise", w.env_noise_db != null ? `${Math.round(w.env_noise_db)} dB` : null], ["Logged mood", w.state_of_mind ? `${w.state_of_mind.valence > 0.2 ? "pleasant" : w.state_of_mind.valence < -0.2 ? "unpleasant" : "neutral"}${w.state_of_mind.labels?.length ? ` · ${w.state_of_mind.labels.join(", ")}` : ""}` : null]], "Pair the Apple Watch in Devices");
  fill("sig-move", [["Steps today", r.watchSteps ?? (r.bandSteps || null) ?? (h.steps != null ? Math.round(h.steps).toLocaleString() : null)], ["Right now", w.activity || signals.activity || null], ["Exercise", w.exercise_min_today != null ? `${Math.round(w.exercise_min_today)} min` : null], ["Mindful", w.mindful_min_today != null ? `${Math.round(w.mindful_min_today)} min` : null], ["Distance", h.distance_km != null ? `${h.distance_km.toFixed(1)} km` : null], ["Active energy", h.active_energy_kcal != null ? `${Math.round(h.active_energy_kcal)} kcal` : null], ["Walking speed", h.walking_speed_kmh != null ? `${h.walking_speed_kmh.toFixed(1)} km/h` : null], ["Walking steadiness", h.walking_steadiness != null ? `${Math.round(h.walking_steadiness)}%` : null]], "Connect the band or watch");
  fill("sig-cycle", [["Cycle day", info.dayOf ? info.dayOf(todayKey()) : null], ["Next, estimated", info.next ? info.next.toLocaleDateString([], { month: "short", day: "numeric" }) : null], ["Wrist temp", w.wrist_temp_delta_c != null ? `${w.wrist_temp_delta_c > 0 ? "+" : ""}${w.wrist_temp_delta_c.toFixed(1)} °C` : null]], "Add dates in Your days");
  const mood = state === "low" ? "calm" : state === "positive" ? "uplifting" : "steady";
  $("music-links").replaceChildren(...["calm", "steady", "uplifting"].map((m) => el("div", { className: `music-chip m-${m}${m === mood ? " current" : ""}` }, el("b", { textContent: m }),
    el("a", { href: `https://music.apple.com/search?term=${encodeURIComponent(m + " music")}`, target: "_blank", rel: "noopener", textContent: "Apple Music" }),
    el("a", { href: `https://open.spotify.com/search/${encodeURIComponent(m + " music")}`, target: "_blank", rel: "noopener", textContent: "Spotify" }))));
  renderMood();
  const ck = life.checkins || {};
  $("mood-msg").textContent = ck.asked ? (ck.optedIn ? "Gentle check-ins: on (soft watch tap)." : "Gentle check-ins: off.") : "";
}
$("positive-words").addEventListener("change", () => { life.positiveWords = $("positive-words").value; saveThread(); });
$("mood-to-health").addEventListener("click", () => {
  const e = life.energy;
  if (!e) return ($("mood-msg").textContent = "Save a statement first so there's a mood to log.");
  if (!(watch.ws?.readyState === 1)) return ($("mood-msg").textContent = "Pair the Apple Watch (Devices) — it asks you to confirm before saving to Health.");
  watch.ws.send(JSON.stringify({ type: "log_mood", valence: e.state === "low" ? -0.5 : e.state === "positive" ? 0.6 : 0, labels: e.state === "low" ? [e.tense ? "irritated" : "drained"] : e.state === "positive" ? ["happy"] : [], reason: `You said “${e.word}”`.slice(0, 80) }));
  $("mood-msg").textContent = "Sent to your watch — confirm there to save it in Apple Health.";
});

/* ---------- Tasks ---------- */
const gcalLink = (title, details, date) => { const d = (date || todayKey()).replaceAll("-", ""), next = todayKey(new Date(parseDay(date || todayKey()).getTime() + DAY_MS)).replaceAll("-", "");
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&details=${encodeURIComponent(details)}&dates=${d}/${next}`; };
function renderTasks() {
  if (!$("tasks-today")) return;
  const tasks = life.tasks || [], today = todayKey();
  const drafts = life.taskDrafts || [];
  $("task-banner").replaceChildren(...(drafts.length ? drafts.map(d => el("div", { className: "task-draft" }, el("p", { className: "caption", textContent: `From: “${d.statement.text}”${d.statement.speaker_confirmed ? "" : " · confirm this was you before saving"}` }), draftControls(d))) : [el("p", { className: "caption", textContent: "No pending suggestions. Ask for a reminder while speaking and it will appear here." })]));
  const lists = { today: [], later: [], held: [] };
  for (const t of tasks.filter((x) => !x.done)) (t.heldUntil && t.heldUntil > today ? lists.held : t.due && t.due <= today ? lists.today : lists.later).push(t);
  const item = (t) => {
    const btns = [];
    const mk = (label, fn, cls = "text-button") => { const b = el("button", { type: "button", className: cls, textContent: label }); b.addEventListener("click", fn); btns.push(b); };
    if (!(t.due && t.due <= today)) mk("Move to today", () => { t.due = today; t.heldUntil = null; renderTasks(); logAction(`Moved “${t.title}” to today`); });
    if (t.big && !(t.heldUntil > today)) mk("Hold 3 days", () => holdTask(t));
    mk("Done", () => { t.done = true; renderTasks(); });
    btns.push(el("a", { className: "text-button", href: gcalLink(t.title, t.note || "From Threadline", t.heldUntil || t.due), target: "_blank", rel: "noopener", textContent: "Add to Google Calendar" }));
    return el("li", { className: t.big ? "big" : "" }, el("div", {}, el("b", { textContent: t.title }), el("div", { className: "caption", textContent: [t.big ? "big decision" : "", t.heldUntil > today ? `held until ${parseDay(t.heldUntil).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}` : t.due ? `due ${parseDay(t.due).toLocaleDateString([], { month: "short", day: "numeric" })}` : "", t.note || ""].filter(Boolean).join(" · ") })), el("div", { className: "row tight" }, ...btns));
  };
  for (const k of ["today", "later", "held"]) $(`tasks-${k}`).replaceChildren(...(lists[k].length ? lists[k].map(item) : [el("li", { className: "empty", textContent: k === "held" ? "Nothing held." : "Nothing here." })]));
  saveThread();
}
function holdTask(t, note) { t.heldUntil = todayKey(new Date(Date.now() + 3 * DAY_MS)); t.note = note || `Held on a ${life.energy?.state === "low" ? "low-energy " : ""}day`; renderTasks(); logAction(`Held “${t.title}” until ${parseDay(t.heldUntil).toLocaleDateString([], { weekday: "short" })}`); }
$("task-form").addEventListener("submit", (e) => {
  e.preventDefault(); const title = $("task-title").value.trim(); if (!title) return;
  (life.tasks ||= []).push({ id: newId("t"), title, due: $("task-due").value || null, big: $("task-big").checked, done: false });
  $("task-title").value = ""; $("task-due").value = ""; $("task-big").checked = false; renderTasks();
});

/* ---------- Integrations (status from what is actually connected) ---------- */
function renderIntegrations() {
  if (!$("int-grid")) return;
  const card = (name, on, what, how) => el("article", { className: `int-card${on ? " on" : ""}` }, el("header", {}, el("b", { textContent: name }), el("span", { className: "int-state", textContent: on ? "● connected" : "not connected" })), el("p", { textContent: what }), el("p", { className: "caption", textContent: how }));
  $("int-grid").replaceChildren(
    card("Vexo band", Boolean(capture.band), "Microphone (voice pace, pauses, loudness), movement, steps, taps to mark moments, battery.", "Bluetooth or USB · official Vexo Open kit · Devices"),
    card("Apple Health history", Boolean(ownerHealth.days && healthOn()), ownerHealth.days ? `${ownerHealth.days} days imported from the iPhone (steps, heart rate, HRV, sleep, blood oxygen, walking steadiness, workouts…).` : "Daily history from the iPhone's Health app.", ownerHealth.importedAt ? `Threadline Health app · last sent ${new Date(ownerHealth.importedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "Threadline Health iPhone app · or upload an export on Care"),
    card("Apple Watch · Health", $("watch-pair").dataset.state === "connected", "Heart rate, HRV, resting HR, breathing, blood oxygen, sleep, wrist temperature, noise, exercise, mindful minutes, State of Mind, period days you logged. Taps for check-ins.", "Threadline watch app · pairing code · Devices"),
    card("Camera · GoPro", Boolean(capture.camStream), "Video via the GoPro Webcam app; stays in this browser.", "Live session → Add video"),
    card("Calendar", (life.tasks || []).length > 0 || agent.events.length > 0, "Quiet-time blocks and notes around tasks and decisions.", "Add to Google Calendar links or .ics files — each needs your tap"),
    card("Cycle · Apple Health", life.cycle.starts.some((x) => x.source === "health"), "Reads the period days you logged; saves a mood to State of Mind only after you confirm on the watch.", "Watch → Share cycle dates"),
    card("Music", true, "Calm, steady or uplifting search to match your energy.", "Opens Apple Music or Spotify — nothing is played or tracked"),
    card("Messages", sessions.reflection.prefs.some((p) => p.action === "update"), "Your pre-approved update to close friends.", "Your share sheet or Messages — Threadline never sends"),
    card("Deepgram", service.transcription, "Speech to text while you record.", "Configured by the app"),
    card("Gemini Decisions API", service.reflection, "Chooses one action per new line, with a confidence.", "Configured by the app"));
}


/* MiniMax music generation: only the mood word leaves this page. */
$("music-gen").addEventListener("click", async () => {
  const state = life.energy?.state || "steady", mood = state === "low" ? "calm" : state === "positive" ? "uplifting" : "steady";
  $("music-gen-msg").textContent = `Generating a ${mood} track with MiniMax… this can take a minute.`;
  $("music-gen").disabled = true;
  try {
    await ensureService();
    liveHeaders();
    const data = await request("/api/music/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mood }) });
    const bytes = Uint8Array.from(atob(data.audio_b64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: data.mime || "audio/mpeg" }));
    $("music-player").src = url; $("music-player").hidden = false; $("music-player").play().catch(() => {});
    $("music-gen-msg").textContent = `A ${mood} track from MiniMax (${data.model}). It stays in this page.`; logAction(`Generated a ${mood} track with MiniMax`);
  } catch (e) { $("music-gen-msg").textContent = /Not Found/.test(e.message) ? "MiniMax music isn't set up on this server yet." : e.message; }
  finally { $("music-gen").disabled = false; }
});


/* ---------- Your day: energy timeline, moments, measured, and what Threadline did ---------- */
function logAction(text) { (life.actions ||= []).push({ at: new Date().toISOString(), text }); life.actions = life.actions.slice(-200); saveThread(); renderToday(); }
function renderToday() {
  if (!$("day-arc")) return;
  const key = todayKey(), start = parseDay(key); start.setHours(6, 0, 0, 0);
  const end = new Date(start.getTime() + 18 * 3600000), now = new Date();
  const events = (life.energyLog || []).filter((e) => todayKey(new Date(e.at)) === key).sort((a, b) => a.at.localeCompare(b.at));
  const segs = []; let cursor = start, state = "none";
  for (const e of events) { const t = new Date(e.at); if (t > cursor) segs.push({ from: cursor, to: t, state }); cursor = t < start ? start : t; state = e.state; }
  const stop = now < end ? now : end; if (stop > cursor) segs.push({ from: cursor, to: stop, state }); if (end > stop) segs.push({ from: stop, to: end, state: "future" });
  $("day-arc").replaceChildren(...segs.filter((s) => s.to > s.from).map((s) => el("span", { className: `arc-${s.state}`, title: `${s.state} ${s.from.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}–${s.to.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` }))); 
  [...$("day-arc").children].forEach((c, i) => { const s = segs.filter((x) => x.to > x.from)[i]; c.style.flexGrow = String(Math.max(1, Math.round((s.to - s.from) / 60000))); });
  $("arc-caption").textContent = events.length ? `${events.length} self-report${events.length > 1 ? "s" : ""} from your words` : "Updates when you describe your energy";
  const marked = loadArchive().filter((e) => todayKey(new Date(e.startedAt)) === key).flatMap((e) => e.lines.filter((l) => l.marked));
  $("day-moments").replaceChildren(...[...events.map((e) => el("span", { className: `moment m-${e.state}`, textContent: `${new Date(e.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} “${e.word}”` })),
    ...marked.slice(-6).map((l) => el("span", { className: "moment m-mark", textContent: `★ ${new Date(l.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} “${l.text.slice(0, 40)}${l.text.length > 40 ? "…" : ""}”` }))]);
  const r = life.days[key] || {}, w = sensorsWithHealth(), info = cycleInfo(), h = hDay(key) || hLatest() || {};
  const m = [["Low-energy words", r.energy?.length || null], ["Lines from others", r.others || null], ["Steps", r.watchSteps ?? (r.bandSteps || null) ?? (h.steps != null ? Math.round(h.steps).toLocaleString() : null)], ["Heart rate", r.hrN ? `${Math.round(r.hrSum / r.hrN)} avg` : h.heart_rate != null ? `${Math.round(h.heart_rate)} avg` : null], ["Resting HR", w.resting_hr != null ? `${Math.round(w.resting_hr)} bpm` : null], ["Blood oxygen", w.spo2 != null ? `${Math.round(w.spo2)}%` : null], ["Exercise", h.exercise_min != null ? `${Math.round(h.exercise_min)} min` : null], ["Stand hours", h.stand_hours != null ? Math.round(h.stand_hours) : null], ["HRV", w.hrv_sdnn_ms != null ? `${Math.round(w.hrv_sdnn_ms)} ms` : null], ["Sleep", w.sleep_hours_last_night != null ? `${Math.floor(w.sleep_hours_last_night)} h ${Math.round((w.sleep_hours_last_night % 1) * 60)}` : null], ["Cycle day", info.dayOf ? info.dayOf(key) : null]].filter(([, v]) => v != null);
  $("measured").replaceChildren(...(m.length ? m.flatMap(([k, v]) => [el("dt", { textContent: k }), el("dd", { textContent: String(v) })]) : [el("dt", { className: "empty", textContent: "Nothing measured yet today." })]));
  const did = (life.actions || []).filter((a) => todayKey(new Date(a.at)) === key).reverse();
  $("did-list").replaceChildren(...(did.length ? did.map((a) => el("li", {}, el("span", { className: "did-time", textContent: new Date(a.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) }), el("span", { textContent: a.text }))) : [el("li", { className: "empty", textContent: "Nothing yet. Threadline acts only with your OK (or your opt-in for check-ins)." })]));
}
$("today-summary").addEventListener("click", () => summarizeToday());


/* Pair from the watch: the watch shows a code; you enter it here (the session cookie authorizes the claim). */
$("watch-claim-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (watch.ws) return watchMsg("Already paired. Unpair first to pair another watch.");
  const code = $("watch-claim-code").value.replace(/\D/g, "");
  if (code.length !== 6) return watchMsg("Type the 6 digits shown on your watch.", true);
  try {
    const data = await request("/api/watch/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
    watch.code = code; watch.device = data.device || "Apple Watch";
    rememberWatch({ code, device: watch.device, at: new Date().toISOString() }); stopDemoFeed();
    $("watch-claim-form").hidden = true; $("watch-pair-btn").hidden = true; $("watch-unpair").hidden = false;
    watchState("busy", `${watch.device} · paired, waiting for readings`); watchMsg("Paired. Your watch shows Paired ✓ and starts sending readings.");
    if (typeof logAction === "function") logAction(`Paired ${watch.device}`);
    openWatchFeed("");
  } catch (err) { watchMsg(/Not Found/.test(err.message) ? "This server doesn't support pairing from the watch yet — redeploy it." : err.message, true); }
});
$("watch-claim-code").addEventListener("input", () => { const d = $("watch-claim-code").value.replace(/\D/g, "").slice(0, 6); $("watch-claim-code").value = d.length > 3 ? `${d.slice(0, 3)} ${d.slice(3)}` : d; });


/* ---------- Profiles: the default profile (this server's band + its paired watch) or your own devices ---------- */
const WATCH_KEY = () => `threadline.watch.v1.${bandNumber ? `band-${bandNumber}` : "browser"}`;
function savedWatch() { try { return JSON.parse(localStorage.getItem(WATCH_KEY()) || "null"); } catch { return null; } }
function rememberWatch(v) { try { v ? localStorage.setItem(WATCH_KEY(), JSON.stringify(v)) : localStorage.removeItem(WATCH_KEY()); } catch { /* storage off */ } renderProfile(); }
function isDefaultProfile() { return Boolean(configuredBand) && bandNumber === configuredBand; }
function renderProfile() {
  if (!$("profile-bar")) return;
  const w = savedWatch();
  $("profile-name").textContent = isDefaultProfile() ? "Default profile" : "Your devices";
  $("profile-devices").textContent = `· ${bandNumber ? bandLabel() : "no band"}${w ? ` + ${w.device}` : ""}`;
  $("profile-switch").textContent = isDefaultProfile() ? "Use my own devices" : (configuredBand ? "Back to default profile" : "Change devices");
}
$("profile-switch").addEventListener("click", () => {
  if (capture.active) return message("Stop the session first.", true);
  if (isDefaultProfile() || !configuredBand) {
    // Your own devices: choose your band number and pair your own watch; data stays separate per band.
    location.hash = "live";
    $("pick-form").hidden = false; $("pick-number").value = ""; $("pick-number").focus();
    message("Type your band's number, then pair your own watch in /#watch. Each band keeps its own data.");
  } else { chooseBand(configuredBand); }
  renderProfile();
});
/* Reconnect a remembered watch for this profile without a new code. */
function resumeWatch() {
  const w = savedWatch();
  if (!w || watch.ws) return;
  watch.code = w.code; watch.device = w.device || "Apple Watch";
  $("watch-claim-form").hidden = true; $("watch-unpair").hidden = false;
  watchState("busy", `${watch.device} · reconnecting`);
  openWatchFeed("");
}


/* One place that applies a watch reading to the page (your own paired watch, or the public demo). */
function applyWatchSensors(msg) {
  watch.sensors = msg; watch.sensorsAt = Date.now(); $("watch-sensors").hidden = false;
  const rec = dayRec();
  if (msg.heart_rate != null) { const h = Math.round(msg.heart_rate); rec.hrSum += h; rec.hrN += 1; rec.hrMin = rec.hrMin == null ? h : Math.min(rec.hrMin, h); rec.hrMax = rec.hrMax == null ? h : Math.max(rec.hrMax, h); }
  if (msg.steps != null) rec.watchSteps = Math.max(rec.watchSteps ?? 0, msg.steps);
  if (!watch.lastDaysRender || Date.now() - watch.lastDaysRender > 5000) { watch.lastDaysRender = Date.now(); renderDays(); renderEnergy(); }
  if (msg.heart_rate != null) $("ws-hr").textContent = `${Math.round(msg.heart_rate)} bpm`;
  if (msg.steps != null) $("ws-steps").textContent = String(msg.steps);
  if (msg.activity) $("ws-activity").textContent = msg.activity;
}

/* ---------- Public demo: the default profile shows the demo owner's live watch readings ---------- */
const demo = { ws: null, live: false, device: null, retry: 0 };
function demoWanted() { return isDefaultProfile() && !savedWatch() && !watch.ws; }
function startDemoFeed() {
  if (demo.ws) return;
  let ws;
  try { ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/demo/feed`); } catch { return; }
  demo.ws = ws;
  ws.onmessage = (event) => {
    let msg; try { msg = JSON.parse(event.data); } catch { return; }
    if (msg.type === "demo_status") {
      demo.live = Boolean(msg.live); demo.device = msg.device || demo.device;
      if (msg.last) applyWatchSensors(msg.last);
      if (demoWanted()) watchState(demo.live ? "connected" : "idle", demo.live ? `Demo owner's ${demo.device || "Apple Watch"} · live` : "Demo owner's watch · offline");
      if (demoWanted()) watchMsg(demo.live ? "You're seeing the demo owner's live readings, shared on purpose. Pair your own watch to see yours." : "The demo owner's watch isn't streaming right now.");
    } else if (msg.type === "demo_line") { addDemoLine(msg);
    } else if (msg.type === "demo_recording") { setDemoRecording(Boolean(msg.live));
    } else if (msg.type === "sensors" && demoWanted()) {
      applyWatchSensors(msg);
      if (!demo.live) { demo.live = true; watchState("connected", `Demo owner's ${msg.device || "Apple Watch"} · live`); }
    }
  };
  ws.onclose = () => { if (demo.ws === ws) { demo.ws = null; if (demoWanted() && demo.retry++ < 20) setTimeout(startDemoFeed, 3000); } };
}
function stopDemoFeed() { const ws = demo.ws; demo.ws = null; try { ws?.close(); } catch { /* closed */ } }


/* ---------- Continuous recording: everyone present has consented, so record whenever the band is on ---------- */
const autoRec = { userStopped: false, restarts: [] };
const CONSENT_KEY = "threadline.consent.v1";
try { if (localStorage.getItem(CONSENT_KEY) === "yes") $("rec-consent").checked = true; } catch { /* storage off */ }
$("rec-consent").addEventListener("change", () => {
  try { $("rec-consent").checked ? localStorage.setItem(CONSENT_KEY, "yes") : localStorage.removeItem(CONSENT_KEY); } catch { /* storage off */ }
  if ($("rec-consent").checked) { autoRec.userStopped = false; maybeAutoStart(); }
  else { autoRec.userStopped = true; stopLive("Recording permission removed. Stopping the band's microphone."); }
});
function canAutoRecord() { return $("rec-consent").checked && !autoRec.userStopped && !capture.active && !busy && capture.band && !capture.band.reconnecting && $("source").value === "vexo"; }
function maybeAutoStart() {
  if (!canAutoRecord()) return;
  recState("Band connected and consent given — recording continuously. Press Stop or double-tap the band to pause.");
  $("rec-start").click();
}
function maybeAutoRestart() {
  if (!canAutoRecord()) return;
  const now = Date.now(); autoRec.restarts = autoRec.restarts.filter((t) => now - t < 10 * 60000);
  if (autoRec.restarts.length >= 5) return recState("Recording stopped several times in a row. Check the band and press Start to try again.", true);
  autoRec.restarts.push(now);
  recState("Recording resumed automatically.");
  $("rec-start").click();
}
$("rec-start").addEventListener("click", () => { autoRec.userStopped = false; }, true);


/* ---------- Gemini Live memory help: camera frames + band/mic audio in, spoken answers out ---------- */
const lh = { ws: null, stream: null, frameTimer: 0, mic: null, micNode: null, out: null, playAt: 0, sources: [], offBand: null, bandAudio: null };
async function lhListCameras() {
  try {
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
    const cur = $("lh-camera").value;
    $("lh-camera").replaceChildren(el("option", { value: "bridge", textContent: "GoPro (via bridge)" }), el("option", { value: "", textContent: "This computer's camera" }), ...cams.map((c, i) => el("option", { value: c.deviceId, textContent: c.label || `Camera ${i + 1}`, selected: c.deviceId === cur })));
    const gopro = cams.find((c) => /gopro/i.test(c.label));
    if (!cur) $("lh-camera").value = gopro ? gopro.deviceId : (lh.bridgeLive ? "bridge" : "");
  } catch { /* no list */ }
}
function lhLog(kind, text) {
  if (!text) return;
  const last = $("lh-log").lastElementChild;
  if (last && last.dataset.kind === kind && !last.dataset.done) { last.querySelector("p").textContent += text; }
  else $("lh-log").append(el("li", { className: `lh-${kind}`, "data-kind": kind }, el("b", { textContent: kind === "said" ? "Threadline" : "Heard" }), el("p", { textContent: text })));
  { const box = $("lh-log"); box.scrollTop = box.scrollHeight; }
  while ($("lh-log").children.length > 40) $("lh-log").firstChild.remove();
}
function lhSetState(state, text) { $("live-help").dataset.state = state; $("lh-status").textContent = text; $("lh-start").hidden = state !== "idle"; $("lh-stop").hidden = state === "idle"; $("lh-ask").hidden = state !== "live"; }
/* Shared Gemini Live audio helpers (used by memory help and the Care view). st = { out: AudioContext(24 kHz), playAt, sources, muted } */
function livePlayPcm24(st, buf) {  // PCM16 24 kHz from Gemini → speakers, queued in order
  if (!st.out || st.muted) return;
  const pcm = new Int16Array(buf), f = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) f[i] = pcm[i] / 32768;
  const ab = st.out.createBuffer(1, f.length, 24000); ab.copyToChannel(f, 0);
  const src = st.out.createBufferSource(); src.buffer = ab; src.connect(st.out.destination);
  st.playAt = Math.max(st.playAt, st.out.currentTime + 0.05); src.start(st.playAt); st.playAt += ab.duration;
  st.sources.push(src); src.onended = () => { st.sources = st.sources.filter((x) => x !== src); };
}
function liveInterrupt(st) { st.sources.forEach((s) => { try { s.stop(); } catch { /* done */ } }); st.sources = []; st.playAt = 0; }
function floatToPcm16(f, fromRate = 16000) {  // float samples at fromRate → PCM16 at 16 kHz (linear resample)
  const ratio = fromRate / 16000, n = Math.floor(f.length / ratio), out = new Int16Array(n);
  for (let i = 0; i < n; i++) { const x = i * ratio, j = Math.floor(x), t = x - j, v = f[j] * (1 - t) + (f[j + 1] ?? f[j]) * t; out[i] = Math.max(-1, Math.min(1, v)) * 0x7fff; }
  return out;
}
async function liveBandAudio(onPcm) {  // the band's microphone → PCM16 16 kHz; returns a cleanup function
  kit = kit || await import("/static/vendor/vexo-open/js/src/index.js");
  const band = capture.band;
  if (!band) throw new Error("Connect your Vexo band first.");
  let ba = new kit.BandAudio((samples) => onPcm(kit.toInt16(samples)), { rate: 16000 });
  const off = band.on("audio", (a) => ba?.push(a));
  const offRestart = band.on("reconnected", () => ba?.restart());
  try { if (!capture.active) await claimBandAudio(band); } catch (e) { off?.(); offRestart?.(); try { ba.close(); } catch { /* */ } throw e; }
  return () => { off?.(); offRestart?.(); try { ba?.close(); } catch { /* */ } ba = null; if (capture.band === band && !capture.active) band.configure({ audio: false }).catch(() => {}); };
}
function lhPlay(buf) { livePlayPcm24(lh, buf); }
function lhInterrupt() { liveInterrupt(lh); }
function lhSendPcm16(int16) { if (lh.ws?.readyState === 1) lh.ws.send(int16.buffer); }
async function lhStartAudio() {
  if (capture.band) {  // the band's own microphone, decoded to 16 kHz samples by the Vexo kit
    try { lh.offBand = await liveBandAudio(lhSendPcm16); return "the Vexo band's microphone"; } catch { lh.offBand = null; }
  }
  lh.mic = new AudioContext({ sampleRate: 16000 });
  const media = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  lh.micStream = media;
  const srcNode = lh.mic.createMediaStreamSource(media);
  lh.micNode = lh.mic.createScriptProcessor(2048, 1, 1);
  lh.micNode.onaudioprocess = (ev) => { const f = ev.inputBuffer.getChannelData(0), out = new Int16Array(f.length); for (let i = 0; i < f.length; i++) out[i] = Math.max(-1, Math.min(1, f[i])) * 0x7fff; lhSendPcm16(out); };
  srcNode.connect(lh.micNode); lh.micNode.connect(lh.mic.destination);
  return "this computer's microphone";
}
function lhStartFrames() {
  const v = $("lh-video"), c = $("lh-canvas"), ctx = c.getContext("2d");
  lh.frameTimer = setInterval(() => {
    if (lh.ws?.readyState !== 1 || !v.videoWidth) return;
    c.width = 640; c.height = Math.round(640 * v.videoHeight / v.videoWidth);
    ctx.drawImage(v, 0, 0, c.width, c.height);
    const data = c.toDataURL("image/jpeg", 0.6).split(",")[1];
    if (data.length < 290000) lh.ws.send(JSON.stringify({ type: "frame", jpeg: data }));
  }, 1000);  // about one frame a second
}
$("lh-start").addEventListener("click", async () => {
  if (lh.ws) return;
  lhSetState("busy", "Starting the camera…");
  try {
    if (typeof ensureService === "function") { try { await ensureService(); } catch { /* local */ } }
    const id = $("lh-camera").value; lh.bridge = id === "bridge";
    if (lh.bridge) {  // the GoPro bridge sends frames to the server; show them here and let the server feed Gemini
      $("lh-bridge").hidden = false;
      lh.bridgeTimer = setInterval(() => { $("lh-bridge").src = `/api/vision/latest.jpg?t=${Date.now()}`; }, 1000);
    } else {
      lh.stream = await navigator.mediaDevices.getUserMedia({ video: id ? { deviceId: { exact: id }, width: { ideal: 1280 } } : { width: { ideal: 1280 } } });
      await lhListCameras();
      $("lh-video").srcObject = lh.stream; $("lh-video").hidden = false; await $("lh-video").play().catch(() => {});
    }
    lh.out = new AudioContext({ sampleRate: 24000 }); lh.playAt = 0;
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/live-gemini`);
    ws.binaryType = "arraybuffer"; lh.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ token: "", mode: "memory", ...(lh.bridge ? { vision: "bridge" } : {}) }));
    ws.onmessage = async (event) => {
      if (event.data instanceof ArrayBuffer) return lhPlay(event.data);
      let msg; try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === "ready") {
        const notes = (sessions.reflection?.notes || []).slice(-20).map((n) => `${new Date(n.at).toLocaleString()}: ${n.text}`);
        if (notes.length) ws.send(JSON.stringify({ type: "context", notes }));
        const where = await lhStartAudio().catch((e) => { lhLog("said", `(No microphone: ${e.message})`); return "no microphone"; });
        if (!lh.bridge) lhStartFrames();
        lhSetState("live", `Live with ${msg.model || "Gemini"} · camera ${lh.bridge ? "GoPro (bridge)" : (lh.stream?.getVideoTracks()[0]?.label || "on")} · listening through ${where}. Ask “What was I doing?”`);
        if (typeof logAction === "function") logAction("Started Gemini Live memory help");
      } else if (msg.type === "heard") lhLog("heard", msg.text);
      else if (msg.type === "said") lhLog("said", msg.text);
      else if (msg.type === "turn_complete") { const l = $("lh-log").lastElementChild; if (l) l.dataset.done = "1"; }
      else if (msg.type === "interrupted") lhInterrupt();
      else if (msg.type === "error") { lhSetState("live", msg.message); }
      else if (msg.type === "vision") { $("lh-status").textContent = msg.live ? `Seeing through ${msg.camera || "the GoPro"}.` : "Waiting for GoPro frames from the bridge…"; }
    };
    ws.onclose = () => { if (lh.ws === ws) lhStop(lh.ws ? "Live help ended." : undefined); };
  } catch (e) { lhStop(`Couldn't start: ${e.message}`); }
});
function lhStop(text = "Stopped.") {
  const ws = lh.ws; lh.ws = null;
  try { ws?.readyState === 1 && ws.send(JSON.stringify({ type: "stop" })); ws?.close(); } catch { /* closed */ }
  clearInterval(lh.frameTimer); lhInterrupt();
  lh.offBand?.(); lh.offBand = null;
  try { lh.micNode?.disconnect(); lh.mic?.close(); } catch { /* */ } lh.micNode = null; lh.mic = null; lh.micStream?.getTracks().forEach((t) => t.stop());
  lh.stream?.getTracks().forEach((t) => t.stop()); lh.stream = null; $("lh-video").srcObject = null; $("lh-video").hidden = true;
  clearInterval(lh.bridgeTimer); $("lh-bridge").hidden = true; $("lh-bridge").removeAttribute("src");
  try { lh.out?.close(); } catch { /* */ } lh.out = null;
  lhSetState("idle", text);
}
$("lh-stop").addEventListener("click", () => lhStop());
$("lh-ask").addEventListener("submit", (e) => { e.preventDefault(); const t = $("lh-text").value.trim(); if (!t || lh.ws?.readyState !== 1) return; lh.ws.send(JSON.stringify({ type: "text", text: t })); lhLog("heard", t); $("lh-log").lastElementChild.dataset.done = "1"; $("lh-text").value = ""; });
lhListCameras();
navigator.mediaDevices?.addEventListener?.("devicechange", lhListCameras);
setInterval(async () => { try { const s = await (await fetch("/api/vision/status")).json(); lh.bridgeLive = Boolean(s.live); } catch { lh.bridgeLive = false; } }, 5000);


/* ---------- Public live transcript: the owner's band recording, streamed to everyone and kept in the database ---------- */
const PUBLISH_KEY = "threadline.publish.v1";
function publishKey() { try { return localStorage.getItem(PUBLISH_KEY) || ""; } catch { return ""; } }
function renderPublish() { $("publish-state").textContent = publishKey() ? "This browser publishes to the live demo." : "Not publishing."; }
$("publish-save").addEventListener("click", () => {
  const k = $("publish-key").value.trim();
  try { k ? localStorage.setItem(PUBLISH_KEY, k) : localStorage.removeItem(PUBLISH_KEY); } catch { /* storage off */ }
  $("publish-key").value = ""; renderPublish();
});
function showConnect(open) { $("connect-panel").hidden = !open; $("connect-toggle").textContent = open ? "Hide device connection" : "Connect a device"; }
$("connect-toggle").addEventListener("click", () => showConnect($("connect-panel").hidden));
const pub = { lines: 0 };
function addDemoLine(d) {
  if (capture.active) return;  // your own recording is already on screen
  const interim = $("live-interim");
  if (!d.final) { interim.textContent = d.text || ""; return; }
  interim.textContent = "";
  const who = d.speaker;
  $("live-lines").append(el("li", { className: `line spk-${who ?? "x"}` },
    el("span", { className: "avatar", "aria-hidden": "true", textContent: who ?? "?" }),
    el("div", {}, el("div", { className: "line-meta" }, el("b", { textContent: who == null ? "Speaker ?" : `Speaker ${who}` }), el("span", { textContent: ` · ${new Date(d.at || Date.now()).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })} · Vexo band (live demo)` })),
      el("p", { textContent: d.text }))));
  while ($("live-lines").children.length > 200) $("live-lines").firstChild.remove();
  { const box = $("live-lines"); box.scrollTop = box.scrollHeight; }
}
async function loadDemoTranscript() {
  try {
    const d = await (await fetch("/api/demo/transcript?limit=60")).json();
    if (!d || !Array.isArray(d.lines) || capture.active) return;
    $("live-lines").replaceChildren();
    if (d.lines.length) $("live-interim").textContent = "";
    d.lines.forEach((l) => addDemoLine({ ...l, final: true }));
    setDemoRecording(Boolean(d.recording));
  } catch { /* older server */ }
}
function setDemoRecording(live) { $("demo-rec-badge").hidden = !live; if (live && !capture.active) $("live-source").textContent = "Vexo band · live demo"; }


/* ---------- Care view: video source, Gemini Live guidance, caregiver agent, routine, health ---------- */
const care = { src: "file", files: [], idx: 0, camStream: null, bridgeTimer: 0, bridgeStatusTimer: 0, bridgeLive: false,
  ws: null, out: null, playAt: 0, sources: [], muted: false, frameTimer: 0, audioStop: null, vctx: null, vsrc: null, noSoundWarned: false,
  lines: [], visible: false, agentTimer: 0, agentBusy: false, history: [], lastStatus: null, lastTapAt: 0,
  health: null, healthAt: 0, taps: [], falls: [], bandSeen: new WeakSet(), routineKey: "" };
const CARE_SRC_LABEL = { file: "Recorded video, played as a live stream", bridge: "GoPro (via bridge)", camera: "This computer's camera" };
function careSrcStatus(text) { $("care-src-status").textContent = text; }
function careLiveStatus(text) { $("care-live-status").textContent = text; }
function careLiveState(state, text) {
  $("care-live").dataset.state = state; if (text != null) careLiveStatus(text);
  $("care-start").hidden = state !== "idle"; $("care-stop").hidden = state === "idle";
}
function careShowMedia() {
  const v = $("care-video"), img = $("care-bridge");
  const hasVideo = (care.src === "file" && care.files.length) || (care.src === "camera" && care.camStream);
  v.hidden = !hasVideo; img.hidden = care.src !== "bridge";
  v.controls = care.src === "file";
  $("care-stage-empty").hidden = Boolean(hasVideo) || care.src === "bridge";
  $("care-file-row").hidden = care.src !== "file";
  $("care-files-clear").hidden = !care.files.length;
  const badge = $("care-live-badge");
  let label = "", live = false;
  if (care.src === "file" && care.files.length) { label = "Recorded video · played as a live stream"; live = true; }
  else if (care.src === "camera" && care.camStream) { label = "This computer's camera · live"; live = true; }
  else if (care.src === "bridge") { label = care.bridgeLive ? "GoPro (via bridge) · live" : "GoPro (via bridge) · waiting"; live = care.bridgeLive; }
  badge.hidden = !label; badge.textContent = label; badge.dataset.live = String(live);
}
function careSourceLive() { return care.src === "file" ? care.files.length > 0 : care.src === "camera" ? Boolean(care.camStream) : care.bridgeLive; }
/* uploaded videos: object URLs only (never uploaded), looped as a playlist */
function careRevokeFiles() { care.files.forEach((f) => { try { URL.revokeObjectURL(f.url); } catch { /* */ } }); care.files = []; care.idx = 0; }
function careRenderPlaylist() {
  $("care-playlist").replaceChildren(...care.files.map((f, i) => el("li", { className: i === care.idx && care.src === "file" ? "on" : "", textContent: `${i === care.idx ? "▶ " : ""}${f.name} · ${(f.size / 1048576).toFixed(1)} MB` })));
}
async function carePlayIndex(i) {
  const v = $("care-video");
  if (!care.files.length) return;
  care.idx = ((i % care.files.length) + care.files.length) % care.files.length;
  v.srcObject = null; v.loop = care.files.length === 1; v.src = care.files[care.idx].url;
  careRenderPlaylist();
  try { await v.play(); careSrcStatus(`Playing ${care.idx + 1} of ${care.files.length}: ${care.files[care.idx].name}. Recorded video, played as a live stream (loops).`); }
  catch { careSrcStatus("The browser blocked autoplay. Press play on the video (or Start live guidance) to begin."); }
}
$("care-video").addEventListener("ended", () => { if (care.src === "file" && care.files.length > 1) carePlayIndex(care.idx + 1); });
$("care-video").addEventListener("error", () => {
  if (care.src !== "file" || !care.files.length) return;
  careSrcStatus(`Can't play ${care.files[care.idx]?.name || "this file"} in this browser. Skipping.`);
  if (care.files.length > 1) setTimeout(() => carePlayIndex(care.idx + 1), 800);
});
$("care-files").addEventListener("change", () => {
  const picked = [...($("care-files").files || [])].filter((f) => /^video\//.test(f.type) || /\.(mp4|mov|m4v|webm)$/i.test(f.name));
  if (!picked.length) { careSrcStatus("Choose mp4, mov or webm video files."); return; }
  careRevokeFiles();
  care.files = picked.map((f) => ({ name: f.name, size: f.size, url: URL.createObjectURL(f) }));
  $("care-files").value = ""; care.noSoundWarned = false;
  careSetSource("file"); carePlayIndex(0);
});
$("care-files-clear").addEventListener("click", () => {
  const v = $("care-video"); v.pause(); v.removeAttribute("src"); v.load();
  careRevokeFiles(); careRenderPlaylist(); careShowMedia(); careSrcStatus("Videos cleared.");
  if (care.ws && care.src === "file") careStop("Stopped: no video left to watch.");
});
/* camera */
async function careStartCamera() {
  if (care.camStream) return true;
  try {
    care.camStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 } } });
    const v = $("care-video"); v.removeAttribute("src"); v.loop = false; v.srcObject = care.camStream; v.muted = true;
    await v.play().catch(() => {});
    careSrcStatus(`Camera on: ${care.camStream.getVideoTracks()[0]?.label || "this computer's camera"}.`); careShowMedia(); return true;
  } catch (e) { careSrcStatus(`Camera unavailable (${e.name === "NotAllowedError" ? "permission denied" : e.message}).`); careShowMedia(); return false; }
}
function careStopCamera() {
  care.camStream?.getTracks().forEach((t) => t.stop()); care.camStream = null;
  const v = $("care-video"); if (v.srcObject) { v.srcObject = null; }
}
/* GoPro bridge */
async function careBridgeStatus() {
  try { const s = await (await fetch("/api/vision/status")).json(); care.bridgeLive = Boolean(s.live); careSrcStatus(care.bridgeLive ? `GoPro bridge live${s.camera ? ` · ${s.camera}` : ""}.` : "Waiting for the GoPro bridge to send frames…"); }
  catch { care.bridgeLive = false; careSrcStatus("GoPro bridge unavailable on this server."); }
  careShowMedia();
}
function careBridgeOn() {
  if (care.bridgeTimer) return;
  const img = $("care-bridge");
  img.onerror = () => { img.removeAttribute("src"); };
  const tick = () => { if (!document.hidden) img.src = `/api/vision/latest.jpg?t=${Date.now()}`; };
  tick(); care.bridgeTimer = setInterval(tick, 1000);
  careBridgeStatus(); care.bridgeStatusTimer = setInterval(careBridgeStatus, 5000);
}
function careBridgeOff() { clearInterval(care.bridgeTimer); clearInterval(care.bridgeStatusTimer); care.bridgeTimer = 0; care.bridgeStatusTimer = 0; $("care-bridge").removeAttribute("src"); }
function careSetSource(src) {
  if (care.ws && src !== care.src) careStop("Stopped because the video source changed. Press Start to continue.");
  care.src = src;
  document.querySelectorAll("input[name=care-src]").forEach((r) => { r.checked = r.value === src; });
  const v = $("care-video");
  if (src !== "camera") careStopCamera();
  if (src !== "bridge") careBridgeOff();
  if (src === "file") { if (care.files.length) { if (!v.src || v.srcObject) carePlayIndex(care.idx); } else { v.removeAttribute("src"); careSrcStatus("Upload one or more videos. They stay on this computer and play in a loop like a live stream."); } }
  else { v.pause(); v.removeAttribute("src"); }
  if (src === "camera") careStartCamera();
  if (src === "bridge" && care.visible) careBridgeOn();
  careRenderPlaylist(); careShowMedia();
}
document.querySelectorAll("input[name=care-src]").forEach((r) => r.addEventListener("change", () => { if (r.checked) careSetSource(r.value); }));

/* Gemini Live guidance */
function careSendPcm(int16) { if (care.ws?.readyState === 1 && int16.length) care.ws.send(int16.buffer); }
function careLog(kind, text, done = false) {
  if (!text) return;
  const box = $("care-log"), last = care.lines[care.lines.length - 1];
  if (last && last.kind === kind && !last.done) { last.text += text; box.lastElementChild.querySelector("p").textContent = last.text; }
  else {
    care.lines.push({ kind, text, done: false, at: new Date().toISOString() });
    box.append(el("li", { className: `lh-${kind}` }, el("b", { textContent: kind === "said" ? "Threadline" : kind === "note" ? "Note" : "Heard" }), el("p", { textContent: text })));
  }
  if (done) care.lines[care.lines.length - 1].done = true;
  while (care.lines.length > 120) { care.lines.shift(); box.firstChild?.remove(); }
  box.scrollTop = box.scrollHeight;
}
function careVideoAudio() {
  const v = $("care-video");
  if (!care.vctx) { care.vctx = new AudioContext(); care.vsrc = care.vctx.createMediaElementSource(v); care.vsrc.connect(care.vctx.destination); }
  care.vctx.resume().catch(() => {});
  v.muted = false;
  const rate = care.vctx.sampleRate, proc = care.vctx.createScriptProcessor(4096, 1, 1), sink = care.vctx.createGain();
  sink.gain.value = 0; let silent = 0;
  proc.onaudioprocess = (ev) => {
    const f = ev.inputBuffer.getChannelData(0); let peak = 0;
    for (let i = 0; i < f.length; i += 8) peak = Math.max(peak, Math.abs(f[i]));
    if (!v.paused && peak < 0.0005) { silent += f.length / rate; if (silent > 8 && !care.noSoundWarned) { care.noSoundWarned = true; careLog("note", "This clip seems to have no sound. Gemini still sees the video; type nothing, it will describe what it sees.", true); } } else silent = 0;
    careSendPcm(floatToPcm16(f, rate));
  };
  care.vsrc.connect(proc); proc.connect(sink); sink.connect(care.vctx.destination);
  care.audioStop = () => { proc.onaudioprocess = null; try { care.vsrc.disconnect(proc); } catch { /* */ } try { proc.disconnect(); sink.disconnect(); } catch { /* */ } v.muted = true; care.vctx?.suspend().catch(() => {}); };
  return "the video's own sound";
}
async function careMicAudio() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const ctx = new AudioContext(), rate = ctx.sampleRate, srcNode = ctx.createMediaStreamSource(stream), proc = ctx.createScriptProcessor(4096, 1, 1), sink = ctx.createGain();
  sink.gain.value = 0;
  proc.onaudioprocess = (ev) => careSendPcm(floatToPcm16(ev.inputBuffer.getChannelData(0), rate));
  srcNode.connect(proc); proc.connect(sink); sink.connect(ctx.destination);
  care.audioStop = () => { proc.onaudioprocess = null; try { srcNode.disconnect(); proc.disconnect(); } catch { /* */ } stream.getTracks().forEach((t) => t.stop()); ctx.close().catch(() => {}); };
  return "this computer's microphone";
}
async function careStartAudio() {
  if (capture.band) { try { care.audioStop = await liveBandAudio(careSendPcm); return "the Vexo band's microphone"; } catch { care.audioStop = null; } }
  if (care.src === "file" && care.files.length) return careVideoAudio();
  return careMicAudio();
}
function careStartFrames() {
  const c = $("care-canvas"), ctx = c.getContext("2d");
  care.frameTimer = setInterval(() => {
    const v = $("care-video");
    if (care.ws?.readyState !== 1 || document.hidden || care.src === "bridge" || !v.videoWidth || v.hidden) return;
    c.width = 640; c.height = Math.round(640 * v.videoHeight / v.videoWidth);
    try { ctx.drawImage(v, 0, 0, c.width, c.height); } catch { return; }
    const data = c.toDataURL("image/jpeg", 0.6).split(",")[1];
    if (data.length < 290000) care.ws.send(JSON.stringify({ type: "frame", jpeg: data }));
  }, 1000);
}
async function careStart() {
  if (care.ws) return;
  if (lh.ws) lhStop("Paused: live guidance on the Care page is using Gemini Live.");
  if (care.src === "file" && !care.files.length) return careLiveStatus("Upload a video first, or choose the GoPro or this computer's camera.");
  if (care.src === "camera" && !(await careStartCamera())) return careLiveStatus("Camera unavailable. Pick another source.");
  careLiveState("busy", "Connecting to Gemini Live…");
  try {
    if (care.src === "file") { const v = $("care-video"); if (v.paused) await v.play().catch(() => {}); }
    if (care.src === "bridge") careBridgeOn();
    care.out = new AudioContext({ sampleRate: 24000 }); care.playAt = 0; care.out.resume().catch(() => {});
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/live-gemini`);
    ws.binaryType = "arraybuffer"; care.ws = ws;
    const bridge = care.src === "bridge";
    const openTimer = setTimeout(() => { if (care.ws === ws && $("care-live").dataset.state === "busy") careStop("Gemini Live didn't answer. It may be unavailable right now."); }, 15000);
    ws.onopen = () => ws.send(JSON.stringify({ token: "", mode: "memory", ...(bridge ? { vision: "bridge" } : {}) }));
    ws.onmessage = async (event) => {
      if (care.ws !== ws) return;
      if (event.data instanceof ArrayBuffer) return livePlayPcm24(care, event.data);
      let msg; try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === "ready") {
        clearTimeout(openTimer);
        const notes = ["This person lives with dementia. Speak calmly, in short sentences, one step at a time; reassure, never rush.",
          ...careRoutine().map((r) => `Usual routine: ${r}`)];
        ws.send(JSON.stringify({ type: "context", notes }));
        const where = await careStartAudio().catch((e) => { careLog("note", `No audio input (${e.message}). Gemini still sees the video.`, true); return "no microphone"; });
        if (care.ws !== ws) { care.audioStop?.(); care.audioStop = null; return; }
        if (!bridge) careStartFrames();
        careLiveState("live", `Live with ${msg.model || "Gemini"} · watching ${CARE_SRC_LABEL[care.src]} · listening through ${where}.`);
        if (typeof logAction === "function") logAction("Started Care live guidance");
      } else if (msg.type === "heard") careLog("heard", msg.text);
      else if (msg.type === "said") careLog("said", msg.text);
      else if (msg.type === "turn_complete") { const l = care.lines[care.lines.length - 1]; if (l) l.done = true; }
      else if (msg.type === "interrupted") liveInterrupt(care);
      else if (msg.type === "error") { careLiveStatus(msg.message || "Gemini Live reported an error."); if ($("care-live").dataset.state === "busy") careStop(`Gemini Live unavailable: ${msg.message || "error"}`); }
      else if (msg.type === "vision") careLiveStatus(msg.live ? `Seeing through ${msg.camera || "the GoPro"}.` : "Waiting for GoPro frames from the bridge…");
    };
    ws.onerror = () => {};
    ws.onclose = () => { clearTimeout(openTimer); if (care.ws === ws) careStop($("care-live").dataset.state === "busy" ? "Gemini Live is unavailable right now." : "Live guidance ended."); };
  } catch (e) { careStop(`Couldn't start: ${e.message}`); }
}
function careStop(text = "Stopped.") {
  const ws = care.ws; care.ws = null;
  try { ws?.readyState === 1 && ws.send(JSON.stringify({ type: "stop" })); ws?.close(); } catch { /* closed */ }
  clearInterval(care.frameTimer); care.frameTimer = 0;
  liveInterrupt(care);
  try { care.audioStop?.(); } catch { /* */ } care.audioStop = null;
  try { care.out?.close(); } catch { /* */ } care.out = null;
  if (care.src === "camera") { careStopCamera(); careSrcStatus("Camera off. Choose the camera again to turn it on."); }
  if (care.src === "bridge" && !care.visible) careBridgeOff();
  careShowMedia(); careLiveState("idle", text);
}
$("care-start").addEventListener("click", careStart);
$("care-stop").addEventListener("click", () => careStop());
$("care-mute").addEventListener("change", () => { care.muted = $("care-mute").checked; if (care.muted) liveInterrupt(care); });
$("lh-start").addEventListener("click", () => { if (care.ws) careStop("Paused: memory help on Your band is using Gemini Live."); }, true);

/* Band events the agent should know about */
function careWatchBand() {
  const b = capture.band;
  if (b && !care.bandSeen.has(b)) {
    care.bandSeen.add(b);
    b.on("tap", () => care.taps.push(Date.now()));
    b.on("free-fall", () => { care.falls.push(Date.now()); careLog("note", "The band felt a possible fall. Checking in.", true); if (care.visible || care.ws) setTimeout(() => careAssess(false), 500); });
  }
  const cut = Date.now() - 10 * 60000;
  care.taps = care.taps.filter((t) => t > cut); care.falls = care.falls.filter((t) => t > cut);
  if (careRoutineKey() !== care.routineKey) renderCareRoutine();
}
setInterval(careWatchBand, 2000);

/* Routine (per band, kept in this browser) */
const CARE_ROUTINE_DEFAULT = ["Breakfast 8:00", "Pills with breakfast", "Short walk 10:30", "Lunch 12:30", "Call with family 17:00"];
function careRoutineKey() { return `threadline.care.routine.v1.${bandNumber || "default"}`; }
function careRoutine() { try { const v = JSON.parse(localStorage.getItem(careRoutineKey()) || "null"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : CARE_ROUTINE_DEFAULT.slice(); } catch { return CARE_ROUTINE_DEFAULT.slice(); } }
function careSaveRoutine(items) { try { localStorage.setItem(careRoutineKey(), JSON.stringify(items.slice(0, 40))); } catch { /* storage off */ } }
function renderCareRoutine() {
  care.routineKey = careRoutineKey();
  const items = careRoutine();
  $("care-routine").replaceChildren(...(items.length ? items.map((text, i) => {
    const input = el("input", { type: "text", value: text, maxLength: 120, "aria-label": `Routine item ${i + 1}` });
    input.addEventListener("change", () => { const all = careRoutine(); const t = input.value.trim(); if (t) all[i] = t; else all.splice(i, 1); careSaveRoutine(all); renderCareRoutine(); });
    const rm = el("button", { type: "button", className: "text-button", textContent: "Remove" });
    rm.addEventListener("click", () => { const all = careRoutine(); all.splice(i, 1); careSaveRoutine(all); renderCareRoutine(); });
    return el("li", {}, input, rm);
  }) : [el("li", { className: "care-empty", textContent: "No routine yet. Add what the day usually looks like." })]));
}
$("care-routine-form").addEventListener("submit", (e) => {
  e.preventDefault(); const t = $("care-routine-text").value.trim(); if (!t) return;
  careSaveRoutine([...careRoutine(), t]); $("care-routine-text").value = ""; renderCareRoutine();
});

/* Health: Apple Health summary + live watch readings */
const CARE_HM = [
  ["heart_rate", "Heart rate", "bpm", ["heart_rate", "hr", "heart_rate_avg"]],
  ["resting_hr", "Resting HR", "bpm", ["resting_hr", "resting_heart_rate"]],
  ["hrv", "HRV", "ms", ["hrv_sdnn", "hrv", "hrv_sdnn_ms", "hrv_ms", "heart_rate_variability"]],
  ["spo2", "SpO₂", "%", ["spo2", "oxygen_saturation", "blood_oxygen"]],
  ["respiratory_rate", "Breathing", "/min", ["respiratory_rate", "resp_rate"]],
  ["sleep_hours", "Sleep", "h", ["sleep_hours", "sleep_hours_last_night", "sleep"]],
  ["steps", "Steps", "", ["steps", "step_count"]],
  ["exercise_min", "Exercise", "min", ["exercise_min", "exercise_minutes", "exercise_min_today"]],
  ["wrist_temp", "Wrist temp", "°C", ["wrist_temp", "wrist_temperature", "wrist_temp_c", "wrist_temperature_c"]],
  ["mindful_min", "Mindful", "min", ["mindful_min", "mindful_minutes", "mindful_min_today"]],
  ["mood", "Mood", "", ["mood", "state_of_mind"]],
];
const careNum = (v) => { if (v && typeof v === "object") v = v.value ?? v.avg ?? v.mean ?? v.average ?? v.today ?? null; return v == null || v === "" ? null : v; };
function carePick(obj, aliases) { if (!obj || typeof obj !== "object") return null; for (const a of aliases) { const v = careNum(obj[a]); if (v != null) return v; } return null; }
function careHealthNorm(d) {
  const out = {}; if (!d || typeof d !== "object") return out;
  const today = d.today || d.latest || {}, avg = d.averages || d.average || d.avg || d.mean || {};
  const rows = Array.isArray(d.days) ? d.days : Array.isArray(d.series) ? d.series : Array.isArray(d.daily) ? d.daily : [];
  const metrics = d.metrics && typeof d.metrics === "object" && !Array.isArray(d.metrics) ? d.metrics : {};
  for (const [key, , , aliases] of CARE_HM) {
    const m = aliases.map((a) => metrics[a]).find((x) => x != null);
    let series = rows.map((r) => ({ date: r.date || r.day, v: carePick(r, aliases) })).filter((x) => typeof x.v === "number");
    if (!series.length && m && Array.isArray(m.series || m.days)) series = (m.series || m.days).map((x) => ({ date: x.date || x.day, v: careNum(x.value ?? x.v ?? x) })).filter((x) => typeof x.v === "number");
    let t = carePick(today, aliases); if (t == null && m && typeof m === "object") t = careNum(m.today ?? m.latest);
    if (t == null && rows.length) { const last = rows[rows.length - 1]; if ((last.date || last.day) === localDate(new Date())) t = carePick(last, aliases); }
    let a = carePick(avg, aliases); if (a == null && m && typeof m === "object") a = careNum(m.avg ?? m.average ?? m.mean ?? m.avg_30d);
    if (a == null && series.length) a = series.reduce((s, x) => s + x.v, 0) / series.length;
    if (t != null || a != null || series.length) out[key] = { today: t, avg: a, series };
  }
  return out;
}
function careFmt(key, v) {
  if (v == null) return "—"; if (typeof v !== "number") return String(v);
  if (key === "spo2" && v <= 1) v *= 100;
  if (key === "steps") return Math.round(v).toLocaleString();
  if (key === "sleep_hours" || key === "wrist_temp" || key === "respiratory_rate") return v.toFixed(1);
  return String(Math.round(v));
}
function careLiveWatch() { return watch.sensors && Date.now() - watch.sensorsAt < 120000 ? watch.sensors : null; }
function careHealthToday() {
  const norm = care.health || {}, live = careLiveWatch(), out = {};
  for (const [key, , , aliases] of CARE_HM) {
    const lv = live ? carePick(live, aliases) : null;
    const v = lv ?? norm[key]?.today ?? null;
    if (v != null) out[key] = v;
    if (norm[key]?.avg != null) out[`${key}_30d_avg`] = Math.round(norm[key].avg * 10) / 10;
  }
  return out;
}
function careSpark(title, series, key) {
  const vals = series.slice(-30).map((x) => x.v); if (vals.length < 2) return null;
  const NS = "http://www.w3.org/2000/svg", w = 140, h = 40, min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - 4 - ((v - min) / span) * (h - 8)}`).join(" ");
  const svg = document.createElementNS(NS, "svg"); svg.setAttribute("viewBox", `0 0 ${w} ${h}`); svg.setAttribute("preserveAspectRatio", "none"); svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${title}, last ${vals.length} days, from ${careFmt(key, min)} to ${careFmt(key, max)}`);
  const line = document.createElementNS(NS, "polyline"); line.setAttribute("points", pts); line.setAttribute("fill", "none"); line.setAttribute("stroke", "#5E9C7A"); line.setAttribute("stroke-width", "2"); line.setAttribute("vector-effect", "non-scaling-stroke");
  svg.append(line);
  return el("figure", {}, el("figcaption", { textContent: `${title} · ${vals.length} days · latest ${careFmt(key, vals[vals.length - 1])}` }), svg);
}
function renderCareHealth() {
  const norm = care.health || {}, live = careLiveWatch(), tiles = [];
  for (const [key, label, unit, aliases] of CARE_HM) {
    const lv = live ? carePick(live, aliases) : null, m = norm[key];
    if (lv == null && !m) continue;
    const v = lv ?? m?.today;
    tiles.push(el("div", { className: "hm" }, el("div", { className: "hm-k" }, label, lv != null ? el("span", { className: "hm-live", textContent: "live" }) : null),
      el("div", { className: "hm-v", textContent: v == null ? "—" : `${careFmt(key, v)}${unit && typeof v === "number" ? ` ${unit}` : ""}` }),
      el("div", { className: "hm-a", textContent: m?.avg != null ? `30-day avg ${careFmt(key, m.avg)}${unit ? ` ${unit}` : ""}` : "No history" })));
  }
  if (!tiles.length) {
    $("care-health").replaceChildren(el("div", { className: "care-empty-health" }, el("p", { className: "caption", textContent: care.healthError || "Import your Apple Health export to see history." })));
    $("care-import").open = true;
  } else $("care-health").replaceChildren(...tiles);
  $("care-spark").replaceChildren(...[["Steps", "steps"], ["Sleep", "sleep_hours"], ["Resting HR", "resting_hr"]].map(([t, k]) => careSpark(t, norm[k]?.series || [], k)).filter(Boolean));
}
async function loadCareHealth(force = false) {
  if (!force && Date.now() - care.healthAt < 5 * 60000) return renderCareHealth();
  care.healthAt = Date.now();
  try {
    const r = await fetch("/api/health/summary?days=30");
    if (!r.ok) throw new Error(r.status === 404 ? "missing" : `HTTP ${r.status}`);
    care.health = careHealthNorm(await r.json()); care.healthError = "";
  } catch (e) { care.health = null; care.healthError = e.message === "missing" ? "Health history isn't available on this server yet. Import your Apple Health export to see history." : "Couldn't load health history. Import your Apple Health export to see history."; }
  renderCareHealth();
}
$("care-health-upload").addEventListener("click", () => {
  const f = $("care-health-file").files?.[0], msg = $("care-health-msg"), bar = $("care-health-progress");
  if (!f) { msg.textContent = "Choose the export.zip (or export.xml) first."; return; }
  const key = publishKey();
  if (!key) { msg.textContent = "Only the owner can import. Save the owner key under Your band → Connect a device → Owner first."; return; }
  const xhr = new XMLHttpRequest();
  xhr.open("POST", "/api/health/import");
  xhr.setRequestHeader("X-Publish-Key", key);
  xhr.setRequestHeader("Content-Type", /\.xml$/i.test(f.name) ? "application/xml" : "application/zip");
  bar.hidden = false; bar.value = 0; $("care-health-upload").disabled = true; msg.textContent = `Uploading ${(f.size / 1048576).toFixed(1)} MB…`;
  xhr.upload.onprogress = (e) => { if (e.lengthComputable) { bar.value = Math.round((e.loaded / e.total) * 100); if (bar.value >= 100) msg.textContent = "Uploaded. Reading the export (this can take a minute)…"; } };
  xhr.onload = () => {
    $("care-health-upload").disabled = false; bar.hidden = true;
    if (xhr.status === 401 || xhr.status === 403) { msg.textContent = "Only the owner can import."; return; }
    if (xhr.status === 404) { msg.textContent = "Health import isn't available on this server yet."; return; }
    if (xhr.status === 409) { msg.textContent = "Another import is already running. Try again in a minute."; return; }
    if (xhr.status === 415) { msg.textContent = "Choose the export.zip or export.xml from the Health app."; return; }
    if (xhr.status === 400) { msg.textContent = "That file isn't an Apple Health export."; return; }
    if (xhr.status === 503) { msg.textContent = "Health storage is off on this server."; return; }
    if (xhr.status < 200 || xhr.status >= 300) { let d = ""; try { d = JSON.parse(xhr.responseText).detail || ""; } catch { /* */ } msg.textContent = `Import failed (${xhr.status}${d ? `: ${d}` : ""}).`; return; }
    let d = {}; try { d = JSON.parse(xhr.responseText); } catch { /* */ }
    const range = Array.isArray(d.range) ? d.range.join(" to ") : d.range && typeof d.range === "object" ? `${d.range.start || d.range.from || ""} to ${d.range.end || d.range.to || ""}` : (d.range || "");
    const metrics = Array.isArray(d.metrics) ? d.metrics.length : d.metrics;
    msg.textContent = `Imported ${d.records ?? "?"} records · ${d.days ?? "?"} days · ${metrics ?? "?"} metrics${range ? ` · ${range}` : ""}.`;
    $("care-health-file").value = ""; loadCareHealth(true);
  };
  xhr.onerror = () => { $("care-health-upload").disabled = false; bar.hidden = true; msg.textContent = "Upload failed. Check the connection and try again."; };
  xhr.send(f);
});

/* Caregiver agent */
function careContext() {
  const bandLines = [...document.querySelectorAll("#live-lines li p")].map((p) => p.textContent.trim()).filter(Boolean);
  const heard = care.lines.filter((l) => l.kind === "heard").map((l) => `Heard: ${l.text.trim()}`);
  const said = care.lines.filter((l) => l.kind === "said").map((l) => l.text.trim()).filter(Boolean);
  const w = careLiveWatch();
  // Shapes match POST /api/care/assess exactly (objects, booleans, enum source).
  const nowIso = new Date().toISOString();
  const src = { file: "file", upload: "file", files: "file", bridge: "gopro", gopro: "gopro", camera: "camera" }[care.src] || null;
  return {
    transcript: [...bandLines, ...heard].slice(-40).map((text) => ({ at: nowIso, speaker: text.startsWith("Heard: ") ? "video/mic" : "band", text: text.slice(0, 500) })),
    observations: [...said.slice(-19).map((text) => ({ at: nowIso, text: text.slice(0, 500) })),
      ...(moodOf(todayKey()) ? [{ at: nowIso, text: `Care log today: mood ${moodOf(todayKey()).morningLabel} in the morning, ${moodOf(todayKey()).eveningLabel} in the evening; evening agitation ${["none", "mild", "moderate", "severe"][moodOf(todayKey()).agitation]}; ${moodOf(todayKey()).repeats} repeated questions; latest weekly CSDD ${ownerMood.weeks.at(-1)?.score ?? "n/a"}.` }] : [])],
    band: { activity: signals.activity || w?.activity || null, steps: Number.isFinite(signals.steps) && signals.steps > 0 ? Math.round(signals.steps) : null, taps_last_10min: care.taps.length, free_fall_last_10min: care.falls.length > 0, connected: Boolean(capture.band) },
    health: careHealthToday(),
    video: { source: src, live: Boolean(careSourceLive()) },
    routine: careRoutine().map(String).slice(0, 10),
  };
}
const CARE_STATUS_WORD = { ok: "All calm", needs_attention: "Needs attention", urgent: "Please check in now" };
function careRenderAssessment(d) {
  const status = ["ok", "needs_attention", "urgent"].includes(d.status) ? d.status : "needs_attention";
  $("care-agent").dataset.status = status;
  $("care-agent-h").textContent = CARE_STATUS_WORD[status];
  $("care-agent-summary").textContent = d.summary || "";
  $("care-next").textContent = d.next_step || "—";
  $("care-note").textContent = d.caregiver_note || "—";
  $("care-text-family").href = `sms:?&body=${encodeURIComponent(`Threadline Care: ${d.caregiver_note || d.summary || "please check in"}`.slice(0, 300))}`;
  $("care-reasons").replaceChildren(...[...(d.reasons || []), ...(d.observations || []).map((o) => `Seen: ${o}`)].slice(0, 12).map((r) => el("li", { textContent: String(r) })));
  const at = d.at ? new Date(d.at) : new Date();
  care.history.push({ status, summary: d.summary || CARE_STATUS_WORD[status], at });
  if (care.history.length > 60) care.history.shift();
  const box = $("care-history");
  box.replaceChildren(...care.history.slice().reverse().map((h) => el("li", {}, el("span", { className: `dotk ${h.status}`, "aria-hidden": "true" }), el("time", { textContent: h.at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) }), el("span", { textContent: `${CARE_STATUS_WORD[h.status]} · ${h.summary}` }))));
  box.scrollTop = 0;
  $("care-agent-state").textContent = `Checked ${at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}${d.engine ? ` · ${d.engine}` : ""}.`;
  if (status === "urgent" && (care.lastStatus !== "urgent" || Date.now() - care.lastTapAt > 5 * 60000)) {
    care.lastTapAt = Date.now();
    sendHaptic("notification", (d.next_step || d.summary || "Please check in").slice(0, 80));
    try { if ("Notification" in window && Notification.permission === "granted") new Notification("Threadline · please check in", { body: d.caregiver_note || d.summary || d.next_step || "" }); } catch { /* not allowed */ }
    if (typeof logAction === "function") logAction("Caregiver agent: urgent, tapped the watch");
  }
  care.lastStatus = status;
}
$("care-sim-fall")?.addEventListener("click", () => { care.falls.push(Date.now()); careLog("note", "Demo: simulated a fall from the band.", true); careAssess(true); });
async function careAssess(manual) {
  if (care.agentBusy) { if (manual) $("care-agent-state").textContent = "A check is already running…"; return; }
  care.agentBusy = true; $("care-check").disabled = true; $("care-agent-state").textContent = "Checking…";
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 30000);
  try {
    const r = await fetch("/api/care/assess", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ context: careContext(), engine: "gemini" }), signal: ctl.signal });
    if (r.status === 404 || r.status === 405) throw new Error("unavailable");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    careRenderAssessment(await r.json());
  } catch (e) {
    $("care-agent-state").textContent = e.message === "unavailable" ? "Caregiver agent unavailable." : `Caregiver agent unavailable (${e.name === "AbortError" ? "timed out" : e.message}). Trying again in 30 s.`;
  } finally { clearTimeout(timer); care.agentBusy = false; $("care-check").disabled = false; }
}
$("care-check").addEventListener("click", async () => {
  if ("Notification" in window && Notification.permission === "default") { try { await Notification.requestPermission(); } catch { /* ignored */ } }
  careAssess(true);
});

function careOnView(name) {
  const was = care.visible; care.visible = name === "care";
  if (care.visible && !was) {
    renderCareRoutine(); loadCareHealth(); careShowMedia(); careRenderPlaylist();
    if (care.src === "bridge") careBridgeOn();
    clearInterval(care.agentTimer);
    care.agentTimer = setInterval(() => { if (!document.hidden) { careAssess(false); renderCareHealth(); } }, 30000);
    setTimeout(() => { if (care.visible && !care.history.length) careAssess(false); }, 1500);
  } else if (!care.visible && was) {
    clearInterval(care.agentTimer); care.agentTimer = 0;
    if (!care.ws) careBridgeOff();
  }
}
window.addEventListener("pagehide", () => { careStop(); careStopCamera(); careRevokeFiles(); });
careSetSource("file");

render();
showView(location.hash.slice(1) || "dashboard");
renderProfile();
renderPublish(); loadDemoTranscript(); startDemoFeed();
loadOwnerHealth(); renderSampleBanner();
/* Keep the owner's band connected: reopen the USB port this site was already allowed to use — on load,
   whenever the cable is plugged back in, and every 10 s while disconnected. No chooser, no re-pairing. */
async function autoConnectBand() {
  if (!bandNumber || capture.band || pair.busy || !navigator.serial?.getPorts) return;
  let ports = [];
  try { ports = await navigator.serial.getPorts(); } catch { return; }
  for (const port of ports) {
    if (capture.band || pair.busy) return;
    if (port.readable) continue;  // already open in this page
    await connectBand("serial", port);
  }
}
navigator.serial?.addEventListener?.("connect", () => setTimeout(autoConnectBand, 800));
setTimeout(autoConnectBand, 600);
setInterval(autoConnectBand, 10000);
$("sample-clear")?.addEventListener("click", clearSample);
