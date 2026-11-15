// Pure logic for what Threadline offers when energy changes. No DOM, no network, no storage:
// the page calls these, shows the result, and acts only after the person taps.
export const addDays = (day, n) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

const DECISION = /\b(should i|need to decide|have to decide|trying to decide|can'?t decide|deciding|big decision|(i'?m|i am) (going|about) to (quit|sign|buy|move|commit|book|start|send|tell|break)|(i'?ll|i will|let'?s) (just )?(sign|buy|quit|book|commit|send|do it)|thinking (of|about) (quitting|buying|moving|signing|leaving|starting)|what if i (quit|move|sign|buy|leave))\b/i;
export const isDecisionTalk = (text) => DECISION.test(text || "");

// Require the same reading twice in a row before the app acts, so one noisy window can't trigger anything.
export function stabilizer(needed = 2, initial = "unknown") {
  let current = initial, candidate = null, count = 0;
  return { get current() { return current; }, push(reading) {
    if (reading === current) { candidate = null; count = 0; return null; }
    if (reading !== candidate) { candidate = reading; count = 0; }
    if (++count < needed) return null;
    const change = { from: current, to: reading }; current = reading; candidate = null; count = 0; return change;
  } };
}

export const LOW_STATES = new Set(["low", "moody"]);
// Which playbook a change of state calls for (or null).
export function playbookFor({ from, to }) {
  if (to === "low") return "low";
  if (to === "moody") return "moody";
  if (LOW_STATES.has(from) && (to === "positive" || to === "steady")) return "recover";
  return null;
}

const open = (t) => !t.done;
const parked = (t, today) => Boolean(t.heldUntil && t.heldUntil > today);
// Rank open, un-parked tasks: overdue/today first, then soon; big decisions sink when energy is not good.
export function prioritize(tasks, { today, energy = "steady", max } = {}) {
  const cap = max ?? (energy === "low" ? 1 : energy === "moody" ? 2 : 3);
  const score = (t) => {
    let s = 0;
    if (t.due) { const gap = (Date.parse(t.due) - Date.parse(today)) / 86400000; s += gap < 0 ? 4 : gap === 0 ? 3 : gap <= 2 ? 1.5 : gap <= 7 ? 0.5 : 0; }
    if (t.big && energy !== "positive") s -= 5;   // not a day to decide big things
    return s;
  };
  const pool = tasks.filter((t) => open(t) && !parked(t, today)).map((t) => ({ t, s: score(t) }));
  pool.sort((a, b) => b.s - a.s);
  const focus = pool.filter((x) => x.s > -1).slice(0, cap).map((x) => x.t);
  const ids = new Set(focus.map((t) => t.id));
  return { focus, later: pool.map((x) => x.t).filter((t) => !ids.has(t.id)) };
}

// Move tasks to later and remember where they were, so they can be offered back.
export function pushLater(tasks, ids, { today, days = 2, reason = "low energy", now = new Date().toISOString() } = {}) {
  const want = new Set(ids); let n = 0;
  for (const t of tasks) if (want.has(t.id) && open(t) && !parked(t, today)) {
    t.pushed = { due: t.due ?? null, at: now, reason }; t.heldUntil = addDays(today, days); n += 1;
  }
  return n;
}
export const pushedTasks = (tasks) => tasks.filter((t) => open(t) && t.pushed);
export function takeBack(tasks, ids, { today } = {}) {
  const want = new Set(ids); let n = 0;
  for (const t of tasks) if (want.has(t.id) && t.pushed) {
    t.heldUntil = null; if (!t.due || t.due < today) t.due = today; delete t.pushed; n += 1;
  }
  return n;
}
// Put things back exactly as they were (undo).
export function undoPush(tasks, ids) {
  const want = new Set(ids); let n = 0;
  for (const t of tasks) if (want.has(t.id) && t.pushed) { t.heldUntil = null; t.due = t.pushed.due; delete t.pushed; n += 1; }
  return n;
}

export const checkInDraft = (name) => `Hi${name ? ` ${name}` : ""} — it's a low-energy day for me. Could we talk for a few minutes today? No need to fix anything.`;
