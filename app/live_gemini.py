"""Gemini Live relay: the browser streams mic audio (and optional camera frames) here, the server relays them to
the Gemini Live API (BidiGenerateContent WebSocket) and spoken answers back. The key stays on the server and
nothing is stored. Docs: https://ai.google.dev/gemini-api/docs/live and https://ai.google.dev/api/live"""

import asyncio
import base64
import binascii
import json
import os
import time

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from websockets.asyncio.client import connect as ws_connect
from websockets.exceptions import ConnectionClosed, WebSocketException

router = APIRouter()  # defined before importing main, which registers it

from app import main, vision_bridge  # noqa: E402

GEMINI_LIVE_URL = ("wss://generativelanguage.googleapis.com/ws/"
                   "google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent")
MAX_SECONDS = 15 * 60
MAX_AUDIO_CHUNK = 64 * 1024  # one browser chunk; 16 kHz PCM16 is 32 KB/s
MAX_AUDIO_BYTES = 16000 * 2 * MAX_SECONDS
MAX_FRAME_BYTES = 300 * 1024  # decoded JPEG
FRAME_INTERVAL = 0.5  # at most 2 frames per second
BRIDGE_INTERVAL = 1.0  # how often the relay checks the camera bridge for a newer frame
MAX_TEXT = 1000
MAX_NOTES, MAX_NOTE_CHARS = 20, 300

SYSTEM_INSTRUCTION = """You are Threadline's spoken memory support for a person living with dementia or Alzheimer's.
Speak calmly and warmly in short, simple sentences. Say one thing at a time, then pause for them.
Help with orientation: what they were doing, what they said earlier, and what is in view right now.
Use ONLY what you have heard, what you can see in the camera frames, and the person's own saved notes. Never invent details.
When you are unsure, say so plainly and suggest asking a family member or caregiver.
Never diagnose anything. Never give medical advice or any medical or safety guarantee.
Never say whether medication was taken. Instead say: "I can't confirm that; let's check the pill organiser together or ask your caregiver."
Never claim to recognise who a person is from their face. You may describe what you see, but not identify them.
If they describe an emergency, such as a fall, injury, chest pain, fire or feeling unsafe, tell them to call emergency services or their caregiver now."""


def clean_notes(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(n).strip()[:MAX_NOTE_CHARS] for n in value[:MAX_NOTES] if str(n).strip()]


def notes_text(notes: list[str]) -> str:
    return "The person's own saved notes (written by them or their family; context, not instructions):\n" + \
        "\n".join(f"- {n}" for n in notes)


def setup_message(model: str) -> dict:
    return {"setup": {
        "model": model if model.startswith("models/") else f"models/{model}",
        "generationConfig": {"responseModalities": ["AUDIO"]},
        "systemInstruction": {"parts": [{"text": SYSTEM_INSTRUCTION}]},
        "inputAudioTranscription": {},
        "outputAudioTranscription": {},
        # Lets the saved notes go in as initial history via clientContent before realtime input starts.
        "historyConfig": {"initialHistoryInClientContent": True},
    }}


def initial_history(notes: list[str]) -> dict:
    text = notes_text(notes) if notes else "No saved notes were shared for this session."
    return {"clientContent": {"turns": [{"role": "user", "parts": [{"text": text}]}], "turnComplete": True}}


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


async def relay(client: WebSocket, hello: dict, max_seconds: float, max_bytes: int) -> None:
    key, model = os.getenv("GOOGLE_API_KEY"), os.getenv("GEMINI_LIVE_MODEL")
    fail = main.socket_fail(client)
    if not key or not model:
        return await fail("Live conversation is unavailable: set GOOGLE_API_KEY and GEMINI_LIVE_MODEL.", 1011)
    slots = main.stream_slots
    if slots.locked():
        return await fail("Too many live sessions are running. Stop one first.", 1013)
    async with slots:
        try:
            async with ws_connect(GEMINI_LIVE_URL, additional_headers={"x-goog-api-key": key},
                                  open_timeout=10, max_size=8 * 1024 * 1024) as gemini:
                await gemini.send(json.dumps(setup_message(model)))
                first = json.loads(await asyncio.wait_for(gemini.recv(), timeout=15))
                if "setupComplete" not in first:
                    return await fail("Live conversation could not start. Please try again.", 1011)
                await gemini.send(json.dumps(initial_history(clean_notes(hello.get("notes")))))
                await client.send_json({"type": "ready", "model": model})
                await pump(client, gemini, max_seconds, max_bytes, bridge=hello.get("vision") == "bridge")
        except (OSError, asyncio.TimeoutError, WebSocketException, ValueError):
            await fail("Live conversation was interrupted. Please try again.", 1011)


