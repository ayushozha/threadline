"use strict";
// Local recordings of the band's microphone: 16 kHz mono PCM kept in this browser's IndexedDB on this computer.
// Never uploaded by this module. Chunks are written every few seconds, so a closed tab loses at most a few seconds.

export const RATE = 16000;
const DB_NAME = "threadline-audio";
const FLUSH_BYTES = RATE * 2 * 5;          // write to disk about every 5 seconds of sound
export const CAP_BYTES = 2 * 1024 ** 3;    // oldest finished recordings are removed beyond this (about 17 hours)

/** 16-bit mono PCM pieces -> a playable WAV file. Pure, so it can be tested without a browser. */
export function wavBlob(pieces, rate = RATE) {
  const bytes = pieces.reduce((n, p) => n + p.byteLength, 0);
  const head = new DataView(new ArrayBuffer(44));
  const text = (at, s) => { for (let i = 0; i < s.length; i++) head.setUint8(at + i, s.charCodeAt(i)); };
  text(0, "RIFF"); head.setUint32(4, 36 + bytes, true); text(8, "WAVE"); text(12, "fmt ");
  head.setUint32(16, 16, true); head.setUint16(20, 1, true); head.setUint16(22, 1, true);
  head.setUint32(24, rate, true); head.setUint32(28, rate * 2, true); head.setUint16(32, 2, true); head.setUint16(34, 16, true);
  text(36, "data"); head.setUint32(40, bytes, true);
  return new Blob([head, ...pieces], { type: "audio/wav" });
}

export const seconds = (session) => Math.round(session.bytes / (RATE * 2));
export function sizeLabel(bytes) { return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : bytes >= 1024 ** 2 ? `${Math.round(bytes / 1024 ** 2)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`; }
export function durationLabel(s) { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`; }

const wrap = (request) => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
const done = (tx) => new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });

export function createAudioStore({ onError = () => {} } = {}) {
  let dbPromise = null;
  const open = () => dbPromise ||= new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("This browser cannot store audio."));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("sessions", { keyPath: "id" });
      request.result.createObjectStore("chunks", { keyPath: ["session", "n"] });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const live = new Map();   // session id -> { pieces, bytes, n, session, failed }

  async function writeChunk(id, state) {
    if (!state.bytes) return;
    const data = new Int16Array(state.bytes / 2);
    let at = 0;
    for (const piece of state.pieces) { data.set(piece, at); at += piece.length; }
    const wrote = state.bytes;
    state.pieces = []; state.bytes = 0;
    const db = await open(), tx = db.transaction(["sessions", "chunks"], "readwrite");
    tx.objectStore("chunks").put({ session: id, n: state.n++, data: data.buffer });
    state.session.bytes += wrote; state.session.updatedAt = new Date().toISOString();
    tx.objectStore("sessions").put({ ...state.session });
    await done(tx);
  }

  const store = {
    open,
    async persist() { try { await navigator.storage?.persist?.(); } catch { /* optional */ } },
    /** Begin a recording. Returns its id, or null if storage is not available (the caller carries on without it). */
    async start(meta = {}) {
      try {
        await open();
        const id = `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        const session = { id, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), endedAt: null, rate: RATE, bytes: 0, ...meta };
        const db = await open(), tx = db.transaction("sessions", "readwrite");
        tx.objectStore("sessions").put(session); await done(tx);
        live.set(id, { pieces: [], bytes: 0, n: 0, session, failed: false, queue: Promise.resolve() });
        this.persist(); this.trim().catch(() => {});
        return id;
      } catch (e) { onError(e); return null; }
    },
    /** Add 16-bit samples. Safe to call 50 times a second; it never throws. */
    append(id, samples) {
      const state = id && live.get(id);
      if (!state || state.failed) return;
      state.pieces.push(samples); state.bytes += samples.byteLength;
      if (state.bytes >= FLUSH_BYTES) state.queue = state.queue.then(() => writeChunk(id, state)).catch((e) => { if (!state.failed) { state.failed = true; onError(e); } });
    },
    async finish(id) {
      const state = id && live.get(id);
      if (!state) return;
      try {
        await state.queue; await writeChunk(id, state);
        state.session.endedAt = new Date().toISOString();
        const db = await open(), tx = db.transaction("sessions", "readwrite");
        tx.objectStore("sessions").put({ ...state.session }); await done(tx);
      } catch (e) { onError(e); }
      live.delete(id);
    },
    async list() {
      const db = await open();
      const all = await wrap(db.transaction("sessions").objectStore("sessions").getAll());
      return all.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    },
    async total() { return (await this.list()).reduce((n, s) => n + s.bytes, 0); },
    async blob(id) {
      const db = await open();
      const range = IDBKeyRange.bound([id, 0], [id, Infinity]);
      const rows = await wrap(db.transaction("chunks").objectStore("chunks").getAll(range));
      return wavBlob(rows.map((r) => new Int16Array(r.data)));
    },
    async remove(id) {
      const db = await open(), tx = db.transaction(["sessions", "chunks"], "readwrite");
      tx.objectStore("sessions").delete(id);
      tx.objectStore("chunks").delete(IDBKeyRange.bound([id, 0], [id, Infinity]));
      await done(tx);
    },
    async clear() { for (const s of await this.list()) if (!live.has(s.id)) await this.remove(s.id); },
    /** Keep the newest recordings under the cap; a recording still being written is never removed. */
    async trim(cap = CAP_BYTES) {
      let total = await this.total();
      for (const s of (await this.list()).reverse()) {
        if (total <= cap) break;
        if (live.has(s.id)) continue;
        await this.remove(s.id); total -= s.bytes;
      }
    },
  };
  return store;
}

