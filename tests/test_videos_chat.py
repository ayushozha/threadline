"""Recorded videos (upload, list, file, analysis) and conversational Gemini about a video, with httpx mocked."""
import base64
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app import main  # noqa: I001
from app import scenario_agent, store

TOKEN = "test-only-access"
H = {"x-app-token": TOKEN}
JPEG = base64.b64encode(b"\xff\xd8\xff\xe0" + b"0" * 64).decode()


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("THREADLINE_DB_PATH", str(tmp_path / "data" / "threadline.db"))
    monkeypatch.setenv("APP_ACCESS_TOKEN", TOKEN)
    monkeypatch.delenv("APP_TRUST_LOOPBACK", raising=False)
    store.reset()
    yield TestClient(main.app)
    store.reset()


def mock_gemini(monkeypatch, handler):
    real = httpx.AsyncClient
    monkeypatch.setattr(scenario_agent.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))


def test_upload_list_file_and_analysis(client, tmp_path):
    assert client.post("/api/videos", content=b"x", headers={"content-type": "video/mp4"}).status_code == 401
    assert client.post("/api/videos", content=b"x", headers={**H, "content-type": "text/plain"}).status_code == 415
    r = client.post("/api/videos?title=Kitchen%20check&mode=sight", content=b"fakevideo", headers={**H, "content-type": "video/webm"})
    assert r.status_code == 200, r.text
    v = r.json()
    assert v["title"] == "Kitchen check" and v["mode"] == "sight" and v["size"] == 9 and v["mime"] == "video/webm"
    assert (tmp_path / "data" / "videos" / f"{v['id']}.webm").read_bytes() == b"fakevideo"
    f = client.get(f"/api/videos/{v['id']}/file", headers=H)
    assert f.status_code == 200 and f.content == b"fakevideo" and f.headers["content-type"].startswith("video/webm")
    assert client.get("/api/videos/../etc/file", headers=H).status_code == 404
    assert client.get("/api/videos/zzzz/file", headers=H).status_code == 404
    analysis = {"vision": {"summary": "Stove on"}, "decision": {"action": "alert_caregiver", "urgency": "now"}}
    assert client.post(f"/api/videos/{v['id']}/analysis", content=json.dumps(analysis), headers=H).json() == {"ok": True}
    assert client.post(f"/api/videos/{v['id']}/analysis", content=b"[]", headers=H).status_code == 400
    assert client.post("/api/videos/" + "a" * 24 + "/analysis", content=json.dumps(analysis), headers=H).status_code == 404
    listed = client.get("/api/videos", headers=H).json()["videos"]
    assert listed[0]["id"] == v["id"] and listed[0]["analysis"]["decision"]["action"] == "alert_caregiver"


def test_upload_size_limit(client, monkeypatch):
    from app import videos
    monkeypatch.setattr(videos, "MAX_BYTES", 4)
    r = client.post("/api/videos", content=b"123456", headers={**H, "content-type": "video/mp4"})
    assert r.status_code == 413
    assert client.get("/api/videos", headers=H).json()["videos"] == []


def test_chat_multiturn_with_frames_and_decision(client, monkeypatch):
    monkeypatch.setenv("GOOGLE_API_KEY", "test-key")
    monkeypatch.setenv("GEMINI_MODEL", "chat-test-model")
    monkeypatch.setenv("GEMINI_DECISION_MODEL", "decide-test-model")
    seen = []

    def handler(req: httpx.Request):
        body = json.loads(req.content)
        seen.append((req.url.path, body))
        if req.url.path.endswith(":generateContent"):
            return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": "Yes, you have taken your pills. Step left."}]}}]})
        return httpx.Response(200, json={"answers": {"action": {"choice": "speak_guidance", "confidence": 0.8},
                                                     "urgency": {"choice": "soon", "confidence": 0.6}}})
    mock_gemini(monkeypatch, handler)
    r = client.post("/api/scenario/chat", headers=H, json={
        "mode": "sight", "title": "Stairs", "frames": [JPEG, "not-a-jpeg"],
        "history": [{"role": "model", "text": "hello"}, {"role": "user", "text": "What is ahead?"}, {"role": "model", "text": "Stairs."}],
        "message": "Is it safe to go down?"})
    assert r.status_code == 200, r.text
    out = r.json()
    assert "can't confirm medication" in out["reply"]  # safety post-check
    assert out["decision"]["action"] == "speak_guidance" and out["frames"] == 1
    path, body = seen[0]
    assert path.endswith("models/chat-test-model:generateContent")
    assert [c["role"] for c in body["contents"]] == ["user", "model", "user"]  # leading model turn dropped
    assert body["contents"][0]["parts"][0]["inline_data"]["data"] == JPEG
    assert "never identify people" in body["systemInstruction"]["parts"][0]["text"]
    assert seen[1][0].endswith("/decisions")


def test_chat_validation_and_config(client, monkeypatch):
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    assert client.post("/api/scenario/chat", headers=H, json={"message": "hi"}).status_code == 503
    monkeypatch.setenv("GOOGLE_API_KEY", "k")
    monkeypatch.setenv("GEMINI_MODEL", "m")
    assert client.post("/api/scenario/chat", headers=H, json={"message": ""}).status_code == 422
    assert client.post("/api/scenario/chat", headers=H, json={"message": "x" * 1001}).status_code == 422
    assert client.post("/api/scenario/chat", headers=H, json={"message": "hi", "history": [{"role": "user", "text": "a"}] * 13}).status_code == 422
    assert client.post("/api/scenario/chat", headers=H, json={"message": "hi", "history": [{"role": "system", "text": "a"}]}).status_code == 422
    mock_gemini(monkeypatch, lambda req: httpx.Response(500))
    assert client.post("/api/scenario/chat", headers=H, json={"message": "hi"}).status_code == 502
