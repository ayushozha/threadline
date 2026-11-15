// Explicitly loaded fictional history, never a recording or clinical dataset.
// Inputs only: suggestions and completed actions are not seeded.
export const DEMO_QUESTION = 'What was Meera doing before the phone call, where were her glasses last mentioned, and what is one small next step? Say what you cannot confirm.';

const SCENES = [
  { day: 6, time: '09:10', title: 'How Meera likes help', lines: [
    ['Meera', 'Please give me one step at a time. Too many instructions are hard to follow.'],
    ['Priya', 'Would you like me to call when you ask for company?'],
    ['Meera', 'Yes. Ask me first before sending Priya any update.'],
    ['Meera', 'I like tea in the blue mug, sitting by the window.'],
    ['Priya', 'We can keep the tea tin beside the kettle.'],
  ] },
  { day: 5, time: '10:20', title: 'A useful place for glasses', lines: [
    ['Meera', 'I was looking for my reading glasses this morning.'],
    ['Priya', 'Would a small tray beside the blue mug be a good place?'],
    ['Meera', 'Yes. I am putting my glasses in the tray by the blue mug now.'],
    ['Meera', 'Remind me of the tray when I ask where I put them.'],
    ['Priya', 'A note tells us the last mentioned place, not that they are still there.'],
  ] },
  { day: 4, time: '15:00', title: 'The afternoon plan', lines: [
    ['Priya', 'I can visit on Saturday at four.'],
    ['Meera', 'Saturday at four. I would like to make tea when you come.'],
    ['Meera', 'After tea I want to water the plant by the window.'],
    ['Priya', 'We can check the soil together first.'],
    ['Meera', 'Let us do the tea first.'],
  ] },
  { day: 3, time: '11:05', title: 'Pause and resume', lines: [
    ['Meera', 'I was folding the towels when the doorbell rang.'],
    ['Priya', 'You said you wanted to put them on the shelf afterward.'],
    ['Meera', 'That helps. I can return to one thing at a time.'],
    ['Meera', 'Please ask me if I want help instead of taking over.'],
    ['Priya', 'Of course. You choose what to do next.'],
  ] },
  { day: 2, time: '16:15', title: 'Preferred support', lines: [
    ['Meera', 'A quiet seat by the window helps me take a break.'],
    ['Priya', 'Do you want a long list for tomorrow?'],
    ['Meera', 'No. Show me what I just said I wanted to do.'],
    ['Meera', 'If we do not know whether I finished, ask me.'],
    ['Priya', 'We will not mark it done from a plan alone.'],
  ] },
  { day: 1, time: '17:30', title: 'Preparing for a visit', lines: [
    ['Meera', 'I am looking forward to Priya visiting tomorrow.'],
    ['Meera', 'I want the blue mug for my tea.'],
    ['Priya', 'We can talk about the plant when I arrive.'],
    ['Meera', 'Please keep the glasses tray next to the mug.'],
    ['Priya', 'All right. I will see you at four.'],
  ] },
  { day: 0, time: '15:45', title: 'The interrupted tea routine', lines: [
    ['Meera', 'I am going to make tea in my blue mug, then water the plant.'],
    ['Meera', 'I am putting my reading glasses in the tray beside the blue mug.'],
    ['Meera', 'The phone is ringing. I will answer it before I start the tea.'],
    ['Priya', 'Hi Mum, I am on my way. See you soon.'],
    ['Meera', 'The call has ended. What was I doing before the phone rang?'],
    ['Meera', 'I do not remember whether I already made the tea. Can you help me with one step?'],
  ] },
];

export function sampleSeed(now = new Date()) {
  const archive = SCENES.map((scene, index) => {
    const start = new Date(now);
    start.setDate(start.getDate() - scene.day);
    const [h, m] = scene.time.split(':').map(Number);
    start.setHours(h, m, 0, 0);
    const lines = scene.lines.map(([speaker, text], n) => ({
      id: `fictional-${index}-${n}`, sample: true, source: 'fictional',
      at: new Date(start.getTime() + n * 12000).toISOString(), offset: n * 12,
      speakers: [speaker === 'Meera' ? 0 : 1], speaker, text,
      provider: 'fictional', activity: '', hr: null, marked: false,
    }));
    return { id: `fictional-session-${index}`, sample: true, title: scene.title,
      startedAt: start.toISOString(), endedAt: new Date(start.getTime() + lines.length * 12000).toISOString(),
      source: 'fictional', device: 'Fictional conversation · written demo', marks: 0, lines };
  });
  const notes = archive.flatMap(session => session.lines.filter(line => line.speaker === 'Meera').map(line => ({
    id: line.id, sample: true, source: 'fictional', text: line.text, at: line.at,
    speaker: line.speaker, context: `Fictional Meera demo · ${session.title}`,
  })));
  return { archive: archive.slice().reverse(), notes, tasks: [], actions: [], energyLog: [], energy: null, days: {},
    question: DEMO_QUESTION,
    routine: ['Fictional Meera preference: offer one step at a time.', 'Fictional Meera plan: make tea, then water the plant.', 'Fictional Meera preference: ask before contacting Priya.'] };
}

