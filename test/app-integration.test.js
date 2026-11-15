import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, EVENT, MATCH, TICK_SEC } from '../src/engine/config.js';
import { AssemblyApp } from '../src/web/app.js';
import {
  FakeAudioContext,
  installBrowserFakes,
  makeFakeCanvas
} from './helpers/fake-dom.js';
import { makeCooperativeBot } from './helpers/bot.js';

function keyEvent(code, type = 'keydown') {
  return { code, type, preventDefault() {} };
}

let app;
function appFrame(times = 1) {
  for (let i = 0; i < times; i += 1) app.frame(TICK_SEC);
}

describe('应用层集成（串行，共享 fake DOM）', { concurrency: false }, () => {
test('暂停/重开通过真实键盘事件生效，重开同时重建音频上下文', () => {
  const { target } = installBrowserFakes();
  const localApp = new AssemblyApp(makeFakeCanvas());
  app = localApp;
  appFrame(120);
  const timeBefore = app.state.time;
  assert.ok(timeBefore > 0);

  target.dispatch(keyEvent('KeyP'));
  appFrame(60);
  assert.equal(app.state.paused, true);
  assert.equal(app.state.time, timeBefore);
  target.dispatch({ code: 'KeyP', type: 'keyup' });

  target.dispatch(keyEvent('KeyR'));
  app.frame(TICK_SEC); // 仅处理重开动作，断言在任何推进前完成
  assert.equal(app.state.time, 0);
  assert.equal(app.state.paused, false);
  assert.equal(app.state.score.wins, 0);
  assert.equal(app.state.gasket.health, 1);
  target.dispatch({ code: 'KeyR', type: 'keyup' });
  appFrame(5);
  assert.ok(app.state.time > 0);
  // 旧 AudioContext 被关闭，复位后首次动作会创建新上下文。
  assert.ok(FakeAudioContext.instances.some((c) => c.closed));
});

test('两名玩家同时按键被合并为同一帧的双工位输入', () => {
  const { target } = installBrowserFakes();
  app = new AssemblyApp(makeFakeCanvas());
  target.dispatch(keyEvent('KeyW'));       // 玩家1 加压
  target.dispatch(keyEvent('ArrowRight')); // 玩家2 右移
  target.dispatch(keyEvent('Enter'));      // 玩家2 压装
  const sampled = app.input.sample(app.state);
  assert.equal(sampled.clampUp, true);
  assert.equal(sampled.moduleRight, true);
  assert.equal(sampled.modulePressHeld, true);
});

test('Tab 交换两名玩家的控制侧并写入回放事件', () => {
  const { target } = installBrowserFakes();
  app = new AssemblyApp(makeFakeCanvas());
  target.dispatch(keyEvent('Tab'));
  appFrame(1);
  assert.equal(app.state.swapped, true);
  assert.ok(app.state.events.some((e) => e.type === EVENT.SWAP));

  target.dispatch(keyEvent('KeyW')); // 换边后 W 属于玩家1 的夹具组，应被忽略
  const input = app.input.sample(app.state);
  assert.equal(input.clampUp, false);
  target.dispatch(keyEvent('ArrowUp')); // 玩家2 现在管夹具
  const input2 = app.input.sample(app.state);
  assert.equal(input2.clampUp, true);
});

test('D 切换单人调试模式，同一玩家可操作两个工位', () => {
  const { target } = installBrowserFakes();
  app = new AssemblyApp(makeFakeCanvas());
  target.dispatch(keyEvent('KeyD'));
  appFrame(1);
  assert.equal(app.state.mode, MATCH.DEBUG);

  target.dispatch(keyEvent('KeyW'));
  target.dispatch(keyEvent('KeyF'));
  target.dispatch(keyEvent('KeyV'));
  const input = app.input.sample(app.state);
  assert.equal(input.clampUp, true);
  assert.equal(input.moduleLeft, true);
  assert.equal(input.modulePressHeld, true);
});

test('完整对局结束后自动保存一份可查看的回放', () => {
  const { storage } = installBrowserFakes();
  app = new AssemblyApp(makeFakeCanvas());
  const bot = makeCooperativeBot();
  let guard = 0;
  while (app.state.mode !== MATCH.VICTORY && guard < 60 * 90) {
    app.stepEngine(bot(app.state));
    app.recorder.observe(app.state);
    guard += 1;
  }
  app.persistReplay();
  const stored = JSON.parse(storage.map.get('duo-assembly-replays'));
  assert.equal(stored.length, 1);
  assert.ok(stored[0].events.some((e) => e.type === EVENT.MATCH_VICTORY));
  assert.ok(stored[0].conflictTicks.length === 0 || Array.isArray(stored[0].conflictTicks));
  assert.ok(stored[0].snapshots.length > 1);
});
});
