import { CONFIG, MATCH } from './config.js';
import { createInitialState } from './state.js';
import { isConflict } from './events.js';

const clone = (v) => JSON.parse(JSON.stringify(v));

// 录制：每 N tick 存一份完整状态快照，事件全量保留，
// 回放时可按时间精确定位（含每次冲突发生的时刻）。
export class ReplayRecorder {
  constructor(meta = {}) {
    this.meta = {
      startedAt: new Date().toISOString(),
      ...meta
    };
    this.snapshots = [];
    this.events = [];
    this.lastEventCount = 0;
    this.lastPhase = null;
    this.lastRoundIndex = -1;
  }

  observe(state) {
    if (state.events.length > this.lastEventCount) {
      for (const event of state.events.slice(this.lastEventCount)) {
        this.events.push(clone(event));
      }
      this.lastEventCount = state.events.length;
    }
    const phaseChanged =
      state.round.phase !== this.lastPhase ||
      state.round.index !== this.lastRoundIndex;
    if (state.tick % CONFIG.replay.snapshotEveryTicks === 0 ||
        state.tick <= 1 || phaseChanged) {
      this.snapshots.push({
        tick: state.tick,
        time: state.time,
        state: clone(state)
      });
    }
    this.lastPhase = state.round.phase;
    this.lastRoundIndex = state.round.index;
  }

  finish(state, outcome) {
    this.observe(state);
    this.snapshots.push({
      tick: state.tick,
      time: state.time,
      state: clone(state)
    });
    const events = clone(this.events);
    return {
      schemaVersion: 1,
      meta: { ...this.meta, finishedAt: new Date().toISOString(), outcome },
      tickHz: CONFIG.tickHz,
      durationSec: state.time,
      events,
      conflictTicks: events.filter((e) => isConflict(e.type)).map((e) => e.tick),
      snapshots: this.snapshots
    };
  }
}

function findSnapshot(snapshots, tick) {
  let best = snapshots[0];
  for (const snap of snapshots) {
    if (snap.tick <= tick) best = snap;
    else break;
  }
  return best;
}

export class ReplayPlayer {
  constructor(replay) {
    this.replay = replay;
    this.length = replay.snapshots[replay.snapshots.length - 1].tick;
    this.cursorTick = 0;
    this.playing = false;
    this.speed = 1;
  }

  get currentState() {
    return findSnapshot(this.replay.snapshots, this.cursorTick).state;
  }

  get eventsAtCursor() {
    return this.replay.events.filter((e) => e.tick === this.cursorTick);
  }

  seekTick(tick) {
    this.cursorTick = Math.max(0, Math.min(this.length, Math.round(tick)));
    return this.currentState;
  }

  seekTime(sec) {
    return this.seekTick(Math.round(sec * this.replay.tickHz));
  }

  nextConflict() {
    const hit = this.replay.events.find(
      (e) => isConflict(e.type) && e.tick > this.cursorTick
    );
    if (hit) this.seekTick(hit.tick);
    return hit || null;
  }

  prevConflict() {
    const hits = this.replay.events.filter(
      (e) => isConflict(e.type) && e.tick < this.cursorTick
    );
    const hit = hits[hits.length - 1];
    if (hit) this.seekTick(hit.tick);
    return hit || null;
  }

  advance(realDt) {
    if (!this.playing) return null;
    this.cursorTick += realDt * this.replay.tickHz * this.speed;
    if (this.cursorTick >= this.length) {
      this.cursorTick = this.length;
      this.playing = false;
    }
    return this.currentState;
  }
}

const STORAGE_KEY = 'duo-assembly-replays';

export function saveReplay(replay, storage = globalThis.localStorage) {
  if (!storage) return replay;
  const list = listReplays(storage);
  list.unshift(replay);
  storage.setItem(
    STORAGE_KEY,
    JSON.stringify(list.slice(0, CONFIG.replay.maxReplays))
  );
  return replay;
}

export function listReplays(storage = globalThis.localStorage) {
  if (!storage) return [];
  try {
    return JSON.parse(storage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

export function emptyReplay() {
  return {
    schemaVersion: 1,
    meta: {},
    tickHz: CONFIG.tickHz,
    durationSec: 0,
    events: [],
    conflictTicks: [],
    snapshots: [{ tick: 0, time: 0, state: createInitialState(MATCH.COOP) }]
  };
}

