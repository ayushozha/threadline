import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app import assistant, main


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("APP_ACCESS_TOKEN", "t" * 32)
    monkeypatch.delenv("APP_TRUST_LOOPBACK", raising=False)
    monkeypatch.setenv("ELEVENLABS_API_KEY", "test-key")
    monkeypatch.setenv("ELEVENLABS_VOICE_ID", "configured-voice")
    monkeypatch.setenv("ELEVENLABS_MODEL", "configured-speech-model")
    monkeypatch.delenv("ASSISTANT_VOICE_ID", raising=False)
    monkeypatch.delenv("ASSISTANT_MULTILINGUAL_MODEL", raising=False)
    return TestClient(main.app)


def test_speech_requires_configured_model_before_provider_request(client, monkeypatch):
    monkeypatch.delenv("ELEVENLABS_MODEL")
    response = client.post("/api/assistant/speak", json={"text": "Hello"}, headers={"x-app-token": "t" * 32})
    assert response.status_code == 503


@pytest.mark.parametrize("text,multilingual,expected", [
    ("Hello", "configured-multilingual", "configured-speech-model"),
    ("नमस्ते", "configured-multilingual", "configured-multilingual"),
    ("नमस्ते", None, "configured-speech-model"),
])
def test_speech_uses_environment_model_and_voice(client, monkeypatch, text, multilingual, expected):
    if multilingual:
        monkeypatch.setenv("ASSISTANT_MULTILINGUAL_MODEL", multilingual)
    calls = []

    def respond(request):
        calls.append(request)
        return httpx.Response(200, content=b"test-audio", headers={"content-type": "audio/mpeg"})

    original = httpx.AsyncClient
    monkeypatch.setattr(assistant.httpx, "AsyncClient", lambda **kw: original(transport=httpx.MockTransport(respond), **kw))
    response = client.post("/api/assistant/speak", json={"text": text}, headers={"x-app-token": "t" * 32})
    assert response.status_code == 200
    assert json.loads(calls[0].content)["model_id"] == expected
    assert "/configured-voice?" in str(calls[0].url)
