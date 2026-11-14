# Threadline shot and asset list

Companion to [DEMO_SCRIPT.md](DEMO_SCRIPT.md). This is an assembly plan for separate assets, not a request to render a completed video. Target: 16:9, 1920×1080, approximately 80 seconds. Allow modest retiming after measuring the actual narration.

Revision: use the current Jessica expressive narration (41.52 seconds), with a 60–70 second total target. The original shot inventory below is reusable; shorten establishing and closing holds rather than rushing the actual source-reading scenes.

## Shot inventory

| ID | Guide length | Asset / capture | Composition and motion | Required visible words |
| --- | --- | --- | --- | --- |
| S01 | 6 s | Editorial still: breakfast objects | Mug and leafy plant, natural side light, room for left-aligned type. Slow 2% push-in. No screens or brand logos invented inside the image. | `Some days, we lose our place.` |
| S02 | 4 s | Wordmark/title graphic | Thin line reveals the lowercase app name using the current visual palette. | `threadline` / `A little context, kept close.` |
| S03 | 5 s | Editorial routine detail | Hand beside mug; gentle cut implies an interruption. Do not depict disorientation theatrically. | `Fictional scenario · routine support concept` |
| S04 | 8 s | Genuine routine app capture | Show Resume a routine selected, fictional sample label, typed planned-step question, and button click. | Actual app labels and query. |
| S05 | 6 s | Genuine result and source click | Preserve actual local response. Click the note containing the plant plan, then crop to source plus response. | `Local demo · no data sent`; actual source link. |
| S06 | 7 s | Source hold with editorial annotation | Slow crop and one soft outline outside the app frame. No physical-completion tick. | `Your recorded plan, with its source.` |
| S07 | 5 s | Editorial evening desk / mode transition | Different setting signals a distinct fictional person and scenario. Match warm light and restrained styling. | `Fictional scenario · pre-period reflection` |
| S08 | 9 s | Genuine reflection app capture | Show the two synthetic retrospective notes from DEMO_SCRIPT.md, then type the question and run it. | `What helped me feel less rushed last time?` |
| S09 | 6 s | Genuine source click | Click the real note link; make the self-report readable. Do not draw a cycle trend graph. | The exact fictional note about leaving one evening free. |
| S10 | 11 s | Genuine note addition | Add the supplied fictional intention through the UI; show it appear in the timeline. | `Your words. Your interpretation.` |
| S11 | 8 s | End card | Short hold, no rapid logo montage. Fine line settles under name. | `Threadline` / `Prototype · source-linked memory` / `threadline.ayushojha.com` |
| S12 | 5 s | End-card availability hold | Same end card; small readable product-status line. | `Today: session notes + source-linked retrieval.` / `Next: live voice and wearable capture.` |

These durations total 80 seconds. Pair S04–S06 and S08–S10 into genuine app demonstration blocks; do not replace them with conceptual mockups.

## Separate asset package

Suggested organization; mark files produced only after they actually exist:

```text
assets/demo/
  narration/
    narration.txt                 # exact voice master; created
    [generated voice audio]       # separate ElevenLabs output
  visuals/
    [breakfast establishing still]
    [routine detail still]
    [evening desk still]
  captures/
    [routine app recording or still sequence]
    [reflection app recording or still sequence]
  motion/
    [editable title/source/end-card assets]
  audio/
    [optional quiet transition cue]
```

Do not invent filenames as evidence that assets were generated. Include an asset manifest with actual paths and generation/capture provenance in the eventual delivery. Any lifestyle image should be marked as a synthetic editorial image made with its named model in that manifest. App captures must remain genuine.

## Capture sequence

1. Open the verified local or public prototype at desktop width; use 100% browser zoom unless readability requires a clearly recorded alternative.
2. Keep Live processing settings closed, local mode active, and all real tokens absent from capture.
3. Record the routine scene exactly as specified in DEMO_SCRIPT.md. Capture enough pre-click and post-click time to edit without falsifying the interaction.
4. Prepare the fictional reflection notes through the UI, then capture the actual query, result, source link, and new note addition.
5. Capture the whole app first, then derive crops. Retain the uncropped recording as provenance. Never crop away a limiting status while implying the opposite behavior.
6. Store source footage separately from any image stills or motion overlay projects. No completed video export is requested.

## Visual and audio guardrails

- The camera in lifestyle assets is an editorial camera, not a connected product input. No detection bounding boxes or artificial wearable telemetry.
- The routine is deliberately low risk. Do not substitute medication, cooking on heat, leaving home unsupervised, or an emergency scenario.
- The second vignette concerns reported pre-period experience. No hormonal charts, clinical score, mood detection, implied cycle prediction, or diagnostic language.
- No calendar, purchase, caregiver call, sensor feed, or talking bracelet appears as implemented functionality.
- Generated voice reads the narration only. Use an authorized stock female voice, not a patient, family member, public figure, or teammate imitation.
- Keep all important source text visible long enough to read. Use captions and simple fades; avoid flashing or rapid motion.

## Optional concept asset

Only after the real app scenes are secured, a separate future-facing still can show an unbranded wrist-worn device alongside a phone. Label it `Concept · wearable capture not connected`. Do not use it to imply present BLE integration or narrate that speech has been captured automatically.
