"""Server-side keeping of captured audio and transcripts, for operators only.

Layout under THREADLINE_DATA_DIR (default ./data):
    <id>.json    metadata (device, source, times, sizes), rewritten when a recording closes
    <id>.jsonl   one final transcript result per line, appended as they arrive
    <id>.events.jsonl  detections made on the server meanwhile (affect readings, low-energy triggers)
    <id>.pkt     band audio: raw Opus packets, each prefixed by a 2-byte big-endian length
    <id>.webm    browser-microphone audio exactly as the browser's MediaRecorder sent it

Band packets are wrapped into an Ogg Opus file only when someone downloads them, so a crash
never leaves a half-written container. Everything older than THREADLINE_RETENTION_DAYS is
deleted, and new recordings are refused once the folder passes THREADLINE_MAX_STORE_MB.
"""
from __future__ import annotations

import json
import os
import re
import secrets
import struct
import time
from datetime import datetime, timezone
from pathlib import Path

ID_RE = re.compile(r"^r[0-9]{8}T[0-9]{6}-[0-9a-f]{8}$")
FRAME_SAMPLES_48K = 960  # the band sends 20 ms Opus packets; Ogg Opus counts granules at 48 kHz


def data_dir() -> Path:
    return Path(os.getenv("THREADLINE_DATA_DIR", "data")).resolve()


def retention_days() -> float:
    try:
        return float(os.getenv("THREADLINE_RETENTION_DAYS", "30"))
    except ValueError:
        return 30.0


def max_store_bytes() -> int:
    try:
        return int(float(os.getenv("THREADLINE_MAX_STORE_MB", "5000")) * 1024 * 1024)
    except ValueError:
        return 5000 * 1024 * 1024


def store_size() -> int:
    root = data_dir()
    return sum(p.stat().st_size for p in root.glob("r*") if p.is_file()) if root.exists() else 0


def valid_id(value: str) -> bool:
    return bool(ID_RE.match(value))


def purge_expired(now: float | None = None) -> int:
    """Delete recordings older than the retention window. Returns how many were removed."""
    root = data_dir()
    if not root.exists():
        return 0
    cutoff = (now or time.time()) - retention_days() * 86400
    removed = 0
    for meta in root.glob("r*.json"):
        if valid_id(meta.stem) and meta.stat().st_mtime < cutoff:
            delete(meta.stem)
            removed += 1
    return removed


def delete(rid: str) -> bool:
    if not valid_id(rid):
        return False
    found = False
    for path in data_dir().glob(f"{rid}.*"):
        path.unlink(missing_ok=True)
        found = True
    return found


class Recording:
    """One open recording: append audio and finals, then close()."""

    def __init__(self, source: str, device: str = "") -> None:
        root = data_dir()
        root.mkdir(parents=True, exist_ok=True)
        if store_size() >= max_store_bytes():
            raise OSError("The server's recording storage is full. Delete old recordings first.")
        now = datetime.now(timezone.utc)
        self.id = f"r{now:%Y%m%dT%H%M%S}-{secrets.token_hex(4)}"
        self.source = source
        self.device = device[:80]
        self.started = now
        self.bytes = 0
        self.lines = 0
        self.audio_ext = "pkt" if source == "vexo" else "webm" if source == "browser" else "raw"
        self._audio = open(root / f"{self.id}.{self.audio_ext}", "ab")
        self._lines = open(root / f"{self.id}.jsonl", "a", encoding="utf-8")
        self._events = open(root / f"{self.id}.events.jsonl", "a", encoding="utf-8")
        self._write_meta(ended=None)

    def audio(self, data: bytes) -> None:
        if self.source == "vexo":
            if not 0 < len(data) < 65536:
                return
            self._audio.write(struct.pack(">H", len(data)))
        self._audio.write(data)
        self.bytes += len(data)

    def final(self, result: dict) -> None:
        if result.get("type") != "result" or not result.get("is_final") or not str(result.get("transcript", "")).strip():
            return
        keep = {k: result.get(k) for k in ("start", "duration", "transcript", "words")}
        self._lines.write(json.dumps(keep, ensure_ascii=False) + "\n")
        self._lines.flush()
        self.lines += 1

    def event(self, message: dict) -> None:
        """A server-side detection (affect reading or trigger) made while recording. The baseline state is left out."""
        keep = {k: v for k, v in message.items() if k != "state"}
        self._events.write(json.dumps(keep, ensure_ascii=False) + "\n")
        self._events.flush()

    def _write_meta(self, ended: datetime | None) -> None:
        meta = {"id": self.id, "source": self.source, "device": self.device, "audio": self.audio_ext,
                "started_at": self.started.isoformat(), "ended_at": ended.isoformat() if ended else None,
                "bytes": self.bytes, "lines": self.lines}
        tmp = data_dir() / f"{self.id}.json.tmp"
        tmp.write_text(json.dumps(meta), encoding="utf-8")
        tmp.replace(data_dir() / f"{self.id}.json")

    def close(self) -> None:
        for handle in (self._audio, self._lines, self._events):
            try:
                handle.close()
            except OSError:
                pass
        self._write_meta(ended=datetime.now(timezone.utc))


