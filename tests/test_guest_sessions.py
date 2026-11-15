import asyncio

import pytest
from fastapi.testclient import TestClient

from app import main


ORIGIN = "https://threadline.example"
SAME_ORIGIN = {"Origin": ORIGIN}
OPERATOR = {"X-App-Token": "test-operator-token"}


@pytest.fixture
def guest_client(monkeypatch):
    monkeypatch.setenv("APP_GUEST_SESSIONS", "1")
    monkeypatch.setenv("APP_PUBLIC_ORIGIN", ORIGIN)
    monkeypatch.setenv("APP_ACCESS_TOKEN", "test-operator-token")
    monkeypatch.delenv("APP_TRUST_LOOPBACK", raising=False)
    main.guest_sessions.clear()
    main.guest_issue_ips.clear()
    main.pairings.clear()
    for name in ("guest_issue_global", "guest_requests_global", "guest_requests_hour"):
        monkeypatch.setattr(main, name, main.GuestWindow())
    monkeypatch.setattr(main, "guest_active_streams", 0)
    with TestClient(main.app, base_url=ORIGIN) as client:
        yield client
    main.guest_sessions.clear()
    main.guest_issue_ips.clear()
    main.pairings.clear()


def issue(client):
    response = client.post("/api/session", headers=SAME_ORIGIN)
    assert response.status_code == 200, response.text
    return main.guest_sessions[client.cookies.get(main.GUEST_COOKIE)]


@pytest.mark.parametrize("key,value", [
    ("APP_GUEST_SESSIONS", "0"), ("APP_PUBLIC_ORIGIN", ""),
    ("APP_PUBLIC_ORIGIN", ORIGIN + "/path"), ("APP_ACCESS_TOKEN", ""),
])
def test_session_creation_fails_closed(guest_client, monkeypatch, key, value):
    monkeypatch.setenv(key, value)
    response = guest_client.post("/api/session", headers=SAME_ORIGIN)
    assert response.status_code == 503
    assert not main.guest_sessions
    assert "set-cookie" not in response.headers


def test_cookie_is_opaque_host_only_and_has_fixed_lifetime(guest_client):
    response = guest_client.post("/api/session", headers=SAME_ORIGIN)
    assert response.status_code == 200
    cookie = response.headers["set-cookie"]
    assert "HttpOnly" in cookie and "Secure" in cookie and "SameSite=strict" in cookie
    assert "Path=/" in cookie and "Domain=" not in cookie
    token = guest_client.cookies.get(main.GUEST_COOKIE)
    assert len(token) >= 40 and token not in response.text and "test-operator-token" not in cookie
    original = main.guest_sessions[token].expires
    main.guest_sessions[token].expires -= 60
    response = guest_client.post("/api/session", headers=SAME_ORIGIN)
    assert guest_client.cookies.get(main.GUEST_COOKIE) == token
    assert main.guest_sessions[token].expires == original - 60
    assert response.json()["expires_in"] < main.GUEST_TTL
    assert guest_client.get("/api/config").status_code == 200


@pytest.mark.parametrize("headers", [{}, {"Origin": "https://evil.example"}, {"Origin": "null"},
                                      {"Origin": ORIGIN, "Host": "evil.example"}])
def test_creation_requires_exact_origin_and_host(guest_client, headers):
    assert guest_client.post("/api/session", headers=headers).status_code == 403
    assert not main.guest_sessions


def test_guest_mutations_require_origin_and_expiry_is_enforced(guest_client):
    session = issue(guest_client)
    assert guest_client.post("/api/reflect", json={}).status_code == 403
    assert guest_client.post("/api/reflect", headers={"Origin": "https://evil.example"}, json={}).status_code == 403
    assert guest_client.get("/api/config", headers={"Origin": "https://evil.example"}).status_code == 403
    assert guest_client.post("/api/reflect", headers=SAME_ORIGIN, json={}).status_code == 422
    session.expires = main.time.monotonic() - 1
    assert guest_client.get("/api/config").status_code == 401
    assert not main.guest_sessions


