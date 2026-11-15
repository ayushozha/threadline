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

export function mountLibrary(root, { request, onRunLive, onSpeak }) {
  let data = { scenarios: [] }, filter = "all", openId = null;
  const top = h("div", { className: "lib-top" }), grid = h("div", { className: "lib-grid" }), detail = h("div", { className: "lib-detail", hidden: true });
  root.replaceChildren(top, detail, grid);

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
      h("div", { className: "lib-media" }, vid, h("span", { className: "lib-mode", textContent: MODE[s.mode] }), h("span", { className: `lib-src${s.source.startsWith("Recorded") ? " real" : ""}`, textContent: s.source.startsWith("Recorded") ? "● Real recording" : "MiniMax scene" })),
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
    const out = h("div", {}, s.analysis ? analysisBlock(s, s.analysis) : h("p", { className: "caption", textContent: "Not analysed yet. Ask Gemini." }));
    const status = h("span", { className: "caption" });
    const again = h("button", { type: "button", className: "dash-btn", textContent: "Ask Gemini again (live)", onclick: async () => {
      again.disabled = true; status.textContent = "Capturing frames and asking Gemini…";
      try {
        const frames = await grabFrames(video, 4);
        const a = await request("/api/scenario/reason", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: s.mode, title: s.title, frames }) });
        out.replaceChildren(analysisBlock(s, a, true)); status.textContent = "Fresh answer from Gemini.";
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
    render();
  }
  load();
  return { reload: load };
}

async function grabFrames(video, n) {
  if (video.readyState < 2) await new Promise((res) => video.addEventListener("loadeddata", res, { once: true }));
  const c = document.createElement("canvas"), w = 640, hgt = Math.round((video.videoHeight / video.videoWidth) * w) || 360;
  c.width = w; c.height = hgt; const ctx = c.getContext("2d"), out = [], dur = video.duration || 4, was = video.currentTime;
  video.pause();
  for (let i = 0; i < n; i++) {
    video.currentTime = (dur * (i + 0.5)) / n;
    await new Promise((res) => video.addEventListener("seeked", res, { once: true }));
    ctx.drawImage(video, 0, 0, w, hgt); out.push(c.toDataURL("image/jpeg", 0.7).split(",")[1]);
  }
  video.currentTime = was; video.play().catch(() => {});
  return out;
}
