"""Stateless iCloud CalDAV adapter. Credentials arrive with each request and are never stored or logged.

The person signs in with their Apple ID and an app-specific password (appleid.apple.com → Sign-In and
Security). Every call discovers the calendars again, so the server keeps no session. Only iCloud hosts
are contacted, including any host named in a server response.
"""
from __future__ import annotations

import re
import uuid
from datetime import date, datetime, timedelta, timezone
from urllib.parse import urljoin, urlparse
from xml.etree import ElementTree as ET
from zoneinfo import ZoneInfo

import httpx
from fastapi import HTTPException
from pydantic import BaseModel, Field, SecretStr, field_validator

ICLOUD = "https://caldav.icloud.com/"
NS = {"d": "DAV:", "c": "urn:ietf:params:xml:ns:caldav"}
_transport: httpx.AsyncBaseTransport | None = None  # tests inject a fake iCloud here
DATETIME = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})?$")
DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class AppleAuth(BaseModel):
    username: str = Field(min_length=3, max_length=120)
    password: SecretStr = Field(min_length=8, max_length=100)


class AppleRange(BaseModel):
    auth: AppleAuth
    start: str
    end: str

    @field_validator("start", "end")
    @classmethod
    def valid_day(cls, v: str) -> str:
        if not DAY.match(v):
            raise ValueError("Use YYYY-MM-DD.")
        return v


class AppleCreate(BaseModel):
    auth: AppleAuth
    title: str = Field(min_length=1, max_length=120)
    notes: str = Field(default="", max_length=500)
    start: str
    end: str
    all_day: bool = False
    calendar: str = Field(default="", max_length=80)

    @field_validator("start", "end")
    @classmethod
    def valid_time(cls, v: str) -> str:
        if not (DATETIME.match(v) or DAY.match(v)):
            raise ValueError("Use an ISO date or date-time.")
        return v


def _ok_host(url: str) -> bool:
    p = urlparse(url)
    host = p.hostname or ""
    return p.scheme == "https" and (host == "icloud.com" or host.endswith(".icloud.com"))


def _client(auth: AppleAuth) -> httpx.AsyncClient:
    return httpx.AsyncClient(auth=(auth.username, auth.password.get_secret_value()), timeout=20,
                             follow_redirects=False, transport=_transport)


async def _dav(client: httpx.AsyncClient, method: str, url: str, body: str, depth: str = "0") -> ET.Element:
    if not _ok_host(url):
        raise HTTPException(502, "Refused to contact a non-iCloud host.")
    try:
        r = await client.request(method, url, content=body.encode(), headers={"Depth": depth, "Content-Type": "application/xml; charset=utf-8"})
    except httpx.RequestError:
        raise HTTPException(502, "iCloud is unreachable. Please retry.") from None
    if r.status_code == 401:
        raise HTTPException(401, "Apple rejected that Apple ID or app-specific password.")
    if r.status_code not in (200, 207):
        raise HTTPException(502, f"iCloud returned {r.status_code}.")
    try:
        return ET.fromstring(r.content)
    except ET.ParseError:
        raise HTTPException(502, "iCloud sent an unreadable reply.") from None


def _text(root: ET.Element, path: str) -> str | None:
    node = root.find(path, NS)
    return node.text.strip() if node is not None and node.text else None


async def discover(client: httpx.AsyncClient) -> list[dict]:
    root = await _dav(client, "PROPFIND", ICLOUD, '<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>')
    principal = _text(root, ".//d:current-user-principal/d:href")
    if not principal:
        raise HTTPException(502, "iCloud did not return your account.")
    principal_url = urljoin(ICLOUD, principal)
    root = await _dav(client, "PROPFIND", principal_url, '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>')
    home = _text(root, ".//c:calendar-home-set/d:href")
    if not home:
        raise HTTPException(502, "iCloud did not return your calendars.")
    home_url = urljoin(principal_url, home)
    root = await _dav(client, "PROPFIND", home_url, '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:resourcetype/><d:displayname/><c:supported-calendar-component-set/></d:prop></d:propfind>', depth="1")
    calendars = []
    for resp in root.findall("d:response", NS):
        if resp.find(".//d:resourcetype/c:calendar", NS) is None:
            continue
        comps = [c.get("name") for c in resp.findall(".//c:supported-calendar-component-set/c:comp", NS)]
        if comps and "VEVENT" not in comps:
            continue
        href = resp.findtext("d:href", default="", namespaces=NS)
        url = urljoin(home_url, href)
        if _ok_host(url):
            calendars.append({"url": url if url.endswith("/") else url + "/", "name": _text(resp, ".//d:displayname") or "Calendar"})
    return calendars


# ---- ICS parsing / building ----------------------------------------------------------------
def _unfold(text: str) -> list[str]:
    return re.sub(r"\r?\n[ \t]", "", text).splitlines()


def _unescape(v: str) -> str:
    return v.replace("\\n", "\n").replace("\\N", "\n").replace("\\,", ",").replace("\\;", ";").replace("\\\\", "\\")


def _when(params: dict[str, str], value: str) -> tuple[str, bool]:
    """Return (iso string, all_day). UTC and named zones become UTC ('Z'); floating times stay floating."""
    if "T" not in value:
        return f"{value[:4]}-{value[4:6]}-{value[6:8]}", True
    dt = datetime.strptime(value.rstrip("Z"), "%Y%m%dT%H%M%S")
    if value.endswith("Z"):
        return dt.strftime("%Y-%m-%dT%H:%M:%SZ"), False
    tzid = params.get("TZID")
    if tzid:
        try:
            return dt.replace(tzinfo=ZoneInfo(tzid)).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), False
        except Exception:  # unknown zone name: leave floating
            pass
    return dt.strftime("%Y-%m-%dT%H:%M:%S"), False


