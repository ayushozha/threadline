"""Your calendar: connect real calendars without OAuth, through their private iCal (ICS) links
(Google "Secret address in iCal format", iCloud public calendar link, Outlook published ICS link).

POST   /api/calendar/connect {url, name}   validate, fetch once, store; returns {id, name, events_next_7d}
GET    /api/calendar/events?days=7&q=&tz=  merged agenda from every calendar of this owner
GET    /api/calendar/list                  connected calendars (the secret URL is never sent back)
DELETE /api/calendar/{id}

Feeds are fetched server side with SSRF guards (https only, public hosts only, re-checked on every redirect,
15 s timeout, 5 MB cap) and cached in memory for 5 minutes. The small ICS parser below handles folded lines,
TZID / UTC / floating / all-day times, EXDATE, RECURRENCE-ID overrides and simple RRULEs."""

import asyncio
import ipaddress
import re
import secrets
import time
from datetime import date, datetime, timedelta, timezone
from urllib.parse import urljoin, urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

router = APIRouter()

MAX_CALENDARS = 5
MAX_URL = 2000
MAX_BYTES = 5 * 1024 * 1024
MAX_REDIRECTS = 3
FETCH_TIMEOUT = 15
CACHE_TTL = 300
TEXT_MAX = 300
MAX_OCCURRENCES = 2000
ID_RE = re.compile(r"^[a-f0-9]{16}$")
TABLE_SQL = ("CREATE TABLE IF NOT EXISTS calendars (owner TEXT NOT NULL, id TEXT PRIMARY KEY, name TEXT NOT NULL, "
             "url TEXT NOT NULL, added_at TEXT NOT NULL)")

_cache: dict[str, tuple[float, str]] = {}


def authorize(request: Request, x_app_token: str = Header(default="")) -> None:
    from app.main import authorize as main_authorize
    main_authorize(request, x_app_token)


def _db():
    from app import store
    s = store.get()
    if s is None:
        raise HTTPException(503, "Storage is not available on this server.")
    with s.lock:
        s.db.execute(TABLE_SQL)
    return s


def _owner(request: Request) -> str:
    from app.videos import owner_of
    return owner_of(request)


# ---------------------------------------------------------------- fetching (SSRF-guarded)

def normalize_url(raw: str) -> str:
    url = (raw or "").strip()
    if len(url) > MAX_URL:
        raise HTTPException(400, "That link is too long.")
    low = url.lower()
    if low.startswith("webcals://"):
        url = "https://" + url[len("webcals://"):]
    elif low.startswith("webcal://"):
        url = "https://" + url[len("webcal://"):]
    parts = urlsplit(url)
    if parts.scheme.lower() != "https" or not parts.hostname:
        raise HTTPException(400, "Use the calendar's https:// (or webcal://) iCal link.")
    if parts.username or parts.password:
        raise HTTPException(400, "Links with a username or password are not supported.")
    return url


async def _resolve(host: str, port: int) -> list[str]:
    infos = await asyncio.get_running_loop().getaddrinfo(host, port)
    return [info[4][0] for info in infos]


def _blocked(ip_text: str) -> bool:
    ip = ipaddress.ip_address(ip_text.split("%")[0])
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved
            or ip.is_unspecified or not ip.is_global)


async def check_host(url: str) -> None:
    parts = urlsplit(url)
    if parts.scheme != "https" or not parts.hostname:
        raise HTTPException(400, "Only https:// calendar links are allowed.")
    try:
        literal = ipaddress.ip_address(parts.hostname.strip("[]"))
    except ValueError:
        literal = None
    if literal is not None and _blocked(str(literal)):
        raise HTTPException(400, "That calendar link points to a private or local address.")
    try:
        addrs = await _resolve(parts.hostname, parts.port or 443)
    except (OSError, UnicodeError):
        raise HTTPException(400, "That calendar host could not be found.")
    if not addrs or any(_blocked(a) for a in addrs):
        raise HTTPException(400, "That calendar link points to a private or local address.")


