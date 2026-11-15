# Transcript-driven screens

Threadline is a hackathon prototype. AI interpretation can be wrong; every
personal interpretation retains the words that produced it.

Choose **Just me** before recording to confirm that only you are speaking.
Completed thoughts then enter your personal thread automatically. The shared
**Conversation** mode keeps speech in the transcript and proposes actions,
but does not attribute other people's statements to you. Stop recording before
changing modes. Neither diarization nor Gemini identifies a person.

| Screen | What updates |
| --- | --- |
| Your band | Immediate interim text; finalized lines; complete-thought suggestions. |
| Thread | Automatic statements in Just me mode, or manually reviewed conversation. |
| Your day | Saved statements trigger a source-linked summary after a 10-second batching window. |
| Energy | Explicit current self-reports classified by Gemini; voice/movement remain separate context. |
| Tasks | Transcript-derived drafts appear in both Tasks and Your band, editable before saving. |
| Transcripts | Raw finalized speech updates continuously, including other speakers. |
| Daily log | Counts and summaries update from saved statements; deleting a source removes its derived energy entry. |
| Graph | Rebuilds from saved words after an 8-second batching window, or on opening Graph. |

Speech goes directly to Deepgram without waiting for agent, graph, or summary
requests. Finalized fragments are joined through an utterance boundary or
1.2 seconds without another finalized fragment. Agent requests use a serial
queue (100 pending items); overflow is visible and never interrupts the saved
transcript. Background requests do not disable recording controls.

Multilingual self-reports use the existing Gemini decision request. They do not
infer emotions from voice, diagnose conditions, or infer hormones. The current
transcript must contain the report. A conversation self-report requires speaker
confirmation before affecting personal energy history.

Summaries and graphs may lag behind live text and remain bounded by provider
availability and demo quotas. Their source links open the corresponding Thread
statement. Results from a different band, a deleted source, or an edited source
are discarded. Task drafts retain their source words and live only in this
browser. Sending messages, applying calendar changes, Health writes, and music
playback retain their explicit user controls. No new outbound connector is
implied by a draft or suggestion.

Raw Transcripts and the personal Thread are separate stores. Excluding someone
from your Thread does not delete their words from the raw transcript. Use the
Transcripts deletion controls when those recordings are no longer wanted.

Checks: `uv run pytest -q`, `node --test tests/*test.mjs`, and the actual browser
flow with synthetic speech fixtures. Physical band/microphone quality requires
a real device check; synthetic fixtures do not establish recognition accuracy.
