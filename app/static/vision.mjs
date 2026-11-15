// Camera frames stay in memory. Only these sampled JPEGs are sent after explicit consent.
export function createVisionController({ getContext, request, onResult, onStatus = () => {} }) {
  let video = null, scope, epoch = 0, frames = [], previous = null, sceneDirty = false;
  let sampleTimer, checkTimer, requestTimer, queuedQuestion, pending = null, abort = null;
  let lastRequest = -Infinity, lastAutomatic = -Infinity;
  const canvas = document.createElement('canvas'), thumbnail = document.createElement('canvas');
  const ctx = canvas.getContext('2d'), small = thumbnail.getContext('2d', { willReadFrequently: true });
  thumbnail.width = 32; thumbnail.height = 18;
  const current = (version = epoch) => {
    const context = getContext();
    return Boolean(video && version === epoch && context.active && context.allowed && context.scope === scope);
  };
  function sample() {
    if (!current()) {
      frames = []; previous = null; abort?.abort();
      return false;
    }
    if (!ctx || !small || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return false;
    try {
      const ratio = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.max(1, Math.round(video.videoWidth * ratio));
      canvas.height = Math.max(1, Math.round(video.videoHeight * ratio));
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.65), data = dataUrl.split(',')[1];
      if (!data || data.length > 500 * 1024) { onStatus('Camera frame is too large.'); return false; }
      small.drawImage(canvas, 0, 0, 32, 18);
      const pixels = small.getImageData(0, 0, 32, 18).data;
      let difference = 0;
      if (previous) for (let i = 0; i < pixels.length; i += 4) {
        difference += Math.abs(pixels[i] - previous[i]) + Math.abs(pixels[i + 1] - previous[i + 1]) + Math.abs(pixels[i + 2] - previous[i + 2]);
      }
      const changed = !previous || difference / (32 * 18 * 3) > 18;
      previous = new Uint8ClampedArray(pixels);
      frames.push({ id: `frame-${crypto.randomUUID()}`, at: new Date().toISOString(), mime_type: 'image/jpeg', data, dataUrl });
      frames = frames.slice(-3);
      return changed;
    } catch { onStatus('Camera preview is not ready to sample.'); return false; }
  }
  function queueCheck(question) {
    if (!current()) return false;
    if (question !== undefined) queuedQuestion = question;
    if (!checkTimer) checkTimer = setTimeout(() => {
      checkTimer = null;
      if (!current()) return;
      if (pending) { queueCheck(); return; }
      const next = queuedQuestion; queuedQuestion = undefined;
      void analyze(next);
    }, Math.max(4000, 4000 - (Date.now() - lastRequest)));
    return true;
  }
  function analyze(question) {
    if (!current()) return Promise.resolve(null);
    if (pending) { queueCheck(question); return pending; }
    if (Date.now() - lastRequest < 4000) { queueCheck(question); return Promise.resolve(null); }
    sample();
    if (!frames.length || !current()) { onStatus('Waiting for a camera frame.'); return Promise.resolve(null); }
    clearTimeout(checkTimer); checkTimer = null; queuedQuestion = undefined;
    const version = epoch, context = getContext(), selected = frames.slice();
    const controller = new AbortController(); abort = controller;
    sceneDirty = false;
    lastRequest = Date.now(); onStatus('Checking sampled frames with your recent words…');
    const work = (async () => {
      let timeout, timedOut = false;
      try {
        const options = {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
          body: JSON.stringify({
            question: question || context.question || 'Describe relevant visible details using the sampled frames and recent words. Do not infer identity, health, or emotions.',
            frames: selected.map(({ dataUrl, ...frame }) => frame),
            transcript: (context.transcript || []).slice(-12).map(({ id, text, at, source }) => ({ id, text, at, source })),
          }),
        };
        const data = await Promise.race([
          Promise.resolve().then(() => request('/api/vision', options)),
          new Promise((_, reject) => { requestTimer = timeout = setTimeout(() => { timedOut = true; controller.abort(); reject(new Error('Visual check timed out')); }, 50000); }),
        ]);
        if (!current(version) || controller.signal.aborted) return null;
        onResult(data, selected); onStatus('Updated from sampled frames and recent words.');
        return data;
      } catch (error) {
        if (current(version) && (timedOut || !controller.signal.aborted)) onStatus('Visual check unavailable. Camera preview continues.');
        return null;
      } finally {
        clearTimeout(timeout);
        if (version === epoch) { pending = null; abort = null; }
      }
    })();
    pending = work;
    return work;
  }
  function stop() {
    epoch++; clearInterval(sampleTimer); clearTimeout(checkTimer); clearTimeout(requestTimer); abort?.abort();
    video = null; frames = []; previous = null; sceneDirty = false; pending = null; abort = null;
    sampleTimer = null; checkTimer = null; queuedQuestion = undefined;
    lastRequest = -Infinity; lastAutomatic = -Infinity;
    canvas.width = 0; canvas.height = 0;
  }
  return {
    start(element) {
      stop(); video = element; scope = getContext().scope;
      const tick = () => {
        if (sample()) sceneDirty = true;
        if (current() && sceneDirty && Date.now() - lastAutomatic >= 12000) {
          lastAutomatic = Date.now(); queueCheck();
        }
      };
      tick(); sampleTimer = setInterval(tick, 3000);
    },
    stop, analyze, queueCheck,
  };
}
