"""Apple Health import for the demo owner. The owner (X-Publish-Key == DEMO_WATCH_KEY) uploads export.zip (iPhone
Health > profile > Export All Health Data) or the raw export.xml. The body is streamed to a temp file (max 1 GB),
parsed with iterparse in a worker thread without loading the file, aggregated per local day (the date in each
record's own offset) into health_daily for the last 365 days, and the temp file is always deleted. The summary is
public on purpose: it is the demo owner's own data, shown in the demo."""

import asyncio
import logging
import os
import secrets
import tempfile
import threading
import zipfile
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from xml.etree.ElementTree import ParseError, iterparse

from fastapi import APIRouter, HTTPException, Query, Request

from app import demo_feed, store

log = logging.getLogger("threadline.health")

router = APIRouter()

MAX_BYTES = 1024 * 1024 * 1024
KEEP_DAYS = 365
CHUNK = 1024 * 1024

import_lock = threading.Lock()

# HK identifier -> (metric name, kind). "avg": mean/min/max of samples; "sum": daily total (largest single source,
# so iPhone + Watch steps are not double counted).
QUANTITY = {
    "HKQuantityTypeIdentifierHeartRate": ("heart_rate", "avg"),
    "HKQuantityTypeIdentifierRestingHeartRate": ("resting_heart_rate", "avg"),
    "HKQuantityTypeIdentifierHeartRateVariabilitySDNN": ("hrv_sdnn", "avg"),
    "HKQuantityTypeIdentifierRespiratoryRate": ("respiratory_rate", "avg"),
    "HKQuantityTypeIdentifierOxygenSaturation": ("oxygen_saturation", "avg"),
    "HKQuantityTypeIdentifierStepCount": ("steps", "sum"),
    "HKQuantityTypeIdentifierDistanceWalkingRunning": ("distance_km", "sum"),
    "HKQuantityTypeIdentifierActiveEnergyBurned": ("active_energy_kcal", "sum"),
    "HKQuantityTypeIdentifierAppleExerciseTime": ("exercise_min", "sum"),
    "HKQuantityTypeIdentifierFlightsClimbed": ("flights_climbed", "sum"),
    "HKQuantityTypeIdentifierAppleStandTime": ("stand_min", "sum"),
    "HKQuantityTypeIdentifierWalkingSpeed": ("walking_speed_kmh", "avg"),
    "HKQuantityTypeIdentifierAppleWalkingSteadiness": ("walking_steadiness", "avg"),
    "HKQuantityTypeIdentifierAppleSleepingWristTemperature": ("wrist_temp_c", "avg"),
    "HKQuantityTypeIdentifierEnvironmentalAudioExposure": ("audio_exposure_db", "avg"),
}
METRICS = sorted({name for name, _ in QUANTITY.values()} | {
    "sleep_hours", "mindful_min", "mood", "menstrual_flow", "workouts", "stand_hours"})

LENGTH_KM = {"km": 1.0, "m": 0.001, "cm": 0.00001, "mi": 1.609344, "ft": 0.0003048, "yd": 0.0009144}
ENERGY_KCAL = {"kcal": 1.0, "Cal": 1.0, "cal": 0.001, "kJ": 1 / 4.184, "J": 1 / 4184}
SPEED_KMH = {"km/hr": 1.0, "km/h": 1.0, "m/s": 3.6, "mi/hr": 1.609344, "mi/h": 1.609344}


class ImportError_(ValueError):
    """A problem with the uploaded file, reported to the owner as 400."""


def parse_dt(text: str | None) -> datetime | None:
    try:
        return datetime.strptime((text or "").strip(), "%Y-%m-%d %H:%M:%S %z")
    except ValueError:
        return None


def to_float(text: str | None) -> float | None:
    try:
        value = float(text)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return value if value == value and abs(value) != float("inf") else None


