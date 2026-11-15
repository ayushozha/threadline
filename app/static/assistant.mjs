// Talk to Threadline: live voice assistant on the dashboard.
// Hears through the Vexo band (lines that start with "Threadline") or this computer's microphone (every sentence),
// sends each sentence + a dashboard snapshot to /api/assistant/turn, speaks the reply (ElevenLabs, browser voice as
// fallback) and runs the returned actions through the page.
// Engine switch: "OpenAI Realtime" runs speech to speech over WebRTC (realtime.mjs) with the Vexo band as the only
// voice input (decoded band PCM via bandPcm.attach); the Gemini + ElevenLabs path below is unchanged.
import { bandStream, startRealtime } from './realtime.mjs';
const ENGINE_KEY = "threadline.assistantEngine";
const NO_BAND = "Connect the Vexo band (Your band → Connect) to talk.";
const ENGINES = { gemini: "Gemini + ElevenLabs", realtime: "OpenAI Realtime" };
const loadEngine = () => { try { return localStorage.getItem(ENGINE_KEY) === "gemini" ? "gemini" : "realtime"; } catch { return "realtime"; } };
import { speak as speakNatural } from './voice.mjs';
const WAKE = /^\s*(hey\s+)?(thread\s*line|threadline)[,.!\s]*/i;

