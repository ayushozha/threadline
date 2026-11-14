# Threadline demo asset handoff

Open [the asset gallery](../../assets/demo/index.html) locally. It contains separate assets for an approximately 60–70 second edit; no completed video was assembled. The first Bella voice was rejected as robotic; the current take is a rewritten, directed Jessica performance, with two short auditions for comparison.

## Ready assets

| Material | Location | Checked |
| --- | --- | --- |
| Main female voiceover | `assets/demo/narration/narration-jessica-expressive.mp3` | 41.52 seconds, 44.1 kHz mono, peak −3.2 dBFS, full decode; user listening review pending |
| Voice auditions | `assets/demo/narration/audition-*-expressive.mp3` | Directed Jessica and Lily alternatives, about 15 seconds each |
| Captions | Matching `.srt` and `.vtt` files | 125 source words aligned by ElevenLabs, 16 cues for the current take |
| Routine interface | `assets/demo/motion/ui-routine.mp4` | 16 seconds, 1080p, actual query/result/source link |
| Reflection interface | `assets/demo/motion/ui-reflection.mp4` | 22 seconds, 1080p, exact fictional notes, query, source and intention |
| Local image stills | `assets/demo/visuals/*.png` | Three native H3-Image images, 1536×864; inspected for composition and visible artifacts |
| Image motion | `assets/demo/visuals/*-motion.mp4` | Separate 5-second 1080p digital push-ins; no AI video generation |
| Transparent graphics | `assets/demo/motion/*-alpha.webm` | Title, memory, modes, optional decorative waveform; 1080p VP9 alpha |
| Sound cues | `assets/demo/audio/*.wav` | Original quiet tones, 48 kHz mono; 1.1 and 1.8 seconds |
| Edit instructions | [Script](DEMO_SCRIPT.md), [shot list](SHOT_LIST.md) | Actual capabilities separated from future work |

The generated stills have adjacent JSON receipts with prompts, model filenames, seeds and runtime revision. [Model manifest](model-manifest.json) records the two downloaded files, pinned source revision and verified SHA-256 hashes. The image encoder is reused from the previous hackathon; the old project was not modified. Weights and the isolated ComfyUI checkout remain local and ignored by Git.

## Edit approach

Use the opening still and title, then show the actual routine interaction. Transition with the evening image to the reflection interaction. End with the title graphic and a readable product-status line. Split the voice at paragraph pauses and add quiet source-reading holds to fit the 60–70 second target. The SRT/VTT files match the continuous voice file; retime captions if pauses are added.

The interface captures use **local keyword retrieval**, with the disclosure visible. They do not prove live Gemini, BLE, passive recording, medical assessment, calendar actions, or app speech. The voiceover is an editorial track. All scenarios are fictional. The image animation is an ordinary digital push-in, not H3 video synthesis. A waveform layer is optional decoration only.

Jessica is the current default. Listen before locking the edit; Lily's audition offers a different delivery. Technical audio checks verify timing and clipping, not subjective naturalness. No claim of listening approval is made.

## Reproduce

Existing dependencies: Python environment via `uv`, installed Node, Chrome/Edge, ffmpeg and the previous ComfyUI Python environment. No new package was added to the application.

```powershell
# Existing outputs are preserved by the voice/image tools; choose a new filename or folder.
uv run python tools/generate_dialogue_narration.py --text assets/demo/narration/narration-expressive-directed.txt --output assets/demo/narration/new-take.mp3
uv run python tools/prepare_demo_audio.py --audio assets/demo/narration/new-take.mp3 --text assets/demo/narration/narration-expressive.txt
node tools/render_motion.mjs all
node tools/render_motion.mjs ui
./tools/start_local_image_runtime.ps1
uv run python tools/generate_local_h3_images.py mug-plant --output assets/demo/visuals-v2
uv run python tools/animate_demo_stills.py
uv run python tools/build_demo_manifest.py
```

Set `ELEVENLABS_MODEL` appropriately for the chosen voice endpoint: the Text to Dialogue helper uses the v4-compatible API, while `generate_narration.py` uses Text to Speech. Model and voice IDs are read from local `.env`. See [local image setup](LOCAL_IMAGE_RUNTIME.md) for runtime paths and model files.

## Presentation and app revision

The [event deck transcription](../VEXOHACKS_2026-11-14_EVENT_PRESENTATION.md) arrived in a parallel update and has now been read. It lists wearables, voice and real-world experiences; a public-repository submission requirement; and separate sponsor tracks. MiniMax image assets and ElevenLabs narration are actual uses. These clips do not establish Pipecat use or a live economic-agent integration, so do not claim those tracks from the assets alone. Repository visibility and submission remain separate actions.

The UI clips were captured from the earlier deployed scaffold at `1edae7e`. The merged app at `d8c3f0d` adds microphone controls, speaker review, saved preferences and a local demo-calendar action. Those features are described in [the current live-demo script](../DEMO.md), but are not shown in these earlier clips. Do not present these captures as a comprehensive demonstration of the newer app. Voice playback, BLE and real external calendars remain unconnected.
