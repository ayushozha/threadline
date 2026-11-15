import asyncio
import json

import httpx
import pytest

from app import agent


def body(text, confirmed=False):
    return agent.DecideRequest.model_validate({
        "statement": {"id": "current-1", "text": text, "at": "2026-11-14T17:00:00Z",
                      "source": "vexo", "speaker_confirmed": confirmed},
        "engine": "gemini",
    })


@pytest.mark.parametrize("text,state", [
    ("I'm so tired right now.", "low"),
    ("I feel exhausted today.", "low"),
    ("My energy is very low.", "low"),
    ("I feel low energy.", "low"),
    ("I am energized.", "positive"),
    ("Today, I feel productive.", "positive"),
    ("My energy is steady.", "steady"),
])
def test_explicit_current_self_report_is_source_linked(text, state):
    result = agent.local_decide(body(text))
    assert result["energy_signal"] == {"state": state, "quote": text, "source_id": "current-1",
                                       "speaker_confirmed": False}


@pytest.mark.parametrize("text", [
    "I am not tired.", "I'm not exhausted.", "I was tired yesterday.", "I felt energized last week.",
    "My friend is tired.", "She is exhausted.", "If I feel tired, remind me to rest.",
    'She said "I feel tired".', "Am I tired?", "I feel excited about that film.",
    "The room is quiet.", "My watch shows 95 beats per minute.", "It is cycle day 25.",
    "I feel low.", "I might feel tired tomorrow.",
])
def test_local_fallback_does_not_infer_energy(text):
    assert agent.local_decide(body(text))["energy_signal"] is None


@pytest.mark.parametrize("text", ["I am not tired.", "I was tired yesterday.", "My friend is exhausted.",
                                 "If I am tired, call me.", 'She said "I am tired".', "Am I tired?"])
def test_model_cannot_override_obvious_english_context_exclusions(text):
    result = agent.finalize(body(text), "gemini", {"action": "none", "energy_state": "low"})
    assert result["energy_signal"] is None


def test_signal_attribution_and_quote_always_come_from_request():
    source = body("I feel tired.\nI need a break.", confirmed=True)
    result = agent.finalize(source, "gemini", {
        "action": "none", "energy_state": "low", "energy_signal": {
            "state": "positive", "quote": "invented", "source_id": "other-person", "speaker_confirmed": False,
        },
    })
    assert result["energy_signal"] == {"state": "low", "quote": source.statement.text,
                                       "source_id": "current-1", "speaker_confirmed": True}


@pytest.mark.parametrize("state", ["not_stated", "unknown", "stressed", None, {"state": "low"}])
def test_absent_or_unsupported_model_signal_is_null(state):
    assert agent.finalize(body("I feel tired."), "gemini", {"energy_state": state})["energy_signal"] is None


@pytest.mark.parametrize("text,state", [
    ("मलाई अहिले धेरै थकाइ लागेको छ।", "low"),
    ("Me siento llena de energia ahora.", "positive"),
])
def test_multilingual_signal_uses_same_decisions_request_without_invented_evidence(monkeypatch, text, state):
    real_client = httpx.AsyncClient
    seen = []

    def respond(req):
        payload = json.loads(req.content)
        seen.append(payload)
        energy = payload["questions"]["energy"]
        assert set(energy["criteria"]) == {"low", "positive", "steady", "not_stated"}
        assert "tone" in energy["instructions"] and "any language" in energy["instructions"]
        return httpx.Response(200, json={"answers": {
            "action": {"choice": "none", "confidence": 0.99},
            "energy": {"choice": state, "confidence": 0.95},
        }})

    monkeypatch.setattr(agent.httpx, "AsyncClient", lambda **kwargs: real_client(transport=httpx.MockTransport(respond), **kwargs))
    result = asyncio.run(agent.decide(body(text), {"GOOGLE_API_KEY": "test-key", "GEMINI_DECISION_MODEL": "test-model"}, asyncio.Semaphore(1)))
    assert len(seen) == 1
    assert result["energy_signal"] == {"state": state, "quote": text, "source_id": "current-1",
                                       "speaker_confirmed": False}


def test_low_confidence_model_energy_is_not_reported(monkeypatch):
    real_client = httpx.AsyncClient

    def respond(req):
        return httpx.Response(200, json={"answers": {
            "action": {"choice": "none", "confidence": 0.99},
            "energy": {"choice": "low", "confidence": 0.2},
        }})

    monkeypatch.setattr(agent.httpx, "AsyncClient", lambda **kwargs: real_client(transport=httpx.MockTransport(respond), **kwargs))
    result = asyncio.run(agent.decide(body("I feel tired."), {"GOOGLE_API_KEY": "test-key", "GEMINI_DECISION_MODEL": "test-model"}, asyncio.Semaphore(1)))
    assert result["energy_signal"] is None


def test_interactions_energy_field_is_parsed_with_exact_source(monkeypatch):
    real_client = httpx.AsyncClient

    def respond(req):
        payload = json.loads(req.content)
        assert "energy_state" in payload["input"] and "CURRENT" in payload["input"]
        return httpx.Response(200, json={"steps": [{"type": "model_output", "content": [{
            "type": "text", "text": json.dumps({"action": "none", "energy_state": "steady"}),
        }]}]})

    monkeypatch.setattr(agent.httpx, "AsyncClient", lambda **kwargs: real_client(transport=httpx.MockTransport(respond), **kwargs))
    source = body("My energy feels steady.", confirmed=True)
    result = asyncio.run(agent.decide(source, {"GOOGLE_API_KEY": "test-key", "GEMINI_MODEL": "test-model"}, asyncio.Semaphore(1)))
    assert result["energy_signal"] == {"state": "steady", "quote": source.statement.text,
                                       "source_id": "current-1", "speaker_confirmed": True}
