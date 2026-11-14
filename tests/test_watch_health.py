import pytest
from fastapi.testclient import TestClient

from app import main

TOKEN = "test-only-access"
HEALTH = {
    "hrv_sdnn_ms": 48.26, "resting_hr": 58, "respiratory_rate": 14.4, "spo2": 97.5, "wrist_temp_delta_c": -0.234,
    "sleep_hours_last_night": 7.256, "env_noise_db": 62.3, "exercise_min_today": 31, "mindful_min_today": 10,
}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("APP_ACCESS_TOKEN", TOKEN)
    monkeypatch.setattr(main, "SENSOR_MIN_INTERVAL", 0)
    monkeypatch.setattr(main, "pairings", {})  # each test starts with no codes (MAX_PAIRINGS is global)
    return TestClient(main.app)


def pair_and_feed(client, feed):
    code = client.post("/api/watch/pair", headers={"X-App-Token": TOKEN}).json()["code"]
    feed.send_json({"token": TOKEN, "code": code})
    assert feed.receive_json() == {"type": "waiting"}
    return code


def attach_ws_watch(watch, feed, code):
    watch.send_json({"code": code, "device": "Apple Watch", "format": "sensors"})
    assert watch.receive_json() == {"type": "ready", "source": "sensors"}
    assert feed.receive_json()["type"] == "watch_connected"


def test_health_fields_validated_and_forwarded(client):
    with client:
        with client.websocket_connect("/api/watch/feed") as feed:
            code = pair_and_feed(client, feed)
            with client.websocket_connect("/api/watch/stream") as watch:
                attach_ws_watch(watch, feed, code)
                mood = {"valence": 0.456, "labels": ["calm", "grateful"], "at": "2026-11-14T09:00:00Z"}
                watch.send_json({"type": "sensors", "heart_rate": 70, **HEALTH, "state_of_mind": mood, "vo2max": 40})
                assert feed.receive_json() == {
                    "type": "sensors", "heart_rate": 70.0, "hrv_sdnn_ms": 48.3, "resting_hr": 58.0,
                    "respiratory_rate": 14.4, "spo2": 97.5, "wrist_temp_delta_c": -0.23, "sleep_hours_last_night": 7.26,
                    "env_noise_db": 62.3, "exercise_min_today": 31.0, "mindful_min_today": 10.0,
                    "state_of_mind": {"valence": 0.46, "labels": ["calm", "grateful"], "at": "2026-11-14T09:00:00Z"},
                    "device": "Apple Watch",
                }
                watch.send_json({"type": "stop"})
                assert watch.receive_json()["type"] == "closed"


@pytest.mark.parametrize("bad", [
    {"hrv_sdnn_ms": 4}, {"hrv_sdnn_ms": 301}, {"resting_hr": 201}, {"respiratory_rate": 3}, {"spo2": 0.97},
    {"spo2": 101}, {"wrist_temp_delta_c": 5.1}, {"sleep_hours_last_night": 25}, {"env_noise_db": 10},
    {"exercise_min_today": -1}, {"mindful_min_today": 2000}, {"resting_hr": True}, {"spo2": "98"},
    {"state_of_mind": {"valence": 1.5, "labels": []}}, {"state_of_mind": {"valence": 0, "labels": ["sleepy"]}},
    {"state_of_mind": {"valence": 0, "labels": ["calm", "sad", "happy", "proud"]}}, {"state_of_mind": "good"},
])
def test_out_of_range_health_fields_dropped_over_http(client, bad):
    with client:
        with client.websocket_connect("/api/watch/feed") as feed:
            code = pair_and_feed(client, feed)
            response = client.post("/api/watch/sensors", headers={"X-Watch-Code": code}, json={"type": "sensors", **bad})
            assert response.json() == {"forwarded": True}
            assert feed.receive_json()["type"] == "watch_connected"
            assert feed.receive_json() == {"type": "sensors", "device": "Apple Watch"}


def test_log_mood_validated_and_forwarded_to_ws_watch_and_reply_reaches_feed(client):
    with client:
        with client.websocket_connect("/api/watch/feed") as feed:
            code = pair_and_feed(client, feed)
            feed.send_json({"type": "log_mood", "valence": 0.5, "labels": ["calm"]})
            assert feed.receive_json() == {"type": "error", "message": "No watch connected"}
            with client.websocket_connect("/api/watch/stream") as watch:
                attach_ws_watch(watch, feed, code)
                for bad in ({"valence": 2, "labels": []}, {"valence": "0.5"}, {"valence": 0, "labels": ["meh"]},
                            {"valence": 0, "labels": ["calm", "sad", "happy", "proud"]}, {"valence": 0, "labels": "calm"}):
                    feed.send_json({"type": "log_mood", **bad})
                    assert feed.receive_json()["type"] == "error"
                feed.send_json({"type": "log_mood", "valence": -0.333, "labels": ["stressed", "drained"], "reason": " r" * 60})
                assert feed.receive_json() == {"type": "log_mood_sent"}
                command = watch.receive_json()
                assert command == {"type": "log_mood", "valence": -0.33, "labels": ["stressed", "drained"],
                                   "reason": ("r " * 60)[:80]}
                watch.send_json({"type": "mood_logged"})
                assert feed.receive_json() == {"type": "mood_logged", "device": "Apple Watch"}
                watch.send_json({"type": "mood_declined"})
                assert feed.receive_json() == {"type": "mood_declined", "device": "Apple Watch"}
                watch.send_json({"type": "stop"})
                assert watch.receive_json()["type"] == "closed"


def test_log_mood_queued_in_https_sensors_commands_and_reply_over_http(client):
    with client:
        assert client.post("/api/watch/mood", headers={"X-Watch-Code": "bad"}, json={"type": "mood_logged"}).status_code == 401
        with client.websocket_connect("/api/watch/feed") as feed:
            code = pair_and_feed(client, feed)
            headers = {"X-Watch-Code": code, "X-Watch-Device": "Wrist"}
            assert client.post("/api/watch/sensors", headers=headers, json={"type": "sensors"}).json() == {"forwarded": True}
            assert feed.receive_json()["type"] == "watch_connected"
            assert feed.receive_json()["type"] == "sensors"
            for valence in (0.1, 0.2, 0.3, 0.4):
                feed.send_json({"type": "log_mood", "valence": valence, "labels": ["happy"]})
                assert feed.receive_json() == {"type": "log_mood_sent"}
            response = client.post("/api/watch/sensors", headers=headers, json={"type": "sensors"}).json()
            assert [c["valence"] for c in response["commands"]] == [0.2, 0.3, 0.4]  # at most 3 queued
            assert response["commands"][0] == {"type": "log_mood", "valence": 0.2, "labels": ["happy"], "reason": ""}
            assert feed.receive_json()["type"] == "sensors"
            assert "commands" not in client.post("/api/watch/sensors", headers=headers, json={"type": "sensors"}).json()
            assert feed.receive_json()["type"] == "sensors"
            assert client.post("/api/watch/mood", headers=headers, json={"type": "mood_logged"}).json() == {"forwarded": True}
            assert feed.receive_json() == {"type": "mood_logged", "device": "Wrist"}
            assert client.post("/api/watch/mood", headers=headers, json={"type": "log_mood"}).status_code == 422
