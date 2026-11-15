"""iCloud CalDAV adapter against a fake iCloud. Synthetic account; no network."""
import httpx
import pytest
from fastapi.testclient import TestClient

from app import caldav, main

ICS = """BEGIN:VCALENDAR
BEGIN:VEVENT
UID:abc-1
DTSTART:20261114T150000Z
DTEND:20261114T160000Z
SUMMARY:Dentist\\, Dr. Lee
BEGIN:VALARM
TRIGGER:-PT15M
DESCRIPTION:alarm text
END:VALARM
END:VEVENT
BEGIN:VEVENT
UID:abc-2
DTSTART;TZID=America/New_York:20261115T090000
DURATION:PT30M
SUMMARY:Standup
END:VEVENT
BEGIN:VEVENT
UID:abc-3
DTSTART;VALUE=DATE:20261116
SUMMARY:Holiday
END:VEVENT
END:VCALENDAR
"""


def fake_icloud(log, ics=ICS, put_status=201):
    def handler(request: httpx.Request) -> httpx.Response:
        log.append((request.method, str(request.url), dict(request.headers)))
        if request.headers.get("authorization") is None:
            return httpx.Response(401)
        url, body = str(request.url), request.content.decode()
        if request.method == "PROPFIND" and url == "https://caldav.icloud.com/":
            return httpx.Response(207, text='<d:multistatus xmlns:d="DAV:"><d:response><d:propstat><d:prop><d:current-user-principal><d:href>/123/principal/</d:href></d:current-user-principal></d:prop></d:propstat></d:response></d:multistatus>')
        if request.method == "PROPFIND" and url.endswith("/principal/"):
            return httpx.Response(207, text='<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:propstat><d:prop><c:calendar-home-set><d:href>https://p01-caldav.icloud.com/123/calendars/</d:href></c:calendar-home-set></d:prop></d:propstat></d:response></d:multistatus>')
        if request.method == "PROPFIND":
            return httpx.Response(207, text='''<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
              <d:response><d:href>/123/calendars/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
              <d:response><d:href>/123/calendars/home/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Home</d:displayname>
                <c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set></d:prop></d:propstat></d:response>
              <d:response><d:href>/123/calendars/reminders/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Reminders</d:displayname>
                <c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set></d:prop></d:propstat></d:response>
            </d:multistatus>''')
        if request.method == "REPORT":
            assert "expand" in body and "time-range" in body
            return httpx.Response(207, text=f'<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:propstat><d:prop><c:calendar-data>{ics}</c:calendar-data></d:prop></d:propstat></d:response></d:multistatus>')
        if request.method == "PUT":
            return httpx.Response(put_status)
        return httpx.Response(500)
    return httpx.MockTransport(handler)


AUTH = {"username": "someone@example.com", "password": "abcd-efgh-ijkl-mnop"}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("APP_ACCESS_TOKEN", "test-only-access")
    return TestClient(main.app), {"X-App-Token": "test-only-access"}


def test_reads_events_from_event_calendars_only(client, monkeypatch):
    c, h = client
    log = []
    monkeypatch.setattr(caldav, "_transport", fake_icloud(log))
    r = c.post("/api/apple/events", headers=h, json={"auth": AUTH, "start": "2026-11-14", "end": "2026-11-20"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["calendars"] == ["Home"]                       # VTODO-only calendar skipped
    titles = [e["title"] for e in body["events"]]
    assert titles == ["Dentist, Dr. Lee", "Standup", "Holiday"] or sorted(titles) == sorted(["Dentist, Dr. Lee", "Standup", "Holiday"])
    by = {e["title"]: e for e in body["events"]}
    assert by["Dentist, Dr. Lee"]["start"] == "2026-11-14T15:00:00Z" and "alarm" not in str(body)
    assert by["Standup"]["start"] == "2026-11-15T14:00:00Z" and by["Standup"]["end"].startswith("2026-11-15T14:30")  # NY → UTC
    assert by["Holiday"]["all_day"] is True and by["Holiday"]["end"] == "2026-11-17"
    assert all(host.startswith("https://") and "icloud.com" in host for _, host, _ in log)
    assert "abcd-efgh" not in r.text                           # password never echoed


def test_create_event_puts_ics_after_discovery(client, monkeypatch):
    c, h = client
    log = []
    monkeypatch.setattr(caldav, "_transport", fake_icloud(log))
    r = c.post("/api/apple/create", headers=h, json={"auth": AUTH, "title": "Pick these back up", "notes": "Tax form; Plan trip",
                                                     "start": "2026-11-16", "end": "2026-11-17", "all_day": True})
    assert r.status_code == 200 and r.json()["calendar"] == "Home"
    method, url, headers = log[-1]
    assert method == "PUT" and url.startswith("https://p01-caldav.icloud.com/123/calendars/home/") and url.endswith(".ics")
    assert headers["if-none-match"] == "*"


def test_ics_builder_escapes_and_handles_timed_events():
    uid, ics = caldav.build_ics("Lunch; with, Sam", "a\nb", "2026-11-14T12:00:00-05:00", "2026-11-14T13:00:00-05:00", False)
    assert "SUMMARY:Lunch\\; with\\, Sam" in ics and "DESCRIPTION:a\\nb" in ics
    assert "DTSTART:20261114T170000Z" in ics and "DTEND:20261114T180000Z" in ics
    assert uid in ics


def test_bad_credentials_and_foreign_hosts(client, monkeypatch):
    c, h = client
    monkeypatch.setattr(caldav, "_transport", httpx.MockTransport(lambda r: httpx.Response(401)))
    r = c.post("/api/apple/events", headers=h, json={"auth": AUTH, "start": "2026-11-14", "end": "2026-11-15"})
    assert r.status_code == 401 and "app-specific" in r.json()["detail"]

    def evil(request):
        if request.url.host == "caldav.icloud.com" and b"current-user-principal" in request.content:
            return httpx.Response(207, text='<d:multistatus xmlns:d="DAV:"><d:response><d:propstat><d:prop><d:current-user-principal><d:href>https://evil.example.com/x/</d:href></d:current-user-principal></d:prop></d:propstat></d:response></d:multistatus>')
        pytest.fail(f"contacted {request.url}")
    monkeypatch.setattr(caldav, "_transport", httpx.MockTransport(evil))
    r = c.post("/api/apple/events", headers=h, json={"auth": AUTH, "start": "2026-11-14", "end": "2026-11-15"})
    assert r.status_code == 502


def test_requires_token_and_validates_range(client):
    c, h = client
    assert c.post("/api/apple/events", json={"auth": AUTH, "start": "2026-11-14", "end": "2026-11-15"}).status_code == 401
    assert c.post("/api/apple/events", headers=h, json={"auth": AUTH, "start": "2026-01-01", "end": "2026-12-31"}).status_code in (422, 502)
    assert c.post("/api/apple/events", headers=h, json={"auth": {**AUTH, "password": "short"}, "start": "2026-11-14", "end": "2026-11-15"}).status_code == 422


def test_csp_allows_google_only_when_client_id_configured(client, monkeypatch):
    c, _ = client
    monkeypatch.delenv("GOOGLE_OAUTH_CLIENT_ID", raising=False)
    assert "google" not in c.get("/api/health").headers["Content-Security-Policy"]
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "test-only.apps.googleusercontent.com")
    csp = c.get("/api/health").headers["Content-Security-Policy"]
    assert "https://accounts.google.com/gsi/client" in csp and "https://www.googleapis.com" in csp
    assert "script-src 'self' https://accounts.google.com/gsi/client;" in csp
