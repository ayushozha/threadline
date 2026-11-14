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
