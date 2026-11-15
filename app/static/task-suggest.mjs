/* Pure task suggestions for the Tasks screen. Every suggestion names its source and why;
   nothing is saved until the person taps Add. Health nudges are factual, never diagnoses. */

// Concrete follow-ups for the known scenario-library scenes.
const SCENE_TASKS = {
  "memory-stove": "Check the stove is off before sitting down",
  "hearing-missed-call": "Check the kettle and pots before leaving the kitchen",
  "memory-pills": "Check today's slot in the pill organiser",
  "memory-door-confused": "Label the front-door key",
  "memory-glasses": "Pick one home spot for your glasses",
  "mobility-hallway": "Fix the folded rug in the hallway",
  "mobility-curb": "Put a lowered-kerb route in the map",
  "mobility-steps-street": "Plan a step-free route for evening walks",
  "mobility-fall": "Agree a check-in plan with your caregiver after a fall",
  "sight-steps-night": "Ask for a light at the outside steps",
  "sight-stairs-indoor": "Mark the top stair edge with contrast tape",
  "sight-shelf": "Ask the pharmacy for large-print medicine labels",
  "sight-cane-crossing": "Note the crossings with audible signals",
  "hearing-doorbell": "Set up a visual or vibrating doorbell alert",
};
const ACTIONABLE = new Set(["alert_caregiver", "routine_reminder", "haptic_warning"]);

const addDays = (day, n) => {
  const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const hm = (hours) => { const h = Math.floor(hours), m = Math.round((hours - h) * 60); return `${h} h ${String(m).padStart(2, "0")} m`; };
const clip = (s, n = 140) => { s = String(s || "").trim().replace(/\s+/g, " "); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

export function suggestTasks({ scenarios = [], careHistory = [], routine = [], healthLatest = null, existingTitles = [], today, mode = null, limit = 8 } = {}) {
  const day = today || new Date().toISOString().slice(0, 10);
  const seen = new Set(existingTitles.map((t) => String(t).trim().toLocaleLowerCase()));
  const out = [];
  const push = (s) => {
    const key = s.title.trim().toLocaleLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key); out.push({ big: false, ...s, title: clip(s.title, 120), why: clip(s.why) });
  };

  // 1. Apple Health — factual nudges only.
  const h = healthLatest || {};
  if (typeof h.sleep_hours === "number" && h.sleep_hours > 0 && h.sleep_hours < 6)
    push({ id: "health-sleep", title: "Plan a quiet afternoon", due: day, why: `Short sleep last night (${hm(h.sleep_hours)})`, source: "Apple Health" });
  if (typeof h.steps === "number" && h.steps < 2000)
    push({ id: "health-steps", title: "Take a short walk if you feel up to it", due: day, why: `${Math.round(h.steps).toLocaleString("en-US")} steps recorded so far`, source: "Apple Health" });

  // 2. Care agent history — latest next steps first.
  for (const e of [...careHistory].reverse().filter((e) => e && String(e.next_step || "").trim()).slice(0, 3))
    push({ id: `care-${e.at || e.next_step}`, title: e.next_step, due: day, why: e.summary ? `Care check: ${e.summary}` : "Care check next step", source: "Care agent" });

  // 3. Care routine — today's routine items.
  routine.filter((r) => typeof r === "string" && r.trim()).forEach((r, i) =>
    push({ id: `routine-${i}-${r.trim().toLocaleLowerCase()}`, title: r, due: day, why: "Part of today's care routine", source: "Care routine" }));

  // 4. Scenario library — caregiver alerts, routine reminders and warnings; current mode first.
  const scenes = scenarios.filter((s) => ACTIONABLE.has(s?.analysis?.decision?.action) || SCENE_TASKS[s?.id]);
  scenes.sort((a, b) => (b.mode === mode) - (a.mode === mode) || (b.analysis?.decision?.urgency === "now") - (a.analysis?.decision?.urgency === "now"));
  for (const s of scenes) {
    const v = s.analysis?.vision || {}, urgency = s.analysis?.decision?.urgency;
    const title = SCENE_TASKS[s.id] || (v.caregiver_note ? `Follow up: ${s.title}` : "");
    if (!title) continue;
    push({ id: `scene-${s.id}`, title, due: urgency === "routine" ? addDays(day, 1) : day,
      why: `${s.title}: ${v.caregiver_note || v.say_now || ""}`, source: "Example scenario", sample: true, mode: s.mode });
  }
  return out.slice(0, limit);
}
