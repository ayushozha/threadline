// Written example conversations for testing grounded assistance, never patient records.
// Every response is produced by the app from these inputs; no decisions or sensor values are seeded.
export const DEMO_QUESTIONS = {
  memory: 'What was Evelyn doing before the phone call, where were her glasses last mentioned, and what is one small next step? Say what you cannot confirm.',
  sight: 'What did Ravi ask you to help read, what can you establish from these words alone, and what image or clarification do you need next? Do not invent visible objects or safety guarantees.',
  hearing: 'What did Alex and Sam agree about the delivery and meeting, which name should the captions highlight, and what still needs confirmation?',
  mobility: 'What assistance did Jordan request, who may be contacted with permission, and what is the next small step? Separate reported events from observed facts.',
};
export const DEMO_QUESTION = DEMO_QUESTIONS.memory;

const DATA = {
  memory: { persona: 'Evelyn', routine: [
    'Please give me one step at a time.', 'I am going to make tea in my blue mug, then water the plant.', 'Ask me first before sending Emma any update.',
  ], scenes: [
    { day: 6, time: '09:10', title: 'How Evelyn likes help', lines: [
      ['Evelyn', 'Please give me one step at a time. Too many instructions are hard to follow.'],
      ['Emma', 'Would you like me to call when you ask for company?'],
      ['Evelyn', 'Yes. Ask me first before sending Emma any update.'],
      ['Evelyn', 'I like tea in the blue mug, sitting by the window.'],
      ['Emma', 'We can keep the tea tin beside the kettle.'],
      ['Evelyn', 'If I ask the same question, please answer calmly without testing me.'],
      ['Evelyn', 'Tell me what I said before, but ask if my plan has changed.'],
    ] },
    { day: 5, time: '10:20', title: 'A useful place for glasses', lines: [
      ['Evelyn', 'I was looking for my reading glasses this morning.'],
      ['Emma', 'Would a small tray beside the blue mug be a good place?'],
      ['Evelyn', 'Yes. I am putting my glasses in the tray by the blue mug now.'],
      ['Evelyn', 'Remind me of the tray when I ask where I put them.'],
      ['Emma', 'A note tells us the last mentioned place, not that they are still there.'],
      ['Evelyn', 'Where are my glasses?'],
      ['Emma', 'You said you placed them in the tray. We can look together.'],
    ] },
    { day: 4, time: '15:00', title: 'The afternoon plan', lines: [
      ['Emma', 'I can visit on Saturday at four.'],
      ['Evelyn', 'Saturday at four. I would like to make tea when you come.'],
      ['Evelyn', 'After tea I want to water the plant by the window.'],
      ['Emma', 'We can check the soil together first.'],
      ['Evelyn', 'Let us do the tea first.'],
      ['Evelyn', 'Please do not mark the plant watered just because I said I would do it.'],
    ] },
    { day: 3, time: '11:05', title: 'Pause and resume', lines: [
      ['Evelyn', 'I was folding the towels when the doorbell rang.'],
      ['Emma', 'You said you wanted to put them on the shelf afterward.'],
      ['Evelyn', 'That helps. I can return to one thing at a time.'],
      ['Evelyn', 'Please ask me if I want help instead of taking over.'],
      ['Emma', 'Of course. You choose what to do next.'],
      ['Evelyn', 'I have folded the towels. I have not put them on the shelf yet.'],
    ] },
    { day: 2, time: '16:15', title: 'Preferred support', lines: [
      ['Evelyn', 'A quiet seat by the window helps me take a break.'],
      ['Emma', 'Do you want a long list for tomorrow?'],
      ['Evelyn', 'No. Show me what I just said I wanted to do.'],
      ['Evelyn', 'If we do not know whether I finished, ask me.'],
      ['Emma', 'We will not mark it done from a plan alone.'],
      ['Evelyn', 'I slept poorly last night. I would prefer a quiet afternoon today.'],
      ['Emma', 'We can remember that preference without predicting how you will feel.'],
    ] },
    { day: 1, time: '17:30', title: 'Preparing for a visit', lines: [
      ['Evelyn', 'I am looking forward to Emma visiting tomorrow.'],
      ['Evelyn', 'I want the blue mug for my tea.'],
      ['Emma', 'We can talk about the plant when I arrive.'],
      ['Evelyn', 'Please keep the glasses tray next to the mug.'],
      ['Emma', 'All right. I will see you at four.'],
      ['Evelyn', 'Where are my glasses?'],
      ['Emma', 'The last place you mentioned was the tray beside the blue mug.'],
    ] },
    { day: 0, time: '15:45', title: 'The interrupted tea routine', lines: [
      ['Evelyn', 'I am going to make tea in my blue mug, then water the plant.'],
      ['Evelyn', 'I am putting my reading glasses in the tray beside the blue mug.'],
      ['Evelyn', 'The phone is ringing. I will answer it before I start the tea.'],
      ['Emma', 'Hi Mum, I am on my way. See you soon.'],
      ['Evelyn', 'The call has ended. What was I doing before the phone rang?'],
      ['Evelyn', 'Where are my glasses?'],
      ['Evelyn', 'I do not remember whether I already made the tea. Can you help me with one step?'],
      ['Evelyn', 'If you want to tell Emma that I asked for help, show me the message first.'],
    ] },
  ] },
  sight: { persona: 'Ravi', routine: [
    'Read the words exactly and tell me when part of a label is unclear.', 'Describe what is visible without guessing what is outside the image.', 'Ask before sharing my notes with Leena.',
  ], scenes: [
    { day: 3, time: '09:10', title: 'Ravi chooses his reading support', lines: [
      ['Ravi', 'I have low vision. Read the words exactly and tell me when part of a label is unclear.'],
      ['Leena', 'Should I describe colors and positions too?'],
      ['Ravi', 'Yes. Say on the left or on the right, but do not tell me it is safe to walk.'],
      ['Ravi', 'Ask before sharing my notes with Leena.'],
      ['Ravi', 'I use my cane for getting around. The camera is extra information.'],
    ] },
    { day: 2, time: '12:20', title: 'Finding the tea tin', lines: [
      ['Ravi', 'I want to find the tea tin rather than the coffee jar.'],
      ['Leena', 'I put the tea tin on the left side of the kitchen shelf this morning.'],
      ['Ravi', 'That is a last mentioned location. Let us check the current camera view.'],
      ['Ravi', 'Describe what is visible without guessing what is outside the image.'],
      ['Ravi', 'I have moved the tin to the counter now. Please keep the newer location.'],
    ] },
    { day: 1, time: '10:30', title: 'Reading a cereal package', lines: [
      ['Ravi', 'Can you read this cereal package exactly? I want the product name and allergen statement.'],
      ['Leena', 'I can help position the package so the label faces the camera.'],
      ['Ravi', 'Read the allergen statement as printed, but do not decide whether this food is safe for me.'],
      ['Ravi', 'If the small print is blurry, say it is unreadable instead of filling it in.'],
      ['Leena', 'A transcript of this conversation does not tell us what the package says.'],
      ['Ravi', 'I will hold up the front of the package for a new image.'],
    ] },
    { day: 0, time: '10:45', title: 'The next view to inspect', lines: [
      ['Ravi', 'I am at the building entrance. There may be a step near the door.'],
      ['Ravi', 'Please describe the ground in the current view. Do not decide when I should cross or move.'],
      ['Leena', 'I can stay with you while you check the entrance.'],
      ['Ravi', 'For the demo, I first want the cereal package read. I have not supplied its picture yet.'],
      ['Ravi', 'What do you need from me before you can read it?'],
    ] },
  ] },
  hearing: { persona: 'Alex', routine: [
    'My name is Alex. Highlight Alex in the captions.', 'Use large captions and keep separate speaker labels.', 'Do not use sound alone to get my attention.',
  ], scenes: [
    { day: 3, time: '09:10', title: 'Alex chooses caption preferences', lines: [
      ['Alex', 'My name is Alex. Highlight Alex in the captions.'],
      ['Alex', 'Use large captions and keep separate speaker labels.'],
      ['Sam', 'May I use Sam as my label in our written example?'],
      ['Alex', 'Yes for this fictional example. A real speaker number does not prove who is talking.'],
      ['Alex', 'Do not use sound alone to get my attention.'],
    ] },
    { day: 2, time: '14:20', title: 'Delivery instructions', lines: [
      ['Sam', 'The delivery is expected tomorrow between two and four.'],
      ['Alex', 'Please ask the courier to message me at the door. I might not hear the doorbell.'],
      ['Sam', 'I will ask. That is a plan, not confirmation from the courier.'],
      ['Alex', 'Show me the written confirmation if it arrives.'],
      ['Alex', 'The delivery is for the blue package, not the groceries.'],
    ] },
    { day: 1, time: '16:00', title: 'A meeting changes', lines: [
      ['Sam', 'Alex, the project meeting moved from ten to eleven tomorrow.'],
      ['Alex', 'I read eleven. Is it still in room B?'],
      ['Sam', 'Yes, room B. The online link is unchanged.'],
      ['Alex', 'Please keep the latest time and the room together in my notes.'],
      ['Alex', 'If someone talks over Sam, show uncertainty rather than inventing the missing words.'],
    ] },
    { day: 0, time: '10:00', title: 'Checking what was agreed', lines: [
      ['Sam', 'Your table is ready, Alex.'],
      ['Sam', 'Alex, can you see the captions clearly?'],
      ['Alex', 'Yes. I want the last agreed meeting time, not the older one.'],
      ['Sam', 'Eleven in room B is the latest plan we discussed.'],
      ['Alex', 'And the courier has not confirmed the door message yet.'],
      ['Alex', 'If the watch is disconnected, show the name alert on screen without claiming it buzzed.'],
    ] },
  ] },
  mobility: { persona: 'Jordan', routine: [
    'I use a wheelchair. Ask what help I want before taking over.', 'Please keep assistance suggestions short.', 'Ask me before contacting Morgan, and show the message first.',
  ], scenes: [
    { day: 3, time: '09:30', title: 'Jordan chooses how to ask for help', lines: [
      ['Jordan', 'I use a wheelchair. Ask what help I want before taking over.'],
      ['Morgan', 'Would you like me to be the contact for a help request?'],
      ['Jordan', 'Yes. Ask me before contacting Morgan, and show the message first.'],
      ['Jordan', 'Please keep assistance suggestions short.'],
      ['Jordan', 'A step count does not describe my activity well. Do not treat zero steps as a problem.'],
    ] },
    { day: 2, time: '13:20', title: 'Access at the cafe', lines: [
      ['Jordan', 'I want to meet Morgan at the cafe on Friday at one.'],
      ['Morgan', 'The cafe said the side entrance has step-free access.'],
      ['Jordan', 'That is what they reported. We still need to check the entrance when we arrive.'],
      ['Jordan', 'Please ask the cafe to keep the route clear, but let me review the message.'],
      ['Jordan', 'No message has been sent yet.'],
    ] },
    { day: 1, time: '17:10', title: 'Remembering a specific request', lines: [
      ['Jordan', 'The bag is out of reach on the high shelf. I want Morgan to bring it down.'],
      ['Morgan', 'The blue bag beside the folder?'],
      ['Jordan', 'Yes, the blue bag. Leave the folder where it is.'],
      ['Jordan', 'Do not suggest that I stand up to reach it.'],
      ['Morgan', 'I can come over after my call.'],
    ] },
    { day: 0, time: '11:15', title: 'A help request during the demo', lines: [
      ['Jordan', 'In this fictional demo, I am asking for help with the blue bag.'],
      ['Jordan', 'Please ask Morgan to come over. Prepare a message saying I would like assistance reaching the blue bag.'],
      ['Morgan', 'Show the draft before sending anything.'],
      ['Jordan', 'If a demonstration marks a fall, label it simulated. That is not proof a real fall happened.'],
      ['Jordan', 'I have not reported an injury, and there are no sensor measurements in this example.'],
      ['Jordan', 'What is the next small step based on my request?'],
    ] },
  ] },
};