def _duration(v: str) -> timedelta:
    m = re.fullmatch(r"([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?", v)
    if not m:
        return timedelta(0)
    sign = -1 if m.group(1) == "-" else 1
    w, d, h, mi, s = (int(x or 0) for x in m.groups()[1:])
    return sign * timedelta(weeks=w, days=d, hours=h, minutes=mi, seconds=s)


def parse_ics(text: str) -> list[dict]:
    events, cur, alarm = [], None, False
    for line in _unfold(text):
        if line == "BEGIN:VALARM":
            alarm = True
        elif line == "END:VALARM":
            alarm = False
        elif alarm:
            continue
        elif line == "BEGIN:VEVENT":
            cur = {}
        elif line == "END:VEVENT" and cur is not None:
            if "DTSTART" in cur:
                start, all_day = _when(*cur["DTSTART"])
                if "DTEND" in cur:
                    end, _ = _when(*cur["DTEND"])
                else:
                    base = datetime.fromisoformat(start.replace("Z", "+00:00")) if not all_day else datetime.fromisoformat(start)
                    delta = _duration(cur["DURATION"][1]) if "DURATION" in cur else (timedelta(days=1) if all_day else timedelta(0))
                    end = (base + delta).strftime("%Y-%m-%d" if all_day else "%Y-%m-%dT%H:%M:%S") + ("Z" if start.endswith("Z") else "")
                uid = cur.get("UID", ("", ""))[1] or uuid.uuid4().hex
                events.append({"id": f"{uid}@{start}", "title": _unescape(cur.get("SUMMARY", ("", "(no title)"))[1]) or "(no title)",
                               "start": start, "end": end, "all_day": all_day, "source": "apple"})
            cur = None
        elif cur is not None and ":" in line:
            head, value = line.split(":", 1)
            name, *rest = head.split(";")
            if name.upper() not in cur:
                cur[name.upper()] = ({k.upper(): v for k, v in (p.split("=", 1) for p in rest if "=" in p)}, value) if name.upper() in ("DTSTART", "DTEND") else (None, value)
    return events


def build_ics(title: str, notes: str, start: str, end: str, all_day: bool) -> tuple[str, str]:
    uid = f"{uuid.uuid4()}@threadline"
    esc = lambda s: s.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    def fmt(v: str) -> str:
        if DAY.match(v):
            return v.replace("-", "")
        dt = datetime.fromisoformat(v.replace("Z", "+00:00"))
        return (dt.astimezone(timezone.utc) if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).strftime("%Y%m%dT%H%M%SZ")

    if all_day:
        s = date.fromisoformat(start[:10])
        e = date.fromisoformat(end[:10])
        if e <= s:
            e = s + timedelta(days=1)
        dtstart, dtend = f"DTSTART;VALUE=DATE:{s:%Y%m%d}", f"DTEND;VALUE=DATE:{e:%Y%m%d}"
    else:
        dtstart, dtend = f"DTSTART:{fmt(start)}", f"DTEND:{fmt(end)}"
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Threadline//EN", "BEGIN:VEVENT", f"UID:{uid}", f"DTSTAMP:{stamp}",
             dtstart, dtend, f"SUMMARY:{esc(title)}"] + ([f"DESCRIPTION:{esc(notes)}"] if notes else []) + ["END:VEVENT", "END:VCALENDAR"]
    return uid, "\r\n".join(lines) + "\r\n"


# ---- operations ----------------------------------------------------------------------------
async def list_events(body: AppleRange) -> dict:
    if (date.fromisoformat(body.end) - date.fromisoformat(body.start)).days not in range(0, 32):
        raise HTTPException(422, "Ask for 31 days or fewer.")
    s, e = body.start.replace("-", "") + "T000000Z", (date.fromisoformat(body.end) + timedelta(days=1)).strftime("%Y%m%d") + "T000000Z"
    query = (f'<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-data><c:expand start="{s}" end="{e}"/></c:calendar-data></d:prop>'
             f'<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="{s}" end="{e}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>')
    out, names = [], []
    async with _client(body.auth) as client:
        for cal in await discover(client):
            names.append(cal["name"])
            root = await _dav(client, "REPORT", cal["url"], query, depth="1")
            for data in root.iterfind(".//c:calendar-data", NS):
                for ev in parse_ics(data.text or ""):
                    out.append({**ev, "calendar": cal["name"]})
    out.sort(key=lambda x: x["start"])
    return {"events": out[:300], "calendars": names}


async def create_event(body: AppleCreate) -> dict:
    uid, ics = build_ics(body.title, body.notes, body.start, body.end, body.all_day)
    async with _client(body.auth) as client:
        cals = await discover(client)
        if not cals:
            raise HTTPException(404, "No writable calendar found.")
        cal = next((c for c in cals if c["name"] == body.calendar), cals[0])
        url = f"{cal['url']}{uuid.uuid4().hex}.ics"
        if not _ok_host(url):
            raise HTTPException(502, "Refused to contact a non-iCloud host.")
        try:
            r = await client.put(url, content=ics.encode(), headers={"Content-Type": "text/calendar; charset=utf-8", "If-None-Match": "*"})
        except httpx.RequestError:
            raise HTTPException(502, "iCloud is unreachable. Please retry.") from None
    if r.status_code == 401:
        raise HTTPException(401, "Apple rejected that Apple ID or app-specific password.")
    if r.status_code not in (200, 201, 204):
        raise HTTPException(502, f"iCloud refused to save the event ({r.status_code}).")
    return {"id": uid, "calendar": cal["name"]}
