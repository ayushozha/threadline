import asyncio
import json

from pipecat.frames.frames import (BotStartedSpeakingFrame, BotStoppedSpeakingFrame, InputTransportMessageFrame,
                                   OutputTransportMessageFrame, TranscriptionFrame, TranscriptionSpeaker, TTSSpeakFrame)
from pipecat.tests.utils import SleepFrame, run_test

from app import voice
from app.voice import Assistant, PcmSerializer, addressed, spoken_text, wake_pattern

WAKE = wake_pattern({})


def test_wake_word():
    assert addressed("Hey Vexa, what helped last time?", WAKE) == "what helped last time?"
    assert addressed("vexa", WAKE) == ""
    assert addressed("I vexed over it", WAKE) is None
    assert addressed("Do you still want dinner Thursday?", WAKE) is None


def test_spoken_text_is_formatting_only():
    assert spoken_text("Want me to look for a quiet slot?") == "Want me to look for a quiet slot?"
    assert spoken_text("From your note [n1], an evening free helped.") == "From your note, an evening free helped."
    assert spoken_text("**Hi** there") == "Hi there"
    assert spoken_text("x" * 400) is None and spoken_text("  ") is None and spoken_text(None) is None


def test_serializer_roundtrip():
    s = PcmSerializer()
    audio = asyncio.run(s.deserialize(b"\x00\x01" * 320))
    assert audio.sample_rate == 16000 and len(audio.audio) == 640
    assert asyncio.run(s.deserialize(b"\x00")) is None  # odd length: not PCM16
    msg = asyncio.run(s.deserialize('{"type": "say", "text": "hi"}'))
    assert isinstance(msg, InputTransportMessageFrame) and msg.message["type"] == "say"
    assert asyncio.run(s.deserialize("not json")) is None
    out = asyncio.run(s.serialize(OutputTransportMessageFrame(message={"type": "x"})))
    assert json.loads(out) == {"type": "x"}


def transcription(text, speaker=None):
    return TranscriptionFrame(text=text, user_id="u", timestamp="t", language=None, finalized=True,
                              speaker=TranscriptionSpeaker(label=speaker, number=int(speaker) + 1) if speaker is not None else None)


def run(frames, monkeypatch, converse_reply="Want me to look for a quiet slot?", setup=None):
    async def fake_decide(body, env, slots):
        return {"action": "offer_schedule", "message": "Want me to look for a quiet slot, as you asked me to?", "engine": "local"}

    seen = []

    async def fake_converse(body, decision, env, slots, trigger=None):
        seen.append(trigger)
        return converse_reply

    monkeypatch.setattr(voice, "decide", fake_decide)
    monkeypatch.setattr(voice, "converse", fake_converse)
    assistant = Assistant({}, asyncio.Semaphore(1))
    assistant.seen_triggers = seen
    if setup:
        setup(assistant)
    down, _ = asyncio.run(run_test(assistant, frames_to_send=frames))
    return assistant, down


def events(down):
    return [f.message for f in down if isinstance(f, OutputTransportMessageFrame)]


def test_unaddressed_speech_is_shown_but_not_answered(monkeypatch):
    _, down = run([transcription("Do you still want dinner on Thursday?"), SleepFrame(sleep=0.3)], monkeypatch)
    ev = events(down)
    assert [e["type"] for e in ev] == ["result", "affect"] and ev[0]["addressed"] is False
    assert ev[0]["words"] == [] and "start" in ev[0]  # shape the page's transcript code expects
    assert ev[1]["energy"] == "unknown"  # still learning this person's baseline: no mood claim
    assert not any(isinstance(f, TTSSpeakFrame) for f in down)


def test_addressed_speech_gets_a_spoken_reply(monkeypatch):
    _, down = run([transcription("Vexa, I'm exhausted."), SleepFrame(sleep=0.3)], monkeypatch)
    kinds = [e["type"] for e in events(down)]
    assert kinds == ["result", "affect", "decision", "assistant"]
    assert [f.text for f in down if isinstance(f, TTSSpeakFrame)] == ["Want me to look for a quiet slot?"]


