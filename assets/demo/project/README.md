# Threadline project media

Open `index.html` to watch the completed two-minute film and view the gallery,
or download `threadline-media-kit.zip` for the portable assets.

`threadline-two-minute-demo.mp4` combines Jessica narration, actual app captures,
and clearly identified illustrative scenes. `final-render-receipt.json` records
the edit. The exact spoken script is `narration.txt`; the raw voice track is
`final-narration.mp3`, with aligned `.srt`, `.vtt` and chapter timings. Raw-track
caption timings do not include additional visual holds in the completed film.

The six 1920 × 1080 screenshots show Dashboard, Memory, Transcripts, Hearing,
Scenario Library and report previews. `screenshots/manifest.json` records their
local capture provenance. `live-capture/manifest.json`, when present, records the
additional deployed-app capture. Example inputs and a saved model response are
not presented as a physical band session. No completed message delivery or
clinical performance is demonstrated.

`final-video-script.md` is the earlier sunflower-story production concept. It
is included for reference and is not the narration of the completed film.
`earlier-four-mode-concept.mp4` is the separate 59-second concept film, with its
own `.vtt`; it uses illustrative scenes and response text.

The media kit includes the completed film, poster, raw narration and captions,
actual spoken script, capture/render manifests, six screenshots, thumbnail,
this README, gallery, and separately named earlier concept materials. It does
not include credentials, raw private health data, or large alignment metadata.
`tools/package_project_media.py` builds and verifies the ZIP using Python's
standard library.
