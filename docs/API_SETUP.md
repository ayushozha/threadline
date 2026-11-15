# API setup

## Current Vexo-first setup

The public page creates a short-lived, HttpOnly browser session automatically;
there is no user-facing provider switch or access-token field. Keep the recording
and processing consent on the page. All provider credentials stay server-side.

Configure the server with `APP_GUEST_SESSIONS=1`,
`APP_PUBLIC_ORIGIN=https://threadline.ayushojha.com`, a strong `APP_ACCESS_TOKEN`,
the Gemini and Deepgram keys/models, `VEXO_BAND_NUMBER=73`, and
`GEMINI_DECISION_MODEL=gemini-decision-1`. Never enable `APP_TRUST_LOOPBACK` on the
public server. Local development can continue to use its loopback-only option.
Existing nonempty ElevenLabs settings must be preserved when updating credentials.

Automatic sessions are a bounded public demo allowance, not user identity or
private account access. They expire, enforce request and streaming limits, and
cannot create Apple Watch pairings. Operator scripts can still send
`X-App-Token`; the browser does not receive that token. Run one backend worker
while these sessions live in process memory; a restart requires a new session.
Each browser session permits up to two hours of capture, 20 MiB of audio and
30 connection attempts; global concurrency remains limited. Short reconnects
retain at most two seconds of band packets. Longer gaps are shown as missed
packets instead of claiming uninterrupted capture. Keep the page open while using
Web Bluetooth; suspending the browser can interrupt device access.

`DEEPGRAM_LANGUAGE=multi` removes the former English-only restriction;
`DEEPGRAM_ENDPOINTING_MS=100` matches the Vexo reference's pause setting. Supported
languages depend on the configured model. The browser keeps at most 12 seconds
of decoded audio in memory and can submit a short, consented WAV to Gemini at
`POST /api/transcribe/fallback` when speech has no transcription or when the user
chooses **Check recent speech**. This fallback preserves the original language
and script, does not identify speakers, and is not a guarantee for every language.
Finalized transcript lines now update the current browser-local archive as they
arrive, without waiting for Stop. Provider controls and keys stay off the page.

The older endpoint details below remain reference material; the old instructions
to type an access token or turn on provider controls no longer describe the UI.

Threadline uses FastAPI, Uvicorn, HTTPX, and python-dotenv for a small hackathon prototype: Deepgram transcribes uploaded audio and Gemini answers from selected memory evidence through server-side REST calls. The browser must not receive provider credentials. ElevenLabs fields are reserved for a future speech integration; speech generation is not implemented.

This document describes the configuration contract. A configured key is not proof that a provider call, a wearable connection, or an end-to-end feature has been tested.

## Keys to obtain

