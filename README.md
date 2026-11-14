# Threadline

Personal memory, with the thread still attached. Built at VexoHacks (AI wearables, Y Combinator, November 14, 2026).

[Live prototype](https://threadline.ayushojha.com) · [Demo script](docs/DEMO.md) · [API setup](docs/API_SETUP.md) · [Deployment](deploy/README.md)

## The problem

When mood, energy, or concentration fluctuate, it can be hard to reconstruct what happened, recognize your own patterns, and remember what helped — without the extra work of keeping a diary. Threadline keeps your own words from a consented conversation, with their time and source, and carries out only the support you chose in advance.

The chain: **captured statement → your own memory, attributed to you → relevant earlier evidence → a preference you saved → one action you approve.**

Threadline does not tell anyone their feelings are invalid, infer hormones, diagnose, or judge capacity. Cycle timing, when present, is optional self-reported context — never a cause.

## Status

| Surface | Status |
| --- | --- |
| Two scenarios (personal reflection, resume a routine) with labeled fictional history | Implemented |
| Browser-microphone capture: consent, start/stop, recording state, playback, delete | Implemented (browser mic, not the bracelet) |
| Review before saving: pick which speaker is you, correct text, drop other people's speech | Implemented |
| Correct or delete saved notes; source badges (fictional / typed / mic / file / scripted) | Implemented |
| Saved support preferences matched against your own words (local keyword rule, labeled) | Implemented; not AI |
| Support offer showing why: the new statement, the preference, and earlier dated evidence | Implemented |
| Approved action: find time, propose, re-check, recover from a conflict, create, undo | Implemented on a **local demo calendar** in the browser; no external calendar |
| Scripted demo conversation for use without microphone or keys | Implemented; labeled as scripted |
| Gemini grounded-response adapter | Implemented; requires your API key and accessible model |
| Deepgram audio-file transcription | Implemented; requires your API key |
| Vexo live BLE audio and motion | Pending the event Bluetooth contract |
| Pipecat streaming voice, ElevenLabs playback | Planned; not connected |
| Google/real calendar, purchases, messages, health assessment | Not implemented |

## Run locally (PowerShell)

Install [uv](https://docs.astral.sh/uv/) if it is not available, then:

```powershell
Copy-Item .env.example .env  # first setup only; keep existing credentials on later runs
uv sync --locked
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Open http://127.0.0.1:8000. The fictional local demo needs no provider keys. To enable live requests, set a strong `APP_ACCESS_TOKEN`, `GOOGLE_API_KEY`, `GEMINI_MODEL`, and optionally `DEEPGRAM_API_KEY` / `DEEPGRAM_MODEL` in `.env`. Enter the project access token in the live-provider controls. Provider keys remain on the server. Restart after changing `.env`.

The root task created an ignored `.env` with a generated access token. Fill the empty provider key fields using your event accounts. `APP_HOST` / `APP_PORT` document local host/port defaults; the command flags determine Uvicorn's listener.

## Minimal architecture

Browser memory and consent controls → authenticated FastAPI adapters → Gemini / Deepgram, plus a stateless demo-calendar planner (`app/schedule.py`). Local demo replies and preference matching do not use AI. Responses identify source note IDs. Only explicitly submitted notes or audio reach providers; the server does not persist them. The public deployment is for synthetic demonstrations until individual accounts and data controls are implemented.

## API

- `GET /api/health`: public deployment health.
- `GET /api/config`: provider-readiness flags; requires `X-App-Token`.
- `POST /api/reflect`: `{mode, question, notes:[{id,text,at}]}`; requires token. Stateless grounded response.
- `POST /api/schedule/find-slot`: `{events, date, window_start, window_end, duration_minutes, skip}`; public, stateless. Returns the first free slot and every time it checked. Operates only on the demo calendar the browser sends.
- `POST /api/schedule/book`: `{events, event}`; public, stateless. Re-checks for conflicts and returns `409` with the conflicting events, or the created event. Nothing is stored server-side.
- `POST /api/transcribe`: raw audio body and supported `audio/*` content type, maximum 10 MB; requires token. Speaker labels are not identity verification. Automatic live BLE capture is not connected.

## Repository

`app/main.py` provider adapters; `app/static/` browser prototype; `tests/` focused boundary checks; `docs/API_SETUP.md` credentials and provider links; `deploy/` isolated Docker/Traefik deployment.

## Verify

```powershell
uv run pytest
uv run python -m compileall -q app
uv export --no-dev --format requirements-txt --output-file requirements.txt
```

Update the exported lock requirements whenever `uv.lock` changes. Deployment uses a commit archive, never the working `.env` or local files. Work goes directly to `main` as requested; do not create PRs or bypass remote protections.

## Limits and privacy

This is not a diagnostic, monitoring, emergency, or validated cognitive-assessment product. It does not infer hormone levels, judge capacity, establish dementia, or prove cycle-related causation. Notes can be wrong; check the cited sources and correct them. No real recordings or personal information are committed. Synthetic demo data is isolated in the browser and disappears on refresh. Clearing the page does not delete information already sent to a provider; its retention terms apply.

## License

No license file is currently checked in.
