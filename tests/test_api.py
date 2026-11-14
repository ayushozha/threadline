import asyncio
import httpx
import pytest
from fastapi.testclient import TestClient

from app import main


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("APP_ACCESS_TOKEN", "test-only-access")
    return TestClient(main.app)


def test_api_denies_provider_access_without_token(client):
    assert client.get("/api/health").status_code == 200
    assert client.get("/api/config").status_code == 401
    response = client.post("/api/reflect", json={"mode": "routine", "question": "Where was I?", "notes": []})
    assert response.status_code == 401
    assert "Content-Security-Policy" in response.headers


def test_missing_provider_configuration_is_explicit(client, monkeypatch):
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    response = client.post("/api/reflect", headers={"X-App-Token": "test-only-access"}, json={
        "mode": "routine", "question": "Where was I?",
        "notes": [{"id": "n1", "text": "Pack the bag.", "at": "2026-11-14"}],
    })
    assert response.status_code == 503
    assert "GOOGLE_API_KEY" in response.json()["detail"]


def test_live_adapter_keeps_source_ids_and_disables_provider_storage(client, monkeypatch):
    monkeypatch.setenv("GOOGLE_API_KEY", "test-only-key")
    monkeypatch.setenv("GEMINI_MODEL", "test-model")
    real_client = httpx.AsyncClient

    def respond(request):
        import json
        payload = json.loads(request.content)
        assert payload["store"] is False
        assert payload["model"] == "test-model"
        assert "Pack the bag." in payload["input"]
        return httpx.Response(200, json={"steps": [{"type": "model_output", "content": [
            {"type": "text", "text": "You planned to pack your bag. [n1]"}
        ]}]})

    monkeypatch.setattr(main.httpx, "AsyncClient", lambda **kwargs: real_client(transport=httpx.MockTransport(respond), **kwargs))
    response = client.post("/api/reflect", headers={"X-App-Token": "test-only-access"}, json={
        "mode": "routine", "question": "Where was I?",
        "notes": [{"id": "n1", "text": "Pack the bag.", "at": "2026-11-14"}],
    })
    assert response.status_code == 200
    assert response.json()["sources"] == ["n1"]


def test_audio_validates_before_provider_request(client, monkeypatch):
    monkeypatch.setenv("DEEPGRAM_API_KEY", "test-only-key")
    monkeypatch.setenv("DEEPGRAM_MODEL", "test-model")
    response = client.post("/api/transcribe", headers={"X-App-Token": "test-only-access", "Content-Type": "text/plain"}, content=b"not audio")
    assert response.status_code == 415


DAY = "2026-11-15"
BUSY = [
    {"id": "e1", "title": "Lunch", "date": DAY, "start": "12:00", "end": "13:00"},
    {"id": "e2", "title": "Team sync", "date": DAY, "start": "13:00", "end": "14:00"},
]


def test_find_slot_reports_checked_times_and_first_free_slot(client):
    response = client.post("/api/schedule/find-slot", json={"events": BUSY, "date": DAY, "duration_minutes": 30})
    assert response.status_code == 200
    data = response.json()
    assert data["slot"] == {"date": DAY, "start": "14:00", "end": "14:30"}
    assert [c["status"] for c in data["checked"]] == ["busy", "busy", "busy", "busy", "free"]


def test_find_slot_respects_declined_times_and_full_windows(client):
    response = client.post("/api/schedule/find-slot", json={"events": BUSY, "date": DAY, "skip": ["14:00"]})
    assert response.json()["slot"]["start"] == "14:30"
    full = client.post("/api/schedule/find-slot", json={"events": BUSY, "date": DAY, "window_start": "12:00", "window_end": "14:00"})
    assert full.json()["slot"] is None


def test_booking_rechecks_conflicts_before_creating(client):
    quiet = {"title": "Quiet time", "date": DAY, "start": "14:00", "end": "14:30"}
    added = BUSY + [{"id": "e3", "title": "Landlord call", "date": DAY, "start": "14:00", "end": "14:30"}]
    conflict = client.post("/api/schedule/book", json={"events": added, "event": quiet})
    assert conflict.status_code == 409
    assert conflict.json()["conflicts"][0]["title"] == "Landlord call"
    created = client.post("/api/schedule/book", json={"events": BUSY, "event": quiet})
    assert created.status_code == 200
    assert created.json()["event"]["created_by"] == "threadline"
    assert len(created.json()["events"]) == 3


