# Demo script (live, real data only)

The app starts empty. Everything shown is captured or typed during the demo.

## Before you start
- Server running with `DEEPGRAM_API_KEY`, `GEMINI_MODEL` and `GOOGLE_API_KEY` set.
- Close the Vexo dashboard tab. Open `/?band=73` in Chrome or Edge.
- Tell everyone nearby that the band's microphone is about to stream to Deepgram.

## Story
1. **Pair the band** the Vexo way: double-tap the band (blinking blue), press **Connect**, pick **Vexo-HACK-73** in the browser's list (or **Connect by USB cable** → "Vexo Open band"). The band flashes white.
2. **Save a preference** in your own words, e.g. "When I say I'm overloaded, offer to make space in my schedule" with the words *overloaded, exhausted*.
3. **Capture**: tick consent, **Start live capture** (or double-tap the band). Talk. The transcript streams live; tap the band once to mark a moment. Watch loudness, movement, steps and battery.
4. **Stop** (or double-tap). In review, choose which speaker is you; other voices are dropped. Save.
5. If you said one of your words, the **support card** shows why: your statement, your preference, your earlier statements.
6. **Schedule**: add tomorrow's real busy times, **Find a time**, approve. Add a busy time over the proposal and approve again to show the re-check and recovery. Download the **.ics**.
7. **Graph**: switch to Gemini. It rebuilds from your saved statements; click a node to see the exact lines.
8. **Transcripts**: the full session is stored for this band; export it as .txt.

## Say honestly
- Signals are the band's sound level and movement — not emotions.
- Speaker labels separate voices; you confirm which one is you.
- Data stays in this browser; the server stores nothing. Audio goes to Deepgram, and saved statements go to Gemini only when you choose Gemini.