export function sampleSeed(now = new Date(), accessMode = 'memory') {
  const data = DATA[accessMode];
  if (!data) throw new RangeError('Unknown fictional demonstration mode.');
  const archive = data.scenes.map((scene, index) => {
    let start = new Date(now);
    start.setDate(start.getDate() - scene.day);
    const [h, m] = scene.time.split(':').map(Number);
    start.setHours(h, m, 0, 0);
    if (start.getTime() + scene.lines.length * 12000 > now.getTime()) start = new Date(now.getTime() - scene.lines.length * 12000);
    const lines = scene.lines.map(([speaker, text], n) => ({
      id: `fictional-${accessMode}-${index}-${n}`, sample: true, source: 'fictional',
      at: new Date(start.getTime() + n * 12000).toISOString(), offset: n * 12,
      speakers: [speaker === data.persona ? 0 : 1], speaker, text,
      provider: 'fictional', activity: '', hr: null, marked: false,
    }));
    return { id: `fictional-${accessMode}-session-${index}`, sample: true, title: scene.title,
      startedAt: start.toISOString(), endedAt: new Date(start.getTime() + lines.length * 12000).toISOString(),
      source: 'fictional', device: 'Fictional conversation · written demo', marks: 0, lines };
  });
  const notes = archive.flatMap(session => session.lines.filter(line => line.speaker === data.persona).map(line => ({
    id: line.id, sample: true, source: 'fictional', text: line.text, at: line.at,
    speaker: line.speaker, context: `Fictional ${data.persona} ${accessMode} demo · ${session.title}`,
  })));
  return { version: 2, mode: accessMode, persona: data.persona, demoHealth: syntheticHealth(now),
    archive: archive.slice().reverse(), notes, tasks: [], actions: [], energyLog: [], energy: null, days: {},
    question: DEMO_QUESTIONS[accessMode], routine: data.routine.map(text => `Fictional ${data.persona} preference: ${text}`) };
}

