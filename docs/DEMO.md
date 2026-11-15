# Threadline Care: 3-minute demo

Open `/#care` in Chrome or Edge. Tell people nearby that the band's microphone is streaming to Deepgram.

## Before you start
- Server has `GOOGLE_API_KEY`, `GEMINI_MODEL`, `GEMINI_LIVE_MODEL` and `DEEPGRAM_API_KEY` set.
- Vexo dashboard tab closed; band 73 connected on **Your band** and the live transcript moving.
- Apple Watch paired (for the haptic tap). Kitchen clip uploaded, or GoPro bridge running.

## Script

**0:00 Problem.** "A caregiver can't watch someone all day. The same question every few minutes, lost glasses, worry about pills, and falls nobody sees. Threadline Care listens, watches, answers calmly, and tells the family only what matters."

**0:25 Inputs.** Point to the three sources on `/#care`:
- Vexo band 73 connected, live transcript streaming as you speak (Deepgram nova-3).
- **What Threadline is watching**: the looped kitchen clip, or the GoPro LIT HERO via the bridge.
- Health card: real Apple Health history from the iPhone app. Say plainly: "This is my own data, standing in for the person being cared for."

**1:05 Gemini Live.** Press **Start live guidance**. Ask "Where are my glasses?" It answers out loud from what the camera sees. Ask "Did I take my pills?" It will not confirm; it suggests checking the organiser together.

**1:45 Care agent.** Ask "Where is my wife?" three times. Press **Check now**. Status turns amber (**needs attention**) with one next step and a note for the family; reasons cite the repeated question.

**2:20 Urgent.** Say "Help, I've fallen" (or press **Simulate fall (demo)**). Press **Check now** if it doesn't update. Status turns red (**urgent**), the watch taps, and **Text family** opens a pre-filled message.

**2:45 Safety.** "Urgent only on a real fall or a help phrase. It never diagnoses, never claims medication was taken, never identifies faces, and every reason cites an input. If Gemini is down, local rules give the same safe answer." Close.

## Backup plan
- **Band won't connect:** use the laptop microphone as the transcript source; same Deepgram relay.
- **GoPro/bridge fails:** switch to **Upload videos** and loop the kitchen clip.
- **Gemini down or slow:** the caregiver agent falls back to local rules automatically (the card says so); skip Gemini Live and show the agent.
- **Watch not paired:** show the red status and the **Text family** link; mention the tap.