def test_schedule_rejects_malformed_times(client):
    response = client.post("/api/schedule/find-slot", json={"events": [], "date": DAY, "window_start": "25:00"})
    assert response.status_code == 422


def test_device_reports_configured_band_only(client, monkeypatch):
    monkeypatch.setenv("VEXO_BAND_NUMBER", "73")
    assert client.get("/api/device").json()["vexo_band_number"] == 73
    monkeypatch.setenv("VEXO_BAND_NUMBER", "not-a-band")
    assert client.get("/api/device").json()["vexo_band_number"] is None


def test_live_transcribe_rejects_bad_token_before_contacting_provider(client, monkeypatch):
    monkeypatch.setenv("DEEPGRAM_API_KEY", "test-only-key")
    monkeypatch.setenv("DEEPGRAM_MODEL", "test-model")
    with client.websocket_connect("/api/live-transcribe") as ws:
        ws.send_json({"token": "wrong", "source": "vexo"})
        assert ws.receive_json()["type"] == "error"


def test_live_url_uses_band_opus_format_and_env_model(monkeypatch):
    monkeypatch.setenv("DEEPGRAM_MODEL", "test-model")
    url = main.live_url("vexo")
    assert "encoding=opus" in url and "sample_rate=16000" in url and "model=test-model" in url
    assert "mip_opt_out=true" in url
    assert "encoding" not in main.live_url("browser")


def test_loopback_trust_is_opt_in_and_local_only(monkeypatch):
    monkeypatch.delenv("APP_TRUST_LOOPBACK", raising=False)
    assert not main.trusted_local("127.0.0.1", "localhost:8000")
    monkeypatch.setenv("APP_TRUST_LOOPBACK", "1")
    assert main.trusted_local("127.0.0.1", "localhost:8000")
    assert not main.trusted_local("10.0.1.5", "localhost:8000")          # e.g. a reverse proxy
    assert not main.trusted_local("127.0.0.1", "threadline.ayushojha.com")


GRAPH_NOTES = [
    {"id": "n1", "text": "Felt exhausted after the budget meeting with Priya. I will email the landlord tomorrow evening.", "at": "2026-11-12"},
    {"id": "n2", "text": "Still exhausted this evening. Dinner with Priya was calm.", "at": "2026-11-13", "speaker": "Speaker 1", "device": "vexo"},
]


def test_local_graph_builds_feeling_time_nodes_and_cooccurrence_edges(client, monkeypatch):
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    response = client.post("/api/graph", headers={"X-App-Token": "test-only-access"}, json={"mode": "local", "notes": GRAPH_NOTES})
    assert response.status_code == 200
    data = response.json()
    assert data["engine"] == "local"
    nodes = {node["id"]: node for node in data["nodes"]}
    assert nodes["feeling:exhausted"]["sources"] == ["n1", "n2"] and nodes["feeling:exhausted"]["weight"] == 2
    assert nodes["time:evening"]["type"] == "time" and nodes["time:tomorrow"]["sources"] == ["n1"]
    assert nodes["person:priya"]["type"] == "person"
    assert nodes["commitment:email-the-landlord"]["label"] == "email the landlord"
    assert "person:speaker-1" not in nodes
    edge = next(e for e in data["edges"] if {e["source"], e["target"]} == {"feeling:exhausted", "time:evening"})
    assert edge["label"] == "mentioned with" and edge["weight"] == 2 and edge["sources"] == ["n1", "n2"]
    assert len(data["nodes"]) <= 40 and len(data["edges"]) <= 80


def test_graph_rejects_duplicate_note_ids(client):
    notes = [GRAPH_NOTES[0], {**GRAPH_NOTES[1], "id": "n1"}]
    response = client.post("/api/graph", headers={"X-App-Token": "test-only-access"}, json={"mode": "local", "notes": notes})
    assert response.status_code == 422


def test_gemini_graph_requires_provider_configuration(client, monkeypatch):
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    monkeypatch.setenv("GEMINI_MODEL", "test-model")
    response = client.post("/api/graph", headers={"X-App-Token": "test-only-access"}, json={"mode": "gemini", "notes": GRAPH_NOTES})
    assert response.status_code == 503
    assert "GOOGLE_API_KEY" in response.json()["detail"]


