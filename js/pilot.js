import { PHYS, COIL_Y } from './constants.js';
import { clamp } from './util.js';

// Each rising waypoint sits below its supporting coil, where gravity alone can
// still pull the ball back if the controller eases off.
export const WAYPOINTS = [0.1, 0.4, 0.66, 0.92, 0.08];

// Commands currents onto the nearest coil (split across neighbours near the
// midpoint) using gravity feed-forward plus PD control toward a waypoint.
export function makeAutoPilot(gain = { kp: 2.2, kd: 0.12 }) {
  let wp = 0;
  return function pilot(state) {
    const target = WAYPOINTS[wp];
    const err = target - state.y;
    const fNeed = state.mass * PHYS.G + gain.kp * err - gain.kd * state.vy;
    distributeForce(state, Math.max(0, fNeed));
    if (Math.abs(err) < 0.02 && Math.abs(state.vy) < 0.08 && wp < WAYPOINTS.length - 1) wp += 1;
    state.waypoint = target;
    state.wpIndex = wp;
  };
}

export function makeManualPilot(fixedCommand = 0) {
  return function pilot(state) {
    for (let k = 0; k < 4; k++) state.command[k] = fixedCommand;
    state.waypoint = null;
  };
}

// Allocate a desired upward force to the nearest coil that lies at/above the
// ball, where magnetic attraction points upward.
function distributeForce(state, fNeed) {
  const gainAt = (idx) => {
    const z = (state.y - COIL_Y[idx]) / PHYS.SIGMA;
    return PHYS.SPRING_K * Math.tanh(-z) * Math.exp(-0.25 * z * z);
  };
  for (let k = 0; k < 4; k++) state.command[k] = 0;
  const gains = COIL_Y.map((_, idx) => Math.max(0, gainAt(idx)))
    .map((g, idx) => ({ idx, g }))
    .filter((e) => e.g > 1e-6)
    .sort((a, b) => b.g - a.g)
    .slice(0, 2);
  const total = gains.reduce((s, e) => s + e.g, 0) || 1e-9;
  for (const e of gains) {
    const share = fNeed * (e.g / total);
    state.command[e.idx] = clamp(Math.sqrt(share / e.g), 0, PHYS.CURRENT_MAX);
  }
}

// Live slider override used by the manual panel (all four coils share a level).
export function sliderPilot(level) {
  return function pilot(state) {
    for (let k = 0; k < 4; k++) state.command[k] = clamp(level, 0, PHYS.CURRENT_MAX);
    state.waypoint = null;
  };
}
