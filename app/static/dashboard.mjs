// Care dashboard: headline stats, charts, insights, action items and shareable reports.
// Inputs are the real Apple Health history plus the care/mood log; nothing here talks to the network.

const NS = "http://www.w3.org/2000/svg";
function h(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) { if (v == null) continue; if (k === "className") n.className = v; else if (k === "textContent") n.textContent = v; else if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v); }
  for (const c of kids.flat()) if (c != null) n.append(c);
  return n;
}
function s(tag, attrs = {}, ...kids) { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); for (const c of kids.flat()) if (c != null) n.append(c); return n; }
const avg = (a) => { const v = a.filter((x) => x != null && Number.isFinite(x)); return v.length ? v.reduce((p, c) => p + c, 0) / v.length : null; };
const fmt = (v, d = 0) => v == null ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
const hm = (v) => v == null ? "—" : `${Math.floor(v)}h ${String(Math.round((v % 1) * 60)).padStart(2, "0")}m`;
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const AGI = ["none", "mild", "moderate", "severe"];

export function buildModel({ health = {}, mood = { days: [], weeks: [] }, careHistory = [], transcripts = [], tasks = [], now = new Date() }) {
  const keys = [...Array(30)].map((_, i) => { const d = new Date(now); d.setDate(d.getDate() - (29 - i)); return dayKey(d); });
  const H = keys.map((k) => health[k] || {}), M = keys.map((k) => mood.days.find((d) => d.date === k) || {});
  const series = (f) => H.map((x) => x[f] ?? null);
  const last7 = (a) => a.slice(-7), prev = (a) => a.slice(0, -7);
  const tile = (label, arr, unit, digits = 0, better = "up", show = (v) => fmt(v, digits)) => {
    const now7 = avg(last7(arr)), base = avg(prev(arr)), delta = now7 != null && base ? (now7 - base) / Math.abs(base) : null;
    return { label, value: show(now7), unit, delta, good: delta == null ? null : (better === "up" ? delta >= 0 : delta <= 0), spark: arr };
  };
  const sleep = series("sleep_hours"), steps = series("steps"), rhr = series("resting_heart_rate"), hrv = series("hrv_sdnn"), spo2 = series("oxygen_saturation");
  const moodAvg = M.map((d) => d.morning != null ? (d.morning + d.evening) / 2 : null), agit = M.map((d) => d.agitation ?? null), rep = M.map((d) => d.repeats ?? null);
  const csdd = mood.weeks.at(-1)?.score ?? null, csddPrev = mood.weeks.at(-2)?.score ?? null;
  const tiles = [
    tile("Sleep", sleep, "per night", 1, "up", hm), tile("Steps", steps, "per day", 0, "up"), tile("Resting HR", rhr, "bpm", 0, "down"),
    tile("HRV", hrv, "ms", 0, "up"), tile("Mood", moodAvg, "−1 … +1", 2, "up", (v) => (v > 0 ? "+" : "") + fmt(v, 2)),
    tile("Agitated evenings", agit.map((a) => a == null ? null : a >= 2 ? 1 : 0), "of last 7", 0, "down", () => String(last7(agit).filter((a) => a >= 2).length)),
    tile("Repeated questions", rep, "per day", 1, "down"),
    { label: "CSDD", value: csdd == null ? "—" : String(csdd), unit: "weekly · 0–38", delta: csdd != null && csddPrev ? (csdd - csddPrev) / csddPrev : null, good: csdd != null && csddPrev != null ? csdd <= csddPrev : null, spark: mood.weeks.map((w) => w.score) },
  ];
  // Insights: computed from the data, one line each.
  const insights = [];
  const shortN = keys.map((_, i) => sleep[i] != null && sleep[i] < 6), agOnShort = avg(agit.filter((_, i) => shortN[i])), agOnLong = avg(agit.filter((_, i) => sleep[i] != null && !shortN[i]));
  if (agOnShort != null && agOnLong) insights.push({ big: `${fmt(agOnShort / agOnLong, 1)}×`, text: "more evening agitation after nights under 6 hours" });
  const activeCalm = avg(agit.filter((_, i) => steps[i] > 8000)), lowCalm = avg(agit.filter((_, i) => steps[i] != null && steps[i] < 4000));
  if (activeCalm != null && lowCalm != null) insights.push({ big: `${fmt(Math.max(0, (1 - activeCalm / (lowCalm || 1)) * 100))}%`, text: "calmer evenings on days with 8,000+ steps" });
  const sun = avg(moodAvg.filter((_, i) => new Date(`${keys[i]}T12:00:00`).getDay() === 0)), rest = avg(moodAvg.filter((_, i) => new Date(`${keys[i]}T12:00:00`).getDay() !== 0));
  if (sun != null && rest != null) insights.push({ big: `${sun - rest >= 0 ? "+" : ""}${fmt(sun - rest, 2)}`, text: "mood lift on Sundays, when family visits" });
  insights.push({ big: String(transcripts.reduce((n, t) => n + (t.lines?.length || 0), 0)), text: "conversation lines captured by the band" });
  // Action items: rules on the same numbers, each for one audience.
  const actions = [];
  const shortRun = (() => { let n = 0; for (let i = sleep.length - 1; i >= 0 && sleep[i] != null && sleep[i] < 6.5; i--) n++; return n; })();
  if (csdd != null && csdd >= 11) actions.push({ who: "Doctor", level: "high", text: `Book a GP review — weekly CSDD ${csdd} (probable depression range)` });
  else if (csdd != null && csdd >= 6) actions.push({ who: "Doctor", level: "mid", text: `Mention mild low-mood signs at the next visit (CSDD ${csdd})` });
  if (avg(last7(sleep)) != null && avg(last7(sleep)) < 6.5) actions.push({ who: "Caregiver", level: "high", text: `Protect sleep: ${hm(avg(last7(sleep)))} average this week${shortRun > 1 ? `, ${shortRun} short nights in a row` : ""}. Same bedtime, no caffeine after noon, dim lights by 8 pm` });
  if (last7(agit).filter((a) => a >= 2).length >= 2) actions.push({ who: "Caregiver", level: "mid", text: "Plan a calm 4–6 pm: lights on before dusk, familiar music, one simple task" });
  if (avg(last7(rep)) >= 5) actions.push({ who: "Caregiver", level: "mid", text: `Put today's plan on the whiteboard — ${fmt(avg(last7(rep)), 1)} repeated questions a day` });
  if (avg(last7(steps)) != null && avg(last7(steps)) < 6000) actions.push({ who: "Family", level: "mid", text: "Join a 15-minute walk after lunch — movement predicts calmer evenings here" });
  const rhrD = tiles[2].delta; if (rhrD != null && rhrD > 0.04) actions.push({ who: "Doctor", level: "mid", text: `Resting heart rate up ${fmt(rhrD * 100)}% vs the previous 3 weeks` });
  actions.push({ who: "Family", level: "low", text: "Sunday calls lift mood — keep the weekly visit or video call" });
  for (const t of tasks.filter((x) => !x.done).slice(0, 2)) actions.push({ who: "Caregiver", level: "low", text: t.title });
  const status = careHistory.at(-1)?.status || (actions.some((a) => a.level === "high") ? "needs_attention" : "ok");
  return { keys, H, M, tiles, insights, actions, status, csdd, weeks: mood.weeks, sleep, steps, rhr, hrv, spo2, moodAvg, agit, rep };
}

