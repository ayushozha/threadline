"""Demo storage: only the demo owner's live transcript (publish_key) and the demo watch's readings are stored."""
import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from app import main  # noqa: I001  (main first: demo_feed imports it)
from app import demo_feed, store, watch_claim

TOKEN = "test-only-access"
DEMO = "demo-key-for-tests-only-0123456789"


@pytest.fixture
def db_path(tmp_path, monkeypatch):
    path = tmp_path / "data" / "threadline.db"
    monkeypatch.setenv("THREADLINE_DB_PATH", str(path))
    store.reset()
    yield path
    store.reset()


@pytest.fixture
def client(db_path, monkeypatch):
    monkeypatch.setenv("APP_ACCESS_TOKEN", TOKEN)
    monkeypatch.setenv("DEMO_WATCH_KEY", DEMO)
    monkeypatch.setenv("DEEPGRAM_API_KEY", "test-only-key")
    monkeypatch.setenv("DEEPGRAM_MODEL", "test-model")
    monkeypatch.delenv("APP_TRUST_LOOPBACK", raising=False)
    monkeypatch.setattr(main, "LIVE_FINALIZE_SECONDS", 0)
    monkeypatch.setattr(main, "SENSOR_MIN_INTERVAL", 0)
    monkeypatch.setattr(main, "pairings", {})
    monkeypatch.setattr(watch_claim, "start_log", {})
    monkeypatch.setattr(demo_feed, "subscribers", set())
    monkeypatch.setattr(demo_feed, "recording", set())
    monkeypatch.setattr(demo_feed, "state", {"publisher": None, "last": None, "at": 0.0, "live": False,
                                             "device": None, "task": None})
    monkeypatch.setattr(main, "ws_connect", lambda *a, **k: FakeDeepgram())
    return TestClient(main.app)


def result(text, final, speaker=None):
    words = [{"word": w, "speaker": speaker} for w in text.split()] if speaker is not None else []
    return json.dumps({"type": "Results", "is_final": final, "start": 0, "duration": 1,
                       "channel": {"alternatives": [{"transcript": text, "words": words}]}})


class FakeDeepgram:
    """Answers the first audio frame with an interim, a final and an empty final; CloseStream ends it."""
    def __init__(self):
        self.queue = asyncio.Queue()
        self.answered = False
    async def __aenter__(self):
        return self
    async def __aexit__(self, *exc):
        return False
    async def send(self, data):
        if isinstance(data, bytes) and not self.answered:
            self.answered = True
            for item in (result("hello", False, 1), result("hello band", True, 1), result("", True)):
                await self.queue.put(item)
        elif isinstance(data, str) and "CloseStream" in data:
            await self.queue.put(None)
    async def close(self):
        await self.queue.put(None)
    def __aiter__(self):
        return self
    async def __anext__(self):
        item = await self.queue.get()
        if item is None:
            raise StopAsyncIteration
        return item


def record(client, **extra):
    with client.websocket_connect("/api/live-transcribe") as ws:
        ws.send_json({"token": TOKEN, "source": "vexo", **extra})
        assert ws.receive_json()["type"] == "ready"
        ws.send_bytes(b"\x01\x02")
        got = [ws.receive_json() for _ in range(3)]
        assert [m["transcript"] for m in got] == ["hello", "hello band", ""]
        ws.send_text("stop")
        assert ws.receive_json()["type"] == "closed"


def test_store_roundtrip_and_prune(db_path, monkeypatch):
    monkeypatch.setattr(store, "MAX_LINES", 3)
    monkeypatch.setattr(store, "MAX_READINGS", 2)
    db = store.get()
    assert db is not None and db_path.exists()
    assert db.db.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    for i in range(5):
        db.add_line("s1", i % 2, f"line {i}", "vexo")
        db.add_reading("Watch", {"type": "sensors", "heart_rate": 60 + i})
    lines = db.lines(10)
    assert [l["text"] for l in lines] == ["line 2", "line 3", "line 4"]
    assert lines[-1]["speaker"] == 0 and lines[-1]["at"].endswith("Z")
    assert db.lines(1)[0]["text"] == "line 4"
    assert [r["frame"]["heart_rate"] for r in db.readings(10)] == [63, 64]
    assert db.readings(10)[0]["device"] == "Watch"


