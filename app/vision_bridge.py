"""Camera bridge: a local GoPro bridge (run by the demo owner) POSTs JPEG frames here with X-Publish-Key ==
DEMO_WATCH_KEY. Only the latest frame is kept, in memory only (never on disk); it is public while fresh and a
Gemini Live session that asks for "vision": "bridge" receives it as video input."""

import secrets
import time
from collections import deque
from dataclasses import dataclass

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response

from app import demo_feed

router = APIRouter()

MAX_BYTES = 400 * 1024
MIN_BYTES = 1024
MAX_PER_SECOND = 3
FRESH_SECONDS = 10.0
MAX_CAMERA = 60
DEFAULT_CAMERA = "GoPro"


@dataclass(frozen=True)
class Frame:
    jpeg: bytes
    at: float
    camera: str
    seq: int


latest: dict = {"frame": None, "seq": 0}
recent_posts: deque = deque(maxlen=MAX_PER_SECOND)


def now() -> float:
    return time.monotonic()


def fresh() -> Frame | None:
    """The latest frame if it is at most FRESH_SECONDS old."""
    frame = latest["frame"]
    return frame if frame is not None and now() - frame.at <= FRESH_SECONDS else None


def reset() -> None:
    latest["frame"], latest["seq"] = None, 0
    recent_posts.clear()


def clean_camera(value: str | None) -> str:
    text = "".join(ch for ch in (value or "") if ch.isprintable()).strip()[:MAX_CAMERA]
    return text or DEFAULT_CAMERA


async def read_capped(request: Request) -> bytes:
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_BYTES:
        raise HTTPException(413, f"Frame too large (max {MAX_BYTES // 1024} KB).")
    body = bytearray()
    async for chunk in request.stream():
        body += chunk
        if len(body) > MAX_BYTES:
            raise HTTPException(413, f"Frame too large (max {MAX_BYTES // 1024} KB).")
    return bytes(body)


@router.post("/api/vision/frame")
async def post_frame(request: Request):
    key = demo_feed.demo_key()
    if not key:
        raise HTTPException(503, "Camera bridge is not configured.")
    presented = request.headers.get("x-publish-key", "")
    if not secrets.compare_digest(presented.encode(), key.encode()):
        raise HTTPException(401, "Invalid publish key.")
    t = now()
    if len(recent_posts) >= MAX_PER_SECOND and t - recent_posts[0] < 1.0:
        raise HTTPException(429, "Too many frames (max 3 per second).")
    if request.headers.get("content-type", "").split(";")[0].strip().lower() != "image/jpeg":
        raise HTTPException(415, "Send raw JPEG bytes with Content-Type image/jpeg.")
    data = await read_capped(request)
    if len(data) < MIN_BYTES:
        raise HTTPException(400, "Frame too small (min 1 KB).")
    if not data.startswith(b"\xff\xd8"):
        raise HTTPException(400, "Body is not a JPEG.")
    recent_posts.append(t)
    latest["seq"] += 1
    latest["frame"] = Frame(data, t, clean_camera(request.headers.get("x-camera")), latest["seq"])
    return {"ok": True, "bytes": len(data)}


@router.get("/api/vision/latest.jpg")
async def latest_jpg():
    frame = fresh()
    if frame is None:
        raise HTTPException(404, "No recent camera frame.")
    return Response(frame.jpeg, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@router.get("/api/vision/status")
async def vision_status():
    frame = fresh()
    return {"live": frame is not None, "camera": frame.camera if frame else None,
            "age_s": round(now() - frame.at, 2) if frame else None}
