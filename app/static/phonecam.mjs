// Live camera · iPhone: a dashboard card that pairs a phone (QR code → /static/phone.html), shows what it sees and
// hands the pairing code to the Care view's Gemini Live guidance ("Talk about what it sees").
// The CSP allows img-src 'self' data: (not blob:), so frames load as same-origin <img> URLs with a cache-buster,
// preloaded off-screen and swapped in when complete so the preview never flickers.
import { encodeQR, qrPath } from "./qr.mjs";

const FRAME_MS = 250; // ~4 fps preview
const STATUS_MS = 1000;
const STORE_KEY = "threadline.phonecam.v1";
const SVG_NS = "http://www.w3.org/2000/svg";

/** "live · 2.0 fps" style badge text from a /api/phonecam/status answer. */
export function badgeText(status) {
  if (!status) return "Not connected";
  if (status.live) return `Live · ${Number(status.fps || 0).toFixed(1)} fps`;
  return status.at ? "Offline · phone stopped sending" : "Waiting for the phone…";
}

/** Shortens a long pairing URL for display: origin + path, with the secret hidden. */
export function displayUrl(url) {
  try { const u = new URL(url); return `${u.host}${u.pathname}?c=${u.searchParams.get("c") || ""}&k=…`; } catch { return String(url || ""); }
}

/** An <svg> QR code for the text (scales crisply; fill attributes only, so it is CSP safe). */
export function qrSvg(text, label = "QR code") {
  const qr = encodeQR(text, { ecc: "M" }), margin = 4, n = qr.size + margin * 2;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${n} ${n}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", label);
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.setAttribute("class", "pc-qr");
  const bg = document.createElementNS(SVG_NS, "rect");
  bg.setAttribute("width", String(n)); bg.setAttribute("height", String(n)); bg.setAttribute("fill", "#fff");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", qrPath(qr, margin)); path.setAttribute("fill", "#000");
  svg.append(bg, path);
  return svg;
}

function remember(on) { try { if (on) sessionStorage.setItem(STORE_KEY, "1"); else sessionStorage.removeItem(STORE_KEY); } catch { /* storage off */ } }
function remembered() { try { return sessionStorage.getItem(STORE_KEY) === "1"; } catch { return false; } }

export function mountPhoneCam(root, { el, request, onFrameSource, onTalk } = {}) {
  const s = { pair: null, status: null, error: "", busy: false, frameTimer: 0, statusTimer: 0, inFlight: false };
  const card = el("section", { className: "card pc-card", "aria-labelledby": "pc-h" });
  let img = el("img", { className: "pc-preview", alt: "Live view from the paired iPhone" });
  img.hidden = true;
  const badge = el("span", { className: "pc-badge", "data-live": "false", role: "status" });
  root.replaceChildren(card);

  async function pair() {
    s.busy = true; s.error = ""; render();
    try {
      s.pair = await request("/api/phonecam/pair", { method: "POST" });
      remember(true); onFrameSource?.(s.pair.code); startPolling();
    } catch (e) { s.error = e.message; remember(false); }
    s.busy = false; render();
  }

  function pollFrame() {
    if (!s.pair || s.inFlight || document.hidden || !card.isConnected) return;
    s.inFlight = true;
    const next = el("img", { className: "pc-preview", alt: img.alt });
    next.onload = () => {
      s.inFlight = false;
      const empty = img.hidden;
      img.replaceWith(next); img = next;
      if (empty) render(); // drop the "appears here" hint
    };
    next.onerror = () => { s.inFlight = false; }; // 404 until the phone sends its first frame
    next.src = `/api/phonecam/latest.jpg?c=${encodeURIComponent(s.pair.code)}&t=${Date.now()}`;
  }

  async function pollStatus() {
    if (!s.pair || document.hidden || !card.isConnected) return;
    try {
      const r = await fetch(`/api/phonecam/status?c=${encodeURIComponent(s.pair.code)}`, { cache: "no-store" });
      if (r.status === 404) { s.pair = null; s.status = null; remember(false); onFrameSource?.(null); stopPolling(); render(); return; }
      if (!r.ok) return;
      const was = s.status?.live;
      s.status = await r.json();
      updateBadge();
      if (was !== s.status.live) render();
    } catch { /* keep the last status */ }
  }

  function startPolling() {
    stopPolling();
    s.frameTimer = setInterval(pollFrame, FRAME_MS); s.statusTimer = setInterval(pollStatus, STATUS_MS);
    pollStatus(); pollFrame();
  }
  function stopPolling() { clearInterval(s.frameTimer); clearInterval(s.statusTimer); s.frameTimer = s.statusTimer = 0; }

  function updateBadge() {
    badge.textContent = badgeText(s.pair ? s.status || {} : null);
    badge.dataset.live = String(Boolean(s.status?.live));
  }

  function qrBlock(open) {
    const copy = el("button", { type: "button", className: "secondary", textContent: "Copy link" });
    copy.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(s.pair.url); copy.textContent = "Copied"; }
      catch { copy.textContent = "Copy failed: select the link"; }
      setTimeout(() => { copy.textContent = "Copy link"; }, 2000);
    });
    const body = el("div", { className: "pc-pair" },
      qrSvg(s.pair.url, "QR code that opens the Threadline camera page on the iPhone"),
      el("div", { className: "pc-pair-text" },
        el("p", { className: "pc-steps", textContent: "Open the iPhone Camera app, point it at this code and tap the link. Then tap “Start camera” and allow the camera." }),
        el("p", { className: "pc-code" }, "Pairing code ", el("b", { textContent: s.pair.code })),
        el("p", { className: "pc-url caption", title: s.pair.url, textContent: displayUrl(s.pair.url) }),
        copy));
    if (open) return body;
    return el("details", { className: "pc-more" }, el("summary", { textContent: "Show the QR code again" }), body);
  }

  function render() {
    const head = el("div", { className: "pc-head" }, el("h2", { id: "pc-h", textContent: "Live camera · iPhone" }), s.pair ? badge : null);
    if (!s.pair) {
      const btn = el("button", { type: "button", className: "primary-sm", textContent: s.busy ? "Connecting…" : "Connect iPhone camera", disabled: s.busy });
      btn.addEventListener("click", pair);
      card.replaceChildren(...[head,
        el("p", { className: "caption", textContent: "Use an iPhone as a live camera. Threadline shows what it sees here, and Gemini Live can talk with the person about it through the Vexo band." }),
        btn, s.error ? el("p", { className: "caption", role: "alert", textContent: s.error }) : null].filter(Boolean));
      return;
    }
    updateBadge();
    const live = Boolean(s.status?.live);
    const talk = el("button", { type: "button", className: "primary-sm", textContent: "Talk about what it sees (Gemini Live)", disabled: !onTalk });
    talk.addEventListener("click", () => onTalk?.(s.pair.code));
    const stage = el("div", { className: "pc-stage" }, img,
      live || !img.hidden ? null : el("p", { className: "pc-empty", textContent: "The picture appears here once the phone starts sending." }));
    card.replaceChildren(head, stage, el("div", { className: "pc-actions" }, talk), qrBlock(!live && !s.status?.at));
  }

  document.addEventListener("visibilitychange", () => { if (!document.hidden && s.pair) { pollStatus(); pollFrame(); } });
  render();
  if (remembered()) pair();
  return { code: () => s.pair?.code || null, pair };
}
