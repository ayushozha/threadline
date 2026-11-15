// Your calendar: the person's real calendars through private iCal (ICS) links, no OAuth app.
// The server fetches and parses the feeds (/api/calendar/*); this card shows a 7-day agenda grouped by day.
const REFRESH_MS = 5 * 60 * 1000;
const HOW = [
  ["Google", "Settings → your calendar → Integrate calendar → copy “Secret address in iCal format”."],
  ["Apple / iCloud", "Calendar app → share the calendar → turn on Public Calendar → copy the link."],
  ["Outlook", "Settings → Calendar → Shared calendars → Publish a calendar → copy the ICS link."],
];
let api = null; // the page's request() once mounted; plain fetch otherwise
const userTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } };

async function call(url, options) {
  if (api) return api(url, options);
  const r = await fetch(url, options), d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof d.detail === "string" ? d.detail : `The request could not be completed (${r.status}).`);
  return d;
}

/** Upcoming events from every connected calendar: { events: [{title,start,end,all_day,location,description,calendar}], calendars }. */
export async function getEvents(days = 7, q = "") {
  const p = new URLSearchParams({ days: String(days), tz: userTz() });
  if (q) p.set("q", q);
  return call(`/api/calendar/events?${p}`);
}

const pad = (n) => String(n).padStart(2, "0");
export const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** Local calendar day of an event: all-day starts are already YYYY-MM-DD. */
export const eventDay = (ev) => (ev.all_day ? ev.start.slice(0, 10) : dayKey(new Date(ev.start)));

/** Groups events into [{ key, label, events }] in date order, labelling Today / Tomorrow. Multi-day all-day
    events are listed on each day they cover inside the agenda. */
export function groupByDay(events, now = new Date(), days = 7) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const keys = Array.from({ length: days }, (_, i) => dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() + i)));
  const map = new Map(keys.map((k) => [k, []]));
  for (const ev of events) {
    if (ev.all_day) {
      const last = ev.end && ev.end > ev.start ? ev.end.slice(0, 10) : null;
      for (const k of keys) if (k >= ev.start.slice(0, 10) && (last ? k < last : k === ev.start.slice(0, 10))) map.get(k).push(ev);
      continue;
    }
    const k = eventDay(ev);
    if (map.has(k)) map.get(k).push(ev);
    else if (k < keys[0] && new Date(ev.end) > now) map.get(keys[0]).push(ev); // started earlier, still on
  }
  return keys.map((key, i) => {
    const d = new Date(`${key}T12:00:00`);
    const label = i === 0 ? "Today" : i === 1 ? "Tomorrow" : d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
    return { key, label, events: map.get(key) };
  });
}

export function timeLabel(ev) {
  if (ev.all_day) return "All day";
  const f = (s) => new Date(s).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return ev.end && ev.end !== ev.start ? `${f(ev.start)} – ${f(ev.end)}` : f(ev.start);
}

export function mountCalendar(root, { el, request }) {
  if (request) api = request;
  let data = { events: [], calendars: [] }, loading = true, error = "", timer = null;
  const card = el("section", { className: "card cal-card", "aria-labelledby": "cal-h" });
  root.replaceChildren(card);

  async function load() {
    try { data = await getEvents(7); error = ""; } catch (e) { error = e.message; }
    loading = false; render();
  }

  function connectForm(compact) {
    const url = el("input", { type: "text", inputMode: "url", maxLength: 2000, placeholder: "https://… or webcal://… (.ics link)", "aria-label": "Calendar iCal link", autocomplete: "off", spellcheck: false });
    const name = el("input", { type: "text", maxLength: 60, placeholder: "Name (optional), e.g. Family", "aria-label": "Calendar name" });
    const msg = el("p", { className: "caption", role: "status" });
    const btn = el("button", { type: "submit", className: "primary-sm", textContent: "Connect" });
    const form = el("form", { className: "cal-form" }, url, name, btn, msg);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      if (!url.value.trim()) { msg.textContent = "Paste the calendar's iCal link first."; return; }
      btn.disabled = true; msg.textContent = "Checking the calendar…";
      try {
        const d = await call("/api/calendar/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: url.value.trim(), name: name.value.trim(), tz: userTz() }) });
        msg.textContent = `Connected “${d.name}” · ${d.events_next_7d} event${d.events_next_7d === 1 ? "" : "s"} in the next 7 days.`;
        await load();
      } catch (e) { msg.textContent = e.message; btn.disabled = false; }
    });
    if (!compact) return form;
    return el("details", { className: "cal-add" }, el("summary", { textContent: "Add another calendar" }), form);
  }

  function render() {
    const head = el("h2", { id: "cal-h", textContent: "Your calendar" });
    if (loading) { card.replaceChildren(head, el("p", { className: "caption", textContent: "Loading your calendar…" })); return; }
    const cals = data.calendars || [];
    if (!cals.length) {
      card.replaceChildren(head,
        el("p", { className: "caption", textContent: "Connect your own calendar with its private iCal link. No sign-in is shared; you can remove it any time." }),
        el("ul", { className: "cal-how" }, ...HOW.map(([who, how]) => el("li", {}, el("b", { textContent: `${who}: ` }), el("span", { textContent: how })))),
        connectForm(false),
        error ? el("p", { className: "caption", role: "alert", textContent: error }) : null);
      return;
    }
    const groups = groupByDay(data.events || []);
    const agenda = el("div", { className: "cal-agenda" }, ...groups.filter((g, i) => i < 2 || g.events.length).map((g) =>
      el("section", { className: "cal-day" }, el("h3", { textContent: g.label }),
        g.events.length ? el("ul", { className: "cal-events" }, ...g.events.map((ev) => el("li", {},
          el("span", { className: "cal-time", textContent: timeLabel(ev) }),
          el("span", { className: "cal-what" }, el("b", { textContent: ev.title }),
            ev.location ? el("small", { textContent: ev.location }) : null,
            cals.length > 1 ? el("small", { className: "cal-src", textContent: ev.calendar }) : null))))
          : el("p", { className: "caption", textContent: "Nothing scheduled." }))));
    const list = el("ul", { className: "cal-list" }, ...cals.map((c) => el("li", {},
      el("span", { textContent: c.name }), el("small", { className: "caption", textContent: c.error ? ` · ${c.error}` : ` · ${c.host}` }),
      el("button", { type: "button", className: "text-button", textContent: "Remove", "aria-label": `Remove calendar ${c.name}`, onclick: async (ev) => {
        ev.target.disabled = true;
        try { await call(`/api/calendar/${encodeURIComponent(c.id)}`, { method: "DELETE" }); await load(); } catch (e) { error = e.message; ev.target.disabled = false; render(); }
      } }))));
    card.replaceChildren(head, agenda,
      error ? el("p", { className: "caption", role: "alert", textContent: error }) : null,
      el("details", { className: "cal-manage" }, el("summary", { textContent: `Connected calendars (${cals.length})` }), list, cals.length < 5 ? connectForm(true) : null),
      el("button", { type: "button", className: "text-button", textContent: "Refresh", onclick: load }));
  }

  render(); load();
  timer = setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
  return { refresh: load, getEvents, stop: () => clearInterval(timer) };
}
