import test from "node:test";
import assert from "node:assert/strict";

// Minimal DOM: just enough for assistant.js, which only builds elements and sets text.
class Node_ {
  constructor(tag, props = {}) { this.tag = tag; this.children = []; this.dataset = {}; this.listeners = {}; Object.assign(this, props); }
  append(...kids) { this.children.push(...kids); }
  replaceChildren(...kids) { this.children = kids; }
  get lastChild() { return this.children[this.children.length - 1]; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  scrollIntoView() {}
  text() { return [this.textContent || "", ...this.children.map((c) => (c && c.text ? c.text() : ""))].join(" "); }
}
const nodes = {};
const $ = (id) => nodes[id] ||= new Node_("div", { id, checked: true });
const el = (tag, props = {}, ...children) => { const n = new Node_(tag, props); n.append(...children.filter((c) => c != null)); return n; };
const store = {};
globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
globalThis.confirm = () => true;
const { createAssistant } = await import("../app/static/assistant.js");

const fresh = (opts) => { for (const k of Object.keys(nodes)) delete nodes[k]; for (const k of Object.keys(store)) delete store[k]; return createAssistant({ $, el, ...opts }); };

test("conversation is kept per band and shown with its reason", () => {
  const a = fresh();
  a.setBand("band-73");
  a.record("you", "Vexa, I'm exhausted", { at: "2026-11-14T20:00:00Z" });
  a.handle({ type: "assistant", text: "Want me to make some room?", trigger: { kind: "words", energy: "low", evidence: "exhausted" } });
  a.handle({ type: "decision", decision: { action: "offer_schedule", reason: "You said it.", engine: "gemini" } });
  const log = $("assistant-log").children;
  assert.equal(log.length, 2);
  assert.match(log[1].text(), /Spoke up because you said “exhausted”/);
  assert.match(log[1].text(), /Offered: make space in your schedule/);
  assert.equal(JSON.parse(store["threadline.assistant.v1.band-73"]).length, 2);
  a.setBand("band-12");
  assert.equal($("assistant-log").children.length, 1);  // empty-state line only: another band, another conversation
  a.setBand("band-73");
  assert.equal($("assistant-log").children.length, 2);
});

test("signal-based nudges say they compare with the person's own baseline", () => {
  const a = fresh();
  a.record("assistant", "That sounded tense. Want a break?", { trigger: { kind: "signals", energy: "moody", drivers: ["voice rms above usual"] } });
  assert.match($("assistant-log").children[0].text(), /moved away from your usual \(voice rms above usual\).*not a diagnosis/s);
});

test("mood line says it is still learning until there is a reading", () => {
  const a = fresh();
  a.render();
  assert.match($("assistant-mood").textContent, /learns your own baseline/);
  a.mood({ energy: "low", arousal: -1.4, valence: 0.2, confidence: 0.6, sources: ["voice", "text"] });
  assert.match($("assistant-mood").textContent, /low energy · arousal -1.4, mood \+0.2 vs your own baseline · 60% confidence · from voice \+ text/);
});

test("listening state, availability and proactive switch", () => {
  const a = fresh();
  a.setAvailable(false);
  assert.equal($("assistant-on").disabled, true);
  assert.equal($("assistant-on").checked, false);
  a.setAvailable(true);
  assert.equal($("assistant-on").disabled, false);
  a.setListening(true);
  assert.equal($("assistant-state").dataset.on, "true");
  assert.equal(a.proactive(), true);
  $("assistant-proactive").checked = false;
  assert.equal(a.proactive(), false);
});

test("clear and settings callbacks", () => {
  let changed = 0;
  const a = fresh({ onSettings: () => { changed += 1; } });
  a.init();
  a.record("you", "hello");
  $("assistant-clear").listeners.click[0]();
  assert.equal(JSON.parse(store["threadline.assistant.v1.browser"]).length, 0);
  $("assistant-proactive").listeners.change[0]();
  assert.equal(changed, 1);
});

test("speech playback is scheduled back to back and can be muted", () => {
  const started = [];
  globalThis.window = { AudioContext: class {
    constructor() { this.state = "running"; this.currentTime = 10; this.destination = {}; }
    createBuffer(_c, n, rate) { return { duration: n / rate, getChannelData: () => new Float32Array(n) }; }
    createBufferSource() { return { connect() {}, start: (t) => started.push(t) }; }
  } };
  const a = fresh();
  a.prime();
  const chunk = new Int16Array(2400).buffer;  // 0.1 s at 24 kHz
  a.play(chunk); a.play(chunk);
  assert.ok(Math.abs(started[1] - started[0] - 0.1) < 1e-9);
  $("assistant-speak").checked = false;
  a.play(chunk);
  assert.equal(started.length, 2);
});