/* ---------- Mood tracking (demo profile) ----------
   Modelled on instruments used in dementia care, driven by the person's real Apple Health days:
   - Daily mood on Apple Health's State of Mind valence scale (-1 very unpleasant … +1 very pleasant), morning and evening.
   - Evening agitation on the NPI-Q severity scale (0 none, 1 mild, 2 moderate, 3 severe); late-day agitation
     ("sundowning") is more likely after short sleep and low daytime activity, and less after an active day.
   - Repeated questions per day, a behavioural marker that rises with agitation.
   - Weekly Cornell Scale for Depression in Dementia (CSDD, caregiver-rated, 19 items, 0–38):
     under 6 no significant depressive symptoms, 6–10 mild, 11–17 probable major depression, 18+ definite.
   Values are deterministic per date so the screens stay stable across reloads. */
const rand = (seed) => { let x = Math.sin(seed) * 10000; return x - Math.floor(x); };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const LABELS = { pos: ["calm", "content", "happy", "peaceful", "hopeful"], neu: ["calm", "indifferent", "content"], neg: ["anxious", "irritated", "drained", "worried", "confused"] };
export const CSDD_BANDS = [[0, 5, "No significant depressive symptoms"], [6, 10, "Mild symptoms — keep watching"], [11, 17, "Probable major depression — talk to the GP"], [18, 38, "Definite major depression — talk to the GP soon"]];
export const csddBand = (score) => CSDD_BANDS.find(([lo, hi]) => score >= lo && score <= hi)?.[2] || "";

export function moodSeries(healthByDay = {}, days = 30, now = new Date()) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const k = key(now, i), h = healthByDay[k] || {}, seed = Number(k.replaceAll("-", ""));
    const sleep = h.sleep_hours ?? 6.5 + rand(seed) * 1.5, steps = h.steps ?? 5000 + rand(seed + 1) * 4000;
    const hrvDip = h.hrv_sdnn != null ? clamp((32 - h.hrv_sdnn) / 20, -0.5, 0.5) : 0;
    const dow = new Date(`${k}T12:00:00`).getDay();
    const family = dow === 0 ? 0.12 : 0;  // Sunday family visit
    const morning = clamp(0.1 + 0.11 * (sleep - 7) + 0.07 * (Math.min(steps, 12000) / 6000 - 1) - 0.1 * hrvDip + family + (rand(seed + 2) - 0.5) * 0.3, -1, 1);
    let agitation = 1 + (sleep < 6 ? 1 : 0) + (steps < 3500 ? 0.6 : 0) - (steps > 8500 ? 0.8 : 0) + (rand(seed + 3) - 0.5) * 1.2;
    agitation = Math.round(clamp(agitation, 0, 3));
    const evening = clamp(morning - 0.18 * agitation + 0.1 + (rand(seed + 4) - 0.5) * 0.2, -1, 1);
    const repeats = Math.max(0, Math.round(2 + agitation * 2.2 + (sleep < 6 ? 1.5 : 0) + rand(seed + 5) * 2));
    const pick = (v, s) => { const set = v > 0.2 ? LABELS.pos : v < -0.2 ? LABELS.neg : LABELS.neu; return set[Math.floor(rand(s) * set.length)]; };
    out.push({ date: k, morning: Math.round(morning * 100) / 100, evening: Math.round(evening * 100) / 100, morningLabel: pick(morning, seed + 6), eveningLabel: pick(evening, seed + 7), agitation, repeats, sleep, steps });
  }
  // Weekly CSDD from the week's days: low mood, irritability/agitation, sleep disturbance and loss of interest items.
  const weeks = [];
  for (let end = out.length - 1; end >= 6; end -= 7) {
    const wk = out.slice(end - 6, end + 1), avg = (f) => wk.reduce((s, d) => s + f(d), 0) / wk.length;
    const lowMood = clamp(Math.round(-avg((d) => (d.morning + d.evening) / 2) * 6 + 2), 0, 6);
    const agit = clamp(Math.round(avg((d) => d.agitation) * 2), 0, 6);
    const sleepItems = clamp(Math.round(wk.filter((d) => d.sleep < 6).length * 0.9), 0, 6);
    const interest = clamp(Math.round(wk.filter((d) => d.steps < 4000).length * 0.7), 0, 4);
    const score = clamp(lowMood + agit + sleepItems + interest + 1, 0, 38);
    weeks.unshift({ weekEnding: wk.at(-1).date, score, band: csddBand(score), items: { lowMood, agitation: agit, sleep: sleepItems, interest } });
  }
  return { days: out, weeks };
}