export function mountAssistant(root, { el, request, getContext, runAction, bandOn, ensureBand, intercept, bandPcm, onTurn }) {
  const st = { engine: loadEngine(), rt: null, rtBand: null, rtDetach: null, rtActs: [], listening: false, ws: null, rec: null, stream: null, speaking: false, busy: false, history: [], buffer: "", interim: "" };
  const orb = el("div", { className: "as-orb", "aria-hidden": "true" });
  const status = el("p", { className: "as-status", textContent: "Listens through the Vexo band. Tap Talk or double-tap the band, then speak." });
  const live = el("p", { className: "as-live" });
  const log = el("ol", { className: "as-log", "aria-live": "polite" });
  const sos = el("button", { type: "button", className: "as-sos", textContent: "🚨 Emergency", title: "Start the emergency countdown now" });
  sos.addEventListener("click", () => { runAction({ type: "emergency", reason: "Emergency button pressed" }); });
  const talk = el("button", { type: "button", className: "as-talk", textContent: "🎙 Talk (band)" });
  const input = el("input", { type: "text", maxLength: 800, placeholder: "…or type: “How did I sleep?” “Order milk and a pill organiser”", "aria-label": "Message to Threadline" });
  const form = el("form", { className: "as-form" }, input, el("button", { type: "submit", className: "dash-btn primary", textContent: "Send" }));
  const chips = el("div", { className: "as-chips" }, ...["How am I doing today?", "Order milk, bread and a pill organiser", "Check out", "Remind me to call Lily at 5", "Is everything okay at home?", "I've fallen, help", "I'm feeling tired today, mood is low", "He asked about lunch 4 times, a bit restless this evening", "मलाई आज कस्तो छ?"].map((q) =>
    el("button", { type: "button", className: "lib-chip", textContent: q, onclick: () => turn(q) })));
  const label = el("small", { textContent: `Live · ${ENGINES[st.engine]}` });
  const engine = el("select", { className: "as-engine", "aria-label": "Voice engine" },
    ...Object.entries(ENGINES).map(([value, text]) => el("option", { value, textContent: text, selected: value === st.engine })));
  engine.value = st.engine;
  engine.addEventListener("change", () => {
    if (st.listening) stop();
    st.engine = engine.value === "realtime" ? "realtime" : "gemini";
    try { localStorage.setItem(ENGINE_KEY, st.engine); } catch { /* private mode */ }
    label.textContent = `Live · ${ENGINES[st.engine]}`;
    status.textContent = st.engine === "realtime" ? (bandPcmOn() ? "Tap Talk and speak through the Vexo band." : NO_BAND) : "Tap Talk, then speak.";
  });
  root.replaceChildren(el("section", { className: "as-card" },
    el("div", { className: "as-head" }, orb, el("div", {}, label, el("h2", {}, "Talk to Threadline", el("span", { className: "as-comfort", textContent: "💛 Comfort mode" })), status), el("div", { className: "as-head-actions" }, talk, sos)),
    el("label", { className: "as-engine-row" }, el("span", { textContent: "Voice engine" }), engine),
    live, log, chips, form));
  form.addEventListener("submit", (e) => {
    e.preventDefault(); const t = input.value.trim(); input.value = ""; if (!t) return;
    if (st.rt) { add("me", t); st.rt.sendText(t); } else turn(t);
  });
  talk.addEventListener("click", () => (st.listening ? stop() : start()));
  const setState = (s) => { root.querySelector(".as-card").dataset.state = s; };

  function add(who, text, extra, lang, english) {
    const foreign = lang && !/^english$/i.test(lang) && english && english.trim() !== text.trim();
    const li = el("li", { className: `as-${who}` },
      el("div", { className: "as-meta" }, el("b", { textContent: who === "me" ? "You" : "Threadline" }), lang ? el("span", { className: "as-lang", textContent: lang }) : null),
      el("span", { className: "as-text", textContent: text }),
      foreign ? el("span", { className: "as-en", textContent: `English: ${english}` }) : null, extra || null);
    log.append(li);
    while (log.children.length > 40) log.firstChild.remove();
    requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
    return li;
  }
  async function say(text) {
    st.speaking = true; setState("speaking");
    let ok = false;
    try { ok = await speakNatural(text); } catch { ok = false; }
    if (!ok) status.textContent = "Voice is unavailable right now. The reply is shown as text.";
    st.speaking = false; setState(st.listening ? "listening" : "idle");
  }
  async function turn(text) {
    if (!text.trim() || st.busy) return;
    st.busy = true; const mine = add("me", text); setState("thinking"); status.textContent = "Thinking…";
    try {
      const local = await intercept?.(text);
      if (local) { st.history.push({ role: "user", text }, { role: "model", text: local.say }); add("ai", local.say, local.done ? el("div", { className: "as-acts" }, el("span", { className: "as-act", textContent: `✓ ${local.done}` })) : null, "English"); status.textContent = "Tap Talk or double-tap the band to speak again."; await say(local.say); return; }
      const d = await request("/api/assistant/turn", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, history: st.history.slice(-10), context: getContext() }) });
      st.history.push({ role: "user", text }, { role: "model", text: d.say });
      try { onTurn?.({ role: "user", text, lang: d.heard_language, english: d.heard_en }); onTurn?.({ role: "model", text: d.say, lang: d.language, english: d.say_en }); } catch { /* */ }
      const done = [];
      for (const a of d.actions || []) { try { const r = await runAction(a); if (r) done.push(r); } catch { /* skip */ } }
      if (d.heard_language) { mine.querySelector(".as-meta").append(el("span", { className: "as-lang", textContent: d.heard_language }));
        if (!/^english$/i.test(d.heard_language) && d.heard_en && d.heard_en.trim() !== text.trim()) mine.append(el("span", { className: "as-en", textContent: `English: ${d.heard_en}` })); }
      add("ai", d.say, done.length ? el("div", { className: "as-acts" }, ...done.map((x) => el("span", { className: "as-act", textContent: `✓ ${x}` }))) : null, d.language, d.say_en);
      status.textContent = st.listening ? "Listening through the Vexo band. Just talk." : "Tap Talk or double-tap the band to speak again.";
      await say(d.say);
    } catch (e) { add("ai", `Sorry, I couldn't answer: ${e.message}`); setState(st.listening ? "listening" : "idle"); }
    finally { st.busy = false; }
  }
  // Band lines arrive from the page's live transcript; only lines addressed to Threadline become turns.
  function feedBand(text) {
    if (st.engine === "realtime" || !bandOn() || st.speaking) return;
    const m = text.match(WAKE), open = st.listening || Date.now() < (st.windowUntil || 0);
    if (!m && !open) return;
    const rest = (m ? text.slice(m[0].length) : text).trim(); if (!rest) return;
    st.windowUntil = 0; turn(rest);
  }
  function openWindow() {  // band double-tap: the next sentence goes to Threadline without the wake word
    if (st.engine === "realtime") { if (!st.listening) start(); return; }
    st.windowUntil = Date.now() + 8000; setState("listening");
    status.textContent = "Double-tap heard. I'm listening through the band…";
    setTimeout(() => { if (Date.now() >= st.windowUntil && !st.busy) setState(st.listening ? "listening" : "idle"); }, 8200);
  }
  const bandPcmOn = () => Boolean(bandPcm?.on?.());
  async function startRt() {
    if (!bandPcmOn()) { status.textContent = NO_BAND; setState("idle"); return; }
    st.listening = true; talk.textContent = "■ Stop"; setState("thinking"); status.textContent = "Connecting to OpenAI Realtime…";
    try {
      const bs = bandStream(); st.rtBand = bs; await bs.resume();
      st.rtDetach = bandPcm.attach((samples) => bs.push(samples));
      st.rt = await startRealtime({
        getContext, runAction: (a) => runAction(a.type === "buy" ? { type: "checkout" } : a), inputStream: bs.stream,
        muteWhileSpeaking: (v) => { bs.muted = v; },  // the band mic would otherwise hear the speakers
        onAction: (r) => st.rtActs.push(r),
        onTranscript: ({ role, text }) => {
          try { onTurn?.({ role: role === "user" ? "user" : "model", text }); } catch { /* */ }
          if (role === "user") { add("me", text); return; }
          const done = st.rtActs.splice(0);
          add("ai", text, done.length ? el("div", { className: "as-acts" }, ...done.map((x) => el("span", { className: "as-act", textContent: `✓ ${x}` }))) : null);
        },
        onState: (s, msg) => {
          if (!st.rt && s !== "listening") return;
          if (s === "closed") { if (st.listening) { stop(); status.textContent = "Realtime call ended. Tap Talk to start again."; } return; }
          if (s === "error") { status.textContent = msg; return; }
          setState(s === "hearing" ? "listening" : s);
          status.textContent = s === "speaking" ? "Threadline is speaking…" : s === "thinking" ? "Thinking…" : "Listening through the Vexo band… just talk.";
        },
      });
      if (!st.listening) st.rt.stop();
    } catch (e) { stop(); status.textContent = `OpenAI Realtime couldn't start: ${e.message}`; }
  }
  async function start() {  // voice comes only from the Vexo band
    if (st.engine === "realtime") return startRt();
    if (!bandOn()) {
      const ok = await ensureBand?.();
      if (!ok) { status.textContent = "Connect the Vexo band and allow recording on Your band, then tap Talk. Threadline listens only through the band."; return; }
    }
    st.listening = true; talk.textContent = "■ Stop"; setState("listening");
    status.textContent = "Listening through the Vexo band. Just talk.";
  }
  function flush() { const t = st.buffer.trim(); st.buffer = ""; live.textContent = ""; if (t) turn(t.replace(WAKE, "") || t); }
  function stop() {
    st.listening = false; talk.textContent = "🎙 Talk"; setState("idle"); status.textContent = "Tap Talk or double-tap the band, then speak.";
    const rt = st.rt; st.rt = null; rt?.stop();
    st.rtDetach?.(); st.rtDetach = null; st.rtBand?.close(); st.rtBand = null; st.rtActs = [];
  }
  return { feedBand, turn, openWindow };
}
