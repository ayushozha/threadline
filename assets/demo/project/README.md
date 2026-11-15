# Threadline project media

Open `index.html` for the current son-perspective film and the screenshot gallery.
Download `threadline-media-kit.zip` for the portable package.

## Current film

`son-cut/newfilm.mp4` is the current cut. Chris narrates in natural English as
Daniel, Evelyn’s son. The male presenter is a dramatized illustration, not a
real interview or a lip-synchronized recording of the narrator.

The cut uses recorded website interaction: a fresh scene-analysis request,
its response, a follow-up, and a Nepali question with a Nepali text answer.
The scene footage itself is synthetic. A visible answer is not proof of spoken
Nepali playback; that audio path is not demonstrated. Physical wearable latency
and emergency or medical reliability are not established by this film.

`son-cut/narration.txt` is the actual spoken script. `edit-plan.json` and
`render-receipt.json` record the match between narration and visible actions.
The final `.srt` and `.vtt` are timed to the film, including its pauses. Individual
voice chapters and their captions remain under `son-cut/narration/`.

The package includes only chapters used in the edit. The superseded control
chapter and unused/reversed English follow-up video are not included. Still
frames of the response and the continuous Nepali capture remain available with
the request-event manifests.

## Other assets

The six screenshots in `screenshots/` are earlier local captures of Dashboard,
Memory, Transcripts, Hearing, Scenario Library and report previews. Their
manifest states the captured data and context. `live-capture/` contains the
recorded deployed UI used for the preceding cut.

`threadline-two-minute-demo.mp4` and its female narration are archived as the
preceding edit. `earlier-four-mode-concept.mp4` is the older concept film.
`final-video-script.md` is the earlier sunflower story, not the current narration.

No message delivery, physical band session or clinical performance is implied.
The ZIP contains the gallery’s required media, selected source assets and
provenance. It excludes credentials, private health records, unused takes and
large word-alignment files. Build and verify it with
`uv run python tools/package_project_media.py`.