def convert(metric: str, value: float, unit: str) -> float | None:
    if metric == "distance_km":
        factor = LENGTH_KM.get(unit)
        return value * factor if factor else None
    if metric == "active_energy_kcal":
        factor = ENERGY_KCAL.get(unit)
        return value * factor if factor else None
    if metric == "walking_speed_kmh":
        factor = SPEED_KMH.get(unit)
        return value * factor if factor else None
    if metric in ("oxygen_saturation", "walking_steadiness"):
        return value * 100 if value <= 1.0 else value
    if metric == "wrist_temp_c" and unit == "degF":
        return (value - 32) * 5 / 9
    if metric in ("exercise_min", "stand_min") and unit in ("s", "hr"):
        return value / 60 if unit == "s" else value * 60
    return value


@dataclass
class Acc:
    kind: str
    total: float = 0.0
    count: int = 0
    lo: float | None = None
    hi: float | None = None
    by_source: dict = field(default_factory=dict)

    def add(self, value: float, source: str = "") -> None:
        self.total += value
        self.count += 1
        self.lo = value if self.lo is None else min(self.lo, value)
        self.hi = value if self.hi is None else max(self.hi, value)
        if self.kind == "sum":
            self.by_source[source] = self.by_source.get(source, 0.0) + value

    def value(self) -> float:
        if self.kind == "sum":
            return max(self.by_source.values()) if self.by_source else self.total
        return self.total / self.count if self.count else 0.0


class Aggregator:
    def __init__(self, cutoff: str):
        self.cutoff = cutoff
        self.acc: dict[tuple[str, str], Acc] = {}
        self.sleep: dict[str, list[tuple[float, float]]] = {}
        self.mood: dict[str, list[float]] = {}
        self.mood_count: dict[str, int] = {}
        self.flow_days: set[str] = set()
        self.records = 0

    def _add(self, day: str, metric: str, kind: str, value: float, source: str = "") -> None:
        key = (day, metric)
        acc = self.acc.get(key)
        if acc is None:
            acc = self.acc[key] = Acc(kind)
        acc.add(value, source)

    def element(self, tag: str, a: dict, metadata: dict) -> None:
        if tag == "Record":
            self.records += 1
            self.record(a, metadata)
        elif tag == "Workout":
            self.records += 1
            self.workout(a)
        elif tag == "ActivitySummary":
            self.records += 1
            self.activity(a)

    def record(self, a: dict, metadata: dict) -> None:
        kind = a.get("type", "")
        start_text, end_text = a.get("startDate", ""), a.get("endDate", "")
        day = start_text[:10]
        if kind == "HKCategoryTypeIdentifierSleepAnalysis":
            if end_text[:10] < self.cutoff or not a.get("value", "").startswith("HKCategoryValueSleepAnalysisAsleep"):
                return
            start, end = parse_dt(start_text), parse_dt(end_text)
            if start and end and end > start:
                self.sleep.setdefault(end_text[:10], []).append((start.timestamp(), end.timestamp()))
            return
        if day < self.cutoff or len(day) != 10:
            return
        source = a.get("sourceName", "")
        spec = QUANTITY.get(kind)
        if spec:
            metric, agg = spec
            raw = to_float(a.get("value"))
            if raw is None:
                return
            value = convert(metric, raw, a.get("unit", ""))
            if value is not None:
                self._add(day, metric, agg, value, source)
        elif kind == "HKCategoryTypeIdentifierMindfulSession":
            start, end = parse_dt(start_text), parse_dt(end_text)
            if start and end and end > start:
                self._add(day, "mindful_min", "sum", (end - start).total_seconds() / 60, source)
        elif kind == "HKCategoryTypeIdentifierMenstrualFlow":
            if a.get("value") not in (None, "", "HKCategoryValueMenstrualFlowNone"):
                self.flow_days.add(day)
        elif "StateOfMind" in kind or "Mood" in kind:
            self.mood_count[day] = self.mood_count.get(day, 0) + 1
            valence = next((v for v in (to_float(a.get("valence")), to_float(metadata.get("HKStateOfMindValence")),
                                        to_float(a.get("value"))) if v is not None), None)
            if valence is not None:
                self.mood.setdefault(day, []).append(valence)

    def workout(self, a: dict) -> None:
        day = a.get("startDate", "")[:10]
        if day < self.cutoff or len(day) != 10:
            return
        minutes = to_float(a.get("duration"))
        unit = a.get("durationUnit", "min")
        if minutes is not None:
            minutes = minutes / 60 if unit == "s" else minutes * 60 if unit == "hr" else minutes
        else:
            start, end = parse_dt(a.get("startDate")), parse_dt(a.get("endDate"))
            minutes = (end - start).total_seconds() / 60 if start and end and end > start else 0.0
        kind = a.get("workoutActivityType", "").removeprefix("HKWorkoutActivityType") or "Other"
        self._add(day, "workouts", "total", minutes)
        self._add(day, f"workout:{kind}", "total", minutes)

    def activity(self, a: dict) -> None:
        day = a.get("dateComponents", "")
        if day < self.cutoff or len(day) != 10:
            return
        for attr, metric in (("activeEnergyBurned", "active_energy_kcal"), ("appleExerciseTime", "exercise_min")):
            value = to_float(a.get(attr))
            if value is not None and value > 0:
                self._add(day, metric, "sum", value, "ActivitySummary")
        stand = to_float(a.get("appleStandHours"))
        if stand is not None and stand > 0:
            self._add(day, "stand_hours", "avg", stand)

    def rows(self) -> list[tuple]:
        out = []
        for (day, metric), acc in self.acc.items():
            if acc.kind == "total":
                out.append((day, metric, round(acc.total, 3), acc.count, acc.lo, acc.hi))
            else:
                out.append((day, metric, round(acc.value(), 3), acc.count, acc.lo, acc.hi))
        for day, spans in self.sleep.items():
            spans.sort()
            seconds, cur_start, cur_end = 0.0, None, None
            for s, e in spans:  # union overlapping segments (iPhone + Watch both record sleep)
                if cur_end is None or s > cur_end:
                    if cur_end is not None:
                        seconds += cur_end - cur_start
                    cur_start, cur_end = s, e
                else:
                    cur_end = max(cur_end, e)
            if cur_end is not None:
                seconds += cur_end - cur_start
            out.append((day, "sleep_hours", round(seconds / 3600, 3), len(spans), None, None))
        for day, count in self.mood_count.items():
            vals = self.mood.get(day, [])
            avg = round(sum(vals) / len(vals), 3) if vals else None
            out.append((day, "mood", avg, count, min(vals) if vals else None, max(vals) if vals else None))
        for day in self.flow_days:
            out.append((day, "menstrual_flow", 1.0, 1, None, None))
        return sorted(out)


