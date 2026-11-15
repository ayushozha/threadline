import asyncio
import base64

import pytest
from fastapi.testclient import TestClient

from app import live_gemini, main, vision_bridge
from tests.test_live_gemini import FakeGemini, start

KEY = "demo-key-for-tests-0123456789"
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 2048


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


@pytest.fixture
def bridge(monkeypatch):
    monkeypatch.setenv("DEMO_WATCH_KEY", KEY)
    clock = Clock()
    monkeypatch.setattr(vision_bridge, "now", clock)
    vision_bridge.reset()
    yield TestClient(main.app), clock
    vision_bridge.reset()


def post(client, body=JPEG, key=KEY, content_type="image/jpeg", **headers):
    if key is not None:
        headers["X-Publish-Key"] = key
    return client.post("/api/vision/frame", content=body, headers={"Content-Type": content_type, **headers})


def test_key_not_configured_is_503(bridge, monkeypatch):
    client, _ = bridge
    monkeypatch.delenv("DEMO_WATCH_KEY")
    assert post(client).status_code == 503


def test_wrong_or_missing_key_is_401(bridge):
    client, _ = bridge
    assert post(client, key="wrong").status_code == 401
    assert post(client, key=None).status_code == 401
    assert vision_bridge.latest["frame"] is None


def test_size_magic_and_type_validation(bridge):
    client, _ = bridge
    assert post(client, body=b"\xff\xd8" + b"\x00" * 100).status_code == 400  # under 1 KB
    assert post(client, body=b"\x89PNG" + b"\x00" * 2048).status_code == 400  # not a JPEG
    assert post(client, body=b"\xff\xd8" + b"\x00" * (400 * 1024)).status_code == 413
    assert post(client, content_type="application/octet-stream").status_code == 415
    assert vision_bridge.latest["frame"] is None
    assert post(client).status_code == 200


def test_rate_limit_three_per_second(bridge):
    client, clock = bridge
    for _ in range(3):
        assert post(client).status_code == 200
    assert post(client).status_code == 429
    clock.t += 1.01
    assert post(client).status_code == 200


def test_latest_jpg_and_status_freshness(bridge):
    client, clock = bridge
    assert client.get("/api/vision/latest.jpg").status_code == 404
    assert client.get("/api/vision/status").json() == {"live": False, "camera": None, "age_s": None}
    assert post(client, **{"X-Camera": "Hero 12 " + "x" * 80}).status_code == 200
    res = client.get("/api/vision/latest.jpg")
    assert res.status_code == 200 and res.content == JPEG
    assert res.headers["content-type"] == "image/jpeg" and res.headers["cache-control"] == "no-store"
    clock.t += 4
    status = client.get("/api/vision/status").json()
    assert status["live"] and status["camera"] == ("Hero 12 " + "x" * 80)[:60] and status["age_s"] == 4
    clock.t += 6.5
    assert client.get("/api/vision/latest.jpg").status_code == 404
    assert client.get("/api/vision/status").json()["live"] is False


def test_default_camera_name(bridge):
    client, _ = bridge
    post(client)
    assert client.get("/api/vision/status").json()["camera"] == "GoPro"


def test_live_gemini_bridge_forwards_stored_frame(bridge, monkeypatch):
    client, _ = bridge
    monkeypatch.setenv("APP_ACCESS_TOKEN", "test-only-access")
    monkeypatch.setenv("GOOGLE_API_KEY", "secret-provider-key")
    monkeypatch.setenv("GEMINI_LIVE_MODEL", "test-live-model")
    monkeypatch.setattr(main, "stream_slots", asyncio.Semaphore(4))
    fake = FakeGemini()
    monkeypatch.setattr(live_gemini, "ws_connect", lambda *a, **k: fake)
    assert post(client, **{"X-Camera": "GoPro Hero"}).status_code == 200
    with client.websocket_connect("/api/live-gemini") as ws:
        start(ws, vision="bridge")
        assert ws.receive_json() == {"type": "vision", "live": True, "camera": "GoPro Hero"}
        ws.send_json({"type": "stop"})
    videos = [m["realtimeInput"]["video"] for m in fake.sent if "video" in m.get("realtimeInput", {})]
    assert videos == [{"data": base64.b64encode(JPEG).decode(), "mimeType": "image/jpeg"}]


def test_live_gemini_without_bridge_ignores_stored_frame(bridge, monkeypatch):
    client, _ = bridge
    monkeypatch.setenv("APP_ACCESS_TOKEN", "test-only-access")
    monkeypatch.setenv("GOOGLE_API_KEY", "secret-provider-key")
    monkeypatch.setenv("GEMINI_LIVE_MODEL", "test-live-model")
    monkeypatch.setattr(main, "stream_slots", asyncio.Semaphore(4))
    fake = FakeGemini()
    monkeypatch.setattr(live_gemini, "ws_connect", lambda *a, **k: fake)
    post(client)
    with client.websocket_connect("/api/live-gemini") as ws:
        start(ws)
        ws.send_json({"type": "stop"})
    assert not any("video" in m.get("realtimeInput", {}) for m in fake.sent)
