"""HTTP authorization and boundary checks for consented camera snapshots."""
from fastapi.testclient import TestClient

from app import main
from tests.test_vision import request as vision_request


def test_vision_endpoint_requires_access(monkeypatch):
    monkeypatch.setenv("APP_ACCESS_TOKEN", "test-vision-access")
    monkeypatch.delenv("APP_TRUST_LOOPBACK", raising=False)
    with TestClient(main.app) as client:
        response = client.post("/api/vision", json=vision_request().model_dump())
    assert response.status_code == 401


def test_vision_endpoint_uses_server_credentials_and_scoped_payload(monkeypatch):
    monkeypatch.setenv("APP_ACCESS_TOKEN", "test-vision-access")
    monkeypatch.setenv("GOOGLE_API_KEY", "test-server-secret")
    monkeypatch.setenv("GEMINI_MODEL", "configured-vision-test")
    seen = []

    async def analyze(body, key, model, slots):
        seen.append((body, key, model, slots))
        return {"answer": "Visible scene", "frame_ids": [body.frames[0].id], "engine": "gemini"}

    monkeypatch.setattr(main, "analyze_vision", analyze)
    with TestClient(main.app) as client:
        response = client.post("/api/vision", headers={"X-App-Token": "test-vision-access"}, json=vision_request().model_dump())
    assert response.status_code == 200
    assert seen[0][1:3] == ("test-server-secret", "configured-vision-test")
    assert "test-server-secret" not in response.text


def test_vision_endpoint_rejects_invalid_images_before_provider(monkeypatch):
    monkeypatch.setenv("APP_ACCESS_TOKEN", "test-vision-access")
    body = vision_request().model_dump()
    body["frames"][0]["data"] = "not an image"
    with TestClient(main.app) as client:
        response = client.post("/api/vision", headers={"X-App-Token": "test-vision-access"}, json=body)
    assert response.status_code == 422
