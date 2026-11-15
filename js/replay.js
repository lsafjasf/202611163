// 回放：录制物理输入日志 + 引擎事件，按固定步长确定性重放。
import { Game, CONFIG } from './engine.js';

const STORAGE_KEY = 'spotlight-duet/replays';
const MAX_REPLAYS = 6;
const TICK = 1 / 60;

export const CONFLICT_TYPES = ['doubleHit', 'overheat'];

export class ReplayRecorder {
  constructor() {
    this.clear();
  }

  clear() {
    this.startedAt = new Date().toISOString();
    this.mode = 'coop';
    this.swapStart = 0;
    this.inputLog = [];
    this.actions = [];
  }

  setMeta({ mode, swapStart }) {
    if (mode) this.mode = mode;
    if (typeof swapStart === 'number') this.swapStart = swapStart;
  }

  recordInput(t, side, key, pressed) {
    this.inputLog.push({
      t: Number(t.toFixed(3)),
      side,
      key,
      pressed: !!pressed,
    });
  }

  recordAction(t, type) {
    this.actions.push({ t: Number(t.toFixed(3)), type });
  }

  finish(game) {
    const s = game.getState();
    return {
      version: 1,
      startedAt: this.startedAt,
      mode: this.mode,
      swapStart: this.swapStart,
      duration: Number(game.elapsed.toFixed(3)),
      result: {
        phase: s.phase,
        cuesDone: s.cueIndex,
        warnings: s.warnings,
        conflicts: s.conflictCount,
        misses: s.missCount,
      },
      inputLog: this.inputLog,
      actions: this.actions,
      events: game.events.map((e) => ({ ...e })),
    };
  }
}

export function conflictMoments(replay) {
  return replay.events
    .filter((e) => CONFLICT_TYPES.includes(e.type))
    .map((e, i) => ({
      index: i + 1,
      t: e.t,
      type: e.type,
      label: e.type === 'doubleHit' ? '双演员强光警告' : '灯架过热',
    }));
}

export class ReplayPlayer {
  constructor(replay, config = CONFIG) {
    this.replay = replay;
    this.config = config;
    this.game = new Game(config);
    this.game.start();
    this.cursor = 0;
    this.actionCursor = 0;
    this.playTime = 0;
  }

  get duration() {
    return this.replay.duration;
  }

  // 推进到 targetTime（秒），返回当前引擎状态。
  seek(targetTime) {
    const target = Math.max(0, Math.min(targetTime, this.duration));
    while (this.playTime < target - 1e-6) {
      const next = Math.min(this.playTime + TICK, target);
      const dt = next - this.playTime;
      const actions = this.replay.actions || [];
      while (
        this.actionCursor < actions.length &&
        actions[this.actionCursor].t <= next + 1e-6
      ) {
        const act = actions[this.actionCursor];
        if (act.type === 'swap') this.game.swapSides();
        if (act.type === 'debug') this.game.toggleDebug();
        this.actionCursor += 1;
      }
      while (
        this.cursor < this.replay.inputLog.length &&
        this.replay.inputLog[this.cursor].t <= next + 1e-6
      ) {
        const log = this.replay.inputLog[this.cursor];
        this.game.setInput(log.side, log.key, log.pressed);
        this.cursor += 1;
      }
      this.game.step(dt);
      this.playTime = next;
      if (this.game.phase === 'success' || this.game.phase === 'failed') break;
    }
    return this.game.getState();
  }
}

// 存储层可注入（Node 测试传内存对象，浏览器默认 localStorage）。
export function makeStore(storage) {
  const adapter =
    storage ||
    (typeof localStorage !== 'undefined'
      ? localStorage
      : memoryStorage());
  return {
    list() {
      try {
        return JSON.parse(adapter.getItem(STORAGE_KEY) || '[]');
      } catch {
        return [];
      }
    },
    save(replay) {
      const all = this.list();
      all.unshift(replay);
      adapter.setItem(
        STORAGE_KEY,
        JSON.stringify(all.slice(0, MAX_REPLAYS))
      );
      return replay;
    },
    clear() {
      adapter.removeItem(STORAGE_KEY);
    },
  };
}

export function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}
