// Scenario library: real recordings and generated scenes of people facing everyday problems, each reasoned on by
// Gemini (vision) and the Gemini Decisions API (one action + urgency). "Ask Gemini again" re-runs it live on frames
// captured from the playing video.

const ACTION = {
  alert_caregiver: { label: "Alert caregiver", icon: "🚨", cls: "a-alert" },
  haptic_warning: { label: "Watch tap + warning", icon: "📳", cls: "a-warn" },
  captions_alert: { label: "Caption alert", icon: "💬", cls: "a-warn" },
  routine_reminder: { label: "Routine reminder", icon: "⏰", cls: "a-remind" },
  speak_guidance: { label: "Speak guidance", icon: "🔊", cls: "a-speak" },
  no_action: { label: "No action", icon: "✓", cls: "a-none" },
};
const MODE = { memory: "🧠 Memory", sight: "👁️ Sight", hearing: "👂 Hearing", mobility: "🦽 Mobility" };
function h(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) { if (v == null || v === false) continue; if (k === "className") n.className = v; else if (k === "textContent") n.textContent = v; else if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? "" : v); }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c);
  return n;
}
const pct = (c) => c == null ? "" : ` · ${Math.round(c * 100)}%`;

const QUICK = {
  memory: ["What should I do now?", "Should I call someone?"],
  sight: ["What does the label say?", "Is it safe to go down?", "What should I do now?"],
  hearing: ["What should I do now?", "Should I call someone?"],
  mobility: ["Is it safe to go down?", "What should I do now?", "Should I call someone?"],
};
const VIDEO_TYPES = { mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime" };
const videoType = (f) => {
  const t = (f.type || "").split(";")[0].toLowerCase();
  return /^video\/(mp4|webm|quicktime)$/.test(t) ? t : VIDEO_TYPES[(f.name.split(".").pop() || "").toLowerCase()] || t;
};
const fromRecording = (v) => ({ id: `rec-${v.id}`, own: true, mode: v.mode, title: v.title, video: `/api/videos/${v.id}/file`, poster: null, analysis: v.analysis,
  source: "Your recording", problem: `Recorded ${new Date(v.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` });

export function mountLibrary(root, { request, onRunLive, onSpeak }) {
  let data = { scenarios: [] }, filter = "all", openId = null;
  const chats = new Map(); // per opened video: { history, frames }
  let speakOn = false;
  const top = h("div", { className: "lib-top" }), adder = h("div", { className: "lib-add" }), grid = h("div", { className: "lib-grid" }), detail = h("div", { className: "lib-detail", hidden: true });
  root.replaceChildren(adder, top, detail, grid);

  // "Add a video": upload a recording, let Gemini reason on 4 frames, save the analysis, show it as a card.
  const addStatus = h("span", { className: "caption", role: "status" });
  const addTitle = h("input", { type: "text", maxlength: "120", placeholder: "What happens in it? (optional)", "aria-label": "Video title" });
  const addMode = h("select", { "aria-label": "Mode" }, ...Object.entries(MODE).map(([k, t]) => h("option", { value: k, textContent: t })));
  const addFile = h("input", { type: "file", accept: "video/*", capture: "environment", hidden: true, onchange: () => { const f = addFile.files?.[0]; addFile.value = ""; if (f) addVideo(f); } });
  const addBtn = h("button", { type: "button", className: "dash-btn primary", textContent: "＋ Add a video", onclick: () => addFile.click() });
  adder.append(h("b", { textContent: "Add a video" }), addTitle, addMode, addBtn, addFile, addStatus,
    h("p", { className: "caption", textContent: "Record or pick a clip (up to 60 MB). It is stored on this server, and 4 frames are sent to Gemini to reason on." }));
  async function addVideo(file) {
    const type = videoType(file);
    if (!/^video\/(mp4|webm|quicktime)$/.test(type)) { addStatus.textContent = "Use an MP4, WebM or MOV video."; return; }
    if (file.size > 60 * 1024 * 1024) { addStatus.textContent = "That video is larger than 60 MB."; return; }
    addBtn.disabled = true;
    const title = addTitle.value.trim() || file.name.replace(/\.[^.]+$/, "").slice(0, 120) || "My recording", mode = addMode.value;
    const url = URL.createObjectURL(file), vid = h("video", { muted: true, playsinline: true, preload: "auto", hidden: true, src: url });
    vid.muted = true;
    try {
      addStatus.textContent = "Uploading…";
      const rec = await request(`/api/videos?title=${encodeURIComponent(title)}&mode=${encodeURIComponent(mode)}`, { method: "POST", headers: { "Content-Type": type }, body: file });
      addStatus.textContent = "Saved. Capturing frames and asking Gemini…";
      document.body.append(vid);
      const frames = await grabFrames(vid, 4);
      try {
        const a = await request("/api/scenario/reason", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, title, frames }) });
        await request(`/api/videos/${rec.id}/analysis`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(a) });
        addStatus.textContent = `Gemini: ${a.vision.summary}`;
      } catch (e) { addStatus.textContent = `Saved, but Gemini couldn't analyse it: ${e.message}`; }
      chats.set(`rec-${rec.id}`, { history: [], frames });
      addTitle.value = ""; filter = "all"; await load(); open(`rec-${rec.id}`);
    } catch (e) { addStatus.textContent = `Couldn't add the video: ${e.message}`; }
    finally { addBtn.disabled = false; vid.remove(); URL.revokeObjectURL(url); }
  }

  function chatBox(s, video) {
    const st = chats.get(s.id) || { history: [], frames: null }; chats.set(s.id, st);
    const list = h("div", { className: "lib-chat-log", "aria-live": "polite" }), status = h("span", { className: "caption" });
    const input = h("input", { type: "text", maxlength: "1000", placeholder: "Ask Gemini about this video…", "aria-label": "Message to Gemini" });
    const send = h("button", { type: "submit", className: "dash-btn primary", textContent: "Send" });
    const speak = h("button", { type: "button", className: "dash-btn", "aria-pressed": String(speakOn), textContent: speakOn ? "🔊 On" : "🔇 Off",
      onclick: () => { speakOn = !speakOn; speak.textContent = speakOn ? "🔊 On" : "🔇 Off"; speak.setAttribute("aria-pressed", String(speakOn)); if (!speakOn) try { speechSynthesis.cancel(); } catch { /* no speech */ } } });
    const line = (t) => {
      const d = t.decision && ACTION[t.decision.action];
      return h("div", { className: `lib-msg ${t.role}` }, h("p", { textContent: t.text }), d ? h("small", { textContent: `${d.icon} ${d.label} · ${t.decision.urgency}${pct(t.decision.confidence)}` }) : null);
    };
    const draw = () => { list.replaceChildren(...st.history.map(line)); list.scrollTop = list.scrollHeight; };
    async function ask(text) {
      text = text.trim().slice(0, 1000); if (!text || send.disabled) return;
      send.disabled = true; input.value = "";
      const history = st.history.slice(-12).map(({ role, text: t }) => ({ role, text: t.slice(0, 1000) }));
      st.history.push({ role: "user", text }); draw();
      try {
        if (!st.frames) { status.textContent = "Capturing frames…"; st.frames = await grabFrames(video, 4); }
        status.textContent = "Gemini is thinking…";
        const r = await request("/api/scenario/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: s.mode, title: s.title, frames: st.frames, history, message: text }) });
        st.history.push({ role: "model", text: r.reply, decision: r.decision }); draw(); status.textContent = "";
        if (speakOn) onSpeak?.(r.reply);
      } catch (e) { st.history.pop(); draw(); input.value = text; status.textContent = `Couldn't reach Gemini: ${e.message}`; }
      finally { send.disabled = false; }
    }
    draw();
    return h("div", { className: "lib-chat" }, h("small", { textContent: "Talk to Gemini about this video" }), list,
      h("div", { className: "lib-quick" }, ...(QUICK[s.mode] || QUICK.memory).map((q) => h("button", { type: "button", className: "lib-chip", textContent: q, onclick: () => ask(q) }))),
      h("form", { className: "lib-chat-form", onsubmit: (e) => { e.preventDefault(); ask(input.value); } }, input, send, speak), status);
  }

  function summary() {
    const s = data.scenarios, by = (k) => s.filter((x) => x.analysis?.decision?.action === k).length;
    top.replaceChildren(
      h("div", { className: "lib-stats" }, ...[[s.length, "scenarios"], [s.filter((x) => x.source.startsWith("Recorded")).length, "real recordings"], [by("alert_caregiver"), "caregiver alerts"], [by("haptic_warning") + by("captions_alert"), "instant warnings"], [by("speak_guidance") + by("routine_reminder"), "spoken help"]]
        .map(([n, t]) => h("div", {}, h("b", { textContent: String(n) }), h("span", { textContent: t })))),
      h("div", { className: "lib-filters" }, ...[["all", "All"], ...Object.entries(MODE)].map(([k, t]) => h("button", { type: "button", className: `lib-filter${filter === k ? " on" : ""}`, textContent: t, onclick: () => { filter = k; render(); } }))));
  }
  function card(s) {
    const a = s.analysis, d = a?.decision, act = ACTION[d?.action] || ACTION.speak_guidance;
    const vid = h("video", { muted: true, loop: true, playsinline: true, preload: "none", poster: s.poster, src: s.video });
    vid.muted = true;
    const c = h("article", { className: `lib-card ${act.cls}`, tabindex: "0", onclick: () => open(s.id), onkeydown: (e) => { if (e.key === "Enter") open(s.id); },
      onmouseenter: () => vid.play().catch(() => {}), onmouseleave: () => { vid.pause(); } },
      h("div", { className: "lib-media" }, vid, h("span", { className: "lib-mode", textContent: MODE[s.mode] }), h("span", { className: `lib-src${s.own || s.source.startsWith("Recorded") ? " real" : ""}`, textContent: s.own ? "● Your recording" : s.source.startsWith("Recorded") ? "● Real recording" : "MiniMax scene" })),
      h("div", { className: "lib-body" }, h("b", { textContent: s.title }), h("p", { textContent: s.problem }),
        a ? h("p", { className: "lib-sum", textContent: a.vision.summary }) : null,
        d ? h("span", { className: `lib-act ${act.cls}`, textContent: `${act.icon} ${act.label} · ${d.urgency}${pct(d.confidence)}` }) : null));
    return c;
  }
  function render() {
    summary();
    const list = data.scenarios.filter((s) => filter === "all" || s.mode === filter);
    grid.replaceChildren(...list.map(card));
    if (openId) open(openId, false);
  }
  function analysisBlock(s, a, live = false) {
    const v = a.vision, d = a.decision, act = ACTION[d.action] || ACTION.speak_guidance;
    return h("div", { className: "lib-analysis" },
      h("div", { className: `lib-decision ${act.cls}` }, h("span", { className: "lib-big", textContent: act.icon }),
        h("div", {}, h("small", { textContent: `${d.engine === "gemini-decisions" ? "Gemini Decisions API" : "Rule fallback"}${live ? " · live run" : ""}` }), h("b", { textContent: act.label }),
          h("span", { textContent: `Urgency: ${d.urgency}${pct(d.confidence)}${d.overridden ? " · safety rule raised it" : ""}` }))),
      h("div", { className: "lib-say" }, h("small", { textContent: "Gemini says out loud" }), h("p", { textContent: `“${v.say_now}”` }),
        h("button", { type: "button", className: "dash-btn primary", textContent: "🔊 Play", onclick: () => onSpeak?.(v.say_now) })),
      h("dl", { className: "lib-facts" },
        h("dt", { textContent: "What Gemini sees" }), h("dd", { textContent: v.seen }),
        v.hazards.length ? [h("dt", { textContent: "Hazards" }), h("dd", {}, ...v.hazards.map((x) => h("span", { className: "lib-chip warn", textContent: x })))] : null,
        v.read_text.length ? [h("dt", { textContent: "Text it read" }), h("dd", {}, ...v.read_text.map((x) => h("span", { className: "lib-chip", textContent: x })))] : null,
        h("dt", { textContent: "Summary" }), h("dd", { textContent: v.summary }),
        v.caregiver_note ? [h("dt", { textContent: "For the family" }), h("dd", { textContent: v.caregiver_note })] : null),
      h("p", { className: "caption", textContent: `${a.models?.vision || "Gemini"} on ${a.frames} frames${a.models?.decision ? ` → ${a.models.decision}` : ""} · ${new Date(a.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` }));
  }
  function open(id, scroll = true) {
    const s = data.scenarios.find((x) => x.id === id); if (!s) return;
    openId = id;
    const video = h("video", { src: s.video, poster: s.poster, controls: true, autoplay: true, muted: true, loop: true, playsinline: true });
    video.muted = true;
    const chat = chatBox(s, video);
    const out = h("div", {}, s.analysis ? analysisBlock(s, s.analysis) : h("p", { className: "caption", textContent: "Not analysed yet. Ask Gemini." }), chat);
    const status = h("span", { className: "caption" });
    const again = h("button", { type: "button", className: "dash-btn", textContent: "Ask Gemini again (live)", onclick: async () => {
      again.disabled = true; status.textContent = "Capturing frames and asking Gemini…";
      try {
        const frames = await grabFrames(video, 4);
        const a = await request("/api/scenario/reason", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: s.mode, title: s.title, frames }) });
        out.replaceChildren(analysisBlock(s, a, true), chat); status.textContent = "Fresh answer from Gemini.";
        if (s.own) { s.analysis = a; request(`/api/videos/${s.id.slice(4)}/analysis`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(a) }).catch(() => {}); }
      } catch (e) { status.textContent = `Couldn't reach Gemini: ${e.message}`; } finally { again.disabled = false; } } });
    const note = s.analysis?.vision?.caregiver_note || s.analysis?.vision?.summary || s.title;
    detail.hidden = false;
    detail.replaceChildren(
      h("div", { className: "lib-detail-head" }, h("div", {}, h("small", { textContent: `${MODE[s.mode]} · ${s.source}` }), h("h3", { textContent: s.title }), h("p", { textContent: s.problem })),
        h("button", { type: "button", className: "dash-btn ghost", textContent: "Close", onclick: () => { detail.hidden = true; openId = null; } })),
      h("div", { className: "lib-detail-body" }, h("div", { className: "lib-player" }, video,
        h("div", { className: "row tight" }, again, h("button", { type: "button", className: "dash-btn primary", textContent: "Run live guidance on this video", onclick: () => onRunLive?.(s) }),
          h("a", { className: "dash-btn", href: `sms:?&body=${encodeURIComponent(`Threadline: ${note}`)}`, textContent: "Text family" })), status), out));
    if (scroll) detail.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  async function load() {
    try { const r = await fetch("/static/scenarios/scenarios.json"); data = await r.json(); } catch { data = { scenarios: [] }; }
    let mine = [];
    try { mine = ((await request("/api/videos")).videos || []).map(fromRecording); } catch { /* no server storage or not signed in */ }
    data = { ...data, scenarios: [...mine, ...(data.scenarios || [])] };
    render();
  }
  load();
  return { reload: load };
}

async function grabFrames(video, n) {
  if (video.readyState < 2) await new Promise((res) => video.addEventListener("loadeddata", res, { once: true }));
  const c = document.createElement("canvas"), w = 640, hgt = Math.round((video.videoHeight / video.videoWidth) * w) || 360;
  c.width = w; c.height = hgt; const ctx = c.getContext("2d"), out = [], dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 4, was = video.currentTime;
  video.pause();
  for (let i = 0; i < n; i++) {
    video.currentTime = (dur * (i + 0.5)) / n;
    await new Promise((res) => video.addEventListener("seeked", res, { once: true }));
    ctx.drawImage(video, 0, 0, w, hgt); out.push(c.toDataURL("image/jpeg", 0.7).split(",")[1]);
  }
  video.currentTime = was; video.play().catch(() => {});
  return out;
}
