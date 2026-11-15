"""Slow public viewers must not delay the recording owner's transcript."""
import asyncio
from types import SimpleNamespace

from app import main  # main first: demo_feed imports it
from app import demo_feed


def test_slow_viewer_does_not_hold_owner_results(monkeypatch):
    async def run():
        release, owner_received = asyncio.Event(), asyncio.Event()
        owner_messages, stored = [], []

        class Viewer:
            async def send_json(self, message):
                if message["type"] == "demo_line":
                    await release.wait()

        class Owner:
            async def accept(self):
                pass

            async def send_json(self, message):
                owner_messages.append(message)

        async def hello(*args):
            return {"source": "vexo", "publish_key": "test-public-key-0123456789012345"}

        async def transcribe(client, source, send, on_ready, fail):
            await on_ready()
            for text in ("first words", "next words"):
                await send({"type": "result", "is_final": True, "transcript": text})
            owner_received.set()

        monkeypatch.setenv("DEMO_WATCH_KEY", "test-public-key-0123456789012345")
        monkeypatch.setattr(main, "socket_hello", hello)
        monkeypatch.setattr(main, "socket_token_ok", lambda *a, **k: True)
        monkeypatch.setattr(main, "transcribe_session", transcribe)
        monkeypatch.setattr(demo_feed, "subscribers", {Viewer()})
        monkeypatch.setattr(demo_feed, "recording", set())
        monkeypatch.setattr(demo_feed.store, "get", lambda: SimpleNamespace(add_line=lambda *a: stored.append(a)))
        task = asyncio.create_task(main.live_transcribe(Owner()))
        await asyncio.wait_for(owner_received.wait(), 0.1)
        assert [item["transcript"] for item in owner_messages] == ["first words", "next words"]
        assert len(stored) == 2
        release.set()
        await asyncio.wait_for(task, 1)

    asyncio.run(run())


def test_fanout_delivers_to_fast_viewer_while_evicting_stalled_one(monkeypatch):
    async def run():
        received = asyncio.Event()

        class Slow:
            async def send_json(self, message):
                await asyncio.Event().wait()

        class Fast:
            async def send_json(self, message):
                received.set()

        slow, fast = Slow(), Fast()
        monkeypatch.setattr(demo_feed, "subscribers", {slow, fast})
        monkeypatch.setattr(demo_feed, "SUBSCRIBER_SEND_SECONDS", 0.05)
        task = asyncio.create_task(demo_feed.broadcast({"type": "demo_line"}))
        await asyncio.wait_for(received.wait(), 0.02)
        await asyncio.wait_for(task, 0.2)
        assert demo_feed.subscribers == {fast}

    asyncio.run(run())


def test_overloaded_live_queue_still_persists_every_final(monkeypatch):
    async def run():
        stored, delivered = [], []
        monkeypatch.setenv("DEMO_WATCH_KEY", "test-public-key-0123456789012345")
        monkeypatch.setattr(demo_feed, "TRANSCRIPT_QUEUE_SIZE", 2)
        monkeypatch.setattr(demo_feed.store, "get", lambda: SimpleNamespace(add_line=lambda *a: stored.append(a)))

        async def broadcast(message):
            delivered.append(message)

        monkeypatch.setattr(demo_feed, "broadcast", broadcast)
        publisher = demo_feed.TranscriptPublisher("test-session", "vexo")
        for i in range(6):
            publisher.submit({"type": "result", "is_final": True, "transcript": f"line {i}"})
        assert publisher.queue.qsize() == 2
        assert len(stored) == 6
        await publisher.close()
        assert [message["text"] for message in delivered] == ["line 4", "line 5"]
        assert publisher.worker.done()

    asyncio.run(run())
