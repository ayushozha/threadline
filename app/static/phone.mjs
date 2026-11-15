// Threadline phone camera (/static/phone.html?c=<code>&k=<secret>): the rear camera of an iPhone (or any phone)
// sends a JPEG every 500 ms to /api/phonecam/frame. The dashboard shows it and Gemini Live can watch it.
// Separate page: no app.js, no session cookie needed (the code + secret in the link authorise the frames).

export const SEND_MS = 500;
export const FRAME_WIDTH = 640;
export const QUALITY = 0.6;

/** Reads the pairing from a query string: { code, key } or null when missing/malformed. */
export function parsePairing(search) {
  const p = new URLSearchParams(search);
  const code = p.get("c") || "", key = p.get("k") || "";
  return /^\d{6}$/.test(code) && /^[a-f0-9]{32}$/.test(key) ? { code, key } : null;
}

/** Output size for a frame: FRAME_WIDTH wide (never upscaled), keeping the aspect ratio of the current orientation. */
export function frameSize(videoWidth, videoHeight, target = FRAME_WIDTH) {
  if (!videoWidth || !videoHeight) return null;
  const width = Math.min(target, videoWidth);
  return { width, height: Math.max(1, Math.round(width * videoHeight / videoWidth)) };
}

/** Wait after n consecutive network failures: 0.5 s, 1 s, 2 s, 4 s, then 5 s. */
export function backoffMs(failures) {
  return failures <= 0 ? 0 : Math.min(5000, 500 * 2 ** (failures - 1));
}

/** Frames per second from a list of send timestamps (ms), over the last `windowMs`. */
export function rate(times, now, windowMs = 5000) {
  return Math.round((times.filter((t) => now - t <= windowMs).length / (windowMs / 1000)) * 10) / 10;
}

function main() {
  const $ = (id) => document.getElementById(id);
  const pairing = parsePairing(location.search);
  const video = $("pc-video"), canvas = $("pc-canvas"), ctx = canvas.getContext("2d");
  const s = { stream: null, timer: 0, inFlight: false, sent: [], failures: 0, retryAt: 0, quality: QUALITY, wake: null, running: false };

  if (pairing) $("pc-code").replaceChildren("Pairing code ", Object.assign(document.createElement("b"), { textContent: pairing.code }));
  else {
    $("pc-code").textContent = "This link is incomplete. Scan the QR code on the Threadline dashboard again.";
    $("pc-start").disabled = true;
  }

  const status = (text, state = "live") => { $("pc-status").textContent = text; $("pc-dot").dataset.state = state; };
  const error = (text = "") => { $("pc-error").textContent = text; };

  async function keepAwake() {
    try { if ("wakeLock" in navigator && !s.wake) { s.wake = await navigator.wakeLock.request("screen"); s.wake.addEventListener("release", () => { s.wake = null; }); } }
    catch { /* not allowed right now (low battery, background): the screen may dim */ }
  }

  async function openCamera() {
    s.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } } });
    video.srcObject = s.stream;
    await video.play().catch(() => {});
  }

  async function sendFrame() {
    if (!s.running || s.inFlight || document.hidden || Date.now() < s.retryAt) return;
    const size = frameSize(video.videoWidth, video.videoHeight);
    if (!size) return;
    if (canvas.width !== size.width || canvas.height !== size.height) { canvas.width = size.width; canvas.height = size.height; }
    ctx.drawImage(video, 0, 0, size.width, size.height);
    s.inFlight = true;
    try {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", s.quality));
      if (!blob) throw new Error("Couldn't capture a picture.");
      const url = `/api/phonecam/frame?c=${encodeURIComponent(pairing.code)}&k=${encodeURIComponent(pairing.key)}`;
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: blob, cache: "no-store" });
      if (r.status === 403 || r.status === 404) {
        const d = await r.json().catch(() => ({}));
        stop(); status("Disconnected", "error");
        error(typeof d.detail === "string" ? d.detail : "This pairing ended. Scan the QR code on the dashboard again.");
        return;
      }
      if (r.status === 413) { s.quality = Math.max(0.3, s.quality - 0.1); return; }
      if (r.status === 429) return; // a little too fast: the next tick catches up
      if (!r.ok) throw new Error(`Server answered ${r.status}`);
      s.failures = 0; s.retryAt = 0; error("");
      const now = Date.now(); s.sent.push(now); s.sent = s.sent.filter((t) => now - t <= 5000);
      status(`Sending · ${rate(s.sent, now).toFixed(1)} fps`, "live");
    } catch (e) {
      s.failures += 1; s.retryAt = Date.now() + backoffMs(s.failures);
      status(`Reconnecting… (try ${s.failures})`, "warn");
      error(`Last error: ${e.message || "network unavailable"}. Retrying automatically.`);
    } finally { s.inFlight = false; }
  }

  async function start() {
    if (!pairing || s.running) return;
    $("pc-start").disabled = true;
    if (!navigator.mediaDevices?.getUserMedia) {
      error(""); $("pc-code").textContent = "This browser can't open the camera. Open the link in Safari (iOS 14.3 or newer) over https.";
      $("pc-start").disabled = false; return;
    }
    try { await openCamera(); }
    catch (e) {
      $("pc-start").disabled = false;
      $("pc-code").textContent = e.name === "NotAllowedError"
        ? "Camera permission was denied. In Settings → Safari → Camera choose Allow (or Ask), then tap Start camera again."
        : `The camera couldn't start (${e.message || e.name}).`;
      return;
    }
    s.running = true; s.failures = 0; s.retryAt = 0; s.sent = [];
    $("pc-intro").hidden = true; video.hidden = false; $("pc-bar").hidden = false; $("pc-foot").hidden = false;
    status("Starting…", "idle"); error("");
    keepAwake();
    s.timer = setInterval(sendFrame, SEND_MS);
  }

  function stop() {
    s.running = false; clearInterval(s.timer); s.timer = 0;
    s.stream?.getTracks().forEach((t) => t.stop()); s.stream = null; video.srcObject = null;
    s.wake?.release().catch(() => {}); s.wake = null;
  }

  $("pc-start").addEventListener("click", start);
  const backToIntro = () => {
    stop(); video.hidden = true; $("pc-bar").hidden = true; $("pc-foot").hidden = true; $("pc-intro").hidden = false;
    $("pc-start").disabled = !pairing; $("pc-start").textContent = "Start camera again";
  };
  $("pc-stop").addEventListener("click", backToIntro);
  document.addEventListener("visibilitychange", async () => {
    if (document.hidden || !s.running) return;
    keepAwake(); // the lock is released whenever the page is hidden
    const live = s.stream?.getVideoTracks().some((t) => t.readyState === "live");
    if (!live) { try { await openCamera(); } catch { status("Camera paused", "warn"); error("Tap Stop, then Start camera again."); } }
    else video.play().catch(() => {});
  });
  // Rotating the phone changes videoWidth/videoHeight; frameSize() follows it each tick. iOS can pause the preview.
  const replay = () => { if (s.running) setTimeout(() => video.play().catch(() => {}), 300); };
  window.addEventListener("orientationchange", replay);
  screen.orientation?.addEventListener?.("change", replay);
  window.addEventListener("pagehide", () => { if (s.running) backToIntro(); });
}

if (typeof document !== "undefined") main();
