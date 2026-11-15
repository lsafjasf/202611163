import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, EVENT, MATCH, ROUND } from '../src/engine/config.js';
import { createGame, step } from '../src/engine/engine.js';
import { mapInput } from '../src/engine/input.js';
import { ReplayPlayer, ReplayRecorder } from '../src/engine/replay.js';
import {
  clampOnlyInput,
  makeCooperativeBot,
  moduleOnlyInput,
  overPressureInput
} from './helpers/bot.js';

// 最坏情况：5 个垫圈各打满 12s 窗口 + READY/结算保持，约 80s。
function runUntilEnd(state, chooseInput, maxTicks = 60 * 90) {
  const recorder = new ReplayRecorder({ scenario: 'test' });
  let ticks = 0;
  recorder.observe(state);
  while (state.mode !== MATCH.VICTORY && state.mode !== MATCH.DEFEAT && ticks < maxTicks) {
    const input = chooseInput(state);
    step(state, input);
    recorder.observe(state);
    ticks += 1;
  }
  return recorder.finish(state, state.mode);
}

test('协作成功：三名装配完成即胜利，双方仪表与进度同步', () => {
  const state = createGame();
  const replay = runUntilEnd(state, makeCooperativeBot());

  assert.equal(state.mode, MATCH.VICTORY);
  assert.equal(state.score.wins, CONFIG.requiredWins);
  assert.equal(state.score.fails, 0);
  assert.equal(state.score.gasketsUsed, CONFIG.requiredWins);
  assert.ok(state.stationStats.clamp.lockedMs > 0);
  assert.ok(state.stationStats.module.alignedMs > 0);
  assert.equal(state.stationStats.module.pressCount, CONFIG.requiredWins);
  const wins = replay.events.filter((e) => e.type === EVENT.ROUND_SUCCESS);
  assert.equal(wins.length, CONFIG.requiredWins);
});

test('单侧失误：只操作夹具永远无法完成装配，最终超时失败', () => {
  const state = createGame();
  runUntilEnd(state, (s) => clampOnlyInput(s));
  assert.equal(state.mode, MATCH.DEFEAT);
  assert.equal(state.score.wins, 0);
  assert.ok(state.score.conflicts >= 1);
  assert.ok(state.events.some((e) => e.type === EVENT.CONFLICT_TIMEOUT));
});

test('单侧失误：只操作模块会在夹具未锁稳时触发偏移/未锁冲突', () => {
  const state = createGame();
  runUntilEnd(state, (s) => moduleOnlyInput(s));
  assert.equal(state.mode, MATCH.DEFEAT);
  assert.ok(
    state.events.some((e) => e.type === EVENT.CONFLICT_UNLOCKED_INSTALL) ||
    state.events.some((e) => e.type === EVENT.CONFLICT_TIMEOUT)
  );
});

test('恢复：先压坏一个垫圈，后续三组成功后仍可胜利', () => {
  const state = createGame();
  const coop = makeCooperativeBot();
  runUntilEnd(state, (s) => {
    if (s.round.index === 0) return overPressureInput(s);
    return coop(s);
  });

  assert.equal(state.mode, MATCH.VICTORY);
  assert.equal(state.score.wins, CONFIG.requiredWins);
  assert.equal(state.score.fails, 1);
  assert.equal(state.score.gasketsUsed, CONFIG.requiredWins + 1);
  assert.ok(state.events.some((e) => e.type === EVENT.GASKET_CRUSH));
});

test('压力过大直接压坏垫圈并计入冲突', () => {
  const state = createGame();
  runUntilEnd(state, (s) => overPressureInput(s));
  assert.equal(state.mode, MATCH.DEFEAT);
  const crushes = state.events.filter((e) => e.type === EVENT.GASKET_CRUSH);
  assert.ok(crushes.length >= 2);
});