async def fetch_ics(url: str, use_cache: bool = True) -> str:
    hit = _cache.get(url)
    if use_cache and hit and time.monotonic() - hit[0] < CACHE_TTL:
        return hit[1]
    current = url
    async with httpx.AsyncClient(timeout=FETCH_TIMEOUT, follow_redirects=False) as client:
        for _ in range(MAX_REDIRECTS + 1):
            await check_host(current)
            async with client.stream("GET", current, headers={"Accept": "text/calendar, */*"}) as r:
                if r.status_code in (301, 302, 303, 307, 308):
                    loc = r.headers.get("location")
                    if not loc:
                        raise HTTPException(502, "The calendar server sent a broken redirect.")
                    current = urljoin(current, loc)
                    continue
                if r.status_code >= 400:
                    raise HTTPException(502, f"The calendar server answered {r.status_code}. Check the link.")
                declared = r.headers.get("content-length", "")
                if declared.isdigit() and int(declared) > MAX_BYTES:
                    raise HTTPException(413, "That calendar is larger than 5 MB.")
                buf = bytearray()
                async for chunk in r.aiter_bytes():
                    buf.extend(chunk)
                    if len(buf) > MAX_BYTES:
                        raise HTTPException(413, "That calendar is larger than 5 MB.")
                text = bytes(buf).decode(r.encoding or "utf-8", errors="replace")
                break
        else:
            raise HTTPException(502, "The calendar link redirects too many times.")
    if "BEGIN:VCALENDAR" not in text.upper():
        raise HTTPException(400, "That link did not return an iCal calendar (no BEGIN:VCALENDAR).")
    _cache[url] = (time.monotonic(), text)
    if len(_cache) > 200:
        _cache.pop(next(iter(_cache)))
    return text


# ---------------------------------------------------------------- ICS parsing

WINDOWS_TZ = {
    "pacific standard time": "America/Los_Angeles", "mountain standard time": "America/Denver",
    "central standard time": "America/Chicago", "eastern standard time": "America/New_York",
    "gmt standard time": "Europe/London", "greenwich standard time": "Atlantic/Reykjavik",
    "w. europe standard time": "Europe/Berlin", "romance standard time": "Europe/Paris",
    "central europe standard time": "Europe/Budapest", "central european standard time": "Europe/Warsaw",
    "e. europe standard time": "Europe/Chisinau", "india standard time": "Asia/Kolkata",
    "china standard time": "Asia/Shanghai", "tokyo standard time": "Asia/Tokyo",
    "aus eastern standard time": "Australia/Sydney", "singapore standard time": "Asia/Singapore",
    "utc": "UTC", "coordinated universal time": "UTC",
}
DAYS = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6}


def zone(name: str | None, fallback: ZoneInfo) -> ZoneInfo:
    if not name:
        return fallback
    name = name.strip().strip('"').lstrip("/")
    for candidate in (name, WINDOWS_TZ.get(name.lower(), "")):
        if candidate:
            try:
                return ZoneInfo(candidate)
            except (ZoneInfoNotFoundError, ValueError):
                pass
    return fallback


def unfold(text: str) -> list[str]:
    return re.sub(r"\r?\n[ \t]", "", text.replace("\r\n", "\n").replace("\r", "\n")).split("\n")


def parse_line(line: str) -> tuple[str, dict, str] | None:
    # NAME;PARAM=a;PARAM2="x:y":value — colons may appear inside quoted params.
    in_q, split = False, -1
    for i, ch in enumerate(line):
        if ch == '"':
            in_q = not in_q
        elif ch == ":" and not in_q:
            split = i
            break
    if split < 0:
        return None
    head, value = line[:split], line[split + 1:]
    bits = head.split(";")
    params = {}
    for p in bits[1:]:
        if "=" in p:
            k, v = p.split("=", 1)
            params[k.upper()] = v.strip('"')
    return bits[0].upper(), params, value


def unescape(v: str) -> str:
    return re.sub(r"\\([nN,;\\])", lambda m: "\n" if m.group(1) in "nN" else m.group(1), v)


def clip(v: str) -> str:
    v = re.sub(r"\s+", " ", unescape(v)).strip()
    return v if len(v) <= TEXT_MAX else v[:TEXT_MAX - 1].rstrip() + "…"


