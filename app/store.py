"""Server storage for the public demo only: the demo owner's live transcript lines (from a live-transcribe
session that presented DEMO_WATCH_KEY) and the demo watch's published sensor readings. Nothing from
visitors or private sessions is written here. SQLite at THREADLINE_DB_PATH; if that path is not writable the
app keeps running with storage disabled."""

import json
import logging
import os
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger("threadline.store")

DEFAULT_PATH = "/data/threadline.db"
MAX_LINES = 20000
MAX_READINGS = 50000

SCHEMA = """
CREATE TABLE IF NOT EXISTS demo_lines (
    id INTEGER PRIMARY KEY, at TEXT NOT NULL, session TEXT NOT NULL, speaker INTEGER NULL,
    text TEXT NOT NULL, source TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS demo_readings (
    id INTEGER PRIMARY KEY, at TEXT NOT NULL, device TEXT, json TEXT NOT NULL);
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class Store:
    def __init__(self, path: str):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()
        self.db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=NORMAL")
        self.db.executescript(SCHEMA)

    def _prune(self, table: str, cap: int) -> None:
        self.db.execute(f"DELETE FROM {table} WHERE id <= (SELECT id FROM {table} ORDER BY id DESC LIMIT 1 OFFSET ?)",
                        (cap,))

    def add_line(self, session: str, speaker: int | None, text: str, source: str, at: str | None = None) -> str:
        at = at or now_iso()
        with self.lock:
            self.db.execute("INSERT INTO demo_lines (at, session, speaker, text, source) VALUES (?, ?, ?, ?, ?)",
                            (at, session, speaker, text, source))
            self._prune("demo_lines", MAX_LINES)
        return at

    def add_reading(self, device: str | None, frame: dict, at: str | None = None) -> None:
        with self.lock:
            self.db.execute("INSERT INTO demo_readings (at, device, json) VALUES (?, ?, ?)",
                            (at or now_iso(), device, json.dumps(frame, separators=(",", ":"))))
            self._prune("demo_readings", MAX_READINGS)

    def lines(self, limit: int) -> list[dict]:
        with self.lock:
            rows = self.db.execute("SELECT at, speaker, text FROM demo_lines ORDER BY id DESC LIMIT ?",
                                   (limit,)).fetchall()
        return [{"at": at, "speaker": speaker, "text": text} for at, speaker, text in reversed(rows)]

    def readings(self, limit: int) -> list[dict]:
        with self.lock:
            rows = self.db.execute("SELECT at, device, json FROM demo_readings ORDER BY id DESC LIMIT ?",
                                   (limit,)).fetchall()
        return [{"at": at, "device": device, "frame": json.loads(raw)} for at, device, raw in reversed(rows)]

    def close(self) -> None:
        with self.lock:
            self.db.close()


_store: Store | None = None
_opened = False
_open_lock = threading.Lock()


def get() -> Store | None:
    """The shared store, opened on first use; None when storage is unavailable (logged once)."""
    global _store, _opened
    if _opened:
        return _store
    with _open_lock:
        if not _opened:
            path = os.getenv("THREADLINE_DB_PATH", "").strip() or DEFAULT_PATH
            try:
                _store = Store(path)
            except (OSError, sqlite3.Error) as exc:
                log.warning("Demo storage disabled: cannot open %s (%s)", path, exc.__class__.__name__)
                _store = None
            _opened = True
    return _store


def reset() -> None:
    """Close and forget the shared store so the next get() reopens from THREADLINE_DB_PATH (tests)."""
    global _store, _opened
    with _open_lock:
        if _store is not None:
            _store.close()
        _store, _opened = None, False