def test_missing_reply_falls_back_to_decision_wording(monkeypatch):
    _, down = run([transcription("Vexa, why am I like this?"), SleepFrame(sleep=0.3)], monkeypatch, converse_reply=None)
    assert [f.text for f in down if isinstance(f, TTSSpeakFrame)] == ["Want me to look for a quiet slot, as you asked me to?"]


def spoken(down):
    return [f.text for f in down if isinstance(f, TTSSpeakFrame)]


def test_low_energy_words_trigger_a_spoken_nudge(monkeypatch):
    assistant, down = run([transcription("I'm so exhausted, I can't think straight."), SleepFrame(sleep=0.3)], monkeypatch)
    ev = events(down)
    assert [e["type"] for e in ev] == ["result", "affect", "decision", "assistant"]
    assert ev[-1]["trigger"]["kind"] == "words" and ev[-1]["trigger"]["energy"] == "low"
    assert spoken(down) == ["Want me to look for a quiet slot?"]
    assert assistant.seen_triggers[0]["energy"] == "low"


def test_moodiness_words_trigger_and_cooldown_limits_nudges(monkeypatch):
    _, down = run([transcription("I'm so irritated with this."), SleepFrame(sleep=0.3),
                   transcription("Honestly so frustrated right now."), SleepFrame(sleep=0.3)], monkeypatch)
    nudges = [e for e in events(down) if e["type"] == "assistant"]
    assert len(nudges) == 1 and nudges[0]["trigger"]["energy"] == "moody"


def test_nudges_can_be_turned_off(monkeypatch):
    def off(a):
        a.proactive = False
    _, down = run([transcription("I'm completely exhausted."), SleepFrame(sleep=0.3)], monkeypatch, setup=off)
    assert spoken(down) == [] and "assistant" not in [e["type"] for e in events(down)]


def test_only_the_wearers_speech_is_read_for_mood(monkeypatch):
    # speaker 0 talks the most, so speaker 1 is someone else: their "exhausted" must not trigger anything
    _, down = run([transcription("We should plan the whole week around the move and the boxes.", speaker=0),
                   SleepFrame(sleep=0.2), transcription("I'm exhausted.", speaker=1), SleepFrame(sleep=0.3)], monkeypatch)
    assert spoken(down) == []
    assert [e["wearer"] for e in events(down) if e["type"] == "result"] == [True, False]


def test_context_restores_baseline_and_stop_ends_session(monkeypatch):
    stopped = []

    async def stop():
        stopped.append(True)

    def setup(a):
        a.stop = stop
    state = {"baselines": {"text_valence": {"n": 30, "mean": 0.0, "dev": 0.1}}, "cusum": {"arousal": [0, 0], "valence": [0, 0]}}
    assistant, _ = run([InputTransportMessageFrame(message={"type": "context", "context": {}, "affect": state,
                                                              "proactive": False}),
                        InputTransportMessageFrame(message={"type": "stop"}), SleepFrame(sleep=0.2)], monkeypatch, setup=setup)
    assert assistant.affect_state == state and assistant.proactive is False and stopped == [True]


def test_signal_shift_triggers_only_when_stable():
    reading = lambda e, c=0.6: {"energy": e, "confidence": c, "drivers": [{"feature": "voice_rms", "z": -2.1}]}
    t, s = voice.detect_trigger("ok then", reading("low"), 0)
    assert t is None and s == 1
    t, s = voice.detect_trigger("ok then", reading("low"), s)
    assert t == {"kind": "signals", "energy": "low", "drivers": ["voice rms below usual"]}
    assert voice.detect_trigger("fine", reading("low", 0.1), 1) == (None, 0)  # low confidence resets
    assert voice.detect_trigger("fine", reading("steady"), 1) == (None, 0)
    assert voice.detect_trigger("fine", None, 1) == (None, 0)


def test_speech_rate_and_loudness():
    words = [{"start": i * 0.4, "end": i * 0.4 + 0.3} for i in range(10)]
    assert voice.speech_rate(words) == 153.8 and voice.speech_rate(words[:3]) is None
    import numpy as np
    stats = voice.VoiceStats()
    loud = (np.sin(np.arange(1600) / 5) * 8000).astype("<i2").tobytes()
    for _ in range(20):
        stats.add(loud)
    stats.add(bytes(3200))
    assert stats.loudness(0.5, 2.0) > 0.1
    assert voice.VoiceStats().loudness(0, 5) is None


