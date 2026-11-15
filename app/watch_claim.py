"""Device-code pairing for the Apple Watch: the watch asks for a code and shows it, the signed-in website
claims it. Uses the pairing registry in app.main; watch-started pairings also carry a watch_key that only the
watch knows, and they stay unclaimed (watch endpoints answer 403) until the website enters the code."""

import secrets
import time

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

from app import main

router = APIRouter()

START_LIMIT = 30  # starts per client IP ...
START_WINDOW = 600  # ... per 10 min
start_log: dict[str, list[float]] = {}
NOT_CLAIMED = "Not claimed yet — enter the code on the website."
UNKNOWN_CODE = "Unknown or expired pairing code. Create a new one on the website."
NO_WATCH = "No watch is showing that code. Open Threadline on the watch to get a new one."


# Stored as plain attributes on main.Pairing, so page-started pairings (no attributes) behave as before.
def watch_key(pairing) -> str:
    return getattr(pairing, "watch_key", "")


def claimed(pairing) -> bool:
    return getattr(pairing, "claimed", True)


def watch_gate(pairing, key: object) -> tuple[int, str] | None:
    """Checks a watch-side request. Page-started codes need only the code; watch-started codes also need
    the watch_key and must have been claimed."""
    if not pairing:
        return 401, UNKNOWN_CODE
    if not watch_key(pairing):
        return None
    if not isinstance(key, str) or not secrets.compare_digest(key.encode(), watch_key(pairing).encode()):
        return 401, UNKNOWN_CODE
    if not claimed(pairing):
        return 403, NOT_CLAIMED
    return None


def touch(pairing) -> None:
    """Activity on a claimed watch-started pairing keeps it alive for CLAIMED_TTL from now."""
    if watch_key(pairing) and claimed(pairing):
        pairing.expires = max(pairing.expires, time.monotonic() + main.CLAIMED_TTL)


def require_watch(code: str, key: str):
    pairing = main.find_pairing(code)
    if problem := watch_gate(pairing, key):
        raise HTTPException(*problem)
    touch(pairing)
    return pairing


def known_watch(code: str, key: str):
    """The watch-started pairing for this code and key, or 404."""
    pairing = main.find_pairing(code)
    if (not pairing or not watch_key(pairing) or pairing.expires < time.monotonic()
            or not secrets.compare_digest(key.encode(), watch_key(pairing).encode())):
        raise HTTPException(404, "Unknown or expired code. Get a new one.")
    touch(pairing)
    return pairing


class WatchStart(BaseModel):
    device: str = Field(default="", max_length=200)


class WatchClaim(BaseModel):
    code: str = Field(max_length=12)


@router.post("/api/watch/start")
async def watch_start(body: WatchStart, request: Request):
    """Called by the watch itself (no app token): returns a code to show and a key only the watch knows."""
    now = time.monotonic()
    for known in list(start_log):
        start_log[known] = [t for t in start_log[known] if now - t < START_WINDOW]
        if not start_log[known]:
            del start_log[known]
    recent = start_log.setdefault(request.client.host if request.client else "?", [])
    if len(recent) >= START_LIMIT:
        raise HTTPException(429, "Too many pairing requests. Try again in a few minutes.")
    main.prune_pairings()
    if len(main.pairings) >= main.MAX_PAIRINGS:
        raise HTTPException(429, "Too many pairing codes are active. Try again in a few minutes.")
    recent.append(now)
    code = f"{secrets.randbelow(10**6):06d}"
    while code in main.pairings:
        code = f"{secrets.randbelow(10**6):06d}"
    pairing = main.Pairing(expires=now + main.PAIR_TTL, device=(body.device.strip() or "Apple Watch")[:60])
    pairing.watch_key = secrets.token_urlsafe(32)
    pairing.claimed = False
    main.pairings[code] = pairing
    return {"code": code, "watch_key": pairing.watch_key, "expires_in": main.PAIR_TTL}


@router.get("/api/watch/status")
async def watch_status(x_watch_code: str = Header(default=""), x_watch_key: str = Header(default="")):
    pairing = known_watch(x_watch_code, x_watch_key)
    return {"claimed": claimed(pairing), "expires_in": max(0, int(pairing.expires - time.monotonic()))}


@router.post("/api/watch/resume")
async def watch_resume(x_watch_code: str = Header(default=""), x_watch_key: str = Header(default="")):
    """Called by the watch on relaunch with its saved code and key. 404 means: start a fresh code."""
    pairing = known_watch(x_watch_code, x_watch_key)
    return {"claimed": claimed(pairing), "expires_in": max(0, int(pairing.expires - time.monotonic()))}


@router.post("/api/watch/claim", dependencies=[Depends(main.authorize)])
async def watch_claim(body: WatchClaim):
    pairing = main.find_pairing(body.code.replace(" ", ""))
    if not pairing or not watch_key(pairing) or claimed(pairing) or pairing.expires < time.monotonic():
        raise HTTPException(404, NO_WATCH)
    pairing.claimed = True
    pairing.expires = time.monotonic() + main.CLAIMED_TTL
    return {"ok": True, "device": pairing.device or "Apple Watch"}
