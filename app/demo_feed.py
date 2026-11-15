"""Public demo feed: one claimed watch-started pairing that presents DEMO_WATCH_KEY publishes its validated
sensor frames to anyone viewing the demo. Only sensors frames go out (never transcripts, cycle dates, audio,
mood commands or haptics), and only the last frame is kept, in memory."""

import asyncio
import os
import secrets
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app import main, watch_claim

router = APIRouter()

DEMO_KEY_MIN = 24
DEMO_IDLE_SECONDS = 30  # report the demo watch quiet after this long without a frame
MAX_SUBSCRIBERS = 200

subscribers: set = set()
state: dict = {"publisher": None, "last": None, "at": 0.0, "live": False, "device": None, "task": None}


def demo_key() -> str:
    key = os.getenv("DEMO_WATCH_KEY", "").strip()
    return key if len(key) >= DEMO_KEY_MIN else ""


def key_ok(presented: object) -> bool:
    key = demo_key()
    return bool(key) and isinstance(presented, str) and secrets.compare_digest(presented.encode(), key.encode())


def apply(pairing, presented: object) -> None:
    """Called after the watch gate passed. The correct key on a claimed watch-started pairing makes it the
    publisher (latest wins); a request from the publisher without the key stops it publishing."""
    if key_ok(presented) and watch_claim.watch_key(pairing) and watch_claim.claimed(pairing):
        previous = state["publisher"]
        if previous is not None and previous is not pairing:
            previous.demo = False
        pairing.demo = True
        state["publisher"] = pairing
    elif getattr(pairing, "demo", False):
        pairing.demo = False
        if state["publisher"] is pairing:
            state["publisher"] = None


def is_live() -> bool:
    return bool(demo_key()) and state["live"] and time.monotonic() - state["at"] < DEMO_IDLE_SECONDS


def status() -> dict:
    live = is_live()
    return {"type": "demo_status", "live": live, "device": state["device"] if live else None,
            "last": state["last"] if demo_key() else None}


async def broadcast(message: dict) -> None:
    for socket in list(subscribers):
        try:
            await socket.send_json(message)
        except (WebSocketDisconnect, RuntimeError):
            subscribers.discard(socket)


async def watchdog() -> None:
    try:
        while time.monotonic() - state["at"] < DEMO_IDLE_SECONDS:
            await asyncio.sleep(1)
    finally:
        state["live"] = False
        await broadcast(status())


async def publish(pairing, frame: dict) -> None:
    """frame is the already-validated sensors frame (clean_sensors output)."""
    if not getattr(pairing, "demo", False) or state["publisher"] is not pairing or not demo_key():
        return
    if frame.get("type") != "sensors":
        return
    out = {**frame, "demo": True}
    state["last"], state["at"], state["device"] = out, time.monotonic(), out.get("device")
    if not state["live"]:
        state["live"] = True
        await broadcast(status())
    task = state["task"]
    if task is None or task.done():
        state["task"] = asyncio.get_running_loop().create_task(watchdog())
        main.background.add(state["task"])
        state["task"].add_done_callback(main.background.discard)
    await broadcast(out)


@router.get("/api/demo/latest")
async def demo_latest():
    data = status()
    data.pop("type")
    return data


@router.websocket("/api/demo/feed")
async def demo_feed(client: WebSocket):
    """Public: no token or cookie. Receives demo_status, then the demo watch's sensors frames."""
    await client.accept()
    if len(subscribers) >= MAX_SUBSCRIBERS:
        return await client.close(code=1013)
    try:
        await client.send_json(status())
        subscribers.add(client)
        while (await client.receive())["type"] != "websocket.disconnect":
            pass  # incoming messages are ignored
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        subscribers.discard(client)
