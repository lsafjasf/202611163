// 浏览器端冒烟测试：打开 tests/browser-smoke.html 自动运行。
import { Game, CUES, directionSide } from '../js/engine.js';
import { Renderer } from '../js/renderer.js';
import { AudioManager } from '../js/audio.js';
import { KeyboardInput } from '../js/input.js';
import {
  ReplayRecorder,
  ReplayPlayer,
  makeStore,
  memoryStorage,
  conflictMoments,
} from '../js/replay.js';

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, err: String(err && err.message) });
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// 1. Canvas 渲染不抛异常且有像素输出。
const canvas = document.getElementById('c');
const renderer = new Renderer(canvas);
renderer.resize();
const game = new Game();
game.start();
check('Canvas 初始化与首帧渲染', () => {
  renderer.draw(game.getState());
  const ctx = canvas.getContext('2d');
  const px = ctx.getImageData(480, 300, 1, 1).data;
  assert(px.length === 4, '无法读取像素');
});

// 2. 键盘两侧同时按下（并发输入）互不覆盖。
check('两套键盘可同时输入且互不干扰', () => {
  const kb = new KeyboardInput();
  kb.attach();
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA' }));
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowUp' }));
  assert(kb.pressed[0].left === true, '左侧 A 未生效');
  assert(kb.pressed[1].up === true, '右侧 ↑ 未生效');
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyA' }));
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowUp' }));
  assert(kb.pressed[0].left === false && kb.pressed[1].up === false, '释放失败');
  kb.detach();
});

// 3. 动作键（暂停/轮换/调试）事件分发。
check('暂停/轮换/调试动作键触发', async () => {
  const g2 = new Game();
  g2.start();
  const actions = [];
  const kb2 = new KeyboardInput();
  kb2.attach();
  kb2.onAction((a) => actions.push(a));
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP' }));
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyT' }));
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG' }));
  assert(actions.join(',') === 'pause,swap,debug', `动作序列异常: ${actions}`);
  kb2.detach();
});

// 4. Web Audio 可创建（无音频环境时降级不报错）。
check('Web Audio 初始化与音效降级安全', () => {
  const audio = new AudioManager();
  audio.ensure();
  audio.warn();
  audio.overheat();
  audio.cue();
  audio.reset();
  assert(audio.ctx === null, 'reset 后上下文应关闭');
});

// 5. 完整协作直到成功，期间持续渲染。
check('协作完成 5 段并成功（含每帧渲染）', () => {
  const g = new Game();
  g.start();
  const rec = new ReplayRecorder();
  const TICK = 1 / 60;
  while (g.phase === 'running' && g.cueIndex < CUES.length) {
    const dirSide = directionSide(g.swapIndex);
    const briSide = 1 - dirSide;
    const target = g.targetAngle();
    const wantDir =
      Math.abs(g.aim - target) > 2 && !g.overheated
        ? g.aim < target ? 'right' : 'left'
        : null;
    const wantBri = g.brightness < 0.55 ? 'up' : null;
    for (const [side, key, want] of [
      [dirSide, 'left', wantDir === 'left'],
      [dirSide, 'right', wantDir === 'right'],
      [briSide, 'up', wantBri === 'up'],
    ]) {
      if (g.inputs[side][key] !== want) {
        g.setInput(side, key, want);
        rec.recordInput(g.elapsed, side, key, want);
      }
    }
    g.step(TICK);
    renderer.draw(g.getState());
  }
  assert(g.phase === 'success', `未成功，状态=${g.phase}`);
  window.__smokeReplay = rec.finish(g);
});

// 6. 回放重放与冲突定位 + 存储。
check('回放重放结果一致且冲突可定位', () => {
  const replay = window.__smokeReplay;
  assert(replay, '缺少回放数据');
  const player = new ReplayPlayer(replay);
  const end = player.seek(replay.duration);
  assert(end.phase === 'success' && end.cueIndex === 5, '回放结果不一致');
  const store = makeStore(memoryStorage());
  store.save(replay);
  assert(store.list().length === 1, '存档失败');
  assert(Array.isArray(conflictMoments(replay)), '冲突时刻提取失败');
});

// 渲染结果汇总。
const ul = document.getElementById('results');
let allOk = true;
for (const r of results) {
  if (!r.ok) allOk = false;
  const li = document.createElement('li');
  li.className = r.ok ? 'ok' : 'fail';
  li.textContent = `${r.ok ? '✓' : '✗'} ${r.name}${r.err ? ' — ' + r.err : ''}`;
  ul.appendChild(li);
}
document.getElementById('log').textContent =
  (allOk ? '全部通过' : '存在失败') + `（${results.length} 项）`;
window.__smokeResult = { allOk, results };
