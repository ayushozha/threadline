# Voice assistant (Pipecat)

The Vexo band mic is always on. The browser decodes band Opus to PCM16 (the vendored kit's `BandAudio` + `toInt16`)
and streams it to `WS /api/voice`. Server code: `app/voice.py`. Pipecat 1.16. Browser code: the voice branch of live
capture in `app/static/app.js`, and `app/static/assistant.js` (speech playback, conversation, Assistant page).

```
band PCM16 16 kHz -> level meter -> Deepgram STT (diarized) -> Assistant -> TTS (ElevenLabs or Deepgram Aura) -> PCM16 24 kHz
                                                                  |
        speech analysis: loudness + pace + wording -> app/affect.py (own-baseline shifts) -> low energy / moodiness?
        app/agent.py decide() (Gemini Decisions) + Gemini spoken reply
```

## Using it

1. Fill `.env` (below), restart, open the app on this computer (`APP_TRUST_LOOPBACK=1`; the voice loop is not offered to
   anonymous guest sessions).
2. Your band -> connect. A consent dialog opens right away (recording and processing by Deepgram and Google, plus the
   assistant's listening and speaking). **I agree** -> press the red button. It asks again for each new connection, and if
   you press record without having agreed.
3. Everything said is transcribed live and saved on the **Transcripts** page when you stop (same as before).
4. The **Assistant** page shows the conversation: your "Vexa, ..." requests, its replies (spoken out loud on this
   computer), why it spoke up, and the decision it made. Stored in this browser only.

## Recording, local audio, and reconnecting

- Connecting the band opens the consent dialog; **I agree** starts recording at once (no second click).
- The band's audio is decoded in the browser and saved on this computer in IndexedDB (`app/static/audiostore.js`),
  about every 5 s, as 16 kHz mono PCM. It is never uploaded by this code. See **Transcripts -> Saved audio on this
  computer** to play, download (WAV) or delete it. Oldest recordings go beyond 2 GB. Clearing site data deletes them.
  If transcription is unavailable, the band's audio is still saved (local-only capture).
- The separate **server copy** (access code, `/api/recordings`) is the optional cloud route and is unchanged.
- After a refresh the page reconnects to the band by itself (no chooser) using the USB port or Bluetooth device the
  browser already remembers, then asks for consent again and starts. Pressing **Disconnect** turns this off until you
  connect again. Needs a Chromium browser; if the browser has forgotten the device, the Connect buttons stay.

## What triggers the assistant

- **Addressed:** a final transcript containing a wake word (`VOICE_WAKE_WORDS`, default `vexa, vexo, hey vexa`).
- **Low energy / moodiness (proactive, on by default, toggle on the Assistant page):**
  - *words*: the wearer says e.g. "exhausted", "drained", "overloaded" (low) or "irritated", "frustrated", "on edge" (moody);
  - *signals*: the wearer's loudness, speech pace and wording move away from their **own baseline** (`app/affect.py`,
    the same engine the sensors use) and stay there for two readings. Until about 20 utterances have been heard it
    reports "still learning" and never guesses.
  - At most one spoken nudge per `VOICE_TRIGGER_COOLDOWN_S` (default 600 s). The page also receives every reading, so
    the Energy page updates (`applyAffect`), and the decision (`actOnDecision`: offers, watch tap, music...) is acted on
    exactly like a typed statement.
- **Wearer:** only the most talkative diarized speaker is read for mood. Diarization does not prove identity.

## Settings

`DEEPGRAM_API_KEY`, `DEEPGRAM_MODEL`, `GOOGLE_API_KEY`, `GEMINI_MODEL`, `GEMINI_DECISION_MODEL` plus a voice:
`DEEPGRAM_TTS_VOICE` (an Aura voice id), or `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID` (preferred when set;
`VOICE_TTS=deepgram|elevenlabs` overrides). Optional: `VOICE_WAKE_WORDS`, `VOICE_TRIGGER_COOLDOWN_S`.
`GET /api/config` returns `voice_ready`. A rejected key or voice sends the page one `error` event and ends the session.

## Socket protocol

1. Open `WS /api/voice`; send JSON `{"token": "..."}` (token optional on trusted localhost).
2. Server replies `{"type":"ready","in_rate":16000,"out_rate":24000}` (or `{"type":"error","message"}` and closes).
3. **Browser -> server**: binary frames = raw little-endian PCM16 mono at 16 kHz (any chunk size). Text frames, JSON:
   - `{"type":"context","context":{preferences,tasks,today,recent,devices},"affect":<life.affect>,"proactive":true}`
     context has the shapes of `POST /api/agent/decide`; `affect` is the saved baseline (adopted once per session).
     Resend about every 30 s and when `proactive` changes.
   - `{"type":"say","text":"..."}` speak one line (at most one per minute, 280 chars).
   - `{"type":"stop"}` flush, finish, then the server sends `{"type":"closed","bytes":N}` and closes.
4. **Server -> browser**: binary frames = PCM16 mono at 24 kHz speech; play in order. Text frames, JSON:
   - `result` interim: `{is_final:false, transcript}`
   - `result` final: `{is_final:true, speech_final, transcript, speaker, id, at, start, duration, words[], addressed, wearer}`
     (same shape as `/api/live-transcribe`, so the live transcript and archive code work unchanged).
     When `addressed` is false the page runs its own `/api/agent/decide`, as before.
   - `affect`: the `/api/affect/update` result for this utterance (`energy`, `arousal`, `valence`, `confidence`, `sources`,
     `drivers`, `state`), plus `id`, `at`.
   - `decision`: `{id, decision, text, at}` for an addressed or triggered turn.
   - `assistant`: `{text, trigger?}` what it is saying; `trigger` = `{kind:"words", energy, evidence, text}` or
     `{kind:"signals", energy, drivers}`.
   - `error`: `{message}`.

## Behavior and limits

- The assistant ignores the mic while speaking and for 1.5 s after (the speaker is heard by the band).
- Nothing is stored server-side. Spoken-reply content guardrails are empty for now; `app/agent.py` keeps its own.
- Pipecat's RTVI layer is disabled (`enable_rtvi=False`): it swallows non-RTVI browser messages.
- Not done: barge-in (talking over the assistant), pitch (F0) features, live run against the physical band 73.
  Verified: simulated band in headless Chrome -> decoded PCM -> `/api/voice` -> `ready` and clean error handling.
  Not yet verified: live Deepgram STT/TTS and Gemini replies in this build (needs a voice id and permission to send audio).
