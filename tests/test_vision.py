import asyncio
import base64
import json

import httpx
import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app import vision


PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=")


def request(**changes):
    values = {"question": "What is left to pack?", "transcript": [
        {"id": "said-1", "text": "I need my charger and gift.", "at": "2026-11-14T12:00:00Z", "source": "vexo"}],
        "frames": [{"id": "frame-1", "at": "2026-11-14T12:00:01Z", "mime_type": "image/png",
                    "data": base64.b64encode(PNG).decode("ascii")}]}
    values.update(changes)
    return vision.VisionRequest.model_validate(values)


def result(**changes):
    value = {"answer": "A charger is visible.", "next_step": "Check whether the gift is in the bag.",
             "observations": [{"frame_id": "frame-1", "description": "A charger is beside the bag."}],
             "uncertainties": ["The bag's contents are not visible."],
             "frame_ids": ["frame-1"], "transcript_ids": ["said-1"]}
    value.update(changes)
    return value


@pytest.mark.parametrize("data,mime", [
    ("not base64!", "image/png"), ("data:image/png;base64,AAAA", "image/png"),
    (base64.b64encode(PNG).decode() + "\n", "image/png"),
    (base64.b64encode(PNG).decode(), "image/jpeg"),
    (base64.b64encode(PNG[:-1]).decode(), "image/png"),
    (base64.b64encode(b"<svg/>").decode(), "image/png"),
    (base64.b64encode(b"\xff\xd8\xffbroken").decode(), "image/jpeg"),
    (base64.b64encode(vision.PNG_SIGNATURE + bytes(vision.MAX_FRAME_BYTES) + vision.PNG_END).decode(), "image/png"),
])
def test_invalid_or_oversized_frame_rejected(data, mime):
    with pytest.raises(ValidationError):
        request(frames=[{"id": "f", "at": "now", "mime_type": mime, "data": data}])


def test_request_counts_context_and_id_boundaries():
    base = request().model_dump()
    for change in [
        {"frames": []}, {"frames": base["frames"] * 4},
        {"question": "x" * 1501}, {"transcript": base["transcript"] * 13},
        {"transcript": [{**base["transcript"][0], "id": str(i), "text": "x" * 4000} for i in range(4)]},
        {"transcript": [{**base["transcript"][0], "id": "frame-1"}]},
        {"frames": [base["frames"][0], base["frames"][0]]},
    ]:
        with pytest.raises(ValidationError):
            request(**change)
    assert request(transcript=[]).transcript == []


@pytest.mark.parametrize("changes", [
    {"frame_ids": ["invented"]}, {"transcript_ids": ["invented"]},
    {"observations": [{"frame_id": "invented", "description": "Not grounded."}]},
    {"frame_ids": []}, {"frame_ids": ["frame-1", "frame-1"]},
    {"answer": "x" * 1201}, {"next_step": ""}, {"engine": "verified"},
    {"uncertainties": ["x"] * 7},
])
def test_invalid_result_or_invented_sources_rejected(changes):
    with pytest.raises(ValueError):
        vision.parse_result(json.dumps(result(**changes)), request())


def test_response_keeps_grounding_and_uncertainty():
    expected = result()
    assert vision.parse_result("```json\n" + json.dumps(expected) + "\n```", request()) == {**expected, "engine": "gemini"}


def stub_provider(monkeypatch, text, status=200):
    seen = []
    original = httpx.AsyncClient

    def handler(req):
        seen.append(json.loads(req.content))
        return httpx.Response(status, json={"steps": [{"type": "model_output", "content": [{"type": "text", "text": text}]}]})

    monkeypatch.setattr(vision.httpx, "AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))
    return seen


def test_provider_receives_ordered_inline_images_and_no_persisted_interaction(monkeypatch):
    body = request()
    second = {**body.frames[0].model_dump(), "id": "frame-2", "at": "2026-11-14T12:00:02Z"}
    body = request(frames=[body.frames[0].model_dump(), second])
    seen = stub_provider(monkeypatch, json.dumps(result()))
    output = asyncio.run(vision.analyze(body, "test-secret", "configured-test-model", asyncio.Semaphore(1)))
    assert output["engine"] == "gemini"
    payload = seen[0]
    assert payload["store"] is False and payload["model"] == "configured-test-model"
    assert [p["type"] for p in payload["input"]] == ["text", "text", "image", "text", "image"]
    assert json.loads(payload["input"][1]["text"])["frame_id"] == "frame-1"
    assert json.loads(payload["input"][3]["text"])["frame_id"] == "frame-2"
    assert base64.b64decode(payload["input"][2]["data"]) == PNG
    assert payload["input"][2]["mime_type"] == "image/png"
    assert payload["response_format"]["mime_type"] == "application/json"
    prompt = payload["input"][0]["text"]
    assert "not continuous video" in prompt and "untrusted data" in prompt
    assert "ingestion" in prompt and "not shown" in prompt and "emotions" in prompt


@pytest.mark.parametrize("text,status", [
    ("private upstream detail", 429), ("not-json private detail", 200),
    (json.dumps(result(frame_ids=["invented"])), 200),
    ("", 200),
])
def test_provider_failure_is_sanitized(monkeypatch, text, status):
    stub_provider(monkeypatch, text, status)
    with pytest.raises(HTTPException) as raised:
        asyncio.run(vision.analyze(request(), "test-secret", "configured-test-model", asyncio.Semaphore(1)))
    assert raised.value.status_code == 502
    assert raised.value.detail == "Visual context could not be analyzed. Please try again."


def test_missing_provider_configuration_does_not_call_network():
    with pytest.raises(HTTPException) as raised:
        asyncio.run(vision.analyze(request(), "", "", asyncio.Semaphore(1)))
    assert raised.value.status_code == 503
