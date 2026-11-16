// Three reproducible scenarios: normal input, boundary input, corrupted
// input. Each provides a raw recorded input trajectory plus frame-delta
// patterns that emulate different refresh rates over the same time span.

import { LIMITS } from './physics.js';
import { steadyPattern, jitterPattern } from './rng.js';

const A = LIMITS.maxInputAccel;

function normalTrack() {
  const track = [];
  for (let i = 0; i <= 16; i += 1) {
    const t = i * 0.5;
    const ax = Math.round(Math.sin(i * 0.9) * 0.7 * A);
    track.push({ t, ax });
  }
  return track;
}

function boundaryTrack(duration) {
  return [
    { t: 0, ax: A },                 // exactly +max
    { t: 0.75, ax: -A },             // exactly -max
    { t: 1.5, ax: 0 },
    { t: 2.25, ax: A - 1e-9 },       // just inside the limit
    { t: 3.0, ax: -A },
    { t: duration, ax: 0 },          // exactly at the end timestamp
  ];
}

function corruptedTrack() {
  return [
    { t: 0, ax: 300 },
    { t: 0.5, ax: NaN },             // non-finite accel -> recover with 0
    { t: 1.0, ax: -300 },
    'not-an-entry',                  // wrong type -> drop
    { t: 1.5 },                      // missing ax -> recover with 0
    { t: 1.2, ax: 100 },             // out-of-order timestamp -> drop
    { t: 2.0, ax: 1e9 },             // out of range -> clamp
    { t: 2.5, ax: 'fast' },          // wrong field type -> recover with 0
    { t: -4, ax: 50 },               // negative time -> drop
    { t: 3.0, ax: -300 },
    { t: 4.0, ax: 250 },
    { t: 5.0, ax: 0 },
  ];
}

export const SCENARIOS = Object.freeze({
  normal: {
    id: 'normal',
    label: '正常输入',
    duration: 8,
    seed: 20261116,
    initial: {},
    rawTrack: normalTrack(),
  },
  boundary: {
    id: 'boundary',
    label: '边界输入',
    duration: 6,
    seed: 77031,
    initial: { x: LIMITS.ballRadius + 0.5, y: LIMITS.ballRadius + 1, vx: 0, vy: 0 },
    rawTrack: boundaryTrack(6),
  },
  corrupted: {
    id: 'corrupted',
    label: '损坏输入',
    duration: 6,
    seed: 90917,
    initial: {},
    rawTrack: corruptedTrack(),
  },
});

// Frame patterns emulating 60 Hz (reference), 30 Hz, 144 Hz and a seeded
// jittery display — all covering exactly duration seconds.
export function framePatternsFor(scenario) {
  const totalMs = scenario.duration * 1000;
  return {
    hz60: steadyPattern(60, totalMs),
    hz30: steadyPattern(30, totalMs),
    hz144: steadyPattern(144, totalMs),
    jitter: jitterPattern(scenario.seed, totalMs),
  };
}
