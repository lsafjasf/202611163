import { CONFIG, EVENT, MATCH, ROUND, TICK_SEC } from './config.js';
import { createInitialState, READY_SEC, resetRoundParts, RESULT_HOLD_SEC } from './state.js';
import { updateClamp } from './clamp.js';
import { moduleAligned, updateModule } from './module.js';
import { emit } from './events.js';

export function createGame(mode = MATCH.COOP) {
  const state = createInitialState(mode);
  state.round.phase = ROUND.READY;
  state.round.index = 0;
  beginMatch(state);
  return state;
}

export function beginMatch(state) {
  state.score.gasketsUsed += 1;
  emit(state, EVENT.GASKET_SPENT, {
    remaining: CONFIG.startingGaskets - state.score.gasketsUsed
  });
}

function startNextRound(state) {
  const total = CONFIG.startingGaskets;
  if (state.score.gasketsUsed >= total) {
    state.mode = MATCH.DEFEAT;
    emit(state, EVENT.MATCH_DEFEAT, { reason: 'no-gasket' });
    return;
  }
  state.round.index += 1;
  state.round.phase = ROUND.READY;
  state.score.gasketsUsed += 1;
  resetRoundParts(state);
  emit(state, EVENT.GASKET_SPENT, { remaining: total - state.score.gasketsUsed });
}

function finishRound(state, success, conflictType) {
  const r = state.round;
  r.phase = success ? ROUND.SUCCESS : ROUND.FAILED;
  r.phaseElapsed = 0;
  r.holdElapsed = 0;
  r.result = success ? 'success' : 'fail';
  r.conflictType = conflictType || null;
  if (success) {
    state.score.wins += 1;
    emit(state, EVENT.ROUND_SUCCESS, { round: r.index + 1 });
    if (state.score.wins >= CONFIG.requiredWins) {
      state.mode = MATCH.VICTORY;
      emit(state, EVENT.MATCH_VICTORY, { wins: state.score.wins });
    }
  } else {
    state.score.fails += 1;
    if (conflictType) state.score.conflicts += 1;
    emit(state, EVENT.ROUND_FAIL, { conflictType });
  }
}

function tryInstall(state, input) {
  if (!input.modulePressPressed) return;
  state.module.pressCount += 1;
  state.module.totalPressCount += 1;
  if (!state.clamp.locked) {
    emit(state, EVENT.CONFLICT_UNLOCKED_INSTALL, {
      pressure: Number(state.clamp.pressure.toFixed(3))
    });
    finishRound(state, false, EVENT.CONFLICT_UNLOCKED_INSTALL);
  } else if (!moduleAligned(state)) {
    emit(state, EVENT.CONFLICT_OFFSET_INSTALL, {
      offset: Number(state.module.offset.toFixed(3))
    });
    finishRound(state, false, EVENT.CONFLICT_OFFSET_INSTALL);
  } else {
    finishRound(state, true, null);
  }
}

// 推进一个固定步长。返回本 tick 是否处于推进状态（暂停时返回 false）。
export function step(state, input, dt = TICK_SEC) {
  if (state.paused) return false;
  if (state.mode === MATCH.VICTORY || state.mode === MATCH.DEFEAT) {
    state.tick += 1;
    return false;
  }

  state.tick += 1;
  state.time = Number((state.time + dt).toFixed(5));
  const r = state.round;
  r.phaseElapsed += dt;

  if (r.phase === ROUND.READY) {
    if (r.phaseElapsed >= READY_SEC) {
      r.phase = ROUND.PLAYING;
      r.phaseElapsed = 0;
    }
    return true;
  }

  if (r.phase === ROUND.SUCCESS || r.phase === ROUND.FAILED) {
    r.holdElapsed += dt;
    if (r.holdElapsed >= RESULT_HOLD_SEC) startNextRound(state);
    return true;
  }

  r.timeLeft = Math.max(0, r.timeLeft - dt);
  const clampDamage = updateClamp(state, input, dt);
  updateModule(state, input, dt);

  if (clampDamage > 0 && state.gasket.health <= 0) {
    emit(state, EVENT.GASKET_CRUSH, {
      pressure: Number(state.clamp.pressure.toFixed(3))
    });
    finishRound(state, false, EVENT.GASKET_CRUSH);
    return true;
  }

  if (r.phase === ROUND.PLAYING) {
    tryInstall(state, input);
  }

  if (r.phase === ROUND.PLAYING && r.timeLeft <= 0) {
    emit(state, EVENT.CONFLICT_TIMEOUT, {
      locked: state.clamp.locked,
      offset: Number(state.module.offset.toFixed(3))
    });
    finishRound(state, false, EVENT.CONFLICT_TIMEOUT);
  }
  state.stationStats.module.pressCount = state.module.totalPressCount;
  return true;
}

export function togglePause(state) {
  if (state.mode === MATCH.VICTORY || state.mode === MATCH.DEFEAT) return state.paused;
  state.paused = !state.paused;
  emit(state, EVENT.PAUSE, { paused: state.paused });
  return state.paused;
}

export function swapSides(state) {
  state.swapped = !state.swapped;
  emit(state, EVENT.SWAP, { swapped: state.swapped });
  return state.swapped;
}

export function setMode(state, mode) {
  if (state.mode === mode) return;
  state.mode = mode;
  emit(state, EVENT.MODE_CHANGE, { mode });
}

// 重开：仪表、共享资源、倒计时、事件全部归零。
export function restart(state, mode = state.mode === MATCH.DEBUG ? MATCH.DEBUG : MATCH.COOP) {
  const next = createGame(mode);
  next.swapped = state.swapped;
  emit(next, EVENT.RESTART, { mode, swapped: next.swapped });
  return next;
}
