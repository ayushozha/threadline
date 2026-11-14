"""MiniMax music generation adapter.

Official docs: https://platform.minimax.io/docs/api-reference/music-generation
POST {base}/v1/music_generation, Authorization: Bearer <key>. With is_instrumental=true the
prompt is required and lyrics are not. Default output_format is hex: data.audio is hex-encoded
audio; base_resp.status_code 0 means success. The prompt is built from the mood only; no user
text is sent.
"""

import asyncio
import base64
import binascii
import os
from typing import Literal

import httpx
from fastapi import HTTPException
from pydantic import BaseModel

DEFAULT_API_BASE = "https://api.minimax.io"  # Global host shown in the docs; China host is api.minimaxi.com.
MAX_AUDIO_BYTES = 15 * 1024 * 1024
TIMEOUT = httpx.Timeout(150, connect=15)

MOOD_PROMPTS = {
    "calm": "Instrumental ambient, calm, soft piano and warm pads, slow tempo, gentle and spacious",
    "steady": "Instrumental lo-fi, steady, even mid tempo groove, mellow keys and light drums, focused",
    "uplifting": "Instrumental acoustic pop, uplifting, bright guitar and light percussion, hopeful, warm",
}


class MusicRequest(BaseModel):
    mood: Literal["calm", "steady", "uplifting"]


def build_payload(mood: str, model: str) -> dict:
    return {
        "model": model,
        "prompt": MOOD_PROMPTS[mood],
        "is_instrumental": True,
        "output_format": "hex",
        "audio_setting": {"sample_rate": 44100, "bitrate": 128000, "format": "mp3"},
    }


def _decode_hex(audio: str) -> bytes:
    if len(audio) > MAX_AUDIO_BYTES * 2:
        raise HTTPException(502, "MiniMax audio exceeded the 15 MB limit.")
    return binascii.unhexlify(audio)


async def _fetch_url(client: httpx.AsyncClient, url: str) -> tuple[bytes, str | None]:
    if not url.startswith("https://"):
        raise HTTPException(502, "MiniMax returned an unexpected audio link.")
    chunks, size = [], 0
    async with client.stream("GET", url) as response:
        response.raise_for_status()
        async for chunk in response.aiter_bytes():
            size += len(chunk)
            if size > MAX_AUDIO_BYTES:
                raise HTTPException(502, "MiniMax audio exceeded the 15 MB limit.")
            chunks.append(chunk)
        mime = response.headers.get("content-type", "").split(";")[0] or None
    return b"".join(chunks), mime


async def generate_music(body: MusicRequest, slots: asyncio.Semaphore) -> dict:
    key, model = os.getenv("MINIMAX_API_KEY"), os.getenv("MINIMAX_MUSIC_MODEL")
    if not key or not model:
        raise HTTPException(503, "Set MINIMAX_API_KEY and MINIMAX_MUSIC_MODEL to generate music.")
    base = (os.getenv("MINIMAX_API_BASE") or DEFAULT_API_BASE).rstrip("/")
    try:
        async with slots, httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.post(
                f"{base}/v1/music_generation",
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json=build_payload(body.mood, model),
            )
            response.raise_for_status()
            result = response.json()
            status = (result.get("base_resp") or {}).get("status_code")
            if status != 0:
                raise HTTPException(502, f"MiniMax music request failed (status {status}). Check model access and try again.")
            audio = (result.get("data") or {}).get("audio")
            if not audio or not isinstance(audio, str):
                raise HTTPException(502, "MiniMax returned no audio. Please retry.")
            mime = "audio/mpeg"
            if audio.startswith("https://"):
                raw, fetched_mime = await _fetch_url(client, audio)
                mime = fetched_mime if fetched_mime and fetched_mime.startswith("audio/") else mime
            else:
                raw = _decode_hex(audio)
    except HTTPException:
        raise
    except httpx.HTTPStatusError as exc:
        raise HTTPException(502, f"MiniMax request failed ({exc.response.status_code}). Check server configuration.") from None
    except (httpx.RequestError, binascii.Error, ValueError, TypeError, AttributeError):
        raise HTTPException(502, "MiniMax music unavailable. Please retry.") from None
    if not raw:
        raise HTTPException(502, "MiniMax returned empty audio. Please retry.")
    return {"provider": "minimax", "model": model, "mime": mime, "audio_b64": base64.b64encode(raw).decode()}
