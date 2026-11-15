# Camera + Vexo visual context

This is the implemented snapshot-based visual flow. It does not implement
remote video viewing, a Meta glasses bridge, or continuous video understanding.

1. Open Threadline in Chrome/Edge and connect the assigned Vexo band.
2. Turn on **Add camera vision**. Pick a webcam, or **GoPro Webcam** when the
   supported GoPro and its utility expose a camera to the browser.
3. Press **Connect camera**. The real preview must move with the camera scene.
   This step alone sends no images to Gemini.
4. Check recording/provider consent and the separate snapshot consent. Anyone
   visible or speaking must agree. The camera microphone is not substituted for
   Vexo audio.
5. Start the band recording and state the task. Ask a question aloud, or type it
   in **What's in front of you**. A completed spoken thought queues a visual
   check. **Check now** also works without the band recording if the camera is
   connected and consent is active.
6. Read the answer, next step, unresolved questions, and the timestamped images
   used as evidence. Moving the scene can trigger another check automatically.
7. Stop recording, disconnect the camera, change profiles, or revoke consent to
   stop visual checks and clear the evidence images from the page.

## What actually runs

The browser samples JPEGs every three seconds, at a maximum long edge of 640
pixels, keeping only the latest three snapshots in memory. A simple frame
difference check queues changed scenes; this is a scheduling heuristic, not
object recognition. Scene-triggered checks are limited to roughly one per
12 seconds. Questions and completed speech are debounced; only one visual
request runs at a time. These checks do not delay Deepgram's live transcript.

`POST /api/vision` requires the existing app authorization. It receives one to
three bounded JPEG/PNG images, up to twelve recent transcript lines, and a
question. Images and transcript text are sent through Gemini's Interactions API
with `store: false`, using the existing `GOOGLE_API_KEY` and `GEMINI_MODEL`.
Provider processing policies still apply. The app does not persist images on
the server or in browser storage.

The structured response includes observations with valid frame IDs, an answer,
one suggested next step, uncertainty, and supplied transcript source IDs. The
UI shows the corresponding images. It never labels a snapshot as continuous
video, identifies a person, verifies medication ingestion, infers hormones or
emotions, or claims an external task was performed. Visual descriptions can be
wrong: check the source images before acting.

## Short demo

Use harmless objects: a notebook, a charger and a bag. State what you are
planning to pack, show the objects, move one item, then ask “What can you see,
and what should I check next?” The useful result is a sourced observation plus
an honest unknown when the bag's contents or the packing action were not seen.
Do not demonstrate unsafe medical tasks or describe this as an emergency monitor.

## Verification

```powershell
uv run pytest tests/test_vision.py tests/test_vision_api.py -q
node --test tests/vision.test.mjs
```

Synthetic images were sent to the actual Gemini image API and returned grounded
frame IDs. Browser tests use an actual canvas video stream and JPEG encoding,
with a controlled scene; those checks are not proof of physical GoPro/Meta/Pi
compatibility. Test the exact camera and lighting used for the demonstration.
