import base64
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app import main
from app.music import MOOD_PROMPTS

TOKEN = {"X-App-Token": "test-only-access"}
AUDIO = b"ID3\x04fake-mp3-bytes"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("APP_ACCESS_TOKEN", "test-only-access")
    monkeypatch.delenv("APP_TRUST_LOOPBACK", raising=False)
    monkeypatch.delenv("MINIMAX_API_BASE", raising=False)
    return TestClient(main.app)


def configure(monkeypatch):
    monkeypatch.setenv("MINIMAX_API_KEY", "test-only-key")
    monkeypatch.setenv("MINIMAX_MUSIC_MODEL", "test-music-model")


def mock(monkeypatch, respond):
    real_client = httpx.AsyncClient
    monkeypatch.setattr(main.httpx, "AsyncClient", lambda **kwargs: real_client(transport=httpx.MockTransport(respond), **kwargs))


def test_music_requires_auth(client):
    assert client.post("/api/music/generate", json={"mood": "calm"}).status_code == 401


def test_music_missing_configuration_is_explicit(client, monkeypatch):
    monkeypatch.delenv("MINIMAX_API_KEY", raising=False)
    monkeypatch.setenv("MINIMAX_MUSIC_MODEL", "test-music-model")
    response = client.post("/api/music/generate", headers=TOKEN, json={"mood": "calm"})
    assert response.status_code == 503
    assert response.json()["detail"] == "Set MINIMAX_API_KEY and MINIMAX_MUSIC_MODEL to generate music."


def test_music_rejects_unknown_mood(client, monkeypatch):
    configure(monkeypatch)
    assert client.post("/api/music/generate", headers=TOKEN, json={"mood": "my private note"}).status_code == 422


def test_music_returns_base64_from_hex_and_sends_only_mood_prompt(client, monkeypatch):
    configure(monkeypatch)
    seen = {}

    def respond(request):
        seen["url"] = str(request.url)
        seen["auth"] = request.headers["authorization"]
        seen["payload"] = json.loads(request.content)
        return httpx.Response(200, json={
            "data": {"audio": AUDIO.hex(), "status": 2},
            "base_resp": {"status_code": 0, "status_msg": "success"},
        })

    mock(monkeypatch, respond)
    response = client.post("/api/music/generate", headers=TOKEN, json={"mood": "uplifting", "note": "ignored"})
    assert response.status_code == 200
    data = response.json()
    assert data == {"provider": "minimax", "model": "test-music-model", "mime": "audio/mpeg",
                    "audio_b64": base64.b64encode(AUDIO).decode()}
    assert seen["url"] == "https://api.minimax.io/v1/music_generation"
    assert seen["auth"] == "Bearer test-only-key"
    payload = seen["payload"]
    assert payload["model"] == "test-music-model"
    assert payload["prompt"] == MOOD_PROMPTS["uplifting"]
    assert payload["is_instrumental"] is True
    assert "lyrics" not in payload
    assert "ignored" not in json.dumps(payload)


def test_music_fetches_url_audio_server_side(client, monkeypatch):
    configure(monkeypatch)

    def respond(request):
        if request.method == "GET":
            return httpx.Response(200, content=AUDIO, headers={"content-type": "audio/mpeg"})
        return httpx.Response(200, json={"data": {"audio": "https://cdn.example.test/a.mp3", "status": 2},
                                         "base_resp": {"status_code": 0}})

    mock(monkeypatch, respond)
    response = client.post("/api/music/generate", headers=TOKEN, json={"mood": "calm"})
    assert response.status_code == 200
    assert base64.b64decode(response.json()["audio_b64"]) == AUDIO


@pytest.mark.parametrize("reply", [
    httpx.Response(500, json={"error": "boom"}),
    httpx.Response(200, json={"data": None, "base_resp": {"status_code": 1004, "status_msg": "auth failed"}}),
    httpx.Response(200, json={"data": {"audio": "zz-not-hex"}, "base_resp": {"status_code": 0}}),
])
def test_music_provider_failure_is_502(client, monkeypatch, reply):
    configure(monkeypatch)
    mock(monkeypatch, lambda request: reply)
    response = client.post("/api/music/generate", headers=TOKEN, json={"mood": "steady"})
    assert response.status_code == 502
    assert "MiniMax" in response.json()["detail"]
