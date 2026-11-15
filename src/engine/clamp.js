import { CONFIG, TICK_SEC } from './config.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// 左侧工位：底座夹具。玩家通过加压/泄压把压力维持在稳定区间，
// 持续在稳定区内保持 dwell 时长后夹具才“锁稳”。
export function updateClamp(state, input, dt = TICK_SEC) {
  const c = CONFIG.clamp;
  const clamp = state.clamp;
  const t = state.time;

  let force = 0;
  if (input.clampUp) force += c.holdGain;
  if (input.clampDown) force -= c.releaseGain;
  force += c.driftAmp * Math.sin(2 * Math.PI * c.driftFreq * t + c.driftPhase);
  clamp.pressure = clamp01(clamp.pressure + force * dt);

  const stable = clamp.pressure >= c.stableMin && clamp.pressure <= c.stableMax;
  if (stable) {
    clamp.lockProgress = Math.min(1, clamp.lockProgress + dt / c.lockDwellSec);
  } else {
    clamp.lockProgress = Math.max(0, clamp.lockProgress - dt * 1.4);
  }
  clamp.locked = clamp.lockProgress >= 1;

  const stats = state.stationStats.clamp;
  stats.ticks += 1;
  if (stable) stats.stableTicks += 1;
  if (clamp.locked) stats.lockedMs += dt * 1000;
  stats.stableRatio = stats.stableTicks / stats.ticks;

  // 压力过大会压坏垫圈。
  if (clamp.pressure > c.crushThreshold) {
    const severity = (clamp.pressure - c.crushThreshold) / (1 - c.crushThreshold);
    const damage = c.crushRate * severity * dt;
    state.gasket.health = clamp01(state.gasket.health - damage);
    return damage;
  }
  return 0;
}

export function clampStable(state) {
  const c = CONFIG.clamp;
  return state.clamp.pressure >= c.stableMin && state.clamp.pressure <= c.stableMax;
}
