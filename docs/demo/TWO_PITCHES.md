# Two standalone Jessica pitches

Each pitch is separate: six sections, a full narration master, timed captions, and six editable audio chapters. The selected voice is the Jessica delivery approved by the user. These new takes retain the same model and voice settings, with sparse performance cues.

Use **60–75 seconds per finished edit**, including source-reading pauses. The voice-only masters are 51.12 seconds (dementia) and 54.24 seconds (PMS). No finished video has been assembled.

“Why this is the best solution” is expressed as the project's specific advantage, not an unsupported claim of superior clinical outcomes. Dementia: a personal, source-linked starting point. PMS: a person's own words and preferences connected to an action they approve. Neither script claims diagnosis, treatment, reliable emotion detection, or real-calendar integration.

## Dementia — keep your place, keep your say

[Play full narration](../../assets/demo/narration/dementia-jessica-final.mp3) · [SRT](../../assets/demo/narration/dementia-jessica-final.srt) · [VTT](../../assets/demo/narration/dementia-jessica-final.vtt) · [Plain script](../../assets/demo/narration/dementia-pitch.txt)

Duration: 51.12 seconds.

### 1. Introduction

**0.14–8.26s in master** · [Chapter audio](../../assets/demo/narration/dementia/01-introduction.mp3)

She’s packing for a family visit. Clothes go in the suitcase. The doorbell rings. Then she comes back… and loses her place.

### 2. Problem statement

**8.72–14.26s in master** · [Chapter audio](../../assets/demo/narration/dementia/02-problem-statement.mp3)

For someone living with dementia, a small interruption can make a familiar task difficult to pick up again.

### 3. Why it matters

**14.72–23.98s in master** · [Chapter audio](../../assets/demo/narration/dementia/03-why-it-matters.mp3)

Retracing those steps takes effort, and may mean asking someone else for help. What’s at stake is more than a forgotten charger. It’s everyday independence.

### 4. Our solution

**24.46–33.00s in master** · [Chapter audio](../../assets/demo/narration/dementia/04-our-solution.mp3)

Threadline brings her recorded plan and recent notes back into view. “What was my next planned step?” Her plan and earlier notes give her a place to restart.

### 5. What it solves

**33.38–40.00s in master** · [Chapter audio](../../assets/demo/narration/dementia/05-what-it-solves.mp3)

In our prototype, she can review what was captured, correct it, and see the source. Unrecorded progress stays unknown.

### 6. Why this approach

**40.44–50.94s in master** · [Chapter audio](../../assets/demo/narration/dementia/06-why-this-approach.mp3)

That’s the difference: support tied to her intention and context. This fictional demo explores a simple goal: help people keep their place, and their say, in everyday life.

## PMS — remember what helped, make room for it

[Play full narration](../../assets/demo/narration/pms-jessica-final.mp3) · [SRT](../../assets/demo/narration/pms-jessica-final.srt) · [VTT](../../assets/demo/narration/pms-jessica-final.vtt) · [Plain script](../../assets/demo/narration/pms-pitch.txt)

Duration: 54.24 seconds.

### 1. Introduction

**0.10–8.34s in master** · [Chapter audio](../../assets/demo/narration/pms/01-introduction.mp3)

You’ve got plans every evening. You’re exhausted. And you remember thinking, “I felt like this before… what actually helped?”

### 2. Problem statement

**8.82–16.82s in master** · [Chapter audio](../../assets/demo/narration/pms/02-problem-statement.mp3)

For some people, the days before a period can bring changes in energy, mood, and concentration. But remembering the details takes effort.

### 3. Why it matters

**17.14–21.58s in master** · [Chapter audio](../../assets/demo/narration/pms/03-why-it-matters.mp3)

When you’re already overwhelmed, another form to fill out can feel like one more task.

### 4. Our solution

**22.10–32.26s in master** · [Chapter audio](../../assets/demo/narration/pms/04-our-solution.mp3)

Threadline keeps the words you choose to save, with your permission and their source. Ask, “What helped me feel less rushed last time?” Your note says: leaving an evening free.

### 5. What it solves

**32.80–41.04s in master** · [Chapter audio](../../assets/demo/narration/pms/05-what-it-solves.mp3)

Then it helps you act. Our prototype checks a demo calendar, proposes a break, catches a new conflict, and only books after you approve.

### 6. Why this approach

**41.48–53.96s in master** · [Chapter audio](../../assets/demo/narration/pms/06-why-this-approach.mp3)

That’s what makes this approach personal: your own recorded words, your saved preferences, and practical support you control. This is a fictional example, not a judgment about how you feel. A little more breathing room.

## Picture and demo direction

| Section | Dementia pitch | PMS pitch |
| --- | --- | --- |
| Introduction | Packing: suitcase, clothing, an interruption. Use a labeled staged shot or actual current routine UI. The existing plant image is decorative and does not illustrate packing. | Evening-desk image, then a crowded demo calendar. |
| Problem and importance | Keep focus on regaining a place in an ordinary task. Do not show helplessness or imply all people with dementia have the same abilities. | Person's self-reported experience and effort of remembering; no invented hormonal chart or mood score. |
| Solution | Current routine UI: packing plan, clothing note, interruption, question and linked sources. | Current reflection UI: own saved statement, source and preference. |
| What it solves | Review/correct/source controls. Preserve “unknown” progress rather than checking off an unobserved action. | Show the local demo-calendar proposal, injected conflict, re-check, approval and undo. Keep “demo calendar” visible. |
| Why this approach | Personal intention and visible context; state this is a fictional prototype. | Words, preference and user control. State this is a fictional prototype. |

Use `current-dementia.mp4` (15 seconds) and `current-pms.mp4` (25 seconds) in `assets/demo/motion/`. These show the actual current local app. The dementia query falls back to recent packing notes; no inferred next step is fabricated. The PMS clip shows the scripted speaker review, saved preference, actual demo-calendar conflict/retry/approval and undo. The older `ui-routine.mp4` and `ui-reflection.mp4` belong to the earlier scaffold. Voiceover remains editorial; it is not live app speech.

## Evidence and scope

- [National Institute on Aging: cognitive impairment and daily routines](https://www.nia.nih.gov/health/caring-older-patients-cognitive-impairment) supports the general context of memory difficulties, routine support, and care partners. It does not validate this prototype.
- [Office on Women's Health: PMS](https://womenshealth.gov/menstrual-cycle/premenstrual-syndrome) describes varied pre-period symptoms including tiredness and concentration/memory difficulty. These facts do not mean the app can infer PMS or causation.
- [Current app demo](../DEMO.md) specifies actual source review and local-calendar behavior. [Event presentation](../VEXOHACKS_2026-11-14_EVENT_PRESENTATION.md) provides sponsor and submission context. No “best” award or clinical result is claimed.

## Regenerate

```powershell
uv run python tools/generate_dialogue_narration.py --text assets/demo/narration/dementia-pitch-directed.txt --output assets/demo/narration/dementia-new.mp3
uv run python tools/prepare_demo_audio.py --audio assets/demo/narration/dementia-new.mp3 --text assets/demo/narration/dementia-pitch.txt
```

The same commands work for the PMS filenames. The local `.env` selects Jessica, the model, stability and similarity. Secrets remain untracked. Chapter clips are cropped from the final master with small silence handles; full-master subtitles should be retimed after rearranging chapters. Audio decode/peak and subtitle consistency were checked; the user approved the Jessica voice, not yet each new take.