TOP_LEVEL = {"Record", "Workout", "ActivitySummary"}


def parse_xml(stream, cutoff: str) -> Aggregator:
    agg = Aggregator(cutoff)
    depth, root = 0, None
    try:
        for event, elem in iterparse(stream, events=("start", "end")):
            if event == "start":
                depth += 1
                if root is None:
                    root = elem
                continue
            depth -= 1
            if depth == 1:
                if elem.tag in TOP_LEVEL:
                    metadata = {}
                    if elem.tag == "Record":
                        metadata = {m.get("key", ""): m.get("value") for m in elem if m.tag == "MetadataEntry"}
                    agg.element(elem.tag, elem.attrib, metadata)
                root.clear()  # type: ignore[union-attr]
    except ParseError as exc:
        raise ImportError_(f"Malformed export XML: {exc}") from None
    if root is None or root.tag != "HealthData":
        raise ImportError_("Not an Apple Health export (no <HealthData> root).")
    return agg


def parse_file(path: str, cutoff: str) -> Aggregator:
    with open(path, "rb") as fh:
        is_zip = fh.read(4) == b"PK\x03\x04"
    if not is_zip:
        with open(path, "rb") as fh:
            return parse_xml(fh, cutoff)
    try:
        with zipfile.ZipFile(path) as zf:
            names = [n for n in zf.namelist() if n.rsplit("/", 1)[-1] == "export.xml" and "__MACOSX" not in n]
            if not names:
                raise ImportError_("Zip does not contain apple_health_export/export.xml.")
            with zf.open(min(names, key=len)) as member:
                return parse_xml(member, cutoff)
    except (zipfile.BadZipFile, zipfile.LargeZipFile, NotImplementedError, EOFError) as exc:
        raise ImportError_(f"Unreadable zip: {exc.__class__.__name__}") from None


