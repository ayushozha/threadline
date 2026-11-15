"use strict";
import { claimBandAudio, queueBandAudio, pcmWav } from './band-capture.mjs';
import { createUtteranceCollector, createSerialQueue } from './transcript-flow.mjs';
import { createVisionController } from './vision.mjs';
import { sampleSeed, seedForApp, DEMO_QUESTIONS } from './sample-data.mjs';
import { renderDashboard } from './dashboard.mjs';
import { ACCESS_MODES, createTapGesture } from './modes.mjs';
import { mountMemoryGraph, TYPE_STYLE } from './memory-graph.mjs';
import { mountLibrary } from './library.mjs';
import { mountEmergency, loadContacts, saveContacts } from './emergency.mjs';
import { mountEssentials, purchaseReply } from './essentials.mjs';
import { mountAssistant } from './assistant.mjs';
import { speak as speakNatural } from './voice.mjs';
import { mountCalendar } from './calendar.mjs';
import { mountCalendarView } from './calview.mjs';
import { mountPhoneCam } from './phonecam.mjs';
import { suggestTasks } from './task-suggest.mjs';
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) { if (key.includes("-")) node.setAttribute(key, value); else node[key] = value; }
  node.append(...children.filter((c) => c != null)); return node;
};
let accessMode = "memory";
const accessInfo = () => ACCESS_MODES[accessMode];
let seedCache;
const demoSeed = () => {
  const day = new Date().toDateString();
  if (!seedCache || seedCache.mode !== accessMode || seedCache.day !== day) seedCache = { mode: accessMode, day, value: sampleSeed(new Date(), accessMode) };
  return seedCache.value;
};
let appSeedCache;
const appSeed = () => appSeedCache ||= seedForApp(new Date());
const contextNotes = (notes = sessions[mode].notes) => notes.filter(n => !n.sample || n.exampleMode === accessMode);
const HOUR = 3600000, DAY = 24 * HOUR;
const ago = (days, hour = 20, minute = 0) => { const d = new Date(Date.now() - days * DAY); d.setHours(hour, minute, 0, 0); return d.toISOString(); };
const localDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return localDate(d); };
const fmtWhen = (iso) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const fmtDate = (iso) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
const fmtClock = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); };
const SOURCE_LABELS = { typed: "Typed", vexo: "Vexo band · reviewed", watch: "Apple Watch · reviewed", mic: "Browser mic · reviewed", upload: "Audio file · reviewed", fictional: "Example", seeded: "Example" };

