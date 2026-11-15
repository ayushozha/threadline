// Talk to Threadline: live voice assistant on the dashboard.
// Hears through the Vexo band (lines that start with "Threadline") or this computer's microphone (every sentence),
// sends each sentence + a dashboard snapshot to /api/assistant/turn, speaks the reply (ElevenLabs, browser voice as
// fallback) and runs the returned actions through the page.
const WAKE = /^\s*(hey\s+)?(thread\s*line|threadline)[,.!\s]*/i;

export function mountAssistant(root, { el, request, getContext, runAction, bandOn }) {
  const st = { listening: false, ws: null, rec: null, stream: null, speaking: false, busy: false, history: [], buffer: "", interim: "" };
  const orb = el("div", { className: "as-orb", "aria-hidden": "true" });
  const status = el("p", { className: "as-status", textContent: "Tap Talk, then speak. With the band, start with “Threadline…”." });
  const live = el("p", { className: "as-live" });
  const log = el("ol", { className: "as-log", "aria-live": "polite" });
  const talk = el("button", { type: "button", className: "as-talk", textContent: "🎙 Talk" });
  const input = el("input", { type: "text", maxLength: 800, placeholder: "…or type: “How did I sleep?” “Order milk and a pill organiser”", "aria-label": "Message to Threadline" });
  const form = el("form", { className: "as-form" }, input, el("button", { type: "submit", className: "dash-btn primary", textContent: "Send" }));
  const chips = el("div", { className: "as-chips" }, ...["How am I doing today?", "Order milk, bread and a pill organiser", "Check out", "Remind me to call Lily at 5", "Is everything okay at home?", "I've fallen, help"].map((q) =>
    el("button", { type: "button", className: "lib-chip", textContent: q, onclick: () => turn(q) })));
  root.replaceChildren(el("section", { className: "as-card" },
    el("div", { className: "as-head" }, orb, el("div", {}, el("small", { textContent: "Live · Gemini + ElevenLabs" }), el("h2", { textContent: "Talk to Threadline" }), status), talk),
    live, log, chips, form));
  form.addEventListener("submit", (e) => { e.preventDefault(); const t = input.value.trim(); input.value = ""; if (t) turn(t); });
  talk.addEventListener("click", () => (st.listening ? stop() : start()));
  const setState = (s) => { root.querySelector(".as-card").dataset.state = s; };

  function add(who, text, extra) {
    log.append(el("li", { className: `as-${who}` }, el("b", { textContent: who === "me" ? "You" : "Threadline" }), el("span", { textContent: text }), extra || null));
    while (log.children.length > 12) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
  }
  async function say(text) {
    st.speaking = true; setState("speaking");
    try {
      const r = await fetch("/api/assistant/speak", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ text }) });
      if (!r.ok) throw new Error("no voice");
      const url = URL.createObjectURL(await r.blob()), a = new Audio(url);
      await new Promise((res) => { a.onended = res; a.onerror = res; a.play().catch(res); });
      URL.revokeObjectURL(url);
    } catch {
      await new Promise((res) => { try { const u = new SpeechSynthesisUtterance(text); u.rate = 0.98; u.onend = res; u.onerror = res; speechSynthesis.speak(u); } catch { res(); } });
    }
    st.speaking = false; setState(st.listening ? "listening" : "idle");
  }
  async function turn(text) {
    if (!text.trim() || st.busy) return;
    st.busy = true; add("me", text); setState("thinking"); status.textContent = "Thinking…";
    try {
      const d = await request("/api/assistant/turn", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, history: st.history.slice(-10), context: getContext() }) });
      st.history.push({ role: "user", text }, { role: "model", text: d.say });
      const done = [];
      for (const a of d.actions || []) { try { const r = await runAction(a); if (r) done.push(r); } catch { /* skip */ } }
      add("ai", d.say, done.length ? el("div", { className: "as-acts" }, ...done.map((x) => el("span", { className: "as-act", textContent: `✓ ${x}` }))) : null);
      status.textContent = st.listening ? (bandOn() ? "Listening through the Vexo band. Start with “Threadline…”." : "Listening…") : "Tap Talk to speak again.";
      await say(d.say);
    } catch (e) { add("ai", `Sorry, I couldn't answer: ${e.message}`); setState(st.listening ? "listening" : "idle"); }
    finally { st.busy = false; }
  }
  // Band lines arrive from the page's live transcript; only lines addressed to Threadline become turns.
  function feedBand(text) {
    if (!bandOn() || st.speaking) return;
    const m = text.match(WAKE), open = Date.now() < (st.windowUntil || 0);
    if (!m && !open) return;
    const rest = (m ? text.slice(m[0].length) : text).trim(); if (!rest) return;
    st.windowUntil = 0; turn(rest);
  }
  function openWindow() {  // band double-tap: the next sentence goes to Threadline without the wake word
    st.windowUntil = Date.now() + 8000; setState("listening");
    status.textContent = "Double-tap heard. I'm listening through the band…";
    setTimeout(() => { if (Date.now() >= st.windowUntil && !st.busy) setState(st.listening ? "listening" : "idle"); }, 8200);
  }
  async function start() {
    st.listening = true; talk.textContent = "■ Stop"; setState("listening");
    if (bandOn()) { status.textContent = "Listening through the Vexo band. Start with “Threadline…”."; return; }
    try { st.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch { status.textContent = "Microphone permission was not granted. Type instead."; return stop(); }
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/live-transcribe`); st.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ source: "browser" }));
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === "ready") {
        status.textContent = "Listening… just talk.";
        st.rec = new MediaRecorder(st.stream);
        st.rec.ondataavailable = (e) => { if (e.data.size && ws.readyState === 1 && !st.speaking) ws.send(e.data); };
        st.rec.start(250);
      } else if (m.type === "result") {
        if (st.speaking) return;
        if (m.is_final && m.transcript?.trim()) { st.buffer += ` ${m.transcript.trim()}`; live.textContent = st.buffer; if (m.speech_final) flush(); }
        else if (!m.is_final) live.textContent = `${st.buffer} ${m.transcript || ""}`;
      } else if (m.type === "utterance_end") flush();
      else if (m.type === "error") status.textContent = m.message;
    };
    ws.onclose = () => { if (st.ws === ws && st.listening && !bandOn()) status.textContent = "Connection closed. Tap Talk to reconnect."; };
  }
  function flush() { const t = st.buffer.trim(); st.buffer = ""; live.textContent = ""; if (t) turn(t.replace(WAKE, "") || t); }
  function stop() {
    st.listening = false; talk.textContent = "🎙 Talk"; setState("idle"); status.textContent = "Tap Talk, then speak.";
    try { st.rec?.stop(); } catch { /* */ } st.stream?.getTracks().forEach((t) => t.stop());
    try { st.ws?.send(JSON.stringify({ type: "stop" })); st.ws?.close(); } catch { /* */ }
    st.ws = null; st.rec = null; st.stream = null;
  }
  return { feedBand, turn, openWindow };
}
