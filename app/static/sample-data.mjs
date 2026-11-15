// Sample data for the demo: fills screens that have no real captures yet.
// Every item carries sample: true, the page labels it "Sample", and "Clear sample data" removes all of it.
// Real Apple Health numbers are never generated here; they come from /api/health/summary.

const at = (base, dayOffset, h, m) => { const d = new Date(base); d.setDate(d.getDate() - dayOffset); d.setHours(h, m, 0, 0); return d.toISOString(); };
const key = (base, dayOffset) => { const d = new Date(base); d.setDate(d.getDate() - dayOffset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

const CONVERSATIONS = [
  { day: 0, h: 8, m: 40, device: "Vexo-HACK-73 · USB", lines: [
    [1, "Good morning, Dad. Did you sleep alright?"], [0, "I think so. Is it Saturday? I was going to the bank."],
    [1, "It's Saturday. The bank is closed today, we can go on Monday together."], [0, "Monday. Okay. Where did I put my glasses?"],
    [1, "They're on the kitchen table next to the blue mug."], [0, "Right, the blue mug. I'll have my tablets with breakfast."]] },
  { day: 0, h: 13, m: 15, device: "Vexo-HACK-73 · USB", lines: [
    [0, "Has Priya called today?"], [1, "She called this morning, she's coming over at four with the kids."],
    [0, "Four o'clock. I should put the kettle on before then."], [0, "I'm feeling a bit tired, I might sit in the garden."]] },
  { day: 1, h: 10, m: 5, device: "Vexo-HACK-73 · Bluetooth", lines: [
    [0, "I went for a walk around the park, the long way past the pond."], [1, "That's lovely. Did you take your phone with you?"],
    [0, "Yes, it's in my coat pocket."], [0, "I keep forgetting the name of the man at the corner shop."], [1, "That's Raj. He asked about you last week."]] },
  { day: 2, h: 18, m: 30, device: "Vexo-HACK-73 · Bluetooth", lines: [
    [0, "What did I have for lunch?"], [1, "You had the soup Meera brought, tomato and lentil."],
    [0, "Oh yes. It was good. I feel quite steady today."]] },
];

const NOTES = [
  [0, 8, 52, "I'll have my tablets with breakfast."], [0, 13, 18, "I'm feeling a bit tired, I might sit in the garden."],
  [0, 13, 20, "Put the kettle on before Priya comes at four."], [1, 10, 8, "I went for a walk around the park, the long way past the pond."],
  [1, 10, 12, "I keep forgetting the name of the man at the corner shop. It's Raj."], [2, 18, 33, "I feel quite steady today."],
  [3, 9, 0, "The bank visit is Monday with my son."], [4, 16, 40, "Calling Priya on Sundays makes me happy."],
];

export function sampleSeed(now = new Date()) {
  const archive = CONVERSATIONS.map((c, i) => {
    const start = new Date(at(now, c.day, c.h, c.m));
    const lines = c.lines.map(([speaker, text], j) => ({ at: new Date(start.getTime() + j * 9000).toISOString(), offset: j * 9, speakers: [speaker], text, provider: "deepgram", activity: j % 3 === 0 ? "still" : "", hr: null, marked: j === 3 }));
    return { id: `sample-t${i}`, sample: true, startedAt: start.toISOString(), endedAt: new Date(start.getTime() + lines.length * 9000 + 4000).toISOString(), source: "vexo", device: c.device, marks: 1, lines };
  });
  const notes = NOTES.map(([d, h, m, text], i) => ({ id: `sample-n${i}`, sample: true, text, at: at(now, d, h, m), source: "vexo", context: "Sample" }));
  const tasks = [
    { id: "sample-k0", sample: true, title: "Bank visit with Dad", due: key(now, -2), big: false, done: false, note: "Sample · Monday morning" },
    { id: "sample-k1", sample: true, title: "Refill blood pressure tablets", due: key(now, 0), big: false, done: false, note: "Sample" },
    { id: "sample-k2", sample: true, title: "Decide on the day-centre place", due: key(now, -5), big: true, done: false, note: "Sample · talk it over first" },
    { id: "sample-k3", sample: true, title: "Priya visiting at 4 pm", due: key(now, 0), big: false, done: false, note: "Sample" },
  ];
  const energyLog = [
    { at: at(now, 0, 8, 52), state: "steady", word: "alright", sample: true },
    { at: at(now, 0, 13, 18), state: "low", word: "tired", sample: true },
    { at: at(now, 0, 16, 10), state: "positive", word: "happy", sample: true },
  ];
  const actions = [
    { at: at(now, 0, 8, 55), text: "Sample · Reminded about tablets with breakfast", sample: true },
    { at: at(now, 0, 13, 22), text: "Sample · Moved “Priya visiting at 4 pm” to today", sample: true },
    { at: at(now, 0, 13, 25), text: "Sample · Soft watch tap check-in after “tired”", sample: true },
  ];
  const days = {};
  for (const [d, words, others] of [[0, ["tired"], 6], [1, [], 2], [2, [], 3], [3, [], 0], [4, [], 1]]) {
    days[key(now, d)] = { energy: words.map((w) => ({ word: w, at: at(now, d, 13, 18) })), others, mine: 4, hrSum: 0, hrN: 0, hrMin: null, hrMax: null, watchSteps: null, bandSteps: 0, sample: true };
  }
  return { archive, notes, tasks, energyLog, actions, days, energy: { state: "positive", at: at(now, 0, 16, 10), text: "Calling Priya on Sundays makes me happy.", word: "happy", sample: true } };
}
