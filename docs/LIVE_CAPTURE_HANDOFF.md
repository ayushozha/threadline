# Live video + Vexo: implementation and setup handoff

This is the requested implementation contract for Claude or another contributor.
Build on the existing Threadline app; do not replace it with a separate demo.
Work directly on `main`, with scoped commits and no PRs. Preserve hooks and remote
protections. Keep model selection in environment variables and credentials server-side.

## Outcome

On `https://threadline.ayushojha.com`, the wearer connects their own audio source
and camera, sees genuine live video beside the Vexo transcript, and starts one
synchronized session. With separate permission, an invited viewer can watch that
session from another device. The same session supplies selected visual evidence
and speech to Gemini. Users can bring a supported GoPro, webcam, phone camera,
Meta glasses through a companion app, or a camera connected to a Raspberry Pi.

These are three separate capabilities. Implement and verify each:

1. **Local preview:** the hosted page displays the camera attached to the device
   opening that page. The VPS does not need its own physical camera.
2. **Remote live viewing:** media is actually published over the network and an
   authorized second device receives it. A local `<video>` preview is not proof.
3. **AI analysis:** explicitly permitted frames/clips and speech reach the model.
   Showing video in the UI does not mean Gemini is seeing it.

## Current baseline and unfinished work

Checked against repository commit `4aee4f7` on November 14, 2026. Recheck current
source before editing because teammates may have advanced `main`.

| Surface | Current source | Required next step |
| --- | --- | --- |
| Vexo connection | Official kit vendored unchanged; BLE and USB pairing, live audio and signals are implemented | Verify with physical band 73, not just the kit simulator |
| Speech | `/api/live-transcribe` relays audio to Deepgram; current browser sends raw Opus packets for Vexo | Keep this working; add session/timing association without breaking its protocol |
| Camera | Optional camera selector, connection preview and browser-local recording | Verify selection on real hardware; add session timing and live publication |
| Video with Vexo | Existing video recording does not include Vexo audio: `getUserMedia` requests `audio: false` in Vexo mode | Publish or deliberately combine the selected Vexo audio and camera tracks |
| Remote viewer | Not implemented | Authenticated publication/subscription and a viewer page |
| Gemini | Existing text/reflection/graph adapters | Add bounded visual input, timestamped source evidence and current task state |
| Meta / Pi bridges | Not implemented | Real source adapters and actual device checks |
| Spoken response | Jessica narration assets exist; in-app TTS is not connected | Stream/play configured ElevenLabs speech through the host or headphones |

Relevant existing files: `app/static/app.js`, `app/static/index.html`,
`app/main.py`, `app/static/vendor/vexo-open/js/src/index.js`, and
`app/static/vendor/vexo-open/UPSTREAM_COMMIT`. The vendored kit revision is
`1e4291e2fa4896b1f603d3d4f0b009c483425da0`. Leave vendor code unchanged.
The current server already allows same-origin camera access through its
Permissions Policy. The app currently has no remote video or Meta SDK integration.
Use [Hardware setup](HARDWARE_SETUP.md) for the current page's actual button order;
the additional controls below describe the target implementation.

## Connection layout

```text
Vexo 73 -- BLE or USB --> capture laptop browser -- audio --> Deepgram relay
                                     |
GoPro -- USB data cable/driver ------>| camera video
Webcam -- USB ---------------------->| camera video
                                     |
                                session timeline
                                     |
                         private WebRTC room --> invited web viewer
                                     |
                         selected evidence --> Gemini --> action proposal
                                                           |
                                          approval --> tool --> result check
                                                           |
                                            ElevenLabs --> host/headphones

Meta glasses --> iOS/Android companion --> same private room/session
Phone camera --> HTTPS mobile capture page --> same private room/session
Pi + supported camera --> local capture bridge --> same private room/session
```

Use one selected primary audio source and one selected camera for the first
working version. Additional devices join the same session as separately named
sources; never silently replace Vexo audio with a GoPro, phone or laptop microphone.
The Vexo kit exposes a microphone, motion and LED controls, not a camera, speaker
or haptic motor. Audio responses play on the host device or selected headphones.

## User setup and device compatibility

Add a Devices area containing **Audio source**, **Video source**, **Test camera**,
**Start session**, **Stop**, and **Invite viewer**. These labels describe required
UI, not controls all present in the current build.

Show source-specific setup instructions before connection. Distinguish
`Not connected`, `Permission needed`, `Connected`, `Receiving media`,
`Reconnecting`, `Unsupported`, and `Stopped`. Display the actual selected device
name and last-received time. A saved device choice or configured API key does not
establish a live connection. Never display simulated success or invented data.

### Vexo bracelet

