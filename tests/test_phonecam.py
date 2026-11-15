import asyncio
import base64
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi.testclient import TestClient

from app import main  # noqa: I001  (import main first: importing live_gemini first is a circular import)
from app import live_gemini, phonecam
from tests.test_live_gemini import FakeGemini, start

ORIGIN = "https://threadline.example"
TOKEN = "test-only-access"
OPERATOR = {"X-App-Token": TOKEN}
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 2048


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


@pytest.fixture
def env(monkeypatch):
    monkeypatch.setenv("APP_ACCESS_TOKEN", TOKEN)
    monkeypatch.setenv("APP_GUEST_SESSIONS", "1")
    monkeypatch.setenv("APP_PUBLIC_ORIGIN", ORIGIN)
    monkeypatch.delenv("APP_TRUST_LOOPBACK", raising=False)
    clock = Clock()
    monkeypatch.setattr(phonecam, "now", clock)
    phonecam.reset()
    main.guest_sessions.clear()
    main.guest_issue_ips.clear()
    for name in ("guest_issue_global", "guest_requests_global", "guest_requests_hour"):
        monkeypatch.setattr(main, name, main.GuestWindow())
    monkeypatch.setattr(main, "guest_active_streams", 0)
    yield clock
    phonecam.reset()
    main.guest_sessions.clear()
    main.guest_issue_ips.clear()


def client():
    return TestClient(main.app, base_url=ORIGIN)


def guest():
    c = client()
    assert c.post("/api/session", headers={"Origin": ORIGIN}).status_code == 200
    return c


def pair(c, headers=None):
    r = c.post("/api/phonecam/pair", headers={"Origin": ORIGIN, **(headers or {})})
    assert r.status_code == 200, r.text
    d = r.json()
    q = parse_qs(urlsplit(d["url"]).query)
    return d, q["c"][0], q["k"][0]


def post(c, code, key, body=JPEG, content_type="image/jpeg"):
    return c.post(f"/api/phonecam/frame?c={code}&k={key}", content=body, headers={"Content-Type": content_type})


def test_pair_requires_auth(env):
    assert client().post("/api/phonecam/pair").status_code == 401


def test_pair_returns_code_and_phone_url(env):
    d, code, key = pair(client(), OPERATOR)
    assert d["code"] == code and len(code) == 6 and code.isdigit()
    assert len(key) == 32 and int(key, 16) >= 0
    assert d["url"] == f"{ORIGIN}/static/phone.html?c={code}&k={key}"
    assert d["expires_in"] == phonecam.TTL
    # the same owner gets the same pairing back (several dashboard tabs show one code)
    assert pair(client(), OPERATOR)[1:] == (code, key)


def test_pairing_expires_after_two_hours(env):
    clock = env
    _, code, key = pair(client(), OPERATOR)
    clock.t += phonecam.TTL + 1
    assert post(client(), code, key).status_code == 404
    assert pair(client(), OPERATOR)[2] != key  # a fresh pairing (new secret) is issued


def test_frame_auth_wrong_secret_is_403_unknown_code_404(env):
    _, code, key = pair(client(), OPERATOR)
    c = client()
    assert post(c, code, "0" * 32).status_code == 403
    assert post(c, code, "").status_code == 403
    other = "000000" if code != "000000" else "111111"
    assert post(c, other, key).status_code == 404
    assert phonecam.pairings[code].frame is None
    assert post(c, code, key).status_code == 200


def test_frame_size_magic_and_type(env):
    _, code, key = pair(client(), OPERATOR)
    c = client()
    assert post(c, code, key, body=b"\x89PNG" + b"\x00" * 2048).status_code == 400
    assert post(c, code, key, body=b"\xff\xd8\xff").status_code == 400  # too small to be a picture
    assert post(c, code, key, content_type="image/png").status_code == 415
    assert post(c, code, key, body=b"\xff\xd8\xff" + b"\x00" * (400 * 1024)).status_code == 413
    assert phonecam.pairings[code].frame is None


def test_frame_rate_limit_four_per_second(env):
    clock = env
    _, code, key = pair(client(), OPERATOR)
    c = client()
    for _ in range(4):
        assert post(c, code, key).status_code == 200
    assert post(c, code, key).status_code == 429
    clock.t += 1.01
    assert post(c, code, key).status_code == 200


