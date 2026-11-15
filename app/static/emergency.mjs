// Emergency flow: when the care agent reports "urgent" (fall, SOS triple-tap, spoken call for help), show a full-screen
// alert with a short countdown, then open a call to the emergency contact; emergency services are one tap away.
// A web page cannot place a call by itself: on a phone, tel: links open the dialer with the number ready.
const KEY = "threadline.emergency.v1";
export function loadContacts() {
  try { return { name: "", phone: "", services: "911", lang: "", ...(JSON.parse(localStorage.getItem(KEY) || "{}") || {}) }; } catch { return { name: "", phone: "", services: "911", lang: "" }; }
}
export function saveContacts(c) { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* storage off */ } }
const clean = (p) => String(p || "").replace(/[^\d+]/g, "");

export function mountEmergency({ el, onLog }) {
  const box = el("div", { className: "sos", hidden: true, role: "alertdialog", "aria-label": "Emergency" });
  document.body.append(box);
  let timer = 0;
  function close(msg) { clearInterval(timer); box.hidden = true; if (msg) onLog?.(msg); }
  function trigger({ reason = "Emergency detected", note = "" } = {}) {
    if (!box.hidden) return;
    const c = loadContacts(), contact = clean(c.phone), services = clean(c.services) || "911";
    let left = 10;
    const count = el("b", { className: "sos-count", textContent: String(left) });
    const callContact = el("a", { className: "sos-btn primary", href: contact ? `tel:${contact}` : "#care", textContent: contact ? `Call ${c.name || "emergency contact"} now` : "Add an emergency contact on Care" });
    const textContact = contact ? el("a", { className: "sos-btn", href: `sms:${contact}?&body=${encodeURIComponent(`Threadline alert: ${reason}. ${note}`.slice(0, 300))}`, textContent: `Text ${c.name || "contact"}` }) : null;
    const callServices = el("a", { className: "sos-btn danger", href: `tel:${services}`, textContent: `Call emergency services (${services})` });
    const ok = el("button", { type: "button", className: "sos-btn ghost", textContent: "I'm OK — cancel" });
    ok.addEventListener("click", () => close("Emergency alert cancelled: the person said they are OK"));
    const steps = el("ol", { className: "sos-steps" },
      el("li", { className: "done", textContent: "Emergency detected by the caregiver agent" }),
      el("li", { className: "now", textContent: contact ? `Calling ${c.name || "emergency contact"} (${c.phone}) when the countdown ends` : "No emergency contact saved yet" }),
      el("li", { textContent: `Emergency services ${services} ready one tap away` }));
    box.replaceChildren(el("div", { className: "sos-card" },
      el("p", { className: "sos-eyebrow", textContent: "Threadline · emergency" }), el("h2", { textContent: reason }),
      note ? el("p", { className: "sos-note", textContent: note }) : null,
      el("div", { className: "sos-ring" }, count, el("small", { textContent: "seconds" })), steps,
      el("div", { className: "sos-actions" }, callContact, textContact, callServices, ok)));
    box.hidden = false; onLog?.(`Emergency alert: ${reason}`);
    timer = setInterval(() => {
      left -= 1; count.textContent = String(Math.max(0, left));
      if (left <= 0) {
        clearInterval(timer);
        steps.children[1].className = "done"; steps.children[1].textContent = contact ? `Calling ${c.name || "emergency contact"}…` : "No contact to call — call emergency services";
        steps.children[2].className = "now";
        onLog?.(contact ? `Opened a call to ${c.name || "the emergency contact"}` : "No emergency contact saved");
        if (contact) location.href = `tel:${contact}`;
      }
    }, 1000);
  }
  return { trigger, close };
}
