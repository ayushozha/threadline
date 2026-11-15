# Dementia-support demonstration

Open `/demo/` for the narrated film, synthetic kitchen images and a button that
submits the displayed evidence to the real Gemini vision endpoint. The film
uses a recorded provider response, not a live request. The interactive button
requires consent and produces a fresh response; provider failures remain errors.
The generated scenes are illustrations, not recorded patient footage.

In the main app, choose **Load fictional dementia demo**. Seven conversations
contain 36 dialogue lines and 23 saved statements: Meera's preferences, last
mentioned glasses location, a tea/plant plan, and a phone interruption. Allow
fictional-demo processing and ask the suggested question to obtain an actual
Gemini answer with source links. Exit restores the real band workspace.
No action log, health measurement or task completion is prefilled.

The intended proof is narrow: saved conversation plus visible objects can support
a next-step suggestion. Neither volume of text nor a generated demonstration
establishes clinical effectiveness. The app cannot establish that a task was
completed, infer a diagnosis, or confirm medication from these inputs. Caregiver
sharing remains an explicit user action.

Images use the configured local MiniMax H3 Image model. The 55-second film uses
the configured ElevenLabs Jessica voice, captions and animated stills; it is not
generative live-action footage. Source prompts, scripts and provider-response
receipts accompany the assets. See `tools/render_dementia_demo.mjs` for the
reproducible render and `tools/generate_local_h3_images.py` for image generation.

## Live transcription changes

Incoming partial words are rendered immediately in both **Your band** and
**Care**. Final lines paint before deferred archive/chart work. Empty provider
events do not clear a pending phrase. Waveform DOM updates are coalesced to one
animation frame. The configured band number is preferred over stale recently
used devices; explicit URL band selection remains available.

The recording owner's WebSocket no longer waits for public viewers. Viewer
delivery has a bounded queue and slow-viewer timeout; final transcript storage
is preserved even if viewer updates overflow. These changes remove application
delays, but Bluetooth audio quality, network delay and provider recognition
latency still need verification with the physical band.
