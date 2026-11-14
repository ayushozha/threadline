# Demo script (about 2 minutes)

One person, one situation, a small labeled history, one correction, one action.
Everything below works with no provider keys. Use the live path only when keys are
configured on the server and you have consent to send audio to Deepgram.

## Before you start

- Open https://threadline.ayushojha.com (or `http://127.0.0.1:8000` locally) and refresh for a clean session.
- Point out the badges: entries marked **Fictional demo history** are invented. We did not collect two months of data today.
- Point out the saved preference (also fictional): *“When I describe feeling overloaded, offer to help make space in my schedule.”*

## Story

1. **Capture.** With live providers on: choose **Vexo band · USB cable**, **Connect band** (pick Vexo-HACK-73 only), tick recording consent, **Start live capture** (or double-tap the band). The transcript appears live. **Stop** (or double-tap). Or open *Other ways to add a conversation* → **Load scripted demo conversation** (labeled as scripted).
   - She says: “I'm exhausted, and I have something scheduled every evening.”
   - A friend says: “Do you still want to do dinner Thursday?”
2. **Identify the speaker.** In *Review before saving*, choose **Which speaker is you? → Speaker 0**. Her line is marked Me; the friend's is marked Someone else. Optionally correct a word. Click **Save my statements** — the status says the other speaker's segment was dropped, not stored.
3. **Why it's offering help.** The support card shows the new statement (with time and source), her saved preference, and the earlier statement “Keeping an evening free helped when I felt overloaded.” It says the match was her own word “exhausted” via a local rule — no AI, no inference about mood or cycle.
   - Memory-only path: **Not now — just keep the note**. Nothing else happens.
4. **Approve one action.** **Review my schedule** → *Find thirty minutes tomorrow afternoon* → **Find a time**. The log lists every slot checked and proposes 2:00–2:30 PM.
5. **The strongest test — change availability.** Click **Demo control: someone else books this slot**, then approve. Threadline re-checks, reports the conflict, creates nothing, keeps the request and preference, and proposes 2:30–3:00 PM.
6. **Result.** Approve again. The demo calendar shows **Quiet time (protected) — created by Threadline**. Say clearly: this is a local demo calendar, not Google Calendar. **Undo** removes it.
7. **Revisit.** Ask “What helped last time I felt overloaded?” The answer is labeled *Local keyword match · not AI* (or *Gemini response* when live) with links to the source notes.

Optional: switch to **Resume a routine**, ask “Where did I leave off packing?” Threadline shows the intention and last recorded step and does not claim the packing was finished.

## What to say honestly

- Audio comes from the Vexo band's microphone (or the browser microphone as fallback), streamed through our server to Deepgram. The band has no speaker or vibration motor.
- No haptics, bracelet speech, camera, or Pipecat streaming are working in this build.
- Speaker labels separate voices; they do not prove identity. The wearer confirms which one is her.
- Nothing is stored on the server; refreshing clears the session.

## Recording checklist

- [ ] Fresh refresh; browser zoom 100%; notifications off.
- [ ] Show the fictional badges in the first 10 seconds.
- [ ] Speaker selection and the “dropped, not stored” message on screen.
- [ ] Conflict injected and recovery shown.
- [ ] “Local demo calendar” caption visible when the event is created.
- [ ] End on the source-linked answer.
