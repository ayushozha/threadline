export const ACCESS_MODES = {
  memory: { label: 'Memory', description: 'Recover a stated plan and the last mentioned location. Ask when the next step is uncertain.', question: 'What was I doing? Use my saved words and say what is uncertain.' },
  sight: { label: 'Sight', description: 'Describe visible objects and read text. Scene descriptions are not safe-navigation or medication instructions.', question: 'What is in front of me? Describe the scene and quote visible text.' },
  hearing: { label: 'Hearing', description: 'Large live captions, anonymous speaker labels and an optional name cue. Sound recognition can miss events.', question: 'Transcribe what is being said and describe clear audible events without guessing.' },
  mobility: { label: 'Mobility', description: 'Keep access preferences, review measured movement and prepare an assistance request. No fall-risk prediction.', question: 'What help did I ask for, and what is one useful next step?' },
};

// Firmware has single and double tap events, not a native triple-tap event.
// Allow either three single events or a double event followed by a single.
export function createTapGesture(onGesture, { windowMs = 700, clock = () => Date.now(), later = setTimeout, cancel = clearTimeout } = {}) {
  let count = 0, started = 0, timer;
  return {
    push(kind) {
      const now = clock();
      if (!count || now - started > windowMs) { count = 0; started = now; }
      count = kind === 'double' ? Math.max(count, 2) : count + 1;
      cancel(timer);
      if (count >= 3) { count = 0; onGesture('sos'); }
      else timer = later(() => { const value = count; count = 0; if (value === 2) onGesture('double'); }, windowMs);
    },
    clear() { cancel(timer); count = 0; },
  };
}
