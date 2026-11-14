# Threadline demo script

## Current narration revision

The initial Bella delivery was rejected as too robotic. Use the conversational [125-word revision](../../assets/demo/narration/narration-expressive.txt) and [Jessica expressive take](../../assets/demo/narration/narration-jessica-expressive.mp3). The [directed input](../../assets/demo/narration/narration-expressive-directed.txt) adds sparse performance cues; captions use the clean text. This keeps the exact two demo questions and existing UI scenes.

Jessica's take is 41.52 seconds. Add source-reading holds, a short title, transitions and an end-card hold for a **60–70 second edit**. Continuous-audio chapter ranges are: routine **0–17.6 s**, reflection **17.6–33.1 s**, closing **33.1–41.52 s**. Matching [SRT](../../assets/demo/narration/narration-jessica-expressive.srt) and [VTT](../../assets/demo/narration/narration-jessica-expressive.vtt) are provided. Retiming an edit requires retiming the captions.

The take uses v4, Jessica, stability 0.30 and similarity 0.65, with thoughtful, curious, warm and gentle cues. It fully decodes, with a peak of −3.2 dBFS. Audition the actual audio before calling it approved; a file-format check cannot establish that it sounds human. Earlier takes below remain as reference, not the current voice recommendation.

Current spoken script:

> She had a plan for the morning. Then came an interruption.
> Now, she’s trying to find her place again.
> “What was my next planned step?”
> Threadline brings back her own note:
> “My next planned step is to water the plant by the window.”
> A small reminder. A place to begin again.
>
> Another woman is looking back on the days before her period.
> “What helped me feel less rushed last time?”
> She finds something she wrote herself: leaving one evening free helped.
> She can open that note, read it in context, and add what she wants to remember this time.
>
> These are fictional examples from our early prototype.
> Threadline connects a question to the words that came before it.
> So you can pick up your thread.

## Deliverable and length

One editorial sequence with two vignettes: a dementia-support concept and personal reflection before a period. Current target: 60–70 seconds; hard ceiling: 120 seconds. Deliver narration audio, visual assets, editable motion assets, and these instructions separately. Do not assemble a full video. The original 80-second beat sheet below can be shortened with the current spoken revision.

The narration master is [narration.txt](../../assets/demo/narration/narration.txt): 139 words. The [Bella v4 take](../../assets/demo/narration/narration-bella-v4.mp3) is 56.16 seconds (peak −1.4 dBFS); an [alternate Multilingual v2 take](../../assets/demo/narration/narration-bella-v1.mp3) is 54.799 seconds (peak −2.1 dBFS). Both fully decode and have no detected clipping. Both use an authorized stock adult female ElevenLabs voice, not a cloned participant. Word timings and captions come from ElevenLabs forced alignment. Use v4 as the initial editorial choice and compare the alternate by listening before locking the edit. The timing below is an edit guide, not timestamps in the continuous voice file; split at chapter pauses and add interface holds to reach roughly 75–80 seconds.

The source ranges below apply to the v4 take. They follow paragraph boundaries in its word alignment.

| Voice chapter | Source audio range | Suggested edit treatment |
| --- | --- | --- |
| Introduction | 0–6.9 s | Title and short establishing image |
| Routine | 6.9–24.1 s | Add a 4–6 s silent source-reading hold |
| Personal reflection | 24.1–45.3 s | Add a 7–10 s silent note-entry/source hold |
| Closing | 45.3–56.16 s | Hold end card for another 3–5 s |

No patient impersonation, dramatic distress, or exaggerated reassurance. The continuous take and source-aligned captions remain separate from the picture. Retiming an edit also requires retiming its captions. Pronunciation/prosody should receive the editor's listening pass before submission; technical audio checks do not establish a subjective voice-quality score.

## What is real in this demonstration

Capture revision: deployed scaffold `1edae7e`. A parallel update at `d8c3f0d` subsequently added microphone capture, speaker review, preferences and a local demo calendar; see [the current live-demo script](../DEMO.md). The statements below describe the captured revision only, not the newer app's complete capabilities:

- The app has Personal reflection and Resume a routine modes, editable session notes, local keyword retrieval, and clickable source-note links.
- The initial data is explicitly fictional. The local response is keyword retrieval, not an AI inference. Preserve the visible `Local demo` status in a genuine app recording.
- Gemini and Deepgram adapters exist, but account keys and real provider requests must be verified before portraying a live provider result. Do not switch on live processing merely for this script.
- Voice narration is an editorial asset; it is not the app speaking. Spoken questions in the soundtrack accompany visibly entered text. Do not fake live microphone input.
- Browser notes disappear on refresh. The demonstration does not establish longitudinal tracking, medical improvement, or real users with either condition.
- BLE capture, Pipecat streaming, camera input, app speech output, calendar changes, and other external actions are not connected. If an optional future-hardware image is used, label it `Concept · wearable capture not connected`. Keep it out of the main proof sequence.

## Exact narration