def test_operator_token_and_local_access_still_work(guest_client, monkeypatch):
    monkeypatch.setenv("APP_GUEST_SESSIONS", "0")
    assert guest_client.get("/api/config", headers=OPERATOR).status_code == 200
    assert guest_client.get("/api/config").status_code == 401
    assert guest_client.post("/api/watch/pair", headers=OPERATOR).status_code == 200
    monkeypatch.setenv("APP_TRUST_LOOPBACK", "1")
    assert main.trusted_local("127.0.0.1", "localhost:8000")
    assert not main.trusted_local("127.0.0.1", "threadline.example")


def test_guest_cannot_mint_watch_credentials(guest_client):
    issue(guest_client)
    assert guest_client.post("/api/watch/pair", headers=SAME_ORIGIN).status_code == 403
    assert not main.pairings
    with guest_client.websocket_connect("wss://threadline.example/api/watch/feed", headers=SAME_ORIGIN) as ws:
        ws.send_json({"code": "123456"})
        assert "token" in ws.receive_json()["message"]


def test_session_issuance_and_active_table_are_bounded(guest_client, monkeypatch):
    monkeypatch.setattr(main, "GUEST_ISSUE_IP_LIMIT", 2)
    issue(guest_client)
    guest_client.cookies.clear()
    issue(guest_client)
    guest_client.cookies.clear()
    assert guest_client.post("/api/session", headers=SAME_ORIGIN).status_code == 429
    assert len(main.guest_sessions) == 2
    main.guest_issue_ips.clear()
    monkeypatch.setattr(main, "GUEST_MAX_SESSIONS", 2)
    assert guest_client.post("/api/session", headers=SAME_ORIGIN).status_code == 429


def test_global_issuance_and_ip_table_limits(guest_client, monkeypatch):
    monkeypatch.setattr(main, "GUEST_ISSUE_GLOBAL_LIMIT", 1)
    issue(guest_client)
    guest_client.cookies.clear()
    main.guest_issue_ips.clear()
    assert guest_client.post("/api/session", headers=SAME_ORIGIN).status_code == 429
    main.guest_issue_global.count = 0
    main.guest_issue_ips.clear()
    monkeypatch.setattr(main, "GUEST_MAX_ISSUE_IPS", 1)
    main.guest_issue_ips["different-client"] = main.GuestWindow(started=main.time.monotonic())
    assert guest_client.post("/api/session", headers=SAME_ORIGIN).status_code == 429


def test_guest_request_rate_and_total_quotas_cover_provider_routes(guest_client, monkeypatch):
    session = issue(guest_client)
    monkeypatch.setattr(main, "GUEST_REQUEST_LIMIT", 1)
    assert guest_client.get("/api/config").status_code == 200
    assert guest_client.post("/api/music/generate", headers=SAME_ORIGIN, json={}).status_code == 429
    session.request_window.count = 0
    session.requests = main.GUEST_TOTAL_REQUEST_LIMIT
    assert guest_client.get("/api/config").status_code == 429
    assert guest_client.get("/api/config", headers=OPERATOR).status_code == 200


def test_global_request_quota_cannot_be_bypassed_with_another_session(guest_client, monkeypatch):
    issue(guest_client)
    monkeypatch.setattr(main, "GUEST_GLOBAL_REQUEST_LIMIT", 1)
    assert guest_client.get("/api/config").status_code == 200
    guest_client.cookies.clear()
    issue(guest_client)
    assert guest_client.get("/api/config").status_code == 429


def test_https_origin_is_valid_behind_http_reverse_proxy(guest_client):
    # Browser HTTPS terminates at the proxy; only the final hop to Uvicorn is HTTP.
    response = guest_client.post("http://threadline.example/api/session", headers=SAME_ORIGIN)
    assert response.status_code == 200 and "Secure" in response.headers["set-cookie"]
    cookie = guest_client.cookies.get(main.GUEST_COOKIE)
    headers = {**SAME_ORIGIN, "Cookie": f"{main.GUEST_COOKIE}={cookie}"}
    assert guest_client.get("http://threadline.example/api/config", headers=headers).status_code == 200
    assert guest_client.post("http://threadline.example/api/reflect", headers=headers, json={}).status_code == 422


