import { CONFIG, TICK_SEC } from './config.js';

const clampRange = (v, limit) => Math.max(-limit, Math.min(limit, v));

// 右侧工位：上部模块。玩家左右移动模块来抵消随机偏移，并在对准时压装。
export function updateModule(state, input, dt = TICK_SEC) {
  const m = CONFIG.module;
  const mod = state.module;
  const t = state.time;

  let move = 0;
  if (input.moduleLeft) move -= m.moveSpeed;
  if (input.moduleRight) move += m.moveSpeed;
  const wander = m.wanderAmp * Math.sin(2 * Math.PI * m.wanderFreq * t + m.wanderPhase);
  mod.offset = clampRange(mod.offset + (move + wander) * dt, m.alignLimit);

  const aligned = Math.abs(mod.offset) <= m.alignTolerance;
  if (aligned) mod.alignedTicks += 1;
  state.stationStats.module.alignedMs = (mod.alignedTicks / CONFIG.tickHz) * 1000;

  mod.pressing = Boolean(input.modulePressHeld);
  if (mod.pressing) {
    state.gasket.health = Math.max(
      0,
      state.gasket.health - m.pressGasketRate * dt
    );
  }
  return aligned;
}

export function moduleAligned(state) {
  return Math.abs(state.module.offset) <= CONFIG.module.alignTolerance;
}