// Illustrative chart inputs; callers keep them separate from measured Health data.
// They are not measurements, clinical scores, or predictions from conversations.
function syntheticHealth(now) {
  const sleep = [7.2, 6.8, 7.6, 6.4, 7.1, 8.0, 7.5, 6.9, 7.8, 7.3, 6.7, 7.4, 8.1, 7.2];
  const steps = [4200, 3800, 5100, 2700, 4600, 6200, 5400, 4100, 5700, 4800, 3600, 5300, 6000, 4500];
  return Object.fromEntries(sleep.map((sleepHours, i) => {
    const date = new Date(now); date.setDate(date.getDate() - (13 - i));
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return [day, { date: day, sample: true, source: 'fictional', provenance: 'Synthetic chart illustration — not device measurements',
      sleep_hours: sleepHours, steps: steps[i], distance_km: Math.round(steps[i] * 0.0006 * 10) / 10,
      walking_steadiness: [86, 84, 87, 82, 85, 88, 86, 83, 87, 85, 82, 86, 88, 84][i],
      resting_heart_rate: [64, 66, 63, 67, 65, 62, 64, 66, 63, 65, 67, 64, 62, 65][i],
      hrv_sdnn: [39, 36, 42, 34, 40, 44, 41, 37, 43, 40, 35, 41, 45, 38][i] }];
  }));
}

