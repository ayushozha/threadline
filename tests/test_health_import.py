"""Apple Health import: owner-only upload of export.zip / export.xml, aggregated per local day. The export below is
SYNTHETIC test data (made-up values, dates relative to today), not anyone's real health data."""
import io
import zipfile
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app import main  # noqa: I001  (main first: demo_feed imports it)
from app import health_import, store

KEY = "demo-key-for-tests-only-0123456789"

D1 = (date.today() - timedelta(days=2)).isoformat()
D2 = (date.today() - timedelta(days=1)).isoformat()
OLD = (date.today() - timedelta(days=400)).isoformat()


def rec(kind, start, end=None, value="", unit="", source="Synthetic Watch", extra=""):
    return (f'<Record type="{kind}" sourceName="{source}" unit="{unit}" startDate="{start}" '
            f'endDate="{end or start}" value="{value}"{extra}/>')


SYNTHETIC_XML = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE HealthData [
<!ELEMENT HealthData (ExportDate,Me,(Record|Workout|ActivitySummary)*)>
]>
<HealthData locale="en_US">
 <ExportDate value="{D2} 20:00:00 -0800"/>
 <Me HKCharacteristicTypeIdentifierBiologicalSex="HKBiologicalSexNotSet"/>
 {rec("HKQuantityTypeIdentifierHeartRate", f"{D1} 08:00:00 -0800", value="60", unit="count/min")}
 {rec("HKQuantityTypeIdentifierHeartRate", f"{D1} 09:00:00 -0800", value="80", unit="count/min")}
 {rec("HKQuantityTypeIdentifierHeartRate", f"{D1} 23:30:00 -0800", value="100", unit="count/min")}
 {rec("HKQuantityTypeIdentifierRestingHeartRate", f"{D1} 07:00:00 -0800", value="55", unit="count/min")}
 {rec("HKQuantityTypeIdentifierHeartRateVariabilitySDNN", f"{D1} 07:00:00 -0800", value="42", unit="ms")}
 {rec("HKQuantityTypeIdentifierRespiratoryRate", f"{D1} 03:00:00 -0800", value="14", unit="count/min")}
 {rec("HKQuantityTypeIdentifierOxygenSaturation", f"{D1} 03:00:00 -0800", value="0.97", unit="%")}
 {rec("HKQuantityTypeIdentifierStepCount", f"{D1} 10:00:00 -0800", value="1000", unit="count")}
 {rec("HKQuantityTypeIdentifierStepCount", f"{D1} 11:00:00 -0800", value="500", unit="count")}
 {rec("HKQuantityTypeIdentifierStepCount", f"{D1} 10:00:00 -0800", value="1200", unit="count",
      source="Synthetic Phone")}
 {rec("HKQuantityTypeIdentifierDistanceWalkingRunning", f"{D1} 10:00:00 -0800", value="2", unit="mi")}
 {rec("HKQuantityTypeIdentifierActiveEnergyBurned", f"{D1} 10:00:00 -0800", value="300", unit="kcal")}
 {rec("HKQuantityTypeIdentifierAppleExerciseTime", f"{D1} 10:00:00 -0800", value="25", unit="min")}
 {rec("HKQuantityTypeIdentifierFlightsClimbed", f"{D1} 10:00:00 -0800", value="4", unit="count")}
 {rec("HKQuantityTypeIdentifierAppleStandTime", f"{D1} 10:00:00 -0800", value="5", unit="min")}
 {rec("HKQuantityTypeIdentifierWalkingSpeed", f"{D1} 10:00:00 -0800", value="5", unit="km/hr")}
 {rec("HKQuantityTypeIdentifierAppleWalkingSteadiness", f"{D1} 10:00:00 -0800", value="0.9", unit="%")}
 {rec("HKQuantityTypeIdentifierAppleSleepingWristTemperature", f"{D1} 04:00:00 -0800", value="35.5", unit="degC")}
 {rec("HKQuantityTypeIdentifierEnvironmentalAudioExposure", f"{D1} 12:00:00 -0800", value="70", unit="dBASPL")}
 {rec("HKQuantityTypeIdentifierEnvironmentalAudioExposure", f"{D1} 13:00:00 -0800", value="80", unit="dBASPL")}
 {rec("HKCategoryTypeIdentifierMindfulSession", f"{D1} 12:00:00 -0800", f"{D1} 12:10:00 -0800")}
 {rec("HKCategoryTypeIdentifierMenstrualFlow", f"{D1} 00:00:00 -0800", value="HKCategoryValueMenstrualFlowMedium")}
 {rec("HKCategoryTypeIdentifierMenstrualFlow", f"{D2} 00:00:00 -0800", value="HKCategoryValueMenstrualFlowNone")}
 <Record type="HKStateOfMindTypeIdentifier" sourceName="Synthetic Phone" startDate="{D1} 18:00:00 -0800"
   endDate="{D1} 18:00:00 -0800"><MetadataEntry key="HKStateOfMindValence" value="0.5"/></Record>
 {rec("HKCategoryTypeIdentifierSleepAnalysis", f"{D1} 23:00:00 -0800", f"{D2} 02:00:00 -0800",
      value="HKCategoryValueSleepAnalysisAsleepCore")}
 {rec("HKCategoryTypeIdentifierSleepAnalysis", f"{D2} 01:00:00 -0800", f"{D2} 03:00:00 -0800",
      value="HKCategoryValueSleepAnalysisAsleepDeep", source="Synthetic Phone")}
 {rec("HKCategoryTypeIdentifierSleepAnalysis", f"{D2} 03:00:00 -0800", f"{D2} 06:30:00 -0800",
      value="HKCategoryValueSleepAnalysisAsleepREM")}
 {rec("HKCategoryTypeIdentifierSleepAnalysis", f"{D1} 22:00:00 -0800", f"{D2} 07:00:00 -0800",
      value="HKCategoryValueSleepAnalysisInBed")}
 {rec("HKCategoryTypeIdentifierSleepAnalysis", f"{D2} 06:30:00 -0800", f"{D2} 06:45:00 -0800",
      value="HKCategoryValueSleepAnalysisAwake")}
 {rec("HKQuantityTypeIdentifierHeartRate", f"{D2} 00:30:00 +0900", value="70", unit="count/min")}
 {rec("HKQuantityTypeIdentifierStepCount", f"{OLD} 10:00:00 -0800", value="9999", unit="count")}
 {rec("HKQuantityTypeIdentifierSomethingUnknown", f"{D1} 10:00:00 -0800", value="1", unit="count")}
 {rec("HKQuantityTypeIdentifierFlightsClimbed", f"{D1} 10:00:00 -0800", value="4", unit="count")}
 <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="30" durationUnit="min"
   sourceName="Synthetic Watch" startDate="{D2} 07:00:00 -0800" endDate="{D2} 07:30:00 -0800">
   <WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" average="140"/>
 </Workout>
 <Workout workoutActivityType="HKWorkoutActivityTypeYoga" duration="0.5" durationUnit="hr"
   sourceName="Synthetic Watch" startDate="{D2} 18:00:00 -0800" endDate="{D2} 18:30:00 -0800"/>
 <ActivitySummary dateComponents="{D2}" activeEnergyBurned="450" appleExerciseTime="40" appleStandHours="10"/>
