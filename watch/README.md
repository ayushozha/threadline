# Threadline Watch

A small standalone watchOS app. Its main job is to be a **sensor**: while you stream, it sends live readings (heart rate, active energy, steps, activity, and whether the screen is awake) to the Threadline server about once a second. The server passes them to the web page you paired with. Recording audio is optional (the **Record audio too** toggle). The Vexo band is still the main recorder, and the page can show both in one session.

The readings are just readings. Threadline does not interpret heart rate or anything else as stress, mood, health state.

## How it fits together

```
Apple Watch app ──(code)──> Threadline server ──> paired web page(s)   sensors, transcript
                                   └──> Deepgram                       only if audio is on
```

- A web page cannot connect to an Apple Watch. The watch runs this app and talks to the Threadline server. The page subscribes to the server.
- The 6-digit pairing code (plus, for codes the watch started, a random watch key) is the only credential on the watch. No API keys or access tokens go on the watch. Deepgram's key stays on the server.
- The watch stores no audio and no readings. HealthKit runs a workout session only to read live heart rate, and the app discards that workout when you stop, so nothing is saved to Health. The server stores nothing either: it forwards readings as they arrive, and the pairing registry lives in memory only.

## Pair (from the watch)

1. Open Threadline on the watch. It asks the server (default `https://threadline.ayushojha.com`, change it under **Server**) for a code and shows it large: **Enter 482 913 at threadline.ayushojha.com**.
2. On the Threadline website, enter that code. The watch checks every 2 seconds; when the code is claimed it taps your wrist, shows **Paired ✓** and starts streaming sensors on its own. The first time, watchOS asks for Health access (heart rate and active energy, plus workout write access, which a workout session needs), Motion access, and Microphone access if audio is on.
3. An unclaimed code expires after 10 minutes and the watch fetches a new one by itself. A claimed code works for reconnects for 2 hours. The code and its watch key are kept in memory only, so relaunching the app shows a new code.
4. The streaming screen lists exactly what is being shared and with which host.

