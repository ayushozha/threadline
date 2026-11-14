import asyncio
import json

import pytest

from app import main


class Provider:
    def __init__(self, *, fail_audio=False, fail_heartbeat=False, error_frame=False, end_immediately=False,
                 drain_forever=False):
        self.queue = asyncio.Queue()
        self.sent = []
        self.closed = False
        self.fail_audio = fail_audio
        self.fail_heartbeat = fail_heartbeat
        self.end_immediately = end_immediately
        self.drain_forever = drain_forever
        if error_frame:
            self.queue.put_nowait(json.dumps({"type": "Error", "description": "secret-provider-key private speech"}))

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        await self.close()

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self.end_immediately:
            raise StopAsyncIteration
        item = await self.queue.get()
        if item is None:
            raise StopAsyncIteration
        return item

    async def close(self):
        self.closed = True
        await self.queue.put(None)

    async def send(self, data):
        self.sent.append(data)
        if isinstance(data, bytes) and self.fail_audio:
            raise RuntimeError("secret-provider-key private speech")
        if isinstance(data, str) and "KeepAlive" in data and self.fail_heartbeat:
            raise OSError("secret-provider-key private speech")
        if isinstance(data, str) and "Finalize" in data:
            await self.queue.put(json.dumps({"type": "Results", "is_final": True, "speech_final": True,
                                            "channel": {"alternatives": [{"transcript": "final words", "words": []}]}}))
        if isinstance(data, str) and "CloseStream" in data and not self.drain_forever:
            await self.queue.put(None)


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setenv("DEEPGRAM_API_KEY", "secret-provider-key")
    monkeypatch.setenv("DEEPGRAM_MODEL", "test-model")
    monkeypatch.setattr(main, "LIVE_KEEPALIVE_SECONDS", 0.01)
    monkeypatch.setattr(main, "LIVE_FINALIZE_SECONDS", 0.01)
    monkeypatch.setattr(main, "LIVE_DRAIN_SECONDS", 0.03)
    monkeypatch.setattr(main, "stream_slots", asyncio.Semaphore(4))
    return monkeypatch


async def exercise(monkeypatch, provider, inputs=()):
    monkeypatch.setattr(main, "ws_connect", lambda *args, **kwargs: provider)
    queue = asyncio.Queue()
    for item in inputs:
        queue.put_nowait(item)
    messages, errors = [], []

    async def send(message):
        messages.append(message)

    async def fail(message, code=1008):
        errors.append((message, code))

    result = await asyncio.wait_for(main.relay_audio("vexo", queue.get, send, fail, max_seconds=10), timeout=0.5)
    await asyncio.sleep(0)
    assert provider.closed
    assert main.stream_slots._value == 4
    return result, messages, errors


@pytest.mark.parametrize("failure", ["audio", "heartbeat", "provider_error", "unexpected_end"])
def test_relay_failures_terminate_promptly_and_do_not_echo_provider_data(configured, failure):
    async def scenario():
        provider = Provider(fail_audio=failure == "audio", fail_heartbeat=failure == "heartbeat",
                            error_frame=failure == "provider_error", end_immediately=failure == "unexpected_end")
        result, messages, errors = await exercise(configured, provider, [b"audio"] if failure == "audio" else [])
        assert result is None
        assert errors == [("Live transcription disconnected. Please reconnect and try again.", 1011)]
        assert "secret-provider-key" not in json.dumps([messages, errors])
        assert "private speech" not in json.dumps([messages, errors])
    asyncio.run(scenario())


def test_stop_drains_final_words_before_closing(configured):
    async def scenario():
        provider = Provider()
        result, messages, errors = await exercise(configured, provider, [b"audio", "stop"])
        assert result == 5 and not errors
        assert [item["type"] for item in messages] == ["ready", "result"]
        assert messages[-1]["transcript"] == "final words"
        assert any("Finalize" in item for item in provider.sent if isinstance(item, str))
        assert any("CloseStream" in item for item in provider.sent if isinstance(item, str))
    asyncio.run(scenario())


def test_stop_has_bounded_drain_when_provider_does_not_close(configured):
    async def scenario():
        result, messages, errors = await exercise(configured, Provider(drain_forever=True), ["stop"])
        assert result == 0 and not errors
        assert messages[-1]["transcript"] == "final words"
    asyncio.run(scenario())


def test_browser_departure_closes_provider_without_a_success_result(configured):
    async def scenario():
        result, _, errors = await exercise(configured, Provider(), [None])
        assert result is None and not errors
    asyncio.run(scenario())


def test_guest_limits_allow_continuous_capture_but_remain_finite():
    assert main.GUEST_STREAM_SECONDS == 2 * 3600
    assert main.GUEST_STREAM_START_LIMIT == 30
    assert main.GUEST_STREAM_BYTES == 20 * 1024 * 1024
    assert main.GUEST_MAX_ACTIVE_STREAMS == 2
