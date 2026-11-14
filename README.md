# Threadline

Personal memory, with the thread still attached. A VexoHacks starter for exploring lived-experience reflection and resuming interrupted routines.

[Live prototype](https://threadline.ayushojha.com) · [API setup](docs/API_SETUP.md) · [Deployment](deploy/README.md)

## Status

| Surface | Status |
| --- | --- |
| Two fictional memory scenarios, editable notes, local response | Implemented prototype |
| Gemini grounded-response adapter | Implemented; requires your API key and accessible model |
| Deepgram audio-file transcription | Implemented; requires your API key |
| Vexo live BLE audio and motion | Pending the event Bluetooth contract |
| Pipecat streaming voice, ElevenLabs playback | Planned; not connected |
| Calendar, purchases, health assessment | Not implemented |

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

Browser memory and consent controls → authenticated FastAPI adapters → Gemini / Deepgram. Local demo replies do not use AI. Responses identify source note IDs. Only explicitly submitted notes or audio reach providers; the server does not persist them. The public deployment is for synthetic demonstrations until individual accounts and data controls are implemented.

## API

- `GET /api/health`: public deployment health.
- `GET /api/config`: provider-readiness flags; requires `X-App-Token`.
- `POST /api/reflect`: `{mode, question, notes:[{id,text,at}]}`; requires token. Stateless grounded response.
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
