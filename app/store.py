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
CREATE TABLE IF NOT EXISTS health_daily (
    date TEXT NOT NULL, metric TEXT NOT NULL, value REAL, count INTEGER NOT NULL DEFAULT 0, min REAL, max REAL,
    PRIMARY KEY (date, metric));
CREATE TABLE IF NOT EXISTS health_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, mode TEXT NOT NULL, created_at TEXT NOT NULL, mime TEXT NOT NULL,
    size INTEGER NOT NULL, analysis TEXT NULL, owner TEXT NOT NULL DEFAULT '');
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
        self.path = path

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

    def replace_health(self, rows: list[tuple], imported_at: str | None = None) -> None:
        """Replace the demo owner's daily Apple Health aggregates with rows of (date, metric, value, count, min, max)."""
        with self.lock:
            self.db.execute("BEGIN IMMEDIATE")
            try:
                self.db.execute("DELETE FROM health_daily")
                self.db.executemany("INSERT INTO health_daily (date, metric, value, count, min, max) "
                                    "VALUES (?, ?, ?, ?, ?, ?)", rows)
                self.db.execute("INSERT OR REPLACE INTO health_meta (key, value) VALUES ('imported_at', ?)",
                                (imported_at or now_iso(),))
                self.db.execute("COMMIT")
            except BaseException:
                self.db.execute("ROLLBACK")
                raise

    def health_rows(self, since: str | None = None) -> list[dict]:
        with self.lock:
            rows = self.db.execute("SELECT date, metric, value, count, min, max FROM health_daily WHERE date >= ? "
                                   "ORDER BY date, metric", (since or "",)).fetchall()
        return [{"date": d, "metric": m, "value": v, "count": c, "min": lo, "max": hi} for d, m, v, c, lo, hi in rows]

    def health_range(self) -> list[str] | None:
        with self.lock:
            first, last = self.db.execute("SELECT MIN(date), MAX(date) FROM health_daily").fetchone()
        return [first, last] if first else None

    def health_imported_at(self) -> str | None:
        with self.lock:
            row = self.db.execute("SELECT value FROM health_meta WHERE key = 'imported_at'").fetchone()
        return row[0] if row else None

    def clear_health(self) -> int:
        with self.lock:
            n = self.db.execute("DELETE FROM health_daily").rowcount
            self.db.execute("DELETE FROM health_meta WHERE key = 'imported_at'")
        return n

    def add_video(self, vid: str, title: str, mode: str, mime: str, size: int, owner: str = "") -> dict:
        row = {"id": vid, "title": title, "mode": mode, "created_at": now_iso(), "mime": mime, "size": size, "analysis": None}
        with self.lock:
            self.db.execute("INSERT INTO videos (id, title, mode, created_at, mime, size, owner) VALUES (?, ?, ?, ?, ?, ?, ?)",
                            (vid, title, mode, row["created_at"], mime, size, owner))
        return row

    def videos(self, limit: int = 50, owner: str = "") -> list[dict]:
        with self.lock:
            rows = self.db.execute("SELECT id, title, mode, created_at, mime, size, analysis FROM videos WHERE owner = ? "
                                   "ORDER BY created_at DESC, rowid DESC LIMIT ?", (owner, limit)).fetchall()
        return [{"id": i, "title": t, "mode": m, "created_at": c, "mime": mi, "size": sz, "analysis": json.loads(a) if a else None}
                for i, t, m, c, mi, sz, a in rows]

    def video(self, vid: str, owner: str = "") -> dict | None:
        with self.lock:
            r = self.db.execute("SELECT id, title, mode, created_at, mime, size, analysis FROM videos WHERE id = ? AND owner = ?", (vid, owner)).fetchone()
        return None if not r else {"id": r[0], "title": r[1], "mode": r[2], "created_at": r[3], "mime": r[4], "size": r[5],
                                   "analysis": json.loads(r[6]) if r[6] else None}

    def set_video_analysis(self, vid: str, analysis: dict, owner: str = "") -> bool:
        with self.lock:
            n = self.db.execute("UPDATE videos SET analysis = ? WHERE id = ? AND owner = ?",
                                (json.dumps(analysis, separators=(",", ":")), vid, owner)).rowcount
        return n > 0

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