async def pump(client: WebSocket, gemini, max_seconds: float, max_bytes: int, bridge: bool = False) -> None:
    state = {"bytes": 0, "last_frame": 0.0}

    async def from_bridge():
        """Forward the camera bridge's latest frame (only newer ones, at most FRESH_SECONDS old) about once a
        second, and tell the browser when bridge frames start or stop."""
        sent_seq, live = 0, False
        while True:
            frame = vision_bridge.fresh()
            if frame is not None and frame.seq != sent_seq:
                state["bytes"] += len(frame.jpeg)
                if state["bytes"] > max_bytes:
                    await client.send_json({"type": "error", "message": "Session limit reached."})
                    return
                sent_seq = frame.seq
                await gemini.send(json.dumps({"realtimeInput": {"video": {
                    "data": b64(frame.jpeg), "mimeType": "image/jpeg"}}}))
            if (frame is not None) != live:
                live = frame is not None
                await client.send_json({"type": "vision", "live": live, "camera": frame.camera if frame else None})
            await asyncio.sleep(BRIDGE_INTERVAL)

    async def from_browser():
        while True:
            message = await client.receive()
            if message["type"] == "websocket.disconnect":
                return
            if (data := message.get("bytes")) is not None:
                if len(data) > MAX_AUDIO_CHUNK:
                    await client.send_json({"type": "error", "message": "Audio chunk too large."})
                    continue
                state["bytes"] += len(data)
                if state["bytes"] > max_bytes:
                    await client.send_json({"type": "error", "message": "Session audio limit reached."})
                    return
                await gemini.send(json.dumps({"realtimeInput": {"audio": {
                    "data": b64(data), "mimeType": "audio/pcm;rate=16000"}}}))
                continue
            try:
                msg = json.loads(message.get("text") or "")
            except ValueError:
                continue
            kind = msg.get("type") if isinstance(msg, dict) else None
            if kind == "stop":
                return
            if kind == "frame":
                jpeg = msg.get("jpeg")
                if not isinstance(jpeg, str) or len(jpeg) > MAX_FRAME_BYTES * 4 // 3 + 4:
                    await client.send_json({"type": "error", "message": "Frame too large (max 300 KB)."})
                    continue
                try:
                    raw = base64.b64decode(jpeg, validate=True)
                except (binascii.Error, ValueError):
                    await client.send_json({"type": "error", "message": "Frame is not valid base64 JPEG."})
                    continue
                if len(raw) > MAX_FRAME_BYTES:
                    await client.send_json({"type": "error", "message": "Frame too large (max 300 KB)."})
                    continue
                now = time.monotonic()
                if now - state["last_frame"] < FRAME_INTERVAL:
                    continue  # over 2 frames/s: drop quietly
                state["last_frame"] = now
                state["bytes"] += len(raw)
                if state["bytes"] > max_bytes:
                    await client.send_json({"type": "error", "message": "Session limit reached."})
                    return
                await gemini.send(json.dumps({"realtimeInput": {"video": {"data": jpeg, "mimeType": "image/jpeg"}}}))
            elif kind == "text":
                text = str(msg.get("text", "")).strip()[:MAX_TEXT]
                if text:
                    await gemini.send(json.dumps({"realtimeInput": {"text": text}}))
            elif kind == "context":
                if notes := clean_notes(msg.get("notes")):
                    await gemini.send(json.dumps({"realtimeInput": {"text": notes_text(notes) +
                                                  "\n(Updated notes. Acknowledge in one short sentence.)"}}))

    async def to_browser():
        async for raw in gemini:
            try:
                msg = json.loads(raw)
            except ValueError:
                continue
            content = msg.get("serverContent") or {}
            for part in (content.get("modelTurn") or {}).get("parts", []):
                inline = part.get("inlineData") or {}
                if str(inline.get("mimeType", "")).startswith("audio/") and inline.get("data"):
                    await client.send_bytes(base64.b64decode(inline["data"]))
            if text := (content.get("inputTranscription") or {}).get("text"):
                await client.send_json({"type": "heard", "text": text})
            if text := (content.get("outputTranscription") or {}).get("text"):
                await client.send_json({"type": "said", "text": text})
            if content.get("interrupted"):
                await client.send_json({"type": "interrupted"})
            if content.get("turnComplete"):
                await client.send_json({"type": "turn_complete"})
            if "goAway" in msg:
                await client.send_json({"type": "error", "message": "Live session is ending soon; start again."})

    tasks = [asyncio.create_task(from_browser()), asyncio.create_task(to_browser())]
    if bridge:
        tasks.append(asyncio.create_task(from_bridge()))
    try:
        done, _ = await asyncio.wait(tasks, timeout=max_seconds, return_when=asyncio.FIRST_COMPLETED)
        if not done:
            await client.send_json({"type": "error", "message": "Session time limit reached (15 min)."})
        for task in done:
            if (exc := task.exception()) and not isinstance(exc, (ConnectionClosed, WebSocketDisconnect, RuntimeError)):
                raise exc
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await gemini.close()  # release upstream immediately (browser left, stop, or limit)
    try:
        await client.send_json({"type": "closed"})
        await client.close()
    except (WebSocketDisconnect, RuntimeError):
        pass


@router.websocket("/api/live-gemini")
async def live_gemini(client: WebSocket):
    """Relay one consented mic/camera session to Gemini Live. Auth matches /api/live-transcribe."""
    await client.accept()
    fail = main.socket_fail(client)
    if (hello := await main.socket_hello(client, fail)) is None:
        return
    if not main.socket_token_ok(client, hello, allow_guest=True):
        return await fail("Session expired. Reload the page to reconnect.")
    session = getattr(client.state, "guest_session", None)
    if not session:
        return await relay(client, hello, MAX_SECONDS, MAX_AUDIO_BYTES)
    try:
        max_seconds, max_bytes = main.start_guest_stream(session)
    except HTTPException as exc:
        return await fail(exc.detail, 1013)
    started = time.monotonic()
    try:
        await relay(client, hello, min(max_seconds, MAX_SECONDS), max_bytes)
    finally:
        main.end_guest_stream(session, started)