def list_recordings() -> list[dict]:
    root = data_dir()
    if not root.exists():
        return []
    out = []
    for meta in root.glob("r*.json"):
        if not valid_id(meta.stem):
            continue
        try:
            out.append(json.loads(meta.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            continue
    return sorted(out, key=lambda m: m.get("started_at", ""), reverse=True)


def read_recording(rid: str) -> dict | None:
    if not valid_id(rid):
        return None
    meta_path = data_dir() / f"{rid}.json"
    if not meta_path.exists():
        return None
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    lines = []
    lines_path = data_dir() / f"{rid}.jsonl"
    if lines_path.exists():
        for raw in lines_path.read_text(encoding="utf-8").splitlines():
            try:
                lines.append(json.loads(raw))
            except ValueError:
                continue  # a line cut off by a crash
    events = []
    events_path = data_dir() / f"{rid}.events.jsonl"
    if events_path.exists():
        for raw in events_path.read_text(encoding="utf-8").splitlines():
            try:
                events.append(json.loads(raw))
            except ValueError:
                continue
    return {**meta, "transcript": lines, "events": events}


# ---- Ogg Opus wrapper for band packets -------------------------------------------------

def _crc_table() -> list[int]:
    table = []
    for i in range(256):
        r = i << 24
        for _ in range(8):
            r = ((r << 1) ^ 0x04C11DB7) & 0xFFFFFFFF if r & 0x80000000 else (r << 1) & 0xFFFFFFFF
        table.append(r)
    return table


_CRC = _crc_table()


def ogg_crc(data: bytes) -> int:
    crc = 0
    for byte in data:
        crc = ((crc << 8) & 0xFFFFFFFF) ^ _CRC[((crc >> 24) & 0xFF) ^ byte]
    return crc


def ogg_page(serial: int, seq: int, granule: int, packets: list[bytes], flags: int = 0) -> bytes:
    segments = bytearray()
    for packet in packets:
        n = len(packet)
        segments += b"\xff" * (n // 255) + bytes([n % 255])
    if len(segments) > 255:
        raise ValueError("too many segments for one Ogg page")
    header = (b"OggS" + bytes([0, flags]) + struct.pack("<qIII", granule, serial, seq, 0)
              + bytes([len(segments)]) + bytes(segments))
    page = header + b"".join(packets)
    crc = ogg_crc(page)
    return page[:22] + struct.pack("<I", crc) + page[26:]


def packets_to_ogg(raw: bytes, serial: int = 0x54484C4E) -> bytes:
    """Turn the stored length-prefixed Opus packets into a playable Ogg Opus file."""
    head = b"OpusHead" + struct.pack("<BBHIhB", 1, 1, 312, 16000, 0, 0)
    vendor = b"threadline"
    tags = b"OpusTags" + struct.pack("<I", len(vendor)) + vendor + struct.pack("<I", 0)
    out = bytearray(ogg_page(serial, 0, 0, [head], flags=0x02) + ogg_page(serial, 1, 0, [tags]))
    packets, pos = [], 0
    while pos + 2 <= len(raw):
        (n,) = struct.unpack_from(">H", raw, pos)
        if pos + 2 + n > len(raw):
            break  # truncated by a crash
        packets.append(raw[pos + 2:pos + 2 + n])
        pos += 2 + n
    seq, granule, batch, size = 2, 0, [], 0
    for index, packet in enumerate(packets):
        batch.append(packet)
        size += len(packet) // 255 + 1
        granule += FRAME_SAMPLES_48K
        last = index == len(packets) - 1
        if last or size > 240 or len(batch) >= 50:
            out += ogg_page(serial, seq, granule, batch, flags=0x04 if last else 0)
            seq, batch, size = seq + 1, [], 0
    if not packets:
        out += ogg_page(serial, seq, 0, [], flags=0x04)
    return bytes(out)