def test_mic_ignored_while_assistant_speaks(monkeypatch):
    _, down = run([BotStartedSpeakingFrame(), transcription("Vexa, is that you?"), SleepFrame(sleep=0.3),
                   BotStoppedSpeakingFrame(), transcription("Vexa, again?"), SleepFrame(sleep=0.3)], monkeypatch)
    assert events(down) == []  # first: speaking; second: inside the echo tail


def test_say_is_rate_limited(monkeypatch):
    say = lambda t: InputTransportMessageFrame(message={"type": "say", "text": t})
    _, down = run([say("Want to check in?"), SleepFrame(sleep=0.1), say("Another line"),
                   SleepFrame(sleep=0.3)], monkeypatch)
    assert [f.text for f in down if isinstance(f, TTSSpeakFrame)] == ["Want to check in?"]


def test_voice_missing():
    assert voice.voice_missing({}) == "DEEPGRAM_API_KEY"
    base = {"DEEPGRAM_API_KEY": "k", "DEEPGRAM_MODEL": "m"}
    assert voice.voice_missing(base) == "DEEPGRAM_TTS_VOICE"
    assert voice.voice_missing({**base, "DEEPGRAM_TTS_VOICE": "v"}) is None
    assert voice.voice_missing({**base, "VOICE_TTS": "elevenlabs"}) == "ELEVENLABS_API_KEY"


def test_tts_provider_choice():
    eleven = {"ELEVENLABS_API_KEY": "k", "ELEVENLABS_VOICE_ID": "v"}
    assert voice.tts_provider({}) == "deepgram"
    assert voice.tts_provider(eleven) == "elevenlabs"
    assert voice.tts_provider({**eleven, "VOICE_TTS": "deepgram"}) == "deepgram"
    assert voice.tts_provider({"ELEVENLABS_API_KEY": "k"}) == "deepgram"  # no voice id yet

from contextlib import contextmanager


@contextmanager
def socket(app):
    """A test WebSocket client. When the server ends the session first, Starlette's portal can raise
    CancelledError as the client closes; every assertion has already run by then, so that is not a failure."""
    from concurrent.futures import CancelledError
    from fastapi.testclient import TestClient
    try:
        with TestClient(app).websocket_connect("/v") as ws:
            yield ws
    except CancelledError:
        pass


def test_websocket_end_to_end_with_stub_services(monkeypatch):
    """Real FastAPI socket + real Pipecat transport/serializer; only STT/TTS (paid services) are stubbed."""
    from fastapi import FastAPI, WebSocket
    from fastapi.testclient import TestClient
    from pipecat.frames.frames import InputAudioRawFrame, TTSAudioRawFrame
    from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

    class StubSTT(FrameProcessor):
        done = False

        async def process_frame(self, frame, direction):
            await super().process_frame(frame, direction)
            if isinstance(frame, InputAudioRawFrame) and not self.done:
                self.done = True
                await self.push_frame(transcription("Vexa, hello there"))
            elif not isinstance(frame, InputAudioRawFrame):
                await self.push_frame(frame, direction)

    class StubTTS(FrameProcessor):
        async def process_frame(self, frame, direction):
            await super().process_frame(frame, direction)
            if isinstance(frame, TTSSpeakFrame):
                await self.push_frame(TTSAudioRawFrame(audio=b"\x01\x00" * 24000, sample_rate=24000, num_channels=1))
            else:
                await self.push_frame(frame, direction)

    async def fake_decide(body, env, slots):
        return {"action": "none", "message": "", "engine": "local"}

    async def fake_converse(body, decision, env, slots):
        return "Hello. I'm listening."

    monkeypatch.setattr(voice, "decide", fake_decide)
    monkeypatch.setattr(voice, "converse", fake_converse)
    app = FastAPI()

    @app.websocket("/v")
    async def v(ws: WebSocket):
        await ws.accept()
        await ws.receive_json()
        await voice.run_voice(ws, {}, asyncio.Semaphore(2), stt=StubSTT(), tts=StubTTS())

    with socket(app) as ws:
        ws.send_json({"hello": 1})
        assert ws.receive_json()["type"] == "ready"
        ws.send_bytes(b"\x00\x00" * 320)
        seen, audio = [], 0
        for _ in range(12):
            msg = ws.receive()
            if msg.get("bytes"):
                audio += len(msg["bytes"])
                if "assistant" in seen:
                    break
            elif msg.get("text"):
                seen.append(json.loads(msg["text"])["type"])
        assert seen[:4] == ["result", "affect", "decision", "assistant"] and audio > 0