/* ---------- charts ---------- */
function spark(vals, cls = "") {
  const v = vals.map((x) => x ?? null), real = v.filter((x) => x != null); if (real.length < 2) return s("svg", { class: "dash-spark", viewBox: "0 0 100 28" });
  const lo = Math.min(...real), hi = Math.max(...real), span = hi - lo || 1, x = (i) => (i / (v.length - 1)) * 100, y = (d) => 25 - ((d - lo) / span) * 22;
  const pts = v.map((d, i) => d == null ? null : `${x(i)},${y(d)}`).filter(Boolean).join(" ");
  return s("svg", { class: `dash-spark ${cls}`, viewBox: "0 0 100 28", preserveAspectRatio: "none" }, s("polyline", { points: pts }));
}
function frame(title, sub, svg) { return h("figure", { className: "dash-chart" }, h("figcaption", {}, h("b", { textContent: title }), h("span", { textContent: sub })), svg); }
function barsLine(bars, line, { barCls = "b1", lineCls = "l1", lineMax = null } = {}) {
  const W = 300, H = 120, n = bars.length, bw = W / n, bmax = Math.max(1, ...bars.filter((x) => x != null)), lreal = line.filter((x) => x != null);
  const lmin = Math.min(...lreal), lmax = lineMax ?? Math.max(...lreal), ls = lmax - lmin || 1;
  return s("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", class: "dash-svg" },
    ...bars.map((b, i) => b == null ? null : s("rect", { x: i * bw + 1, y: H - (b / bmax) * (H - 10), width: bw - 2, height: (b / bmax) * (H - 10), rx: 2, class: barCls })),
    lreal.length > 1 ? s("polyline", { class: lineCls, points: line.map((d, i) => d == null ? null : `${i * bw + bw / 2},${H - 6 - ((d - lmin) / ls) * (H - 20)}`).filter(Boolean).join(" ") }) : null);
}
function twoLines(a, b) {
  const W = 300, H = 120, n = a.length, all = [...a, ...b].filter((x) => x != null), lo = Math.min(...all), hi = Math.max(...all), sp = hi - lo || 1;
  const pl = (arr, cls) => s("polyline", { class: cls, points: arr.map((d, i) => d == null ? null : `${(i / (n - 1)) * W},${H - 8 - ((d - lo) / sp) * (H - 18)}`).filter(Boolean).join(" ") });
  return s("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", class: "dash-svg" }, pl(a, "l2"), pl(b, "l1"));
}
function heat(M, keys) {
  const cell = 300 / 30, col = (v) => v == null ? "#e7e4da" : v > 0.2 ? "#5b9a7f" : v > -0.05 ? "#b7c9a3" : v > -0.25 ? "#e8c46a" : "#c8644a";
  return s("svg", { viewBox: "0 0 300 54", class: "dash-svg heat" },
    ...M.flatMap((d, i) => [s("rect", { x: i * cell + 1, y: 2, width: cell - 2, height: 22, rx: 3, fill: col(d.morning) }, s("title", {}, `${keys[i]} morning ${d.morningLabel || ""}`)),
      s("rect", { x: i * cell + 1, y: 28, width: cell - 2, height: 22, rx: 3, fill: col(d.evening) }, s("title", {}, `${keys[i]} evening ${d.eveningLabel || ""}`))]));
}
function weekday(keys, agit) {
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], by = names.map((_, d) => avg(agit.filter((_, i) => new Date(`${keys[i]}T12:00:00`).getDay() === d)) ?? 0), mx = Math.max(1, ...by);
  return s("svg", { viewBox: "0 0 300 120", class: "dash-svg" }, ...by.flatMap((v, i) => [s("rect", { x: i * 43 + 6, y: 100 - (v / mx) * 85, width: 30, height: (v / mx) * 85, rx: 4, class: "b2" }), s("text", { x: i * 43 + 21, y: 116, "text-anchor": "middle", class: "ax" }, names[i])]));
}
function gauge(score) {
  const pct = Math.min(1, (score ?? 0) / 24), a = Math.PI * (1 - pct), x = 60 + 48 * Math.cos(a), y = 62 - 48 * Math.sin(a);
  return s("svg", { viewBox: "0 0 120 72", class: "dash-gauge" }, s("path", { d: "M12 62 A48 48 0 0 1 108 62", class: "track" }), s("path", { d: `M12 62 A48 48 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}`, class: score >= 11 ? "hi" : score >= 6 ? "mid" : "lo" }), s("text", { x: 60, y: 58, "text-anchor": "middle", class: "gv" }, score == null ? "—" : String(score)));
}

