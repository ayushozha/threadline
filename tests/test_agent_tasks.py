from datetime import date, timedelta

import httpx
import pytest
from fastapi.testclient import TestClient

from app import main
from tests.test_api import AUTH, decide_body, mock_gemini

REAL_CLIENT = httpx.AsyncClient


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("APP_ACCESS_TOKEN", "test-only-access")
    return TestClient(main.app)


def day(offset: int) -> str:
    return (date.today() + timedelta(days=offset)).isoformat()


def tasks():
    return [
        {"id": "t-offer", "title": "Accept the job offer", "due": day(2), "big_decision": True, "done": False},
        {"id": "t-later", "title": "Choose a flat", "due": day(10), "big_decision": True, "done": False},
        {"id": "t-email", "title": "Reply to Sam", "due": day(5), "big_decision": False, "done": False},
        {"id": "t-done", "title": "Book dentist", "due": day(1), "big_decision": False, "done": True},
    ]


def body(text, engine="local", **extra):
    b = decide_body(engine, preferences=[], tasks=tasks(), **extra)
    b["statement"]["text"] = text
    return b


def post(client, b):
    response = client.post("/api/agent/decide", headers=AUTH, json=b)
    assert response.status_code == 200, response.text
    return response.json()


def test_local_low_energy_holds_big_decision_due_soon(client):
    result = post(client, body("I'm so drained today"))
    assert result["action"] == "hold_decision" and result["task_id"] == "t-offer" and result["auto"] is False
    assert "Accept the job offer" in result["message"] and result["note"] is None and result["music"] is None


def test_local_low_energy_without_eligible_big_decision_uses_existing_logic(client):
    b = body("I'm exhausted")
    b["tasks"] = [t for t in tasks() if t["id"] != "t-offer"]  # only a big decision due in 10 days
    result = post(client, b)
    assert result["action"] == "none" and result["task_id"] is None


def test_local_positive_energy_moves_non_big_task_to_today(client):
    result = post(client, body("Feeling motivated and productive"))
    assert result["action"] == "move_to_today" and result["task_id"] == "t-email" and result["auto"] is False


def test_local_music_and_calendar_note(client):
    result = post(client, body("Could you put on some music"))
    assert result["action"] == "music" and result["music"] == {"mood": "steady"} and result["auto"] is False
    result = post(client, body("Add a note about Choose a flat: ask about the deposit"))
    assert result["action"] == "calendar_note" and result["task_id"] == "t-later" and result["auto"] is False
    assert result["note"] and len(result["note"]) <= 140 and "deposit" in result["note"]


def test_gemini_invented_task_id_is_downgraded(client, monkeypatch):
    mock_gemini(monkeypatch, {"action": "hold_decision", "task_id": "t-404", "evidence": [], "reason": 'You said "tired".', "message": "Hold it?"})
    result = post(client, body("I'm tired", "gemini"))
    assert result["action"] == "none" and result["task_id"] is None and result["auto"] is True


def test_gemini_big_decision_rule_is_enforced(client, monkeypatch):
    for task_id in ("t-email", "t-later", "t-done"):  # not big / due too late / done
        monkeypatch.setattr(httpx, "AsyncClient", REAL_CLIENT)
        mock_gemini(monkeypatch, {"action": "hold_decision", "task_id": task_id, "evidence": [], "reason": "x", "message": "y"})
        result = post(client, body("I'm tired", "gemini"))
        assert result["engine"] == "gemini" and result["action"] == "none", task_id
    monkeypatch.setattr(httpx, "AsyncClient", REAL_CLIENT)
    mock_gemini(monkeypatch, {"action": "hold_decision", "task_id": "t-offer", "evidence": [], "reason": 'You said "tired".', "message": "Hold the offer?"})
    result = post(client, body("I'm tired", "gemini"))
    assert result["engine"] == "gemini" and result["action"] == "hold_decision" and result["task_id"] == "t-offer"


def test_gemini_move_to_today_without_tasks_is_downgraded(client, monkeypatch):
    mock_gemini(monkeypatch, {"action": "move_to_today", "task_id": "t-email", "evidence": [], "reason": "x", "message": "y"})
    b = body("Feeling great", "gemini")
    b["tasks"] = []
    result = post(client, b)
    assert result["action"] == "none" and result["task_id"] is None


def test_gemini_unstated_low_energy_wording_and_bad_mood_are_replaced(client, monkeypatch):
    mock_gemini(monkeypatch, {"action": "music", "music": {"mood": "Song X by Y"}, "evidence": [],
                              "reason": "You sound exhausted", "message": "You seem burnt out, here is calm music."})
    result = post(client, body("Some music please, I feel excited", "gemini"))
    assert result["action"] == "music" and result["music"] == {"mood": "uplifting"}
    assert "exhausted" not in result["reason"] and "burnt" not in result["message"]


def test_new_context_fields_are_accepted_and_bad_dates_rejected(client):
    b = body("ok", voice={"words_per_min": 140, "avg_pause_s": 0.6, "loudness": 0.4, "talk_share": 0.5})
    b["today"].update(hrv_sdnn_ms=42.5, resting_hr=61, sleep_hours=6.5)
    assert post(client, b)["action"] == "none"
    b["tasks"][0]["due"] = "2026-13-40"
    assert client.post("/api/agent/decide", headers=AUTH, json=b).status_code == 422
