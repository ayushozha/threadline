# Hardware setup

How to wire up Threadline on one laptop: the Vexo band records, a GoPro is the camera, and an Apple Watch adds sensor readings. Researched and checked on 14 November 2026. Anything not confirmed by a source or by the code is marked **(unverified)**.

```
                       ┌───────────────────────────── laptop (Chrome or Edge) ─────────────────────────────┐
 Vexo band 73          │                                                                                    │
 (mic, motion, LED) ───┼─ Bluetooth (Web Bluetooth) or USB data cable (Web Serial) ──┐                      │
                       │                                                            ▼                      │
 GoPro HERO8–13 Black ─┼─ USB data cable ─► GoPro Webcam app ─► "GoPro" camera ─► Threadline page          │
                       │                                        (getUserMedia)     localhost:8000 or        │
                       │                                                           threadline.ayushojha.com │
                       └────────────────────────────────────────────────────────────┬───────────────────────┘
                                                                                    │ band audio → server → Deepgram
 Apple Watch ── Wi-Fi or via iPhone ── HTTPS/WSS ──► Threadline server ──► feed ────┘ (6-digit pairing code)
 (heart rate, steps, activity, optional mic)
```

What leaves the laptop: band audio (and watch audio, if switched on) goes through the Threadline server to Deepgram while capture is on. Camera video never leaves the browser: it is previewed and recorded locally only.

## 1. Vexo band (the recorder)

