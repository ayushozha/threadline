from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import httpx
import pytest
from fastapi.testclient import TestClient

from app import main  # noqa: I001
from app import calendars, store

TOKEN = "t" * 32
H = {"x-app-token": TOKEN}
ORIGIN = "https://threadline.example"
NY = ZoneInfo("America/New_York")


def ics(*events: str, name: str = "Work") -> str:
    body = "\r\n".join(events)
    return f"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-CALNAME:{name}\r\n{body}\r\nEND:VCALENDAR\r\n"


def soon(hours: int = 26) -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).strftime("%Y%m%dT%H%M%SZ")


FEED = ics(f"BEGIN:VEVENT\r\nUID:a\r\nDTSTART:{soon()}\r\nDTEND:{soon(27)}\r\nSUMMARY:Dentist\r\n"
           "LOCATION:Main St\r\nEND:VEVENT")


@pytest.fixture
def env(monkeypatch, tmp_path):
    monkeypatch.setenv("APP_ACCESS_TOKEN", TOKEN)
    monkeypatch.delenv("APP_TRUST_LOOPBACK", raising=False)
    monkeypatch.setenv("THREADLINE_DB_PATH", str(tmp_path / "t.db"))
    store.reset()
    calendars._cache.clear()
    feeds = {}
    seen = []

    async def resolve(host, port):
        return {"internal.example": ["10.0.0.5"], "localhost": ["127.0.0.1"],
                "meta.example": ["169.254.169.254"]}.get(host, ["93.184.216.34"])
    monkeypatch.setattr(calendars, "_resolve", resolve)

    def handler(req: httpx.Request):
        seen.append(str(req.url))
        hit = feeds.get(str(req.url))
        if hit is None:
            return httpx.Response(404)
        if isinstance(hit, httpx.Response):
            return hit
        return httpx.Response(200, text=hit, headers={"content-type": "text/calendar"})
    real = httpx.AsyncClient
    monkeypatch.setattr(calendars.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    yield feeds, seen
    store.reset()


@pytest.fixture
def client(env):
    return TestClient(main.app)


def test_connect_validation(client, env):
    feeds, seen = env
    feeds["https://cal.example/notics"] = "<html>hello</html>"
    for url, code in [("http://cal.example/a.ics", 400), ("ftp://cal.example/a.ics", 400),
                      ("https://localhost/a.ics", 400), ("https://internal.example/a.ics", 400),
                      ("https://meta.example/a.ics", 400), ("https://127.0.0.1/a.ics", 400),
                      ("https://user:pw@cal.example/a.ics", 400), ("https://cal.example/notics", 400),
                      ("https://cal.example/" + "x" * 2000, 400)]:
        r = client.post("/api/calendar/connect", json={"url": url}, headers=H)
        assert r.status_code == code, (url, r.text)
    assert seen == ["https://cal.example/notics"]  # private hosts were never contacted
    assert client.get("/api/calendar/list", headers=H).json()["calendars"] == []


def test_redirect_to_private_host_refused(client, env):
    feeds, seen = env
    feeds["https://cal.example/r.ics"] = httpx.Response(302, headers={"location": "https://internal.example/x.ics"})
    r = client.post("/api/calendar/connect", json={"url": "https://cal.example/r.ics"}, headers=H)
    assert r.status_code == 400 and "private" in r.text
    assert seen == ["https://cal.example/r.ics"]


def test_too_large_refused(client, env):
    feeds, _ = env
    feeds["https://cal.example/big.ics"] = "BEGIN:VCALENDAR\r\n" + "X" * (5 * 1024 * 1024 + 10)
    r = client.post("/api/calendar/connect", json={"url": "https://cal.example/big.ics"}, headers=H)
    assert r.status_code == 413


def test_connect_webcal_list_events_delete(client, env):
    feeds, _ = env
    feeds["https://cal.example/w.ics"] = FEED
    r = client.post("/api/calendar/connect", json={"url": "webcal://cal.example/w.ics", "name": ""}, headers=H)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["name"] == "Work" and d["events_next_7d"] == 1
    listed = client.get("/api/calendar/list", headers=H).json()["calendars"]
    assert [c["id"] for c in listed] == [d["id"]] and "url" not in listed[0] and listed[0]["host"] == "cal.example"
    ev = client.get("/api/calendar/events?days=7&tz=America/New_York", headers=H).json()
    assert [e["title"] for e in ev["events"]] == ["Dentist"]
    assert ev["events"][0]["location"] == "Main St" and ev["events"][0]["calendar"] == "Work"
    assert client.get("/api/calendar/events?q=dent", headers=H).json()["events"]
    assert client.get("/api/calendar/events?q=zzz", headers=H).json()["events"] == []
    assert client.post("/api/calendar/connect", json={"url": "https://cal.example/w.ics"}, headers=H).status_code == 409
    assert client.delete(f"/api/calendar/{d['id']}", headers=H).status_code == 200
    assert client.delete(f"/api/calendar/{d['id']}", headers=H).status_code == 404
    assert client.get("/api/calendar/list", headers=H).json()["calendars"] == []


def test_limit_of_five(client, env):
    feeds, _ = env
    for i in range(6):
        feeds[f"https://cal.example/{i}.ics"] = FEED
    for i in range(5):
        assert client.post("/api/calendar/connect", json={"url": f"https://cal.example/{i}.ics"}, headers=H).status_code == 200
    r = client.post("/api/calendar/connect", json={"url": "https://cal.example/5.ics"}, headers=H)
    assert r.status_code == 409 and "5" in r.text


def test_owner_isolation(env, monkeypatch):
    feeds, _ = env
    feeds["https://cal.example/w.ics"] = FEED
    monkeypatch.setenv("APP_GUEST_SESSIONS", "1")
    monkeypatch.setenv("APP_PUBLIC_ORIGIN", ORIGIN)
    main.guest_sessions.clear(); main.guest_issue_ips.clear()
    for name in ("guest_issue_global", "guest_requests_global", "guest_requests_hour"):
        monkeypatch.setattr(main, name, main.GuestWindow())
    same = {"Origin": ORIGIN}
    with TestClient(main.app, base_url=ORIGIN) as a, TestClient(main.app, base_url=ORIGIN) as b:
        assert a.post("/api/session", headers=same).status_code == 200
        assert b.post("/api/session", headers=same).status_code == 200
        r = a.post("/api/calendar/connect", json={"url": "https://cal.example/w.ics"}, headers=same)
        assert r.status_code == 200, r.text
        cid = r.json()["id"]
        assert len(a.get("/api/calendar/list").json()["calendars"]) == 1
        assert b.get("/api/calendar/list").json()["calendars"] == []
        assert b.get("/api/calendar/events").json()["events"] == []
        assert b.delete(f"/api/calendar/{cid}", headers=same).status_code == 404
        op = TestClient(main.app, base_url=ORIGIN)
        assert op.get("/api/calendar/list", headers=H).json()["calendars"] == []
        assert len(a.get("/api/calendar/list").json()["calendars"]) == 1
    main.guest_sessions.clear(); main.guest_issue_ips.clear()


def test_requires_auth(client):
    assert client.get("/api/calendar/list").status_code == 401


# ---------------------------------------------------------------- parser

WIN = (datetime(2026, 3, 2, tzinfo=NY), datetime(2026, 3, 16, tzinfo=NY))  # Mon 2 Mar .. Mon 16 Mar


def run(*events: str, win=WIN, tz=NY):
    return calendars.agenda(ics(*events), "Home", tz, *win)


def test_all_day_tzid_utc_and_folding():
    out = run(
        "BEGIN:VEVENT\r\nUID:1\r\nDTSTART;VALUE=DATE:20260304\r\nDTEND;VALUE=DATE:20260305\r\nSUMMARY:Mum's\r\n  birthday\r\nEND:VEVENT",
        "BEGIN:VEVENT\r\nUID:2\r\nDTSTART;TZID=Europe/London:20260305T150000\r\nDTEND;TZID=Europe/London:20260305T160000\r\n"
        "SUMMARY:Call\\, London\r\nLOCATION:Zoom\r\nDESCRIPTION:" + "d" * 400 + "\r\nBEGIN:VALARM\r\nSUMMARY:nope\r\nEND:VALARM\r\nEND:VEVENT",
        "BEGIN:VEVENT\r\nUID:3\r\nDTSTART:20260306T170000Z\r\nDURATION:PT30M\r\nSUMMARY:UTC thing\r\nEND:VEVENT",
        "BEGIN:VEVENT\r\nUID:4\r\nDTSTART;TZID=\"Eastern Standard Time\":20260307T090000\r\nSUMMARY:Outlook\r\nEND:VEVENT",
        "BEGIN:VEVENT\r\nUID:5\r\nDTSTART:20260401T090000Z\r\nSUMMARY:Out of window\r\nEND:VEVENT",
        "BEGIN:VEVENT\r\nUID:6\r\nDTSTART:20260308T090000Z\r\nSTATUS:CANCELLED\r\nSUMMARY:Cancelled\r\nEND:VEVENT",
    )
    by = {e["title"]: e for e in out}
    assert set(by) == {"Mum's birthday", "Call, London", "UTC thing", "Outlook"}
    assert by["Mum's birthday"]["all_day"] and by["Mum's birthday"]["start"] == "2026-03-04" and by["Mum's birthday"]["end"] == "2026-03-05"
    assert by["Call, London"]["start"] == "2026-03-05T10:00:00-05:00" and by["Call, London"]["location"] == "Zoom"
    assert len(by["Call, London"]["description"]) == 300
    assert by["UTC thing"]["start"] == "2026-03-06T12:00:00-05:00" and by["UTC thing"]["end"] == "2026-03-06T12:30:00-05:00"
    assert by["Outlook"]["start"] == "2026-03-07T09:00:00-05:00"


def test_weekly_byday_until_exdate_and_dst():
    out = run("BEGIN:VEVENT\r\nUID:w\r\nDTSTART;TZID=America/New_York:20260202T093000\r\n"
              "DTEND;TZID=America/New_York:20260202T100000\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20260311T235959Z\r\n"
              "EXDATE;TZID=America/New_York:20260304T093000\r\nSUMMARY:Physio\r\nEND:VEVENT")
    # Mon 2, (Wed 4 excluded), Mon 9 (after DST change, still 9:30 local), Wed 11; UNTIL stops before Mon 16.
    assert [e["start"] for e in out] == ["2026-03-02T09:30:00-05:00", "2026-03-09T09:30:00-04:00", "2026-03-11T09:30:00-04:00"]


def test_daily_count_interval_monthly_and_override():
    out = run(
        "BEGIN:VEVENT\r\nUID:d\r\nDTSTART:20260301T140000Z\r\nRRULE:FREQ=DAILY;INTERVAL=2;COUNT=4\r\nSUMMARY:Pills\r\nEND:VEVENT",
        "BEGIN:VEVENT\r\nUID:m\r\nDTSTART;VALUE=DATE:20251110\r\nRRULE:FREQ=MONTHLY\r\nSUMMARY:Rent\r\nEND:VEVENT",
        "BEGIN:VEVENT\r\nUID:b\r\nDTSTART;TZID=America/New_York:20200103T080000\r\nRRULE:FREQ=WEEKLY\r\nSUMMARY:Bins\r\nEND:VEVENT",
        "BEGIN:VEVENT\r\nUID:b\r\nRECURRENCE-ID;TZID=America/New_York:20260306T080000\r\n"
        "DTSTART;TZID=America/New_York:20260306T110000\r\nSUMMARY:Bins (late)\r\nEND:VEVENT",
    )
    pills = [e["start"] for e in out if e["title"] == "Pills"]
    assert pills == ["2026-03-03T09:00:00-05:00", "2026-03-05T09:00:00-05:00", "2026-03-07T09:00:00-05:00"]  # 1st is before window
    assert [e["start"] for e in out if e["title"] == "Rent"] == ["2026-03-10"]
    bins = sorted((e["start"], e["title"]) for e in out if e["title"].startswith("Bins"))
    bins = [(t, st) for st, t in bins]
    assert bins == [("Bins (late)", "2026-03-06T11:00:00-05:00"), ("Bins", "2026-03-13T08:00:00-04:00")]


def test_route_sorts_all_day_first(client, env):
    feeds, _ = env
    today = datetime.now(timezone.utc).date() + timedelta(days=1)
    feeds["https://cal.example/s.ics"] = ics(
        f"BEGIN:VEVENT\r\nUID:x\r\nDTSTART:{today:%Y%m%d}T235000Z\r\nSUMMARY:Late\r\nEND:VEVENT",
        f"BEGIN:VEVENT\r\nUID:y\r\nDTSTART;VALUE=DATE:{today + timedelta(days=1):%Y%m%d}\r\nSUMMARY:AllDay\r\nEND:VEVENT")
    client.post("/api/calendar/connect", json={"url": "https://cal.example/s.ics"}, headers=H)
    titles = [e["title"] for e in client.get("/api/calendar/events?tz=UTC", headers=H).json()["events"]]
    assert titles == ["Late", "AllDay"]