Under the hood (device-code pattern): `POST /api/watch/start` `{"device"}` (no token; 30 per 10 min per IP) returns `{"code","watch_key","expires_in":600}`; the watch polls `GET /api/watch/status` with `X-Watch-Code` + `X-Watch-Key`; the website calls `POST /api/watch/claim` `{"code"}` (signed in) and then opens the usual `WS /api/watch/feed`. For watch-started codes every watch endpoint also needs the key (`X-Watch-Key` header, or `"watch_key"` in the stream socket's first message) and answers 403 until the code is claimed.

**Fallback:** tap **Enter a code from the website instead** to use the older flow, where the website creates the code (`POST /api/watch/pair`) and you type it on the watch.

## Install on your own Apple Watch

You need a Mac with Xcode, the iPhone your Apple Watch is paired with, and an Apple Account (a free one works).

1. **Turn on Developer Mode on the watch.** Connect the iPhone to the Mac once so Xcode sees the watch, then on the watch open **Settings > Privacy & Security > Developer Mode**, turn it on, tap **Restart**, and after the restart tap **Turn On** (and **Trust** with your passcode if asked). Apple: [Enabling Developer Mode on a device](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device).
2. **Sign in and pick your team.** In Xcode, **Settings > Apple Accounts**, add your Apple Account. Open `watch/ThreadlineWatch.xcodeproj`, select the **ThreadlineWatch** target, **Signing & Capabilities**, keep **Automatically manage signing**, and choose your team (with a free account it is "Your Name (Personal Team)"). If `com.threadline.watch` is already taken, change the bundle id to something unique like `com.yourname.threadline.watch`. Keep the **HealthKit** capability.
3. **Run it.** With the iPhone unlocked, nearby and on the same network as the Mac, choose your Apple Watch as the run destination and press **Run** (⌘R). The first install over the iPhone can take several minutes. Apple: [Running your app on simulated or physical devices](https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices).
4. **Trust prompts.** If the watch or Xcode asks you to trust the Mac or the developer, accept it on the device (the Developer Mode page above covers the **Trust** dialog).
5. Open Threadline on the watch, then pair as described above.

**Free personal team limits** (Apple: [Developer account overview](https://developer.apple.com/help/account/basics/about-your-developer-account/)): provisioning profiles for apps installed on a device expire 7 days after issue, so after a week you rebuild and reinstall from Xcode. A personal team can also register at most 3 devices and 10 App IDs (each expiring after 7 days) and install at most 3 apps per device.

## Haptics

- **Haptics:** the paired page can send `{"type":"haptic","kind":"notification"|"success"|"directionUp"|"click","reason":"…"}` on its feed socket (at most one every 3 seconds per code). The watch plays the haptic and shows the reason for a few seconds.

## More Apple Health values and State of Mind

- **Slow-changing values:** about once a minute while streaming, the watch reads the latest real Health sample (last 7 days) for each of these and adds it to every sensors frame until the next refresh. A value with no sample is left out; nothing is estimated. `hrv_sdnn_ms` (5–300), `resting_hr` (25–200), `respiratory_rate` (4–60), `spo2` (70–100, percent), `wrist_temp_delta_c` (-5–5, sleeping wrist temperature change from baseline), `env_noise_db` (20–140), plus `exercise_min_today` and `mindful_min_today` (0–1440, summed since midnight) and `sleep_hours_last_night` (0–24, asleep stages since 6 pm yesterday, overlaps merged). The server drops unknown or out-of-range values and stores nothing.
- **State of Mind (watchOS 11+):** the latest one you logged today is sent as `state_of_mind: {"valence": -1…1, "labels": [≤3 HKStateOfMind.Label names like "calm"], "at": ISO}`.
- **Mood logging (opt-in per request):** the paired page can send `{"type":"log_mood","valence":-1…1,"labels":[≤3 label names],"reason":"≤80 chars"}` on its feed. The server validates it (bad input gets `{"type":"error",…}`), answers `{"type":"log_mood_sent"}` and delivers it like a haptic: a WebSocket text frame, or in the next `POST /api/watch/sensors` response under `"commands"` (up to 3 queued). The watch asks **Save this mood to Apple Health?** Only on **Save** does it write an `HKStateOfMind` (`.momentaryEmotion`). It answers `{"type":"mood_logged"}`, `{"type":"mood_declined"}` or `{"type":"mood_failed"}` (socket frame, or `POST /api/watch/mood`), and feeds receive it with `"device"` added.

## Run in the watchOS Simulator

You need Xcode with a watchOS simulator runtime. XcodeGen is optional: the generated `ThreadlineWatch.xcodeproj` is checked in. If you edit `project.yml`, run `xcodegen generate` in this folder.

```bash
cd watch
xcodebuild -project ThreadlineWatch.xcodeproj -scheme ThreadlineWatch \
  -destination 'generic/platform=watchOS Simulator' build
```

Alternatively, open `ThreadlineWatch.xcodeproj`, pick a watch simulator and press Run.

To test against a server on your Mac, run it with `uv run uvicorn app.main:app --host 0.0.0.0 --port 8000` and set the watch's server to `http://127.0.0.1:8000`. The simulator shares the Mac's network. A workout session in the simulator produces simulated heart rate. Steps and activity stay at "–" in the simulator because it has no motion hardware.

## Real watch network notes

Use `https://threadline.ayushojha.com` or another HTTPS server. On a real watch, a LAN `http://192.168.x.x:8000` address works only when the watch and the Mac are on the same Wi-Fi network.

## Honest limits

- **WebSockets on a real watch:** watchOS blocks `URLSessionWebSocketTask` for ordinary apps (Apple TN3135). The app first tries `wss://…/api/watch/stream`. If that socket is not ready within 6 seconds, it switches to plain HTTPS: sensor frames go to `POST /api/watch/sensors` and audio goes as about 0.5-second chunks to `POST /api/watch/audio`. Both transports work in the simulator. The HTTPS fallback has been tested only in the simulator, not on a physical watch.
- **Wrist down:** the workout session keeps the app running in the background (`workout-processing`), so sensor streaming should continue when you lower your wrist. This has not been tested on a real device. `wrist_raised` is an approximation: it means the screen is not dimmed (`isLuminanceReduced`).
- **Steps** count from the moment you start streaming. They are not your daily total.
- The server keeps pairings in memory, so it must run as a single process, which matches the current Dockerfile. A restart clears all codes.
- Debug builds allow plain `http` (ATS exceptions) so you can develop on a LAN. Remove `NSAllowsArbitraryLoads` before you distribute the app.

## Wire protocol (for reference)

Watch → `WS /api/watch/stream`. The first text frame is `{"code","device","format":"sensors"|"pcm16"}` (plus `"watch_key"` for watch-started codes), and the server replies `{"type":"ready","source":…}`. In `sensors` mode, the watch sends text frames like `{"type":"sensors","t","heart_rate","steps","active_kcal","activity","wrist_raised"}`. In `pcm16` mode, the watch sends binary frames of 16 kHz mono little-endian Int16 PCM (100 ms each), and can interleave sensor text frames on the same socket. Sending `{"type":"stop"}` ends the session.

HTTPS fallback: `POST /api/watch/sensors` (JSON body), `POST /api/watch/audio` (raw PCM body) and `POST /api/watch/audio/stop`, each with an `X-Watch-Code` header (plus `X-Watch-Key` for watch-started codes) and an optional `X-Watch-Device` header. The audio responses carry `{"messages":[…]}`, with the transcript results produced since the previous post. Haptics reach the watch as a `{"type":"haptic","kind","reason"}` text frame, or in the next `POST /api/watch/sensors` response as `{"forwarded":…,"haptics":[…]}` (up to 3 queued). The feed replies `{"type":"haptic_sent"}` or `{"type":"error","message":…}`.
