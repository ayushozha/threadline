"use strict";
// Voice assistant client pieces: plays the assistant's speech, keeps the conversation, draws the Assistant page.
// The socket itself (band audio in, events out) lives in app.js with the rest of live capture.
// Conversation turns are stored in this browser only, per band. Nothing is stored on the server.

const MAX_TURNS = 200;
const ENERGY_WORDS = { low: "low energy", moody: "tension", positive: "good energy", steady: "steady", unknown: "still learning your baseline" };
const ACTION_LABELS = {
  none: "No action", offer_schedule: "Offered: make space in your schedule", offer_update: "Offered: your pre-approved update",
  show_evidence: "Showed what you said before", watch_tap: "Tapped your watch", ask_checkin: "Asked how you'd like support",
  hold_decision: "Suggested holding a big decision", move_to_today: "Suggested moving a task to today",
  calendar_note: "Suggested a calendar note", music: "Suggested music for your energy",
};

export function createAssistant({ $, el, onSettings = () => {} }) {
  const state = { band: "browser", turns: [], ctx: null, nextAt: 0, listening: false, mood: null, available: false };
  const key = () => `threadline.assistant.v1.${state.band}`;
  const load = () => { try { return JSON.parse(localStorage.getItem(key()) || "[]"); } catch { return []; } };
  const save = () => { try { localStorage.setItem(key(), JSON.stringify(state.turns.slice(-MAX_TURNS))); } catch { /* storage off */ } };
  const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });

  function why(trigger) {
    if (!trigger) return "";
    const what = ENERGY_WORDS[trigger.energy] || trigger.energy;
    return trigger.kind === "words"
      ? `Spoke up because you said “${trigger.evidence}” — a word for ${what}.`
      : `Spoke up because your voice moved away from your usual (${(trigger.drivers || []).join(", ") || "several signals"}) — ${what}. Compared with your own baseline, not a diagnosis.`;
  }

  function render() {
    const log = $("assistant-log");
    if (!log) return;
    if (!state.turns.length) {
      log.replaceChildren(el("li", { className: "empty", textContent: state.available
        ? "Nothing yet. Start a live capture with “Let the assistant listen” on, then say “Vexa, …”."
        : "The voice assistant isn't set up on this server, or this is a shared demo. See docs/VOICE.md." }));
    } else {
      log.replaceChildren(...state.turns.map((t) => el("li", { className: `turn ${t.role}${t.trigger ? " nudge" : ""}` },
        el("div", { className: "turn-meta" }, el("b", { textContent: t.role === "you" ? "You" : "Vexa" }), el("span", { textContent: ` · ${time(t.at)}` })),
        el("p", { textContent: t.text }),
        t.trigger ? el("div", { className: "why-line", textContent: why(t.trigger) }) : null,
        t.decision ? el("div", { className: "why-line", textContent: `${ACTION_LABELS[t.decision.action] || t.decision.action}${t.decision.reason ? ` · ${t.decision.reason}` : ""} · ${t.decision.engine === "gemini" ? "Gemini" : "local rules"}` }) : null)));
      log.lastChild?.scrollIntoView({ block: "nearest" });
    }
    const m = state.mood;
    $("assistant-mood").textContent = m
      ? `Now: ${ENERGY_WORDS[m.energy] || m.energy} · arousal ${m.arousal >= 0 ? "+" : ""}${m.arousal}, mood ${m.valence >= 0 ? "+" : ""}${m.valence} vs your own baseline · ${Math.round(m.confidence * 100)}% confidence · from ${m.sources.join(" + ") || "—"}`
      : "Mood reading: waiting for speech. It learns your own baseline over about twenty utterances; until then it says so instead of guessing.";
    $("assistant-state").textContent = state.listening ? "● Listening through the band" : "Not listening";
    $("assistant-state").dataset.on = String(state.listening);
  }

  function record(role, text, extra = {}) {
    if (!text) return null;
    const turn = { role, text, at: extra.at || new Date().toISOString(), ...extra };
    state.turns.push(turn); state.turns = state.turns.slice(-MAX_TURNS); save(); render();
    return turn;
  }

  // Speech comes back as raw 16-bit mono PCM chunks; schedule them back to back.
  function prime() {
    try {
      state.ctx = state.ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (state.ctx.state === "suspended") state.ctx.resume();
    } catch { state.ctx = null; }
  }
  function play(buffer, rate = 24000) {
    if (!state.ctx || !$("assistant-speak")?.checked) return;
    const pcm = new Int16Array(buffer.slice(0, buffer.byteLength - (buffer.byteLength % 2)));
    if (!pcm.length) return;
    const audio = state.ctx.createBuffer(1, pcm.length, rate), ch = audio.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
    const src = state.ctx.createBufferSource();
    src.buffer = audio; src.connect(state.ctx.destination);
    state.nextAt = Math.max(state.nextAt, state.ctx.currentTime + 0.05);
    src.start(state.nextAt); state.nextAt += audio.duration;
  }

  return {
    prime, play, render, record,
    setBand(band) { state.band = band || "browser"; state.turns = load(); render(); },
    setAvailable(on) { state.available = on; const box = $("assistant-on"); if (box) { box.disabled = !on; if (!on) box.checked = false; } render(); },
    setListening(on) { state.listening = on; if (!on) state.nextAt = 0; render(); },
    proactive: () => $("assistant-proactive")?.checked !== false,
    mood(reading) { state.mood = reading; render(); },
    // Server events that belong in the conversation.
    handle(msg) {
      if (msg.type === "assistant") record("assistant", msg.text, { trigger: msg.trigger || null });
      else if (msg.type === "decision") { const last = [...state.turns].reverse().find((t) => t.role === "assistant"); if (last && !last.decision) { last.decision = msg.decision; save(); render(); } }
    },
    clear() { state.turns = []; save(); render(); },
    init() {
      $("assistant-clear")?.addEventListener("click", () => { if (confirm("Delete the assistant conversation from this browser?")) this.clear(); });
      $("assistant-proactive")?.addEventListener("change", () => onSettings());
      render();
    },
  };
}
