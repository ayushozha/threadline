# Threadline project media

Open `index.html` for the gallery, or download `threadline-media-kit.zip`.

The six 1920 × 1080 screenshots show the actual local app: Dashboard, Memory,
Transcripts, Hearing, Scenario Library and report previews. They use the
built-in example conversations and an empty local database, with no private
recordings or patient Health data. The Library capture uses synthetic scenes.
No connected hardware or completed message delivery is implied.

`screenshots/manifest.json` records capture provenance. Reproduce the screenshots
with `tools/capture_project_media.mjs` against an isolated local server.

`final-video-script.md` is the current two-minute Evelyn, Emma and Lily story.
Its dialogue is rehearsal copy. A matching two-minute film has not been made
as part of this media package.

`earlier-four-mode-concept.mp4` is the earlier 58.8-second concept film with
Jessica narration and English captions. Its scenes and response text are
illustrative; it is not the new two-minute film or a recording of live inference.

The ZIP includes the screenshots, manifest, project thumbnail, this README,
current script, and the clearly labeled earlier concept film and captions.
`tools/package_project_media.py` builds and verifies the ZIP using Python's
standard library.
