import asyncio
import base64
import json

import pytest
from fastapi.testclient import TestClient

from app import live_gemini, main


class FakeGemini:
    """Fake Gemini Live socket: answers setup, then on the first audio replies with audio + transcripts."""

    def __init__(self):
        self.sent, self.closed, self.queue = [], False, asyncio.Queue()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        self.closed = True

    async def recv(self):
        return json.dumps({"setupComplete": {}})

    def __aiter__(self):
        return self

    async def __anext__(self):
        item = await self.queue.get()
        if item is None:
            raise StopAsyncIteration
        return item

    async def send(self, data):
        msg = json.loads(data)
        self.sent.append(msg)
        if "audio" in msg.get("realtimeInput", {}):
            pcm = base64.b64encode(b"\x10\x20\x30\x40").decode()
            for reply in (
                {"serverContent": {"inputTranscription": {"text": "where are my keys"}}},
                {"serverContent": {"modelTurn": {"parts": [{"inlineData": {"mimeType": "audio/pcm;rate=24000", "data": pcm}}]}}},
                {"serverContent": {"outputTranscription": {"text": "I am not sure."}}},
                {"serverContent": {"interrupted": True}},
                {"serverContent": {"turnComplete": True}},
            ):
                await self.queue.put(json.dumps(reply).encode())

    async def close(self):
        self.closed = True
        await self.queue.put(None)


@pytest.fixture
def setup(monkeypatch):
    monkeypatch.setenv("APP_ACCESS_TOKEN", "test-only-access")
    monkeypatch.setenv("GOOGLE_API_KEY", "secret-provider-key")
    monkeypatch.setenv("GEMINI_LIVE_MODEL", "test-live-model")
    monkeypatch.setattr(main, "stream_slots", asyncio.Semaphore(4))
    fake = FakeGemini()
    calls = []
    monkeypatch.setattr(live_gemini, "ws_connect", lambda *a, **k: calls.append((a, k)) or fake)
    return TestClient(main.app), fake, calls


def start(ws, **extra):
    ws.send_json({"token": "test-only-access", "mode": "memory", **extra})
    ready = ws.receive_json()
    assert ready == {"type": "ready", "model": "test-live-model"}


def test_auth_required_before_contacting_provider(setup):
    client, _, calls = setup
    with client.websocket_connect("/api/live-gemini") as ws:
        ws.send_json({"token": "wrong", "mode": "memory"})
        assert ws.receive_json()["type"] == "error"
    assert calls == []


def test_setup_uses_env_model_audio_modality_and_system_instruction(setup):
    client, fake, calls = setup
    with client.websocket_connect("/api/live-gemini") as ws:
        start(ws, notes=["Keys live on the hook"])
        ws.send_json({"type": "stop"})
    setup_msg = fake.sent[0]["setup"]
    assert setup_msg["model"] == "models/test-live-model"
    assert setup_msg["generationConfig"]["responseModalities"] == ["AUDIO"]
    instruction = setup_msg["systemInstruction"]["parts"][0]["text"]
    assert "pill organiser" in instruction and "dementia" in instruction
    assert "inputAudioTranscription" in setup_msg and "outputAudioTranscription" in setup_msg
    history = fake.sent[1]["clientContent"]["turns"][0]["parts"][0]["text"]
    assert "own saved notes" in history and "Keys live on the hook" in history
    assert calls[0][1]["additional_headers"] == {"x-goog-api-key": "secret-provider-key"}
    assert "secret-provider-key" not in calls[0][0][0]
    assert fake.closed and not main.stream_slots.locked()


