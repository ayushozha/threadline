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
const SOURCE_LABELS = { fictional: "Fictional demo history", typed: "Typed", mic: "Browser mic · reviewed", upload: "Audio file · reviewed", scripted: "Scripted demo transcript" };

const demos = {
  reflection: {
    description: "Personal reflection: keep your own words with their source, revisit them later, and get only the support you chose. Cycle timing is optional self-reported context — never a cause, diagnosis, or judgment.",
    question: "What helped last time I felt overloaded?",
    notes: [
      { text: "Keeping an evening free helped when I felt overloaded.", at: ago(61, 21, 10), context: "Self-reported: late in my cycle (approximate)" },
      { text: "I said yes to three dinners this week and regretted the last one. I was too drained to enjoy it.", at: ago(58, 22, 5) },
      { text: "Felt foggy in the afternoon meeting and lost track of what I'd promised. Writing it down after helped.", at: ago(30, 16, 40), context: "Self-reported: cycle day 25 (approximate)" },
      { text: "A short walk after work helped more than scrolling.", at: ago(29, 19, 15) },
    ],
    prefs: [{ text: "When I describe feeling overloaded, offer to help make space in my schedule.", triggers: ["overloaded", "exhausted", "drained", "too much", "burned out", "wiped"], action: "schedule", at: ago(60, 9, 30), source: "fictional" }],
  },
  routine: {
    description: "Resume a routine: recover your stated intention and the last thing you recorded. A recorded action is not proof it happened — Threadline asks when progress is unknown.",
    question: "Where did I leave off packing?",
    notes: [
      { text: "I'm packing for the family visit on Saturday: clothes, phone charger, and the gift for Mom.", at: ago(0, new Date().getHours() - 2, 5) },
      { text: "Clothes are in the suitcase.", at: ago(0, new Date().getHours() - 2, 20) },
      { text: "Doorbell — going to get the delivery.", at: ago(0, new Date().getHours() - 2, 24) },
    ],
    prefs: [],
  },
};

const day = tomorrow();
const seedCalendar = () => [
  { id: "cal-1", title: "Lunch with Priya", date: day, start: "12:00", end: "13:00" },
  { id: "cal-2", title: "Project review", date: day, start: "13:00", end: "14:00" },
  { id: "cal-3", title: "Dentist", date: day, start: "15:30", end: "16:15" },
  { id: "cal-4", title: "Book club", date: day, start: "18:30", end: "20:30" },
];

let mode = "reflection", busy = false;
const sessions = Object.fromEntries(Object.entries(demos).map(([key, demo]) => [key, {
  sample: true, question: demo.question,
  notes: demo.notes.map((n, i) => ({ id: `${key}-${i + 1}`, source: "fictional", context: "", ...n })),
  prefs: demo.prefs.map((p, i) => ({ id: `pref-${i + 1}`, ...p })),
}]));
const agent = { offer: null, events: seedCalendar(), proposal: null, skip: [], log: [], created: null, duration: 30, window: "afternoon" };
const capture = { recorder: null, chunks: [], blob: null, url: "", startedAt: null, timer: 0, review: null };

function message(text, error = false) { $("status").textContent = text; $("status").classList.toggle("error", error); }
function newId(prefix) { return `${prefix}-${crypto.randomUUID().slice(0, 8)}`; }

