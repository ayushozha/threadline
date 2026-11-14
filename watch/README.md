# Threadline Watch

A small standalone watchOS app. Its main job is to be a **sensor**: while you stream, it sends live readings (heart rate, active energy, steps, activity, and whether the screen is awake) to the Threadline server about once a second. The server passes them to the web page you paired with. Recording audio is optional (the **Record audio too** toggle). The Vexo band is still the main recorder, and the page can show both in one session.

The readings are just readings. Threadline does not interpret heart rate or anything else as stress, mood, health or cycle state.

## How it fits together

```
Apple Watch app ──(code)──> Threadline server ──> paired web page(s)   sensors, transcript
                                   └──> Deepgram                       only if audio is on
```

- A web page cannot connect to an Apple Watch. The watch runs this app and talks to the Threadline server. The page subscribes to the server.
- The 6-digit pairing code is the only credential on the watch. No API keys or access tokens go on the watch. Deepgram's key stays on the server.
- The watch stores no audio and no readings. HealthKit runs a workout session only to read live heart rate, and the app discards that workout when you stop, so nothing is saved to Health. The server stores nothing either: it forwards readings as they arrive, and the pairing registry lives in memory only.

## Pair

1. On the Threadline website, create a watch pairing (`POST /api/watch/pair`, which needs the access token). The page shows a 6-digit code. An unused code expires after 10 minutes. After a watch attaches, the code keeps working for reconnects for 2 hours.
2. On the watch, check the server (the default is `https://threadline.ayushojha.com`), enter the code and tap **Continue**.
3. Tap **Start streaming**. The first time, watchOS asks for Health access (heart rate and active energy, plus workout write access, which a workout session needs), Motion access, and Microphone access if audio is on.
4. The screen lists exactly what is being shared and with which host.

## Cycle dates (opt-in) and haptics

- **Share cycle dates** is off by default. When you turn it on, the watch asks Health for read access to menstrual flow, reads the flow days you logged in the last 12 months, groups consecutive days into periods and sends only each period's first day, once per streaming session: `{"type":"cycle","period_starts":["YYYY-MM-DD",…]}` (ascending, at most 24, no flow levels, no predictions). The server checks the dates (valid ISO date, within 2 years, not after tomorrow UTC), forwards them to the paired page and stores nothing.
- **Haptics:** the paired page can send `{"type":"haptic","kind":"notification"|"success"|"directionUp"|"click","reason":"…"}` on its feed socket (at most one every 3 seconds per code). The watch plays the haptic and shows the reason for a few seconds.

## Run in the watchOS Simulator

You need Xcode with a watchOS simulator runtime. XcodeGen is optional: the generated `ThreadlineWatch.xcodeproj` is checked in. If you edit `project.yml`, run `xcodegen generate` in this folder.

```bash
cd watch
xcodebuild -project ThreadlineWatch.xcodeproj -scheme ThreadlineWatch \
  -destination 'platform=watchOS Simulator,name=Apple Watch Series 12 (46mm)' build
```

Alternatively, open `ThreadlineWatch.xcodeproj`, pick a watch simulator and press Run.

To test against a server on your Mac, run it with `uv run uvicorn app.main:app --host 0.0.0.0 --port 8000` and set the watch's server to `http://127.0.0.1:8000`. The simulator shares the Mac's network. A workout session in the simulator produces simulated heart rate. Steps and activity stay at "–" in the simulator because it has no motion hardware.

## Run on a real Apple Watch (manual steps)

1. Open `ThreadlineWatch.xcodeproj` in Xcode. Under **Signing & Capabilities**, choose your team (a free Apple ID works for personal devices). If the bundle id `com.threadline.watch` is taken, change it.
2. Keep the **HealthKit** capability (`ThreadlineWatch.entitlements`).
3. Turn on Developer Mode on the watch, select it as the run destination, and press Run. The watch must be paired with an iPhone that is signed in to the same Apple ID.
4. Use `https://threadline.ayushojha.com` or another HTTPS server. On a real watch, a LAN `http://192.168.x.x:8000` address works only when the watch and the Mac are on the same Wi-Fi network.

## Honest limits

- **WebSockets on a real watch:** watchOS blocks `URLSessionWebSocketTask` for ordinary apps (Apple TN3135). The app first tries `wss://…/api/watch/stream`. If that socket is not ready within 6 seconds, it switches to plain HTTPS: sensor frames go to `POST /api/watch/sensors` and audio goes as about 0.5-second chunks to `POST /api/watch/audio`. Both transports work in the simulator. The HTTPS fallback has been tested only in the simulator, not on a physical watch.
- **Wrist down:** the workout session keeps the app running in the background (`workout-processing`), so sensor streaming should continue when you lower your wrist. This has not been tested on a real device. `wrist_raised` is an approximation: it means the screen is not dimmed (`isLuminanceReduced`).
- **Steps** count from the moment you start streaming. They are not your daily total.
- The server keeps pairings in memory, so it must run as a single process, which matches the current Dockerfile. A restart clears all codes.
- Debug builds allow plain `http` (ATS exceptions) so you can develop on a LAN. Remove `NSAllowsArbitraryLoads` before you distribute the app.

## Wire protocol (for reference)

Watch → `WS /api/watch/stream`. The first text frame is `{"code","device","format":"sensors"|"pcm16"}`, and the server replies `{"type":"ready","source":…}`. In `sensors` mode, the watch sends text frames like `{"type":"sensors","t","heart_rate","steps","active_kcal","activity","wrist_raised"}`. In `pcm16` mode, the watch sends binary frames of 16 kHz mono little-endian Int16 PCM (100 ms each), and can interleave sensor text frames on the same socket. Sending `{"type":"stop"}` ends the session.

HTTPS fallback: `POST /api/watch/sensors` (JSON body), `POST /api/watch/audio` (raw PCM body) and `POST /api/watch/audio/stop`, each with an `X-Watch-Code` header and an optional `X-Watch-Device` header. The audio responses carry `{"messages":[…]}`, with the transcript results produced since the previous post. Cycle dates go as the same `cycle` text frame on the socket, or to `POST /api/watch/cycle`. Haptics reach the watch as a `{"type":"haptic","kind","reason"}` text frame, or in the next `POST /api/watch/sensors` response as `{"forwarded":…,"haptics":[…]}` (up to 3 queued). The feed replies `{"type":"haptic_sent"}` or `{"type":"error","message":…}`.
