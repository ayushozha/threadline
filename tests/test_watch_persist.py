"""Persistent watch pairing: claimed pairings live 7 days past their last activity; the watch resumes on relaunch."""
import time

from app import main
from tests.test_watch_claim import AUTH, TOKEN, client, start  # noqa: F401  (fixture reuse)

WEEK = 7 * 24 * 3600


def paired(client):
    code, key = start(client)
    assert client.post("/api/watch/claim", json={"code": code}, headers=AUTH).status_code == 200
    return code, key, {"X-Watch-Code": code, "X-Watch-Key": key}


def resume(client, headers):
    return client.post("/api/watch/resume", headers=headers)


def test_claim_lasts_a_week(client):
    code, _, headers = paired(client)
    assert main.pairings[code].expires - time.monotonic() > WEEK - 60
    body = resume(client, headers).json()
    assert body["claimed"] is True and body["expires_in"] > WEEK - 60


def test_activity_refreshes_expiry_beyond_two_hours(client):
    with client:
        code, _, headers = paired(client)
        for path, frame in (("/api/watch/sensors", {"type": "sensors", "heart_rate": 70}),
                            ("/api/watch/cycle", {"type": "cycle", "period_starts": []})):
            main.pairings[code].expires = time.monotonic() + 60  # nearly expired
            assert client.post(path, json=frame, headers=headers).status_code == 200
            assert main.pairings[code].expires - time.monotonic() > WEEK - 60
        main.pairings[code].expires = time.monotonic() + 60
        assert client.get("/api/watch/status", headers=headers).json()["expires_in"] > 3 * 3600
        main.pairings[code].expires = time.monotonic() + 60
        with client.websocket_connect("/api/watch/feed") as feed:
            feed.send_json({"token": TOKEN, "code": code})
            assert feed.receive_json() == {"type": "waiting"}
        assert main.pairings[code].expires - time.monotonic() > WEEK - 60


def test_resume_needs_the_key(client):
    code, key, headers = paired(client)
    assert resume(client, headers).status_code == 200
    assert resume(client, {"X-Watch-Code": code}).status_code == 404
    assert resume(client, {"X-Watch-Code": code, "X-Watch-Key": "x" * 43}).status_code == 404
    assert resume(client, {"X-Watch-Code": "999999", "X-Watch-Key": key}).status_code == 404


def test_resume_unclaimed_and_expiry(client):
    code, key = start(client)
    headers = {"X-Watch-Code": code, "X-Watch-Key": key}
    body = resume(client, headers).json()
    assert body["claimed"] is False and body["expires_in"] <= 600  # polling does not extend an unclaimed code
    main.pairings[code].expires = time.monotonic() - 1
    assert resume(client, headers).status_code == 404
    assert client.post("/api/watch/claim", json={"code": code}, headers=AUTH).status_code == 404


def test_claimed_pairing_expires_after_idle_week(client):
    code, _, headers = paired(client)
    main.pairings[code].expires = time.monotonic() - 1
    assert resume(client, headers).status_code == 404
    assert client.post("/api/watch/sensors", json={"type": "sensors"}, headers=headers).status_code == 401
