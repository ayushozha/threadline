import asyncio
import json
from datetime import date, timedelta

import httpx
import pytest

from app import agent


def request(text, **changes):
    body = {"statement": {"id": "heard-1", "text": text, "at": "2026-11-14T12:00:00Z",
                          "source": "vexo", "speaker_confirmed": False}}
    body.update(changes)
    return agent.DecideRequest.model_validate(body)


def test_explicit_reminder_creates_reviewable_source_linked_draft_with_no_existing_tasks():
    body = request("Remind me to call mom tomorrow.")
    result = agent.local_decide(body)
    assert result["action"] == "create_task" and result["auto"] is False
    assert result["message"] == "Save this as a task?"
    assert result["draft_task"] == {"title": "call mom", "due": (date.today() + timedelta(days=1)).isoformat(),
                                    "source_id": "heard-1"}
    assert result["evidence"] == ["heard-1"]
    assert body.statement.text in result["reason"]
    assert body.tasks == []  # No mutation or save before the user approves.
    assert result["task_id"] is None


@pytest.mark.parametrize("text", ["What is that?", "That you shared. Oh it's my own. So.",
                                 "I’m exhausted.", "Tomorrow looks sunny.", "Remember?"])
def test_ordinary_fragments_do_not_create_tasks(text):
    result = agent.local_decide(request(text))
    assert result["action"] == "none"
    assert result["message"] == "Listening. No action proposed."
    assert "draft_task" not in result


@pytest.mark.parametrize("text,expected_title,offset", [
    ("Please remind me to buy milk today", "buy milk", 0),
    ("Remember to send the report", "send the report", None),
    ("Add a task: book the train next week", "book the train next week", None),
    ("Remind me to call tomorrow or today", "call tomorrow or today", None),
    ("Remind me to call mom, not tomorrow", "call mom, not tomorrow", None),
])
def test_only_unambiguous_literal_today_or_tomorrow_sets_a_date(text, expected_title, offset):
    result = agent.local_decide(request(text))
    assert result["action"] == "create_task"
    assert result["draft_task"]["title"] == expected_title
    expected_due = None if offset is None else (date.today() + timedelta(days=offset)).isoformat()
    assert result["draft_task"]["due"] == expected_due


def test_duplicate_canonical_title_does_not_create_or_escalate_task():
    body = request("Remind me to call mom tomorrow.", tasks=[{
        "id": "old", "title": "Call MOM!", "due": None, "big_decision": True,
    }])
    original = body.tasks[0].model_dump()
    result = agent.local_decide(body)
    assert result["action"] == "none" and "draft_task" not in result
    assert body.tasks[0].model_dump() == original


def test_model_cannot_invent_task_text_or_due_date_or_auto_save():
    body = request("Remind me to call mom tomorrow.")
    result = agent.finalize(body, "gemini", {
        "action": "create_task", "auto": True, "evidence": ["invented"],
        "draft_task": {"title": "Send money", "due": "2099-01-01", "source_id": "invented"},
        "message": "Task saved.", "reason": "Because of hormones.",
    })
    assert result["draft_task"]["title"] == "call mom"
    assert result["draft_task"]["source_id"] == "heard-1"
    assert result["draft_task"]["due"] == (date.today() + timedelta(days=1)).isoformat()
    assert result["auto"] is False and result["message"] == "Save this as a task?"
    assert result["evidence"] == ["heard-1"]


def test_multilingual_model_choice_keeps_exact_literal_text_and_no_inferred_date():
    text = "मुझे कल माँ को फ़ोन करने की याद दिलाना।"
    result = agent.finalize(request(text), "gemini", {"action": "create_task"})
    assert result["action"] == "create_task" and result["auto"] is False
    assert result["draft_task"] == {"title": text, "due": None, "source_id": "heard-1"}


@pytest.mark.parametrize("text", ["Recuerdame comprar pan", "Bholi aamalaai phone garna samjhaunu"])
def test_ascii_multilingual_model_choice_keeps_literal_reviewable_draft(text):
    body = request(text)
    assert agent.local_decide(body)["action"] == "none"
    result = agent.finalize(body, "gemini", {"action": "create_task", "auto": True})
    assert result["action"] == "create_task" and result["auto"] is False
    assert result["message"] == "Save this as a task?"
    assert result["draft_task"] == {"title": text, "due": None, "source_id": "heard-1"}


def test_task_title_is_bounded_and_source_is_preserved():
    text = "Remind me to " + "review " * 45 + "tomorrow"
    result = agent.local_decide(request(text))
    assert result["action"] == "create_task"
    assert len(result["draft_task"]["title"]) <= 200
    assert result["draft_task"]["source_id"] == "heard-1"


def test_gemini_decision_can_select_capture_without_an_existing_task_list(monkeypatch):
    real_client = httpx.AsyncClient
    seen = []

    def respond(req):
        payload = json.loads(req.content)
        seen.append(payload)
        assert "create_task" in payload["questions"]["action"]["criteria"]
        assert "task" not in payload["questions"]
        return httpx.Response(200, json={"answers": {"action": {"choice": "create_task", "confidence": 0.98}}})

    monkeypatch.setattr(agent.httpx, "AsyncClient", lambda **kwargs: real_client(transport=httpx.MockTransport(respond), **kwargs))
    body = request("Remind me to call mom tomorrow.", engine="gemini")
    result = asyncio.run(agent.decide(body, {"GOOGLE_API_KEY": "test-key", "GEMINI_DECISION_MODEL": "test-model"}, asyncio.Semaphore(1)))
    assert seen and result["engine"] == "gemini" and result["action"] == "create_task"
    assert result["draft_task"]["source_id"] == "heard-1"
    assert result["confidence"] == 0.98