</HealthData>
"""


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("THREADLINE_DB_PATH", str(tmp_path / "data" / "threadline.db"))
    monkeypatch.setenv("DEMO_WATCH_KEY", KEY)
    store.reset()
    yield TestClient(main.app)
    store.reset()


def upload(client, body, content_type="application/xml", key=KEY):
    headers = {"Content-Type": content_type}
    if key is not None:
        headers["X-Publish-Key"] = key
    return client.post("/api/health/import", content=body, headers=headers)


def as_zip(xml: str, name="apple_health_export/export.xml") -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(name, xml)
        zf.writestr("apple_health_export/export_cda.xml", "<cda/>")
    return buf.getvalue()


def day(client, d, days=30):
    summary = client.get(f"/api/health/summary?days={days}").json()
    return next(entry for entry in summary["daily"] if entry["date"] == d), summary


def test_raw_xml_import_all_metric_families(client):
    r = upload(client, SYNTHETIC_XML.encode())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["range"] == [D1, D2] and body["days"] == 2
    assert body["records"] == 36
    assert "steps" in body["metrics"] and "sleep_hours" in body["metrics"]

    d1, summary = day(client, D1)
    assert d1["heart_rate"] == 80.0
    assert d1["resting_heart_rate"] == 55 and d1["hrv_sdnn"] == 42 and d1["respiratory_rate"] == 14
    assert d1["oxygen_saturation"] == 97.0
    assert d1["steps"] == 1500  # largest single source (watch 1500 vs phone 1200), not 2700
    assert d1["distance_km"] == pytest.approx(3.219, abs=0.001)
    assert d1["active_energy_kcal"] == 300 and d1["exercise_min"] == 25
    assert d1["flights_climbed"] == 8  # duplicate record counted, no crash
    assert d1["stand_min"] == 5 and d1["walking_speed_kmh"] == 5
    assert d1["walking_steadiness"] == 90.0 and d1["wrist_temp_c"] == 35.5
    assert d1["audio_exposure_db"] == 75.0
    assert d1["mindful_min"] == 10 and d1["mood"] == 0.5 and d1["menstrual_flow"] == 1
    assert "SomethingUnknown" not in str(summary)

    d2, summary = day(client, D2)
    assert "menstrual_flow" not in d2
    assert d2["heart_rate"] == 70  # local date from the record's own +0900 offset
    assert d2["workouts"] == 60 and d2["workout_count"] == 2
    assert d2["workout_types"] == {"Running": 30, "Yoga": 30}
    assert d2["active_energy_kcal"] == 450 and d2["exercise_min"] == 40 and d2["stand_hours"] == 10
    assert summary["today"]["date"] == D2
    assert summary["range"] == [D1, D2] and summary["imported_at"]
    assert summary["averages"]["heart_rate"] == 75.0


def test_sleep_attributed_to_wake_date_and_overlaps_merged(client):
    upload(client, SYNTHETIC_XML.encode())
    d1, _ = day(client, D1)
    d2, _ = day(client, D2)
    assert "sleep_hours" not in d1
    assert d2["sleep_hours"] == 7.5  # 23:00 -> 06:30 asleep, overlapping core/deep merged; in-bed/awake ignored


def test_zip_import_and_reimport_replaces(client):
    r = upload(client, as_zip(SYNTHETIC_XML), "application/zip")
    assert r.status_code == 200, r.text
    again = upload(client, as_zip(SYNTHETIC_XML), "application/zip")
    assert again.json() == r.json()
    d1, _ = day(client, D1)
    assert d1["steps"] == 1500


def test_old_records_dropped(client):
    upload(client, SYNTHETIC_XML.encode())
    assert client.get("/api/health/summary?days=365").json()["range"][0] == D1


def test_auth_required(client, monkeypatch):
    assert upload(client, SYNTHETIC_XML.encode(), key="wrong").status_code == 401
    assert upload(client, SYNTHETIC_XML.encode(), key=None).status_code == 401
    assert client.delete("/api/health/import").status_code == 401
    monkeypatch.delenv("DEMO_WATCH_KEY")
    assert upload(client, SYNTHETIC_XML.encode()).status_code == 503


def test_delete_wipes(client):
    upload(client, SYNTHETIC_XML.encode())
    r = client.delete("/api/health/import", headers={"X-Publish-Key": KEY})
    assert r.status_code == 200 and r.json()["deleted"] > 0
    summary = client.get("/api/health/summary").json()
    assert summary == {"range": None, "today": {}, "daily": [], "averages": {}, "imported_at": None}


def test_bad_inputs(client):
    r = upload(client, b"<HealthData><Record type='x'")
    assert r.status_code == 400 and "Malformed" in r.json()["detail"]
    assert upload(client, b"<notHealth/>").status_code == 400
    r = upload(client, as_zip("<x/>", name="other/readme.xml"), "application/zip")
    assert r.status_code == 400 and "export.xml" in r.json()["detail"]
    assert upload(client, b"PK\x03\x04garbage", "application/zip").status_code == 400
    assert upload(client, b"", "application/xml").status_code == 400
    assert upload(client, b"x", "image/png").status_code == 415


def test_too_large_is_413(client, monkeypatch):
    monkeypatch.setattr(health_import, "MAX_BYTES", 100)
    assert upload(client, SYNTHETIC_XML.encode()).status_code == 413


def test_concurrent_import_is_409(client):
    assert health_import.import_lock.acquire(blocking=False)
    try:
        assert upload(client, SYNTHETIC_XML.encode()).status_code == 409
    finally:
        health_import.import_lock.release()


def test_temp_files_removed(client, tmp_path, monkeypatch):
    monkeypatch.setattr(health_import.tempfile, "tempdir", str(tmp_path))
    upload(client, SYNTHETIC_XML.encode())
    upload(client, b"<bad")
    assert not list(tmp_path.glob("threadline-health-*"))


def test_storage_disabled_is_503(client, monkeypatch):
    monkeypatch.setattr(store, "get", lambda: None)
    assert upload(client, SYNTHETIC_XML.encode()).status_code == 503
    assert client.get("/api/health/summary").status_code == 503