def parse_dt(value: str, params: dict, tz: ZoneInfo) -> date | datetime | None:
    v = value.strip()
    try:
        if params.get("VALUE", "").upper() == "DATE" or re.fullmatch(r"\d{8}", v):
            return datetime.strptime(v[:8], "%Y%m%d").date()
        utc = v.endswith("Z")
        d = datetime.strptime(v.rstrip("Z")[:15], "%Y%m%dT%H%M%S")
    except ValueError:
        return None
    if utc:
        return d.replace(tzinfo=timezone.utc)
    return d.replace(tzinfo=zone(params.get("TZID"), tz))


def parse_duration(v: str) -> timedelta | None:
    m = re.fullmatch(r"([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?", v.strip())
    if not m:
        return None
    sign, w, d, h, mi, s = m.groups()
    td = timedelta(weeks=int(w or 0), days=int(d or 0), hours=int(h or 0), minutes=int(mi or 0), seconds=int(s or 0))
    return -td if sign == "-" else td


def parse_events(text: str, tz: ZoneInfo) -> tuple[list[dict], str | None]:
    """Returns (raw VEVENTs, calendar name from X-WR-CALNAME)."""
    events, cur, depth, calname = [], None, 0, None
    for line in unfold(text):
        if not line.strip():
            continue
        parsed = parse_line(line)
        if not parsed:
            continue
        name, params, value = parsed
        if name == "BEGIN":
            if value.strip().upper() == "VEVENT" and cur is None:
                cur, depth = {"exdates": []}, 0
            elif cur is not None:
                depth += 1  # nested VALARM etc.
            continue
        if name == "END":
            if cur is not None:
                if depth:
                    depth -= 1
                elif value.strip().upper() == "VEVENT":
                    events.append(cur)
                    cur = None
            continue
        if cur is None:
            if name == "X-WR-CALNAME" and not calname:
                calname = clip(value)[:60]
            continue
        if depth:
            continue
        if name in ("DTSTART", "DTEND", "RECURRENCE-ID"):
            cur[name] = parse_dt(value, params, tz)
        elif name == "EXDATE":
            cur["exdates"].extend(parse_dt(x, params, tz) for x in value.split(",") if x.strip())
        elif name in ("SUMMARY", "LOCATION", "DESCRIPTION"):
            cur[name] = clip(value)
        elif name in ("UID", "RRULE", "STATUS", "DURATION"):
            cur[name] = value.strip()
    return events, calname


def _key(d: date | datetime) -> object:
    return d.astimezone(timezone.utc).replace(microsecond=0) if isinstance(d, datetime) else d


def _add_months(d: date | datetime, months: int):
    y, m = divmod(d.month - 1 + months, 12)
    try:
        return d.replace(year=d.year + y, month=m + 1)
    except ValueError:
        return None  # e.g. the 31st in a 30-day month: no occurrence that month


def _nth_weekday(year: int, month: int, n: int, wd: int) -> int | None:
    first = date(year, month, 1)
    last = (_add_months(first, 1) - timedelta(days=1)).day
    days = [d for d in range(1, last + 1) if date(year, month, d).weekday() == wd]
    try:
        return days[n - 1] if n > 0 else days[n]
    except IndexError:
        return None


