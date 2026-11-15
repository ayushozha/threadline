"""Recorded videos: uploaded clips saved under <dir of THREADLINE_DB_PATH>/videos/<id>.<ext>, listed in the
library and reasoned on by Gemini (the browser grabs frames and posts the analysis back).

POST /api/videos?title=&mode=   raw body, Content-Type video/mp4|webm|quicktime, at most 60 MB
GET  /api/videos                newest 50
GET  /api/videos/{id}/file      the clip
POST /api/videos/{id}/analysis  save a /api/scenario/reason result
"""

import hashlib
import json
import os
import re
import secrets
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse

from app import store
from app.live_gemini import MODE_INSTRUCTIONS
from app.scenario_agent import authorize

router = APIRouter()
MAX_BYTES = 60 * 1024 * 1024
MIME_EXT = {"video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov"}
ID_RE = re.compile(r"^[a-f0-9]{24}$")


def video_dir() -> Path:
    path = os.getenv("THREADLINE_DB_PATH", "").strip()
    d = Path(path).parent / "videos" if path else Path("data") / "videos"
    d.mkdir(parents=True, exist_ok=True)
    return d


def need_store() -> store.Store:
    s = store.get()
    if s is None:
        raise HTTPException(503, "Video storage is not available on this server.")
    return s


def owner_of(request: Request) -> str:
    """Each guest session sees only its own recordings; the operator (token, no cookie) has its own space."""
    from app.main import GUEST_COOKIE
    token = request.cookies.get(GUEST_COOKIE, "")
    return "guest:" + hashlib.sha256(token.encode()).hexdigest()[:32] if token else "operator"


def check_id(vid: str) -> str:
    if not ID_RE.fullmatch(vid):
        raise HTTPException(404, "No such video.")
    return vid


@router.post("/api/videos", dependencies=[Depends(authorize)])
async def upload_video(request: Request, title: str = "", mode: str = "memory"):
    mime = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if mime not in MIME_EXT:
        raise HTTPException(415, "Send an MP4, WebM or QuickTime video.")
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_BYTES:
        raise HTTPException(413, "Video is larger than 60 MB.")
    s = need_store()
    vid = secrets.token_hex(12)
    path = video_dir() / f"{vid}.{MIME_EXT[mime]}"
    size = 0
    try:
        with path.open("wb") as fh:
            async for chunk in request.stream():
                size += len(chunk)
                if size > MAX_BYTES:
                    raise HTTPException(413, "Video is larger than 60 MB.")
                fh.write(chunk)
        if size == 0:
            raise HTTPException(400, "Empty video.")
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    title = re.sub(r"\s+", " ", title).strip()[:120] or "My recording"
    return s.add_video(vid, title, mode if mode in MODE_INSTRUCTIONS else "memory", mime, size, owner_of(request))


@router.get("/api/videos", dependencies=[Depends(authorize)])
def list_videos(request: Request):
    return {"videos": need_store().videos(50, owner_of(request))}


@router.get("/api/videos/{vid}/file", dependencies=[Depends(authorize)])
def video_file(vid: str, request: Request):
    row = need_store().video(check_id(vid), owner_of(request))
    path = video_dir() / f"{vid}.{MIME_EXT.get(row['mime'], 'mp4')}" if row else None
    if not path or not path.is_file():
        raise HTTPException(404, "No such video.")
    return FileResponse(path, media_type=row["mime"])


@router.post("/api/videos/{vid}/analysis", dependencies=[Depends(authorize)])
async def save_analysis(vid: str, request: Request):
    check_id(vid)
    raw = await request.body()
    if len(raw) > 20_000:
        raise HTTPException(413, "Analysis is too large.")
    try:
        analysis = json.loads(raw)
    except ValueError as exc:
        raise HTTPException(400, "Send the analysis as JSON.") from exc
    if not isinstance(analysis, dict) or not isinstance(analysis.get("vision"), dict) or not isinstance(analysis.get("decision"), dict):
        raise HTTPException(400, "Analysis needs vision and decision objects.")
    if not need_store().set_video_analysis(vid, analysis, owner_of(request)):
        raise HTTPException(404, "No such video.")
    return {"ok": True}
