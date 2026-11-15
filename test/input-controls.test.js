import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, EVENT, MATCH } from '../src/engine/config.js';
import { createGame, restart, step, swapSides, togglePause } from '../src/engine/engine.js';
import { mapInput } from '../src/engine/input.js';

const K = CONFIG.keymap;

test('协作模式下任何单一玩家都不能同时操作两个工位', () => {
  // 玩家 1 只按自己的键：默认只能控制夹具。
  const p1Keys = new Set([K.p1Clamp.up, K.p1Module.left, K.p1Module.press]);
  const p1 = mapInput(p1Keys, false, false);
  assert.equal(p1.clampUp, true);
  assert.equal(p1.moduleLeft, false);
  assert.equal(p1.modulePressHeld, false);

  // 玩家 2 只按自己的键：默认只能控制模块。
  const p2Keys = new Set([K.p2Clamp.up, K.p2Module.left, K.p2Module.press]);
  const p2 = mapInput(p2Keys, false, false);
  assert.equal(p2.moduleLeft, true);
  assert.equal(p2.modulePressHeld, true);
  assert.equal(p2.clampUp, false);
});

test('换边后两名玩家的控制职责对调，但仍不能跨工位操作', () => {
  const p1Keys = new Set([K.p1Clamp.up, K.p1Module.left]);
  const swappedP1 = mapInput(p1Keys, true, false);
  assert.equal(swappedP1.clampUp, false);
  assert.equal(swappedP1.moduleLeft, true);

  const p2Keys = new Set([K.p2Clamp.up, K.p2Module.left]);
  const swappedP2 = mapInput(p2Keys, true, false);
  assert.equal(swappedP2.clampUp, true);
  assert.equal(swappedP2.moduleLeft, false);

  const state = createGame();
  swapSides(state);
  assert.equal(state.swapped, true);
  assert.ok(state.events.some((e) => e.type === EVENT.SWAP));
});

test('单人调试模式允许同一组键操作两个工位', () => {
  const keys = new Set([
    K.p1Clamp.up,
    K.p1Clamp.down,
    K.p1Module.left,
    K.p1Module.right,
    K.p1Module.press
  ]);
  const input = mapInput(keys, false, true);
  assert.equal(input.clampUp, true);
  assert.equal(input.moduleLeft, true);
  assert.equal(input.modulePressHeld, true);
});

test('同时按下两名玩家的键不会互相覆盖（键盘并发输入）', () => {
  const keys = new Set([
    K.p1Clamp.up,
    K.p2Module.right,
    K.p2Module.press
  ]);
  const input = mapInput(keys, false, false);
  assert.equal(input.clampUp, true);
  assert.equal(input.moduleRight, true);
  assert.equal(input.modulePressHeld, true);
});

test('暂停冻结时间轴，恢复后继续推进', () => {
  const state = createGame();
  const idle = {
    clampUp: false, clampDown: false, moduleLeft: false,
    moduleRight: false, modulePressHeld: false, modulePressPressed: false
  };
  for (let i = 0; i < 150; i += 1) step(state, idle);
  const timeBefore = state.time;
  togglePause(state);
  assert.equal(state.paused, true);
  for (let i = 0; i < 60; i += 1) step(state, idle);
  assert.equal(state.time, timeBefore);
  togglePause(state);
  for (let i = 0; i < 30; i += 1) step(state, idle);
  assert.ok(state.time > timeBefore);
});

test('重开后仪表、共享资源、倒计时、事件与音效状态同时复位', () => {
  const state = createGame();
  const idle = {
    clampUp: false, clampDown: false, moduleLeft: false,
    moduleRight: false, modulePressHeld: false, modulePressPressed: false
  };
  for (let i = 0; i < 200; i += 1) step(state, idle);
  assert.ok(state.time > 0);

  const next = restart(state, MATCH.COOP);
  assert.equal(next.time, 0);
  assert.equal(next.tick, 0);
  assert.equal(next.score.wins, 0);
  assert.equal(next.score.gasketsUsed, 1); // 首轮重新消耗一个垫圈
  assert.equal(next.round.timeLeft, CONFIG.roundTimeSec);
  assert.equal(next.clamp.pressure, 0.25);
  assert.equal(next.module.offset, 0.75);
  assert.equal(next.gasket.health, 1);
  assert.equal(next.paused, false);
  assert.equal(next.stationStats.module.pressCount, 0);
  assert.ok(next.events.some((e) => e.type === EVENT.RESTART));
  assert.notEqual(next, state);
});