const MODES = {
  reflection: { description: "Personal reflection: keep your own words with their source, revisit them later, and get only the support you chose. Only explicit statements are used — never an inferred cause, diagnosis, or judgment." },
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
  flushLiveWork();
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
  if (!isFictionalDemo()) {
    for (const m of ["reflection", "routine"]) sessions[m].notes = sessions[m].notes.filter(n => !n.sample || n.seeded);
    for (const field of ["tasks", "taskDrafts", "energyLog", "actions"]) life[field] = life[field].filter(x => !x.sample || x.userAdded);
    if (life.energy?.sample) life.energy = null;
    for (const [day, rec] of Object.entries(life.days)) if (rec.sample) delete life.days[day];
    saveArchive(loadArchive().filter(x => !x.sample || x.seeded));
    if ((saved?.seedVersion || 0) < appSeed().version) {
      const seed = appSeed();
      for (const m of ["reflection", "routine"]) {
        const ids = new Set(sessions[m].notes.map(n => n.id));
        sessions[m].notes.push(...seed.notes.filter(n => !ids.has(n.id)).map(n => ({ ...n })));
      }
      const archive = loadArchive(), ids = new Set(archive.map(x => x.id));
      saveArchive([...archive, ...seed.archive.filter(x => !ids.has(x.id))]);
      saveThread();
    }
  }
  renderSampleBanner();
}
/* Fictional history is opt-in and has separate storage for each selected band. */
const realThreadKey = () => bandNumber ? `band-${bandNumber}` : "browser";
function isFictionalDemo() { return threadKey.startsWith("fictional-"); }
function processingConsent() { return isFictionalDemo() ? $("sample-consent").checked : $("rec-consent").checked; }
function renderSampleBanner() {
  const active = isFictionalDemo();
  if (active) $("care-band-transcript").hidden = true;
  $("sample-banner").hidden = true;
  $("sample-load").hidden = true;
  $("sample-exit").hidden = true;
  $("seed-notice").hidden = !sessions.reflection.notes.some(n => n.seeded);
}
function loadSample() {
  if (busy || capture.active || care.ws || lh.ws || watch.owningLive) return message("Stop the live session before opening fictional history.", true);
  saveThread();
  loadThread(`fictional-v2-${accessMode}-${realThreadKey()}`);
  if (!sessions.routine.notes.length) {
    const seed = demoSeed();
    sessions.reflection.notes = seed.notes.map(n => ({ ...n }));
    sessions.routine.notes = seed.notes.map(n => ({ ...n }));
    saveArchive(seed.archive);
  }
  mode = "routine"; sessions.routine.question = DEMO_QUESTIONS[accessMode];
  care.history = []; $("care-history").replaceChildren();
  stopDemoFeed(); render(); renderAccessMode(); renderCareRoutine(); renderCareHealth();
  showAnswer("Fictional history loaded. Allow demo processing above, then ask Gemini about the linked conversations.");
  message("Fictional history only · your real notes and recordings are kept separately.");
  location.hash = "thread";
}
function exitSample() {
  if (!isFictionalDemo()) return;
  saveThread(); loadThread(realThreadKey()); mode = "reflection";
  $("sample-consent").checked = false;
  care.history = []; $("care-history").replaceChildren();
  render(); renderAccessMode(); renderCareRoutine(); renderCareHealth();
  if (demoWanted()) startDemoFeed();
  showAnswer("Back to your own notes. Fictional history is stored separately.");
}
function clearSample() {
  if (!isFictionalDemo()) return;
  for (const m of ["reflection", "routine"]) sessions[m].notes = [];
  life.tasks = []; life.taskDrafts = []; life.energyLog = []; life.actions = []; life.days = {}; life.energy = null;
  saveArchive([]); saveThread(); exitSample();
}
function renderAccessMode() {
  document.querySelectorAll('[data-access-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.accessMode === accessMode)));
  $('access-description').textContent = accessInfo().description;
  $('sample-load').textContent = `Load fictional ${accessInfo().label} demo`;
  $('care-live-h').textContent = `${accessInfo().label} · live assistance`;
  $('hearing-screen').hidden = accessMode !== 'hearing';
  $('caption-demo').hidden = !contextNotes().some(n => n.sample);
  $('hearing-name').value = localStorage.getItem(`threadline.caption-name.${realThreadKey()}`) || '';
  care.muted = accessMode === 'hearing'; lh.muted = care.muted; $('care-mute').checked = care.muted;
}
function selectAccessMode(value) {
  if (!ACCESS_MODES[value] || value === accessMode) return;
  const demo = isFictionalDemo();
  if (demo) exitSample();
  careStop('Mode changed. Confirm consent and restart live assistance.'); lhStop();
  accessMode = value;
  try { localStorage.setItem(`threadline.access-mode.${realThreadKey()}`, value); } catch { /* optional persistence */ }
  $('care-consent').checked = false; $('lh-consent').checked = false;
  care.history = []; $('care-history').replaceChildren(); $('assistance-panel').hidden = true;
  renderAccessMode(); if (demo) loadSample(); else { render(); scheduleGraph(0); }
  drawDashboard();
}
document.querySelectorAll('[data-access-mode]').forEach(b => b.addEventListener('click', () => selectAccessMode(b.dataset.accessMode)));
let lastCaptionCue = 0;
function renderHearingCaption(text, final, speaker = null) {
  if (accessMode !== 'hearing' || !text?.trim()) return;
  $('caption-live').textContent = text;
  $('caption-status').textContent = final ? `Final · ${speaker == null ? 'speaker not identified' : `Speaker ${speaker}`}` : 'Live draft · words may change';
  if (final) {
    $('caption-history').append(el('li', {}, el('span', { className: 'caption', textContent: speaker == null ? 'Speaker not identified' : `Speaker ${speaker}` }), el('p', { textContent: text })));
    while ($('caption-history').children.length > 50) $('caption-history').firstChild.remove();
    const name = $('hearing-name').value.trim();
    if (!isFictionalDemo() && name && text.toLocaleLowerCase().includes(name.toLocaleLowerCase()) && $('hearing-cue').checked && Date.now() - lastCaptionCue > 5000) {
      lastCaptionCue = Date.now();
      const sent = sendHaptic('notification', 'Your chosen name was heard in the transcript');
      $('caption-cue-status').textContent = sent ? 'Name cue requested from the paired watch.' : 'Name heard. Pair a watch for a wrist cue.';
    }
  }
}
$('caption-demo').addEventListener('click', async () => {
  if (!contextNotes().some(n => n.sample) || accessMode !== 'hearing') return;
  const scope = workspaceVersion;
  $('caption-demo').disabled = true; $('caption-history').replaceChildren();
  for (const line of demoSeed().archive[0].lines) {
    if (scope !== workspaceVersion) break;
    renderHearingCaption(line.text, true, line.speakers[0]);
    $('caption-status').textContent = 'Example conversation playback · not a live microphone';
    await new Promise(resolve => setTimeout(resolve, 900));
  }
  $('caption-demo').disabled = false;
});
$('hearing-name').addEventListener('change', () => { try { localStorage.setItem(`threadline.caption-name.${realThreadKey()}`, $('hearing-name').value.trim()); } catch { /* optional */ } });
$('care-consent').addEventListener('change', () => { if (!$('care-consent').checked) careStop('Consent removed. Live guidance stopped.'); });
$('lh-consent').addEventListener('change', () => { if (!$('lh-consent').checked) lhStop('Consent removed. Live help stopped.'); });
function requestAssistance(reason) {
  const synthetic = isFictionalDemo();
  $('assistance-panel').hidden = false;
  $('assistance-reason').textContent = `${synthetic ? 'Fictional demonstration: ' : ''}${reason}. Review the message below. Nothing has been sent.`;
  $('assistance-draft').value = `${synthetic ? '[FICTIONAL DEMO] ' : ''}I am requesting assistance. Please contact me or check in with me. (${reason})`;
  $('assistance-status').textContent = 'Draft prepared · not sent';
  $('assistance-draft').dispatchEvent(new Event('input'));
  if (!synthetic) sendHaptic('notification', 'Assistance requested; review the family message');
  location.hash = 'care';
}
$('assistance-open').addEventListener('click', () => requestAssistance('I pressed the assistance button'));
$('assistance-dismiss').addEventListener('click', () => { $('assistance-panel').hidden = true; });
$('assistance-draft').addEventListener('input', () => { $('assistance-send').href = `sms:?&body=${encodeURIComponent($('assistance-draft').value)}`; });
$('assistance-send').addEventListener('click', () => { $('assistance-status').textContent = 'Opening your messaging app. Choose a recipient and send there; delivery is not verified.'; });
/* The owner's Apple Health history (uploaded from the iPhone) — shown on the default profile only. */
const ownerHealth = { byDay: {}, latest: null, importedAt: null, days: 0 };
let ownerMood = { days: [], weeks: [] }; // Only actual caregiver assessments belong in this series.
const moodOf = (k) => ownerMood.days.find((d) => d.date === k) || null;
const moodWord = (v) => v > 0.5 ? "very pleasant" : v > 0.2 ? "pleasant" : v < -0.5 ? "very unpleasant" : v < -0.2 ? "unpleasant" : "neutral";
function drawDashboard() {
  try { rebuildMood(); } catch { /* not ready */ }
  try {
    const health = chartHealth();
    renderDashboard($("dashboard"), { health, mood: ownerMood, careHistory: typeof care !== "undefined" ? care.history : [],
      transcripts: loadArchive(), notes: contextNotes(), drafts: (life.taskDrafts || []).filter(d => !d.exampleMode || d.exampleMode === accessMode), tasks: life.tasks || [], who: isFictionalDemo() ? `${demoSeed().persona} · fictional demo` : "Your person", accessMode, synthetic: Object.values(health).some(d => d.sample) });
    const count = $("memory-count"); if (count) count.textContent = `${sessions.reflection.notes.length} notes · ${loadArchive().length} conversations`;
  } catch (e) { $("dashboard").textContent = `Dashboard unavailable: ${e.message}`; }
}
window.addEventListener("hashchange", () => { if (location.hash === "#dashboard") drawDashboard(); if (location.hash === "#graph") drawGraph(); if (location.hash === "#library") openLibrary(); if (location.hash === "#tasks") renderTasks(); if (location.hash === "#essentials") openEssentials(); });
let essentialsMounted = false, shop = null;
function openEssentials() { if (essentialsMounted || !$("essentials")) return; essentialsMounted = true; shop = mountEssentials($("essentials"), { el, request, contactName: () => loadContacts().name, onLog: (t) => { try { logAction(t); } catch { /* */ } } }); }
let library = null;
function openLibrary() {
  if (library || !$("library")) return;
  library = mountLibrary($("library"), {
    request,
    onSpeak: (text) => { speakNatural(text).catch(() => {}); },
    onRunLive: (sc) => {
      selectAccessMode(sc.mode);
      careRevokeFiles(); care.files = [{ url: sc.video, name: sc.title, size: 0 }]; care.idx = 0;
      location.hash = "care"; careSetSource("file"); carePlayIndex(0);
      careLiveStatus(`${sc.title} loaded in ${ACCESS_MODES[sc.mode]?.label || sc.mode} mode. Tick consent, then press Start live guidance.`);
    },
  });
}
/* Caregiver mood check-ins: real assessments entered by the caregiver, kept per profile in this browser. */
const MOOD_FACES = [["😢", -0.8, "very low"], ["🙁", -0.4, "low"], ["😐", 0, "neutral"], ["🙂", 0.4, "content"], ["😊", 0.8, "happy"]];
const moodLogKey = () => `threadline.moodlog.v1.${threadKey}`;
function loadMoodLog() { try { return JSON.parse(localStorage.getItem(moodLogKey()) || "{}") || {}; } catch { return {}; } }
function rebuildMood() {
  const log = loadMoodLog(), keys = Object.keys(log).sort().slice(-30), label = (v) => (MOOD_FACES.reduce((b, f) => Math.abs(f[1] - v) < Math.abs(b[1] - v) ? f : b)[2]);
  const days = keys.map((k) => { const e = log[k], m = e.morning ?? e.evening ?? null, ev = e.evening ?? e.morning ?? null;
    return { date: k, morning: m, evening: ev, morningLabel: m == null ? "not logged" : label(m), eveningLabel: ev == null ? "not logged" : label(ev), agitation: e.agitation ?? 0, repeats: e.repeats ?? 0, by: e.by || "caregiver" }; });
  const weeks = keys.filter((k) => Number.isFinite(log[k].csdd)).map((k) => ({ weekEnding: k, score: log[k].csdd, band: log[k].csdd >= 18 ? "Definite major depression range — talk to the GP soon" : log[k].csdd >= 11 ? "Probable major depression range — talk to the GP" : log[k].csdd >= 6 ? "Mild symptoms — keep watching" : "No significant depressive symptoms" }));
  ownerMood = { days, weeks };
}
const moodForm = { morning: null, evening: null, agitation: null };
function renderWellbeingToday() {
  const box = $("wb-today"); if (!box) return;
  const h = hLatest() || {}, m = moodOf(todayKey()) || {}, e = life.energy, week = ownerMood.days.slice(-7);
  const avg = (f) => { const v = week.map((d) => d[f]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const wk = avg("morning") != null && avg("evening") != null ? (avg("morning") + avg("evening")) / 2 : avg("morning") ?? avg("evening");
  const tile = (label, value, sub, tone = "") => el("article", { className: `wb-tile ${tone}` }, el("small", { textContent: label }), el("b", { textContent: value }), sub ? el("span", { textContent: sub }) : null);
  box.replaceChildren(
    tile("Mood today", m.morningLabel && m.morningLabel !== "not logged" ? `${m.morningLabel} → ${m.eveningLabel}` : "Say how you feel", m.by === "voice" ? "logged by voice" : m.by === "demo seed" ? "demo seed" : "", m.morning != null && m.morning < -0.2 ? "low" : "good"),
    tile("Energy", e ? ({ low: "Low", positive: "Positive", steady: "Steady" }[e.state] || "Steady") : "—", e ? `“${e.word || ""}”` : "tell Threadline", e?.state === "low" ? "low" : ""),
    tile("Agitation tonight", ["none", "mild", "moderate", "severe"][m.agitation ?? 0], `${m.repeats ?? 0} repeated questions`, (m.agitation ?? 0) >= 2 ? "low" : ""),
    tile("Sleep", h.sleep_hours != null ? `${Math.floor(h.sleep_hours)} h ${Math.round((h.sleep_hours % 1) * 60)} m` : "—", "last night · Apple Health", h.sleep_hours != null && h.sleep_hours < 6 ? "low" : "good"),
    tile("Steps", h.steps != null ? Math.round(h.steps).toLocaleString() : "—", "today · Apple Health"),
    tile("7-day mood", wk == null ? "—" : `${wk > 0 ? "+" : ""}${wk.toFixed(2)}`, `${week.length} check-ins`, wk != null && wk < -0.2 ? "low" : "good"));
}
function seedMissingCheckins() {
  if (isFictionalDemo()) return;
  const log = loadMoodLog(); let added = 0;
  for (let i = 1; i <= 30; i++) {
    const k = todayKey(new Date(Date.now() - i * DAY_MS)); if (log[k]) continue;
    const h = hDay(k) || {}, seed = Number(k.replaceAll("-", "")), r = (n) => { const x = Math.sin(seed + n) * 10000; return x - Math.floor(x); };
    const sleep = h.sleep_hours ?? 6.5, steps = h.steps ?? 5000;
    const base = Math.max(-0.8, Math.min(0.8, 0.15 * (sleep - 6.8) + 0.08 * (Math.min(steps, 12000) / 6000 - 1) + (r(1) - 0.5) * 0.5));
    const snap = (v) => [-0.8, -0.4, 0, 0.4, 0.8].reduce((b, f) => Math.abs(f - v) < Math.abs(b - v) ? f : b);
    const agitation = Math.max(0, Math.min(3, Math.round(1 + (sleep < 6 ? 1 : 0) - (steps > 8500 ? 1 : 0) + (r(2) - 0.5))));
    log[k] = { morning: snap(base), evening: snap(base - 0.15 * agitation + (r(3) - 0.5) * 0.3), agitation, repeats: Math.round(2 + agitation * 2 + r(4) * 2), at: `${k}T20:00:00`, by: "demo seed" };
    added += 1;
  }
  if (added) { try { localStorage.setItem(moodLogKey(), JSON.stringify(log)); } catch { /* storage off */ } }
}
function renderMoodForm() {
  const today = loadMoodLog()[todayKey()] || {};
  for (const f of ["morning", "evening"]) { if (moodForm[f] == null) moodForm[f] = today[f] ?? null;
    document.querySelector(`.mc-faces[data-field=${f}]`).replaceChildren(...MOOD_FACES.map(([icon, v, name]) => { const b = el("button", { type: "button", className: `mc-face${moodForm[f] === v ? " on" : ""}`, textContent: icon, title: name, "aria-label": `${f} ${name}` }); b.addEventListener("click", () => { moodForm[f] = v; renderMoodForm(); }); return b; })); }
  if (moodForm.agitation == null) moodForm.agitation = today.agitation ?? null;
  document.querySelector(".mc-agi").replaceChildren(...["none", "mild", "moderate", "severe"].map((n, i) => { const b = el("button", { type: "button", className: `mc-ag${moodForm.agitation === i ? " on" : ""}`, textContent: n }); b.addEventListener("click", () => { moodForm.agitation = i; renderMoodForm(); }); return b; }));
  if (!$("mc-repeats").value && today.repeats != null) $("mc-repeats").value = today.repeats;
  if (!$("mc-csdd").value && today.csdd != null) $("mc-csdd").value = today.csdd;
}
$("mood-checkin")?.addEventListener("submit", (e) => {
  e.preventDefault();
  if (moodForm.morning == null && moodForm.evening == null) return ($("mc-msg").textContent = "Pick at least a morning or evening mood.");
  const log = loadMoodLog(), csdd = $("mc-csdd").value === "" ? null : Math.max(0, Math.min(38, Math.round(Number($("mc-csdd").value))));
  log[todayKey()] = { morning: moodForm.morning, evening: moodForm.evening, agitation: moodForm.agitation ?? 0, repeats: Math.max(0, Math.round(Number($("mc-repeats").value) || 0)), ...(csdd != null ? { csdd } : {}), at: new Date().toISOString(), by: "caregiver" };
  try { localStorage.setItem(moodLogKey(), JSON.stringify(log)); } catch { /* storage off */ }
  rebuildMood(); renderMood(); drawDashboard(); renderDays();
  $("mc-msg").textContent = "Saved. Charts, the Daily log and the Dashboard now include today's check-in.";
  if (typeof logAction === "function") logAction("Caregiver mood check-in saved");
});
function renderMood() {
  if (!$("mood-chart")) return;
  try { if (ownerHealth.days) seedMissingCheckins(); } catch { /* */ }
  rebuildMood(); renderMoodForm();
  if (!ownerMood.days.length) {
    $("mood-today").textContent = "";
    for (const id of ["mood-chart", "mood-weeks"]) { $(id).replaceChildren(); $(id).hidden = true; }
    document.querySelectorAll(".mood-card .mood-legend, .mood-card h3").forEach((n) => { n.hidden = true; }); return;
  }
  for (const id of ["mood-chart", "mood-weeks"]) $(id).hidden = false;
  document.querySelectorAll(".mood-card .mood-legend, .mood-card h3").forEach((n) => { n.hidden = false; });
  $("mood-weeks").hidden = !ownerMood.weeks.length; document.querySelectorAll(".mood-card h3").forEach((n) => { n.hidden = !ownerMood.weeks.length; });
  renderWellbeingToday();
  const days = ownerMood.days, t = days.at(-1), NS = "http://www.w3.org/2000/svg", W = 600, H = 180, x = (i) => days.length < 2 ? W / 2 : 10 + (i / (days.length - 1)) * (W - 20), y = (v) => H / 2 - v * (H / 2 - 14);
  $("mood-today").replaceChildren(...(t ? [["This morning", `${t.morningLabel} · ${moodWord(t.morning)} (${t.morning > 0 ? "+" : ""}${t.morning})`], ["This evening", `${t.eveningLabel} · ${moodWord(t.evening)} (${t.evening > 0 ? "+" : ""}${t.evening})`], ["Evening agitation", `${["none", "mild", "moderate", "severe"][t.agitation]} (NPI-Q ${t.agitation})`], ["Repeated questions", String(t.repeats)]].map(([k, v]) => el("div", {}, el("small", { textContent: k }), el("b", { textContent: v }))) : []));
  const svg = $("mood-chart"), mk = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
  const kids = [mk("line", { x1: 0, x2: W, y1: H / 2, y2: H / 2, class: "zero" })];
  days.forEach((d, i) => { if (d.agitation) kids.push(mk("rect", { x: x(i) - 5, y: H - d.agitation * 14, width: 10, height: d.agitation * 14, class: "ag" })); });
  for (const [f, cls] of [["morning", "am"], ["evening", "pm"]]) kids.push(mk("polyline", { points: days.map((d, i) => d[f] == null ? null : `${x(i)},${y(d[f])}`).filter(Boolean).join(" "), class: cls }));
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
];
function healthOn() { return !isFictionalDemo() && (isDefaultProfile() || !configuredBand); }
function chartHealth() {
  if (isFictionalDemo()) return demoSeed().demoHealth;
  const result = { ...appSeed().demoHealth };
  if (healthOn()) for (const [day, actual] of Object.entries(ownerHealth.byDay)) result[day] = { ...actual, sample: false };
  return result;
}
function hDay(key) { return chartHealth()[key] || null; }
function hLatest() { return healthOn() ? ownerHealth.latest : null; }
async function loadOwnerHealth() {
  try {
    const r = await fetch("/api/health/summary?days=365"); if (!r.ok) return;
    const d = await r.json();
    ownerHealth.byDay = Object.fromEntries((d.daily || []).map((x) => [x.date, x]));
    const keys = Object.keys(ownerHealth.byDay).sort();
    ownerHealth.latest = ownerHealth.byDay[todayKey()] || (keys.length ? ownerHealth.byDay[keys.at(-1)] : null);
    ownerHealth.importedAt = d.imported_at; ownerHealth.days = keys.length;
    try { seedMissingCheckins(); rebuildMood(); } catch { /* */ }
    drawDashboard(); drawGraph();
    renderEnergy(); renderToday(); renderDays(); renderIntegrations();
  } catch { /* offline: screens keep live readings only */ }
}
/* Live watch readings win; the latest Health day fills whatever the watch hasn't sent. */
function sensorsWithHealth() {
  if (isFictionalDemo()) return {};
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
      seedVersion: isFictionalDemo() ? null : appSeed().version,
    }));
  } catch { message("This browser blocked storage, so notes will be lost on refresh.", true); }
}
const capture = { active: false, band: null, ws: null, recorder: null, stream: null, startedAt: null, timer: 0, review: null, finals: [] };
// Paint speech before doing storage, charts or agent work. These share the browser thread.
let liveWorkTimer = 0, liveWork = [];
function flushLiveWork() {
  clearTimeout(liveWorkTimer); liveWorkTimer = 0;
  const pending = liveWork; liveWork = [];
  if (!pending.length) return;
  for (const item of pending) collectUtterance(item.msg, item.at, item.who);
  archiveSession(capture.finals, { startedAt: capture.startedAt, source: capture.source, marks: capture.marks || [], id: capture.archiveId });
  const voice = voiceMetrics(capture.finals); if (voice) life.voice = voice;
  renderEnergy();
  if (location.hash === "#dashboard" || !location.hash) drawDashboard();
}
function queueLiveWork(msg, at, who) {
  liveWork.push({ msg, at, who });
  if (!liveWorkTimer) liveWorkTimer = setTimeout(flushLiveWork, 100);
}
function showLiveDraft(text) {
  if (!text?.trim()) return; // Empty endpoint events must not erase words still being read.
  $("live-interim").textContent = text;
  $("care-band-interim").textContent = text;
  renderHearingCaption(text, false);
  $("care-band-transcript").hidden = false;
}
function clearLiveDraft() { $("live-interim").textContent = ""; $("care-band-interim").textContent = ""; }
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
  $("sample-label").textContent = `Saved conversations and example history · stored in this browser${threadKey.startsWith("band-") ? ` for Vexo-HACK-${threadKey.slice(5).padStart(2, "0")}` : ""}. Select a source to see its context.`;
  $("timeline").replaceChildren();
  for (const note of contextNotes(session.notes)) {
    const time = el("time", { dateTime: note.at, textContent: fmtWhen(note.at) }, el("span", { className: "note-id", textContent: note.id }));
    const badge = el("span", { className: `badge ${note.source}`, textContent: SOURCE_LABELS[note.source] || note.source });
    const text = el("p", { textContent: note.text });
    const li = el("li", { id: `note-${note.id}` }, time, el("div", { className: "meta" }, badge, el("span", { className: "speaker", textContent: note.speaker ? note.speaker : "Speaker: you" })), text);
    if (note.context) li.append(el("p", { className: "context", textContent: note.context.replace(/^Seeded /, "Example · ") }));
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
  if (isFictionalDemo()) items = items.map(item => ({ ...item, source: "fictional", sample: true, context: "Fictional Meera demo · added during demo" }));
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
    el("p", { className: "caption", textContent: offer.decided ? `Decided by ${offer.decided} from your own words and preferences — no inference about your mood or judgment.` : `Matched by your own word “${offer.hit}” using a local rule — no AI, and no inference about your mood or judgment.` }),
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
  const start = (fromUrl && /^\d{1,3}$/.test(fromUrl) && Number(fromUrl) > 0) ? Number(fromUrl) : configuredBand || recentBands()[0];
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
  try { const saved = localStorage.getItem(`threadline.access-mode.band-${number}`); accessMode = ACCESS_MODES[saved] ? saved : "memory"; } catch { accessMode = "memory"; }
  $("pick-number").value = String(number).padStart(2, "0");
  if (remember) rememberBand(number);
  const url = new URL(location.href); url.searchParams.set("band", String(number).padStart(2, "0")); history.replaceState(null, "", url);
  loadThread(`band-${number}`); render(); renderProfile(); setTimeout(() => { resumeWatch(); if (demoWanted()) startDemoFeed(); else stopDemoFeed(); }, 0);
  renderPair(); renderArchive(); renderAccessMode(); bandStatus("");
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
  bandStatus(quiet ? `Reconnecting ${wanted}${kind === "ble" ? " over Bluetooth" : " on the USB cable"}…` : kind === "ble" ? `Pick ${wanted} in the list, then press Pair.` : kind === "serial" ? "Pick “Vexo Open band” in the list, then press Connect." : "Starting the pretend band…");
  let connected = null;
  try {
    await loadKit();
    pair.slow = setTimeout(() => { if (mine === pair.attempt && pair.busy) bandStatus(logic.stillConnectingMessage(kind, wanted)); }, logic.STILL_CONNECTING_MS);
    let transport = kind;
    if (port && kind === "serial") {  // a port this site was already allowed to use: open it directly, no chooser
      const Remembered = class extends kit.WebSerialTransport { async open() { await this._start(port); } };
      transport = new Remembered();
    } else if (port && kind === "ble") {  // a band this site was already allowed to use over Bluetooth: no chooser
      const device = port;
      const RememberedBle = class extends kit.WebBluetoothTransport {
        async open() {
          this.device = device;
          device.addEventListener("gattserverdisconnected", () => {
            if (device.gatt?.connected) return;
            const wasUp = this._rx !== null; this._rx = null;
            if (wasUp) this.onClose(this._closing ? "closed" : "lost");
          });
          await this._connect();
        }
      };
      transport = new RememberedBle(bandNumber);
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
  const gestures = createTapGesture(kind => {
    if (band.transportKind === "sim") return;
    if (kind === "sos") { emergency.trigger({ reason: "SOS from the band", note: "Three taps on the band." }); return requestAssistance("Three taps on the band"); }
    if (accessMode === "sight") {
      const ws = care.ws?.readyState === 1 ? care.ws : lh.ws;
      if (ws?.readyState === 1) ws.send(JSON.stringify({ type: "text", text: accessInfo().question }));
      else { location.hash = "care"; careLiveStatus("Allow live guidance, then double-tap to ask about the scene."); }
      return;
    }
    // Double-tap = "talk to Threadline": keep the band listening and send the next sentence to the assistant.
    if (!capture.active && !busy) { autoRec.userStopped = false; $("rec-start").click(); }
    assistant?.openWindow();
  });
  band.on("tap", () => gestures.push("single"));
  band.on("double-tap", () => gestures.push("double"));
  band.on("disconnect", () => gestures.clear());
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
  if (isFictionalDemo()) return recState("Exit fictional history before recording real speech.", true);
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
    realtimeBandPush?.(samples);  // Talk to Threadline (OpenAI Realtime) hears the band's decoded 16 kHz audio
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
  $("live").hidden = false; $("live-lines").replaceChildren(); $("care-band-lines").replaceChildren(); clearLiveDraft(); $("care-band-transcript").hidden = false; capture.sourceLabel = (vexo ? `${capture.band.name} · ${({ serial: "USB", ble: "Bluetooth", sim: "pretend" })[capture.band.transportKind] || ""}` : SOURCE_LABELS_LIVE[source]) + (camera ? " + camera" : "");
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
      if (msg.transcript?.trim()) capture.lastTextAt = Date.now();
      if (!msg.is_final && msg.transcript?.trim()) capture.interimCount += 1;
      if (msg.is_final) {
        if (msg.transcript.trim()) {
          const shift = ws.offset || 0;
          const final = { ...msg, start: msg.start + shift, words: msg.words.map((w) => ({ ...w, start: (w.start || 0) + shift, end: (w.end || 0) + shift })) };
          final.activity = signals.activity;
          if (watch.sensors?.heart_rate != null && Date.now() - watch.sensorsAt < 10000) final.hr = Math.round(watch.sensors.heart_rate);
          capture.finals.push(final); addLiveLine(final);
        }
      } else showLiveDraft(msg.transcript);
    } else if (msg.type === "utterance_end") { flushLiveWork(); flushUtterance(); }
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
  try { assistant?.feedBand(msg.transcript || ""); } catch { /* assistant not ready */ }
  msg.id ||= newId("line");
  const speakers = [...new Set(msg.words.map((w) => w.speaker).filter((x) => x != null))];
  const who = speakers.length ? speakers[0] : null;
  const at = new Date(capture.startedAt.getTime() + msg.start * 1000);
  clearLiveDraft();
  renderHearingCaption(msg.transcript, true, who);
  if (/\b(help me|i need help|i fell|cannot get up|can.t get up)\b/i.test(msg.transcript)) requestAssistance("Help requested in the transcript");
  $("live-lines").append(el("li", { className: `line spk-${who ?? "x"}` },
    el("span", { className: "avatar", "aria-hidden": "true", textContent: who ?? "?" }),
    el("div", {},
      el("div", { className: "line-meta" }, el("b", { textContent: who == null ? "Speaker ?" : `Speaker ${who}` }),
        el("span", { textContent: ` · ${at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}${msg.activity ? ` · ${msg.activity}` : ""}${msg.hr ? ` · ♥ ${msg.hr}` : ""}` })),
      el("p", { textContent: msg.transcript }))));
  const mirror = el("li", {}, el("span", { className: "caption", textContent: `${who == null ? "Speaker ?" : `Speaker ${who}`} · ${at.toLocaleTimeString()}` }), el("p", { textContent: msg.transcript }));
  $("care-band-lines").append(mirror); $("care-band-transcript").hidden = false;
  for (const id of ["live-lines", "care-band-lines"]) { const box = $(id); while (box.children.length > 200) box.firstChild.remove(); box.scrollTop = box.scrollHeight; }
  queueLiveWork(msg, at, who);
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
  flushLiveWork(); flushUtterance();
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
  if (!processingConsent()) throw new Error("Allow recording and processing on Your band before sending notes or audio.");
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
  event.preventDefault(); const question = $("question").value.trim(), notes = contextNotes();
  if (busy || !question) return;
  if (!notes.length) return message("Add a note before asking a question.", true);
  if (!service.reflection || !processingConsent()) {
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
  renderTimeline(); renderPrefs(); renderSupport(); renderCalendar(); setRecUI(); renderArchive(); renderDays(); renderEnergy(); renderTasks(); renderIntegrations(); renderToday(); renderSampleBanner(); drawDashboard();
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
const archiveKey = () => `threadline.transcripts.v1.${threadKey || realThreadKey()}`;
function loadArchive() { try { return JSON.parse(localStorage.getItem(archiveKey()) || "[]"); } catch { return []; } }
function saveArchive(list) { try { localStorage.setItem(archiveKey(), JSON.stringify(list.slice(0, 50))); return true; } catch { return false; } }
function transcriptProviders(lines) { return [...new Set(lines.map(l => ["fictional", "seeded"].includes(l.provider) ? "Example dialogue" : l.provider === "gemini" ? "Gemini recovery" : "Deepgram"))].join(" + "); }
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
  $("archive-caption").textContent = `Saved conversations${bandNumber ? ` for ${bandLabel()}` : ""} · examples retain their source. Stored in this browser.`;
  const shown = q ? list.filter((e) => e.lines.some((l) => l.text.toLowerCase().includes(q))) : list;
  box.replaceChildren();
  if (!shown.length) { box.append(el("li", { className: "empty", textContent: q ? "No session mentions that." : "No transcripts yet. Start a live capture." })); $("archive-detail").replaceChildren(el("p", { className: "caption", textContent: list.length ? "Choose a session to read its transcript." : "Transcripts appear here after a live session." })); return; }
  if (!shown.some((e) => e.id === archiveSel)) archiveSel = shown[0].id;
  for (const entry of shown) {
    const mins = Math.max(1, Math.round((new Date(entry.endedAt) - new Date(entry.startedAt)) / 60000));
    const a = el("button", { type: "button", className: `session${entry.id === archiveSel ? " current" : ""}`, "aria-pressed": String(entry.id === archiveSel) },
      el("span", { className: "s-top" }, el("b", { textContent: new Date(entry.startedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) }), entry.marks ? el("span", { className: "s-star", textContent: `★ ${entry.marks}` }) : null),
      el("span", { className: "caption", textContent: `${entry.sample ? "Example · " : ""}${entry.title || entry.device} · ${mins} min · ${entry.lines.length} lines` }));
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
  review.hidden = Boolean(entry.sample);
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
function graphEngine() { return service.reflection && processingConsent() ? "gemini" : "local"; }
function scheduleGraph(delay = 8000) {
  $("graph-panel").hidden = false;
  if (graph.timer && delay) return;
  clearTimeout(graph.timer); graph.timer = setTimeout(() => { graph.timer = 0; buildGraph(); }, delay);
}
async function buildGraph() {
  const notes = contextNotes(sessions.reflection.notes).slice(-60).map(({ id, text, at, source, context, speaker }) => ({ id, text, at, source, context, speaker: speaker || "me", device: source === "vexo" && bandNumber ? bandLabel() : "" }));
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
let memGraph = null;
const NAME_STOP = new Set("I Im Ill Ive Dad Mum Mom Yes No Okay Ok Oh Good The That This She He It Its Has Did Where What When Who Why How Is Are Was Can Could Should Would Will Do Does Monday Tuesday Wednesday Thursday Friday Saturday Sunday Today Tomorrow Right Then And But So We You They My Our Your There Here Hello Hi Thanks Thank Please".split(" "));
function namesIn(text) {
  const out = new Set();
  for (const sent of String(text || "").split(/[.?!·,]\s*/)) sent.split(/\s+/).forEach((w, i) => { const m = w.replace(/[^A-Za-z']/g, "").replace(/'s$/, ""); if (/^[A-Z][a-z]{2,}$/.test(m) && !NAME_STOP.has(m) && !/^(GP|Morning|Video|Refill|Walk|Pharmacy|Water|Physio|Eye|Call|Lunch|Charge|Check|Put|Grocery|Short|Dentist|Fix|Memory|Sunday|Install|Hearing|Show|Open|Take|Remind|Give|Add|Tell|Order|Buy|Logged|Energy|Said|Too|After|Before|Also|Then|Just|Maybe|Still|Very|Really|Well|Yeah|Hey|Hello|Thanks|Sorry|Please|Today|Tonight|Morning|Evening|Afternoon|Yesterday|Tomorrow|English|French|Nepali|Spanish|Threadline|Gemini|Vexo|Apple|Watch)$/.test(m) && (i > 0 || /with|call|visit|from|to/i.test(sent))) out.add(m); });
  return [...out];
}
function memoryData() {
  const N = new Map(), E = [], seen = new Set();
  const add = (id, label, type, weight = 1, extra = {}) => { if (!N.has(id)) N.set(id, { id, label, type, weight, ...extra }); else N.get(id).weight += weight; return id; };
  const link = (a, b) => { if (!a || !b || a === b) return; const k = a < b ? a + "|" + b : b + "|" + a; if (!seen.has(k)) { seen.add(k); E.push({ source: a, target: b }); } };
  const self = add("self", "Your memory", "self", 8), gd = graph.data;
  if (gd) { for (const n of gd.nodes) add(n.id, n.label, TYPE_STYLE[n.type] ? n.type : "topic", n.weight || 1, { sources: n.sources }); for (const e of gd.edges) link(e.source, e.target);
    for (const n of gd.nodes) if (n.weight >= 2 || ["person", "place"].includes(n.type)) link(self, n.id); }
  for (const note of contextNotes(sessions.reflection.notes).slice(-80)) {
    const id = add(`note:${note.id}`, note.text, "note", 1, { note });
    if (note.sample && note.speaker) { const p = add(`example-person:${note.speaker}`, note.speaker, "person", 2); link(id, p); }
    const refs = gd ? gd.nodes.filter((n) => n.sources?.includes(note.id)) : []; refs.forEach((r) => link(id, r.id)); if (!refs.length) link(id, self);
    for (const nm of namesIn(note.text)) { const pid = add(`person:${nm.toLowerCase()}`, nm, "person", 1); link(id, pid); link(pid, self); }
  }
  for (const t of (life.tasks || []).slice(-60)) {  // people and places from the care plan
    for (const nm of namesIn(t.title)) { const pid = add(`person:${nm.toLowerCase()}`, nm, "person", 1); link(pid, self); const tid = add(`event:task-${t.id}`, t.title, "event", 1); link(tid, pid); }
    const place = (t.title.match(/\b(park|pharmacy|bank|dentist|optician|community centre|garden|hallway|kitchen|GP)\b/i) || [])[0];
    if (place) { const plid = add(`place:${place.toLowerCase()}`, place[0].toUpperCase() + place.slice(1), "place", 1); link(plid, self); }
  }
  for (const t of loadArchive().filter(t => !t.sample || t.exampleMode === accessMode).slice(0, 20)) {
    const cid = add(`conv:${t.id}`, `Conversation · ${new Date(t.startedAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}`, "conversation", 1, { conv: t }); link(cid, self);
    const names = new Set();
    for (const l of t.lines) for (const sent of l.text.split(/[.?!]\s+/)) sent.split(/\s+/).slice(1).forEach((w) => { const m = w.replace(/[^A-Za-z']/g, "").replace(/'s$/, ""); if (/^[A-Z][a-z]{2,}$/.test(m) && !NAME_STOP.has(m)) names.add(m); });
    for (const nm of names) { const pid = add(`person:${nm.toLowerCase()}`, nm, "person", 1); link(cid, pid); link(pid, self); }
    for (const l of t.lines) { const tl = l.text.toLowerCase(); for (const [w, type] of [["bank", "place"], ["park", "place"], ["kitchen", "place"], ["garden", "place"], ["shop", "place"], ["glasses", "object"], ["tablets", "object"], ["mug", "object"], ["phone", "object"], ["kettle", "object"], ["soup", "object"], ["walk", "event"], ["visit", "event"], ["lunch", "event"], ["breakfast", "event"]]) if (tl.includes(w)) { const oid = add(`${type}:${w}`, w[0].toUpperCase() + w.slice(1), type, 1); link(cid, oid); } }
  }
  try { for (const r of careRoutine()) link(add(`routine:${r}`, r, "routine", 1), self); } catch { /* not ready */ }
  const hl = hLatest();
  if (hl) { const hub = add("health:hub", "Health today", "health", 4); link(hub, self);
    for (const [k, lab] of [["sleep_hours", `Sleep ${hl.sleep_hours != null ? hm(hl.sleep_hours) : ""}`], ["steps", `Steps ${hl.steps != null ? r0(hl.steps) : ""}`], ["resting_heart_rate", `Resting HR ${hl.resting_heart_rate != null ? r0(hl.resting_heart_rate) : ""}`], ["hrv_sdnn", `HRV ${hl.hrv_sdnn != null ? r0(hl.hrv_sdnn) + " ms" : ""}`], ["oxygen_saturation", `SpO₂ ${hl.oxygen_saturation != null ? r0(hl.oxygen_saturation) + "%" : ""}`], ["walking_steadiness", `Steadiness ${hl.walking_steadiness != null ? r0(hl.walking_steadiness) + "%" : ""}`]])
      if (hl[k] != null) link(add(`health:${k}`, lab, "health", 2), hub); }
  const md = ownerMood.days.at(-1);
  if (md) { const m = add("feeling:mood", `Mood ${md.morningLabel} → ${md.eveningLabel}`, "feeling", 3); link(m, self); link(m, "health:sleep_hours");
    if (md.agitation >= 1) { const a = add("feeling:agitation", `Evening agitation: ${["none", "mild", "moderate", "severe"][md.agitation]}`, "feeling", 2); link(a, m); link(a, "health:steps"); }
    const w = ownerMood.weeks.at(-1); if (w) link(add("health:csdd", `Weekly CSDD ${w.score}`, "health", 2), m); }
  return { nodes: [...N.values()], edges: E.filter((e) => N.has(e.source) && N.has(e.target)) };
}
/* What Threadline remembers: the graph's facts as readable cards. */
function renderMemoryInsights(data) {
  const box = $("memory-insights"); if (!box || !data) return;
  const deg = {}; for (const e of data.edges) { deg[e.source] = (deg[e.source] || 0) + 1; deg[e.target] = (deg[e.target] || 0) + 1; }
  const byType = (t) => data.nodes.filter((n) => n.type === t).sort((a, b) => (deg[b.id] || 0) - (deg[a.id] || 0) || (b.weight || 0) - (a.weight || 0));
  const notes = [...sessions.reflection.notes, ...sessions.routine.notes].filter((n) => n.text).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const lastMention = (word) => notes.find((n) => n.text.toLowerCase().includes(String(word).toLowerCase()));
  const when = (at) => { const d = new Date(at); return Number.isNaN(d) ? "" : d.toLocaleDateString([], { month: "short", day: "numeric" }) + " · " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); };
  const people = byType("person").slice(0, 6), places = byType("place").slice(0, 5), things = byType("object").slice(0, 6), topics = [...byType("topic"), ...byType("event")].slice(0, 10);
  const where = [...things.map((t) => ({ name: t.label, note: lastMention(t.label) })), ...notes.filter((n) => /\b(glasses|keys|phone|wallet|tablets|pills|hearing aid|remote)\b.*\b(in|on|by|next to|under)\b/i.test(n.text)).slice(0, 4).map((n) => ({ name: (n.text.match(/\b(glasses|keys|phone|wallet|tablets|pills|hearing aid|remote)\b/i) || ["Item"])[0], note: n }))]
    .filter((x, i, a) => x.note && a.findIndex((y) => y.name.toLowerCase() === x.name.toLowerCase()) === i).slice(0, 5);
  const cmd = /^(please\s+)?(show|open|go|take me|navigate|start|stop|check out|order|buy|remind|add|put|play|switch|turn|scroll|close|cancel|yes|no|okay|ok)\b/i;
  const recent = notes.filter((n) => (n.source === "voice" || n.source === "vexo" || n.source === "typed" || !n.sample) && !cmd.test(n.text)).slice(0, 6);
  const go = (id) => () => { memGraph?.select?.(id); $("memory-graph")?.scrollIntoView({ behavior: "smooth", block: "center" }); };
  const card = (title, icon, body) => el("article", { className: "mi-card" }, el("h3", {}, el("span", { className: "mi-ic", textContent: icon }), title), body);
  const stat = (n, label) => el("div", { className: "mi-stat" }, el("b", { textContent: String(n) }), el("span", { textContent: label }));
  box.replaceChildren(
    el("div", { className: "mi-stats" }, stat(notes.length, "memories saved"), stat(byType("person").length, "people"), stat(byType("place").length, "places"), stat(byType("object").length, "things"),
      stat(loadArchive().length, "conversations"), stat(notes.filter((n) => n.source === "voice").length, "said to Threadline")),
    el("div", { className: "mi-grid" },
      card("Who matters", "👪", people.length ? el("ul", { className: "mi-people" }, ...people.map((p) => { const m = lastMention(p.label);
        return el("li", {}, el("button", { type: "button", className: "mi-chip", textContent: p.label, onclick: go(p.id) }), el("small", { textContent: `${deg[p.id] || 0} links${m ? ` · last ${when(m.at)}` : ""}` })); })) : el("p", { className: "caption", textContent: "Names mentioned in conversations appear here." })),
      card("Where things are", "📍", where.length ? el("ul", { className: "mi-where" }, ...where.map((w) => el("li", {}, el("b", { textContent: w.name }), el("span", { textContent: `“${w.note.text.slice(0, 110)}”` }), el("small", { textContent: when(w.note.at) })))) : el("p", { className: "caption", textContent: "Say “my glasses are on the kitchen table” and Threadline remembers it." })),
      card("Recent memories", "🧠", recent.length ? el("ol", { className: "mi-recent" }, ...recent.map((n) => el("li", {}, el("time", { textContent: when(n.at) }), el("span", { textContent: n.text.slice(0, 140) }), el("small", { textContent: n.context || n.source || "" })))) : el("p", { className: "caption", textContent: "Nothing saved yet." })),
      card("What keeps coming up", "💬", el("div", { className: "mi-topics" }, ...topics.map((t) => el("button", { type: "button", className: "mi-chip", textContent: t.label, onclick: go(t.id) })), ...places.map((pl) => el("button", { type: "button", className: "mi-chip place", textContent: `📍 ${pl.label}`, onclick: go(pl.id) }))))));
}
function drawGraph() {
  const host = $("memory-graph"); if (!host) return;
  if (!memGraph) memGraph = mountMemoryGraph(host, { onSelect: showMemoryNode, hide: ["note"] });
  let data = null;
  try { data = memoryData(); memGraph.update(data); } catch (e) { $("graph-status").textContent = `Graph not drawn: ${e.message}`; }
  try { renderMemoryInsights(data); } catch { /* insights are optional */ }
}
function showMemoryNode(n, near = [], expand, depth = 1) {
  const box = $("graph-detail");
  if (!n) { box.replaceChildren(el("p", { className: "caption", textContent: "Drag to move, scroll to zoom, click a node to focus its memories." })); return; }
  const chip = (m) => { const b = el("button", { type: "button", className: "mg-near", textContent: m.label.length > 40 ? m.label.slice(0, 39) + "…" : m.label }); b.prepend(el("i", { className: `mg-dot t-${m.type}` })); b.addEventListener("click", () => memGraph.select(m.id)); return b; };
  const notes = sessions.reflection.notes, body = [];
  if (n.note) body.push(el("blockquote", { className: "mg-quote", textContent: n.note.text }), el("p", { className: "caption", textContent: `${fmtDate(n.note.at)} · ${SOURCE_LABELS[n.note.source] || n.note.source}` }));
  if (n.conv) body.push(el("ul", { className: "mg-lines" }, ...n.conv.lines.slice(0, 12).map((l) => el("li", {}, el("b", { textContent: `S${l.speakers?.[0] ?? "?"}` }), ` ${l.text}`))));
  if (n.sources) body.push(el("ul", { className: "why" }, ...n.sources.map((id) => notes.find((x) => x.id === id)).filter(Boolean).slice(0, 8).map((x) => el("li", {}, `“${x.text}” `, el("span", { className: "caption", textContent: fmtDate(x.at) })))));
  const more = el("button", { type: "button", className: "secondary", textContent: depth >= 3 ? "Showing 3 hops" : `Expand to ${depth + 1} hops` }); more.disabled = depth >= 3; more.addEventListener("click", () => expand?.());
  box.replaceChildren(el("p", { className: "eyebrow", textContent: `${(TYPE_STYLE[n.type]?.label || n.type).replace(/s$/, "")} · ${near.length} connected` }), el("h3", { textContent: n.label }), ...body,
    el("div", { className: "mg-near-list" }, ...near.filter(Boolean).slice(0, 40).map(chip)), more,
    el("p", { className: "caption", textContent: "Links mean things came up together in the same memory or conversation — not a cause or a diagnosis." }));
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
        renderHearingCaption(msg.transcript, true, msg.words?.[0]?.speaker);
        const speakers = [...new Set(msg.words.map((w) => w.speaker).filter((s) => s != null))];
        $("live-lines").append(el("li", {}, el("span", { className: "caption", textContent: `${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })} · ${watch.device} · ${speakers.length ? speakers.map((s) => `Speaker ${s}`).join(", ") : "Speaker ?"}` }), el("p", { textContent: msg.transcript })));
        { const box = $("live-lines"); box.scrollTop = box.scrollHeight; }
        $("live-interim").textContent = "";
      } else if (!msg.is_final) showLiveDraft(msg.transcript);
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


/* ---------- Daily log: saved words and measurements ---------- */
const DAY_MS = 86400000;
const parseDay = (s) => new Date(`${s}T12:00:00`);
function renderDays() {
  if (!$("days-body")) return;
  try { rebuildMood(); } catch { /* not ready */ }
  $("days-panel").hidden = false;
  $("energy-words").value = life.energyWords;
  const rows = [];
  // Columns come from the data: every metric found in the Health history gets its own column automatically.
  const DAYS = 30, keys = [...Array(DAYS)].map((_, i) => todayKey(new Date(Date.now() - i * DAY_MS)));
  const present = new Set(); for (const k of keys) for (const m of Object.keys(hDay(k) || {})) if (!["menstrual_flow", "cycle", "period_starts", "sample", "seeded", "source", "provenance"].includes(m)) present.add(m);
  const cols = HEALTH_COLS.filter(([m]) => present.has(m));
  for (const m of present) if (!["date", "workout_types", "workout_count", "sample", "seeded", "source", "provenance"].includes(m) && !HEALTH_COLS.some(([x]) => x === m)) cols.push([m, m.replace(/_/g, " "), (v) => (Math.round(v * 10) / 10).toLocaleString()]);
  // Direction: +1 higher is better, -1 lower is better, 0 neutral. Groups give the table its section headers.
  const DIR = { steps: 1, distance_km: 1, active_energy_kcal: 1, exercise_min: 1, flights_climbed: 1, stand_hours: 1, stand_min: 1, sleep_hours: 1, hrv_sdnn: 1, walking_steadiness: 1, walking_speed_kmh: 1, mindful_min: 1, oxygen_saturation: 1, resting_heart_rate: -1, audio_exposure_db: -1, heart_rate: 0, respiratory_rate: 0, wrist_temp_c: 0, workouts: 1, mood: 1 };
  const GROUP = { sleep_hours: "Sleep", resting_heart_rate: "Heart", heart_rate: "Heart", hrv_sdnn: "Heart", oxygen_saturation: "Breathing", respiratory_rate: "Breathing", wrist_temp_c: "Breathing",
    steps: "Activity", distance_km: "Activity", active_energy_kcal: "Activity", exercise_min: "Activity", flights_climbed: "Activity", stand_hours: "Activity", stand_min: "Activity", workouts: "Activity",
    walking_speed_kmh: "Mobility", walking_steadiness: "Mobility", audio_exposure_db: "Environment", mindful_min: "Mind", mood: "Mind", menstrual_flow: "Other" };
  const ORDER = ["Sleep", "Heart", "Breathing", "Activity", "Mobility", "Mind", "Environment", "Other"];
  cols.sort((a, b) => ORDER.indexOf(GROUP[a[0]] || "Other") - ORDER.indexOf(GROUP[b[0]] || "Other"));
  const stats = Object.fromEntries(cols.map(([m]) => { const v = keys.map((k) => hDay(k)?.[m]).filter((x) => typeof x === "number"); const mean = v.reduce((a, b) => a + b, 0) / (v.length || 1);
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length || 1)) || 1; return [m, { mean, sd, min: Math.min(...v), max: Math.max(...v), n: v.length, series: keys.slice().reverse().map((k) => hDay(k)?.[m] ?? null) }]; }));
  const tone = (m, v) => { const st = stats[m], d = DIR[m] ?? 0; if (v == null || !st || !d || st.n < 5) return ""; const z = ((v - st.mean) / st.sd) * d; return z > 0.8 ? "t-great" : z > 0.25 ? "t-good" : z < -0.8 ? "t-low" : z < -0.25 ? "t-watch" : "t-mid"; };
  const archiveDays = loadArchive().reduce((days, a) => { (days[todayKey(new Date(a.startedAt))] ||= []).push(a); return days; }, {});
  const hasConv = keys.some((k) => archiveDays[k]?.length || life.days[k]?.others || life.days[k]?.mine), hasMood = keys.some((k) => moodOf(k));
  // Summary cards: the headline metrics with a 30-day sparkline.
  const sparkSvg = (series) => { const v = series.map((x) => x ?? null), real = v.filter((x) => x != null); const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("viewBox", "0 0 100 30"); svg.setAttribute("preserveAspectRatio", "none"); svg.setAttribute("class", "dl-spark");
    if (real.length > 1) { const lo = Math.min(...real), hi = Math.max(...real), sp = hi - lo || 1; const pl = document.createElementNS("http://www.w3.org/2000/svg", "polyline"); pl.setAttribute("points", v.map((d, i) => d == null ? null : `${(i / (v.length - 1)) * 100},${28 - ((d - lo) / sp) * 26}`).filter(Boolean).join(" ")); svg.append(pl); } return svg; };
  const headline = ["sleep_hours", "steps", "resting_heart_rate", "hrv_sdnn", "oxygen_saturation", "walking_steadiness", "exercise_min", "active_energy_kcal"].filter((m) => stats[m]?.n);
  const summary = $("days-summary");
  if (summary) summary.replaceChildren(...headline.map((m) => { const c = cols.find((x) => x[0] === m), st = stats[m], today = hDay(keys[0])?.[m];
    return el("article", { className: `dl-card ${tone(m, today)}` }, el("small", { textContent: c[1] }), el("b", { textContent: today != null ? c[2](today, hDay(keys[0])) : "—" }),
      el("span", { className: "dl-avg", textContent: `${Object.values(chartHealth()).some(d => d.sample) ? "Includes examples · " : ""}30-day avg ${c[2](st.mean, {})} · ${c[2](st.min, {})}–${c[2](st.max, {})}` }), sparkSvg(st.series)); }));
  const groups = []; for (const c of cols) { const g = GROUP[c[0]] || "Other"; if (groups.at(-1)?.g === g) groups.at(-1).n += 1; else groups.push({ g, n: 1 }); }
  const lead = 1 + (hasConv ? 1 : 0) + (hasMood ? 3 : 0);
  $("days-head").replaceChildren(
    el("tr", { className: "dl-groups" }, el("th", { colSpan: lead, textContent: "" }), ...groups.map((x) => el("th", { colSpan: x.n, className: `g-${x.g.toLowerCase()}`, textContent: x.g })), present.has("workout_types") ? el("th", { textContent: "" }) : null),
    el("tr", {}, el("th", { scope: "col", textContent: "Day" }), hasConv ? el("th", { scope: "col", textContent: "Conversation" }) : null,
      ...(hasMood ? ["Mood AM / PM", "Agitation", "Repeats"].map((x) => el("th", { scope: "col", textContent: x })) : []),
      ...cols.map(([, label]) => el("th", { scope: "col", textContent: label })), present.has("workout_types") ? el("th", { scope: "col", textContent: "Workout types" }) : null));
  let filled = 0;
  for (const [i, key] of keys.entries()) {
    const r = life.days[key], h = hDay(key) || {};
    if (Object.keys(h).length > 1) filled += 1;
    const d = parseDay(key), label = i === 0 ? "Today" : i === 1 ? "Yesterday" : d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
    const fmt = (m, f) => { if (m === "steps" && r?.watchSteps != null) return `${r.watchSteps.toLocaleString()}`; if (m === "heart_rate" && r?.hrN) return `${Math.round(r.hrSum / r.hrN)}`; const v = h[m]; return v == null ? "—" : f(v, h); };
    const weekend = [0, 6].includes(d.getDay());
    rows.push(el("tr", { className: `${i === 0 ? "dl-today" : ""}${weekend ? " dl-weekend" : ""}` }, el("th", { scope: "row", textContent: label }),
      hasConv ? el("td", { textContent: archiveDays[key]?.length ? `${archiveDays[key].reduce((n, a) => n + a.lines.length, 0)} lines${archiveDays[key].every(a => a.sample) ? " · Example" : ""}` : r && (r.others || r.mine) ? `${(r.others || 0) + (r.mine || 0)} lines` : "—" }) : null,
      ...(hasMood ? [el("td", { textContent: moodOf(key) ? `${moodOf(key).morningLabel} / ${moodOf(key).eveningLabel}` : "—" }), el("td", { textContent: moodOf(key) ? ["none", "mild", "moderate", "severe"][moodOf(key).agitation] : "—" }), el("td", { textContent: moodOf(key) ? String(moodOf(key).repeats) : "—" })] : []),
      ...cols.map(([m, , f]) => el("td", { className: tone(m, h[m]), textContent: fmt(m, f), title: h.sample ? "Example value — not a device reading" : "Recorded Health value" })),
      present.has("workout_types") ? el("td", { className: "dl-wrap", textContent: h.workout_types ? Object.entries(h.workout_types).map(([k, v]) => `${k.replace(/([a-z])([A-Z])/g, "$1 $2")} ${Math.round(v)}m`).join(", ") : "—" }) : null));
  }
  $("days-status").textContent = `${filled}/${DAYS} days · ${cols.length} metrics${Object.values(chartHealth()).some(d => d.sample) ? " · includes example values" : ""}${ownerHealth.days ? ` · ${ownerHealth.days} days of Health history` : ""}`;
  $("days-body").replaceChildren(...rows);
  if ($("days-actions")) {
    const byDay = {};
    for (const a of life.actions || []) (byDay[todayKey(new Date(a.at))] ||= []).push(a);
    const mlog = loadMoodLog();
    for (const [d, e] of Object.entries(mlog)) (byDay[d] ||= []).push({ at: e.at || `${d}T20:00:00`, text: `Check-in${e.by === "voice" ? " by voice" : e.by === "demo seed" ? " (demo seed)" : ""}: ${[e.morning != null ? `morning ${moodWord(e.morning)}` : "", e.evening != null ? `evening ${moodWord(e.evening)}` : "", e.agitation != null ? `agitation ${["none", "mild", "moderate", "severe"][e.agitation]}` : "", e.repeats ? `${e.repeats} repeated questions` : ""].filter(Boolean).join(" · ")}` });
    const daysSorted = Object.keys(byDay).sort().reverse().slice(0, 14);
    $("days-actions").replaceChildren(...(daysSorted.length ? daysSorted.map((d) => el("details", { className: "dl-day", open: d === todayKey() },
      el("summary", {}, el("b", { textContent: d === todayKey() ? "Today" : parseDay(d).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) }), el("span", { className: "caption", textContent: ` · ${byDay[d].length} entries` })),
      el("ol", {}, ...byDay[d].sort((p, q) => String(q.at).localeCompare(String(p.at))).map((a) => el("li", {}, el("time", { textContent: new Date(a.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) }), el("span", { textContent: a.text })))))) : [el("p", { className: "caption", textContent: "Every action Threadline takes and every check-in appears here, day by day." })]));
  }
  saveThread();
}
function sendHaptic(kind, reason) {
  if (watch.ws?.readyState !== 1) return false;
  watch.ws.send(JSON.stringify({ type: "haptic", kind, reason })); return true;
}
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
  const notes = contextNotes(sessions.reflection.notes).filter((n) => todayKey(new Date(n.at)) === key).slice(-30).map(({ id, text, at, source, context }) => ({ id, text, at, source, context }));
  const outputs = [$("today-summary-out"), $("day-summary-out")];
  const signature = JSON.stringify(notes), scope = workspaceVersion;
  if (!notes.length) { for (const out of outputs) { out.hidden = false; out.replaceChildren(el("p", { className: "caption", textContent: "Your summary will update automatically as your words are saved." })); } daySummary.signature = signature; return; }
  if (signature === daySummary.signature && scope === daySummary.scope) return;
  if (!service.reflection || !processingConsent()) return;
  const readings = [r?.energy.length ? `${r.energy.length} low-energy words` : "", r?.others ? `${r.others} lines from other people in reviewed conversations` : "",
    r?.watchSteps != null ? `${r.watchSteps} steps on the watch` : "", r?.hrN ? `average heart rate ${Math.round(r.hrSum / r.hrN)}` : ""].filter(Boolean).join("; ");
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
const VIEW_TITLES = { essentials: "Essentials", library: "Library", dashboard: "Dashboard", today: "Your day", transcripts: "Transcripts", live: "Your band", energy: "Wellbeing", tasks: "Plan with your energy", thread: "Thread", days: "Daily log", graph: "Memory", devices: "Your band", integrations: "Integrations", care: "Care" };
function placeAssistant(name) {  // the same live panel: inline on the Dashboard, a floating drawer everywhere else
  const panel = $("assistant"), dock = $("assistant-dock"), home = $("assistant-home");
  if (!panel || !dock || !home) return;
  if (name === "dashboard" || name === "") { if (panel.parentElement !== home) home.append(panel); dock.hidden = true; document.body.classList.remove("as-open"); }
  else { const drawer = $("assistant-drawer"); if (panel.parentElement !== drawer) drawer.append(panel); dock.hidden = false; }
}
function showView(name) {
  try { placeAssistant(name); } catch { /* not ready */ }
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
  if (name === "dashboard") drawDashboard();
  if (name === "energy") renderEnergy(); if (name === "integrations") renderIntegrations(); if (name === "tasks") renderTasks();
}
window.addEventListener("hashchange", () => showView(location.hash.slice(1)));
// chips and inner links (#pair, #watch-pair) lead to Devices
document.addEventListener("click", (e) => { const a = e.target.closest("a[href='#pair'], a[href='#watch-pair']"); if (a) { e.preventDefault(); location.hash = "live"; } });
// first view is shown at the end of the script, after every view's code has loaded

/* Recorder waveform from the band's loudness */
const WAVE_BARS = 48, waveLevels = new Array(WAVE_BARS).fill(0);
$("wave").replaceChildren(...waveLevels.map(() => el("span")));
let waveFrame = 0;
function pushWave(level) {
  waveLevels.shift(); waveLevels.push(level);
  if (waveFrame) return;
  waveFrame = requestAnimationFrame(() => {
    waveFrame = 0;
    [...$("wave").children].forEach((b, i) => { b.style.height = `${4 + Math.round(waveLevels[i] * 40)}px`; });
  });
}


/* ---------- Agent: Gemini Decisions API chooses what would help; rules are enforced on the server ---------- */
function agentEngine() { return service.reflection && processingConsent() ? "gemini" : "local"; }
function agentPayload(statement) {
  if (isFictionalDemo()) return {
    statement, recent: sessions.reflection.notes.filter(n => n.id !== statement.id).slice(-20).map(({ id, text, at }) => ({ id, text, at })),
    preferences: [], today: {}, tasks: [], voice: {}, devices: { band: false, watch: false }, engine: agentEngine(),
  };
  const r = life.days[todayKey()];
  return {
    statement,
    recent: contextNotes(sessions.reflection.notes).filter((n) => n.id !== statement.id).slice(-20).map(({ id, text, at, source, context, speaker }) => ({ id, text: source === "seeded" ? `[Example ${speaker || "conversation"}] ${text}` : text, at })),
    preferences: sessions.reflection.prefs.slice(-20).map(({ id, text, triggers, action }) => ({ id, text, triggers, action })),
    today: { low_energy_words: r?.energy.length || 0, lines_from_others: r?.others || 0, steps: r?.watchSteps ?? (r?.bandSteps || null), heart_rate_avg: r?.hrN ? Math.round(r.hrSum / r.hrN) : null,
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
  const save = el("button", { type: "button", className: "secondary", textContent: draft.suggested ? "Add" : "Save task" });
  const dismiss = el("button", { type: "button", className: "text-button", textContent: "Dismiss" });
  const box = el("div", { "data-draft": draft.id }, title, el("div", { className: "row tight" }, save, dismiss));
  title.addEventListener("input", () => { draft.title = title.value; saveThread(); });
  save.addEventListener("click", () => {
    if (!(life.taskDrafts || []).some(d => d.id === draft.id)) return;
    const value = title.value.trim(); if (!value) return title.focus();
    if (!(life.tasks || []).some(t => t.title.toLocaleLowerCase() === value.toLocaleLowerCase() && !t.done)) {
      (life.tasks ||= []).push({ id: newId("t"), title: value, due: draft.due, big: Boolean(draft.big), done: false, note: draft.suggested ? `From ${draft.suggested.source}: ${draft.suggested.why}` : `From your confirmed words: ${draft.statement.text}`, ...(draft.sample ? { sample: true, userAdded: true, exampleMode: draft.exampleMode, source: "seeded" } : {}) });
      logAction(`Saved task: ${value}`);
    }
    if (draft.suggested) suggestSeen(draft.suggested.id);
    removeDraft(draft.id, "Task saved.");
  });
  dismiss.addEventListener("click", () => { if (draft.suggested) suggestSeen(draft.suggested.id); removeDraft(draft.id, "Suggestion dismissed."); });
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
    if (!note.sample && note.energySignal?.state === "low") record.energy.push({ word: note.energySignal.quote, id: note.id });
  }
  life.energyLog = notes.filter(n => !n.sample && n.energySignal).map(n => ({ id: n.id, at: n.at, state: n.energySignal.state, word: n.energySignal.quote })).sort((a, b) => a.at.localeCompare(b.at));
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
  yes.addEventListener("click", async () => { life.checkins.optedIn = true; saveThread(); box.replaceChildren(el("p", { className: "done", textContent: "Check-ins on. You can turn them off in Wellbeing." })); if ("Notification" in window && Notification.permission === "default") { try { await Notification.requestPermission(); } catch { /* ignore */ } } renderEnergy(); });
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
  const hlx = hLatest() || {}, sleepH = hlx.sleep_hours;
  const fromHealth = !e && sleepH != null ? (sleepH < 6 ? "Low" : sleepH < 7 ? "Steady" : "Rested") : null;
  $("energy-label").textContent = e ? { low: "Low", positive: "Positive", steady: "Steady" }[state] || "Steady" : fromHealth || "No check-in";
  $("energy-since").textContent = e ? `since ${new Date(e.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : sleepH != null ? `${Math.floor(sleepH)} h ${Math.round((sleepH % 1) * 60)} m sleep · ${Math.round(hlx.steps || 0).toLocaleString()} steps` : "add your own check-in";
  if (!e && fromHealth) $("energy-now").dataset.energy = fromHealth === "Low" ? "low" : fromHealth === "Rested" ? "positive" : "steady";
  $("energy-why").textContent = e ? `Your self-report: “${e.text}”.` : "Updates from explicit self-reports in your saved words. Voice and movement are context, not an emotion detector.";
  $("positive-words").value = life.positiveWords || DEFAULT_POSITIVE_WORDS;
  const v = life.voice, w = sensorsWithHealth(), r = life.days[todayKey()] || {}, h = hLatest() || {};
  const rows = (pairs) => pairs.filter(([, val]) => val != null && val !== "").flatMap(([k, val]) => [el("dt", { textContent: k }), el("dd", { textContent: String(val) })]);
  const fill = (id, pairs, empty) => { const items = rows(pairs); $(id).replaceChildren(...(items.length ? items : [el("dt", { className: "empty", textContent: empty })])); };
  fill("sig-voice", [["Speaking pace", v?.words_per_min ? `${v.words_per_min} wpm` : null], ["Pauses", v?.avg_pause_s ? `${v.avg_pause_s} s avg` : null], ["Loudness", v?.loudness != null ? `${Math.round(v.loudness * 100)}%` : null], ["Most-heard speaker's share", v?.talk_share != null ? `${Math.round(v.talk_share * 100)}%` : null]], "Record a session to measure");
  fill("sig-body", [["Heart rate", w.heart_rate != null ? `${Math.round(w.heart_rate)} bpm` : null], ["HRV (SDNN)", w.hrv_sdnn_ms != null ? `${Math.round(w.hrv_sdnn_ms)} ms` : null], ["Resting HR", w.resting_hr != null ? `${Math.round(w.resting_hr)} bpm` : null], ["Breathing", w.respiratory_rate != null ? `${Math.round(w.respiratory_rate)} /min` : null], ["Blood oxygen", w.spo2 != null ? `${Math.round(w.spo2)}%` : null], ["Sleep last night", w.sleep_hours_last_night != null ? `${Math.floor(w.sleep_hours_last_night)} h ${Math.round((w.sleep_hours_last_night % 1) * 60)}` : null], ["Noise", w.env_noise_db != null ? `${Math.round(w.env_noise_db)} dB` : null], ["Logged mood", w.state_of_mind ? `${w.state_of_mind.valence > 0.2 ? "pleasant" : w.state_of_mind.valence < -0.2 ? "unpleasant" : "neutral"}${w.state_of_mind.labels?.length ? ` · ${w.state_of_mind.labels.join(", ")}` : ""}` : null]], "Pair the Apple Watch in Devices");
  fill("sig-move", [["Steps today", (() => { const best = Math.max(r.watchSteps || 0, r.bandSteps || 0, h.steps || 0); return best ? Math.round(best).toLocaleString() : null; })()], ["Right now", w.activity || signals.activity || null], ["Exercise", w.exercise_min_today != null ? `${Math.round(w.exercise_min_today)} min` : null], ["Mindful", w.mindful_min_today != null ? `${Math.round(w.mindful_min_today)} min` : null], ["Distance", h.distance_km != null ? `${h.distance_km.toFixed(1)} km` : null], ["Active energy", h.active_energy_kcal != null ? `${Math.round(h.active_energy_kcal)} kcal` : null], ["Walking speed", h.walking_speed_kmh != null ? `${h.walking_speed_kmh.toFixed(1)} km/h` : null], ["Walking steadiness", h.walking_steadiness != null ? `${Math.round(h.walking_steadiness)}%` : null]], "Connect the band or watch");
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
/* A realistic two weeks of care tasks so Tasks, the calendar and the day boards aren't empty (marked seeded, once per profile). */
function seedTasks() {
  if (isFictionalDemo()) return;
  const flag = `threadline.tasks.seeded.v1.${threadKey}`;
  try { if (localStorage.getItem(flag)) return; } catch { return; }
  const day = (n) => todayKey(new Date(Date.now() + n * DAY_MS));
  const at = (n, h) => { const d = new Date(Date.now() + n * DAY_MS); d.setHours(h, 0, 0, 0); return d.toISOString(); };
  const T = [
    [-12, "09:00", "Morning tablets with breakfast", true], [-11, "10:30", "GP appointment · blood pressure check", true], [-10, "16:00", "Video call with Lily", true],
    [-9, "11:00", "Refill the weekly pill organiser", true], [-8, "15:00", "Walk around the park with Asha", true], [-7, "10:00", "Pharmacy · collect repeat prescription", true],
    [-6, "18:00", "Water the roses", true], [-5, "14:00", "Physio exercises · 15 minutes", true], [-4, "09:30", "Eye test at the optician", true],
    [-3, "17:00", "Call the bank about the card", false], [-2, "12:00", "Lunch with Meera", true], [-1, "20:00", "Charge the band and the watch", true],
    [0, "09:00", "Morning tablets with breakfast", false], [0, "11:00", "Check the stove is off before sitting down", false], [0, "16:00", "Video call with Lily", false],
    [0, "19:00", "Put today's plan on the whiteboard", false], [1, "10:00", "Grocery delivery · milk, bread, fruit", false], [1, "15:00", "Short walk after lunch", false],
    [2, "09:30", "Dentist appointment", false], [3, "11:00", "Fix the folded rug in the hallway", false], [4, "14:00", "Memory club at the community centre", false],
    [5, "10:00", "Refill the weekly pill organiser", false], [6, "16:00", "Sunday visit · compare gardens with Lily", false], [8, "10:30", "GP follow-up · sleep and mood", false],
    [10, "15:00", "Install stair edge tape", false], [12, "11:00", "Hearing check", false],
  ];
  const existing = new Set((life.tasks || []).map((t) => `${t.due}|${t.title}`));
  for (const [n, time, title, done] of T) {
    if (existing.has(`${day(n)}|${title}`)) continue;
    (life.tasks ||= []).push({ id: newId("t"), title, due: day(n), time, big: /decide|appointment/i.test(title) && n > 0 && false, done, ...(done ? { doneAt: at(n, Number(time.slice(0, 2)) + 1) } : {}), note: "Care plan", seeded: true });
  }
  try { localStorage.setItem(flag, "1"); } catch { /* */ }
  saveThread();
}
let calView = null;
function renderTasks() {
  if (!$("tasks-today")) return;
  try { seedTasks(); } catch { /* */ }
  if ($("task-month") && !calView) calView = mountCalendarView($("task-month"), { el, request, getTasks: () => life.tasks || [],
    addTask: ({ title, due, time }) => { (life.tasks ||= []).push({ id: newId("t"), title, due, time, big: false, done: false, note: "Added on the calendar" }); saveThread(); renderTasks(); logAction(`Task added: ${title} · ${due}${time ? ` ${time}` : ""}`); },
    toggleDone: (t) => { t.done = !t.done; t.doneAt = t.done ? new Date().toISOString() : undefined; saveThread(); renderTasks(); if (t.done) logAction(`Done: ${t.title}`); } });
  else calView?.refresh();
  if (location.hash === "#tasks") renderTaskCalendar();
  const tasks = life.tasks || [], today = todayKey();
  const drafts = (life.taskDrafts || []).filter(d => !d.exampleMode || d.exampleMode === accessMode);
  $("task-banner").replaceChildren(...(drafts.length ? drafts.map(d => el("div", { className: "task-draft" }, el("p", { className: "caption", textContent: d.suggested ? `From: ${d.suggested.source} · ${d.suggested.why}` : `From: “${d.statement.text}”${d.statement.speaker_confirmed ? "" : " · confirm this was you before saving"}` }), draftControls(d))) : [el("p", { className: "caption", textContent: "No pending suggestions. Ask for a reminder while speaking and it will appear here." })]));
  if (!drafts.length) fillTaskSuggestions();
  const lists = { today: [], later: [], held: [] };
  for (const t of tasks.filter((x) => !x.done)) (t.heldUntil && t.heldUntil > today ? lists.held : t.due && t.due <= today ? lists.today : lists.later).push(t);
  const item = (t) => {
    const btns = [];
    const mk = (label, fn, cls = "text-button") => { const b = el("button", { type: "button", className: cls, textContent: label }); b.addEventListener("click", fn); btns.push(b); };
    if (!(t.due && t.due <= today)) mk("Move to today", () => { t.due = today; t.heldUntil = null; renderTasks(); logAction(`Moved “${t.title}” to today`); });
    if (t.big && !(t.heldUntil > today)) mk("Hold 3 days", () => holdTask(t));
    mk("Done", () => { t.done = true; t.doneAt = new Date().toISOString(); logAction(`Done: ${t.title}`); renderTasks(); });
    btns.push(el("a", { className: "text-button", href: gcalLink(t.title, t.note || "From Threadline", t.heldUntil || t.due), target: "_blank", rel: "noopener", textContent: "Add to Google Calendar" }));
    return el("li", { className: `${t.big ? "big" : ""}${t.voice ? " voice" : ""}`, "data-task-id": t.id }, el("div", {}, el("b", { textContent: `${t.time ? `${t.time} · ` : ""}${t.title}` }), t.voice ? el("span", { className: "task-voice", textContent: "🎙 by voice" }) : null, el("div", { className: "caption", textContent: [t.big ? "big decision" : "", t.heldUntil > today ? `held until ${parseDay(t.heldUntil).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}` : t.due ? `due ${parseDay(t.due).toLocaleDateString([], { month: "short", day: "numeric" })}` : "", t.note || ""].filter(Boolean).join(" · ") })), el("div", { className: "row tight" }, ...btns));
  };
  for (const k of ["today", "later", "held"]) $(`tasks-${k}`).replaceChildren(...(lists[k].length ? lists[k].map(item) : [el("li", { className: "empty", textContent: k === "held" ? "Nothing held." : "Nothing here." })]));
  saveThread();
}
/* Suggestions from data the app already has (scenario library, Care, Apple Health). Shown as drafts; nothing becomes a task until Add. */
let scenarioCache = null, suggestBusy = false;
const suggestSeenKey = () => `threadline.task-suggest.seen.v1.${threadKey}`;
const suggestSeenSet = () => { try { return new Set(JSON.parse(localStorage.getItem(suggestSeenKey()) || "[]")); } catch { return new Set(); } };
function suggestSeen(id) { const s = suggestSeenSet(); s.add(id); try { localStorage.setItem(suggestSeenKey(), JSON.stringify([...s].slice(-200))); } catch { /* storage off */ } }
async function fillTaskSuggestions() {
  if (suggestBusy) return; suggestBusy = true;
  const scope = threadKey;
  try {
    scenarioCache ||= await fetch("/static/scenarios/scenarios.json").then(r => r.ok ? r.json() : { scenarios: [] }).then(d => d.scenarios || []).catch(() => []);
    if (scope !== threadKey || (life.taskDrafts || []).some(d => !d.exampleMode || d.exampleMode === accessMode)) return;
    const seen = suggestSeenSet();
    let careHistory = [], routine = [];
    try { careHistory = care.history || []; routine = careRoutine(); } catch { /* Care not initialised yet */ }
    const list = suggestTasks({ scenarios: scenarioCache, careHistory, routine, healthLatest: hLatest(),
      existingTitles: (life.tasks || []).map(t => t.title), today: todayKey(), mode: accessMode, limit: 20 }).filter(s => !seen.has(s.id) && (!s.mode || s.mode === accessMode)).slice(0, 8);
    if (!list.length) return;
    const sample = isFictionalDemo();
    life.taskDrafts = [...(life.taskDrafts || []).filter(d => d.exampleMode && d.exampleMode !== accessMode), ...list.map(s => ({ id: newId("draft"), title: s.title, due: s.due, big: s.big, suggested: { id: s.id, source: s.source, why: s.why }, exampleMode: s.mode || accessMode,
      statement: { id: `suggest:${s.id}`, text: s.why, speaker_confirmed: true }, ...((sample || s.sample) ? { sample: true } : {}) }))];
    renderTasks(); drawDashboard();
  } finally { suggestBusy = false; if (scope !== threadKey) fillTaskSuggestions(); }
}
function flashTasks(id) { if (location.hash !== "#tasks") return; requestAnimationFrame(() => { const li = document.querySelector(`[data-task-id="${id}"]`); li?.classList.add("flash"); li?.scrollIntoView({ block: "center", behavior: "smooth" }); }); }
async function renderTaskCalendar() {
  const box = $("tasks-calendar"); if (!box) return;
  try {
    const d = await request(`/api/calendar/events?days=7&tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`);
    const ev = (d.events || []).slice(0, 12);
    if (!(d.calendars || []).length) { box.replaceChildren(el("p", { className: "caption", textContent: "Connect your calendar on the Dashboard (Your calendar) and your week appears here. Say “What's on today?” to Threadline." })); return; }
    box.replaceChildren(...(ev.length ? ev.map((e) => el("li", { className: "tc-ev" },
      el("time", { textContent: e.all_day ? new Date(`${e.start}T12:00`).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : new Date(e.start).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }) }),
      el("b", { textContent: e.title }), e.location ? el("small", { textContent: e.location }) : null)) : [el("p", { className: "caption", textContent: "Nothing on your calendar this week." })]));
  } catch { box.replaceChildren(el("p", { className: "caption", textContent: "Calendar unavailable right now." })); }
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
    card("Apple Watch · Health", $("watch-pair").dataset.state === "connected", "Heart rate, HRV, resting HR, breathing, blood oxygen, sleep, wrist temperature, noise, exercise, mindful minutes, State of Mind. Taps for check-ins.", "Threadline watch app · pairing code · Devices"),
    card("Camera · GoPro", Boolean(capture.camStream), "Video via the GoPro Webcam app; stays in this browser.", "Live session → Add video"),
    card("Calendar", (life.tasks || []).length > 0 || agent.events.length > 0, "Quiet-time blocks and notes around tasks and decisions.", "Add to Google Calendar links or .ics files — each needs your tap"),
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
/* Your day · today at a glance: charts + to do / done / coming up. */
async function renderDayBoard() {
  const box = $("day-board"); if (!box) return;
  const key = todayKey(), now = new Date(), NS = "http://www.w3.org/2000/svg";
  const svg = (w, h, kids) => { const n = document.createElementNS(NS, "svg"); n.setAttribute("viewBox", `0 0 ${w} ${h}`); n.setAttribute("class", "db-svg"); n.setAttribute("preserveAspectRatio", "none"); n.append(...kids.filter(Boolean)); return n; };
  const mk = (tag, attrs, text) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (text != null) n.textContent = text; return n; };
  // 1) activity by hour: conversation lines, statements, actions
  const hours = [...Array(24)].map(() => ({ talk: 0, words: 0, acts: 0 }));
  for (const t of loadArchive()) for (const l of t.lines || []) { const d = new Date(l.at); if (todayKey(d) === key) hours[d.getHours()].talk += 1; }
  for (const n of sessions.reflection.notes) { const d = new Date(n.at); if (todayKey(d) === key) hours[d.getHours()].words += 1; }
  for (const a of life.actions || []) { const d = new Date(a.at); if (todayKey(d) === key) hours[d.getHours()].acts += 1; }
  const peak = Math.max(1, ...hours.map((x) => x.talk + x.words + x.acts));
  const bars = hours.flatMap((x, i) => { let y = 120; const out = []; for (const [k, cls] of [["talk", "b-talk"], ["words", "b-words"], ["acts", "b-acts"]]) { const hgt = (x[k] / peak) * 100; if (hgt) { y -= hgt; out.push(mk("rect", { x: i * 25 + 3, y, width: 19, height: hgt, rx: 3, class: cls })); } } return out; });
  const axis = [0, 6, 12, 18, 23].map((hh) => mk("text", { x: hh * 25 + 12, y: 136, "text-anchor": "middle", class: "db-ax" }, hh === 0 ? "12a" : hh === 12 ? "12p" : hh > 12 ? `${hh - 12}p` : `${hh}a`));
  const nowLine = mk("line", { x1: now.getHours() * 25 + 12, x2: now.getHours() * 25 + 12, y1: 8, y2: 122, class: "db-now" });
  const activity = svg(600, 140, [...bars, nowLine, ...axis]);
  // 2) mood: today's morning/evening against the last 7 days
  const week = (ownerMood.days || []).slice(-7);
  const moodSvg = svg(300, 120, [mk("line", { x1: 0, x2: 300, y1: 60, y2: 60, class: "db-zero" }),
    ...week.flatMap((d, i) => { const x = 20 + i * 43, out = []; for (const [f, cls, dx] of [["morning", "m-am", -7], ["evening", "m-pm", 7]]) if (d[f] != null) { const v = d[f], hgt = Math.abs(v) * 50; out.push(mk("rect", { x: x + dx - 6, y: v >= 0 ? 60 - hgt : 60, width: 12, height: Math.max(2, hgt), rx: 3, class: cls + (d.date === key ? " today" : "") })); } out.push(mk("text", { x, y: 116, "text-anchor": "middle", class: "db-ax" }, d.date === key ? "today" : new Date(`${d.date}T12:00`).toLocaleDateString([], { weekday: "narrow" }))); return out; })]);
  // 3) health vs 30-day average
  const h = hLatest() || {}, H = Object.values(ownerHealth.byDay || {}), avg = (f) => { const v = H.map((d) => d[f]).filter((x) => typeof x === "number"); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const rows = [["Sleep", "sleep_hours", (v) => `${Math.floor(v)}h ${Math.round((v % 1) * 60)}m`, 1], ["Steps", "steps", (v) => Math.round(v).toLocaleString(), 1], ["Resting HR", "resting_heart_rate", (v) => `${Math.round(v)} bpm`, -1], ["HRV", "hrv_sdnn", (v) => `${Math.round(v)} ms`, 1], ["Exercise", "exercise_min", (v) => `${Math.round(v)} min`, 1]]
    .filter(([, f]) => h[f] != null && avg(f)).map(([label, f, fmtv, dir]) => { const ratio = h[f] / avg(f), good = dir > 0 ? ratio >= 0.95 : ratio <= 1.05;
      return el("div", { className: "db-hrow" }, el("span", { className: "db-hl", textContent: label }),
        el("div", { className: "db-track" }, el("i", { className: `db-fill ${good ? "good" : "bad"}` }), el("b", { className: "db-mark" })),
        el("span", { className: "db-hv", textContent: `${fmtv(h[f])} · ${ratio >= 1 ? "+" : ""}${Math.round((ratio - 1) * 100)}%` })); });
  rows.forEach((row, i) => { const f = [["sleep_hours"], ["steps"], ["resting_heart_rate"], ["hrv_sdnn"], ["exercise_min"]].flat().filter((x) => h[x] != null && avg(x))[i]; const ratio = Math.min(2, h[f] / avg(f)); row.querySelector(".db-fill").style.width = `${Math.round(ratio * 50)}%`; });
  // 4) lists
  const tasks = life.tasks || [];
  const todo = [...tasks.filter((t) => !t.done && (!t.due || t.due <= key)).map((t) => ({ when: t.time || (t.due && t.due < key ? "overdue" : "today"), text: t.title, tag: t.voice ? "voice" : "task" })),
    ...(life.taskDrafts || []).slice(0, 3).map((d) => ({ when: "suggested", text: d.title, tag: "suggestion" })),
    ...((typeof care !== "undefined" ? care.history : []).at(-1)?.next_step ? [{ when: "care", text: care.history.at(-1).next_step, tag: "care agent" }] : [])];
  const done = [...tasks.filter((t) => t.done && t.doneAt && todayKey(new Date(t.doneAt)) === key).map((t) => ({ when: new Date(t.doneAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }), text: t.title, tag: "done" })),
    ...(life.actions || []).filter((a) => todayKey(new Date(a.at)) === key && !/Opened /.test(a.text)).slice(-8).reverse().map((a) => ({ when: new Date(a.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }), text: a.text.replace(/^Voice · /, ""), tag: /^Voice/.test(a.text) ? "voice" : "action" }))];
  let upcoming = tasks.filter((t) => !t.done && t.due && t.due > key).slice(0, 5).map((t) => ({ when: new Date(`${t.due}T12:00`).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) + (t.time ? ` ${t.time}` : ""), text: t.title, tag: "task" }));
  try {
    const d = await request(`/api/calendar/events?days=2&tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`);
    upcoming = [...(d.events || []).filter((e) => e.all_day || new Date(e.start) > now).slice(0, 5).map((e) => ({ when: e.all_day ? "all day" : new Date(e.start).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }), text: e.title, tag: "calendar" })), ...upcoming];
  } catch { /* no calendar */ }
  const list = (title, items, empty, cls) => el("section", { className: `db-list ${cls}` }, el("h3", {}, el("span", { textContent: title }), el("em", { textContent: String(items.length) })),
    items.length ? el("ol", {}, ...items.slice(0, 8).map((x) => el("li", {}, el("time", { textContent: x.when }), el("span", { textContent: x.text }), el("small", { className: `db-tag t-${x.tag.replace(/\s/g, "-")}`, textContent: x.tag })))) : el("p", { className: "caption", textContent: empty }));
  const stat = (n, label) => el("div", { className: "db-stat" }, el("b", { textContent: String(n) }), el("span", { textContent: label }));
  const talkToday = hours.reduce((a, x) => a + x.talk, 0), actsToday = hours.reduce((a, x) => a + x.acts, 0);
  box.replaceChildren(
    el("div", { className: "db-stats" }, stat(todo.length, "to do"), stat(done.length, "done today"), stat(upcoming.length, "coming up"), stat(talkToday, "conversation lines"), stat(actsToday, "actions taken")),
    el("div", { className: "db-grid" },
      el("figure", { className: "db-card db-wide" }, el("figcaption", {}, el("b", { textContent: "Your day, hour by hour" }), el("span", { className: "db-legend" }, el("i", { className: "b-talk" }), "conversation ", el("i", { className: "b-words" }), "statements ", el("i", { className: "b-acts" }), "actions")), activity),
      el("figure", { className: "db-card" }, el("figcaption", {}, el("b", { textContent: "Mood · last 7 days" }), el("span", { className: "db-legend" }, el("i", { className: "m-am" }), "morning ", el("i", { className: "m-pm" }), "evening")), week.length ? moodSvg : el("p", { className: "caption", textContent: "Say how you feel to Threadline to start." })),
      el("figure", { className: "db-card" }, el("figcaption", {}, el("b", { textContent: "Today vs your 30-day average" }), el("span", { className: "caption", textContent: "Apple Health" })), rows.length ? el("div", { className: "db-health" }, ...rows) : el("p", { className: "caption", textContent: "Health data appears here once imported." }))),
    el("div", { className: "db-lists" }, list("To do", todo, "Nothing due. Say “Remind me to…” to add one.", "todo"), list("Done today", done, "Nothing done yet today.", "done"), list("Coming up", upcoming, "Nothing scheduled. Connect your calendar on the Dashboard.", "next")));
}
function renderToday() {
  try { renderDayBoard(); } catch { /* board is optional */ }
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
  const notes = contextNotes(sessions.reflection.notes).filter(n => todayKey(new Date(n.at)) === key);
  const archive = loadArchive().filter(a => !a.sample || a.exampleMode === accessMode);
  const todays = archive.filter(a => todayKey(new Date(a.startedAt)) === key);
  if (!events.length && notes.length) {
    $("arc-caption").textContent = `${notes.length} saved statements today${notes.every(n => n.sample) ? " · Example" : ""}`;
    $("day-moments").replaceChildren(...notes.slice(-4).map(n => el("a", { className: "moment", href: `#note-${n.id}`, textContent: `${new Date(n.at).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})} “${n.text.slice(0,75)}”` })));
  }
  if (notes.length && !$("today-summary-out").querySelector('.provenance')) for (const id of ["today-summary-out", "day-summary-out"])
    $(id).replaceChildren(el("p", {className:"caption",textContent:"Latest saved statements · select a source to read it"}), ...notes.slice(-3).map(n => el("p", {}, el("a", {href:`#note-${n.id}`,textContent:`${n.sample ? 'Example · ' : ''}${n.speaker || 'You'}: “${n.text}”`}))));
  const r = life.days[key] || {}, w = sensorsWithHealth(), h = hDay(key) || hLatest() || {};
  $("measured-h").textContent = h.sample ? "Today’s context · includes examples" : "Measured today";
  const m = [["Conversations today", todays.length || null], ["Saved statements", notes.length || null], ["Low-energy words", r.energy?.length || null], ["Lines from others", r.others || null], [h.sample ? "Steps · Example" : "Steps", (() => { const b = Math.max(r.watchSteps || 0, r.bandSteps || 0, h.steps || 0); return b ? Math.round(b).toLocaleString() : null; })()], ["Heart rate", r.hrN ? `${Math.round(r.hrSum / r.hrN)} avg` : h.heart_rate != null ? `${Math.round(h.heart_rate)} avg` : null], ["Resting HR", w.resting_hr != null ? `${Math.round(w.resting_hr)} bpm` : null], ["Blood oxygen", w.spo2 != null ? `${Math.round(w.spo2)}%` : null], ["Exercise", h.exercise_min != null ? `${Math.round(h.exercise_min)} min` : null], ["Stand hours", h.stand_hours != null ? Math.round(h.stand_hours) : null], ["HRV", w.hrv_sdnn_ms != null ? `${Math.round(w.hrv_sdnn_ms)} ms` : null], ["Sleep", w.sleep_hours_last_night != null ? `${Math.floor(w.sleep_hours_last_night)} h ${Math.round((w.sleep_hours_last_night % 1) * 60)}` : null]].filter(([, v]) => v != null);
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
  if (isFictionalDemo()) return;
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
function demoWanted() { return !isFictionalDemo() && isDefaultProfile() && !savedWatch() && !watch.ws; }
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
function canAutoRecord() { return !isFictionalDemo() && $("rec-consent").checked && !autoRec.userStopped && !capture.active && !busy && capture.band && !capture.band.reconnecting && $("source").value === "vexo"; }
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
  if (!$("lh-consent").checked) return lhSetState("idle", "Allow sending selected audio and camera to Gemini first.");
  if (isFictionalDemo()) return message("Exit fictional history before starting a live camera session.", true);
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
    ws.onopen = () => ws.send(JSON.stringify({ token: "", mode: accessMode, ...(lh.bridge ? { vision: "bridge" } : {}) }));
    ws.onmessage = async (event) => {
      if (event.data instanceof ArrayBuffer) return lhPlay(event.data);
      let msg; try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === "ready") {
        const notes = contextNotes(sessions.reflection?.notes || []).slice(-20).map((n) => `${n.sample ? `[Example ${n.persona || n.speaker || accessMode}; not a real patient observation] ` : ""}${new Date(n.at).toLocaleString()}: ${n.text}`);
        if (notes.length) ws.send(JSON.stringify({ type: "context", notes }));
        const where = await lhStartAudio().catch((e) => { lhLog("said", `(No microphone: ${e.message})`); return "no microphone"; });
        if (!lh.bridge) lhStartFrames();
        lhSetState("live", `Live with ${msg.model || "Gemini"} · camera ${lh.bridge ? "GoPro (bridge)" : (lh.stream?.getVideoTracks()[0]?.label || "on")} · listening through ${where}. ${accessInfo().question}`);
        if (typeof logAction === "function") logAction(`Started Gemini Live ${accessInfo().label} help`);
      } else if (msg.type === "heard") { lhLog("heard", msg.text); renderHearingCaption(msg.text, false); }
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
  if (!d.final) { showLiveDraft(d.text); return; }
  renderHearingCaption(d.text, true, d.speaker);
  clearLiveDraft();
  const who = d.speaker;
  $("live-lines").append(el("li", { className: `line spk-${who ?? "x"}` },
    el("span", { className: "avatar", "aria-hidden": "true", textContent: who ?? "?" }),
    el("div", {}, el("div", { className: "line-meta" }, el("b", { textContent: who == null ? "Speaker ?" : `Speaker ${who}` }), el("span", { textContent: ` · ${new Date(d.at || Date.now()).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })} · Vexo band (live demo)` })),
      el("p", { textContent: d.text }))));
  $("care-band-transcript").hidden = false;
  $("care-band-lines").append(el("li", {}, el("span", { className: "caption", textContent: `Speaker ${who ?? "?"} · shared live band` }), el("p", { textContent: d.text })));
  while ($("care-band-lines").children.length > 200) $("care-band-lines").firstChild.remove();
  $("care-band-lines").scrollTop = $("care-band-lines").scrollHeight;
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
const CARE_SRC_LABEL = { file: "Recorded video, played as a live stream", bridge: "GoPro (via bridge)", camera: "This computer's camera", phone: "the iPhone camera" };
const careStill = () => care.src === "bridge" || care.src === "phone"; // server-side frames shown in <img id="care-bridge">
function careSrcStatus(text) { $("care-src-status").textContent = text; }
function careLiveStatus(text) { $("care-live-status").textContent = text; }
function careLiveState(state, text) {
  $("care-live").dataset.state = state; if (text != null) careLiveStatus(text);
  $("care-start").hidden = state !== "idle"; $("care-stop").hidden = state === "idle";
}
function careShowMedia() {
  const v = $("care-video"), img = $("care-bridge");
  const hasVideo = (care.src === "file" && care.files.length) || (care.src === "camera" && care.camStream);
  v.hidden = !hasVideo; img.hidden = !careStill();
  v.controls = care.src === "file";
  $("care-stage-empty").hidden = Boolean(hasVideo) || careStill();
  $("care-file-row").hidden = care.src !== "file";
  $("care-files-clear").hidden = !care.files.length;
  const badge = $("care-live-badge");
  let label = "", live = false;
  if (care.src === "file" && care.files.length) { label = "Recorded video · played as a live stream"; live = true; }
  else if (care.src === "camera" && care.camStream) { label = "This computer's camera · live"; live = true; }
  else if (care.src === "bridge") { label = care.bridgeLive ? "GoPro (via bridge) · live" : "GoPro (via bridge) · waiting"; live = care.bridgeLive; }
  else if (care.src === "phone") { label = care.bridgeLive ? "iPhone camera · live" : "iPhone camera · waiting"; live = care.bridgeLive; }
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
  if (care.src === "phone") {
    if (!care.phoneCode) { care.bridgeLive = false; careSrcStatus("Pair an iPhone first: Dashboard → Live camera · iPhone."); return careShowMedia(); }
    try { const r = await fetch(`/api/phonecam/status?c=${care.phoneCode}`); const s = r.ok ? await r.json() : {}; care.bridgeLive = Boolean(s.live); careSrcStatus(care.bridgeLive ? `iPhone camera live · ${s.fps} fps.` : r.ok ? "Waiting for the iPhone to send frames…" : "iPhone pairing ended. Pair it again on the dashboard."); }
    catch { care.bridgeLive = false; careSrcStatus("iPhone camera unavailable."); }
    return careShowMedia();
  }
  try { const s = await (await fetch("/api/vision/status")).json(); care.bridgeLive = Boolean(s.live); careSrcStatus(care.bridgeLive ? `GoPro bridge live${s.camera ? ` · ${s.camera}` : ""}.` : "Waiting for the GoPro bridge to send frames…"); }
  catch { care.bridgeLive = false; careSrcStatus("GoPro bridge unavailable on this server."); }
  careShowMedia();
}
function careBridgeOn() {
  if (care.bridgeTimer) return;
  const img = $("care-bridge");
  img.onerror = () => { img.removeAttribute("src"); };
  const phone = care.src === "phone";
  const tick = () => { if (!document.hidden && (!phone || care.phoneCode)) img.src = phone ? `/api/phonecam/latest.jpg?c=${care.phoneCode}&t=${Date.now()}` : `/api/vision/latest.jpg?t=${Date.now()}`; };
  tick(); care.bridgeTimer = setInterval(tick, phone ? 500 : 1000);
  careBridgeStatus(); care.bridgeStatusTimer = setInterval(careBridgeStatus, 5000);
}
function careBridgeOff() { clearInterval(care.bridgeTimer); clearInterval(care.bridgeStatusTimer); care.bridgeTimer = 0; care.bridgeStatusTimer = 0; $("care-bridge").removeAttribute("src"); }
function careSetSource(src) {
  if (care.ws && src !== care.src) careStop("Stopped because the video source changed. Press Start to continue.");
  care.src = src;
  document.querySelectorAll("input[name=care-src]").forEach((r) => { r.checked = r.value === src; });
  const v = $("care-video");
  if (src !== "camera") careStopCamera();
  careBridgeOff();
  if (src === "file") { if (care.files.length) { if (!v.src || v.srcObject) carePlayIndex(care.idx); } else { v.removeAttribute("src"); careSrcStatus("Upload one or more videos. They stay on this computer and play in a loop like a live stream."); } }
  else { v.pause(); v.removeAttribute("src"); }
  if (src === "camera") careStartCamera();
  if (careStill() && care.visible) careBridgeOn();
  careRenderPlaylist(); careShowMedia();
}
document.querySelectorAll("input[name=care-src]").forEach((r) => r.addEventListener("change", () => { if (r.checked) careSetSource(r.value); }));

/* Gemini Live guidance */
function careSendPcm(int16) { if (care.ws?.readyState === 1 && int16.length) care.ws.send(int16.buffer); }
function careLog(kind, text, done = false) {
  if (!text) return;
  if (kind === "heard") renderHearingCaption(text, false);
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
    if (care.ws?.readyState !== 1 || document.hidden || careStill() || !v.videoWidth || v.hidden) return;
    c.width = 640; c.height = Math.round(640 * v.videoHeight / v.videoWidth);
    try { ctx.drawImage(v, 0, 0, c.width, c.height); } catch { return; }
    const data = c.toDataURL("image/jpeg", 0.6).split(",")[1];
    if (data.length < 290000) care.ws.send(JSON.stringify({ type: "frame", jpeg: data }));
  }, 1000);
}
async function careStart() {
  if (!$("care-consent").checked) return careLiveStatus("Allow sending the selected audio and camera to Gemini before starting.");
  if (isFictionalDemo()) return careLiveStatus("Exit fictional history before starting a live camera session.");
  if (care.ws) return;
  if (lh.ws) lhStop("Paused: live guidance on the Care page is using Gemini Live.");
  if (care.src === "file" && !care.files.length) return careLiveStatus("Upload a video first, or choose the GoPro or this computer's camera.");
  if (care.src === "camera" && !(await careStartCamera())) return careLiveStatus("Camera unavailable. Pick another source.");
  if (care.src === "phone" && !care.phoneCode) return careLiveStatus("Pair an iPhone first: Dashboard → Live camera · iPhone.");
  careLiveState("busy", "Connecting to Gemini Live…");
  try {
    if (care.src === "file") { const v = $("care-video"); if (v.paused) await v.play().catch(() => {}); }
    if (careStill()) careBridgeOn();
    care.out = new AudioContext({ sampleRate: 24000 }); care.playAt = 0; care.out.resume().catch(() => {});
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/live-gemini`);
    ws.binaryType = "arraybuffer"; care.ws = ws;
    const bridge = careStill(), vision = care.src === "phone" ? { vision: "phone", code: care.phoneCode } : care.src === "bridge" ? { vision: "bridge" } : {};
    const openTimer = setTimeout(() => { if (care.ws === ws && $("care-live").dataset.state === "busy") careStop("Gemini Live didn't answer. It may be unavailable right now."); }, 15000);
    ws.onopen = () => ws.send(JSON.stringify({ token: "", mode: accessMode, ...vision }));
    ws.onmessage = async (event) => {
      if (care.ws !== ws) return;
      if (event.data instanceof ArrayBuffer) return livePlayPcm24(care, event.data);
      let msg; try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === "ready") {
        clearTimeout(openTimer);
        const notes = [`Selected assistance mode: ${accessMode}. ${accessInfo().description}`,
          ...careRoutine().map((r) => `Usual routine: ${r}`)];
        ws.send(JSON.stringify({ type: "context", notes }));
        const where = await careStartAudio().catch((e) => { careLog("note", `No audio input (${e.message}). Gemini still sees the video.`, true); return "no microphone"; });
        if (care.ws !== ws) { care.audioStop?.(); care.audioStop = null; return; }
        if (!bridge) careStartFrames();
        careLiveState("live", `Live with ${msg.model || "Gemini"} · watching ${CARE_SRC_LABEL[care.src]} · listening through ${where}.`);
        if (typeof logAction === "function") logAction("Started Care live guidance");
      } else if (msg.type === "heard") careLog("heard", msg.text);
      else if (msg.type === "said") careLog("said", msg.text);
      else if (msg.type === "turn_complete") { const l = care.lines[care.lines.length - 1]; if (l) l.done = true; const heard = [...care.lines].reverse().find(x => x.kind === "heard"); if (heard) renderHearingCaption(heard.text, true); }
      else if (msg.type === "interrupted") liveInterrupt(care);
      else if (msg.type === "error") { careLiveStatus(msg.message || "Gemini Live reported an error."); if ($("care-live").dataset.state === "busy") careStop(`Gemini Live unavailable: ${msg.message || "error"}`); }
      else if (msg.type === "vision") careLiveStatus(msg.live ? `Seeing through ${msg.camera || "the GoPro"}.` : vision.vision === "phone" ? "Waiting for frames from the iPhone…" : "Waiting for GoPro frames from the bridge…");
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
  if (careStill() && !care.visible) careBridgeOff();
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
    b.on("free-fall", () => { requestAssistance("Band reported a possible fall"); care.falls.push(Date.now()); careLog("note", "The band felt a possible fall. Checking in.", true); emergency.trigger({ reason: "Possible incident: band motion signal", note: "The band reported a free-fall signal. A person falling or being injured has not been confirmed." }); if (care.visible || care.ws) setTimeout(() => careAssess(false), 500); });
  }
  const cut = Date.now() - 10 * 60000;
  care.taps = care.taps.filter((t) => t > cut); care.falls = care.falls.filter((t) => t > cut);
  if (careRoutineKey() !== care.routineKey) renderCareRoutine();
}
setInterval(careWatchBand, 2000);

/* Routine (per band, kept in this browser) */
const CARE_ROUTINE_DEFAULT = [];
function careRoutineKey() { return `threadline.care.routine.v1.${isFictionalDemo() ? threadKey : bandNumber || "default"}`; }
function careRoutine() { if (isFictionalDemo()) return demoSeed().routine; try { const v = JSON.parse(localStorage.getItem(careRoutineKey()) || "null"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : CARE_ROUTINE_DEFAULT.slice(); } catch { return CARE_ROUTINE_DEFAULT.slice(); } }
function careSaveRoutine(items) { try { localStorage.setItem(careRoutineKey(), JSON.stringify(items.slice(0, 40))); } catch { /* storage off */ } }
function renderCareRoutine() {
  care.routineKey = careRoutineKey();
  const items = careRoutine();
  if (!items.length) {
    const example = demoSeed();
    $("care-routine").replaceChildren(...example.routine.map(text => el("li", {}, el("span", {className:"caption",textContent:`${example.persona} · Example preference`}), el("p", {textContent:text.replace(/^Fictional [^:]+ preference: /, '')}))));
    return;
  }
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
function careLiveWatch() { return !isFictionalDemo() && watch.sensors && Date.now() - watch.sensorsAt < 120000 ? watch.sensors : null; }
function careHealthToday() {
  if (isFictionalDemo()) return {};
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
  if (isFictionalDemo()) {
    const days = Object.values(demoSeed().demoHealth), last = days.at(-1);
    $("care-health").replaceChildren(el("p", { className: "demo-chart-label", textContent: "Synthetic chart values for this fictional profile. Not device readings or clinical predictions." }), ...[["Sleep", `${last.sleep_hours} h`], ["Steps", last.steps], ["Resting HR", `${last.resting_heart_rate} bpm`]].map(([label,value])=>el("div", {className:"hm"},el("div",{className:"hm-k",textContent:label}),el("div",{className:"hm-v",textContent:String(value)}))));
    $("care-spark").replaceChildren(); return;
  }
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
    const values = Object.values(appSeed().demoHealth), last = values.at(-1);
    $("care-health").replaceChildren(el("p", { className: "caption", textContent: "Example history · not device readings" }), ...[["Sleep", `${last.sleep_hours} h`], ["Steps", last.steps], ["Resting HR", `${last.resting_heart_rate} bpm`]].map(([label,value]) => el("div", { className: "hm" }, el("div", { className: "hm-k", textContent: label }), el("div", { className: "hm-v", textContent: String(value) }))));
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
  if (isFictionalDemo()) return {
    mode: accessMode,
    transcript: sessions.routine.notes.slice(-30).map(n => ({ at: n.at, speaker: `Fictional ${demoSeed().persona}`, text: `[Fictional written demo] ${n.text}` })),
    observations: [], band: null, health: {}, video: { source: null, live: false },
    routine: demoSeed().routine,
  };
  const bandLines = [...document.querySelectorAll("#live-lines li p")].map((p) => p.textContent.trim()).filter(Boolean);
  const saved = contextNotes(sessions.reflection.notes).filter(n => !n.sample).slice(-10);
  const heard = care.lines.filter((l) => l.kind === "heard").map((l) => `Heard: ${l.text.trim()}`);
  const said = care.lines.filter((l) => l.kind === "said").map((l) => l.text.trim()).filter(Boolean);
  const w = careLiveWatch();
  // Shapes match POST /api/care/assess exactly (objects, booleans, enum source).
  const nowIso = new Date().toISOString();
  const src = { file: "file", upload: "file", files: "file", bridge: "gopro", gopro: "gopro", camera: "camera" }[care.src] || null;
  return {
    mode: accessMode,
    transcript: [...saved.map(n => ({ at: n.at, speaker: n.speaker || "saved", text: n.text.slice(0,500) })), ...[...bandLines, ...heard].slice(-30).map((text) => ({ at: nowIso, speaker: text.startsWith("Heard: ") ? "video/mic" : "band", text: text.slice(0, 500) }))],
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
  care.history.push({ status, summary: d.summary || CARE_STATUS_WORD[status], next_step: d.next_step || "", at });
  if (care.history.length > 60) care.history.shift();
  const box = $("care-history");
  box.replaceChildren(...care.history.slice().reverse().map((h) => el("li", {}, el("span", { className: `dotk ${h.status}`, "aria-hidden": "true" }), el("time", { textContent: h.at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) }), el("span", { textContent: `${CARE_STATUS_WORD[h.status]} · ${h.summary}` }))));
  box.scrollTop = 0;
  $("care-agent-state").textContent = `Checked ${at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}${d.engine ? ` · ${d.engine}` : ""}.`;
  if (status === "urgent" && (care.lastStatus !== "urgent" || Date.now() - care.lastTapAt > 5 * 60000)) emergency.trigger({ reason: d.summary || "Possible emergency", note: d.caregiver_note || d.next_step || "" });
  if (!isFictionalDemo() && status === "urgent" && (care.lastStatus !== "urgent" || Date.now() - care.lastTapAt > 5 * 60000)) {
    care.lastTapAt = Date.now();
    sendHaptic("notification", (d.next_step || d.summary || "Please check in").slice(0, 80));
    try { if ("Notification" in window && Notification.permission === "granted") new Notification("Threadline · please check in", { body: d.caregiver_note || d.summary || d.next_step || "" }); } catch { /* not allowed */ }
    if (typeof logAction === "function") logAction("Caregiver agent: urgent, tapped the watch");
  }
  care.lastStatus = status;
  if (location.hash === "#dashboard" || !location.hash) drawDashboard();
}
const emergency = mountEmergency({ el, onLog: (t) => { try { logAction(t); } catch { /* not ready */ } } });
function renderContacts() { const c = loadContacts(); if (!$("ec-name")) return; $("ec-name").value = c.name; $("ec-phone").value = c.phone; $("ec-services").value = c.services; }
$("ec-form")?.addEventListener("submit", (e) => { e.preventDefault(); saveContacts({ name: $("ec-name").value.trim(), phone: $("ec-phone").value.trim(), services: $("ec-services").value.trim() || "911" }); $("ec-msg").textContent = "Saved. A possible-incident countdown opens your dialer for this contact. You place the call; completion is not verified."; });
renderContacts();
$("care-sim-fall")?.addEventListener("click", () => { emergency.trigger({ reason: "Simulated fall signal", note: "Demonstration only. No physical band event or injury was observed." }); careLog("note", "Demo: simulated fall signal; no physical band event.", true); });
async function careAssess(manual) {
  if (!isFictionalDemo() && !$("care-consent").checked && !$("rec-consent").checked) return;
  if (isFictionalDemo() && (!manual || !processingConsent())) return;
  if (care.agentBusy) { if (manual) $("care-agent-state").textContent = "A check is already running…"; return; }
  care.agentBusy = true; $("care-check").disabled = true; $("care-agent-state").textContent = "Checking…";
  const scope = workspaceVersion, selectedMode = accessMode;
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 30000);
  try {
    const r = await fetch("/api/care/assess", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ context: careContext(), engine: "gemini" }), signal: ctl.signal });
    if (r.status === 404 || r.status === 405) throw new Error("unavailable");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const result = await r.json();
    if (scope !== workspaceVersion || selectedMode !== accessMode) return;
    careRenderAssessment(result);
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
    if (care.src === "file" && !care.files.length && !isFictionalDemo()) { care.files = [{ url: "/static/scenarios/memory-stove.mp4", name: "Stove left on (scenario)", size: 0 }]; care.idx = 0; try { carePlayIndex(0); } catch { /* */ } }
    renderCareRoutine(); loadCareHealth(); careShowMedia(); careRenderPlaylist();
    if (careStill()) careBridgeOn();
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
renderAccessMode();
showView(location.hash.slice(1) || "dashboard");
if (location.hash === "#library") openLibrary();
setTimeout(openEssentials, 0);
/* Talk to Threadline (dashboard): voice in through the Vexo band or the mic, Gemini decides, the page acts. */
function assistantContext() {
  const h = hLatest() || {}, last = (typeof care !== "undefined" ? care.history : []).at(-1), c = loadContacts();
  return { now: new Date().toString(), mode: accessMode, person: "the person Threadline supports",
    health_today: Object.fromEntries(Object.entries(h).filter(([k, v]) => k !== "workout_types" && v != null)),
    health_30d_days: ownerHealth.days, last_care_check: last ? { status: last.status, summary: last.summary, at: last.at } : null,
    tasks: (life.tasks || []).filter((t) => !t.done).map((t) => t.title).slice(0, 12), suggested_tasks: (life.taskDrafts || []).map((d) => d.title).slice(0, 8),
    cart: shop?.summary() || null, emergency_contact: c.name || null, band_connected: Boolean(capture.band),
    conversation_mode: typeof assistantMode !== "undefined" ? assistantMode : "normal", energy_now: life.energy ? { state: life.energy.state, word: life.energy.word } : null,
    mood_today: moodOf(todayKey()) || null, current_view: (location.hash || "#dashboard").slice(1),
    scenarios: (typeof scenarioCache !== "undefined" && scenarioCache ? scenarioCache : []).map((x) => ({ id: x.id, title: x.title, mode: x.mode })) };
}
const VOICE_SECTIONS = {assistant: ["dashboard", "#assistant"], calendar: ["dashboard", "#calendar-card"], phone_camera: ["dashboard", "#phonecam-card"], reports: ["dashboard", ".dash-reports"], health_charts: ["dashboard", ".dash-charts"], modes: ["dashboard", ".access-picker"], live_guidance: ["care", "#care-live"], care_agent: ["care", "#care-agent"], emergency_contacts: ["care", "#ec-form"], routine: ["care", "#care-routine"], health_card: ["care", "#care-health"], video_source: ["care", "#care-src-h"], checkin_form: ["energy", "#mood-checkin"], mood_chart: ["energy", "#mood-chart"], wellbeing_today: ["energy", "#wb-today"], music: ["energy", ".music-card"], cart: ["essentials", ".ess-cart"], suggested_items: ["essentials", ".ess-sug"], saved_card: ["essentials", ".ess-wallet"], task_list: ["tasks", "#tasks-today"], task_calendar: ["tasks", ".tasks-cal"], add_task_form: ["tasks", "#task-form"], task_suggestions: ["tasks", "#task-banner"], day_board: ["today", "#day-board"], todo_list: ["today", ".db-list.todo"], done_list: ["today", ".db-list.done"], daily_table: ["days", ".days-wrap"], what_happened: ["days", ".dl-actions"], health_summary: ["days", "#days-summary"], memory_graph: ["graph", "#memory-graph"], transcripts: ["transcripts", "#archive"], scenario_grid: ["library", ".lib-grid"], band_connect: ["live", "#pair"], live_transcript: ["live", "#live-lines"]};
let assistantMode = "normal";
async function assistantAction(a) {
  const result = await assistantActionRun(a);
  const chip = result && typeof result === "object" ? result.chip : result;
  if (chip && !["add_task", "emergency", "add_note", "get_dashboard", "recall", "get_calendar", "open_section", "open_view", "set_conversation_mode", "list_tasks"].includes(a.type)) { try { logAction(`Voice · ${chip}`); } catch { /* */ } }
  return result;
}
const MOOD_VALUE = { very_low: -0.8, low: -0.4, neutral: 0, content: 0.4, happy: 0.8 }, AGI_VALUE = { none: 0, mild: 1, moderate: 2, severe: 3 };
function memorySearch(query) {
  const q = String(query || "").toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  const score = (text) => q.reduce((n, w) => n + (String(text).toLowerCase().includes(w) ? 1 : 0), 0);
  const notes = [...sessions.reflection.notes, ...sessions.routine.notes].map((n) => ({ text: n.text, at: n.at, source: n.context || n.source || "note" }));
  const lines = loadArchive().flatMap((t) => t.lines.map((l) => ({ text: l.text, at: l.at, source: "conversation" })));
  return [...notes, ...lines].map((x) => ({ ...x, s: score(x.text) })).filter((x) => x.s > 0).sort((p, q2) => q2.s - p.s || String(q2.at).localeCompare(String(p.at))).slice(0, 8)
    .map(({ text, at, source }) => ({ text: text.slice(0, 240), at, source }));
}
async function assistantActionRun(a) {
  if (a.type === "get_dashboard") return { data: assistantContext() };
  if (a.type === "remember") {
    const fact = String(a.fact || "").trim(); if (!fact) return null;
    const note = { id: newId("n"), text: fact, at: new Date().toISOString(), source: "voice", context: `Remembered by voice · ${a.kind || "other"}` };
    sessions.reflection.notes.push(note); saveThread(); renderTimeline?.(); try { scheduleGraph(0); } catch { /* graph idle */ }
    return { chip: `Remembered: ${fact.slice(0, 60)}`, data: { saved: true } };
  }
  if (a.type === "recall") { const found = memorySearch(a.query); return { chip: found.length ? `Found ${found.length} memories` : null, data: { query: a.query, results: found } }; }
  if (a.type === "get_calendar") {
    try { const d = await request(`/api/calendar/events?days=${Math.max(1, Math.min(30, a.days || 7))}&tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}${a.query ? `&q=${encodeURIComponent(a.query)}` : ""}`);
      return { chip: `Checked calendar · ${d.events?.length || 0} events`, data: { events: (d.events || []).slice(0, 25), calendars: d.calendars } }; }
    catch (e) { return { data: { error: /Not Found|404/.test(e.message) ? "No calendar connected yet. Connect one on the Dashboard (Your calendar)." : e.message } }; }
  }
  if (a.type === "add_calendar_event") {
    const start = new Date(a.start); if (Number.isNaN(start.getTime())) return { data: { error: "I need a valid date and time." } };
    const end = new Date(start.getTime() + (a.minutes || 60) * 60000), fmtG = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(a.title)}&dates=${fmtG(start)}/${fmtG(end)}${a.location ? `&location=${encodeURIComponent(a.location)}` : ""}&details=${encodeURIComponent("Added by voice with Threadline")}`;
    (life.taskDrafts ||= []).unshift({ id: newId("draft"), title: `${a.title} · ${start.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}`, due: todayKey(start), big: false,
      suggested: { id: `cal-${Date.now()}`, source: "Voice · calendar", why: `Open Google Calendar to save it: ${url}` }, statement: { id: `cal:${Date.now()}`, text: a.title, speaker_confirmed: true } });
    renderTasks(); saveThread();
    return { chip: `Calendar event ready: ${a.title}`, data: { ready_to_confirm: true, google_calendar_link: url } };
  }
  if (a.type === "add_routine_step") {
    const step = String(a.step || "").trim(); if (!step) return null;
    try { const r = careRoutine(); if (!r.includes(step)) { r.push(step); localStorage.setItem(careRoutineKey(), JSON.stringify(r.slice(0, 12))); renderCareRoutine(); } } catch { /* */ }
    return `Routine step added: ${step}`;
  }
  if (a.type === "set_emergency_contact") {
    const name = String(a.name || "").trim(), phone = String(a.phone || "").replace(/[^\d+ ]/g, "").trim();
    if (!name || phone.replace(/\D/g, "").length < 6) return { data: { error: "I need a name and a full phone number." } };
    saveContacts({ ...loadContacts(), name, phone }); renderContacts();
    return `Emergency contact: ${name} (${phone})`;
  }
  if (a.type === "add_note") { const text = String(a.text || "").trim(); if (!text) return null; logAction(`Note · ${text.slice(0, 200)}`); return `Note saved for the caregiver`; }
  if (a.type === "log_checkin") {
    const log = loadMoodLog(), day = todayKey(), cur = log[day] || {}, period = a.period || (new Date().getHours() < 14 ? "morning" : "evening");
    if (a.mood) cur[period] = MOOD_VALUE[a.mood];
    if (a.agitation) cur.agitation = AGI_VALUE[a.agitation];
    if (a.repeats != null) cur.repeats = a.repeats;
    if (a.note) cur.note = a.note;
    log[day] = { ...cur, at: new Date().toISOString(), by: "voice" };
    try { localStorage.setItem(moodLogKey(), JSON.stringify(log)); } catch { /* storage off */ }
    rebuildMood(); renderMood(); renderDays(); drawDashboard(); renderToday();
    return `Logged ${[a.mood ? `${period} mood: ${a.mood.replace("_", " ")}` : "", a.agitation ? `agitation: ${a.agitation}` : "", a.repeats != null ? `${a.repeats} repeated questions` : ""].filter(Boolean).join(" · ")}`;
  }
  if (a.type === "log_energy" && a.state === "low") { document.body.classList.add("comfort-mode"); assistantMode = "comfort"; }
  if (a.type === "log_checkin" && ["low", "very_low"].includes(a.mood)) { document.body.classList.add("comfort-mode"); assistantMode = "comfort"; }
  if (a.type === "log_energy") {
    const at = new Date().toISOString();
    // Energy is derived from saved statements, so keep the voice report as one (it survives reloads and shows on every screen).
    sessions.reflection.notes.push({ id: newId("n"), text: `I feel ${a.word}.`, at, source: "voice", context: "Energy said to Threadline", energySignal: { state: a.state, quote: a.word } });
    try { rebuildWordRecords(); } catch { life.energy = { state: a.state, at, text: a.word, word: a.word }; }
    saveThread(); renderEnergy(); renderToday(); renderDays(); drawDashboard();
    return `Energy logged: ${a.state} (“${a.word}”)`;
  }
  if (a.type === "add_to_cart") { openEssentials(); return shop?.add(a.id, a.qty || 1); }
  if (a.type === "remove_from_cart") { openEssentials(); return shop?.remove(a.id); }
  if (a.type === "buy") {
    openEssentials(); const lines = shop?.snapshot() || [];
    if (!lines.length) return null;
    if (!shop.walletSaved()) { location.hash = "essentials"; return "No saved card yet: order opened for caregiver checkout"; }
    // A model-generated confirmation is not the person's consent to charge a card.
    pendingBuy = { lines, at: Date.now(), requestId: crypto.randomUUID() }; return `Waiting for your OK · ${shop.totalText()}`;
  }
  if (a.type === "checkout") { openEssentials(); location.hash = "essentials"; return `Order ready for caregiver approval · ${shop?.totalText() || ""}`; }
  if (a.type === "open_view") { location.hash = a.view; return `Opened ${VIEW_TITLES[a.view] || a.view}`; }
  if (a.type === "add_task") {
    const due = /^\d{4}-\d{2}-\d{2}$/.test(a.due || "") ? a.due : todayKey(), time = /^\d{1,2}:\d{2}$/.test(a.time || "") ? a.time : "";
    const t = { id: newId("t"), title: a.title, due, time, big: Boolean(a.big), done: false, note: `By voice${time ? ` · ${time}` : ""}`, voice: true };
    (life.tasks ||= []).push(t); saveThread(); renderTasks(); flashTasks(t.id); logAction(`Task added by voice: ${a.title}${time ? ` at ${time}` : ""}${due !== todayKey() ? ` on ${due}` : ""}`);
    return `Task added: ${a.title}${time ? ` · ${time}` : ""}${due !== todayKey() ? ` · ${due}` : ""}`;
  }
  if (a.type === "complete_task") {
    const words = String(a.title || "").toLowerCase().split(/\W+/).filter((w) => w.length > 2);
    const t = (life.tasks || []).filter((x) => !x.done).map((x) => ({ x, n: words.filter((w) => x.title.toLowerCase().includes(w)).length })).sort((p, q) => q.n - p.n)[0];
    if (!t || !t.n) return { data: { error: "No open task matches that." } };
    t.x.done = true; t.x.doneAt = new Date().toISOString(); saveThread(); renderTasks(); logAction(`Task done by voice: ${t.x.title}`); return `Done: ${t.x.title}`;
  }
  if (a.type === "open_section") {
    const [view, sel] = VOICE_SECTIONS[a.section] || []; if (!view) return null;
    location.hash = view;
    if (view === "essentials") openEssentials(); if (view === "library") openLibrary();
    setTimeout(() => { const node = document.querySelector(sel); if (!node) return; node.scrollIntoView({ behavior: "smooth", block: "center" }); node.classList.remove("voice-focus"); void node.offsetWidth; node.classList.add("voice-focus"); setTimeout(() => node.classList.remove("voice-focus"), 3200); }, 450);
    return `Showing ${a.section.replace(/_/g, " ")}`;
  }
  if (a.type === "set_conversation_mode") {
    const on = a.mode === "comfort"; document.body.classList.toggle("comfort-mode", on); assistantMode = on ? "comfort" : "normal";
    if (on) logAction(`Comfort mode on${a.reason ? ` · ${a.reason}` : ""}`);
    return on ? "💛 Comfort mode" : "Back to normal";
  }
  if (a.type === "open_scenario") {
    location.hash = "library"; openLibrary(); setTimeout(() => library?.open?.(a.id), 400);
    return `Opened scenario: ${a.id.replace(/-/g, " ")}`;
  }
  if (a.type === "start_live_guidance") {
    location.hash = "care";
    if (!$("care-consent")?.checked) return { chip: "Care opened · tick consent to start", data: { needs_consent: true } };
    try { await careStart(); return "Live guidance started"; } catch (e) { return { data: { error: e.message } }; }
  }
  if (a.type === "list_tasks") {
    let events = [];
    try { const d = await request(`/api/calendar/events?days=1&tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`); events = (d.events || []).map((e) => ({ title: e.title, start: e.start })); } catch { /* none */ }
    return { data: { open_tasks: (life.tasks || []).filter((x) => !x.done).map((x) => ({ title: x.title, due: x.due, time: x.time || null })), today_events: events } };
  }
  if (a.type === "care_check") { careAssess(true); return "Care check started"; }
  if (a.type === "set_mode") { selectAccessMode(a.mode); return `${ACCESS_MODES[a.mode]?.label || a.mode} mode`; }
  if (a.type === "emergency") { emergency.trigger({ reason: a.reason || "Help requested by voice", note: "Asked for help out loud." }); return "Emergency alert started"; }
  return null;
}
let realtimeBandPush = null;
const bandPcm = {  // decoded band PCM for the OpenAI Realtime engine (band only; the computer mic is never used there)
  on: () => Boolean(capture.band && capture.active && capture.decoder),
  attach(push) { realtimeBandPush = push; return () => { if (realtimeBandPush === push) realtimeBandPush = null; }; },
};
/* Every Talk to Threadline exchange is kept: a daily "Talk to Threadline" transcript, and what the person said becomes a memory. */
function saveTalkTurn({ role, text, lang, english }) {
  const t = String(text || "").trim(); if (!t) return;
  const now = new Date(), day = todayKey(now), id = `talk-${day}`;
  const list = loadArchive(); let sess = list.find((x) => x.id === id);
  if (!sess) { sess = { id, startedAt: now.toISOString(), endedAt: now.toISOString(), source: "voice", device: capture.band ? `${bandLabel()} · Talk to Threadline` : "Talk to Threadline", title: "Talk to Threadline", marks: 0, lines: [] }; list.unshift(sess); }
  sess.lines.push({ at: now.toISOString(), offset: (now - new Date(sess.startedAt)) / 1000, speakers: [role === "user" ? 0 : 1], text: english && english !== t ? `${t} (${english})` : t, provider: "assistant", activity: "", hr: null, marked: false, ...(lang ? { language: lang } : {}) });
  sess.endedAt = now.toISOString(); saveArchive([sess, ...list.filter((x) => x.id !== id)]); try { renderArchive(); } catch { /* */ }
  const isCommand = /^(please\s+)?(show|open|go|take me|navigate|start|stop|check out|order|buy|remind|add|put|play|switch|turn|scroll|close|cancel|yes|no|okay|ok)\b/i.test(t);
  if (role === "user" && !isCommand && t.split(/\s+/).length >= 3) {
    sessions.reflection.notes.push({ id: newId("n"), text: english && english !== t ? `${t} (${english})` : t, at: now.toISOString(), source: "voice", context: "Said to Threadline" });
    saveThread(); try { renderTimeline(); scheduleGraph(4000); } catch { /* */ }
  }
}
let pendingBuy = null;
async function assistantIntercept(text) {
  if (!pendingBuy || Date.now() - pendingBuy.at > 120000) { pendingBuy = null; return null; }
  const reply = purchaseReply(text);
  if (reply === "cancel") { pendingBuy = null; return { say: "Okay, I won't buy it. The items are still in your cart.", done: "Order not placed" }; }
  if (reply !== "confirm") return { say: "Please say just yes to confirm this purchase, or no to cancel.", done: null };
  const pending = pendingBuy;
  try {
    const who = loadContacts().name, d = await shop.buy(pending.lines, who || "Caregiver (voice)", pending.requestId);
    pendingBuy = null;
    if (d.status !== "succeeded") return { say: "Payment is not confirmed. Please review the order on Essentials.", done: null };
    return { say: d.test_mode ? "The test payment succeeded. No real charge was made." : `Payment of $${d.amount_usd.toFixed(2)} succeeded on the ${d.card}.`, done: `${d.test_mode ? 'Test payment' : 'Payment'} succeeded · $${d.amount_usd.toFixed(2)}` };
  } catch (e) { return { say: `Payment could not be confirmed: ${e.message}. Say yes to retry the same request, or no to cancel.`, done: null }; }
}
const assistant = $("assistant") ? mountAssistant($("assistant"), { el, request, getContext: assistantContext, runAction: assistantAction, intercept: assistantIntercept, onTurn: saveTalkTurn, bandOn: () => Boolean(capture.band && capture.active), bandPcm,
  ensureBand: async () => { if (!capture.band) return false; if (!$("rec-consent").checked) return false; if (!capture.active && !busy) { autoRec.userStopped = false; $("rec-start").click(); await new Promise((r) => setTimeout(r, 2500)); } return Boolean(capture.active); } }) : null;
$("assistant-fab")?.addEventListener("click", () => { const open = document.body.classList.toggle("as-open"); $("assistant-fab").setAttribute("aria-expanded", String(open)); $("assistant-fab").textContent = open ? "✕ Close" : "🎙 Talk to Threadline"; });
placeAssistant((location.hash || "#dashboard").slice(1));
if ($("calendar-card")) mountCalendar($("calendar-card"), { el, request });
if ($("phonecam-card")) mountPhoneCam($("phonecam-card"), { el, request, onFrameSource: (code) => { care.phoneCode = code; if (care.src === "phone") careBridgeStatus(); },
  onTalk: (code) => { care.phoneCode = code; location.hash = "care"; careSetSource("phone"); setTimeout(careStart, 300); } });
if (location.hash === "#tasks") setTimeout(renderTasks, 300);
renderProfile();
renderPublish(); loadDemoTranscript(); startDemoFeed();
loadOwnerHealth(); renderSampleBanner();
/* Keep the owner's band connected: reopen the USB port this site was already allowed to use — on load,
   whenever the cable is plugged back in, and every 10 s while disconnected. No chooser, no re-pairing. */
async function autoConnectBand() {
  if (!bandNumber || capture.band || pair.busy) return;
  // 1) USB: any port this site may already use.
  if (navigator.serial?.getPorts) {
    let ports = [];
    try { ports = await navigator.serial.getPorts(); } catch { ports = []; }
    for (const port of ports) {
      if (capture.band || pair.busy) return;
      if (port.readable) continue;  // already open in this page
      await connectBand("serial", port);
    }
  }
  if (capture.band || pair.busy) return;
  // 2) Bluetooth: the band this site was already allowed to use (Chrome/Edge remember it), matched by its name.
  if (navigator.bluetooth?.getDevices) {
    let devices = [];
    try { devices = await navigator.bluetooth.getDevices(); } catch { devices = []; }
    const wanted = bandLabel();
    const dev = devices.find((d) => d.name === wanted);
    if (!dev) return;
    if (dev.watchAdvertisements && !dev.__threadlineWatching) {  // wake the GATT link once the band is heard nearby
      dev.__threadlineWatching = true;
      dev.addEventListener("advertisementreceived", () => { if (!capture.band && !pair.busy) connectBand("ble", dev); });
      try { await dev.watchAdvertisements(); } catch { /* not supported: try a direct connect */ }
    }
    await connectBand("ble", dev);
  }
}
try { localStorage.setItem("threadline.lastBand", String(bandNumber || "")); } catch { /* */ }
navigator.serial?.addEventListener?.("connect", () => setTimeout(autoConnectBand, 800));
setTimeout(autoConnectBand, 600);
setInterval(autoConnectBand, 10000);
$("sample-clear")?.addEventListener("click", clearSample);
$("sample-load")?.addEventListener("click", loadSample);
$("sample-exit")?.addEventListener("click", exitSample);
$("sample-ask")?.addEventListener("click", () => {
  if (!processingConsent()) { $("sample-consent").focus(); return message("Allow sending the fictional notes to Google first.", true); }
  mode = "routine"; sessions.routine.question = DEMO_QUESTIONS[accessMode]; render(); location.hash = "thread";
  $("question-form").requestSubmit();
});
