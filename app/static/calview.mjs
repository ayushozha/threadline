// Month calendar for Tasks: the person's tasks plus their connected calendar events on one grid.
// Click a day to see everything on it and add a task for that date.
const pad = (n) => String(n).padStart(2, "0");
const dkey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function mountCalendarView(root, { el, request, getTasks, addTask, toggleDone }) {
  const state = { month: new Date(new Date().getFullYear(), new Date().getMonth(), 1), selected: dkey(new Date()), events: [], loaded: false };
  async function loadEvents() {
    try {
      const tz = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone);
      const d = await request(`/api/calendar/events?days=45&tz=${tz}`);
      state.events = d.events || [];
    } catch { state.events = []; }
    state.loaded = true; render();
  }
  const eventDay = (e) => (e.all_day ? e.start : dkey(new Date(e.start)));
  function itemsFor(key) {
    const tasks = getTasks().filter((t) => (t.due || "") === key).map((t) => ({ kind: t.done ? "done" : "task", time: t.time || "", title: t.title, task: t }));
    const evs = state.events.filter((e) => eventDay(e) === key).map((e) => ({ kind: "event", time: e.all_day ? "" : new Date(e.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }), title: e.title, where: e.location }));
    return [...evs, ...tasks].sort((a, b) => (a.time || "99").localeCompare(b.time || "99"));
  }
  function render() {
    const m = state.month, first = new Date(m), start = new Date(m); start.setDate(1 - ((first.getDay() + 6) % 7));
    const today = dkey(new Date());
    const cells = [...Array(42)].map((_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
    const head = el("div", { className: "cv-head" },
      el("button", { type: "button", className: "cv-nav", textContent: "‹", "aria-label": "Previous month", onclick: () => { state.month = new Date(m.getFullYear(), m.getMonth() - 1, 1); render(); } }),
      el("h3", { textContent: m.toLocaleDateString([], { month: "long", year: "numeric" }) }),
      el("button", { type: "button", className: "cv-nav", textContent: "›", "aria-label": "Next month", onclick: () => { state.month = new Date(m.getFullYear(), m.getMonth() + 1, 1); render(); } }),
      el("button", { type: "button", className: "cv-today", textContent: "Today", onclick: () => { state.month = new Date(new Date().getFullYear(), new Date().getMonth(), 1); state.selected = today; render(); } }),
      el("span", { className: "cv-legend" }, el("i", { className: "k-task" }), "task ", el("i", { className: "k-done" }), "done ", el("i", { className: "k-event" }), "calendar"));
    const dow = el("div", { className: "cv-dow" }, ...["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((x) => el("span", { textContent: x })));
    const grid = el("div", { className: "cv-grid" }, ...cells.map((d) => {
      const key = dkey(d), items = itemsFor(key), out = d.getMonth() !== m.getMonth();
      return el("button", { type: "button", className: `cv-day${out ? " out" : ""}${key === today ? " today" : ""}${key === state.selected ? " sel" : ""}${key < today ? " past" : ""}`, onclick: () => { state.selected = key; render(); }, "aria-label": `${d.toDateString()}: ${items.length} items` },
        el("span", { className: "cv-num", textContent: String(d.getDate()) }),
        el("div", { className: "cv-items" }, ...items.slice(0, 3).map((x) => el("span", { className: `cv-chip k-${x.kind}`, textContent: `${x.time ? `${x.time} ` : ""}${x.title}` })),
          items.length > 3 ? el("span", { className: "cv-more", textContent: `+${items.length - 3} more` }) : null));
    }));
    const sel = state.selected, selItems = itemsFor(sel), selDate = new Date(`${sel}T12:00`);
    const title = el("input", { type: "text", placeholder: "Add a task for this day", maxLength: 120, "aria-label": "Task title" });
    const time = el("input", { type: "time", "aria-label": "Time" });
    const form = el("form", { className: "cv-add" }, title, time, el("button", { type: "submit", className: "dash-btn primary", textContent: "Add" }));
    form.addEventListener("submit", (e) => { e.preventDefault(); if (!title.value.trim()) return; addTask({ title: title.value.trim(), due: sel, time: time.value || "" }); render(); });
    const side = el("aside", { className: "cv-side" },
      el("h4", { textContent: selDate.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }) }),
      selItems.length ? el("ol", {}, ...selItems.map((x) => {
        const li = el("li", { className: `k-${x.kind}` }, el("time", { textContent: x.time || (x.kind === "event" ? "all day" : "any time") }), el("span", { textContent: x.title }), x.where ? el("small", { textContent: x.where }) : null);
        if (x.task) { const b = el("button", { type: "button", className: "text-button", textContent: x.task.done ? "Undo" : "Done" }); b.addEventListener("click", () => { toggleDone(x.task); render(); }); li.append(b); }
        return li;
      })) : el("p", { className: "caption", textContent: state.loaded ? "Nothing on this day." : "Loading…" }),
      form);
    root.replaceChildren(el("div", { className: "cv" }, el("div", { className: "cv-main" }, head, dow, grid), side));
  }
  render(); loadEvents();
  return { refresh: () => render(), reload: loadEvents };
}
