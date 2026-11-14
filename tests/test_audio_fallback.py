import base64
import io
import json
import wave
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from fastapi.testclient import TestClient

from app import main


def wav_bytes(seconds=1, channels=1, width=2, rate=16000):
    out = io.BytesIO()
    with wave.open(out, "wb") as audio:
        audio.setnchannels(channels)
        audio.setsampwidth(width)
        audio.setframerate(rate)
        audio.writeframes(bytes(round(seconds * rate) * channels * width))
    return out.getvalue()


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("APP_ACCESS_TOKEN", "test-fallback-token")
    monkeypatch.setenv("GOOGLE_API_KEY", "test-google-key")
    monkeypatch.setenv("GEMINI_MODEL", "configured-test-model")
    monkeypatch.delenv("APP_TRUST_LOOPBACK", raising=False)
    with TestClient(main.app) as client:
        yield client


def post(client, audio, mime="audio/wav", token=True):
    headers = {"Content-Type": mime}
    if token:
        headers["X-App-Token"] = "test-fallback-token"
    return client.post("/api/transcribe/fallback", content=audio, headers=headers)


def stub_provider(monkeypatch, text="नमस्ते", status=200):
    seen = []
    def handler(request):
        seen.append(json.loads(request.content))
        return httpx.Response(status, json={"steps": [{"type": "model_output", "content": [{"type": "text", "text": text}]}]})
    original = httpx.AsyncClient
    monkeypatch.setattr(main.httpx, "AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))
    return seen


def test_fallback_preserves_original_script_and_uses_inline_audio(client, monkeypatch):
    seen = stub_provider(monkeypatch)
    audio = wav_bytes()
    response = post(client, audio)
    assert response.status_code == 200
    assert response.json() == {"text": "नमस्ते", "provider": "gemini", "duration_seconds": 1.0, "words": [], "speaker_verified": False}
    assert seen[0]["model"] == "configured-test-model" and seen[0]["store"] is False
    assert base64.b64decode(seen[0]["input"][1]["data"]) == audio
    assert seen[0]["input"][1]["mime_type"] == "audio/wav"
    assert "Do not translate" in seen[0]["input"][0]["text"]


@pytest.mark.parametrize("audio,mime,status", [
    (b"bad", "audio/mpeg", 415), (b"bad", "audio/wav", 422),
    (wav_bytes(0), "audio/wav", 422), (wav_bytes(16), "audio/wav", 422),
    (wav_bytes(channels=2), "audio/wav", 422), (wav_bytes(width=1), "audio/wav", 422),
    (wav_bytes(rate=8000), "audio/wav", 422), (wav_bytes()[:-10], "audio/wav", 422),
    (bytes(1024 * 1024 + 1), "audio/wav", 413),
])
def test_fallback_rejects_invalid_recordings(client, audio, mime, status):
    assert post(client, audio, mime).status_code == status


def test_fallback_requires_authorization(client):
    assert post(client, wav_bytes(), token=False).status_code == 401


def test_fallback_silence_and_sanitized_failure(client, monkeypatch):
    stub_provider(monkeypatch, "[no speech]")
    assert post(client, wav_bytes()).json()["text"] == ""


def test_fallback_sanitizes_upstream_errors(client, monkeypatch):
    stub_provider(monkeypatch, "private upstream detail", 429)
    response = post(client, wav_bytes())
    assert response.status_code == 502
    assert "private" not in response.text


def test_multilingual_stream_parameters(monkeypatch):
    monkeypatch.delenv("DEEPGRAM_LANGUAGE", raising=False)
    monkeypatch.delenv("DEEPGRAM_ENDPOINTING_MS", raising=False)
    defaults = parse_qs(urlsplit(main.live_url("vexo")).query)
    assert defaults["language"] == ["multi"] and defaults["endpointing"] == ["100"]
    assert defaults["encoding"] == ["opus"] and defaults["sample_rate"] == ["16000"]
    monkeypatch.setenv("DEEPGRAM_LANGUAGE", "hi")
    monkeypatch.setenv("DEEPGRAM_ENDPOINTING_MS", "200")
    configured = parse_qs(urlsplit(main.live_url("vexo")).query)
    assert configured["language"] == ["hi"] and configured["endpointing"] == ["200"]


def test_stream_result_keeps_language_and_confidence():
    result = main.simplify({"type": "Results", "is_final": True, "channel": {"alternatives": [{"transcript": "Hola", "confidence": .95, "languages": ["es"], "words": [{"word": "hola", "language": "es", "confidence": .94, "speaker": 0}]}]}})
    assert result["confidence"] == .95 and result["languages"] == ["es"]
    assert result["words"][0]["language"] == "es" and result["words"][0]["confidence"] == .94