def run_import(path: str) -> dict:
    cutoff = (date.today() - timedelta(days=KEEP_DAYS - 1)).isoformat()
    agg = parse_file(path, cutoff)
    rows = agg.rows()
    db = store.get()
    if db is None:
        raise RuntimeError("storage disabled")
    db.replace_health(rows)
    days = sorted({r[0] for r in rows})
    return {"days": len(days), "metrics": sorted({r[1] for r in rows}),
            "range": [days[0], days[-1]] if days else None, "records": agg.records}


def require_owner(request: Request) -> None:
    key = demo_feed.demo_key()
    if not key:
        raise HTTPException(503, "Health import is not configured.")
    if not secrets.compare_digest(request.headers.get("x-publish-key", "").encode(), key.encode()):
        raise HTTPException(401, "Invalid publish key.")


async def stream_to_temp(request: Request) -> str:
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_BYTES:
        raise HTTPException(413, "Export too large (max 1 GB).")
    fd, path = tempfile.mkstemp(prefix="threadline-health-", suffix=".upload")
    size = 0
    try:
        with os.fdopen(fd, "wb") as fh:
            async for chunk in request.stream():
                size += len(chunk)
                if size > MAX_BYTES:
                    raise HTTPException(413, "Export too large (max 1 GB).")
                fh.write(chunk)
        if size == 0:
            raise HTTPException(400, "Empty body: send export.zip or export.xml.")
    except BaseException:
        remove(path)
        raise
    return path


def remove(path: str) -> None:
    try:
        os.unlink(path)
    except OSError:
        pass


ACCEPTED_TYPES = {"application/zip", "application/x-zip-compressed", "application/xml", "text/xml",
                  "application/octet-stream"}


@router.post("/api/health/import")
async def import_health(request: Request):
    require_owner(request)
    if store.get() is None:
        raise HTTPException(503, "Storage is disabled.")
    content_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if content_type not in ACCEPTED_TYPES:
        raise HTTPException(415, "Send export.zip (application/zip) or export.xml (application/xml).")
    if not import_lock.acquire(blocking=False):
        raise HTTPException(409, "An import is already running.")
    path = None
    try:
        path = await stream_to_temp(request)
        try:
            return await asyncio.to_thread(run_import, path)
        except ImportError_ as exc:
            raise HTTPException(400, str(exc)) from None
        except RuntimeError:
            raise HTTPException(503, "Storage is disabled.") from None
    finally:
        if path:
            remove(path)
        import_lock.release()


@router.delete("/api/health/import")
async def delete_health(request: Request):
    require_owner(request)
    db = store.get()
    if db is None:
        raise HTTPException(503, "Storage is disabled.")
    if import_lock.locked():
        raise HTTPException(409, "An import is running.")
    return {"ok": True, "deleted": db.clear_health()}


@router.get("/api/health/summary")
async def health_summary(days: int = Query(30, ge=1, le=KEEP_DAYS)):
    db = store.get()
    if db is None:
        raise HTTPException(503, "Storage is disabled.")
    full_range = db.health_range()
    if not full_range:
        return {"range": None, "today": {}, "daily": [], "averages": {}, "imported_at": db.health_imported_at()}
    since = (date.fromisoformat(full_range[1]) - timedelta(days=days - 1)).isoformat()
    by_day: dict[str, dict] = {}
    sums: dict[str, list[float]] = {}
    for row in db.health_rows(since):
        entry = by_day.setdefault(row["date"], {"date": row["date"]})
        metric, value = row["metric"], row["value"]
        if metric.startswith("workout:"):
            entry.setdefault("workout_types", {})[metric[8:]] = value
            continue
        entry[metric] = value
        if metric == "workouts":
            entry["workout_count"] = row["count"]
        if value is not None:
            sums.setdefault(metric, []).append(value)
    daily = [by_day[d] for d in sorted(by_day)]
    averages = {m: round(sum(v) / len(v), 2) for m, v in sorted(sums.items())}
    return {"range": full_range, "today": daily[-1] if daily else {}, "daily": daily, "averages": averages,
            "imported_at": db.health_imported_at()}