1. Open the website in Chrome or Edge on the capture laptop, with Bluetooth on.
   Start with `https://threadline.ayushojha.com/?band=73` for this team's band.
2. Close any other app or dashboard using the same band link. The band permits
   only one BLE connection at a time.
3. Enter the number printed on the user's own bag; 73 is ours, not a default for
   everybody. The band number selects a device; it is not authentication.
4. Double-tap the band so it advertises, press Connect, and choose only
   `Vexo-HACK-73` for this kit. The official library checks its identity.
5. Alternatively, use a data-capable USB cable and the existing USB connection
   control; choose the Vexo port, not another serial device.
6. Start capture only after consent. Confirm packet count and live speech change
   when the wearer speaks. Preserve the existing reconnect and stop behavior.

iPhone/iPad Safari cannot perform this Web Bluetooth connection. An iPhone can
still contribute a camera to a session while the laptop owns the Vexo link.
Do not ask the user to pair a web-connected band in Windows Bluetooth settings.
See the [official Vexo kit](https://github.com/VexoAI-Org/vexo-open-kit).

### GoPro on the capture laptop: first demo path

1. Identify the exact GoPro model and firmware. The official webcam guide lists
   HERO8/9/10/11/12/13 Black; do not promise all GoPros work identically.
2. Install the official GoPro Webcam utility on a supported Mac or Windows host.
   Turn the camera on and connect it with a USB data cable.
3. Confirm the live preview in that utility, then select **GoPro Webcam** in
   Threadline's video selector. Request video only when Vexo is the audio source.
4. Show video and Vexo speech in the same session. If the OS does not expose the
   camera, report that problem and offer another available camera explicitly.
5. Leave the camera on the capture laptop. Deploying the website does not move
   the camera to the VPS or let the VPS reach the laptop's USB ports.

See [GoPro Webcam setup](https://community.gopro.com/s/article/GoPro-Webcam?language=en_US).
For a supported device without the desktop webcam path, use the
[Open GoPro SDK](https://gopro.github.io/OpenGoPro/python_sdk/quickstart.html)
in a local bridge. Its USB/Wi-Fi preview transport is model-dependent. Do not
assume that plugging a GoPro into Linux creates `/dev/video0`.

### Standard webcam and phone camera

- For a webcam, connect USB, enumerate browser `videoinput` devices after camera
  permission, select by device ID and confirm the preview. Refresh the list on
  `devicechange`; if a saved camera disappeared, ask before using another one.
- For a phone, the owner creates a short-lived camera pairing invitation on the
  website. Open it on the phone over HTTPS, approve the source on the owner page,
  select the rear camera and publish video to that same private session.
- A phone's `localhost` is the phone, not the laptop. Use the deployed HTTPS site.
- Pairing adds a source; it does not authorize viewing other sessions. Keep the
  phone page active for the demo; do not promise background capture on mobile.
- The phone microphone remains off when Vexo is selected. Offer microphone
  fallback only as an explicit source change, with its own consent and label.

Browser APIs: [getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia),
[enumerateDevices](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/enumerateDevices),
[Web Bluetooth](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API).

### Meta glasses: native companion path

Do not implement a fake browser Bluetooth camera connector for Meta glasses.
The verified integration route is Meta's **Wearables Device Access Toolkit** in
an iOS or Android companion app. Meta's glasses Web Apps are a different surface
and do not establish raw camera streaming into this website.

1. Check the exact glasses model, region, phone and firmware against current Meta
   requirements. Capability availability varies by model.
2. Pair the glasses with the Meta AI mobile app. Complete the required developer
   setup/registration and camera permission flow using the current official SDK.
3. Start from Meta's official camera-streaming sample in the native companion.
   Demonstrate genuine live frames on the phone before adding network forwarding.
4. Enter or scan the short-lived source-pairing invitation generated by Threadline.
   The owner approves this companion as the session's camera publisher.
5. Publish those frames through the same WebRTC session used by the website.
   Keep the selected Vexo audio coming from its existing host. When sources are
   on different hosts, apply the synchronization rules below.
6. Display real permission, stream and disconnect states. Until this is built
   and checked on the actual glasses, label the source **Setup required** or
   **Not implemented**, not **Connected**.

Use the [Meta toolkit](https://developers.meta.com/wearables/device-access-toolkit/),
[current FAQ](https://developers.meta.com/wearables/faq/), and official
[iOS](https://github.com/meta/meta-wearables-dat-ios) or
[Android](https://github.com/meta/meta-wearables-dat-android) samples. Do not invent
SDK method names or assume an older Ray-Ban product has the same capabilities.

### Raspberry Pi and SD card

The Pi is an optional capture host, replacing the laptop's device-collection job.
It does not need to run Gemini or the local MiniMax models.

1. Identify the Pi board model, correct power supply and camera model first.
2. Inspect the supplied microSD: preserve sponsor-provided software if present.
   Only image a blank/approved card with Raspberry Pi Imager. Flashing erases it.
3. Configure Raspberry Pi OS, Wi-Fi, a unique login, hostname and SSH in Imager.
   Put the card in the unpowered Pi, then connect the model-appropriate supply.
4. Verify the Pi's network access and a real camera preview. Use a supported USB
   webcam/Pi Camera, or Open GoPro's verified model-specific USB/Wi-Fi route.
5. For Vexo on the Pi, use the official Python kit over BLE or USB. Disconnect
   the laptop's competing band link before moving ownership to the Pi.
6. The local Pi bridge pushes its selected sources outward to the authorized
   room/session. The public VPS must not fetch arbitrary private camera URLs.

The Pi's microSD stores its operating system. A separate GoPro microSD stores
recordings. Neither is the live streaming connection. No GPIO wiring or soldering
is needed for these USB/BLE paths. See [Raspberry Pi setup](https://www.raspberrypi.com/documentation/computers/getting-started.html).

## Streaming and backend instructions

Use the existing FastAPI backend, plain JavaScript frontend, Vexo kit and
Deepgram relay. Do not add React, a second app backend, or a custom video codec.
For actual remote viewers and native publishers, use a maintained WebRTC room
SDK. The proposed path is LiveKit Cloud plus its browser/server/native SDKs;
it handles media and network traversal without changing shared VPS networking.
This is a proposed dependency, not installed or configured in this repository.
Pin and check the necessary packages when implementing it; do not add a full
agent framework just to send camera frames.

- Keep `/api/live-transcribe` for speech. Its current post-handshake text frames
  end capture: do not interleave JSON timing messages into that socket without
  explicitly changing and testing both ends. Use a separate session control path.
- Add authenticated session creation and room-token issuance. Bind permissions
  server-side to the session and role: owner, approved source publisher, invited
  subscriber, or AI processor. Never trust a browser-submitted room or role alone.
- Use opaque session/participant IDs. Do not place names, health context, app
  access tokens or provider keys in QR URLs, room names or logs.
- Make source-pairing invitations short-lived, single-use and rate-limited, and
  require owner approval. A source invitation must not grant viewer access.
- Issue short-lived viewer tokens restricted to one room and subscription only.
  Shared app access currently serves a controlled prototype; it is not a
  multi-user ownership system. Keep viewing owner-only until session-specific
  authorization is implemented and tested.
- Publish the selected camera track. To let a remote viewer hear Vexo, decode
  its Opus using the official `BandAudio`, feed a bounded PCM playback/capture
  pipeline (for example AudioWorklet into MediaStreamAudioDestinationNode), and
  publish that generated audio track without monitoring it on local speakers.
  Sending Opus bytes to Deepgram alone does not give viewers an audio track.
- Keep the primary audio selector explicit. Disable camera/phone/Meta microphone
  publication when Vexo owns audio. Suppress speaker feedback during TTS using
  headphones or deliberate turn-taking; do not transcribe the assistant as the user.
- Add **Start sharing** separately from local preview and AI processing. Show
  the current viewers and let the owner end sharing and remove access.
- Configure same-origin HTTPS/WSS and the exact media-provider origins needed by
  CSP. Do not disable CSP or add wildcard camera/network permissions. Never send
  an `http://192.168...` camera URL from an HTTPS page to the cloud backend.
- Camera loss must show **Video unavailable** while audio may continue if chosen.
  Stop visual decisions on stale frames. No silent fallbacks or endless queues.

See [LiveKit rooms and connections](https://docs.livekit.io/intro/basics/connect/),
[media publishing](https://docs.livekit.io/transport/media/publish/), and
[tokens and grants](https://docs.livekit.io/frontends/reference/tokens-grants/).

## Timing, multimodal reasoning and outputs

- Create one session origin and identify every audio source, camera and reconnect
  generation. Preserve the audio sequence, the Vexo packet `time`, host receive
  time, video media timestamp, frame ID and last-received time.
- Vexo audio time is arrival-anchored and advances by 20 ms per sequence step;
  it is not exact microphone capture time. Keep the packet metadata before decoding.
- With one host, map source timestamps onto that host's monotonic clock. Across
  phone/Pi/laptop hosts, estimate clock offset with timestamp exchanges and retain
  uncertainty. Browser clocks from different devices are not interchangeable.
- Clap once visibly at session start to check A/V offset. Preserve gaps and new
  origins on reconnect. WebRTC transport sync cannot undo unknown capture delay.
- Render ordinary live video at a usable frame rate; sample fewer frames for AI.
  Begin with one AI frame/second for slow object/task context, a bounded recent
  buffer and no overlapping inference backlog. Use denser short clips for motion;
  one frame/second is not sufficient for safety-event or fast-action detection.
- After explicit AI consent, submit selected frames/clips plus the overlapping
  transcript and source timestamps to the configured Gemini capability. Review
  the current Decisions/video API rather than inventing an endpoint. Never send
  a full day of footage just because it is available.
- Keep observation separate from hypothesis: “mug visible at 00:12” is different
  from “drank tea.” Require adequate visible evidence before marking an action
  complete; otherwise use **not observed** or ask the wearer.
- Join spoken intention, observed steps and remembered user preferences. Produce
  one next-step suggestion, allow correction, then verify any completed tool
  action. Keep purchases, messages and calendar edits behind explicit approval.
- Dementia/task demo: a consenting teammate states a real simple goal, completes
  part of it on camera, asks where they stopped, and receives the observed next
  step with a timestamp. No medication administration or diagnosis claims.
- PMS/personal-support demo: the wearer states their energy and chosen support;
  use actual activity context and their own history to offer practical assistance.
  Do not infer PMS, hormones, capacity or emotion from appearance or voice alone.
- Play replies through the configured ElevenLabs voice (Jessica is the user's
  preference). Resolve its voice ID from configuration, not a guessed constant.
  Do not claim the existing narration files are live assistant replies.

Gemini reference: [video understanding](https://ai.google.dev/gemini-api/docs/video-understanding).

## Configuration contract

Reuse existing values; do not overwrite `.env`, log keys or expose them in builds.

| Variable | Status / responsibility |
| --- | --- |
| `APP_ACCESS_TOKEN` | Existing protected prototype requests; not a per-user identity |
| `APP_TRUST_LOOPBACK` | Existing local-development option; keep disabled on the VPS |
| `VEXO_BAND_NUMBER` | Existing deployment hint; 73 only for our assigned hardware |
| `GOOGLE_API_KEY`, `GEMINI_MODEL` | Existing Gemini configuration; verify visual API access |
| `DEEPGRAM_API_KEY`, `DEEPGRAM_MODEL`, `DEEPGRAM_DIARIZE_MODEL` | Existing speech configuration |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL` | Existing asset configuration; live playback still to implement |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Proposed room transport configuration; add only with its implementation |

Server mints room tokens. Only scoped, expiring participant tokens and the public
room endpoint go to clients. Native Meta app registration belongs in its companion
build configuration; it does not require sharing the user's Meta account password.
Keep all model identifiers env-driven. Local MiniMax generation produces assets;
it does not establish camera connectivity or replace a live video transport.

## Build order and acceptance

1. Pull current `main` and preserve teammates' changes. Confirm physical Vexo audio
   with the existing page before editing. Reuse the existing pairing and relay.
2. Reuse the camera enumeration/selection already present and add a single
   session timeline. Verify real GoPro/webcam preview and Vexo transcript
   together on the hosted origin.
3. Add private WebRTC publication and a viewer page. Open the viewer on a second
   device, preferably on a different network, to prove real network delivery.
4. Add bounded Gemini visual analysis with source IDs and corrected task state.
   Verify that changing the physical scene changes the observed answer.
5. Add phone camera publishing. Then implement and physically verify Meta/Pi
   bridges as available; keep unavailable integrations honestly labeled.
6. Run existing tests and focused new tests for session authorization, expiry,
   source association, stale video and stop behavior. Commit only task files to
   `main`, deploy with the project helper and verify the actual hosted revision.

Required evidence before claiming the setup works:

- [ ] Physical band 73 and the chosen camera deliver data simultaneously.
- [ ] The page identifies the real video device and primary audio source.
- [ ] A clap check documents offset; reconnects do not reuse stale timestamps.
- [ ] An authorized second device receives actual video, and Vexo audio if enabled.
- [ ] An unrelated viewer/token cannot join; one session cannot read another.
- [ ] Swapping cameras changes the feed without changing audio ownership.
- [ ] Video loss visibly suspends visual inference instead of replaying stale input.
- [ ] Gemini receives only the consented evidence and cites actual frame/utterance IDs.
- [ ] Stop disables capture, publication and new provider requests, closes tracks
      and bounded buffers, and ends viewer access. In-flight provider processing
      cannot be represented as retroactively erased.
- [ ] Remote sharing, local recording and AI processing have separate clear consent.
- [ ] No new raw recordings are persisted without a retention choice. Existing
      browser-local transcripts are disclosed and deletable. Band number is not
      used as a privacy boundary on a shared browser or as viewer authorization.
- [ ] Meta/Pi support is reported as verified only after a physical-device run.

Until these checks pass, describe this document as the implementation plan, not
proof that remote streaming or all device integrations are ready.
