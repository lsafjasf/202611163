import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, step, swapSides, togglePause } from '../src/engine/engine.js';
import { render } from '../src/web/renderer.js';
import { ReplayView } from '../src/web/replay-view.js';
import { ReplayRecorder } from '../src/engine/replay.js';
import { makeFakeCanvas } from './helpers/fake-dom.js';
import { makeCooperativeBot, overPressureInput } from './helpers/bot.js';
import { MATCH, ROUND } from '../src/engine/config.js';

function recording(bot) {
  const state = createGame();
  const recorder = new ReplayRecorder();
  let n = 0;
  recorder.observe(state);
  while (state.mode !== MATCH.VICTORY && state.mode !== MATCH.DEFEAT && n < 60 * 90) {
    step(state, bot(state));
    recorder.observe(state);
    n += 1;
  }
  return recorder.finish(state, state.mode);
}

test('渲染器在 READY/PLAYING/成功/失败/暂停/胜负各相位都可绘制', () => {
  const ctx = makeFakeCanvas().getContext('2d');
  const layout = { width: 980, height: 600 };
  const state = createGame();

  assert.doesNotThrow(() => render(ctx, state, layout)); // READY
  for (let i = 0; i < 130; i += 1) step(state, makeCooperativeBot()(state));
  assert.doesNotThrow(() => render(ctx, state, layout)); // PLAYING

  swapSides(state);
  togglePause(state);
  assert.doesNotThrow(() => render(ctx, state, layout)); // 换边 + 暂停

  const crush = createGame();
  let n = 0;
  while (crush.round.phase !== ROUND.FAILED && n < 600) {
    step(crush, overPressureInput(crush));
    n += 1;
  }
  assert.equal(crush.round.phase, ROUND.FAILED);
  assert.doesNotThrow(() => render(ctx, crush, layout));

  const victory = createGame();
  const bot = makeCooperativeBot();
  let guard = 0;
  while (victory.mode !== MATCH.VICTORY && guard < 60 * 90) {
    step(victory, bot(victory));
    guard += 1;
  }
  assert.doesNotThrow(() => render(ctx, victory, layout));
});

test('回放查看器绘制时间轴与冲突标记不抛异常', () => {
  const replay = recording((s) =>
    s.round.index === 0 ? overPressureInput(s) : makeCooperativeBot()(s)
  );
  const ctx = makeFakeCanvas().getContext('2d');
  const view = new ReplayView(replay, render);
  assert.doesNotThrow(() => view.draw(ctx, 980, 600));
  view.player.nextConflict();
  assert.doesNotThrow(() => view.draw(ctx, 980, 600));
  view.player.seekTime(replay.durationSec);
  assert.doesNotThrow(() => view.draw(ctx, 980, 600));
});
