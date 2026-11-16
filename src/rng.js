// Seeded RNG and deterministic frame-delta patterns so that every
// scenario (including failure cases) is exactly reproducible.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A frame pattern is an array of frame deltas in milliseconds whose sum
// equals `totalMs`, so runs at different "refresh rates" cover identical
// simulated spans and can be compared fairly.
export function steadyPattern(hz, totalMs) {
  const delta = 1000 / hz;
  const count = Math.round(totalMs / delta);
  const frames = new Array(count).fill(delta);
  frames[count - 1] += totalMs - delta * count; // force exact total
  return frames;
}

export function jitterPattern(seed, totalMs, minMs = 8, maxMs = 33) {
  const rand = mulberry32(seed);
  const frames = [];
  let acc = 0;
  while (acc < totalMs) {
    const d = minMs + rand() * (maxMs - minMs);
    frames.push(d);
    acc += d;
  }
  frames[frames.length - 1] -= acc - totalMs; // force exact total
  return frames;
}