/* ---------- Thread ---------- */
function renderTimeline() {
  const session = sessions[mode];
  $("sample-label").textContent = session.sample ? "Entries marked “Fictional demo history” are invented examples — not real observations." : "Session notes · kept in this page only";
  $("timeline").replaceChildren();
  for (const note of session.notes) {
    const time = el("time", { dateTime: note.at, textContent: fmtWhen(note.at) }, el("span", { className: "note-id", textContent: note.id }));
    const badge = el("span", { className: `badge ${note.source}`, textContent: SOURCE_LABELS[note.source] || note.source });
    const text = el("p", { textContent: note.text });
    const li = el("li", { id: `note-${note.id}` }, time, el("div", { className: "meta" }, badge, el("span", { className: "speaker", textContent: "Speaker: you" })), text);
    if (note.context) li.append(el("p", { className: "context", textContent: note.context }));
    if (note.source !== "fictional") {
      const edit = el("button", { type: "button", className: "text-button", textContent: "Correct" });
      const del = el("button", { type: "button", className: "text-button", textContent: "Delete" });
      edit.addEventListener("click", () => editNote(li, note));
      del.addEventListener("click", () => { session.notes = session.notes.filter((n) => n !== note); renderTimeline(); message("Note deleted from this session."); });
      li.append(el("div", { className: "row tight" }, edit, del));
    }
    $("timeline").append(li);
  }
  if (!session.notes.length) $("timeline").append(el("p", { className: "empty", textContent: "A fresh thread. Capture or type your first note." }));
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
  $("prefs-section").hidden = mode !== "reflection";
  const list = $("prefs"); list.replaceChildren();
  for (const pref of sessions[mode].prefs) {
    const remove = el("button", { type: "button", className: "text-button", textContent: "Remove" });
    remove.addEventListener("click", () => { sessions[mode].prefs = sessions[mode].prefs.filter((p) => p !== pref); renderPrefs(); });
    list.append(el("li", {},
      el("p", { textContent: `“${pref.text}”` }),
      el("p", { className: "caption", textContent: `Matches: ${pref.triggers.join(", ")} · ${pref.action === "schedule" ? "offers schedule help" : "shows earlier notes only"} · saved ${fmtDate(pref.at)}${pref.source === "fictional" ? " · fictional demo" : ""}` }),
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
    el("li", {}, el("strong", { textContent: "You saved: " }), `“${offer.pref.text}” `, el("span", { className: "caption", textContent: `${fmtDate(offer.pref.at)}${offer.pref.source === "fictional" ? " · fictional demo" : ""}` })),
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

/* ---------- Demo calendar agent ---------- */
const WINDOWS = { afternoon: ["12:00", "17:00", "tomorrow afternoon"], evening: ["17:00", "21:00", "tomorrow evening"], morning: ["08:00", "12:00", "tomorrow morning"] };
function logStep(text, kind = "") { agent.log.push({ text, kind }); }
async function postJSON(url, body) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}
async function findSlot() {
  const [start, end] = WINDOWS[agent.window];
  logStep(`Checking the demo calendar for ${agent.duration} minutes ${WINDOWS[agent.window][2]}…`);
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
    logStep(`Created “${data.event.title}” ${fmtClock(data.event.start)}–${fmtClock(data.event.end)} in the demo calendar.`, "good");
    message("Action complete · demo calendar only, no external calendar changed");
  } else if (status === 409) {
    const names = (data.conflicts || []).map((c) => `“${c.title}”`).join(", ");
    logStep(`Conflict: ${names} now occupies that time. Nothing was created.`, "bad");
    logStep("Your preference and request are unchanged. Looking again…");
    agent.proposal = null; await findSlot();
  } else { logStep("Booking failed. Nothing was created.", "bad"); }
}
function renderCalendar() {
  const box = $("calendar");
  box.hidden = mode !== "reflection" || agent.offer?.status !== "accepted";
  if (box.hidden) return;
  const events = agent.events.filter((e) => e.date === day).sort((a, b) => a.start.localeCompare(b.start));
  const list = el("ul", { className: "events" }, ...events.map((e) => el("li", { className: e.created_by === "threadline" ? "mine" : e.injected ? "injected" : "" },
    el("span", { className: "when", textContent: `${fmtClock(e.start)}–${fmtClock(e.end)}` }), el("span", { textContent: e.title }),
    e.created_by === "threadline" ? el("span", { className: "badge typed", textContent: "created by Threadline" }) : e.injected ? el("span", { className: "badge scripted", textContent: "demo conflict" }) : null)));
  const dateLabel = new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
  const duration = el("select", { id: "cal-duration" }, ...[15, 30, 60].map((m) => el("option", { value: m, textContent: m === 30 ? "thirty minutes" : `${m} minutes`, selected: m === agent.duration })));
  const windowSel = el("select", { id: "cal-window" }, ...Object.entries(WINDOWS).map(([k, w]) => el("option", { value: k, textContent: w[2], selected: k === agent.window })));
  duration.addEventListener("change", () => { agent.duration = Number(duration.value); });
  windowSel.addEventListener("change", () => { agent.window = windowSel.value; });
  const find = el("button", { type: "button", className: "secondary", textContent: "Find a time" });
  find.addEventListener("click", () => run(async () => { agent.skip = []; agent.proposal = null; await findSlot(); }));
  const children = [
    el("p", { className: "eyebrow", textContent: "Approved action" }),
    el("h3", { textContent: `Demo calendar · ${dateLabel}` }),
    el("p", { className: "caption warn", textContent: "Local demo calendar held in this browser. Not connected to Google Calendar or any external calendar." }),
    list,
    el("div", { className: "ask-line" }, el("span", { textContent: "Find " }), duration, el("span", { textContent: " " }), windowSel, find),
  ];
  if (agent.log.length) children.push(el("ol", { className: "agent-log", "aria-label": "What Threadline checked" }, ...agent.log.map((s) => el("li", { className: s.kind, textContent: s.text }))));
  if (agent.proposal) {
    const p = agent.proposal;
    const approve = el("button", { type: "button", className: "primary", innerHTML: `Create quiet time ${fmtClock(p.start)}–${fmtClock(p.end)} <span aria-hidden="true">✓</span>` });
    const other = el("button", { type: "button", className: "secondary", textContent: "Try another time" });
    const conflict = el("button", { type: "button", className: "text-button demo-control", textContent: "Demo control: someone else books this slot" });
    approve.addEventListener("click", () => run(bookProposal));
    other.addEventListener("click", () => run(async () => { agent.skip.push(p.start); logStep(`You declined ${fmtClock(p.start)}.`); await findSlot(); }));
    conflict.addEventListener("click", () => {
      agent.events.push({ id: newId("cal"), title: "Call with landlord", date: p.date, start: p.start, end: p.end, injected: true });
      logStep(`(Demo control) “Call with landlord” was added at ${fmtClock(p.start)} by someone else.`, "muted");
      renderCalendar(); message("Calendar changed underneath the proposal. Approve to see Threadline re-check.");
    });
    children.push(el("div", { className: "proposal" }, approve, el("div", { className: "row" }, other, conflict)));
  }
  if (agent.created) {
    const undo = el("button", { type: "button", className: "text-button", textContent: "Undo — remove the quiet time" });
    undo.addEventListener("click", () => { agent.events = agent.events.filter((e) => e.id !== agent.created.id); logStep("Removed the quiet time block from the demo calendar."); agent.created = null; renderCalendar(); });
    children.push(el("p", { className: "done", textContent: `Done: “${agent.created.title}” is on the demo calendar, ${fmtClock(agent.created.start)}–${fmtClock(agent.created.end)}.` }), undo);
  }
  box.replaceChildren(...children);
}
async function run(task) { if (busy) return; setBusy(true); try { await task(); } catch (error) { message(error.message || "Something went wrong.", true); } finally { setBusy(false); renderCalendar(); } }

/* ---------- Capture & review ---------- */
function setRecUI() {
  const recording = capture.recorder?.state === "recording";
  $("rec-start").disabled = busy || recording;
  $("rec-stop").disabled = !recording;
  $("rec-delete").disabled = busy || recording || !capture.blob;
  $("rec-transcribe").disabled = busy || recording || !capture.blob;
  $("rec-start").classList.toggle("recording", recording);
}
$("rec-start").addEventListener("click", async () => {
  if (!$("rec-consent").checked) return recState("Confirm recording consent first.", true);
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return recState("This browser cannot record audio. Upload a file or use the scripted conversation.", true);
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    deleteRecording();
    capture.chunks = []; capture.startedAt = new Date();
    capture.recorder = new MediaRecorder(stream);
    capture.recorder.ondataavailable = (e) => { if (e.data.size) capture.chunks.push(e.data); };
    capture.recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop()); clearInterval(capture.timer);
      capture.blob = new Blob(capture.chunks, { type: capture.recorder.mimeType || "audio/webm" });
      capture.url = URL.createObjectURL(capture.blob); $("rec-audio").src = capture.url; $("rec-audio").hidden = false;
      recState(`Recording stopped · ${Math.round(capture.blob.size / 1024)} KB held in this page only. Transcribe it or delete it.`); setRecUI();
    };
    capture.recorder.start();
    capture.timer = setInterval(() => {
      const s = Math.round((Date.now() - capture.startedAt) / 1000);
      recState(`● Recording from this browser's microphone · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
      if (s >= 120) capture.recorder.stop();
    }, 500);
    recState("● Recording from this browser's microphone · 0:00"); setRecUI();
  } catch { recState("Microphone permission was not granted. Nothing was recorded.", true); }
});
$("rec-stop").addEventListener("click", () => capture.recorder?.stop());
$("rec-delete").addEventListener("click", () => { deleteRecording(); recState("Recording deleted from this page."); });
function deleteRecording() { if (capture.url) URL.revokeObjectURL(capture.url); capture.blob = null; capture.url = ""; $("rec-audio").removeAttribute("src"); $("rec-audio").hidden = true; setRecUI(); }
function recState(text, error = false) { $("rec-state").textContent = text; $("rec-state").classList.toggle("error", error); }

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
$("rec-transcribe").addEventListener("click", async () => { try { await transcribe(capture.blob, "mic"); } catch (e) { recState(e.message, true); } });
$("transcribe").addEventListener("click", async () => {
  try { const file = $("audio").files[0]; if (!file) throw new Error("Choose an audio file first."); capture.startedAt = new Date(); await transcribe(file, "upload"); $("audio").value = ""; }
  catch (e) { recState(e.message, true); }
});
$("scripted").addEventListener("click", () => {
  const lines = mode === "reflection"
    ? [{ speaker: 0, text: "I'm exhausted, and I have something scheduled every evening.", offset: 0 }, { speaker: 1, text: "Do you still want to do dinner Thursday?", offset: 5 }]
    : [{ speaker: 0, text: "Okay, back. Where was I with the packing?", offset: 0 }, { speaker: 1, text: "The delivery's on the counter.", offset: 4 }];
  openReview(lines, "scripted", new Date(), "Scripted demo transcript — typed in advance, not captured audio.");
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
    links.append(el("a", { href: `#note-${id}`, textContent: `Source: ${id}${note.source === "fictional" ? " · fictional" : ""}` }));
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
  if (!$("live").checked) throw new Error("Open “Live providers” and enable them to use Deepgram or Gemini.");
  if (!$("consent").checked) throw new Error("Confirm permission before sending notes or audio.");
  if (!$("token").value.trim()) throw new Error("Enter the app access token for live processing.");
  return { "X-App-Token": $("token").value.trim() };
}
async function request(url, options) {
  const response = await fetch(url, options), data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "The request could not be completed.");
  return data;
}
function updateProviderSummary() { $("provider-summary").textContent = $("live").checked ? "· on — requests go to configured providers" : "· off — local demo only"; }
$("live").addEventListener("change", updateProviderSummary);
$("check-config").addEventListener("click", async () => {
  try {
    const token = $("token").value.trim(); if (!token) throw new Error("Enter the access token first.");
    const c = await request("/api/config", { headers: { "X-App-Token": token } });
    $("config-result").textContent = `Gemini: ${c.reflection_ready ? "configured" : "not configured"} · Deepgram: ${c.transcription_ready ? "configured" : "not configured"} · Vexo band: ${c.wearable_connected ? "connected" : "not connected"}`;
  } catch (e) { $("config-result").textContent = e.message; }
});

document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => {
  if (busy) return; sessions[mode].question = $("question").value; mode = button.dataset.mode;
  $("note").value = ""; capture.review = null; $("review").hidden = true; render(); showAnswer("Ask a question to revisit this thread."); message("Local demo · no AI request");
}));
$("question").addEventListener("input", () => { sessions[mode].question = $("question").value; });
$("note-form").addEventListener("submit", (event) => {
  event.preventDefault(); const text = $("note").value.trim(); if (!text || busy) return;
  $("note").value = ""; addNotes([{ text, at: new Date().toISOString(), source: "typed" }]); message("Note added to this session.");
});
$("clear").addEventListener("click", () => {
  if (busy || !confirm("Clear all notes in this demo mode? This cannot be undone.")) return;
  Object.assign(sessions[mode], { notes: [], sample: false }); $("note").value = ""; $("audio").value = "";
  if (mode === "reflection") Object.assign(agent, { offer: null, events: seedCalendar(), proposal: null, skip: [], log: [], created: null });
  render(); showAnswer("Your session notes have been cleared."); message("Fresh session · no saved notes");
});
$("question-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const question = $("question").value.trim(), notes = sessions[mode].notes;
  if (busy || !question) return;
  if (!notes.length) return message("Add a note before asking a question.", true);
  if (!$("live").checked) {
    const stop = new Set(["what", "did", "the", "and", "when", "last", "time", "where", "was", "with", "that", "this", "for", "about", "felt", "feel"]);
    const words = (question.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []).filter((w) => !stop.has(w));
    const matches = notes.filter((note) => words.some((word) => note.text.toLowerCase().includes(word)));
    const selected = matches.length ? matches : notes.slice(-3);
    showAnswer(`${matches.length ? "Your notes that share words with the question:" : "No direct keyword match. Your latest notes:"}\n\n${selected.map((n) => `${fmtDate(n.at)} — “${n.text}”`).join("\n\n")}`, selected.map((n) => n.id), "Local keyword match · not AI · no interpretation");
    return message("Local demo · no data sent");
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
  $("mode-description").textContent = demos[mode].description;
  $("question").value = sessions[mode].question;
  document.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
  renderTimeline(); renderPrefs(); renderSupport(); renderCalendar(); setRecUI();
}
render();