// Stable IDs allow the regular app to merge examples without replacing captured or edited items.
export const SEED_VERSION = 4;
export function seedForApp(now = new Date()) {
  const examples = Object.keys(DEMO_QUESTIONS).map(mode => sampleSeed(now, mode));
  const id = value => value.replace(/^fictional-/, 'seeded-');
  const archive = examples.flatMap(seed => seed.archive.map(session => ({
    ...session, id: id(session.id), sample: true, seeded: true, source: 'seeded',
    exampleMode: seed.mode, persona: seed.persona, device: `${seed.persona} · ${seed.mode}`,
    lines: session.lines.map(line => ({ ...line, id: id(line.id), sample: true, seeded: true,
      source: 'seeded', provider: 'seeded', exampleMode: seed.mode, persona: seed.persona })),
  }))).sort((a, b) => b.startedAt.localeCompare(a.startedAt) || a.id.localeCompare(b.id));
  const notes = examples.flatMap(seed => seed.notes.map(note => ({
    ...note, id: id(note.id), sample: true, seeded: true, source: 'seeded',
    exampleMode: seed.mode, persona: seed.persona,
    context: `${seed.persona} · ${seed.mode} · ${note.context.split(' · ').slice(1).join(' · ')}`,
  }))).sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const demoHealth = Object.fromEntries(Object.entries(syntheticHealth(now)).map(([day, value]) => [day, {
    ...value, sample: true, seeded: true, source: 'seeded',
    provenance: 'Seeded chart illustration — not device measurements',
  }]));
  return { version: SEED_VERSION, notes, archive, demoHealth, tasks: [], actions: [],
    questions: { ...DEMO_QUESTIONS },
    routines: Object.fromEntries(examples.map(seed => [seed.mode, [...seed.routine]])) };
}
