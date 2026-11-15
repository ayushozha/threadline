"""Essentials: order everyday supplies (groceries, over-the-counter health items, home safety) with Stripe Checkout.

The catalogue and prices live here on the server, so the page can only choose items and quantities. Prescription
medicines are never sold: the page offers a pharmacy refill request instead. Needs STRIPE_SECRET_KEY (use a test key
for demos); without it the catalogue still shows and checkout returns 503.
"""

import os
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

router = APIRouter()

CATALOG = [
    {"id": "milk", "cat": "Food & groceries", "name": "Milk, 2 litres", "icon": "🥛", "cents": 349},
    {"id": "bread", "cat": "Food & groceries", "name": "Wholemeal bread", "icon": "🍞", "cents": 299},
    {"id": "meals", "cat": "Food & groceries", "name": "Ready meals, 5 days (soft diet)", "icon": "🍲", "cents": 3499},
    {"id": "fruit", "cat": "Food & groceries", "name": "Fresh fruit box", "icon": "🍎", "cents": 1599},
    {"id": "tea", "cat": "Food & groceries", "name": "Tea bags, 80", "icon": "🍵", "cents": 449},
    {"id": "paracetamol", "cat": "Medicine & health (over the counter)", "name": "Paracetamol 500 mg, 32 tablets", "icon": "💊", "cents": 499},
    {"id": "organiser", "cat": "Medicine & health (over the counter)", "name": "Weekly pill organiser (AM/PM)", "icon": "🗓️", "cents": 1299},
    {"id": "bandages", "cat": "Medicine & health (over the counter)", "name": "First-aid kit", "icon": "🩹", "cents": 1999},
    {"id": "electrolytes", "cat": "Medicine & health (over the counter)", "name": "Oral rehydration sachets", "icon": "🧃", "cents": 799},
    {"id": "nightlight", "cat": "Home & safety", "name": "Motion night lights, 3-pack", "icon": "💡", "cents": 2499},
    {"id": "stairtape", "cat": "Home & safety", "name": "High-contrast stair edge tape", "icon": "🟨", "cents": 1499},
    {"id": "grabbar", "cat": "Home & safety", "name": "Suction grab bar", "icon": "🛁", "cents": 2999},
    {"id": "stoveoff", "cat": "Home & safety", "name": "Automatic stove shut-off", "icon": "🔥", "cents": 8999},
    {"id": "magnifier", "cat": "Home & safety", "name": "Lighted magnifier", "icon": "🔍", "cents": 1899},
]
BY_ID = {c["id"]: c for c in CATALOG}


def authorize(request: Request, x_app_token: str = Header(default="")) -> None:
    from app.main import authorize as main_authorize
    main_authorize(request, x_app_token)


class Line(BaseModel):
    id: str = Field(max_length=40)
    qty: int = Field(ge=1, le=20)


class CheckoutRequest(BaseModel):
    items: list[Line] = Field(min_length=1, max_length=30)
    approved_by: str = Field(min_length=1, max_length=60)


@router.get("/api/essentials/catalog")
def catalog():
    key = os.environ.get("STRIPE_SECRET_KEY", "")
    return {"items": CATALOG, "stripe": bool(key), "test_mode": key.startswith("sk_test_"), "currency": "usd"}


@router.post("/api/essentials/checkout", dependencies=[Depends(authorize)])
async def checkout(body: CheckoutRequest, request: Request):
    key = os.environ.get("STRIPE_SECRET_KEY", "")
    if not key:
        raise HTTPException(503, "Stripe isn't set up on this server yet (STRIPE_SECRET_KEY).")
    origin = os.environ.get("APP_PUBLIC_ORIGIN") or str(request.base_url).rstrip("/")
    form = {"mode": "payment", "success_url": f"{origin}/?paid=1#essentials", "cancel_url": f"{origin}/?cancelled=1#essentials",
            "metadata[approved_by]": body.approved_by[:60], "payment_method_types[0]": "card"}
    for i, line in enumerate(body.items):
        item = BY_ID.get(line.id)
        if not item:
            raise HTTPException(400, f"Unknown item {line.id!r}.")
        form |= {f"line_items[{i}][quantity]": str(line.qty), f"line_items[{i}][price_data][currency]": "usd",
                 f"line_items[{i}][price_data][unit_amount]": str(item["cents"]),
                 f"line_items[{i}][price_data][product_data][name]": item["name"]}
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post("https://api.stripe.com/v1/checkout/sessions", data=form, auth=(key, ""))
    if r.status_code >= 400:
        raise HTTPException(502, "Stripe could not start checkout.")
    data = r.json()
    return {"url": data.get("url"), "id": data.get("id"), "test_mode": key.startswith("sk_test_")}


# ---------- Voice orders: a card saved once by the caregiver, then purchases confirmed out loud ----------
VOICE_LIMIT_CENTS = int(float(os.environ.get("ESSENTIALS_VOICE_LIMIT_USD", "100")) * 100)
WALLET_SQL = "CREATE TABLE IF NOT EXISTS wallets (owner TEXT PRIMARY KEY, customer TEXT NOT NULL, pm TEXT NOT NULL, brand TEXT, last4 TEXT)"


def _db():
    from app import store
    s = store.get()
    if s is None:
        raise HTTPException(503, "Storage is not available on this server.")
    with s.lock:
        s.db.execute(WALLET_SQL)
    return s


def _owner(request: Request) -> str:
    from app.videos import owner_of
    return owner_of(request)