def test_gemini_graph_drops_invented_sources_and_dangling_edges(client, monkeypatch):
    import json
    monkeypatch.setenv("GOOGLE_API_KEY", "test-only-key")
    monkeypatch.setenv("GEMINI_MODEL", "test-model")
    real_client = httpx.AsyncClient
    graph = {
        "nodes": [
            {"id": "feeling:exhausted", "label": "exhausted", "type": "feeling", "weight": 2, "sources": ["n1", "n2", "n99"]},
            {"id": "person:priya", "label": "Priya", "type": "person", "weight": 2, "sources": ["n1", "n2"]},
            {"id": "topic:invented", "label": "invented", "type": "topic", "weight": 1, "sources": ["n99"]},
        ],
        "edges": [
            {"source": "feeling:exhausted", "target": "person:priya", "label": "mentioned with", "weight": 2, "sources": ["n1", "n42"]},
            {"source": "feeling:exhausted", "target": "place:nowhere", "label": "mentioned with", "weight": 1, "sources": ["n1"]},
        ],
    }

    def respond(request):
        payload = json.loads(request.content)
        assert payload["store"] is False
        assert payload["model"] == "test-model"
        assert "budget meeting with Priya" in payload["input"]
        return httpx.Response(200, json={"steps": [{"type": "model_output", "content": [
            {"type": "text", "text": "```json\n" + json.dumps(graph) + "\n```"}
        ]}]})

    monkeypatch.setattr(main.httpx, "AsyncClient", lambda **kwargs: real_client(transport=httpx.MockTransport(respond), **kwargs))
    response = client.post("/api/graph", headers={"X-App-Token": "test-only-access"}, json={"mode": "gemini", "notes": GRAPH_NOTES})
    assert response.status_code == 200
    data = response.json()
    assert data["engine"] == "gemini"
    nodes = {node["id"]: node for node in data["nodes"]}
    assert set(nodes) == {"feeling:exhausted", "person:priya"}
    assert nodes["feeling:exhausted"]["sources"] == ["n1", "n2"]
    assert data["edges"] == [{"source": "feeling:exhausted", "target": "person:priya", "label": "mentioned with", "weight": 2.0, "sources": ["n1"]}]


def test_gemini_graph_reports_unparseable_output(client, monkeypatch):
    monkeypatch.setenv("GOOGLE_API_KEY", "test-only-key")
    monkeypatch.setenv("GEMINI_MODEL", "test-model")
    real_client = httpx.AsyncClient

    def respond(request):
        return httpx.Response(200, json={"steps": [{"type": "model_output", "content": [{"type": "text", "text": "Not JSON."}]}]})

    monkeypatch.setattr(main.httpx, "AsyncClient", lambda **kwargs: real_client(transport=httpx.MockTransport(respond), **kwargs))
    response = client.post("/api/graph", headers={"X-App-Token": "test-only-access"}, json={"mode": "gemini", "notes": GRAPH_NOTES})
    assert response.status_code == 502


def test_live_relay_releases_provider_when_browser_leaves(client, monkeypatch):
    """A browser that disconnects must not keep a Deepgram stream (and a slot) open."""
    monkeypatch.setenv("DEEPGRAM_API_KEY", "test-only-key")
    monkeypatch.setenv("DEEPGRAM_MODEL", "test-model")
    closed = []

    class FakeDeepgram:
        def __init__(self):
            self.queue = asyncio.Queue()
        async def __aenter__(self):
            return self
        async def __aexit__(self, *exc):
            return False
        async def send(self, data):
            pass
        async def close(self):
            closed.append(True)
            await self.queue.put(None)
        def __aiter__(self):
            return self
        async def __anext__(self):
            item = await self.queue.get()
            if item is None:
                raise StopAsyncIteration
            return item

    monkeypatch.setattr(main, "ws_connect", lambda *a, **k: FakeDeepgram())
    for _ in range(3):  # more sessions than slots: each must release its slot
        with client.websocket_connect("/api/live-transcribe") as ws:
            ws.send_json({"token": "test-only-access", "source": "vexo"})
            assert ws.receive_json()["type"] == "ready"
            ws.send_bytes(b"\x01\x02")
    import time
    time.sleep(0.2)
    assert len(closed) == 3
    assert not main.stream_slots.locked()
