import test from 'node:test';
import assert from 'node:assert/strict';
import { MATCH } from '../src/engine/config.js';
import { createGame, step, togglePause } from '../src/engine/engine.js';
import { makeCooperativeBot } from './helpers/bot.js';

const idle = () => ({
  clampUp: false,
  clampDown: false,
  moduleLeft: false,
  moduleRight: false,
  modulePressHeld: false,
  modulePressPressed: false
});

test('胜利/失败后时间轴不再推进，暂停切换被忽略', () => {
  const state = createGame();
  const bot = makeCooperativeBot();
  let guard = 0;
  while (state.mode !== MATCH.VICTORY && guard < 60 * 90) {
    step(state, bot(state));
    guard += 1;
  }
  const frozenTime = state.time;
  for (let i = 0; i < 120; i += 1) step(state, idle());
  assert.equal(state.time, frozenTime);
  assert.equal(state.mode, MATCH.VICTORY);
  assert.equal(state.score.wins, 3);
  assert.equal(togglePause(state), false);
  assert.equal(state.paused, false);
});

test('调试模式与协作模式使用完全相同的物理参数', async () => {
  const { CONFIG } = await import('../src/engine/config.js');
  const coop = createGame(MATCH.COOP);
  const debug = createGame(MATCH.DEBUG);
  assert.equal(coop.clamp.pressure, debug.clamp.pressure);
  assert.equal(coop.round.timeLeft, debug.round.timeLeft);
  assert.equal(coop.gasket.health, debug.gasket.health);
  assert.ok(CONFIG.requiredWins === 3);
});

test('READY 阶段不接受压装，必须等待动作窗口开启', () => {
  const state = createGame();
  const input = idle();
  input.modulePressHeld = true;
  input.modulePressPressed = true;
  for (let i = 0; i < 60; i += 1) step(state, input);
  assert.equal(state.module.totalPressCount, 0);
  assert.equal(state.score.wins, 0);
});
