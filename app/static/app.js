"use strict";
const $ = (id) => document.getElementById(id);
const demos = {
  reflection: { description: "Personal reflection: revisit what you recorded about your day and cycle. Notes cannot establish medical causes or predict symptoms.", question: "What did I note about sleep and energy?", notes: ["Cycle day 3. I felt tired this morning and took a quiet break.", "I slept about six hours last night. My energy was lower than usual.", "I want to bring my notes to my next appointment instead of relying on memory."] },
  routine: { description: "Resume a routine: use your own notes to remember the last recorded step. A recorded action is not independent verification that it happened.", question: "Where did I leave my keys?", notes: ["I finished breakfast and put my mug beside the sink.", "I left my keys in the blue bowl by the front door.", "My next planned step is to water the plant by the window."] }
};
let mode = "reflection", busy = false;
const sessions = Object.fromEntries(Object.entries(demos).map(([key, value]) => [key, { sample: true, question: value.question, notes: value.notes.map((text, index) => ({ id: `${key}-${index + 1}`, text, at: new Date(Date.now() - (3 - index) * 3600000).toISOString() })) }]));
function message(text, error = false) { $("status").textContent = text; $("status").classList.toggle("error", error); }
function render() {
  const session = sessions[mode];
  $("mode-description").textContent = demos[mode].description;
  $("sample-label").textContent = session.sample ? "Includes fictional sample notes · clear to start your own" : "Session notes · kept in this page only";
  $("question").value = session.question;
  document.querySelectorAll("[data-mode]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.mode === mode)));
  $("timeline").replaceChildren();
  for (const note of session.notes) {
    const li = document.createElement("li"), time = document.createElement("time"), text = document.createElement("p"), id = document.createElement("span");
    li.id = `note-${note.id}`; time.dateTime = note.at;
    time.textContent = new Date(note.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    id.className = "note-id"; id.textContent = note.id; time.append(id); text.textContent = note.text;
    li.append(time, text); $("timeline").append(li);
  }
  if (!session.notes.length) { const p = document.createElement("p"); p.className = "empty"; p.textContent = "A fresh thread. Add your first note below."; $("timeline").append(p); }
}
function showAnswer(answer, sources = []) {
  const p = document.createElement("p"); p.textContent = answer; $("answer").replaceChildren(p);
  const links = document.createElement("div"); links.className = "sources";
  for (const id of sources) {
    if (!sessions[mode].notes.some((note) => note.id === id)) continue;
    const a = document.createElement("a"); a.href = `#note-${id}`; a.textContent = `Source: ${id}`; links.append(a);
  }
  if (links.childElementCount) $("answer").append(links);
}
function setBusy(value) {
  busy = value;
  document.querySelectorAll("button").forEach((button) => { button.disabled = value; });
  $("run").firstChild.textContent = value ? "Working… " : "Revisit my notes ";
}
function liveHeaders() {
  if (!$("live").checked) throw new Error("Enable live processing settings to transcribe audio.");
  if (!$("consent").checked) throw new Error("Confirm permission before sending notes or audio.");
  if (!$("token").value.trim()) throw new Error("Enter the app access token for live processing.");
  return { "X-App-Token": $("token").value.trim() };
}
async function request(url, options) {
  const response = await fetch(url, options), data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "The request could not be completed.");
  return data;
}
document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => {
  if (busy) return; sessions[mode].question = $("question").value; mode = button.dataset.mode;
  $("note").value = ""; render(); showAnswer("Ask a question to revisit this thread."); message("Local demo · no AI request");
}));
$("question").addEventListener("input", () => { sessions[mode].question = $("question").value; });
$("note-form").addEventListener("submit", (event) => {
  event.preventDefault(); const text = $("note").value.trim(); if (!text || busy) return;
  sessions[mode].notes.push({ id: `n-${crypto.randomUUID()}`, text, at: new Date().toISOString() });
  $("note").value = ""; render(); message("Note added to this session.");
});
$("clear").addEventListener("click", () => {
  if (busy || !confirm("Clear all notes in this demo mode? This cannot be undone.")) return;
  sessions[mode].notes = []; sessions[mode].sample = false; $("note").value = ""; $("audio").value = "";
  render(); showAnswer("Your session notes have been cleared."); message("Fresh session · no saved notes");
});
$("question-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const question = $("question").value.trim(), notes = sessions[mode].notes;
  if (busy || !question) return;
  if (!notes.length) return message("Add a note before asking a question.", true);
  if (!$("live").checked) {
    const words = question.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [];
    const matches = notes.filter((note) => words.some((word) => note.text.toLowerCase().includes(word)));
    const selected = (matches.length ? matches : notes.slice(-3));
    showAnswer(`${matches.length ? "Notes matching words in your question:" : "No direct keyword match. Here are your latest notes:"}\n\n${selected.map((note) => `“${note.text}”`).join("\n\n")}\n\nLocal keyword retrieval only; no AI interpretation or medical inference.`, selected.map((note) => note.id));
    return message("Local demo · no data sent");
  }
  try {
    const headers = liveHeaders(); setBusy(true); message("Sending this question and these notes to the configured provider…");
    const data = await request("/api/reflect", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ mode, question, notes }) });
    showAnswer(data.answer, Array.isArray(data.sources) ? data.sources : []); message("Live response · check the linked notes");
  } catch (error) { message(error.message || "Unable to complete request.", true); }
  finally { setBusy(false); }
});
$("transcribe").addEventListener("click", async () => {
  if (busy) return;
  try {
    const headers = liveHeaders(), file = $("audio").files[0];
    if (!file) throw new Error("Choose an audio file first.");
    if ($("note").value.trim() && !confirm("Replace the current note draft with a transcript?")) return;
    setBusy(true); message("Transcribing audio with the configured provider…");
    const data = await request("/api/transcribe", { method: "POST", headers: { ...headers, "Content-Type": file.type || "application/octet-stream" }, body: file });
    $("note").value = data.text || ""; $("audio").value = ""; $("note").focus(); message("Transcript ready. Review it, then choose Add note.");
  } catch (error) { message(error.message || "Unable to transcribe audio.", true); }
  finally { setBusy(false); }
});
render();
