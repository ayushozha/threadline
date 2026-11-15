// Feed finalized fragments only. Every returned candidate keeps its first fragment's metadata.
export function createUtteranceCollector(key = segment => segment.speaker) {
  let current = null, currentKey;
  const flush = () => {
    const result = current;
    current = null;
    currentKey = undefined;
    return result;
  };
  return {
    push(segment, end = false) {
      const ready = [], text = typeof segment?.text === 'string' ? segment.text.trim() : '';
      if (text) {
        const nextKey = key(segment);
        if (current && (!Object.is(currentKey, nextKey) || current.text.length + text.length + 1 > 3800)) ready.push(flush());
        if (current) {
          current.text += ` ${text}`;
          if (segment.lineIds) current.lineIds = [...new Set([...(current.lineIds || []), ...segment.lineIds])];
        } else {
          current = { ...segment, text };
          if (segment.lineIds) current.lineIds = [...new Set(segment.lineIds)];
          currentKey = nextKey;
        }
      }
      if (end && current) ready.push(flush());
      return ready;
    },
    flush,
    reset() { current = null; currentKey = undefined; },
  };
}

// The bound covers waiting work; at most one additional item is running.
// clear() cannot cancel the worker already running: callers own session/generation checks.
export function createSerialQueue(worker, { max = 100, onError = () => {} } = {}) {
  if (!Number.isInteger(max) || max < 1) throw new RangeError('max must be a positive integer');
  const pending = [];
  let running = false;
  async function drain() {
    if (running) return;
    running = true;
    while (pending.length) {
      const item = pending.shift();
      try { await worker(item); }
      catch (error) {
        try { await onError(error, item); } catch { /* A reporting error must not lose later work. */ }
      }
    }
    running = false;
  }
  return {
    enqueue(item) {
      if (pending.length >= max) return false;
      pending.push(item);
      void drain();
      return true;
    },
    clear() { const count = pending.length; pending.length = 0; return count; },
    get length() { return pending.length; },
    get running() { return running; },
  };
}
