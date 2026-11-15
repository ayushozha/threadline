// Obsidian-style memory graph on a canvas: live force layout, drag nodes, wheel zoom, drag to pan,
// hover highlights neighbours, click focuses a node and expands its neighbourhood, search + type filters.

export const TYPE_STYLE = {
  self: { color: "#262921", label: "Person cared for" }, person: { color: "#d4663f", label: "People" }, place: { color: "#3f7d6e", label: "Places" },
  topic: { color: "#6d74c4", label: "Topics" }, feeling: { color: "#c9a13b", label: "Feelings" }, routine: { color: "#4f8fbf", label: "Routine" },
  health: { color: "#b44630", label: "Health" }, conversation: { color: "#8a8f7e", label: "Conversations" }, note: { color: "#a7a998", label: "Memories" },
  object: { color: "#9b6bb3", label: "Things" }, event: { color: "#5b9a7f", label: "Events" },
};
const styleOf = (t) => TYPE_STYLE[t] || { color: "#8a8a92", label: t };

export function mountMemoryGraph(root, { onSelect } = {}) {
  root.replaceChildren();
  root.classList.add("mg");
  const bar = document.createElement("div"); bar.className = "mg-bar";
  const search = Object.assign(document.createElement("input"), { type: "search", placeholder: "Search memories, people, places…", className: "mg-search" });
  search.setAttribute("aria-label", "Search the memory graph");
  const filters = document.createElement("div"); filters.className = "mg-filters";
  const tools = document.createElement("div"); tools.className = "mg-tools";
  const mkBtn = (txt, title, fn) => { const b = document.createElement("button"); b.type = "button"; b.className = "mg-btn"; b.textContent = txt; b.title = title; b.addEventListener("click", fn); tools.append(b); return b; };
  bar.append(search, filters, tools);
  const stage = document.createElement("div"); stage.className = "mg-stage";
  const canvas = document.createElement("canvas"); canvas.className = "mg-canvas";
  const tip = document.createElement("div"); tip.className = "mg-tip"; tip.hidden = true;
  const stats = document.createElement("div"); stats.className = "mg-stats";
  stage.append(canvas, tip, stats);
  root.append(bar, stage);
  const ctx = canvas.getContext("2d");

  let nodes = [], edges = [], byId = new Map(), adj = new Map();
  const view = { x: 0, y: 0, k: 1 }, hidden = new Set();
  let hover = null, focus = null, drag = null, pan = null, alpha = 1, query = "", W = 0, H = 0, dpr = 1, raf = 0, depth = 1;

  function resize() {
    const r = stage.getBoundingClientRect(); dpr = window.devicePixelRatio || 1; W = Math.max(300, r.width); H = Math.max(300, r.height);
    canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = `${W}px`; canvas.style.height = `${H}px`; kick(0.3);
  }
  new ResizeObserver(resize).observe(stage);

  function update(data) {
    const old = new Map(nodes.map((n) => [n.id, n]));
    nodes = data.nodes.map((n, i) => { const o = old.get(n.id); const a = (i / Math.max(1, data.nodes.length)) * Math.PI * 2;
      return { ...n, x: o?.x ?? Math.cos(a) * (120 + Math.random() * 160), y: o?.y ?? Math.sin(a) * (120 + Math.random() * 160), vx: 0, vy: 0, fx: o?.fx ?? null, fy: o?.fy ?? null }; });
    byId = new Map(nodes.map((n) => [n.id, n]));
    edges = data.edges.filter((e) => byId.has(e.source) && byId.has(e.target)).map((e) => ({ ...e, a: byId.get(e.source), b: byId.get(e.target) }));
    adj = new Map(nodes.map((n) => [n.id, new Set()]));
    for (const e of edges) { adj.get(e.a.id).add(e.b.id); adj.get(e.b.id).add(e.a.id); }
    for (const n of nodes) n.deg = adj.get(n.id).size;
    const types = [...new Set(nodes.map((n) => n.type))];
    filters.replaceChildren(...types.map((t) => { const b = document.createElement("button"); b.type = "button"; b.className = `mg-chip${hidden.has(t) ? " off" : ""}`;
      b.innerHTML = ""; const dot = document.createElement("i"); dot.style.background = styleOf(t).color; b.append(dot, `${styleOf(t).label} ${nodes.filter((n) => n.type === t).length}`);
      b.addEventListener("click", () => { hidden.has(t) ? hidden.delete(t) : hidden.add(t); b.classList.toggle("off"); kick(0.4); }); return b; }));
    stats.textContent = `${nodes.length} nodes · ${edges.length} links`;
    if (focus && !byId.has(focus.id)) focus = null;
    if (!old.size) fitted = false;
    kick(1);
  }
  const visible = (n) => !hidden.has(n.type);
  function neighbourhood(n, d) { const seen = new Set([n.id]); let front = [n.id]; for (let i = 0; i < d; i++) { const next = []; for (const id of front) for (const m of adj.get(id) || []) if (!seen.has(m)) { seen.add(m); next.push(m); } front = next; } return seen; }

  function tick() {
    const vis = nodes.filter(visible);
    for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) {
      const a = vis[i], b = vis[j]; let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy || 0.01; if (d2 > 160000) continue;
      const f = (900 * alpha) / d2; dx *= f; dy *= f; a.vx += dx; a.vy += dy; b.vx -= dx; b.vy -= dy;
    }
    for (const e of edges) { if (!visible(e.a) || !visible(e.b)) continue; const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, d = Math.hypot(dx, dy) || 1, len = e.a.type === "self" || e.b.type === "self" ? 120 : 70, f = ((d - len) / d) * 0.06 * alpha;
      e.a.vx += dx * f; e.a.vy += dy * f; e.b.vx -= dx * f; e.b.vy -= dy * f; }
    for (const n of vis) { n.vx -= n.x * 0.004 * alpha; n.vy -= n.y * 0.004 * alpha;
      if (n.fx != null) { n.x = n.fx; n.y = n.fy; n.vx = n.vy = 0; continue; } n.vx *= 0.82; n.vy *= 0.82; n.x += n.vx; n.y += n.vy; }
    alpha = Math.max(0.02, alpha * 0.985);
  }
  const radius = (n) => n.type === "self" ? 16 : 4 + Math.min(12, Math.sqrt(n.weight || 1) * 2 + n.deg * 0.6);
  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    ctx.translate(W / 2 + view.x, H / 2 + view.y); ctx.scale(view.k, view.k);
    const q = query.toLowerCase(), hit = q ? new Set(nodes.filter((n) => n.label.toLowerCase().includes(q)).map((n) => n.id)) : null;
    const lit = focus ? neighbourhood(focus, depth) : hover ? neighbourhood(hover, 1) : null;
    for (const e of edges) { if (!visible(e.a) || !visible(e.b)) continue; const on = lit ? lit.has(e.a.id) && lit.has(e.b.id) : true;
      ctx.strokeStyle = on && lit ? "rgba(180,70,48,.55)" : on ? "rgba(114,118,106,.28)" : "rgba(114,118,106,.06)"; ctx.lineWidth = (on && lit ? 1.6 : 1) / view.k;
      ctx.beginPath(); ctx.moveTo(e.a.x, e.a.y); ctx.lineTo(e.b.x, e.b.y); ctx.stroke(); }
    for (const n of nodes) { if (!visible(n)) continue; const r = radius(n), on = (!lit || lit.has(n.id)) && (!hit || hit.has(n.id));
      ctx.globalAlpha = on ? 1 : 0.14; ctx.fillStyle = styleOf(n.type).color; ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2); ctx.fill();
      if (n === focus || n === hover || hit?.has(n.id)) { ctx.lineWidth = 2.5 / view.k; ctx.strokeStyle = "#e8452c"; ctx.stroke(); }
      const showLabel = n.type === "self" || r > 8 || view.k > 1.4 || n === hover || (lit && lit.has(n.id)) || hit?.has(n.id);
      if (showLabel) { ctx.font = `${n.type === "self" ? 600 : 500} ${Math.max(10, 12 / Math.sqrt(view.k))}px ui-sans-serif, system-ui`; ctx.textAlign = "center"; ctx.fillStyle = "#262921";
        const t = n.label.length > 28 ? `${n.label.slice(0, 27)}…` : n.label; ctx.fillText(t, n.x, n.y + r + 13 / Math.sqrt(view.k)); }
    }
    ctx.globalAlpha = 1;
  }
  let fitted = false, userMoved = false;
  function loop() { if (alpha > 0.021 || drag) tick(); if (!fitted && !userMoved && alpha < 0.12 && nodes.length) { fitted = true; fit(); } draw(); raf = requestAnimationFrame(loop); }
  function kick(a) { alpha = Math.max(alpha, a); }
  const world = (ev) => { const r = canvas.getBoundingClientRect(); return { x: (ev.clientX - r.left - W / 2 - view.x) / view.k, y: (ev.clientY - r.top - H / 2 - view.y) / view.k }; };
  const pickAt = (p) => { let best = null, bd = Infinity; for (const n of nodes) { if (!visible(n)) continue; const d = Math.hypot(n.x - p.x, n.y - p.y); if (d < radius(n) + 6 / view.k && d < bd) { best = n; bd = d; } } return best; };

  canvas.addEventListener("pointerdown", (ev) => { canvas.setPointerCapture(ev.pointerId); const p = world(ev), n = pickAt(p);
    if (n) { drag = { n, moved: false }; n.fx = n.x; n.fy = n.y; kick(0.4); } else pan = { x: ev.clientX - view.x, y: ev.clientY - view.y, moved: false }; });
  canvas.addEventListener("pointermove", (ev) => { const p = world(ev);
    if (drag) { drag.moved = true; drag.n.fx = p.x; drag.n.fy = p.y; kick(0.3); return; }
    if (pan) { pan.moved = true; userMoved = true; view.x = ev.clientX - pan.x; view.y = ev.clientY - pan.y; return; }
    const n = pickAt(p); if (n !== hover) { hover = n; canvas.style.cursor = n ? "pointer" : "grab"; }
    if (n) { tip.hidden = false; tip.textContent = `${styleOf(n.type).label.replace(/s$/, "")} · ${n.label}${n.deg ? ` · ${n.deg} link${n.deg > 1 ? "s" : ""}` : ""}`; const r = stage.getBoundingClientRect(); tip.style.left = `${ev.clientX - r.left + 12}px`; tip.style.top = `${ev.clientY - r.top + 12}px`; } else tip.hidden = true; });
  canvas.addEventListener("pointerup", () => {
    if (drag) { const n = drag.n; if (!drag.moved) { n.fx = n.fy = null; select(n); } drag = null; }
    else if (pan) { if (!pan.moved) select(null); pan = null; } });
  canvas.addEventListener("dblclick", (ev) => { const n = pickAt(world(ev)); if (n) { n.fx = n.fy = null; kick(0.5); } });
  canvas.addEventListener("wheel", (ev) => { ev.preventDefault(); userMoved = true; const r = canvas.getBoundingClientRect(), mx = ev.clientX - r.left - W / 2, my = ev.clientY - r.top - H / 2;
    const k = Math.min(4, Math.max(0.25, view.k * Math.exp(-ev.deltaY * 0.0015))); view.x = mx - ((mx - view.x) * k) / view.k; view.y = my - ((my - view.y) * k) / view.k; view.k = k; }, { passive: false });
  search.addEventListener("input", () => { query = search.value.trim(); const m = query && nodes.find((n) => n.label.toLowerCase().includes(query.toLowerCase())); if (m) centreOn(m); });

  function centreOn(n) { const k = Math.max(view.k, 1.3); view.k = k; view.x = -n.x * k; view.y = -n.y * k; }
  function select(n) { focus = n; depth = 1; if (n) centreOn(n); onSelect?.(n, n ? [...adj.get(n.id)].map((id) => byId.get(id)) : [], expand); }
  function expand() { if (!focus) return; depth = Math.min(3, depth + 1); onSelect?.(focus, [...neighbourhood(focus, depth)].filter((id) => id !== focus.id).map((id) => byId.get(id)), expand, depth); }
  mkBtn("−", "Zoom out", () => { view.k = Math.max(0.25, view.k / 1.25); });
  mkBtn("+", "Zoom in", () => { view.k = Math.min(4, view.k * 1.25); });
  function fit() { const vis = nodes.filter(visible); if (!vis.length) return; const xs = vis.map((n) => n.x), ys = vis.map((n) => n.y);
    const w = Math.max(...xs) - Math.min(...xs) + 120, h = Math.max(...ys) - Math.min(...ys) + 120; view.k = Math.min(2, Math.max(0.25, Math.min(W / w, H / h))); view.x = -((Math.max(...xs) + Math.min(...xs)) / 2) * view.k; view.y = -((Math.max(...ys) + Math.min(...ys)) / 2) * view.k; }
  mkBtn("Fit", "Fit the whole graph", fit);
  mkBtn("Shake", "Re-run the layout", () => { for (const n of nodes) { n.fx = n.fy = null; n.vx += (Math.random() - 0.5) * 20; n.vy += (Math.random() - 0.5) * 20; } kick(1); });
  mkBtn("⤢", "Full screen", () => { root.classList.toggle("mg-full"); setTimeout(resize, 50); });
  resize(); loop();
  return { update, select: (id) => select(byId.get(id) || null), destroy: () => cancelAnimationFrame(raf) };
}
