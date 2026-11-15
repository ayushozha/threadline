import asyncio
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app import care_agent, main

TOKEN = {"X-App-Token": "test-only-access"}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("APP_ACCESS_TOKEN", "test-only-access")
    monkeypatch.delenv("APP_TRUST_LOOPBACK", raising=False)
    return TestClient(main.app)


def post(client, context, engine="local"):
    response = client.post("/api/care/assess", headers=TOKEN, json={"context": context, "engine": engine})
    assert response.status_code == 200, response.text
    return response.json()


def mock_gemini(monkeypatch, proposal: dict):
    monkeypatch.setenv("GOOGLE_API_KEY", "test-only-key")
    monkeypatch.setenv("GEMINI_MODEL", "test-model")
    real = httpx.AsyncClient
    seen = {}

    def respond(request):
        seen["payload"] = json.loads(request.content)
        return httpx.Response(200, json={"steps": [{"type": "model_output", "content": [
            {"type": "text", "text": "```json\n" + json.dumps(proposal) + "\n```"}]}]})

    monkeypatch.setattr(care_agent.httpx, "AsyncClient",
                        lambda **kw: real(transport=httpx.MockTransport(respond), **kw))
    return seen


def test_auth_required(client):
    assert client.post("/api/care/assess", json={"engine": "local"}).status_code == 401


def test_empty_context_is_ok(client):
    for context in (None, {}, {"transcript": [], "band": {"connected": False}}):
        body = post(client, context, engine="gemini")
        assert body["status"] == "ok" and body["summary"] == "Not enough information yet."


def test_local_free_fall_is_urgent(client):
    body = post(client, {"band": {"activity": "still", "free_fall_last_10min": True, "connected": True}})
    assert body["engine"] == "local" and body["status"] == "urgent"
    assert any("free fall" in r.lower() for r in body["reasons"])


def test_local_help_phrase_is_urgent(client):
    body = post(client, {"transcript": [{"at": "10:00", "speaker": "Mum", "text": "I fell and I can't get up"}]})
    assert body["status"] == "urgent"


def test_local_repeated_question_and_high_hr(client):
    q = [{"text": "Where is my bag?"}] * 3
    assert post(client, {"transcript": q})["status"] == "needs_attention"
    body = post(client, {"band": {"activity": "still"}, "health": {"heart_rate": 130}})
    assert body["status"] == "needs_attention"
    assert not care_agent.DIAGNOSIS_RE.search(json.dumps(body))
    assert post(client, {"band": {"activity": "walking"}})["status"] == "ok"


def test_gemini_urgent_without_cause_is_downgraded(client, monkeypatch):
    seen = mock_gemini(monkeypatch, {
        "status": "urgent", "summary": "Something seems wrong.", "observations": ["Sitting at the table."],
        "next_step": "Check in gently.", "caregiver_note": "Calm afternoon.",
        "reasons": ["Band activity is still.", "Their pulse oximeter app says so."],
    })
    body = post(client, {"band": {"activity": "still"}, "observations": [{"text": "Sitting at the table"}]}, "gemini")
    assert body["engine"] == "gemini" and body["status"] == "needs_attention"
    assert body["reasons"] == ["Band activity is still."]  # second reason cites no provided input
    assert seen["payload"]["store"] is False and seen["payload"]["model"] == "test-model"


def test_gemini_cannot_soften_a_fall(client, monkeypatch):
    mock_gemini(monkeypatch, {"status": "ok", "summary": "All calm.", "next_step": "Relax."})
    assert post(client, {"band": {"free_fall_last_10min": True}}, "gemini")["status"] == "urgent"


def test_medication_claim_rewritten_and_diagnosis_stripped(client, monkeypatch):
    mock_gemini(monkeypatch, {
        "status": "needs_attention",
        "summary": "She took her pills at breakfast. This looks like sundowning from Alzheimer's progression.",
        "observations": ["Possible UTI.", "Making tea.", "Face recognized as her son David."],
        "next_step": "She hasn't taken her medication yet.",
        "caregiver_note": "Could be delirium or a stroke. She is calm now.",
        "reasons": ["Routine: Pills with breakfast."],
    })
    body = post(client, {"routine": ["Pills with breakfast"], "transcript": [{"text": "I'm making tea"}]}, "gemini")
    text = json.dumps(body)
    assert not care_agent.DIAGNOSIS_RE.search(text)
    assert body["summary"] == care_agent.MEDICATION_REWRITE
    assert body["next_step"] == care_agent.MEDICATION_REWRITE
    assert body["observations"] == ["Making tea."]
    assert body["caregiver_note"] == "She is calm now."


def test_gemini_failure_falls_back_to_local(client, monkeypatch):
    monkeypatch.setenv("GOOGLE_API_KEY", "test-only-key")
    monkeypatch.setenv("GEMINI_MODEL", "test-model")
    real = httpx.AsyncClient
    monkeypatch.setattr(care_agent.httpx, "AsyncClient", lambda **kw: real(
        transport=httpx.MockTransport(lambda r: httpx.Response(500)), **kw))
    body = post(client, {"transcript": [{"text": "help"}]}, "gemini")
    assert body["engine"] == "local" and body["status"] == "urgent" and "fallback_reason" in body


def test_input_caps_keep_newest(client):
    transcript = [{"text": f"line {i}"} for i in range(60)] + [{"text": "please help"}]
    assert post(client, {"transcript": transcript})["status"] == "urgent"


@pytest.mark.parametrize("mode,expected", [
    ("memory", "Gently mention"), ("sight", "object or text"),
    ("hearing", "captions"), ("mobility", "assistance"),
])
def test_care_mode_changes_prompt_and_local_step(client, mode, expected):
    body = post(client, {"mode": mode, "routine": ["Tea at four"]})
    assert body["mode"] == mode
    assert expected in body["next_step"]
    prompt = care_agent.prompt(care_agent.CareContext(mode=mode, routine=["Tea at four"]))
    assert f"{mode.upper()} assistance mode" in prompt
    assert "external action" in prompt


def test_care_rejects_unknown_mode(client):
    assert client.post("/api/care/assess", headers=TOKEN,
                       json={"context": {"mode": "doctor"}, "engine": "local"}).status_code == 422


def test_repetition_does_not_imply_memory_difficulty_in_other_modes(client):
    repeated = [{"text": "Where is the exit?"}] * 3
    for mode in ("sight", "hearing", "mobility"):
        assert post(client, {"mode": mode, "transcript": repeated})["status"] == "ok"


def test_unexecuted_external_action_claims_are_not_presented_as_completed(client, monkeypatch):
    mock_gemini(monkeypatch, {"status": "needs_attention", "summary": "I have texted your family.",
                            "next_step": "Your caregiver has been notified.",
                            "caregiver_note": "The report was sent."})
    body = post(client, {"mode": "mobility", "transcript": [{"text": "Please help me"}]}, "gemini")
    for field in ("summary", "next_step", "caregiver_note"):
        assert "no delivery is performed here" in body[field]