Source: the official [Vexo Open kit getting-started guide](https://github.com/VexoAI-Org/vexo-open-kit/blob/main/docs/getting-started.md) (local copy: `.artifacts/vexo-open-kit/docs/getting-started.md`).

1. **Close the Vexo dashboard** and any other program using the band. The band takes one Bluetooth connection at a time and cannot be found while connected to something else.
2. Open Threadline in **Chrome or Edge on a laptop**. Safari, Firefox, iPhone and iPad cannot connect.
3. In **Devices → Vexo band**, type `73` and press **Use this band**.
4. Pick one link:
   - **Bluetooth:** double-tap the band (the light blinks blue; it can be found for 60 seconds), press **Connect**, pick **Vexo-HACK-73**. The band flashes white when connected. On macOS, allow the browser to use Bluetooth if asked (System Settings → Privacy & Security → Bluetooth).
   - **USB cable:** plug in a cable that carries data (some only charge), press **Connect by USB cable**, pick **Vexo Open band** (`cu.usbmodem…` on a Mac, `COM…` on Windows; not "Bluetooth-Incoming-Port"). The first time, macOS may ask "Allow accessory to connect?": press Allow.
5. The card shows Link, Battery and Firmware. The library refuses a band whose number is not 73.

The band has a mic, motion sensor and LED; it has **no speaker and no haptics**. While the mic is streaming the LED is solid blue and refuses colour changes (kit docs).

## 2. GoPro (the camera)

Source: [GoPro Webcam Information And Troubleshooting](https://community.gopro.com/s/article/GoPro-Webcam) (GoPro support, updated 28 Aug 2026).

**Supported cameras:** HERO13, 12, 11, 10, 9 and 8 Black only. MAX, MAX 2 and other models are not listed for the webcam app.

1. Update the GoPro to the latest firmware (GoPro Quik or [gopro.com/update](https://gopro.com/en/us/update/)).
2. Install the **GoPro Webcam** app:
   - macOS 13 or newer: [Mac App Store](https://apps.apple.com/us/app/gopro-webcam/id6477835262). If an older GoPro Webcam is installed, run GoPro's uninstaller first.
   - macOS 10.14–12: the direct download on the support page.
   - Windows 10 or 11: the direct download on the support page.
3. Launch the app. A GoPro icon appears in the menu bar (Mac) or system tray (Windows). **Keep it running.**
4. Turn the GoPro on and connect it by **USB cable** (a data cable; USB 3.0 port recommended). **Wireless is not supported** for webcam use. The icon shows a blue dot when connected.
   - HERO9/HERO8 only: on the camera, set Preferences → Connections → USB Connection → **GoPro Connect** (not MTP).
5. Optional: menu icon → **Show Preview** (mirror/flip toggles), **Preferences** → 1080p (default) or 720p, **Digital Lens / Lens Mode** for field of view. The icon turns to a red dot while an app is using the camera.
6. **Restart Chrome/Edge after the GoPro is connected.** GoPro says an already-open app must be quit and reopened before the GoPro camera appears.
7. In Threadline's **Session** panel, tick **Add video**, then pick **GoPro** in the **Camera** list (Threadline selects a camera whose name contains "GoPro" automatically) and press **Connect camera** to see the preview. Only video is requested — audio comes from the Vexo band.

Notes from GoPro's FAQ: the GoPro **cannot record to its SD card while in webcam mode**; its own mic **cannot** be the webcam audio source (fine for us, the band records audio); a preview stuck on the GoPro logo can be a firewall or a USB 3.1 port/cable mismatch.

**Open GoPro, in one paragraph.** [Open GoPro](https://gopro.github.io/OpenGoPro/) is GoPro's free (MIT) API for HERO9 Black and newer (plus MAX 2 and others): BLE for control and wake, and an HTTP API over Wi-Fi or USB for settings, shutter, media download, metadata, a preview stream, and a webcam-mode stream. It is what you would use to start/stop GoPro recording or fetch footage from code. A browser page cannot use it directly in practice: it needs BLE pairing plus HTTP calls to the camera's own address, which in turn need a helper program (Python, Node, etc.) **(not tested here)**. For the demo, use the GoPro Webcam app: the GoPro then appears to Chrome/Edge as an ordinary camera.

**Marv Labs kits (GoPro, Raspberry Pi, head strap):** a Raspberry Pi is **not** needed when a laptop runs Threadline: plug the GoPro into the laptop. The Pi route would need its own capture program on the Pi, which Threadline does not include. The head strap is useful for a first-person view.

## 3. Apple Watch (sensors, backup mic)

A web page cannot talk to a watch over Bluetooth, so the watch runs its own app (`watch/ThreadlineWatch`, **in progress**; there is no `watch/README.md` yet) and sends readings to the Threadline **server**, which relays them to the page.

1. Build and install `watch/ThreadlineWatch` with Xcode (`watch/project.yml`, `watch/ThreadlineWatch.xcodeproj`).
2. On the page, press **Pair Apple Watch**. A 6-digit code appears. It expires after 10 minutes if unused; once attached, the watch may reconnect for 2 hours (`app/main.py`).
3. On the watch, open **Threadline**, check the server address (defaults to `https://threadline.ayushojha.com`), type the code, tap **Stream**.
4. Heart rate, steps and activity appear on the card. Turn on watch audio only if the band is not recording.

The page and the watch must use the **same server**: pair from the deployed site when the watch points at the deployed URL.

## 4. Start a session (click order)

1. Open the page. Turn on **Live providers**, enter the **App access token** (deployed site), tick the permission box, press **Check provider status**.
2. **Devices:** connect the Vexo band (step 1). Optionally **Pair Apple Watch** (step 3).
3. **Capture → Record from:** choose **The Vexo band above**.
4. Tick **Also record video from my camera** (GoPro chosen as the site's camera, step 2).
5. Tick the consent box ("everyone who can be heard has agreed").
6. Press **Start live capture** (or double-tap the band). **Clap once, visibly and loudly** in front of the GoPro (see Sync).
7. Tap the band once to mark a moment. Press **Stop** when done.
8. **Review before saving:** pick which speaker is you, correct the text, **Save my statements**. **Download video** if you want the local recording.

## 5. Before the demo checklist

- [ ] Everyone who can be heard has agreed to be recorded.
- [ ] Vexo dashboard, Python scripts and teammates' tabs disconnected from band 73.
- [ ] Band charged (Battery on the card); GoPro charged or powered over USB.
- [ ] USB cables **carry data**, not charge-only (both band and GoPro).
- [ ] Chrome or Edge, not Safari/Firefox. Bluetooth on.
- [ ] GoPro Webcam app running, blue dot showing, browser restarted after plugging in.
- [ ] Site camera permission set to the GoPro, not the built-in FaceTime/HD camera.
- [ ] Deployed site: access token at hand. Watch pointed at the same URL.
- [ ] Do one 20-second test capture with a clap and play it back.

## Local vs deployed

| | Local (`http://localhost:8000`) | Deployed (`https://threadline.ayushojha.com`) |
|---|---|---|
| Secure context (needed for Web Bluetooth, Web Serial, camera) | Yes: browsers treat `localhost` as secure ([MDN: Secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts)) | Yes: HTTPS |
| Access token | Loopback requests can be trusted without a token (`APP_TRUST_LOOPBACK`, `trusted_local` in `app/main.py`); otherwise use `APP_ACCESS_TOKEN` from `.env` | Required (`APP_ACCESS_TOKEN` on the server) |
| Apple Watch | Server listens on `127.0.0.1`, so the watch cannot reach it. Using the Mac's LAN IP needs `--host 0.0.0.0` and plain `http://`, which watchOS App Transport Security will likely block **(unverified)** | Works: point the watch at the deployed URL |
| Opening the page from a LAN IP (`http://192.168…`) | Not a secure context: Bluetooth, Serial and camera are blocked | n/a |

Recommendation: run the demo from the deployed site if the watch is part of it; local is fine for band + GoPro only.

## Sync

Band audio arrives over Bluetooth (or USB) and video over USB through the GoPro app; each path has its own delay, and the GoPro adds encoding latency. Threadline timestamps both on the laptop, but those are arrival times, not capture times. **Clap once at the start** where the GoPro can see it: compare the clap in the video with the loudness spike / transcript start to read the offset. The actual offset has **not been measured**.

## Troubleshooting

| What you see | What to do |
|---|---|
| Band not in the list | Something else is connected (dashboard, script, teammate). Close it, double-tap the band (60-second window), keep it close. Use Chrome/Edge; allow Bluetooth for the browser on macOS. |
| "Connected" but nothing moves ("Arriving: 0"), no audio packets, or "stream-taken" | A second program is on the band's other link (one Bluetooth, one USB). Close the Vexo dashboard/other program, then press **Take it back**. |
| "No band found on USB" | Try another (data) cable and port; on a Mac allow the accessory (System Settings → Privacy & Security → "Allow accessories to connect"). |
| GoPro not listed as a camera | GoPro Webcam app not running; cable is charge-only; camera off or asleep; HERO8/9 set to MTP instead of GoPro Connect; browser opened before the GoPro was connected (restart it); unsupported model. GoPro's fix: close the app, unplug, power-cycle the camera, reconnect (another port), open the Webcam app, reopen the browser. |
| GoPro preview stuck on the GoPro logo | Firewall, or USB 2.0/3.0 cable in a USB 3.1 port (GoPro FAQ). |
| Page shows the laptop's built-in camera | Pick the GoPro in the Session panel's **Camera** list and press **Connect camera**. If it isn't listed, restart the browser with the GoPro already connected. |
| Watch says the code is wrong | Codes expire after 10 minutes unused; make a new one. Check the watch and page use the same server. |
| Band LED will not change colour | Normal while the mic is streaming (kit docs). |

## How to make it better (ideas, not implemented)

1. **Visual context for Gemini:** with separate, explicit consent, send about one GoPro frame per second alongside the band transcript so answers can mention what was in view. Today video never leaves the browser.
2. **Automatic clap-sync:** detect the clap in both the band audio loudness and the video audio/frames and shift the timelines by the measured offset.
3. **First-person view:** mount the GoPro on the Marv Labs head strap so the video matches what the wearer sees.
4. **Per-device timelines:** show band audio, watch heart rate/steps and video as parallel lanes on one time axis.
5. **Band tap bookmarks the video:** a single band tap (already a "mark") also adds a chapter marker to the local video recording.

## Honest limits

- Camera capture is implemented but **not yet verified with a camera**, and not tested with a GoPro specifically.
- Vexo band audio was verified with the kit's recorded audio on a simulated band; the physical band 73 still needs a check.
- The watch app is in progress; there is no watch setup README yet.
- The camera picker shows names only after camera permission is granted once; before that, entries appear as "Camera 1".
- Video is not uploaded, so the AI features (transcript, graph, answers) do not use it.
- Audio/video offset is not measured or corrected.
- Open GoPro control, the Raspberry Pi route and the LAN-IP watch route were not tested.
