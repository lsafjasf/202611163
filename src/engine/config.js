// 全部可调参数集中在此，引擎/渲染/测试共享同一份数值。
export const CONFIG = {
  tickHz: 60,
  roundTimeSec: 12,
  requiredWins: 3,
  startingGaskets: 5,

  clamp: {
    holdGain: 0.55,       // 按住加压时每秒增量
    releaseGain: 0.7,     // 按住泄压时每秒减量
    driftAmp: 0.16,       // 被动漂移幅度
    driftFreq: 0.7,       // 被动漂移频率（确定性正弦）
    driftPhase: 1.1,
    stableMin: 0.45,
    stableMax: 0.72,
    lockDwellSec: 0.45,   // 稳定区保持多久才算夹具锁稳
    crushThreshold: 0.92, // 超过此压力开始损伤垫圈
    crushRate: 0.5        // 每秒垫圈伤害（满压附近）
  },

  module: {
    moveSpeed: 1.05,
    wanderAmp: 0.22,
    wanderFreq: 1.3,
    wanderPhase: 0.4,
    alignLimit: 1,
    alignTolerance: 0.55, // |offset| 小于该值视为对准
    pressPower: 0.85,
    pressGasketRate: 0.35
  },

  replay: {
    snapshotEveryTicks: 15, // 0.25s 一帧状态快照
    maxReplays: 12
  },

  // 逻辑工位固定在左/右；玩家通过 swapped 交换各自负责的工位。
  stations: { left: 'clamp', right: 'module' },

  keymap: {
    // 玩家 1：默认负责左侧夹具；交换后负责右侧模块。
    p1Clamp: { up: 'KeyW', down: 'KeyS' },
    p1Module: { left: 'KeyF', right: 'KeyG', press: 'KeyV' },
    // 玩家 2：默认负责右侧模块；交换后负责左侧夹具。
    p2Module: { left: 'ArrowLeft', right: 'ArrowRight', press: 'Enter' },
    p2Clamp: { up: 'ArrowUp', down: 'ArrowDown' },
    system: {
      pause: ['KeyP', 'Escape'],
      restart: 'KeyR',
      swap: 'Tab',
      debug: 'KeyD',
      replay: 'KeyL'
    }
  }
};

export const TICK_SEC = 1 / CONFIG.tickHz;

export const ROUND = {
  READY: 'ready',
  PLAYING: 'playing',
  SUCCESS: 'success',
  FAILED: 'failed'
};

export const MATCH = {
  COOP: 'coop',
  DEBUG: 'debug',
  VICTORY: 'victory',
  DEFEAT: 'defeat'
};

// 所有会进入回放时间线的冲突/关键事件类型。
export const EVENT = {
  CONFLICT_UNLOCKED_INSTALL: 'unlocked-install',
  CONFLICT_OFFSET_INSTALL: 'offset-install',
  CONFLICT_TIMEOUT: 'round-timeout',
  GASKET_CRUSH: 'gasket-crush',
  GASKET_SPENT: 'gasket-spent',
  ROUND_SUCCESS: 'round-success',
  ROUND_FAIL: 'round-fail',
  MATCH_VICTORY: 'match-victory',
  MATCH_DEFEAT: 'match-defeat',
  SWAP: 'side-swap',
  PAUSE: 'pause',
  RESTART: 'restart',
  MODE_CHANGE: 'mode-change'
};