def test_websocket_cookie_acceptance_and_stream_start_quota(guest_client, monkeypatch):
    session = issue(guest_client)
    seen = []

    async def relay(source, receive, send, fail, **limits):
        seen.append(limits)
        await send({"type": "ready", "source": source})
        return 0

    monkeypatch.setattr(main, "relay_audio", relay)
    monkeypatch.setattr(main, "GUEST_STREAM_START_LIMIT", 1)
    with guest_client.websocket_connect("wss://threadline.example/api/live-transcribe", headers=SAME_ORIGIN) as ws:
        ws.send_json({"source": "vexo"})
        assert ws.receive_json() == {"type": "ready", "source": "vexo"}
        assert ws.receive_json()["type"] == "closed"
    assert 0 < seen[0]["max_seconds"] <= main.GUEST_STREAM_SECONDS
    assert seen[0]["max_bytes"] == main.GUEST_STREAM_BYTES
    assert session.stream_starts == 1 and not session.streaming and main.guest_active_streams == 0
    with guest_client.websocket_connect("wss://threadline.example/api/live-transcribe", headers=SAME_ORIGIN) as ws:
        ws.send_json({"source": "vexo"})
        assert "limit" in ws.receive_json()["message"]
    assert len(seen) == 1


@pytest.mark.parametrize("origin", [None, "https://evil.example"])
def test_websocket_cookie_requires_same_origin(guest_client, monkeypatch, origin):
    issue(guest_client)
    called = []
    monkeypatch.setattr(main, "relay_audio", lambda *a, **k: called.append(True))
    headers = {} if origin is None else {"Origin": origin}
    with guest_client.websocket_connect("wss://threadline.example/api/live-transcribe", headers=headers) as ws:
        ws.send_json({"source": "vexo"})
        assert ws.receive_json()["type"] == "error"
    assert not called


def test_expired_websocket_session_and_remaining_quotas_reject(guest_client, monkeypatch):
    session = issue(guest_client)
    for attribute, value in (("stream_seconds", main.GUEST_STREAM_SECONDS),
                             ("stream_bytes", main.GUEST_STREAM_BYTES),
                             ("expires", main.time.monotonic() - 1)):
        setattr(session, attribute, value)
        with guest_client.websocket_connect("wss://threadline.example/api/live-transcribe", headers=SAME_ORIGIN) as ws:
            ws.send_json({"source": "vexo"})
            assert ws.receive_json()["type"] == "error"
        setattr(session, attribute, 0)


def test_guest_stream_concurrency_and_bytes_are_enforced(guest_client, monkeypatch):
    session = issue(guest_client)
    monkeypatch.setattr(main, "GUEST_STREAM_BYTES", 8)

    async def relay(source, receive, send, fail, **limits):
        assert limits["max_bytes"] == 8
        assert await receive() == b"12345678"
        await send({"type": "received"})
        return 8

    monkeypatch.setattr(main, "relay_audio", relay)
    session.streaming = True
    with guest_client.websocket_connect("wss://threadline.example/api/live-transcribe", headers=dict(SAME_ORIGIN)) as ws:
        ws.send_json({"source": "vexo"})
        assert "limit" in ws.receive_json()["message"]
    session.streaming = False
    main.guest_active_streams = main.GUEST_MAX_ACTIVE_STREAMS
    with guest_client.websocket_connect("wss://threadline.example/api/live-transcribe", headers=dict(SAME_ORIGIN)) as ws:
        ws.send_json({"source": "vexo"})
        assert "limit" in ws.receive_json()["message"]
    main.guest_active_streams = 0
    with guest_client.websocket_connect("wss://threadline.example/api/live-transcribe", headers=dict(SAME_ORIGIN)) as ws:
        ws.send_json({"source": "vexo"})
        ws.send_bytes(b"12345678")
        assert ws.receive_json() == {"type": "received"}
        assert ws.receive_json() == {"type": "closed", "bytes": 8}
    assert session.stream_bytes == 8 and main.guest_active_streams == 0
    with guest_client.websocket_connect("wss://threadline.example/api/live-transcribe", headers=dict(SAME_ORIGIN)) as ws:
        ws.send_json({"source": "vexo"})
        assert "limit" in ws.receive_json()["message"]


