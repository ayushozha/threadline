# Threadline Care

A memory aid for people living with dementia or Alzheimer's, and for the people who care for them. Built at VexoHacks (AI wearables, Y Combinator, November 14, 2026).

[Live prototype](https://threadline.ayushojha.com/#care) · [Demo script](docs/DEMO.md) · [API setup](docs/API_SETUP.md) · [Live video and device setup](docs/LIVE_CAPTURE_HANDOFF.md) · [Deployment](deploy/README.md) · [Watch app](watch/README.md)

## The problem

A family caregiver cannot watch someone all day. The same question comes back every few minutes ("Where is my wife?"), glasses and keys go missing, pills are a constant worry, and a fall can go unnoticed until someone walks in. Threadline Care listens and watches through wearables, answers the person calmly in the moment, and tells the caregiver only what needs their attention, with the reason attached.

## What works now

| Piece | What it does |
| --- | --- |
| **Vexo band 73** (official [Vexo Open kit](https://github.com/VexoAI-Org/vexo-open-kit), `app/static/vendor/vexo-open/`) | The recorder. Band mic audio is decoded in the browser to 16 kHz PCM16 and relayed through `/api/live-transcribe` to Deepgram nova-3 for a live transcript. Also streams motion/activity, taps and free-fall. Auto-reconnects over the USB port the site already has permission for. |
| **Apple Watch app** (`watch/`) | Live heart rate, HRV, SpO2, sleep and other readings, plus haptic taps on the wrist. Pairs from the watch with a 6-digit code. |
| **iPhone app** (`phone/`) | Uploads 365 days of Apple Health daily aggregates to `/api/health/daily`; `/api/health/summary` serves them. A Health export zip can also be imported (`/api/health/import`). |
| **Vision** | GoPro LIT HERO via the Open GoPro USB bridge (`tools/gopro_bridge.py`, frames to `/api/vision/frame`), uploaded video files looped as a live feed, or the laptop camera. |
| **Gemini Live** (`app/live_gemini.py`, `WS /api/live-gemini`) | Speaks calm, real-time guidance from camera frames and audio ("Your glasses are on the kitchen counter"). |
| **Caregiver agent** (`app/care_agent.py`, `POST /api/care/assess`) | Gemini (Interactions API) reads the transcript, what the camera saw, the band, the watch and the routine, and returns a status (**ok / needs attention / urgent**), one next step, a note for the family and the reasons. Falls back to deterministic local rules when Gemini is unavailable. |
| **Server storage** (`app/store.py`) | SQLite for the owner's public demo transcript and health history only. |
| **Other screens** | Your day, Energy, Tasks, Thread, Daily log, Graph (knowledge graph), Transcripts, Integrations. |

Empty screens show clearly labelled **sample** conversations, notes and tasks; one button ("Clear sample data") removes them. Health numbers are real: they are the builder's own Apple Health data, standing in for the person being cared for.

## How it fits together

```
Vexo band ──USB/BLE──> browser ──PCM16──> /api/live-transcribe ──> Deepgram nova-3 ──> live transcript
Apple Watch ──────────> server (pairing code) ──> page: HR, HRV, SpO2, sleep; page ──> watch: haptic tap
iPhone ──Apple Health daily aggregates──> /api/health/daily ──> SQLite ──> /api/health/summary
GoPro (Open GoPro bridge) / looped clips / laptop camera ──frames──> Gemini Live ──> spoken guidance
transcript + what was seen + band + watch + routine ──> /api/care/assess ──> status, next step, family note
```

## Safety rules (enforced in code, after the model)

`app/care_agent.py` checks every Gemini answer before it reaches the page:

- **Urgent only for a real signal:** a band free-fall in the last 10 minutes or a help phrase ("help", "I've fallen", "can't get up", "call 911", ...). The model cannot raise urgent without one, and cannot soften it when one exists.
- **Never diagnoses.** Diagnostic language (stages, infections, "decline", and so on) is removed.
- **Never claims medication was taken or missed.** Sentences matching `MED_CLAIM_RE` are replaced with "Can't confirm medication — check the organiser together."
- **No face identification.** Sentences that recognise or identify people by face are removed.
- **Reasons must cite inputs that were actually provided**; with no inputs the answer is "Not enough information yet."
- If Gemini fails or returns unusable output, the local rules answer and the response says why (`fallback_reason`).

## Sponsors and tech used

Vexo (band 73, Vexo Open kit) · Google Gemini (Live API for spoken guidance; Interactions API for the caregiver agent and knowledge graph) · Deepgram (nova-3 streaming) · GoPro (LIT HERO, Open GoPro API) · Apple Watch and iPhone (HealthKit, SwiftUI) · FastAPI, SQLite, Docker/Traefik.

## Limitations and roadmap

- Not a medical device, diagnostic, or emergency service. Status is a prompt for a human to look, not a verdict.
- Family alerts are a pre-filled text-message link, not push notifications. **Not built yet:** remote family alerts, medication schedule alarms, wandering/geofence detection.
- Health data shown is the builder's, not a patient's. There are no per-user accounts yet; the public site is a single-owner demo.
- Speaker labels separate voices; they are not identity verification. Physical-band behaviour beyond our own band 73 is untested.
- Audio goes to Deepgram and frames/text go to Google when those features run; their retention terms apply.

## Run locally (PowerShell)

Install [uv](https://docs.astral.sh/uv/) if it is not available, then:

```powershell
Copy-Item .env.example .env  # first setup only; keep existing credentials on later runs
uv sync --locked
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Fill the provider keys in `.env` (`GOOGLE_API_KEY`, `GEMINI_MODEL`, `GEMINI_LIVE_MODEL`, `DEEPGRAM_API_KEY`) from your event accounts; see [API setup](docs/API_SETUP.md). Never commit `.env`. Open `http://127.0.0.1:8000/#care`.

GoPro bridge: `uv run python tools/gopro_bridge.py --server http://127.0.0.1:8000` (details in the script header and [Live video and device setup](docs/LIVE_CAPTURE_HANDOFF.md)).

## Vexo band

Set `VEXO_BAND_NUMBER` in `.env` (ours is 73, `Vexo-HACK-73`). On **Your band**, press **Connect band** and pick only your band; close the Vexo dashboard first, since a band serves one program per link. The library in `app/static/vendor/vexo-open/` is the official Vexo Open kit (MIT), copied unchanged; `UPSTREAM_COMMIT` records the version. It refuses any band whose number does not match.

## Main API

- `GET /api/health`: public deployment health. `GET /api/config`: provider readiness (token required).
- `WS /api/live-transcribe`: band (`vexo_pcm`), watch or browser audio relayed to Deepgram; interim/final results with word timings and speaker labels.
- `WS /api/live-gemini`: Gemini Live relay for spoken guidance.
- `POST /api/care/assess`: caregiver assessment (`engine: "gemini"` or `"local"`).
- `POST /api/vision/frame`, `GET /api/vision/latest.jpg`: GoPro bridge frames.
- `POST /api/health/daily`, `POST|DELETE /api/health/import`, `GET /api/health/summary`: Apple Health history.
- `POST /api/watch/start`, `/api/watch/claim`, `WS /api/watch/feed`: Apple Watch pairing and live readings.

## Repository

`app/` FastAPI server and provider adapters; `app/static/` web app; `watch/` watchOS app; `phone/` iPhone uploader; `tools/` GoPro bridge and demo tooling; `tests/` focused checks; `deploy/` Docker/Traefik deployment (SQLite at `THREADLINE_DB_PATH`, `/data` volume).

## Verify

```powershell
uv run pytest
uv run python -m compileall -q app
uv export --no-dev --format requirements-txt --output-file requirements.txt
```

Update the exported requirements whenever `uv.lock` changes. Deployment uses a commit archive, never the working `.env` or local files.

## License

No license file is currently checked in.