def test_publisher_with_key_stores_and_broadcasts_finals(client):
    with client:
        with client.websocket_connect("/api/demo/feed") as feed:
            assert feed.receive_json()["type"] == "demo_status"
            record(client, publish_key=DEMO)
            seen = [feed.receive_json() for _ in range(4)]
        assert seen[0] == {"type": "demo_recording", "live": True}
        assert [(m["final"], m["text"], m["speaker"]) for m in seen[1:3]] == [(False, "hello", 1), (True, "hello band", 1)]
        assert seen[3] == {"type": "demo_recording", "live": False}
        body = client.get("/api/demo/transcript").json()
        assert body["recording"] is False
        assert [(l["speaker"], l["text"]) for l in body["lines"]] == [(1, "hello band")]
        assert body["lines"][0]["at"] == seen[2]["at"]
        assert client.get("/api/demo/transcript?limit=0").status_code == 422


@pytest.mark.parametrize("extra", [{}, {"publish_key": "x" * len(DEMO)}, {"publish_key": 7}])
def test_without_key_nothing_stored_or_broadcast(client, extra, monkeypatch):
    sent = []

    async def spy(message):
        sent.append(message)
    monkeypatch.setattr(demo_feed, "broadcast", spy)
    with client:
        record(client, **extra)
        assert sent == []
        assert client.get("/api/demo/transcript").json() == {"recording": False, "lines": []}
        assert store.get().db.execute("SELECT COUNT(*) FROM demo_lines").fetchone()[0] == 0


def test_key_unset_means_no_publishing(client, monkeypatch):
    monkeypatch.delenv("DEMO_WATCH_KEY")
    with client:
        record(client, publish_key=DEMO)
        assert client.get("/api/demo/transcript").json()["lines"] == []


def test_demo_watch_readings_are_stored(client):
    with client:
        body = client.post("/api/watch/start", json={"device": "Demo Watch"}).json()
        client.post("/api/watch/claim", json={"code": body["code"]}, headers={"X-App-Token": TOKEN})
        headers = {"X-Watch-Code": body["code"], "X-Watch-Key": body["watch_key"], "X-Watch-Device": "Demo Watch"}
        client.post("/api/watch/sensors", json={"type": "sensors", "heart_rate": 70}, headers=headers)  # no key
        client.post("/api/watch/sensors", json={"type": "sensors", "heart_rate": 71},
                    headers={**headers, "X-Demo-Key": DEMO})
        readings = client.get("/api/demo/readings").json()["readings"]
        assert len(readings) == 1
        assert readings[0]["device"] == "Demo Watch" and readings[0]["frame"]["heart_rate"] == 71.0


def test_app_starts_with_unwritable_db_path(client, tmp_path, monkeypatch, caplog):
    blocker = tmp_path / "not-a-dir"
    blocker.write_text("")
    monkeypatch.setenv("THREADLINE_DB_PATH", str(blocker / "threadline.db"))
    store.reset()
    with client:
        assert client.get("/api/health").status_code == 200
        with client.websocket_connect("/api/demo/feed") as feed:
            feed.receive_json()
            record(client, publish_key=DEMO)  # still broadcasts, just not stored
            assert feed.receive_json() == {"type": "demo_recording", "live": True}
            assert feed.receive_json()["text"] == "hello"
        assert client.get("/api/demo/transcript").json() == {"recording": False, "lines": []}
        assert client.get("/api/demo/readings").json() == {"readings": []}
    assert store.get() is None
    assert "Demo storage disabled" in caplog.text
