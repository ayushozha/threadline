"""A visitor on the hosted site pairs by typing the code the watch shows, then receives its readings."""
from tests.test_guest_sessions import SAME_ORIGIN, guest_client, issue  # noqa: F401  (fixture reuse)


def test_visitor_follows_watch_started_pairing(guest_client):
    issue(guest_client)
    started = guest_client.post("/api/watch/start", json={"device": "Apple Watch"}).json()
    code, key = started["code"], started["watch_key"]
    assert guest_client.post("/api/watch/claim", json={"code": code}, headers=SAME_ORIGIN).status_code == 200
    with guest_client.websocket_connect("wss://threadline.example/api/watch/feed", headers=SAME_ORIGIN) as ws:
        ws.send_json({"code": code})
        assert ws.receive_json()["type"] == "waiting"
        sent = guest_client.post("/api/watch/sensors", json={"type": "sensors", "heart_rate": 71},
                                 headers={"X-Watch-Code": code, "X-Watch-Key": key})
        assert sent.status_code == 200
        frames = [ws.receive_json() for _ in range(2)]
        assert any(f.get("type") == "sensors" and f.get("heart_rate") == 71 for f in frames)


def test_visitor_still_cannot_follow_unclaimed_watch_code(guest_client):
    issue(guest_client)
    code = guest_client.post("/api/watch/start", json={"device": "Apple Watch"}).json()["code"]
    with guest_client.websocket_connect("wss://threadline.example/api/watch/feed", headers=SAME_ORIGIN) as ws:
        ws.send_json({"code": code})
        assert "token" in ws.receive_json()["message"]