/** Fill `box` with the saved recordings: play, download, delete. */
export async function renderRecordings(store, box, el, note) {
  let sessions = [];
  try { sessions = await store.list(); } catch (e) { box.replaceChildren(el("li", { className: "empty", textContent: e.message })); return; }
  const used = sessions.reduce((n, s) => n + s.bytes, 0);
  if (note) note.textContent = sessions.length ? `${sessions.length} recording${sessions.length > 1 ? "s" : ""} · ${sizeLabel(used)} on this computer, in this browser. Never uploaded.` : "Nothing saved yet. Audio from the band is saved here whenever it is recording.";
  if (!sessions.length) { box.replaceChildren(el("li", { className: "empty", textContent: "No recordings yet." })); return; }
  box.replaceChildren(...sessions.map((s) => {
    const when = new Date(s.startedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    const slot = el("div", { className: "rec-player" });
    const play = el("button", { type: "button", className: "secondary", textContent: "Play" });
    const save = el("button", { type: "button", className: "secondary", textContent: "Download" });
    const del = el("button", { type: "button", className: "text-button", textContent: "Delete" });
    play.addEventListener("click", async () => {
      if (slot.firstChild) { slot.firstChild.pause?.(); URL.revokeObjectURL(slot.firstChild.src); slot.replaceChildren(); play.textContent = "Play"; return; }
      const audio = el("audio", { controls: true, src: URL.createObjectURL(await store.blob(s.id)) });
      slot.replaceChildren(audio); play.textContent = "Close"; audio.play().catch(() => {});
    });
    save.addEventListener("click", async () => {
      const url = URL.createObjectURL(await store.blob(s.id));
      const link = el("a", { href: url, download: `band-${s.band || "audio"}-${s.startedAt.slice(0, 19).replace(/[:T]/g, "-")}.wav` });
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    });
    del.addEventListener("click", async () => { if (confirm("Delete this recording from this computer?")) { await store.remove(s.id); renderRecordings(store, box, el, note); } });
    return el("li", { className: "recording-row" },
      el("div", { className: "rec-line" },
        el("div", {}, el("b", { textContent: when }), el("span", { className: "caption", textContent: ` · ${durationLabel(seconds(s))} · ${sizeLabel(s.bytes)}${s.endedAt ? "" : " · still recording or interrupted"}${s.band ? ` · ${s.band}` : ""}` })),
        el("div", { className: "row tight" }, play, save, del)),
      slot);
  }));
}