def test_latest_and_status_for_owner(env):
    clock = env
    _, code, key = pair(client(), OPERATOR)
    c = client()
    assert c.get(f"/api/phonecam/latest.jpg?c={code}", headers=OPERATOR).status_code == 404
    assert c.get(f"/api/phonecam/status?c={code}", headers=OPERATOR).json()["live"] is False
    assert post(c, code, key).status_code == 200
    r = c.get(f"/api/phonecam/latest.jpg?c={code}", headers=OPERATOR)
    assert r.status_code == 200 and r.content == JPEG
    assert r.headers["content-type"] == "image/jpeg" and r.headers["cache-control"] == "no-store"
    s = c.get(f"/api/phonecam/status?c={code}", headers=OPERATOR).json()
    assert s["live"] is True and s["fps"] == 0.2 and isinstance(s["at"], float)
    clock.t += phonecam.LIVE_SECONDS + 0.5
    s = c.get(f"/api/phonecam/status?c={code}", headers=OPERATOR).json()
    assert s["live"] is False and s["at"] is not None


def test_latest_and_status_need_auth(env):
    _, code, key = pair(client(), OPERATOR)
    post(client(), code, key)
    assert client().get(f"/api/phonecam/latest.jpg?c={code}").status_code == 401
    assert client().get(f"/api/phonecam/status?c={code}").status_code == 401


def test_owner_isolation(env):
    alice, bob = guest(), guest()
    _, code, key = pair(alice)
    assert post(client(), code, key).status_code == 200
    assert alice.get(f"/api/phonecam/latest.jpg?c={code}").status_code == 200
    assert bob.get(f"/api/phonecam/latest.jpg?c={code}").status_code == 404
    assert bob.get(f"/api/phonecam/status?c={code}").status_code == 404
    assert client().get(f"/api/phonecam/latest.jpg?c={code}", headers=OPERATOR).status_code == 404
    _, bob_code, _ = pair(bob)
    assert bob_code != code


def test_dashboard_polling_does_not_spend_guest_request_budget(env):
    alice = guest()
    _, code, key = pair(alice)
    post(client(), code, key)
    for _ in range(main.GUEST_REQUEST_LIMIT + 5):
        assert alice.get(f"/api/phonecam/latest.jpg?c={code}").status_code == 200


def gemini_env(monkeypatch):
    monkeypatch.setenv("GOOGLE_API_KEY", "secret-provider-key")
    monkeypatch.setenv("GEMINI_LIVE_MODEL", "test-live-model")
    monkeypatch.setattr(main, "stream_slots", asyncio.Semaphore(4))
    fake = FakeGemini()
    calls = []
    monkeypatch.setattr(live_gemini, "ws_connect", lambda *a, **k: calls.append(1) or fake)
    return fake, calls


def test_live_gemini_phone_forwards_owner_frame(env, monkeypatch):
    fake, _ = gemini_env(monkeypatch)
    c = client()
    _, code, key = pair(c, OPERATOR)
    assert post(c, code, key).status_code == 200
    with c.websocket_connect("/api/live-gemini") as ws:
        start(ws, vision="phone", code=code)
        assert ws.receive_json() == {"type": "vision", "live": True, "camera": phonecam.CAMERA}
        ws.send_json({"type": "stop"})
    videos = [m["realtimeInput"]["video"] for m in fake.sent if "video" in m.get("realtimeInput", {})]
    assert videos == [{"data": base64.b64encode(JPEG).decode(), "mimeType": "image/jpeg"}]


def test_live_gemini_phone_rejects_other_owner_before_contacting_provider(env, monkeypatch):
    _, calls = gemini_env(monkeypatch)
    alice = guest()
    _, code, key = pair(alice)
    post(client(), code, key)
    with client().websocket_connect("/api/live-gemini") as ws:  # operator: different owner
        ws.send_json({"token": TOKEN, "mode": "memory", "vision": "phone", "code": code})
        msg = ws.receive_json()
        assert msg["type"] == "error" and "iPhone" in msg["message"]
    with client().websocket_connect("/api/live-gemini") as ws:
        ws.send_json({"token": TOKEN, "mode": "memory", "vision": "phone", "code": "nope"})
        assert ws.receive_json()["type"] == "error"
    assert calls == []
