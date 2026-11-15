"""Public demo feed: a claimed watch that presents DEMO_WATCH_KEY publishes sensors frames to everyone."""
import pytest
from fastapi.testclient import TestClient

from app import demo_feed, main, watch_claim

TOKEN = "test-only-access"
AUTH = {"X-App-Token": TOKEN}
DEMO = "demo-key-for-tests-only-0123456789"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("APP_ACCESS_TOKEN", TOKEN)
    monkeypatch.setenv("DEMO_WATCH_KEY", DEMO)
    monkeypatch.delenv("APP_TRUST_LOOPBACK", raising=False)
    monkeypatch.setattr(main, "SENSOR_MIN_INTERVAL", 0)
    monkeypatch.setattr(main, "pairings", {})
    monkeypatch.setattr(watch_claim, "start_log", {})
    monkeypatch.setattr(demo_feed, "subscribers", set())
    monkeypatch.setattr(demo_feed, "state", {"publisher": None, "last": None, "at": 0.0, "live": False,
                                             "device": None, "task": None})
    return TestClient(main.app)


def watch(client, claim=True):
    body = client.post("/api/watch/start", json={"device": "Demo Watch"}).json()
    if claim:
        assert client.post("/api/watch/claim", json={"code": body["code"]}, headers=AUTH).status_code == 200
    return {"X-Watch-Code": body["code"], "X-Watch-Key": body["watch_key"], "X-Watch-Device": "Demo Watch"}


def post(client, headers, frame=None, key=None):
    extra = {"X-Demo-Key": key} if key else {}
    return client.post("/api/watch/sensors", json=frame or {"type": "sensors", "heart_rate": 71},
                       headers={**headers, **extra})


def test_no_key_configured_reports_not_live(client, monkeypatch):
    monkeypatch.delenv("DEMO_WATCH_KEY")
    with client:
        headers = watch(client)
        assert post(client, headers, key=DEMO).status_code == 200
        assert client.get("/api/demo/latest").json() == {"live": False, "device": None, "last": None}
        with client.websocket_connect("/api/demo/feed") as feed:
            assert feed.receive_json() == {"type": "demo_status", "live": False, "device": None, "last": None}


def test_short_key_disables_demo(client, monkeypatch):
    monkeypatch.setenv("DEMO_WATCH_KEY", "short")
    with client:
        headers = watch(client)
        post(client, headers, key="short")
        assert client.get("/api/demo/latest").json()["live"] is False


def test_wrong_key_is_not_published(client):
    with client:
        headers = watch(client)
        assert post(client, headers, key="x" * len(DEMO)).status_code == 200
        assert post(client, headers).status_code == 200
        assert client.get("/api/demo/latest").json() == {"live": False, "device": None, "last": None}


def test_correct_key_publishes_to_subscribers(client):
    with client:
        headers = watch(client)
        with client.websocket_connect("/api/demo/feed") as feed:
            assert feed.receive_json()["live"] is False
            frame = {"type": "sensors", "heart_rate": 71, "secret": "dropped",
                     "state_of_mind": {"valence": 0.4, "labels": ["calm"], "kind": "momentary"}}
            assert post(client, headers, frame=frame, key=DEMO).json()["forwarded"] is True
            assert feed.receive_json() == {"type": "demo_status", "live": True, "device": "Demo Watch",
                                           "last": demo_feed.state["last"]}
            sensors = feed.receive_json()
            assert sensors["type"] == "sensors" and sensors["demo"] is True
            assert sensors["heart_rate"] == 71.0 and sensors["device"] == "Demo Watch"
            assert "secret" not in sensors


def test_ws_stream_demo_key(client):
    with client:
        headers = watch(client)
        with client.websocket_connect("/api/demo/feed") as feed:
            feed.receive_json()
            with client.websocket_connect("/api/watch/stream") as stream:
                stream.send_json({"code": headers["X-Watch-Code"], "watch_key": headers["X-Watch-Key"],
                                  "device": "WS Watch", "format": "sensors", "demo_key": DEMO})
                assert stream.receive_json()["type"] == "ready"
                stream.send_json({"type": "sensors", "steps": 1200})
                assert feed.receive_json()["live"] is True
                assert feed.receive_json()["steps"] == 1200
                stream.send_json({"type": "stop"})


def test_cycle_frames_never_reach_demo(client):
    with client:
        headers = watch(client)
        with client.websocket_connect("/api/demo/feed") as feed:
            feed.receive_json()
            post(client, headers, key=DEMO)
            cycle = client.post("/api/watch/cycle", json={"type": "cycle", "period_starts": ["2026-11-01"]},
                        headers={**headers, "X-Demo-Key": DEMO})
            assert cycle.status_code == 200
            post(client, headers, frame={"type": "sensors", "heart_rate": 90}, key=DEMO)
            seen = [feed.receive_json() for _ in range(3)]
            assert [m["type"] for m in seen] == ["demo_status", "sensors", "sensors"]
            assert [m["heart_rate"] for m in seen[1:]] == [71.0, 90.0]


def test_latest_returns_last_frame(client):
    with client:
        headers = watch(client)
        post(client, headers, key=DEMO)
        post(client, headers, frame={"type": "sensors", "heart_rate": 88}, key=DEMO)
        latest = client.get("/api/demo/latest").json()
        assert latest["live"] is True and latest["device"] == "Demo Watch"
        assert latest["last"]["heart_rate"] == 88.0 and latest["last"]["demo"] is True


def test_unclaimed_pairing_with_key_cannot_publish(client):
    with client:
        headers = watch(client, claim=False)
        assert post(client, headers, key=DEMO).status_code == 403
        assert client.get("/api/demo/latest").json()["last"] is None


def test_page_started_pairing_cannot_publish(client):
    with client:
        code = client.post("/api/watch/pair", headers=AUTH).json()["code"]
        assert post(client, {"X-Watch-Code": code}, key=DEMO).status_code == 200
        assert client.get("/api/demo/latest").json()["last"] is None


def test_latest_publisher_wins_and_toggle_off(client):
    with client:
        first, second = watch(client), watch(client)
        post(client, first, key=DEMO)
        post(client, second, frame={"type": "sensors", "heart_rate": 100}, key=DEMO)
        post(client, first, frame={"type": "sensors", "heart_rate": 60}, key=DEMO)
        assert client.get("/api/demo/latest").json()["last"]["heart_rate"] == 60.0
        post(client, first, frame={"type": "sensors", "heart_rate": 61})  # toggle off: no key
        post(client, second, frame={"type": "sensors", "heart_rate": 62})
        assert client.get("/api/demo/latest").json()["last"]["heart_rate"] == 60.0


def test_subscriber_cap(client, monkeypatch):
    monkeypatch.setattr(demo_feed, "MAX_SUBSCRIBERS", 1)
    with client:
        with client.websocket_connect("/api/demo/feed") as first:
            first.receive_json()
            with client.websocket_connect("/api/demo/feed") as second:
                message = second.receive()
                assert message["type"] == "websocket.close" and message["code"] == 1013
