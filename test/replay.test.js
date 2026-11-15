import test from 'node:test';
import assert from 'node:assert/strict';
import { EVENT, MATCH } from '../src/engine/config.js';
import { createGame, step } from '../src/engine/engine.js';
import { makeCooperativeBot, overPressureInput } from './helpers/bot.js';
import {
  ReplayPlayer,
  ReplayRecorder,
  listReplays,
  saveReplay
} from '../src/engine/replay.js';

function recordGame(chooseInput) {
  const state = createGame();
  const recorder = new ReplayRecorder({ scenario: 'replay-test' });
  let ticks = 0;
  recorder.observe(state);
  while (state.mode !== MATCH.VICTORY && state.mode !== MATCH.DEFEAT && ticks < 60 * 90) {
    step(state, chooseInput(state));
    recorder.observe(state);
    ticks += 1;
  }
  return { state, replay: recorder.finish(state, state.mode) };
}

test('完整回放保留每次冲突发生的时刻并可跳转', () => {
  const { replay } = recordGame((s) =>
    s.round.index === 0 ? overPressureInput(s) : makeCooperativeBot()(s)
  );
  const crushEvents = replay.events.filter((e) => e.type === EVENT.GASKET_CRUSH);
  assert.ok(crushEvents.length >= 1);
  assert.ok(replay.conflictTicks.includes(crushEvents[0].tick));

  const player = new ReplayPlayer(replay);
  player.seekTick(0);
  assert.equal(player.cursorTick, 0);

  const hit = player.nextConflict();
  assert.ok(hit);
  assert.equal(hit.type, EVENT.GASKET_CRUSH);
  assert.equal(player.cursorTick, hit.tick);
  assert.equal(player.currentState.round.conflictType, EVENT.GASKET_CRUSH);

  player.seekTime(replay.durationSec);
  assert.equal(player.playing, false);
});

test('回放推进到末尾自动停止，事件可按 tick 读取', () => {
  const { replay } = recordGame(makeCooperativeBot());
  const player = new ReplayPlayer(replay);
  player.playing = true;
  player.advance(replay.durationSec + 1);
  assert.equal(player.playing, false);
  assert.equal(player.cursorTick, player.length);

  const successTick = replay.events.find((e) => e.type === EVENT.ROUND_SUCCESS).tick;
  player.seekTick(successTick);
  assert.ok(player.eventsAtCursor.some((e) => e.type === EVENT.ROUND_SUCCESS));
});

test('回放可持久化到 localStorage 并重新读取', () => {
  const mem = new Map();
  const storage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, v)
  };
  const { replay } = recordGame(makeCooperativeBot());
  saveReplay(replay, storage);
  const loaded = listReplays(storage);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].events.length, replay.events.length);
  assert.ok(loaded[0].snapshots.length > 1);
});

test('上一条/下一条冲突导航在边界处安全返回 null', () => {
  const { replay } = recordGame(makeCooperativeBot());
  const player = new ReplayPlayer(replay);
  assert.equal(player.prevConflict(), null);
  player.seekTick(player.length);
  assert.equal(player.nextConflict(), null);
});
