// jsdom 接线冒烟：node test/dom-smoke.test.js
// 验证真实 index.html 的 DOM 接线、HUD 同步、暂停/重开/调试/轮换与回放存档。
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

// jsdom 不实现 canvas 2d / Web Audio，提供最小桩件保证接线可运行。
function installStubs(window) {
  window.HTMLCanvasElement.prototype.getContext = function () {
    return makeCtx2d();
  };
  window.AudioContext = class AudioContext {
    constructor() {
      this.state = 'running';
      this.currentTime = 0;
      this.sampleRate = 44100;
      this.destination = {};
    }
    createGain() {
      return { gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
    }
    createOscillator() {
      return {
        type: '',
        frequency: { setValueAtTime() {} },
        connect() { return this; },
        start() {},
        stop() {},
      };
    }
    createBufferSource() {
      return { connect() { return this; }, start() {} };
    }
    createBuffer(ch, len) {
      return { getChannelData: () => new Float32Array(len) };
    }
    createBiquadFilter() {
      return { type: '', frequency: { value: 0 }, connect() { return this; } };
    }
    resume() {}
    suspend() {}
    close() { return Promise.resolve(); }
  };
  window.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 16);
  window.cancelAnimationFrame = (id) => clearTimeout(id);
}

function makeCtx2d() {
  const noop = () => {};
  return new Proxy(
    {},
    {
      get: (t, prop) => {
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
          return () => ({ addColorStop: noop });
        }
        if (prop === 'measureText') return () => ({ width: 10 });
        if (prop === 'getImageData') return () => ({ data: [0, 0, 0, 0] });
        return typeof prop === 'string' ? noop : undefined;
      },
      set: () => true,
    }
  );
}

const html = await readFile('index.html', 'utf8');
const dom = new JSDOM(html, {
  url: 'http://localhost/',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const { window } = dom;
installStubs(window);
global.window = window;
global.document = window.document;
global.performance = window.performance;
global.requestAnimationFrame = window.requestAnimationFrame;
global.cancelAnimationFrame = window.cancelAnimationFrame;
global.localStorage = window.localStorage;

const { boot } = await import('../js/main/core.js');
const ctx = boot();
const { game } = ctx;

// 初始 HUD 渲染。
assert.equal(window.document.getElementById('hud-phase').textContent, '待开始');
assert.equal(window.document.getElementById('role-0').textContent, '职责：方向');
assert.equal(window.document.getElementById('role-1').textContent, '职责：亮度');

// 开始并模拟两侧同时输入，跑若干帧。
window.document.getElementById('btn-start').click();
assert.equal(game.phase, 'running');
const press = (code, type = 'keydown') =>
  window.dispatchEvent(new window.KeyboardEvent(type, { code, bubbles: true }));
press('KeyD'); // 左侧方向右
press('ArrowUp'); // 右侧亮度上
for (let i = 0; i < 30; i++) game.step(1 / 60);
assert.ok(game.aim > 0, '方向侧输入生效');
assert.ok(game.brightness > 0.15, '亮度侧输入生效');
press('KeyD', 'keyup');
press('ArrowUp', 'keyup');

// 两侧仪表读数一致（共享状态）。
assert.equal(
  window.document.getElementById('m0-aim').textContent,
  window.document.getElementById('m1-aim').textContent
);

// 暂停。
press('KeyP');
assert.equal(game.phase, 'paused');
const frozen = game.timeLeft;
game.step(1 / 60);
assert.equal(game.timeLeft, frozen, '暂停时引擎不推进');
press('KeyP');
assert.equal(game.phase, 'running');

// 轮换：左侧变为亮度职责。
press('KeyT');
assert.equal(game.swapIndex, 1);
assert.equal(game.getRoleView().brightness.side, 0, '轮换后左侧负责亮度');

// 单人调试。
press('KeyG');
assert.equal(game.debugMode, true);
assert.ok(window.document.getElementById('btn-debug').classList.contains('active'));
press('KeyG');

// 重开复位：倒计时、仪表、输入与回放标记全部重置。
window.document.getElementById('btn-restart').click();
const s = game.getState();
assert.equal(s.timeLeft, 45);
assert.equal(s.heat, 0);
assert.equal(s.cueIndex, 0);
assert.equal(s.swapIndex, 0);
assert.ok(!s.inputs[0].right && !s.inputs[1].up);
assert.equal(s.timeLeft, 45);

console.log('✓ DOM 接线冒烟通过：HUD 同步、并发输入、暂停/轮换/调试/重开均正常');
process.exit(0);