/* ---------- reports ---------- */
export function reportText(m, audience, who = "Dad") {
  const date = new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  const t = Object.fromEntries(m.tiles.map((x) => [x.label, x]));
  const arrow = (x) => x.delta == null ? "" : ` (${x.delta >= 0 ? "▲" : "▼"} ${fmt(Math.abs(x.delta) * 100)}% vs prior 3 weeks)`;
  const acts = m.actions.filter((a) => audience === "Doctor" ? a.who === "Doctor" : audience === "Family" ? a.who !== "Doctor" : true).map((a) => `• ${a.text}`);
  const head = `Threadline Care — ${audience === "Doctor" ? "30-day clinical summary" : audience === "Family" ? "weekly update" : "daily care report"} for ${who}\n${date}\n`;
  const core = [`Sleep ${t.Sleep.value}/night${arrow(t.Sleep)}`, `Steps ${t.Steps.value}/day${arrow(t.Steps)}`, `Mood ${t.Mood.value}${arrow(t.Mood)}`, `Agitated evenings ${t["Agitated evenings"].value} of 7`, `Repeated questions ${t["Repeated questions"].value}/day`];
  const clinical = [`Resting HR ${t["Resting HR"].value} bpm${arrow(t["Resting HR"])}`, `HRV ${t.HRV.value} ms${arrow(t.HRV)}`, `SpO₂ ${fmt(avg(m.spo2.slice(-7)), 0)}%`, `Weekly CSDD: ${m.weeks.map((w) => w.score).join(" → ")} (latest ${m.csdd ?? "—"}; ≥11 probable major depression)`];
  const ins = m.insights.map((i) => `• ${i.big} ${i.text}`);
  return [head, "KEY NUMBERS (7-day average)", ...core.map((x) => `• ${x}`), ...(audience !== "Family" ? clinical.map((x) => `• ${x}`) : []), "", "WHAT WE NOTICED", ...ins, "", "ACTION ITEMS", ...acts, "",
    audience === "Doctor" ? "Sources: Apple Health (sleep, steps, HR, HRV, SpO₂), Vexo band transcripts, caregiver-rated NPI-Q agitation and CSDD. Screening information, not a diagnosis." : "Sent from Threadline Care."].join("\n");
}
function reportCard(m, audience, icon, blurb, who) {
  const body = reportText(m, audience, who), subject = `Threadline Care — ${audience} report`;
  const download = () => { const a = h("a", { href: URL.createObjectURL(new Blob([body], { type: "text/plain" })), download: `threadline-${audience.toLowerCase()}-report.txt` }); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  const copy = async (btn) => { try { await navigator.clipboard.writeText(body); btn.textContent = "Copied ✓"; } catch { btn.textContent = "Copy failed"; } };
  const pre = h("pre", { className: "dash-report-preview", textContent: body, hidden: "" });
  const copyBtn = h("button", { type: "button", className: "dash-btn", textContent: "Copy" }); copyBtn.addEventListener("click", () => copy(copyBtn));
  return h("article", { className: "dash-report" },
    h("div", { className: "dash-report-top" }, h("span", { className: "dash-report-icon", textContent: icon }), h("div", {}, h("b", { textContent: audience }), h("small", { textContent: blurb }))),
    h("div", { className: "dash-report-actions" },
      h("a", { className: "dash-btn primary", href: `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, textContent: "Email" }),
      h("a", { className: "dash-btn", href: `sms:?&body=${encodeURIComponent(body.slice(0, 900))}`, textContent: "Text" }),
      copyBtn, h("button", { type: "button", className: "dash-btn", textContent: "Download", onclick: download }),
      h("button", { type: "button", className: "dash-btn ghost", textContent: "Preview", onclick: () => { pre.hidden = !pre.hidden; } })),
    pre);
}

/* ---------- render ---------- */
export function renderDashboard(root, input) {
  if (!root) return;
  const m = buildModel(input), who = input.who || "Dad";
  const statusWord = { ok: "Settled", needs_attention: "Needs attention", urgent: "Check in now" }[m.status] || "Settled";
  const today = m.H.at(-1) || {}, tm = m.M.at(-1) || {};
  root.replaceChildren(
    h("section", { className: `dash-hero s-${m.status}` },
      h("div", {}, h("small", { textContent: new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }) }),
        h("h2", { textContent: `${who} today: ${statusWord}` }),
        h("p", { textContent: `${hm(today.sleep_hours)} sleep · ${fmt(today.steps)} steps · mood ${tm.morningLabel || "—"} → ${tm.eveningLabel || "—"} · evening agitation ${AGI[tm.agitation] ?? "—"}` })),
      h("div", { className: "dash-hero-gauge" }, gauge(m.csdd), h("small", { textContent: "Weekly CSDD" }))),
    h("section", { className: "dash-tiles" }, ...m.tiles.map((t) => h("article", { className: "dash-tile" },
      h("small", { textContent: t.label }), h("b", { textContent: t.value }), h("span", { className: "unit", textContent: t.unit }),
      t.delta != null ? h("span", { className: `delta ${t.good ? "good" : "bad"}`, textContent: `${t.delta >= 0 ? "▲" : "▼"} ${fmt(Math.abs(t.delta) * 100)}%` }) : null,
      spark(t.spark, t.good === false ? "bad" : "")))),
    h("section", { className: "dash-insights" }, ...m.insights.map((i) => h("div", {}, h("b", { textContent: i.big }), h("span", { textContent: i.text })))),
    h("section", { className: "dash-charts" },
      frame("Sleep vs evening agitation", "bars: sleep · line: agitation", barsLine(m.sleep, m.agit, { lineMax: 3 })),
      frame("Daily steps", "30 days", barsLine(m.steps, m.moodAvg, { barCls: "b3", lineCls: "l3" })),
      frame("Heart", "resting HR · HRV", twoLines(m.rhr, m.hrv)),
      frame("Mood calendar", "top: morning · bottom: evening", heat(m.M, m.keys)),
      frame("Agitation by weekday", "sundowning pattern", weekday(m.keys, m.agit)),
      frame("Repeated questions", "per day", barsLine(m.rep, [], { barCls: "b2" }))),
    h("section", { className: "dash-two" },
      h("div", { className: "dash-actions" }, h("h3", { textContent: "Action items" }),
        h("ol", {}, ...m.actions.map((a) => h("li", { className: `lv-${a.level}` }, h("span", { className: `who w-${a.who.toLowerCase()}`, textContent: a.who }), h("span", { textContent: a.text }))))),
      h("div", { className: "dash-reports" }, h("h3", { textContent: "Send a report" }),
        reportCard(m, "Caregiver", "🧡", "Today's plan and what to watch", who),
        reportCard(m, "Doctor", "🩺", "30-day clinical summary with scales", who),
        reportCard(m, "Family", "👪", "A short weekly update", who))),
    h("section", { className: "dash-why" }, ...[["Fewer surprises", "Sleep and activity flag hard evenings before they start."], ["Less repeating", "The band hears repeated questions; the plan goes on the whiteboard."], ["Earlier help", "Weekly CSDD and heart trends reach the doctor in one tap."], ["Shared care", "Caregiver, doctor and family see the same picture."]]
      .map(([b, t]) => h("div", {}, h("b", { textContent: b }), h("span", { textContent: t })))));
}
