import { ACCESS_MODES } from './modes.mjs';
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

export function buildModel({ health = {}, mood = { days: [], weeks: [] }, careHistory = [], transcripts = [], tasks = [], accessMode = "memory", synthetic = false, now = new Date() }) {
  const keys = [...Array(30)].map((_, i) => { const d = new Date(now); d.setDate(d.getDate() - (29 - i)); return dayKey(d); });
  const H = keys.map((k) => health[k] || {}), M = keys.map((k) => mood.days.find((d) => d.date === k) || {});
  const series = (f) => H.map((x) => x[f] ?? null);
  const last7 = (a) => a.slice(-7), prev = (a) => a.slice(0, -7);
  const tile = (label, arr, unit, digits = 0, better = "up", show = (v) => fmt(v, digits)) => {
    const now7 = avg(last7(arr)), base = avg(prev(arr)), delta = now7 != null && base ? Math.max(-0.99, Math.min(0.99, (now7 - base) / Math.max(Math.abs(base), label === "Mood" ? 1 : 1e-9))) : null;
    return { label, value: show(now7), unit, delta, good: delta == null ? null : (better === "up" ? delta >= 0 : delta <= 0), spark: arr };
  };
  const sleep = series("sleep_hours"), steps = series("steps"), rhr = series("resting_heart_rate"), hrv = series("hrv_sdnn"), spo2 = series("oxygen_saturation");
  const moodAvg = M.map((d) => d.morning != null && d.evening != null ? (d.morning + d.evening) / 2 : null), agit = M.map((d) => d.agitation ?? null), rep = M.map((d) => d.repeats ?? null);
  const csdd = mood.weeks.at(-1)?.score ?? null, csddPrev = mood.weeks.at(-2)?.score ?? null;
  const tiles = [
    tile("Sleep", sleep, "per night", 1, "up", hm), tile("Steps", steps, "per day", 0, "up"), tile("Resting HR", rhr, "bpm", 0, "down"),
    tile("HRV", hrv, "ms", 0, "up"), tile("Mood", moodAvg, "−1 … +1", 2, "up", (v) => (v > 0 ? "+" : "") + fmt(v, 2)),
    tile("Agitated evenings", agit.map((a) => a == null ? null : a >= 2 ? 1 : 0), "of logged evenings", 0, "down", () => last7(agit).some(a => a != null) ? `${last7(agit).filter(a => a >= 2).length} / ${last7(agit).filter(a => a != null).length}` : "—"),
    tile("Repeated questions", rep, "per day", 1, "down"),
    { label: "CSDD", value: csdd == null ? "—" : String(csdd), unit: "weekly · 0–38", delta: csdd != null && csddPrev ? (csdd - csddPrev) / csddPrev : null, good: csdd != null && csddPrev != null ? csdd <= csddPrev : null, spark: mood.weeks.map((w) => w.score) },
  ];
  // Describe supplied inputs; absence of measurements never becomes a health conclusion.
  const insights = [];
  const recorded = transcripts.filter(t => !t.sample && t.source !== "fictional").reduce((n, t) => n + (t.lines?.length || 0), 0);
  const fictional = transcripts.filter(t => t.sample || t.source === "fictional").reduce((n, t) => n + (t.lines?.length || 0), 0);
  if (recorded) insights.push({ big: String(recorded), text: "saved transcript lines · recorded or imported" });
  if (fictional) insights.push({ big: String(fictional), text: "example conversation lines" });
  const healthDays = H.filter(d => Object.values(d).some(v => typeof v === "number")).length;
  if (healthDays) insights.push({ big: String(healthDays), text: synthetic ? "days include example chart values" : "days with supplied Health measurements" });
  const latest = careHistory.at(-1);
  if (latest) insights.push({ big: String(careHistory.length), text: "Care assessments in this session · review their evidence" });
  const actions = tasks.filter(t => !t.done).map(t => ({ who: "Caregiver", level: "low", text: `${t.sample || t.source === "fictional" ? "Fictional task: " : "Saved task: "}${t.title}` }));
  if (latest?.next_step) actions.unshift({ who: "Caregiver", level: "low", text: `Latest agent suggestion: ${latest.next_step}` });
  const status = ["ok", "needs_attention", "urgent"].includes(latest?.status) ? latest.status : "unknown";

  return { accessMode, synthetic, keys, H, M, tiles, insights, actions, status, csdd, weeks: mood.weeks, sleep, steps, rhr, hrv, spo2, moodAvg, agit, rep };
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
export function reportText(m, audience, who = "this person") {
  const date = new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  const t = Object.fromEntries(m.tiles.map((x) => [x.label, x]));
  const arrow = (x) => x.delta == null ? "" : ` (${x.delta >= 0 ? "▲" : "▼"} ${fmt(Math.abs(x.delta) * 100)}% vs prior 3 weeks)`;
  const acts = m.actions.filter((a) => audience === "Doctor" ? a.who === "Doctor" : audience === "Family" ? a.who !== "Doctor" : true).map((a) => `• ${a.text}`);
  const modeName = ACCESS_MODES[m.accessMode]?.label || "Memory";
  const head = `${m.synthetic ? "INCLUDES EXAMPLE CHART VALUES — NOT DEVICE MEASUREMENTS\n" : ""}Threadline ${modeName} — ${audience === "Doctor" ? "30-day input summary" : audience === "Family" ? "weekly update" : "daily care report"} for ${who}\n${date}\n`;
  const core = [`Sleep ${t.Sleep.value}/night${arrow(t.Sleep)}`, `Steps ${t.Steps.value}/day${arrow(t.Steps)}`, `Mood ${t.Mood.value}${arrow(t.Mood)}`, `Agitated evenings ${t["Agitated evenings"].value} logged`, `Repeated questions ${t["Repeated questions"].value}/day`];
  const clinical = [`Resting HR ${t["Resting HR"].value} bpm${arrow(t["Resting HR"])}`, `HRV ${t.HRV.value} ms${arrow(t.HRV)}`, `SpO₂ ${fmt(avg(m.spo2.slice(-7)), 0)}%`, `Supplied weekly CSDD scores: ${m.weeks.map((w) => w.score).join(" → ") || "not provided"}`];
  const ins = m.insights.map((i) => `• ${i.big} ${i.text}`);
  return [head, "KEY NUMBERS (7-day average)", ...core.map((x) => `• ${x}`), ...(audience !== "Family" ? clinical.map((x) => `• ${x}`) : []), "", "WHAT WE NOTICED", ...ins, "", "ACTION ITEMS", ...acts, "",
    "Prepared in Threadline from the available inputs. Missing values are shown as —. Example conversations and chart values retain their source labels. No diagnosis or completed delivery is implied."].join("\n");
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
  const m = buildModel(input), who = input.who || "This person";
  const statusWord = { ok: "Last check: no concern flagged", needs_attention: "Last check: needs attention", urgent: "Last check: check in now", unknown: "Today at a glance" }[m.status];
  const has = (arr) => (arr || []).some((v) => v != null && Number.isFinite(v));
  const tilesShown = m.tiles.filter((t) => t.value && t.value !== "—" && !String(t.value).startsWith("—"));
  const today = m.H.at(-1) || {}, tm = m.M.at(-1) || {};
  root.replaceChildren(
    ...(input.synthetic ? [h("p", {className:"demo-chart-label",textContent:"Includes example chart history. Actual recordings retain their original source; example values are not device measurements."})] : []),
    h("p", {className:"caption",textContent:`${ACCESS_MODES[input.accessMode]?.label || "Memory"} mode · ${ACCESS_MODES[input.accessMode]?.description || ""}`}),
    h("section", { className: `dash-hero s-${m.status}` },
      h("div", {}, h("small", { textContent: new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }) }),
        h("h2", { textContent: `${who} · ${statusWord}` }),
        h("p", { textContent: [today.sleep_hours != null ? `${hm(today.sleep_hours)} sleep` : "", today.steps != null ? `${fmt(today.steps)} steps` : "", today.resting_heart_rate != null ? `resting HR ${fmt(today.resting_heart_rate)}` : "", today.hrv_sdnn != null ? `HRV ${fmt(today.hrv_sdnn)} ms` : "", tm.morningLabel ? `mood ${tm.morningLabel} → ${tm.eveningLabel}` : "", tm.agitation != null ? `evening agitation ${AGI[tm.agitation]}` : ""].filter(Boolean).join(" · ") })),
      m.csdd != null ? h("div", { className: "dash-hero-gauge" }, gauge(m.csdd), h("small", { textContent: "Weekly CSDD" })) : null),
    h("section", { className: "dash-tiles" }, ...tilesShown.map((t) => h("article", { className: "dash-tile" },
      h("small", { textContent: t.label }), h("b", { textContent: t.value }), h("span", { className: "unit", textContent: t.unit }),
      t.delta != null ? h("span", { className: `delta ${t.good ? "good" : "bad"}`, textContent: `${t.delta >= 0 ? "▲" : "▼"} ${fmt(Math.abs(t.delta) * 100)}%` }) : null,
      spark(t.spark, t.good === false ? "bad" : "")))),
    h("section", { className: "dash-insights" }, ...m.insights.map((i) => h("div", {}, h("b", { textContent: i.big }), h("span", { textContent: i.text })))),
    h("section", { className: "dash-charts" },
      has(m.sleep) ? frame("Sleep", input.synthetic ? "includes example values · 14 days" : "hours · 30 days", barsLine(m.sleep, [])) : null,
      has(m.steps) ? frame("Daily steps", "30 days", barsLine(m.steps, m.moodAvg, { barCls: "b3", lineCls: "l3" })) : null,
      has(m.rhr) || has(m.hrv) ? frame("Heart", "resting HR · HRV", twoLines(m.rhr, m.hrv)) : null,
      has(m.moodAvg) ? frame("Mood calendar", "top: morning · bottom: evening", heat(m.M, m.keys)) : null,
      has(m.H.map(d=>d.walking_steadiness ?? null)) ? frame("Walking steadiness", "percent · not a fall-risk score", barsLine(m.H.map(d=>d.walking_steadiness ?? null), [])) : null,
      has(m.H.map(d=>d.oxygen_saturation ?? null)) ? frame("Blood oxygen", "percent · 30 days", barsLine(m.H.map(d=>d.oxygen_saturation ?? null), [], { barCls: "b1" })) : null,
      has(m.H.map(d=>d.active_energy_kcal ?? null)) ? frame("Active energy", "kcal · 30 days", barsLine(m.H.map(d=>d.active_energy_kcal ?? null), [], { barCls: "b2" })) : null,
      has(m.rep) ? frame("Repeated questions", "per day", barsLine(m.rep, [], { barCls: "b2" })) : null),
    h("section", { className: "dash-two" },
      h("div", { className: "dash-actions" }, h("h3", { textContent: "Action items" }),
        h("ol", {}, ...(m.actions.length ? m.actions.map((a) => h("li", { className: `lv-${a.level}` }, h("span", { className: `who w-${a.who.toLowerCase()}`, textContent: a.who }), h("span", { textContent: a.text }))) : [h("li", { textContent: "No saved tasks or agent suggestions yet." })]))),
      h("div", { className: "dash-reports" }, h("h3", { textContent: "Prepare a report" }),
        reportCard(m, "Caregiver", "🧡", "Today's plan and what to watch", who),
        reportCard(m, "Doctor", "🩺", "Available measurements and supplied scores", who),
        reportCard(m, "Family", "👪", "A short weekly update", who))),
    h("section", { className: "dash-why" }, ...[["Available evidence", "Charts show supplied measurements. Blank values remain unknown."], ["Personal memory", "Saved conversations can help recover a stated plan."], ["Review first", "Agent suggestions and reports need your review."], ["Your choice", "Email and Text open your app. You choose whether to send."]]
      .map(([b, t]) => h("div", {}, h("b", { textContent: b }), h("span", { textContent: t })))));
}
