import { PHYS, COIL_Y } from './constants.js';

// Deterministic PRNG (mulberry32) so repeated runs with identical parameters
// produce bit-identical disturbance streams.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Axial magnetic force from one coil (positive = upward).
// Attraction toward the coil centre, saturating smoothly near the centre so a
// coil directly above the ball keeps supporting it:
// f(y) = K * i^2 * tanh((yc-y)/sigma) * exp(-((y-yc)/(2 sigma))^2)
export function coilForce(i, y, yc) {
  const z = (y - yc) / PHYS.SIGMA;
  return PHYS.SPRING_K * i * i * Math.tanh(-z) * Math.exp(-0.25 * z * z);
}

// Sum of axial forces and per-coil contributions (for force-arrow display).
export function magneticSummary(state) {
  let total = 0;
  const parts = COIL_Y.map((yc, idx) => {
    const f = coilForce(state.current[idx], state.y, yc);
    total += f;
    return { yc, force: f, current: state.current[idx] };
  });
  return { total, parts };
}

// Gaussian-ish disturbance from two uniform samples; deterministic per step.
export function disturbance(rng, amplitude) {
  const u = rng() + rng() - 1;
  return amplitude * u;
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function celsius(kelvin) {
  return kelvin - 273.15;
}

export function format(v, digits = 3) {
  if (!Number.isFinite(v)) return '—';
  return v.toFixed(digits);
}