| Service | Needed for | Get credentials | Environment variables |
| --- | --- | --- | --- |
| Google Gemini | Live responses grounded in supplied transcript evidence | [Google AI Studio API keys](https://aistudio.google.com/apikey) | `GOOGLE_API_KEY`, `GEMINI_MODEL` |
| Deepgram | Transcribing recorded or uploaded audio | [Deepgram Console](https://console.deepgram.com/) | `DEEPGRAM_API_KEY`, `DEEPGRAM_MODEL`, `DEEPGRAM_DIARIZE_MODEL` |
| ElevenLabs, future optional integration | Reserved speech configuration; not currently used | [ElevenLabs](https://elevenlabs.io/sign-up), then the account's Developers/API keys page | `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL` |

Use sponsor-provided accounts or credit redemption instructions where available. No additional paid subscription is assumed. Rate limits, model access, and remaining credits depend on the account.

Select the exact Gemini model from the [official model list](https://ai.google.dev/gemini-api/docs/models) that your key can use, and place its identifier in `GEMINI_MODEL`. The example uses `gemini-4-hydrogen`, listed in the official documentation checked on November 14, 2026; account access still needs verification. Do not paste a display name or silently substitute another model. `DEEPGRAM_MODEL=nova-3` is a documented transcription example; change it in configuration if needed. Keep the reserved ElevenLabs values empty until that integration exists.

## Fill the local configuration

From the project directory in PowerShell, copy the example once if `.env` does not already exist:

```powershell
if (-not (Test-Path -LiteralPath '.env')) {
    Copy-Item -LiteralPath '.env.example' -Destination '.env'
}
notepad .env
```

Fill values in that local file. Set `APP_ACCESS_TOKEN` to a strong random value; the browser uses it in `X-App-Token` for protected requests and retains it only for the current session. Do not paste credentials into a chat, source file, screenshot, frontend build, or issue. Restart the server after changing configuration.

| Variable | Meaning |
| --- | --- |
| `APP_HOST` | Local bind address; the example uses `127.0.0.1`. |
| `APP_PORT` | Local HTTP port; the example uses `8000`. |
| `APP_ACCESS_TOKEN` | Required shared access token for protected app API requests; intentionally blank in the example. |
| `GOOGLE_API_KEY` | Server-side Gemini credential sent directly by the backend REST client. |
| `GEMINI_MODEL` | Required model identifier for live Gemini requests; selected through configuration. |
| `DEEPGRAM_API_KEY` | Server-side speech-to-text credential. |
| `DEEPGRAM_MODEL` | Speech-to-text model identifier. |
| `DEEPGRAM_DIARIZE_MODEL` | Diarization version; `latest` is the documented example. The backend sends `diarize_model`, not the deprecated `diarize` boolean. |
| `ELEVENLABS_API_KEY` | Reserved future server-side speech credential; currently unused. |
| `ELEVENLABS_VOICE_ID` | Reserved future voice identifier; currently unused. |
| `ELEVENLABS_MODEL` | Reserved future speech model identifier; currently unused. |

No OpenAI, Stripe, Mastra, or Pipecat Cloud key is required by this configuration. Pipecat is a possible later streaming voice integration, not an API credential or a completed integration by virtue of installing a package.

## Provider API responsibilities

**Transcription:** send consented audio to Deepgram's `POST https://api.deepgram.com/v1/listen`, authenticated with the API key in the `Authorization` header. Keep timestamps when supplied so a response can point back to its source. See the [prerecorded audio reference](https://developers.deepgram.com/reference/speech-to-text/listen-pre-recorded).

**Evidence-backed responses:** send the question and selected transcript excerpts to Gemini's `POST /v1beta/interactions` API with provider storage disabled. Responses should distinguish direct statements, tentative comparisons, and missing evidence. Source identifiers must refer to actual supplied entries. See the [generation reference](https://ai.google.dev/gemini-api/docs/text-generation).

**Future speech option:** ElevenLabs offers `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}` with a configured model. The scaffold does not call this endpoint, and bracelet playback has not been established. See the [text-to-speech reference](https://elevenlabs.io/docs/api-reference/text-to-speech/convert).

## Local API and data flow

| Route | Access | Purpose |
| --- | --- | --- |
| `GET /api/health` | Public | Basic health check. |
| `GET /api/config` | `X-App-Token` | Reports provider configuration status without returning credentials. |
| `POST /api/reflect` | `X-App-Token` | Sends the explicitly selected notes and question to Gemini. |
| `POST /api/transcribe` | `X-App-Token` | Accepts supported raw audio bytes with their actual audio content type and forwards them to Deepgram. |

The static interface is public and initially presents labeled synthetic demo data. Personal notes remain in the browser; an explicit live reflection request sends the selected notes to Gemini. The server does not persist notes or uploaded audio locally. Provider processing and retention policies still apply. Interactive `/docs` is disabled.

## Feature boundaries

- Cycle reflection uses user-entered cycle information and the person's recorded statements. It does not infer hormone levels, diagnosis, or decision-making ability from voice.
- Task resumption uses stated intentions and source evidence. It cannot establish that a physical action was completed merely because it was mentioned.
- Neither mode creates a medically validated or trained cognitive baseline. Synthetic demo history must remain labeled as synthetic.
- Speaker diarization separates turns; it does not prove who a speaker is. Confirm which speaker is the wearer before attributing personal information, and exclude uncertain attribution. Deepgram documents the current diarization options [here](https://developers.deepgram.com/docs/diarization).
- Recording must be deliberate and consented. Before a live demo, disclose that uploaded audio goes to Deepgram and explicitly selected transcript context goes to Google. Use synthetic or volunteered data rather than private medical conversations.
- Calendar changes, messages, purchases, wearable streaming, and camera input need their own implemented and verified paths. They are not enabled by these keys.

## Check before the demo

1. Confirm the app starts and reports missing configuration without showing secret values.
2. Use one short, consented audio sample to check transcription and source timestamps.
3. Ask a question with a known answer in the sample, then one the sample cannot answer. Check grounded evidence and honest uncertainty.
4. Verify missing or incorrect app tokens are rejected on all protected routes.
5. Confirm only selected notes leave the browser on an explicit live request. Do not interpret absence of local server persistence as a guarantee about provider retention.

Troubleshoot `401`/`403` by checking the provider account and access without printing the key; check model identifiers for model-not-found errors; check account credits and rate limits for `429` responses. Keep provider failures visible rather than displaying fabricated success.

## Calendars (Google and Apple)

Both are optional. Threadline stores no calendar data and no calendar credentials; connections live in the open browser tab. Nothing is written to a calendar until the person taps the button for that event.

### Google Calendar

1. In [Google Cloud Console](https://console.cloud.google.com/) create a project, enable the **Google Calendar API**, and configure the OAuth consent screen (add yourself as a test user while it is in testing).
2. Create an **OAuth client ID** of type **Web application**. Under *Authorized JavaScript origins* add the app's address, e.g. `http://127.0.0.1:8000` and `http://localhost:8000`. No redirect URI and no client secret are needed.
3. Put the client ID in `.env` as `GOOGLE_OAUTH_CLIENT_ID=...apps.googleusercontent.com` and restart. The content-security policy only allows Google's sign-in script when this is set.
4. In the app: **Tasks → Calendars → Connect Google Calendar**. The scope is `calendar.events` (read and write events). The sign-in lasts about an hour, then connect again.

### Apple Calendar (iCloud)

Apple has no browser sign-in for calendars, so Threadline uses CalDAV with an **app-specific password**: appleid.apple.com → Sign-In and Security → App-Specific Passwords. Enter the Apple ID and that password under **Tasks → Calendars → Connect Apple Calendar**. They are sent to this server with each request, used to talk to `caldav.icloud.com`, and not stored or logged. The server only contacts `*.icloud.com` hosts. Do not enter a real Apple ID password.

Tested against a simulated iCloud only; it has not been run against a real account.
