import { CONFIG, MATCH, ROUND } from './config.js';

export const READY_SEC = 2;
export const RESULT_HOLD_SEC = 1.6;

export function createRound() {
  return {
    index: 0,
    phase: ROUND.READY,
    phaseElapsed: 0,
    timeLeft: CONFIG.roundTimeSec,
    result: null,
    conflictType: null,
    holdElapsed: 0
  };
}

export function createInitialState(mode = MATCH.COOP) {
  return {
    schemaVersion: 1,
    mode,
    paused: false,
    time: 0,
    tick: 0,
    swapped: false,

    round: createRound(),

    clamp: {
      pressure: 0.25,
      locked: false,
      lockProgress: 0,
      stableTicks: 0
    },

    module: {
      offset: 0.75,
      pressing: false,
      pressCount: 0,
      totalPressCount: 0,
      alignedTicks: 0
    },

    gasket: { health: 1 },

    score: {
      wins: 0,
      fails: 0,
      gasketsTotal: CONFIG.startingGaskets,
      gasketsUsed: 0,
      conflicts: 0
    },

    // 每个工位自己的仪表读数，供两侧 HUD 分别显示。
    stationStats: {
      clamp: { ticks: 0, stableTicks: 0, lockedMs: 0, stableRatio: 0 },
      module: { alignedMs: 0, pressCount: 0 }
    },

    events: []
  };
}

export function resetRoundParts(state) {
  state.clamp.pressure = 0.25;
  state.clamp.locked = false;
  state.clamp.lockProgress = 0;
  state.module.offset = 0.75;
  state.module.pressing = false;
  state.module.alignedTicks = 0;
  state.gasket.health = 1;
  state.round.phaseElapsed = 0;
  state.round.holdElapsed = 0;
  state.round.timeLeft = CONFIG.roundTimeSec;
  state.round.result = null;
  state.round.conflictType = null;
}

