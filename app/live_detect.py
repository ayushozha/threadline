"""Detections that run on the server while a capture is live, on the transcript Deepgram returns.

For each final utterance of the wearer it scores the shift from the wearer's own baseline
(app/affect.py: wording and speaking pace) and looks for low-energy or tense wording
(app/voice.py). It adds messages to the live socket and keeps nothing itself; the baseline
lives in the browser and rides along in the hello message, as it does for the voice assistant.

Who is "the wearer": the band's microphone sits on them, so the speaker Deepgram labels with
the most words so far is treated as the wearer. That is a guess, labelled as such in the
output, and it can be wrong in a room where someone else talks more.
"""
from __future__ import annotations

import json
from collections import Counter
from datetime import datetime, timezone

from app import affect

MAX_STATE_BYTES = 20000
MIN_WORDS = 3  # shorter utterances carry too little to score


def clean_state(raw: object) -> dict | None:
    return raw if isinstance(raw, dict) and len(json.dumps(raw)) <= MAX_STATE_BYTES else None


class LiveDetector:
    def __init__(self, state: object = None) -> None:
        self.state = clean_state(state)
        self.words_by_speaker: Counter = Counter()
        self.streak = 0
        self.count = 0

    def wearer(self) -> int | None:
        return self.words_by_speaker.most_common(1)[0][0] if self.words_by_speaker else None

    def feed(self, result: dict) -> list[dict]:
        """Messages to send after one transcript result: [] unless it is a final with enough words."""
        from app import voice  # imported here: voice pulls in the audio stack, which tests of this file don't need
        if result.get("type") != "result" or not result.get("is_final"):
            return []
        text = str(result.get("transcript", "")).strip()
        words = [w for w in result.get("words") or [] if isinstance(w, dict)]
        for w in words:
            if w.get("speaker") is not None:
                self.words_by_speaker[w["speaker"]] += 1
        wearer = self.wearer()
        mine = [w for w in words if wearer is None or w.get("speaker") in (None, wearer)]
        if len(mine) < MIN_WORDS:
            return []
        mine_text = " ".join(str(w.get("punctuated_word") or w.get("word") or "") for w in mine).strip() or text
        features, quality = voice.utterance_features(mine_text, mine, None)
        out: list[dict] = []
        if features:
            reading = affect.update(self.state, features, quality)
            self.state = reading["state"]
            self.count += 1
            out.append({"type": "affect", **reading, "at": datetime.now(timezone.utc).isoformat(), "id": f"det{self.count}", "speaker": wearer, "assumed_wearer": True})
        else:
            reading = None
        trigger, self.streak = voice.detect_trigger(mine_text, reading, self.streak)
        if trigger:
            out.append({"type": "trigger", "trigger": trigger, "text": mine_text, "speaker": wearer})
            self.streak = 0
        return out