> Some days, the hardest part is finding your place again.
> Threadline keeps the context in your own words.
>
> In this dementia-support scenario, an interruption breaks a familiar routine.
> “What was my next planned step?”
> Threadline brings back the person’s note:
> “My next planned step is to water the plant by the window.”
> The note is a reminder, not proof that an action happened.
>
> Now, a different moment: reflecting on the days before a period.
> “What helped me feel less rushed last time?”
> Threadline retrieves a personal observation: leaving one evening free helped.
> It doesn’t decide how someone feels, or claim that hormones caused it.
> They can revisit the source and add what they want to remember next.
>
> These are fictional demonstrations of today’s prototype.
> Live voice and wearable capture are the next step.
> Threadline. A little context, kept close.

## Script and visual alignment

| Guide time | Narration / beat | Visual direction | Claim status |
| --- | --- | --- | --- |
| 00–10 | Finding your place; context in your own words | Warm still-life of a mug, plant, and an open notebook. A fine line leads into the actual app wordmark. Title: `A little context, kept close.` | Editorial establishing image. No sensor or recognition overlay. |
| 10–15 | Dementia-support scenario; interruption | Unidentified adult's hand rests near a mug; a notification sound or cut interrupts the composition. Label: `Fictional scenario · routine support concept`. | Illustrative, not a documented patient or efficacy claim. |
| 15–29 | “What was my next planned step?” and the plant note | Genuine Resume a routine capture: enter the exact question, run local retrieval, then click the source containing the planned plant step. Briefly frame that source note. | Implemented local retrieval. Keep `Local demo · no data sent` visible. |
| 29–36 | Reminder, not proof | Hold source note and response together. Restrained overlay: `Your recorded plan, with its source.` | Do not show a tick marking the physical task completed. |
| 36–41 | Different moment; days before a period | Editorial cut to a quiet evening desk. Transition to Personal reflection. Label: `Fictional scenario · pre-period reflection`. | Synthetic self-report, not detected hormonal state. |
| 41–56 | “What helped…” and free-evening observation | Genuine app capture using the synthetic reflection note below. Enter the exact question, retrieve the note, click its source. | Implemented local retrieval; no claimed association analysis. |
| 56–67 | Not deciding feelings; revisit source and add a note | Show source text, then type a new first-person note and press Add note. Overlay: `Your words. Your interpretation.` | Implemented note addition. Do not show a calendar or automatic intervention. |
| 67–80 | Fictional demos; next step; brand | Return to warm still-life and simple end card. Small line: `Prototype · source-linked memory`. Final line: `threadline.ayushojha.com`. Include short availability note below. | Explicit current/planned separation. |

End-card availability note: `Today: session notes + source-linked retrieval. Next: live voice and wearable capture.` A small persistent footer during the two scenarios can read `Fictional examples · not medical guidance`.

## Prepare the two genuine app scenes

Use a fresh browser session and the local demo. Do not capture the password field, access token, real personal notes, or provider configuration. No changes to application code are required for these scenes.

### Routine scene

Select **Resume a routine**. The current fictional sample already includes these exact lines:

1. `I finished breakfast and put my mug beside the sink.`
2. `I left my keys in the blue bowl by the front door.`
3. `My next planned step is to water the plant by the window.`

Replace the default question with `What was my next planned step?`, then press **Revisit my notes**. The local matcher may return several notes; show its actual result. Click the actual source link for the plant note. Do not replace the genuine output with a fabricated concise AI answer.

### Reflection scene

Select **Personal reflection**, use **Clear session**, and confirm. Add these clearly fictional entries through the UI:

1. `Fictional demo entry: Before my last period, I felt rushed. Leaving one evening free helped me feel less overwhelmed.`
2. `Fictional demo entry: I want to remember what I said helped, rather than assume every cycle is the same.`

The UI timestamp is the note's entry time, not evidence of a historical cycle date. The wording above is explicitly a retrospective fictional report. Ask `What helped me feel less rushed last time?`, run local retrieval, and click the first note's real source link. Then add:

`Fictional demo entry: This time, I want to make space for one quieter evening and see whether it helps.`

The new note records an intention. Do not animate a calendar reservation or label the preference medically recommended.

## Editorial motion and sound

- Use the current app's warm ivory, dark ink, and muted earthy accent as the visual reference. Keep editorial overlays outside the recorded app frame so they are not mistaken for implemented controls.
- Use one consistent fine-line motif connecting the remembered statement to its source. Animate position and opacity only; no biometric waveforms, hormone curves, diagnostic meters, or invented sensing effects.
- App footage may receive a slow crop/zoom and an external source highlight. Do not hide limiting status labels or change returned words.
- Add one soft transition cue at the change of vignette and a quiet end-card resolve. Keep music optional and clearly below the narration; never trade speech clarity for atmosphere.
- Supply clean voice audio and any music/effects as separate files. Caption the exact narration. Do not burn everything into a combined finished video.

## Acceptance checks

- The final spoken text matches the narration master and is under 160 words.
- Both scenes include actual app interaction, visible source provenance, and fictional-data disclosure.
- No generated lifestyle image is presented as a real participant, interview, or current camera input.
- No scene claims passive capture, voice output from the app, task completion, diagnosis, causal cycle inference, or actual external action.
- Both vignettes can be understood with captions and without audio. Overlays remain legible at 1080p.
- The recorded app state and domain are checked immediately before capture. Use a clearly labeled prototype capture if the public deployment is unavailable.