def expand(start, rrule: str, win_start, win_end, exdates: set) -> list:
    """Occurrence starts of a simple RRULE (DAILY/WEEKLY/MONTHLY/YEARLY, INTERVAL, COUNT, UNTIL,
    BYDAY for WEEKLY or a single ordinal BYDAY like 2TU / -1FR for MONTHLY) that fall before win_end.
    Wall-clock times are kept across DST because the aware datetimes share one ZoneInfo."""
    rule = dict(p.split("=", 1) for p in rrule.upper().split(";") if "=" in p)
    freq = rule.get("FREQ")
    if freq not in ("DAILY", "WEEKLY", "MONTHLY", "YEARLY"):
        return [start]
    interval = max(1, int(rule.get("INTERVAL", "1") or 1))
    count = int(rule["COUNT"]) if rule.get("COUNT", "").isdigit() else None
    until = None
    if rule.get("UNTIL"):
        until = parse_dt(rule["UNTIL"], {}, start.tzinfo if isinstance(start, datetime) else timezone.utc)
        if isinstance(start, datetime) and isinstance(until, date) and not isinstance(until, datetime):
            until = datetime.combine(until, datetime.max.time(), start.tzinfo)
        elif not isinstance(start, datetime) and isinstance(until, datetime):
            until = until.date()
    byday = [b for b in rule.get("BYDAY", "").split(",") if b]

    def before_until(d):
        return until is None or d <= until

    out, emitted = [], 0
    period = 0
    # Without COUNT we may jump close to the window instead of walking from a years-old DTSTART.
    if count is None:
        lag = ((win_start.date() if isinstance(win_start, datetime) else win_start)
               - (start.date() if isinstance(start, datetime) else start)).days
        if lag > 0:
            span = {"DAILY": 1, "WEEKLY": 7, "MONTHLY": 28, "YEARLY": 365}[freq] * interval
            period = max(0, lag // span - 1)
            if freq == "MONTHLY":
                period = max(0, (lag // 31) // interval - 1)
            elif freq == "YEARLY":
                period = max(0, (lag // 366) // interval - 1)
    week0 = start - timedelta(days=start.weekday())
    for _ in range(MAX_OCCURRENCES * 4):
        if freq == "DAILY":
            cands = [start + timedelta(days=period * interval)]
        elif freq == "WEEKLY":
            base = week0 + timedelta(weeks=period * interval)
            wds = sorted({DAYS[b[-2:]] for b in byday if b[-2:] in DAYS}) or [start.weekday()]
            cands = [base + timedelta(days=w) for w in wds]
        elif freq == "MONTHLY":
            first = _add_months(start.replace(day=1), period * interval)
            if byday and re.fullmatch(r"[+-]?\d{1,2}(MO|TU|WE|TH|FR|SA|SU)", byday[0]):
                day = _nth_weekday(first.year, first.month, int(byday[0][:-2]), DAYS[byday[0][-2:]])
                cands = [first.replace(day=day)] if day else []
            else:
                one = _add_months(start, period * interval)
                cands = [one] if one else []
        else:
            one = _add_months(start, 12 * period * interval)
            cands = [one] if one else []
        period += 1
        stop = False
        for c in cands:
            if c < start:
                continue
            if not before_until(c) or (count is not None and emitted >= count) or c >= win_end:
                stop = True
                break
            emitted += 1
            if _key(c) not in exdates:
                out.append(c)
            if len(out) >= MAX_OCCURRENCES:
                return out
        if stop:
            break
    return out


def agenda(text: str, calendar: str, tz: ZoneInfo, win_start: datetime, win_end: datetime) -> list[dict]:
    raw, _ = parse_events(text, tz)
    overrides = {(e.get("UID"), _key(e["RECURRENCE-ID"])) for e in raw if e.get("RECURRENCE-ID") and e.get("UID")}
    out = []
    for e in raw:
        start = e.get("DTSTART")
        if start is None or e.get("STATUS", "").upper() == "CANCELLED":
            continue
        all_day = not isinstance(start, datetime)
        end = e.get("DTEND")
        if end is None or type(end) is not type(start):
            dur = parse_duration(e.get("DURATION", "")) if e.get("DURATION") else None
            end = start + (dur if dur is not None else (timedelta(days=1) if all_day else timedelta(0)))
        length = end - start
        lo = win_start.date() if all_day else win_start
        hi = win_end.date() if all_day else win_end
        if e.get("RRULE") and not e.get("RECURRENCE-ID"):
            exd = {_key(x) for x in e["exdates"] if x is not None}
            exd |= {k for (uid, k) in overrides if uid == e.get("UID")}
            starts = expand(start, e["RRULE"], lo, hi, exd)
        else:
            starts = [start]
        for s in starts:
            fin = s + length
            if not (fin > lo or (length == timedelta(0) and s >= lo)) or s >= hi:
                continue
            if all_day:
                st, en = s.isoformat(), fin.isoformat()
            else:
                st, en = s.astimezone(tz).isoformat(), fin.astimezone(tz).isoformat()
            out.append({"title": e.get("SUMMARY") or "(No title)", "start": st, "end": en, "all_day": all_day,
                        "location": e.get("LOCATION", ""), "description": e.get("DESCRIPTION", ""),
                        "calendar": calendar})
    return out


def sort_key(ev: dict, tz: ZoneInfo) -> tuple:
    if ev["all_day"]:
        return (datetime.combine(date.fromisoformat(ev["start"]), datetime.min.time(), tz), 0, ev["title"])
    return (datetime.fromisoformat(ev["start"]), 1, ev["title"])


def window(tz: ZoneInfo, days: int) -> tuple[datetime, datetime]:
    today = datetime.now(tz).date()
    start = datetime.combine(today, datetime.min.time(), tz)
    return start, datetime.combine(today + timedelta(days=days), datetime.min.time(), tz)


def user_zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name) if name else ZoneInfo("UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


# ---------------------------------------------------------------- routes

class ConnectRequest(BaseModel):
    url: str = Field(min_length=8, max_length=MAX_URL + 20)
    name: str = Field(default="", max_length=60)
    tz: str = Field(default="", max_length=64)


def _rows(s, owner: str) -> list[tuple]:
    with s.lock:
        return s.db.execute("SELECT id, name, url, added_at FROM calendars WHERE owner = ? ORDER BY added_at",
                            (owner,)).fetchall()


def _public(row: tuple) -> dict:
    return {"id": row[0], "name": row[1], "host": urlsplit(row[2]).hostname or "", "added_at": row[3]}


@router.post("/api/calendar/connect", dependencies=[Depends(authorize)])
async def connect(body: ConnectRequest, request: Request):
    url = normalize_url(body.url)
    s, owner = _db(), _owner(request)
    rows = _rows(s, owner)
    if len(rows) >= MAX_CALENDARS:
        raise HTTPException(409, f"You can connect up to {MAX_CALENDARS} calendars. Remove one first.")
    if any(r[2] == url for r in rows):
        raise HTTPException(409, "That calendar is already connected.")
    text = await fetch_ics(url, use_cache=False)
    tz = user_zone(body.tz)
    _, calname = parse_events(text, tz)
    name = body.name.strip() or calname or "Calendar"
    lo, hi = window(tz, 7)
    count = len(agenda(text, name, tz, lo, hi))
    cid = secrets.token_hex(8)
    added = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    with s.lock:
        s.db.execute("INSERT INTO calendars (owner, id, name, url, added_at) VALUES (?, ?, ?, ?, ?)",
                     (owner, cid, name, url, added))
    return {"id": cid, "name": name, "events_next_7d": count}


@router.get("/api/calendar/list", dependencies=[Depends(authorize)])
def list_calendars(request: Request):
    return {"calendars": [_public(r) for r in _rows(_db(), _owner(request))]}


@router.get("/api/calendar/events", dependencies=[Depends(authorize)])
async def events(request: Request, days: int = 7, q: str = "", tz: str = ""):
    days = max(1, min(31, days))
    zone_ = user_zone(tz)
    rows = _rows(_db(), _owner(request))
    lo, hi = window(zone_, days)

    async def one(row):
        try:
            return row, await fetch_ics(row[2]), None
        except HTTPException as e:
            return row, None, str(e.detail)
        except (httpx.HTTPError, OSError):
            return row, None, "The calendar could not be reached."

    results = await asyncio.gather(*(one(r) for r in rows))
    out, cals = [], []
    for row, text, err in results:
        cal = _public(row)
        if text is not None:
            try:
                out.extend(agenda(text, row[1], zone_, lo, hi))
            except Exception:  # noqa: BLE001 — one malformed feed must not break the agenda
                err = "This calendar could not be read."
        if err:
            cal["error"] = err
        cals.append(cal)
    needle = q.strip().lower()[:100]
    if needle:
        out = [e for e in out if needle in f"{e['title']} {e['location']} {e['description']}".lower()]
    out.sort(key=lambda e: sort_key(e, zone_))
    return {"events": out[:500], "calendars": cals, "tz": str(zone_), "days": days}


@router.delete("/api/calendar/{cid}", dependencies=[Depends(authorize)])
def remove(cid: str, request: Request):
    if not ID_RE.fullmatch(cid):
        raise HTTPException(404, "No such calendar.")
    s = _db()
    with s.lock:
        cur = s.db.execute("DELETE FROM calendars WHERE id = ? AND owner = ?", (cid, _owner(request)))
    if not cur.rowcount:
        raise HTTPException(404, "No such calendar.")
    return {"ok": True}
