"""Essentials: order everyday supplies (groceries, over-the-counter health items, home safety) with Stripe Checkout.

The catalogue and prices live here on the server, so the page can only choose items and quantities. Prescription
medicines are never sold: the page offers a pharmacy refill request instead. Needs STRIPE_SECRET_KEY (use a test key
for demos); without it the catalogue still shows and checkout returns 503.
"""

import os

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
