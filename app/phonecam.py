"""iPhone as a live camera: the dashboard pairs a phone, the phone page (/static/phone.html) posts JPEG frames,
and the dashboard and a Gemini Live session ({"vision": "phone", "code": ...}) read the latest frame.

POST /api/phonecam/pair                 (dashboard session) -> {code, url, expires_in}
POST /api/phonecam/frame?c=&k=          (phone, no session: auth is code + secret) raw image/jpeg <= 400 KB, <= 4 fps
GET  /api/phonecam/latest.jpg?c=        (same owner as the pairing) latest frame, no-store; 404 if none
GET  /api/phonecam/status?c=            (same owner) {live, fps, at, age_s}

Pairings and frames live in memory only and expire after 2 hours; nothing is written to disk."""

import os
import secrets
import time
from collections import deque
from dataclasses import dataclass, field

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import Response

router = APIRouter()

TTL = 2 * 3600
MAX_BYTES = 400 * 1024
MIN_BYTES = 256
MAX_FPS = 4
LIVE_SECONDS = 5.0
FPS_WINDOW = 5.0
MAX_PAIRINGS = 200
CAMERA = "iPhone camera"


def authorize(request: Request, x_app_token: str = Header(default="")) -> None:
    from app.main import authorize as main_authorize
    main_authorize(request, x_app_token)


def owner_of(request) -> str:
    from app.videos import owner_of as videos_owner_of  # lazy: videos imports live_gemini, which imports this module
    return videos_owner_of(request)


def now() -> float:
    return time.monotonic()


def wall() -> float:
    return time.time()


@dataclass(frozen=True)
class Frame:
    jpeg: bytes
    at: float  # monotonic
    wall: float  # unix seconds, for display
    seq: int
    camera: str = CAMERA


@dataclass
class Pairing:
    code: str
    secret: str
    owner: str
    expires: float
    frame: Frame | None = None
    seq: int = 0
    posts: deque = field(default_factory=lambda: deque(maxlen=MAX_FPS))  # rate limit window
    recent: deque = field(default_factory=lambda: deque(maxlen=64))  # accepted frame times, for fps


pairings: dict[str, Pairing] = {}


def reset() -> None:
    pairings.clear()


def prune(t: float | None = None) -> None:
    t = now() if t is None else t
    for code, p in list(pairings.items()):
        if p.expires <= t:
            del pairings[code]


def get(code: object) -> Pairing | None:
    if not isinstance(code, str) or len(code) != 6 or not code.isdigit():
        return None
    prune()
    return pairings.get(code)


def fresh(p: Pairing | None) -> Frame | None:
    """The pairing's latest frame if it is at most LIVE_SECONDS old."""
    frame = p.frame if p else None
    return frame if frame is not None and now() - frame.at <= LIVE_SECONDS else None


def fps(p: Pairing) -> float:
    t = now()
    count = sum(1 for at in p.recent if t - at <= FPS_WINDOW)
    return round(count / FPS_WINDOW, 1)


def source_for(code: object, owner: str):
    """For the Gemini Live relay: a zero-argument function returning the fresh frame for this code, or None when
    the code is unknown or belongs to someone else."""
    p = get(code)
    if p is None or not secrets.compare_digest(p.owner.encode(), owner.encode()):
        return None
    return lambda: fresh(p) if get(p.code) is p else None


def public_base(request: Request) -> str:
    return (os.environ.get("APP_PUBLIC_ORIGIN") or str(request.base_url)).rstrip("/")


def viewer(request: Request, x_app_token: str) -> str:
    """Authenticate a dashboard read without charging the guest request budget (the card polls a few times a
    second). Same rules as main.authorize, then the caller's owner id."""
    from app import main
    if main.trusted_local(request.client.host if request.client else None, request.headers.get("host", "")):
        return owner_of(request)
    expected = os.getenv("APP_ACCESS_TOKEN", "")
    if not expected:
        raise HTTPException(503, "Set APP_ACCESS_TOKEN in the server environment.")
    if x_app_token and secrets.compare_digest(x_app_token.encode(), expected.encode()):
        return owner_of(request)
    if request.cookies.get(main.GUEST_COOKIE) and main.guest_enabled():
        if not main.same_guest_origin(request, required=False):
            raise HTTPException(403, "Use the configured app origin.")
        if main.get_guest(request):
            return owner_of(request)
    raise HTTPException(401, "Demo session missing or expired. Reload the page, or use an operator token.")


def owned(request: Request, code: str, x_app_token: str) -> Pairing:
    owner = viewer(request, x_app_token)
    p = get(code)
    if p is None or not secrets.compare_digest(p.owner.encode(), owner.encode()):
        raise HTTPException(404, "No such phone camera. Pair the iPhone again.")
    return p


@router.post("/api/phonecam/pair", dependencies=[Depends(authorize)])
async def pair(request: Request):
    owner, t = owner_of(request), now()
    prune(t)
    for p in pairings.values():  # one pairing per owner: reopening the card shows the same code
        if p.owner == owner:
            break
    else:
        if len(pairings) >= MAX_PAIRINGS:
            raise HTTPException(429, "Too many phone cameras are paired. Please try later.")
        code = f"{secrets.randbelow(900000) + 100000}"
        while code in pairings:
            code = f"{secrets.randbelow(900000) + 100000}"
        p = Pairing(code=code, secret=secrets.token_hex(16), owner=owner, expires=t + TTL)
        pairings[code] = p
    url = f"{public_base(request)}/static/phone.html?c={p.code}&k={p.secret}"
    return {"code": p.code, "url": url, "expires_in": max(0, int(p.expires - t))}


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


@router.post("/api/phonecam/frame")
async def post_frame(request: Request, c: str = "", k: str = ""):
    p = get(c)
    if p is None:
        raise HTTPException(404, "This pairing expired. Scan the new QR code on the dashboard.")
    if not secrets.compare_digest(k.encode(), p.secret.encode()):
        raise HTTPException(403, "Wrong pairing link. Scan the QR code on the dashboard again.")
    t = now()
    if len(p.posts) >= MAX_FPS and t - p.posts[0] < 1.0:
        raise HTTPException(429, f"Too many frames (max {MAX_FPS} per second).")
    if request.headers.get("content-type", "").split(";")[0].strip().lower() != "image/jpeg":
        raise HTTPException(415, "Send raw JPEG bytes with Content-Type image/jpeg.")
    data = await read_capped(request)
    if len(data) < MIN_BYTES or not data.startswith(b"\xff\xd8\xff"):
        raise HTTPException(400, "Body is not a JPEG.")
    p.posts.append(t)
    p.recent.append(t)
    p.seq += 1
    p.frame = Frame(data, t, wall(), p.seq)
    return {"ok": True, "bytes": len(data), "seq": p.seq}


@router.get("/api/phonecam/latest.jpg")
async def latest_jpg(request: Request, c: str = "", x_app_token: str = Header(default="")):
    p = owned(request, c, x_app_token)
    if p.frame is None:
        raise HTTPException(404, "No frame from the iPhone yet.")
    return Response(p.frame.jpeg, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@router.get("/api/phonecam/status")
async def status(request: Request, c: str = "", x_app_token: str = Header(default="")):
    p = owned(request, c, x_app_token)
    frame = fresh(p)
    return {"live": frame is not None, "fps": fps(p), "at": p.frame.wall if p.frame else None,
            "age_s": round(now() - p.frame.at, 2) if p.frame else None, "camera": CAMERA}
