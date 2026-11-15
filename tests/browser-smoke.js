/* 浏览器冒烟测试：用 jsdom 加载 index.html 与全部脚本，
   桩掉 Canvas 2D、AudioContext、requestAnimationFrame、localStorage，
   验证模块装配、按键、暂停/重开/轮换/调试、自测与回放查看器均不抛异常。 */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const dom = new JSDOM(html, {
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  url: 'http://localhost/'
});
const { window } = dom;

// Canvas 2D 桩
const ctx2dStub = new Proxy({}, {
  get(target, prop) {
    if (prop === 'measureText') return () => ({ width: 10 });
    return typeof prop === 'string' ? () => {} : undefined;
  },
  set() { return true; }
});
window.HTMLCanvasElement.prototype.getContext = function () { return ctx2dStub; };

// Web Audio 桩
class AudioParam {
  setValueAtTime() {}
  exponentialRampToValueAtTime() {}
  setTargetAtTime() {}
}
class AudioNodeStub {
  constructor() { this.frequency = new AudioParam(); this.gain = new AudioParam(); this.Q = new AudioParam(); this.type = ''; }
  connect() { return this; }
  start() {}
  stop() {}
}
class AudioContextStub {
  constructor() {
    this.state = 'running';
    this.currentTime = 0;
    this.sampleRate = 44100;
    this.destination = new AudioNodeStub();
  }
  createGain() { return new AudioNodeStub(); }
  createBiquadFilter() { return new AudioNodeStub(); }
  createOscillator() { return new AudioNodeStub(); }
  createBufferSource() { return Object.assign(new AudioNodeStub(), { buffer: null, loop: false }); }
  createBuffer(channels, len) { return { getChannelData: () => new Float32Array(len) }; }
  resume() {}
}
window.AudioContext = AudioContextStub;
window.webkitAudioContext = AudioContextStub;

// 手动按 index.html 顺序注入脚本
window.eval('var RG_BROWSER = true;');
const scripts = [
  'js/config.js', 'js/rng.js', 'js/physics.js', 'js/input.js', 'js/audio.js',
  'js/replay.js', 'js/replay-viewer.js', 'js/render.js', 'js/selftest.js',
  'js/selftest-ui.js', 'js/game.js', 'js/main.js'
];
for (const rel of scripts) {
  const code = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  window.eval(code);
}

const checks = [];
function check(name, fn) {
  try { fn(); checks.push(['PASS', name]); }
  catch (err) { checks.push(['FAIL', name + ' | ' + err.message]); }
}

check('全局命名空间 RG 已装配', () => {
  if (!window.RG || !window.RG.Game || !window.RG.ReplayViewer) throw new Error('RG missing');
});

check('HUD 初始数值已渲染', () => {
  const timer = window.document.getElementById('sh-timer').textContent;
  if (!timer.startsWith('95')) throw new Error('timer=' + timer);
});

function key(code, type) {
  window.dispatchEvent(new window.KeyboardEvent(type, { code, bubbles: true, cancelable: true }));
}
check('同时按下 W 与方向上键不抛错', () => {
  key('KeyW', 'keydown');
  key('ArrowUp', 'keydown');
  key('KeyW', 'keyup');
  key('ArrowUp', 'keyup');
});
check('暂停/继续切换', () => {
  // 首屏遮罩先关闭（游戏从暂停态进入运行态）
  window.document.querySelector('#ov-actions .btn-primary').click();
  if (window.document.getElementById('overlay').hidden === false) {
    throw new Error('start overlay should close');
  }
  key('Space', 'keydown');
  if (window.document.getElementById('overlay').hidden) throw new Error('overlay should show');
  key('Space', 'keydown');
  if (window.document.getElementById('overlay').hidden === false) {
    throw new Error('overlay should hide on resume');
  }
});
check('交换控制侧 T 更新仪表标签', () => {
  key('KeyT', 'keydown');
  const tag = window.document.getElementById('p1-side').textContent;
  if (tag !== '右桨') throw new Error('tag=' + tag);
  key('KeyT', 'keydown');
});
check('单人调试模式 D 切换', () => {
  key('KeyD', 'keydown');
  key('KeyB', 'keydown');
  key('KeyD', 'keydown');
});
check('重开 R 复位倒计时', () => {
  key('KeyR', 'keydown');
  const timer = window.document.getElementById('sh-timer').textContent;
  if (!timer.startsWith('95')) throw new Error('timer=' + timer);
});
check('静音 M 切换', () => { key('KeyM', 'keydown'); });

check('浏览器自测六场景全部通过', () => {
  window.RG.SelfTestUi.run(window.document.getElementById('drawer-body'),
    window.document.getElementById('drawer'));
});

// 等待自测 setTimeout 完成
setTimeout(() => {
  check('自测报告渲染且全部 PASS', () => {
    const summary = window.document.querySelector('.test-summary');
    if (!summary || !summary.classList.contains('all-pass')) {
      throw new Error(summary ? summary.textContent : 'no summary');
    }
  });
  check('回放库已持久化至少一份完整回放', () => {
    const list = window.RG.ReplayStore.list();
    if (list.length < 1 || !list[0].frames.length) throw new Error('empty store');
  });
  check('回放查看器挂载与冲突跳转不抛错', () => {
    const record = window.RG.ReplayStore.list()[0];
    window.RG.ReplayViewer.mount(
      window.document.getElementById('drawer-body'), record,
      new window.RG.Renderer(window.document.getElementById('game-canvas'))
    );
    const chips = window.document.querySelectorAll('.moment-chip');
    if (chips.length < 1) throw new Error('no moment chips');
    chips[0].click();
  });

  let fail = 0;
  for (const [status, name] of checks) {
    if (status === 'FAIL') fail++;
    console.log(status + ' | ' + name);
  }
  console.log('\n' + (checks.length - fail) + '/' + checks.length + ' 项浏览器冒烟通过');
  process.exit(fail ? 1 : 0);
}, 200);
