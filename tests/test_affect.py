"""Synthetic-data tests: all signals below are generated, not real health data."""
import random

from fastapi.testclient import TestClient

from app import affect, main


def calm(rng):
    return {"hr": rng.gauss(68, 3), "hrv_sdnn": rng.gauss(55, 6), "voice_rms": rng.gauss(0.30, 0.03),
            "irritation_rate": abs(rng.gauss(0.2, 0.1)) + 0.1}


def stressed(rng):
    return {"hr": rng.gauss(88, 3), "hrv_sdnn": rng.gauss(32, 5), "voice_rms": rng.gauss(0.45, 0.03),
            "irritation_rate": abs(rng.gauss(1.5, 0.3))}


def run(state, windows):
    result = None
    for w in windows:
        result = affect.update(state, w)
        state = result["state"]
    return result


def test_calibrates_then_reports_near_baseline():
    rng = random.Random(1)
    first = affect.update(None, calm(rng))
    assert first["label"] == "calibrating"
    result = run(first["state"], [calm(rng) for _ in range(60)])
    assert result["label"] == "near_baseline"
    assert result["alarm"] == []


def test_sustained_shift_raises_arousal_alarm_with_drivers():
    rng = random.Random(2)
    result = run(None, [calm(rng) for _ in range(60)])
    state = result["state"]
    for _ in range(6):
        result = affect.update(state, stressed(rng))
        state = result["state"]
    assert result["arousal"] > 2
    assert "arousal_up" in result["alarm"]
    assert result["label"] == "sustained_arousal_rise"
    assert {d["feature"] for d in result["drivers"]} & {"hr", "hrv_sdnn", "irritation_rate"}


def test_single_outlier_is_not_a_sustained_alarm():
    rng = random.Random(3)
    result = run(None, [calm(rng) for _ in range(60)])
    result = affect.update(result["state"], {**calm(rng), "hr": 110})
    assert result["alarm"] == []


def test_baseline_adapts_slowly_during_flagged_episode():
    rng = random.Random(4)
    state = run(None, [calm(rng) for _ in range(60)])["state"]
    before = state["baselines"]["hr"]["mean"]
    for _ in range(10):
        state = affect.update(state, stressed(rng))["state"]
    assert state["baselines"]["hr"]["mean"] - before < 8  # would approach 88 if not damped


def test_low_quality_and_unknown_features_are_ignored():
    rng = random.Random(5)
    state = run(None, [calm(rng) for _ in range(40)])["state"]
    result = affect.update(state, {"hr": 200, "not_a_feature": 5, "ambient_lux": 300}, {"hr": 0.0})
    assert abs(result["arousal"]) < 0.01


def test_lexicon_text_direction():
    neg = affect.lexicon_text_features("Ugh I am so frustrated and stressed, I hate this!")
    pos = affect.lexicon_text_features("Feeling calm and happy, great day")
    assert neg["text_valence"] < 0 < pos["text_valence"]
    assert neg["text_arousal"] > pos["text_arousal"]


def test_endpoint_round_trips_client_owned_state(monkeypatch):
    monkeypatch.setenv("APP_ACCESS_TOKEN", "test-only-access")
    client = TestClient(main.app)
    headers = {"X-App-Token": "test-only-access"}
    assert client.post("/api/affect/update", json={}).status_code == 401
    r = client.post("/api/affect/update", headers=headers, json={"features": {"hr": 70}, "text": "feeling fine"})
    assert r.status_code == 200
    body = r.json()
    assert body["label"] == "calibrating"
    r2 = client.post("/api/affect/update", headers=headers, json={"features": {"hr": 71}, "state": body["state"]})
    assert r2.json()["state"]["baselines"]["hr"]["n"] == 2


def test_energy_states_from_synthetic_shifts():
    rng = random.Random(6)

    def base(): return {"hr": rng.gauss(68, 2), "speech_rate": rng.gauss(150, 6), "voice_rms": rng.gauss(0.3, 0.02),
                        "text_valence": rng.gauss(0.2, 0.1)}
    state = run(None, [base() for _ in range(60)])["state"]
    assert affect.update(state, base())["energy"] == "steady"
    low = {"hr": 60, "speech_rate": 110, "voice_rms": 0.18, "text_valence": 0.2}
    moody = {"hr": 84, "speech_rate": 185, "voice_rms": 0.45, "text_valence": -0.9}
    pos = {"hr": 70, "speech_rate": 155, "voice_rms": 0.31, "text_valence": 1.2}
    for window, want in ((low, "low"), (moody, "moody"), (pos, "positive")):
        s = state
        for _ in range(4):
            r = affect.update(s, window)
            s = r["state"]
        assert r["energy"] == want, (want, r["arousal"], r["valence"], r["alarm"])
    assert affect.update(None, base())["energy"] == "unknown"
