import httpx
import pytest
from fastapi.testclient import TestClient

from app import main  # noqa: I001
from app import essentials

TOKEN = "t" * 32
H = {"x-app-token": TOKEN}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("APP_ACCESS_TOKEN", TOKEN)
    monkeypatch.delenv("APP_TRUST_LOOPBACK", raising=False)
    return TestClient(main.app)


def test_catalog_lists_items_and_never_prescriptions(client, monkeypatch):
    monkeypatch.delenv("STRIPE_SECRET_KEY", raising=False)
    d = client.get("/api/essentials/catalog").json()
    assert d["stripe"] is False and len(d["items"]) >= 10
    assert all("prescription" not in i["name"].lower() for i in d["items"])


def test_checkout_needs_key_approval_and_known_items(client, monkeypatch):
    monkeypatch.delenv("STRIPE_SECRET_KEY", raising=False)
    body = {"items": [{"id": "milk", "qty": 1}], "approved_by": "Asha"}
    assert client.post("/api/essentials/checkout", json=body, headers=H).status_code == 503
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_x")
    assert client.post("/api/essentials/checkout", json={**body, "approved_by": ""}, headers=H).status_code == 422
    assert client.post("/api/essentials/checkout", json={"items": [{"id": "nope", "qty": 1}], "approved_by": "A"}, headers=H).status_code == 400


def test_checkout_sends_server_prices_to_stripe(client, monkeypatch):
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_x")
    seen = {}

    def handler(req: httpx.Request):
        seen["body"] = req.content.decode()
        return httpx.Response(200, json={"id": "cs_test_1", "url": "https://checkout.stripe.com/c/pay/cs_test_1"})
    real = httpx.AsyncClient
    monkeypatch.setattr(essentials.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    r = client.post("/api/essentials/checkout", json={"items": [{"id": "organiser", "qty": 2}], "approved_by": "Asha"}, headers=H)
    assert r.status_code == 200 and r.json()["url"].startswith("https://checkout.stripe.com/")
    assert "unit_amount%5D=1299" in seen["body"] and "quantity%5D=2" in seen["body"]


def test_voice_buy_needs_confirmation_saved_card_and_limit(client, monkeypatch, tmp_path):
    from app import store
    monkeypatch.setenv("THREADLINE_DB_PATH", str(tmp_path / "t.db")); store.reset()
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_x")
    calls = []

    def handler(req: httpx.Request):
        calls.append(str(req.url))
        return httpx.Response(200, json={"id": "pi_1", "status": "succeeded"})
    real = httpx.AsyncClient
    monkeypatch.setattr(essentials.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    body = {"items": [{"id": "milk", "qty": 1}], "confirmed": False, "approved_by": "Asha"}
    assert client.post("/api/essentials/buy", json=body, headers=H).status_code == 400
    body["confirmed"] = True
    assert client.post("/api/essentials/buy", json=body, headers=H).status_code == 409  # no saved card
    s = essentials._db()
    with s.lock:
        s.db.execute("INSERT INTO wallets VALUES ('operator','cus_1','pm_1','visa','4242')")
    r = client.post("/api/essentials/buy", json=body, headers=H)
    assert r.status_code == 200 and r.json()["status"] == "succeeded" and "payment_intents" in calls[-1]
    assert client.post("/api/essentials/buy", json={**body, "items": [{"id": "stoveoff", "qty": 2}]}, headers=H).status_code == 400  # over limit
    store.reset()