def socket_app(stt, tts, monkeypatch):
    from fastapi import FastAPI, WebSocket

    async def fake_decide(body, env, slots):
        return {"action": "none", "message": "", "engine": "local"}

    async def fake_converse(body, decision, env, slots, trigger=None):
        return "Hello."

    monkeypatch.setattr(voice, "decide", fake_decide)
    monkeypatch.setattr(voice, "converse", fake_converse)
    app = FastAPI()

    @app.websocket("/v")
    async def v(ws: WebSocket):
        await ws.accept()
        await ws.receive_json()
        await voice.run_voice(ws, {}, asyncio.Semaphore(2), stt=stt, tts=tts)

    return app


def passthrough(name):
    from pipecat.processors.frame_processor import FrameProcessor

    class P(FrameProcessor):
        async def process_frame(self, frame, direction):
            await super().process_frame(frame, direction)
            await self.push_frame(frame, direction)
    P.__name__ = name
    return P()


def test_control_messages_reach_the_assistant_through_the_real_socket(monkeypatch):
    """Regression: Pipecat's RTVI layer used to swallow every non-RTVI browser message (context, say, stop)."""
    from fastapi.testclient import TestClient
    from pipecat.frames.frames import TTSAudioRawFrame
    from pipecat.processors.frame_processor import FrameProcessor

    class StubTTS(FrameProcessor):
        async def process_frame(self, frame, direction):
            await super().process_frame(frame, direction)
            if isinstance(frame, TTSSpeakFrame):
                await self.push_frame(TTSAudioRawFrame(audio=b"\x01\x00" * 24000, sample_rate=24000, num_channels=1))
            else:
                await self.push_frame(frame, direction)

    app = socket_app(passthrough("PassSTT"), StubTTS(), monkeypatch)
    from concurrent.futures import CancelledError
    try:
        with socket(app) as ws:
            ws.send_json({"hello": 1})
            assert ws.receive_json()["type"] == "ready"
            ws.send_text(json.dumps({"type": "say", "text": "Want to check in?"}))
            seen, audio = [], 0
            for _ in range(10):
                msg = ws.receive()
                if msg.get("bytes"):
                    audio += len(msg["bytes"])
                    break
                seen.append(json.loads(msg["text"]))
            assert seen == [{"type": "assistant", "text": "Want to check in?"}] and audio > 0
            ws.send_text(json.dumps({"type": "stop"}))  # ends the session instead of hanging
            for _ in range(60):
                if ws.receive()["type"] == "websocket.close":
                    break
            else:
                raise AssertionError("session did not end after stop")
    except CancelledError:
        pass  # the server had already finished when the client closed: not a failure


def test_a_refused_service_is_reported_not_silent(monkeypatch):
    from fastapi.testclient import TestClient
    from pipecat.frames.frames import InputAudioRawFrame
    from pipecat.processors.frame_processor import FrameProcessor

    class RefusedSTT(FrameProcessor):
        async def process_frame(self, frame, direction):
            await super().process_frame(frame, direction)
            if isinstance(frame, InputAudioRawFrame):
                await self.push_error("401 key=secret-value", force_treat_as_permanent=True)

    app = socket_app(RefusedSTT(), passthrough("PassTTS"), monkeypatch)
    with socket(app) as ws:
        ws.send_json({"hello": 1})
        assert ws.receive_json()["type"] == "ready"
        ws.send_bytes(b"\x00\x00" * 320)
        error = None
        for _ in range(10):
            msg = ws.receive()
            if msg["type"] == "websocket.close":
                break
            if msg.get("text"):
                error = json.loads(msg["text"])
                break
        assert error and error["type"] == "error" and "Speech recognition was refused" in error["message"]
        assert "secret-value" not in error["message"]
