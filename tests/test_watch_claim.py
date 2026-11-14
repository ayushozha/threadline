"""Device-code pairing: the watch starts a pairing, the website claims the code."""
import pytest
from fastapi.testclient import TestClient

from app import main, watch_claim

TOKEN = "test-only-access"
AUTH = {"X-App-Token": TOKEN}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("APP_ACCESS_TOKEN", TOKEN)
    monkeypatch.delenv("APP_TRUST_LOOPBACK", raising=False)
    monkeypatch.setattr(main, "SENSOR_MIN_INTERVAL", 0)
    monkeypatch.setattr(main, "pairings", {})
    monkeypatch.setattr(watch_claim, "start_log", {})
    return TestClient(main.app)


def start(client):
    response = client.post("/api/watch/start", json={"device": "Ayush's Apple Watch"})
    assert response.status_code == 200
    body = response.json()
    assert len(body["code"]) == 6 and body["code"].isdigit()
    assert len(body["watch_key"]) >= 32 and body["expires_in"] == 600
    return body["code"], body["watch_key"]


def status(client, code, key):
    return client.get("/api/watch/status", headers={"X-Watch-Code": code, "X-Watch-Key": key})


def test_full_device_code_flow(client):
    with client:
        code, key = start(client)
        assert status(client, code, key).json()["claimed"] is False
        claim = client.post("/api/watch/claim", json={"code": code}, headers=AUTH)
        assert claim.json() == {"ok": True, "device": "Ayush's Apple Watch"}
        state = status(client, code, key).json()
        assert state["claimed"] is True and state["expires_in"] > 3600
        with client.websocket_connect("/api/watch/feed") as feed:
            feed.send_json({"token": TOKEN, "code": code})
            assert feed.receive_json() == {"type": "waiting"}
            headers = {"X-Watch-Code": code, "X-Watch-Key": key, "X-Watch-Device": "Apple Watch"}
            response = client.post("/api/watch/sensors", json={"type": "sensors", "heart_rate": 72}, headers=headers)
            assert response.status_code == 200 and response.json()["forwarded"] is True
            assert feed.receive_json()["type"] == "watch_connected"
            assert feed.receive_json()["heart_rate"] == 72.0


def test_watch_ws_stream_needs_key(client):
    with client:
        code, key = start(client)
        client.post("/api/watch/claim", json={"code": code}, headers=AUTH)
        with client.websocket_connect("/api/watch/stream") as watch:
            watch.send_json({"code": code, "device": "Apple Watch", "format": "sensors"})
            assert watch.receive_json()["type"] == "error"
        with client.websocket_connect("/api/watch/stream") as watch:
            watch.send_json({"code": code, "watch_key": key, "device": "Apple Watch", "format": "sensors"})
            assert watch.receive_json() == {"type": "ready", "source": "sensors"}
            watch.send_json({"type": "stop"})


def test_sensors_rejected_without_key_or_before_claim(client):
    with client:
        code, key = start(client)
        frame = {"type": "sensors", "heart_rate": 72}
        before = client.post("/api/watch/sensors", json=frame, headers={"X-Watch-Code": code, "X-Watch-Key": key})
        assert before.status_code == 403 and before.json()["detail"].startswith("Not claimed yet")
        for path in ("/api/watch/cycle", "/api/watch/mood"):
            assert client.post(path, json={}, headers={"X-Watch-Code": code, "X-Watch-Key": key}).status_code == 403
        with client.websocket_connect("/api/watch/stream") as watch:
            watch.send_json({"code": code, "watch_key": key, "format": "sensors"})
            assert watch.receive_json()["message"].startswith("Not claimed yet")
        client.post("/api/watch/claim", json={"code": code}, headers=AUTH)
        assert client.post("/api/watch/sensors", json=frame, headers={"X-Watch-Code": code}).status_code == 401
        wrong = client.post("/api/watch/sensors", json=frame, headers={"X-Watch-Code": code, "X-Watch-Key": "x" * 43})
        assert wrong.status_code == 401


def test_feed_rejects_unclaimed_watch_code(client):
    code, _ = start(client)
    with client.websocket_connect("/api/watch/feed") as feed:
        feed.send_json({"token": TOKEN, "code": code})
        assert feed.receive_json()["type"] == "error"


def test_claim_unknown_or_page_code_404(client):
    missing = client.post("/api/watch/claim", json={"code": "000000"}, headers=AUTH)
    assert missing.status_code == 404
    assert missing.json()["detail"] == "No watch is showing that code. Open Threadline on the watch to get a new one."
    page_code = client.post("/api/watch/pair", headers=AUTH).json()["code"]
    assert client.post("/api/watch/claim", json={"code": page_code}, headers=AUTH).status_code == 404
    code, _ = start(client)
    assert client.post("/api/watch/claim", json={"code": code}, headers=AUTH).status_code == 200
    assert client.post("/api/watch/claim", json={"code": code}, headers=AUTH).status_code == 404  # only once


def test_claim_requires_auth(client):
    code, key = start(client)
    assert client.post("/api/watch/claim", json={"code": code}).status_code == 401
    assert client.post("/api/watch/claim", json={"code": code}, headers={"X-App-Token": "wrong"}).status_code == 401
    assert status(client, code, key).json()["claimed"] is False


def test_status_unknown_or_wrong_key_404(client):
    code, _ = start(client)
    assert status(client, code, "wrong").status_code == 404
    assert status(client, "999999", "x").status_code == 404


def test_start_rate_limited_per_ip(client, monkeypatch):
    monkeypatch.setattr(main, "MAX_PAIRINGS", 100)
    for _ in range(30):
        start(client)
    assert client.post("/api/watch/start", json={"device": "W"}).status_code == 429


def test_page_started_codes_unchanged(client):
    code = client.post("/api/watch/pair", headers=AUTH).json()["code"]
    response = client.post("/api/watch/sensors", json={"type": "sensors", "heart_rate": 70}, headers={"X-Watch-Code": code})
    assert response.status_code == 200
