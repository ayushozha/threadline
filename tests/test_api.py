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
