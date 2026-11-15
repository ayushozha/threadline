# Four-mode pitch and footage plan

The reviewed concept film is `assets/demo/accessibility/threadline-four-modes.mp4`
(about 59 seconds, Jessica narration). It uses clearly labeled fictional examples,
synthetic stills, and illustrative UI cards. It is not evidence of live hardware,
clinical performance, obstacle safety or a delivered message.

## Pitch

Threadline adapts one assistant to the support a person chooses: Memory, Sight,
Hearing or Mobility. The shared context is captured conversation, current visual
evidence, personal preferences and available device readings. The output is a
small useful next step whose evidence can be checked, with a person deciding
whether to share a report or request help.

## Shot order

| Time | Scene | On-screen proof to capture for the final live demo |
|---|---|---|
| 0–10 | Ordinary tasks can create different barriers | A person losing their place, a package, a conversation and a request for help |
| 10–14 | Choose the support mode | Actual Dashboard mode switch |
| 14–23 | Memory | Saved location plus glasses in frame; show source timestamp, never imply guaranteed current location |
| 23–32 | Sight | Read a food-package label exactly from clear footage; leave unclear words unknown |
| 32–38 | Hearing | Real Deepgram partials becoming final captions; speaker number and visible corrections |
| 38–46 | Mobility | User requests help; open a real message draft, show review and cancellation |
| 46–55 | Shared context | Actual Dashboard, Memory graph and report preview, with source and synthetic labels visible |
| 55–59 | Close | “Different needs. One assistant that listens.” |

## Record these before claiming a live product demonstration

1. **Memory, 10 seconds:** place glasses on a table while saying where they are;
   later ask where they were left. Record the actual Gemini response and source.
2. **Sight, 8 seconds:** hold a high-contrast ordinary food package steady, then
   turn it so text is obscured. The model should read clear text and admit when
   it cannot read it. A printed direction is not medical advice.
3. **Hearing, 8 seconds:** two consenting speakers say a short exchange including
   “Your table is ready, Alex.” Record the real captions rather than substituting
   predetermined text. A name notification is only shown if implemented and tested.
4. **Mobility, 8 seconds:** request assistance from a chair, then show the generated
   draft and the confirmation boundary. A simulated fall must remain labeled;
   no person needs to perform a real fall for the demo.
5. **End-to-end proof, 5 seconds:** show the actual connected band 73, live packet
   count, fresh words and the Dashboard. Separately test real watch haptics.

The local images are placeholders for editorial footage, not patient recordings.
The generated package deliberately has a blank label. The concept film describes
bringing a printed label into view; it does not fabricate OCR results from a
blank image. The characters Meera, Ravi, Alex and Jordan are fictional and match
the mode-specific synthetic transcript datasets.

## Claims to keep out of this prototype pitch

- “One band can help all disabled people.” Support needs and hardware access vary.
- Sleep/steps predicting difficult evenings, or watch readings diagnosing a fall risk.
- A camera guaranteeing safe street crossing or left/right watch navigation.
- Reading a medicine label as a recommendation to take a dose.
- “Text sent” when only a message draft or system sharing UI opened.

No prevalence statistic is used in this version; the hook focuses on concrete
daily tasks. This avoids the unscoped “1 in 4 adults” claim.

## Reproduce media

Use the existing local model setup in `LOCAL_IMAGE_RUNTIME.md`; scenes are
`sight-kitchen-label`, `hearing-conversation`, `mobility-home-support` in
`tools/generate_local_h3_images.py`. Model files stay environment-configured.
Narration is generated with `tools/generate_dialogue_narration.py`; alignment uses
`tools/prepare_demo_audio.py`. `tools/render_accessibility_demo.mjs` renders the
film through local Chromium and ffmpeg. It requires a local static server:

```powershell
uv run python -m http.server 8019 --bind 127.0.0.1 --directory assets/demo/accessibility
# In another terminal:
node tools/render_accessibility_demo.mjs
```

Keep actual app capture and concept footage labeled separately when editing the
final submission. The generated script, voice, captions, stills and film are
provided now; consented real-world footage remains to be recorded.
