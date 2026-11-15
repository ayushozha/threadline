import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app import main, realtime

TOKEN = {"X-App-Token": "test-operator-token"}
OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n"
ANSWER = "v=0\r\no=- 9 9 IN IP4 0.0.0.0\r\ns=-\r\nt=0 0\r\n"
REAL_CLIENT = httpx.AsyncClient


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("APP_ACCESS_TOKEN", "test-operator-token")
    monkeypatch.delenv("APP_TRUST_LOOPBACK", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setenv("OPENAI_REALTIME_MODEL", "configured-realtime")
    monkeypatch.setenv("OPENAI_TRANSCRIBE_MODEL", "configured-transcription")
    with TestClient(main.app) as c:
        yield c


@pytest.fixture
def openai(monkeypatch):
    seen = []

    def respond(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(201, text=ANSWER, headers={"Content-Type": "application/sdp", "Location": "/v1/realtime/calls/rtc_1"})

    monkeypatch.setattr(realtime.httpx, "AsyncClient", lambda **kw: REAL_CLIENT(transport=httpx.MockTransport(respond), **kw))
    return seen


def post(client, body=OFFER, headers=TOKEN):
    return client.post("/api/realtime/sdp", content=body, headers={**headers, "Content-Type": "application/sdp"})


def multipart_fields(request: httpx.Request) -> dict:
    boundary = request.headers["content-type"].split("boundary=")[1].encode()
    out = {}
    for part in request.content.split(b"--" + boundary):
        if b'name="' not in part:
            continue
        head, _, value = part.partition(b"\r\n\r\n")
        name = head.split(b'name="')[1].split(b'"')[0].decode()
        out[name] = value.rstrip(b"\r\n").decode()
    return out


def test_requires_auth(client, openai):
    assert post(client, headers={}).status_code == 401
    assert not openai


def test_503_without_key(client, openai, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY")
    assert post(client).status_code == 503
    assert not openai


def test_forwards_offer_and_returns_answer(client, openai):
    r = post(client)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("application/sdp")
    assert r.text == ANSWER
    (req,) = openai
    assert str(req.url) == "https://api.openai.com/v1/realtime/calls"
    assert req.headers["authorization"] == "Bearer sk-test"
    fields = multipart_fields(req)
    assert fields["sdp"].startswith("v=0") and "m=audio" in fields["sdp"]
    session = json.loads(fields["session"])
    assert session["type"] == "realtime" and session["model"] == "configured-realtime"
    assert session["audio"]["input"]["transcription"]["model"] == "configured-transcription"
    assert session["audio"]["input"]["turn_detection"]["type"] == "server_vad"
    assert session["audio"]["output"]["voice"]
    assert "JSON object" not in session["instructions"] and "never diagnose" in session["instructions"]
    names = {t["name"] for t in session["tools"]}
    assert names == {"add_to_cart", "remove_from_cart", "checkout", "open_view", "add_task", "care_check", "set_mode", "emergency", "buy", "log_checkin", "log_energy"}
    cart = next(t for t in session["tools"] if t["name"] == "add_to_cart")
    assert "milk" in cart["parameters"]["properties"]["id"]["enum"]


def test_model_from_env(client, openai, monkeypatch):
    monkeypatch.setenv("OPENAI_REALTIME_MODEL", "alternate-realtime")
    assert post(client).status_code == 200
    assert json.loads(multipart_fields(openai[0])["session"])["model"] == "alternate-realtime"


def test_503_without_model_configuration(client, openai, monkeypatch):
    monkeypatch.delenv("OPENAI_REALTIME_MODEL")
    assert post(client).status_code == 503
    assert not openai


def test_size_limit(client, openai):
    assert post(client, body=OFFER + "a=x\r\n" * 5000).status_code == 413
    assert not openai


def test_rejects_non_sdp(client, openai):
    assert post(client, body="hello").status_code == 400
    assert not openai


def test_upstream_error_is_502(client, monkeypatch):
    monkeypatch.setattr(realtime.httpx, "AsyncClient",
                        lambda **kw: REAL_CLIENT(transport=httpx.MockTransport(lambda r: httpx.Response(401, json={"error": "bad key"})), **kw))
    assert post(client).status_code == 502