def _key() -> str:
    key = os.environ.get("STRIPE_SECRET_KEY", "")
    if not key:
        raise HTTPException(503, "Stripe isn't set up on this server yet (STRIPE_SECRET_KEY).")
    return key


async def _stripe(method: str, path: str, data: dict | None = None, *, idempotency_key: str | None = None) -> dict:
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.request(method, f"https://api.stripe.com/v1/{path}", data=data, auth=(_key(), ""),
                                 headers={"Idempotency-Key": idempotency_key} if idempotency_key else {})
    if r.status_code >= 400:
        msg = (r.json().get("error") or {}).get("message", "") if r.headers.get("content-type", "").startswith("application/json") else ""
        raise HTTPException(402 if r.status_code == 402 else 502, f"Stripe: {msg or 'request failed'}"[:200])
    return r.json()


@router.get("/api/essentials/wallet", dependencies=[Depends(authorize)])
def wallet(request: Request):
    s = _db()
    with s.lock:
        row = s.db.execute("SELECT brand, last4 FROM wallets WHERE owner = ?", (_owner(request),)).fetchone()
    return {"saved": bool(row), "brand": row[0] if row else None, "last4": row[1] if row else None,
            "limit_usd": VOICE_LIMIT_CENTS / 100, "stripe": bool(os.environ.get("STRIPE_SECRET_KEY"))}


@router.post("/api/essentials/setup", dependencies=[Depends(authorize)])
async def setup(request: Request):
    _key()
    origin = os.environ.get("APP_PUBLIC_ORIGIN") or str(request.base_url).rstrip("/")
    cus = await _stripe("POST", "customers", {"description": "Threadline essentials (caregiver)"})
    sess = await _stripe("POST", "checkout/sessions", {"mode": "setup", "customer": cus["id"], "currency": "usd",
                                                      "payment_method_types[0]": "card", "metadata[owner]": _owner(request),
                                                      "success_url": f"{origin}/?setup={{CHECKOUT_SESSION_ID}}#essentials",
                                                      "cancel_url": f"{origin}/#essentials"})
    return {"url": sess["url"]}


class SetupDone(BaseModel):
    session_id: str = Field(pattern=r"^cs_[A-Za-z0-9_]{6,200}$")


@router.post("/api/essentials/setup/complete", dependencies=[Depends(authorize)])
async def setup_complete(body: SetupDone, request: Request):
    sess = await _stripe("GET", f"checkout/sessions/{body.session_id}?expand[]=setup_intent")
    if (sess.get("metadata") or {}).get("owner") != _owner(request):
        raise HTTPException(403, "This card setup belongs to a different session.")
    si = sess.get("setup_intent") or {}
    if (sess.get("mode") != "setup" or sess.get("status") != "complete"
            or not isinstance(si, dict) or si.get("status") != "succeeded"):
        raise HTTPException(400, "Card setup has not completed.")
    pm_id, cus = si.get("payment_method"), sess.get("customer")
    if not pm_id or not cus or si.get("customer") != cus:
        raise HTTPException(400, "The card wasn't saved.")
    pm = await _stripe("GET", f"payment_methods/{pm_id}")
    if pm.get("customer") != cus or pm.get("type") != "card":
        raise HTTPException(400, "The payment method does not belong to this setup.")
    card = pm.get("card") or {}
    s = _db()
    with s.lock:
        s.db.execute("INSERT OR REPLACE INTO wallets (owner, customer, pm, brand, last4) VALUES (?, ?, ?, ?, ?)",
                     (_owner(request), cus, pm_id, card.get("brand"), card.get("last4")))
    return {"saved": True, "brand": card.get("brand"), "last4": card.get("last4")}


class BuyRequest(BaseModel):
    request_id: UUID
    items: list[Line] = Field(min_length=1, max_length=30)
    confirmed: bool
    approved_by: str = Field(min_length=1, max_length=60)


@router.post("/api/essentials/buy", dependencies=[Depends(authorize)])
async def buy(body: BuyRequest, request: Request):
    if not body.confirmed:
        raise HTTPException(400, "The order must be confirmed first.")
    total, names = 0, []
    for line in body.items:
        item = BY_ID.get(line.id)
        if not item:
            raise HTTPException(400, f"Unknown item {line.id!r}.")
        total += item["cents"] * line.qty
        names.append(f"{item['name']} x{line.qty}")
    if total > VOICE_LIMIT_CENTS:
        raise HTTPException(400, f"Voice orders are limited to ${VOICE_LIMIT_CENTS / 100:.0f}. Use checkout for bigger orders.")
    s = _db()
    with s.lock:
        row = s.db.execute("SELECT customer, pm, brand, last4 FROM wallets WHERE owner = ?", (_owner(request),)).fetchone()
    if not row:
        raise HTTPException(409, "No card saved for voice orders yet. Save one on Essentials first.")
    pi = await _stripe("POST", "payment_intents", {"amount": str(total), "currency": "usd", "customer": row[0], "payment_method": row[1],
                                                   "off_session": "true", "confirm": "true", "description": "; ".join(names)[:400],
                                                   "metadata[approved_by]": body.approved_by[:60], "metadata[channel]": "voice"},
                       idempotency_key=f"threadline:{_owner(request)}:{body.request_id}")
    return {"status": pi.get("status"), "id": pi.get("id"), "amount_usd": total / 100, "card": f"{row[2] or 'card'} •••• {row[3] or ''}".strip(),
            "test_mode": _key().startswith("sk_test_")}
