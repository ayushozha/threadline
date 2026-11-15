// One assistant, four ways of helping. The mode changes what Gemini Live emphasises, how the page talks back
// and what the dashboard puts first. Fictional scenes below are written demo dialogue, loaded only with the
// fictional history and always marked as such.

export const MODES = {
  memory: { label: "Memory", icon: "🧠", who: "Grandparents · dementia · Alzheimer's",
    line: "Answers repeated questions calmly, remembers where things were seen, keeps the routine on track.",
    does: ["Band hears the repeated question and answers it the same calm way", "Camera remembers where the glasses were last seen", "Routine prompts; family gets a note when the day drifts"],
    signals: ["Repeated questions", "Routine steps", "Sleep before hard evenings"] },
  sight: { label: "Sight", icon: "👁️", who: "Blind · low vision",
    line: "Describes what is in front, reads labels and medicine boxes aloud, warns about steps and obstacles.",
    does: ["Double-tap the band: “What's in front of me?”", "Reads text word for word: labels, signs, screens", "Hazards first, then directions in steps and clock positions"],
    signals: ["Obstacles named", "Text read aloud", "Watch taps left / right"] },
  hearing: { label: "Hearing", icon: "👂", who: "Deaf · hard of hearing",
    line: "Live captions with who is speaking; the watch taps when your name, a doorbell or an alarm is heard.",
    does: ["Band mic becomes large live captions", "Speaker turns kept apart", "Watch haptic for name, doorbell, alarm"],
    signals: ["Captions", "Name called", "Alarm sounds"] },
  mobility: { label: "Mobility", icon: "🦽", who: "Wheelchair users · Parkinson's · fall risk",
    line: "Watches walking steadiness and falls, spots trip hazards, alerts family the moment help is needed.",
    does: ["Free-fall or triple-tap SOS turns the agent red and texts family", "Camera points out trip hazards and the safest path", "Walking steadiness trend goes to the doctor report"],
    signals: ["Walking steadiness", "Falls / SOS", "Steps and stand hours"] },
};
export const MODE_KEYS = Object.keys(MODES);
const KEY = "threadline.mode.v1";
export function currentMode() { try { const m = localStorage.getItem(KEY); return MODES[m] ? m : "memory"; } catch { return "memory"; } }
export function setMode(m) { try { if (MODES[m]) localStorage.setItem(KEY, m); } catch { /* storage off */ } }

/* Fictional scenes that follow the 1-minute video script, one per mode. */
const SCENES = [
  { mode: "sight", title: "Sight · reading the medicine box", minutesAgo: 95, lines: [
    [0, "What's in front of me?"], [1, "A white box on the counter, about one step ahead, slightly to your right."],
    [1, "It says Paracetamol, 500 milligrams. Take two tablets every four to six hours. No more than eight in 24 hours."],
    [0, "Is it the right one?"], [1, "I can read the label, but I can't confirm it is the right medicine for you. Let's check with your carer."],
    [1, "Careful: there is a step down to your left, by the doorway."]] },
  { mode: "hearing", title: "Hearing · name called and doorbell", minutesAgo: 70, lines: [
    [1, "Sam, dinner is ready in five minutes."], [0, "Thanks, I'll come down."], [1, "ALERT: doorbell."],
    [1, "Hi Sam, it's the delivery for number twelve."], [0, "Coming!"]] },
  { mode: "mobility", title: "Mobility · fall and SOS", minutesAgo: 40, lines: [
    [0, "I'm going to get up and get my book."], [1, "There's a rug edge in front of the chair. The clearer path is to your right."],
    [0, "Help, I've fallen."], [1, "Stay still. I'm alerting your family now. If you are hurt, call emergency services."],
    [1, "Priya has been sent a message."]] },
];
export function modeScenes(now = new Date()) {
  return SCENES.map((scene, i) => {
    const start = new Date(now.getTime() - scene.minutesAgo * 60000);
    const lines = scene.lines.map(([speaker, text], j) => ({ id: `fictional-mode-${i}-${j}`, at: new Date(start.getTime() + j * 7000).toISOString(), offset: j * 7, speakers: [speaker], text,
      provider: "fictional", activity: "", hr: null, marked: false }));
    return { id: `fictional-mode-${scene.mode}`, sample: true, title: scene.title, mode: scene.mode, startedAt: start.toISOString(),
      endedAt: new Date(start.getTime() + lines.length * 7000).toISOString(), source: "fictional", device: "Fictional conversation · written demo", marks: 0, lines };
  });
}