def test_pcm_stream_uses_separate_byte_budget_and_charges_received_audio(guest_client, monkeypatch):
    session = issue(guest_client)
    audio = b"\x00\x00" * 16000

    async def relay(source, receive, send, fail, **limits):
        assert source == "vexo_pcm"
        assert limits["max_bytes"] == main.GUEST_STREAM_PCM_BYTES
        assert await receive() == audio
        return len(audio)

    monkeypatch.setattr(main, "relay_audio", relay)
    with guest_client.websocket_connect("wss://threadline.example/api/live-transcribe", headers=SAME_ORIGIN) as ws:
        ws.send_json({"source": "vexo_pcm"})
        ws.send_bytes(audio)
        assert ws.receive_json() == {"type": "closed", "bytes": len(audio)}
    assert session.stream_pcm_bytes == len(audio)
    assert session.stream_bytes == 0
    assert not session.streaming and main.guest_active_streams == 0


@pytest.mark.parametrize("source", ["vexo_pcm", "pcm16"])
def test_eleven_minutes_of_pcm_can_continue_beyond_raw_audio_budget(guest_client, source):
    session = issue(guest_client)
    session.stream_pcm_bytes = 11 * 60 * 16000 * 2
    session.stream_seconds = 11 * 60
    assert session.stream_pcm_bytes > main.GUEST_STREAM_BYTES
    seconds, available = main.start_guest_stream(session, source)
    assert 0 < seconds <= main.GUEST_STREAM_SECONDS - 11 * 60
    assert available == main.GUEST_STREAM_PCM_BYTES - session.stream_pcm_bytes
    main.end_guest_stream(session, main.time.monotonic())
    # Compressed/browser audio retains its original independent allowance.
    _, available = main.start_guest_stream(session, "browser")
    assert available == main.GUEST_STREAM_BYTES
    main.end_guest_stream(session, main.time.monotonic())


def test_pcm_byte_cap_and_duration_and_concurrency_remain_finite(guest_client):
    session = issue(guest_client)
    assert main.GUEST_STREAM_PCM_BYTES == 2 * 3600 * 16000 * 2
    for changes in (
        {"stream_pcm_bytes": main.GUEST_STREAM_PCM_BYTES},
        {"stream_seconds": main.GUEST_STREAM_SECONDS},
        {"streaming": True},
        {"stream_starts": main.GUEST_STREAM_START_LIMIT},
    ):
        for field, value in changes.items():
            setattr(session, field, value)
        with pytest.raises(main.HTTPException) as error:
            main.start_guest_stream(session, "vexo_pcm")
        assert error.value.status_code == 429
        for field in changes:
            setattr(session, field, False if field == "streaming" else 0)
    main.guest_active_streams = main.GUEST_MAX_ACTIVE_STREAMS
    with pytest.raises(main.HTTPException) as error:
        main.start_guest_stream(session, "vexo_pcm")
    assert error.value.status_code == 429
    main.guest_active_streams = 0


def test_relay_deadline_closes_an_idle_provider(monkeypatch):
    monkeypatch.setenv("DEEPGRAM_API_KEY", "test-only-key")
    monkeypatch.setenv("DEEPGRAM_MODEL", "test-model")
    emitted = []

    class Provider:
        def __init__(self):
            self.closed = asyncio.Event()

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        def __aiter__(self):
            return self

        async def __anext__(self):
            await self.closed.wait()
            raise StopAsyncIteration

        async def close(self):
            self.closed.set()

        async def send(self, message):
            pass

    async def scenario():
        provider = Provider()
        monkeypatch.setattr(main, "ws_connect", lambda *a, **k: provider)

        async def receive():
            await asyncio.Event().wait()

        async def send(message):
            emitted.append(message)

        async def fail(*args):
            pytest.fail(str(args))

        await asyncio.wait_for(main.relay_audio("vexo", receive, send, fail, max_seconds=0.02), timeout=1)
        assert provider.closed.is_set()

    asyncio.run(scenario())
    assert any("limit" in message.get("message", "") for message in emitted)
