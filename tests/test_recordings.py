import os
import struct
import time

import pytest
from fastapi.testclient import TestClient

from app import main, recordings

OPERATOR = {"X-App-Token": "test-operator-token"}


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("APP_ACCESS_TOKEN", "test-operator-token")
    monkeypatch.setenv("THREADLINE_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("APP_TRUST_LOOPBACK", raising=False)
    monkeypatch.delenv("APP_GUEST_SESSIONS", raising=False)
    return TestClient(main.app)


def parse_ogg(data: bytes) -> list[dict]:
    """Walk an Ogg stream, verifying every page's CRC. Returns each page's flags, granule and packets."""
    pages, pos = [], 0
    while pos < len(data):
        assert data[pos:pos + 4] == b"OggS"
        flags, granule, serial, seq, crc, nseg = struct.unpack_from("<xBqIIIB", data, pos + 4)
        table = data[pos + 27:pos + 27 + nseg]
        size = sum(table)
        end = pos + 27 + nseg + size
        page = bytearray(data[pos:end])
        page[22:26] = b"\0\0\0\0"
        assert recordings.ogg_crc(bytes(page)) == crc, "bad Ogg page CRC"
        body, packets, cur, off = data[pos + 27 + nseg:end], [], b"", 0
        for lacing in table:
            cur += body[off:off + lacing]
            off += lacing
            if lacing < 255:
                packets.append(cur)
                cur = b""
        pages.append({"flags": flags, "granule": granule, "seq": seq, "packets": packets})
        pos = end
    return pages


def test_band_packets_become_a_valid_ogg_opus_file():
    raw = b"".join(struct.pack(">H", n) + bytes([i % 256]) * n for i, n in enumerate([40, 300, 80, 255, 1] * 30))
    pages = parse_ogg(recordings.packets_to_ogg(raw))
    assert pages[0]["flags"] == 0x02 and pages[0]["packets"][0].startswith(b"OpusHead")
    assert pages[1]["packets"][0].startswith(b"OpusTags")
    assert pages[-1]["flags"] & 0x04
    assert [p["seq"] for p in pages] == list(range(len(pages)))
    audio = [pk for page in pages[2:] for pk in page["packets"]]
    assert len(audio) == 150
    assert pages[-1]["granule"] == 150 * recordings.FRAME_SAMPLES_48K


def test_truncated_packet_is_dropped_not_fatal():
    raw = struct.pack(">H", 5) + b"abcde" + struct.pack(">H", 50) + b"xx"
    audio = [pk for page in parse_ogg(recordings.packets_to_ogg(raw))[2:] for pk in page["packets"]]
    assert audio == [b"abcde"]


def test_recording_keeps_finals_audio_and_rejects_path_ids(client):
    rec = recordings.Recording("vexo", "Vexo-HACK-73")
    rec.audio(b"opus-1"); rec.audio(b"opus-2")
    rec.final({"type": "result", "is_final": False, "transcript": "interim"})
    rec.final({"type": "result", "is_final": True, "transcript": "  ", "words": []})
    rec.final({"type": "result", "is_final": True, "transcript": "hello there", "start": 1.0, "duration": 1.0, "words": []})
    rec.close()
    got = client.get(f"/api/recordings/{rec.id}", headers=OPERATOR).json()
    assert [l["transcript"] for l in got["transcript"]] == ["hello there"]
    assert got["device"] == "Vexo-HACK-73" and got["ended_at"] and got["bytes"] == 12
    audio = client.get(f"/api/recordings/{rec.id}/audio", headers=OPERATOR)
    assert audio.status_code == 200 and audio.headers["content-type"] == "audio/ogg" and audio.content.startswith(b"OggS")
    assert client.get("/api/recordings/..%2F..%2Fsecret", headers=OPERATOR).status_code == 404
    assert client.get("/api/recordings/not-an-id/audio", headers=OPERATOR).status_code == 404
    assert recordings.delete("../x") is False


def test_recordings_need_the_operator_token(client):
    assert client.get("/api/recordings").status_code == 401
    assert client.get("/api/recordings", headers={"X-App-Token": "wrong"}).status_code == 401
    assert client.delete("/api/recordings/r20260101T000000-deadbeef").status_code == 401
    assert client.get("/api/recordings", headers=OPERATOR).json()["recordings"] == []


def test_delete_removes_every_file(client, tmp_path):
    rec = recordings.Recording("browser"); rec.audio(b"x"); rec.close()
    assert client.delete(f"/api/recordings/{rec.id}", headers=OPERATOR).status_code == 200
    assert list(tmp_path.iterdir()) == []
    assert client.delete(f"/api/recordings/{rec.id}", headers=OPERATOR).status_code == 404


def test_retention_purges_old_and_keeps_new(client, tmp_path, monkeypatch):
    monkeypatch.setenv("THREADLINE_RETENTION_DAYS", "7")
    old, new = recordings.Recording("browser"), recordings.Recording("browser")
    old.close(); new.close()
    ancient = time.time() - 8 * 86400
    for path in tmp_path.glob(f"{old.id}.*"):
        os.utime(path, (ancient, ancient))
    assert recordings.purge_expired() == 1
    assert [r["id"] for r in recordings.list_recordings()] == [new.id]


def test_full_storage_refuses_new_recordings(client, monkeypatch):
    monkeypatch.setenv("THREADLINE_MAX_STORE_MB", "0")
    with pytest.raises(OSError, match="storage is full"):
        recordings.Recording("browser")


def test_live_socket_saves_only_when_asked_by_an_operator(client, monkeypatch):
    monkeypatch.setenv("DEEPGRAM_API_KEY", "k"); monkeypatch.setenv("DEEPGRAM_MODEL", "m")

    async def fake_relay(source, receive, send, fail, **_):
        await send({"type": "ready", "source": source})
        got = await receive()
        await send({"type": "result", "is_final": True, "transcript": "saved words", "start": 0, "duration": 1, "words": []})
        return len(got)

    monkeypatch.setattr(main, "relay_audio", fake_relay)
    with client.websocket_connect("/api/live-transcribe") as ws:
        ws.send_json({"token": "test-operator-token", "source": "vexo", "save": True, "device": "Vexo-HACK-73"})
        saved = ws.receive_json()
        assert saved["type"] == "saved"
        ws.send_bytes(b"pkt")
        while ws.receive_json().get("type") != "closed":
            pass
    rec = client.get("/api/recordings", headers=OPERATOR).json()["recordings"]
    assert len(rec) == 1 and rec[0]["id"] == saved["id"] and rec[0]["lines"] == 1 and rec[0]["bytes"] == 3

    with client.websocket_connect("/api/live-transcribe") as ws:  # no save flag: nothing is kept
        ws.send_json({"token": "test-operator-token", "source": "vexo"})
        ws.send_bytes(b"pkt")
        while ws.receive_json().get("type") != "closed":
            pass
    assert len(client.get("/api/recordings", headers=OPERATOR).json()["recordings"]) == 1


def final(text, speaker=0, start=0.0):
    words = [{"punctuated_word": w, "word": w, "start": start + i * 0.3, "end": start + i * 0.3 + 0.25, "speaker": speaker}
             for i, w in enumerate(text.split())]
    return {"type": "result", "is_final": True, "speech_final": True, "transcript": text, "start": start, "duration": len(words) * 0.3, "words": words}


def test_detector_scores_the_dominant_speaker_and_flags_low_energy_words():
    from app.live_detect import LiveDetector
    d = LiveDetector()
    assert d.feed({"type": "result", "is_final": False, "transcript": "hello there friend", "words": []}) == []
    out = d.feed(final("I am so tired and exhausted today", speaker=0))
    kinds = [m["type"] for m in out]
    assert "affect" in kinds and "trigger" in kinds
    affect_msg = next(m for m in out if m["type"] == "affect")
    assert affect_msg["state"]["baselines"] and affect_msg["speaker"] == 0 and affect_msg["assumed_wearer"]
    trig = next(m for m in out if m["type"] == "trigger")
    assert trig["trigger"]["kind"] == "words"
    # someone else talking a little is not scored as the wearer
    assert d.feed(final("yes ok", speaker=1)) == []
    assert d.feed(final("two words", speaker=0)) == []  # under MIN_WORDS


def test_detector_ignores_oversized_or_bad_baselines():
    from app.live_detect import LiveDetector, clean_state
    assert clean_state("nope") is None and clean_state({"x": "y" * 30000}) is None
    assert LiveDetector({"x": "y" * 30000}).state is None


def test_live_socket_sends_detections_and_stores_them_with_the_recording(client, monkeypatch):
    monkeypatch.setenv("DEEPGRAM_API_KEY", "k"); monkeypatch.setenv("DEEPGRAM_MODEL", "m")

    async def fake_relay(source, receive, send, fail, **_):
        await send({"type": "ready", "source": source})
        await receive()
        await send(final("I feel really tired and drained right now", speaker=2))
        return 1

    monkeypatch.setattr(main, "relay_audio", fake_relay)
    seen = []
    with client.websocket_connect("/api/live-transcribe") as ws:
        ws.send_json({"token": "test-operator-token", "source": "vexo", "save": True, "affect": None})
        ws.send_bytes(b"x")
        while (msg := ws.receive_json()).get("type") != "closed":
            seen.append(msg["type"])
    assert "affect" in seen and "trigger" in seen
    rid = client.get("/api/recordings", headers=OPERATOR).json()["recordings"][0]["id"]
    got = client.get(f"/api/recordings/{rid}", headers=OPERATOR).json()
    assert {e["type"] for e in got["events"]} == {"affect", "trigger"}
    assert all("state" not in e for e in got["events"])
