# Threadline motion assets

Four reusable, silent motion studies for a demo edit. These are **illustrative graphics**, not application captures, real recordings, measurements, or clinical evidence. All source-card notes are fictional. The waveform is mathematical decoration.

## Preview

Open `index.html` in a browser. The navigation switches scenes; Replay restarts the scene. The frame is 1920 × 1080 with a 144 px horizontal safe margin and the actual app palette: cream `#f4f0e7`, ink `#262921`, coral `#b44630`. The preview respects reduced-motion preferences with a still composition.

| Scene | Duration | Content |
| --- | --- | --- |
| `title` | 6 s | Threadline title, tagline, drawn thread |
| `memory` | 8 s | Connecting line and three dated fictional source cards |
| `modes` | 6 s | Split-line reveal: Personal reflection / Resume a routine |
| `waveform` | 6 s | Calm decorative waveform, explicitly not a recording |

## Export

Requires an existing Chrome/Edge executable, Node 24+, and ffmpeg with `libvpx-vp9`. No npm packages are needed.

```powershell
node tools/render_motion.mjs all
node tools/render_motion.mjs title --opaque
# Keep individual PNG frames too:
node tools/render_motion.mjs memory --frames
# Capture the two script-aligned clips of the real deployed local-demo interface:
node tools/render_motion.mjs ui
```

Default exports are transparent VP9 WebM files (`*-alpha.webm`) and transparent PNG posters. Use `--opaque` for cream-background WebM and posters. Set `CHROME_PATH` only if the installed browser is not found; `MOTION_FPS` defaults to 24. The renderer calls `window.renderAt(seconds)` for deterministic frame timing. Font rendering uses installed Georgia and Segoe UI; rendering on another operating system may use fallbacks.

Alpha WebM support varies by editor. If an editor discards alpha, use `--frames` and import the PNG sequence, or use `--opaque` for these cream-background compositions. Clips contain no soundtrack and are not an assembled final video.

`ui-reflection.mp4` (22 seconds) and `ui-routine.mp4` (16 seconds) capture the actual deployed interface at `https://threadline.ayushojha.com/`. They follow the exact questions and fictional notes in `docs/demo/DEMO_SCRIPT.md`: the routine clip asks about the next planned step and clicks the plant-note source; the reflection clip clears the original samples, adds the two pre-period reflection notes, retrieves the actual keyword result, clicks its source, and adds the stated intention. Both keep the local retrieval disclosure visible during the result. No live AI provider call is made. The receipt in `ui-capture-receipt.json` records the actual captured result. Captures are 1920 × 1080, 15 fps, with no added soundtrack.
