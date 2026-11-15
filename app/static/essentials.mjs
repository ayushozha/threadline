// Essentials: everyday supplies ordered with Stripe Checkout, approved by the caregiver.
// Prices and the catalogue come from the server; prescription medicines are never sold here.
const SUGGEST = [
  { id: "stoveoff", why: "Example: unattended-stove scenario · Memory" },
  { id: "stairtape", why: "Example: a night-stairs scenario · Sight" },
  { id: "nightlight", why: "Example: lighting for dim steps and hallways" },
  { id: "organiser", why: "Example: a pill-organiser question · Memory" },
  { id: "meals", why: "Example: ready-to-prepare meals for a busy day" },
  { id: "magnifier", why: "Example: reading small print · Sight" },
];
const money = (c) => `$${(c / 100).toFixed(2)}`;
export function mountEssentials(root, { el, request, contactName, onLog }) {
  let items = [], stripe = false, test = false; const cart = new Map();
  const params = new URLSearchParams(location.search);
  async function load() {
    try { const d = await (await fetch("/api/essentials/catalog")).json(); items = d.items; stripe = d.stripe; test = d.test_mode; } catch { items = []; }
    render();
  }
  const byId = (id) => items.find((x) => x.id === id);
  function add(id, n = 1) { const q = Math.max(0, Math.min(20, (cart.get(id) || 0) + n)); if (q) cart.set(id, q); else cart.delete(id); render(); }
  function render() {
    const total = [...cart].reduce((s, [id, q]) => s + (byId(id)?.cents || 0) * q, 0);
    const banner = params.get("paid") ? el("p", { className: "ess-banner ok", textContent: "Returned from checkout. Payment status is not verified here." })
      : params.get("cancelled") ? el("p", { className: "ess-banner", textContent: "Checkout was closed. Check Stripe or your receipt for payment status." }) : null;
    const sug = el("section", { className: "ess-sug" }, el("h3", { textContent: "Example ideas for everyday support" }),
      el("div", { className: "ess-sug-grid" }, ...SUGGEST.map((s) => { const it = byId(s.id); if (!it) return null;
        return el("article", { className: "ess-sug-card" }, el("span", { className: "ess-ic", textContent: it.icon }), el("div", {}, el("b", { textContent: it.name }), el("small", { textContent: s.why })),
          el("button", { type: "button", className: "dash-btn primary", textContent: cart.has(it.id) ? `In cart · ${cart.get(it.id)}` : `Add ${money(it.cents)}`, onclick: () => add(it.id) })); })));
    const cats = [...new Set(items.map((i) => i.cat))];
    const catalog = el("section", { className: "ess-cats" }, ...cats.map((c) => el("div", { className: "ess-cat" }, el("h3", { textContent: c }),
      el("div", { className: "ess-grid" }, ...items.filter((i) => i.cat === c).map((i) => el("article", { className: "ess-item" },
        el("span", { className: "ess-ic", textContent: i.icon }), el("b", { textContent: i.name }), el("span", { className: "ess-price", textContent: money(i.cents) }),
        el("div", { className: "ess-qty" }, el("button", { type: "button", textContent: "−", "aria-label": `Remove one ${i.name}`, onclick: () => add(i.id, -1) }),
          el("span", { textContent: String(cart.get(i.id) || 0) }), el("button", { type: "button", textContent: "+", "aria-label": `Add one ${i.name}`, onclick: () => add(i.id, 1) }))))))));
    const approver = el("input", { type: "text", maxLength: 60, value: contactName() || "", placeholder: "Caregiver name", "aria-label": "Approved by" });
    const ok = el("input", { type: "checkbox", id: "ess-ok" });
    const msg = el("p", { className: "caption", role: "status" });
    const pay = el("button", { type: "button", className: "primary-sm ess-pay", textContent: stripe ? `Pay ${money(total)} with Stripe` : "Pay with Stripe", disabled: !cart.size });
    pay.addEventListener("click", async () => {
      if (!ok.checked || !approver.value.trim()) { msg.textContent = "A caregiver needs to approve the order first."; return; }
      if (!stripe) { msg.textContent = "Checkout is not available on this server yet."; return; }
      pay.disabled = true; msg.textContent = "Opening Stripe Checkout…";
      try {
        const d = await request("/api/essentials/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: [...cart].map(([id, qty]) => ({ id, qty })), approved_by: approver.value.trim() }) });
        onLog?.(`Opened Stripe Checkout for a ${money(total)} cart approved by ${approver.value.trim()}; payment not yet verified`);
        location.href = d.url;
      } catch (e) { msg.textContent = e.message; pay.disabled = false; }
    });
    const cartBox = el("aside", { className: "ess-cart" }, el("h3", { textContent: "Order" }),
      cart.size ? el("ul", {}, ...[...cart].map(([id, q]) => el("li", {}, el("span", { textContent: `${byId(id).icon} ${byId(id).name} × ${q}` }), el("b", { textContent: money(byId(id).cents * q) })))) : el("p", { className: "caption", textContent: "Add items from the suggestions or the shelves." }),
      el("p", { className: "ess-total" }, el("span", { textContent: "Total" }), el("b", { textContent: money(total) })),
      el("label", { className: "ess-approve" }, el("span", { textContent: "Approved by" }), approver),
      el("label", { className: "check" }, ok, el("span", { textContent: "I'm the caregiver and I approve this order" })),
      pay, el("p", { className: "caption", textContent: `${stripe ? (test ? "Stripe test mode · no real charge" : "Stripe") : "Stripe checkout"} · card details are entered on Stripe's page, never in Threadline.` }), msg,
      el("div", { className: "ess-rx" }, el("b", { textContent: "Prescription medicines" }),
        el("p", { className: "caption", textContent: "Threadline does not sell prescription medicine. You can prepare a message to your pharmacy." }),
        el("a", { className: "dash-btn", href: `sms:?&body=${encodeURIComponent("Hello, please prepare a repeat prescription refill for my mother. Thank you.")}`, textContent: "Draft a refill request" })));
    root.replaceChildren(...[banner, el("div", { className: "ess-layout" }, el("div", {}, sug, catalog), cartBox)].filter(Boolean));
  }
  load();
  const total = () => [...cart].reduce((s, [id, q]) => s + (byId(id)?.cents || 0) * q, 0);
  return {
    add: (id, n = 1) => { if (!byId(id)) return null; add(id, n); return `${byId(id).name} × ${cart.get(id) || 0} in the cart`; },
    remove: (id) => { cart.delete(id); render(); return "Removed from the cart"; },
    summary: () => ({ items: [...cart].map(([id, q]) => ({ id, name: byId(id)?.name, qty: q })), total_usd: total() / 100, stripe_ready: stripe }),
    totalText: () => money(total()),
  };
}
