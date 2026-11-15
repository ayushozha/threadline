"""Affect-shift engine: personal baseline + deviation tracking over multi-source signals.

Pure and stateless. The caller owns the state dict (browser memory) and passes it back in,
so the server stores nothing. Output describes *shifts from this person's own baseline*,
never a diagnosis or a clinical/hormonal inference.

Inputs are already-extracted features (e.g. from a speech-emotion model, a text model,
HealthKit/watch samples, Vexo mic/light/motion summaries). No raw audio is handled here.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass

MIN_SAMPLES = 20          # per-feature samples before z-scores are trusted
ALPHA_MIN = 0.02          # slowest baseline adaptation (EWMA floor)
ALPHA_FLAGGED_SCALE = 0.1  # adapt 10x slower while a shift is flagged, so episodes aren't absorbed
Z_CLIP = 4.0
CUSUM_K = 0.5
CUSUM_H = 4.0
MAD_TO_SD = 1.253         # mean absolute deviation -> sd (normal)


@dataclass(frozen=True)
class Spec:
    channel: str   # "arousal" | "valence"
    sign: int      # +1: higher value => higher channel score
    weight: float
    source: str    # watch | band | voice | text


FEATURES: dict[str, Spec] = {
    # Apple Watch / HealthKit
    "hr": Spec("arousal", +1, 1.0, "watch"),
    "hrv_sdnn": Spec("arousal", -1, 1.0, "watch"),
    "resp_rate": Spec("arousal", +1, 0.7, "watch"),
    "wrist_temp_delta": Spec("arousal", +1, 0.3, "watch"),
    "wrist_motion": Spec("arousal", +1, 0.5, "watch"),
    # Vexo band (mic-derived summaries + motion)
    "band_motion": Spec("arousal", +1, 0.5, "band"),
    "irritation_rate": Spec("arousal", +1, 0.9, "band"),  # sighs/throat-clears/sharp breaths per min
    # Speech acoustics
    "voice_f0_mean": Spec("arousal", +1, 0.7, "voice"),
    "voice_f0_var": Spec("arousal", +1, 0.5, "voice"),
    "voice_rms": Spec("arousal", +1, 0.7, "voice"),
    "speech_rate": Spec("arousal", +1, 0.6, "voice"),
    "voice_arousal": Spec("arousal", +1, 0.9, "voice"),   # speech-emotion model output
    "voice_valence": Spec("valence", +1, 0.8, "voice"),   # speech-emotion model output
    # Words
    "text_arousal": Spec("arousal", +1, 0.8, "text"),
    "text_valence": Spec("valence", +1, 1.0, "text"),
}
# Recorded as context only (never scored): ambient_lux, hour_of_day, in_conversation, ...
CONTEXT_KEYS = {"ambient_lux", "hour_of_day", "in_conversation", "sleep_hours_last_night"}


def new_state() -> dict:
    return {"baselines": {}, "cusum": {"arousal": [0.0, 0.0], "valence": [0.0, 0.0]}}


def _z(base: dict | None, x: float) -> float | None:
    if not base or base["n"] < MIN_SAMPLES:
        return None
    spread = max(MAD_TO_SD * base["dev"], 0.05 * abs(base["mean"]), 1e-6)
    return max(-Z_CLIP, min(Z_CLIP, (x - base["mean"]) / spread))


def _learn(base: dict | None, x: float, slow: bool) -> dict:
    if base is None:
        return {"n": 1, "mean": x, "dev": 0.0}
    n = base["n"] + 1
    alpha = max(1.0 / n, ALPHA_MIN)
    if slow and n >= MIN_SAMPLES:
        alpha *= ALPHA_FLAGGED_SCALE
    delta = x - base["mean"]
    return {"n": n, "mean": base["mean"] + alpha * delta, "dev": base["dev"] + alpha * (abs(delta) - base["dev"])}


def _fuse(zs: dict[str, tuple[float, float]]) -> tuple[float, float, list[str]]:
    """zs: feature -> (z, quality). Returns (score, confidence, contributing sources)."""
    num = den = 0.0
    sources: set[str] = set()
    for name, (z, q) in zs.items():
        spec = FEATURES[name]
        w = spec.weight * q
        num += w * spec.sign * z
        den += w
        if w > 0:
            sources.add(spec.source)
    if den == 0:
        return 0.0, 0.0, []
    coverage = min(1.0, den / 3.0) * min(1.0, len(sources) / 2.0)  # want ~3 weight units, 2+ sources
    return num / den, round(coverage, 2), sorted(sources)


def update(state: dict | None, features: dict[str, float], quality: dict[str, float] | None = None) -> dict:
    """Score one observation window against the baseline, then fold it into the baseline.

    Returns {"state", "arousal", "valence", "label", "alarm", "confidence", "sources", "drivers"}.
    """
    state = state or new_state()
    quality = quality or {}
    baselines = dict(state.get("baselines", {}))
    cusum = {k: list(v) for k, v in state.get("cusum", new_state()["cusum"]).items()}

    scored: dict[str, tuple[float, float]] = {}
    raw_z: dict[str, float] = {}
    calibrating = False
    for name, value in features.items():
        if name not in FEATURES or not isinstance(value, (int, float)) or not math.isfinite(value):
            continue
        z = _z(baselines.get(name), float(value))
        if z is None:
            calibrating = True
            continue
        q = max(0.0, min(1.0, float(quality.get(name, 1.0))))
        scored[name] = (z, q)
        raw_z[name] = z

    out: dict = {"arousal": 0.0, "valence": 0.0, "confidence": 0.0, "sources": [], "drivers": []}
    alarm: list[str] = []
    for channel in ("arousal", "valence"):
        subset = {n: v for n, v in scored.items() if FEATURES[n].channel == channel}
        score, conf, srcs = _fuse(subset)
        out[channel] = round(score, 2)
        out["confidence"] = max(out["confidence"], conf)
        out["sources"] = sorted(set(out["sources"]) | set(srcs))
        # Two-sided CUSUM on the fused score; only accumulates when there is evidence.
        pos, neg = cusum[channel]
        if subset:
            pos = max(0.0, pos + score - CUSUM_K)
            neg = max(0.0, neg - score - CUSUM_K)
        cusum[channel] = [round(pos, 3), round(neg, 3)]
        if pos > CUSUM_H:
            alarm.append(f"{channel}_up")
        if neg > CUSUM_H:
            alarm.append(f"{channel}_down")

    drivers = sorted(raw_z.items(), key=lambda kv: -abs(kv[1] * FEATURES[kv[0]].weight))[:3]
    out["drivers"] = [{"feature": n, "z": round(z, 2)} for n, z in drivers if abs(z) >= 1.0]

    if not scored:
        label = "calibrating"
    elif "arousal_up" in alarm:
        label = "sustained_arousal_rise"
    elif "arousal_down" in alarm:
        label = "sustained_arousal_drop"
    elif "valence_down" in alarm:
        label = "sustained_negative_shift"
    elif "valence_up" in alarm:
        label = "sustained_positive_shift"
    elif abs(out["arousal"]) >= 1.5 or abs(out["valence"]) >= 1.5:
        label = "brief_deviation"
    else:
        label = "near_baseline"

    slow = bool(alarm)
    for name, value in features.items():
        if name in FEATURES and isinstance(value, (int, float)) and math.isfinite(value):
            baselines[name] = _learn(baselines.get(name), float(value), slow)

    out.update(label=label, alarm=alarm, calibrating=calibrating)
    out.update(energy=interpret(out, bool(scored)),
               state={"baselines": baselines, "cusum": cusum})
    return out


def interpret(r: dict, have_baseline: bool) -> str:
    """Map fused shifts to the app's energy states: low | moody | positive | steady | unknown.

    low      = arousal sustained below this person's baseline (slower, quieter, less movement)
    moody    = arousal up together with valence down (tense/irritated signals)
    positive = valence up with arousal at or above baseline
    These describe signal shifts from the person's own baseline, not a diagnosis.
    """
    if not have_baseline:
        return "unknown"
    a, v, alarm = r["arousal"], r["valence"], r["alarm"]
    if "arousal_down" in alarm or (a <= -1.5 and v <= 0.5):
        return "low"
    if (v <= -1.0 and a >= 0.5) or ("valence_down" in alarm and a >= 0):
        return "moody"
    if "valence_up" in alarm or (v >= 1.0 and a >= -0.3):
        return "positive"
    return "steady"


# --- Offline text fallback -------------------------------------------------------------
# Tiny lexicon so the text channel works without a provider call. Replace/augment with a
# real classifier via env-configured model; this is a coarse, labeled placeholder.
_NEG = {"angry", "annoyed", "annoying", "furious", "hate", "ugh", "stressed", "overwhelmed", "anxious",
        "frustrated", "irritated", "tired", "exhausted", "sad", "awful", "terrible", "worried", "panic",
        "can't", "cannot", "never", "stupid", "sick", "crying"}
_POS = {"happy", "great", "good", "calm", "relaxed", "love", "excited", "fine", "better", "thanks",
        "glad", "proud", "okay", "peaceful", "fun", "enjoy"}
_HIGH = {"furious", "panic", "overwhelmed", "angry", "excited", "ugh", "hate", "stressed", "anxious", "urgent"}
_LOW = {"tired", "exhausted", "calm", "relaxed", "sad", "peaceful", "sleepy"}


def lexicon_text_features(text: str) -> dict[str, float]:
    words = re.findall(r"[a-z']+", text.lower())
    if not words:
        return {}
    n = len(words)
    val = (sum(w in _POS for w in words) - sum(w in _NEG for w in words)) / math.sqrt(n)
    aro = (sum(w in _HIGH for w in words) - sum(w in _LOW for w in words)) / math.sqrt(n) + text.count("!") * 0.1
    return {"text_valence": round(val, 3), "text_arousal": round(aro, 3)}