def test_audio_and_frame_forwarded_and_replies_relayed(setup):
    client, fake, _ = setup
    jpeg = base64.b64encode(b"\xff\xd8jpeg").decode()
    with client.websocket_connect("/api/live-gemini") as ws:
        start(ws)
        ws.send_json({"type": "frame", "jpeg": jpeg})
        ws.send_json({"type": "text", "text": "What was I doing?"})
        ws.send_bytes(b"\x01\x02\x03\x04")
        assert ws.receive_json() == {"type": "heard", "text": "where are my keys"}
        assert ws.receive_bytes() == b"\x10\x20\x30\x40"
        assert ws.receive_json() == {"type": "said", "text": "I am not sure."}
        assert ws.receive_json() == {"type": "interrupted"}
        assert ws.receive_json() == {"type": "turn_complete"}
        ws.send_json({"type": "stop"})
    inputs = [m["realtimeInput"] for m in fake.sent if "realtimeInput" in m]
    assert {"video": {"data": jpeg, "mimeType": "image/jpeg"}} in inputs
    assert {"text": "What was I doing?"} in inputs
    assert {"audio": {"data": base64.b64encode(b"\x01\x02\x03\x04").decode(), "mimeType": "audio/pcm;rate=16000"}} in inputs


def test_oversized_frame_rejected_and_not_forwarded(setup):
    client, fake, _ = setup
    big = base64.b64encode(b"\x00" * (live_gemini.MAX_FRAME_BYTES + 10)).decode()
    with client.websocket_connect("/api/live-gemini") as ws:
        start(ws)
        ws.send_json({"type": "frame", "jpeg": big})
        reply = ws.receive_json()
        assert reply["type"] == "error" and "too large" in reply["message"]
        ws.send_json({"type": "stop"})
    assert not any("video" in m.get("realtimeInput", {}) for m in fake.sent)


def test_browser_disconnect_releases_upstream(setup):
    _, fake, _ = setup

    class LeavingBrowser:
        async def receive(self):
            return {"type": "websocket.disconnect"}

        async def send_json(self, message):
            raise RuntimeError("browser left")

        async def close(self):
            raise RuntimeError("browser left")

    asyncio.run(live_gemini.pump(LeavingBrowser(), fake, 5, 1000))
    assert fake.closed


def test_missing_model_env_is_explicit(setup, monkeypatch):
    client, _, calls = setup
    monkeypatch.delenv("GEMINI_LIVE_MODEL")
    with client.websocket_connect("/api/live-gemini") as ws:
        ws.send_json({"token": "test-only-access", "mode": "memory"})
        assert "GEMINI_LIVE_MODEL" in ws.receive_json()["message"]
    assert calls == []


@pytest.mark.parametrize("mode,expected", [
    ("memory", "last seen or mentioned"), ("sight", "Read legible text aloud verbatim"),
    ("hearing", "accurate transcription"), ("mobility", "Do not infer fall risk"),
])
def test_selected_mode_reaches_provider_with_shared_boundaries(setup, mode, expected):
    client, fake, _ = setup
    with client.websocket_connect("/api/live-gemini") as ws:
        start(ws, mode=mode)
        ws.send_json({"type": "stop"})
    instruction = fake.sent[0]["setup"]["systemInstruction"]["parts"][0]["text"]
    assert expected in instruction
    assert "Never diagnose" in instruction
    assert "not identify them" in instruction
    assert "external action completed" in instruction


@pytest.mark.parametrize("mode", ["unknown", None, {}, ["memory"]])
def test_invalid_mode_cannot_contact_provider(setup, mode):
    client, _, calls = setup
    with client.websocket_connect("/api/live-gemini") as ws:
        ws.send_json({"token": "test-only-access", "mode": mode})
        assert "Unknown assistance mode" in ws.receive_json()["message"]
    assert calls == []


def test_missing_mode_keeps_existing_memory_behavior(setup):
    client, fake, _ = setup
    with client.websocket_connect("/api/live-gemini") as ws:
        ws.send_json({"token": "test-only-access"})
        assert ws.receive_json()["type"] == "ready"
        ws.send_json({"type": "stop"})
    assert "memory support" in fake.sent[0]["setup"]["systemInstruction"]["parts"][0]["text"]
