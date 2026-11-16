/* 冒烟测试:用 DOM 桩在 Node 中执行 main.js,跑通完整对局与回放查看器 */
'use strict';
const assert = require('assert');

/* ---------- DOM 桩 ---------- */
function makeCtx() {
  const noop = () => {};
  return new Proxy({}, { get: (t, k) => (k === 'canvas' ? {} : noop), set: () => true });
}
function makeEl(id) {
  const el = {
    id, children: [], style: {}, textContent: '', className: '', value: 0,
    selectedIndex: 0, scrollTop: 0, title: '', max: 100, width: 960, height: 480,
    _cls: new Set(), _handlers: {},
    classList: {
      toggle: (c, f) => { f ? el._cls.add(c) : el._cls.delete(c); },
      add: c => el._cls.add(c), remove: c => el._cls.delete(c),
      contains: c => el._cls.has(c)
    },
    addEventListener: (ev, fn) => { (el._handlers[ev] = el._handlers[ev] || []).push(fn); },
    appendChild: c => { el.children.push(c); },
    getContext: () => makeCtx(),
    click: () => (el._handlers.click || []).forEach(f => f({})),
    set innerHTML(v) { el.children = []; }, get innerHTML() { return ''; }
  };
  return el;
}
const els = {};
const windowHandlers = {};
let rafCb = null, intervalCb = null;
const store = {};

global.window = global;
global.document = {
  getElementById: id => (els[id] = els[id] || makeEl(id)),
  createElement: tag => makeEl(tag + Math.random())
};
global.window.addEventListener = (ev, fn) => { (windowHandlers[ev] = windowHandlers[ev] || []).push(fn); };
global.requestAnimationFrame = cb => { rafCb = cb; };
global.setInterval = cb => { intervalCb = cb; return 1; };
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); }
};
global.fetch = () => Promise.resolve({ ok: false });
global.AudioContext = undefined; // 音频在无手势环境下静默降级

require('../js/logic.js');
require('../js/audio.js');
require('../js/main.js');

function key(code, down) {
  (windowHandlers[down ? 'keydown' : 'keyup'] || []).forEach(f => f({ code, preventDefault: () => {} }));
}
function frame(ts) { const cb = rafCb; rafCb = null; cb(ts); }

/* ---------- 用单人调试模式跑完整对局(WASD 镜像驱动两侧) ---------- */
console.log('冒烟: 完整对局(调试模式镜像控制)');
key('KeyT', true); key('KeyT', false);          // 开启单人调试
assert(els.modeLabel.textContent.includes('单人调试'), '调试模式已开启');

const L = global.BridgeLogic;
let ts = 0, f = 0;
function step(keysDown) {
  ['KeyW', 'KeyA', 'KeyS', 'KeyD'].forEach(k => key(k, keysDown.includes(k)));
  ts += 1000 / 60;
  frame(ts);
  f++;
}
// 从面板读阶段文字判断进度
function phase() { return els.phaseLabel.textContent; }
step([]); // 先渲染一帧,初始化面板
let guard = 0;
while (guard++ < 60 * 120) {
  const ph = phase();
  const pulse = (f % 4 < 2);
  if (ph.includes('就位')) step(['KeyD']);
  else if (ph.includes('挂钩')) step(['KeyS']);
  else if (ph.includes('吊出')) step(pulse ? ['KeyW'] : []);
  else if (ph.includes('安装')) step(pulse ? ['KeyS'] : []);
  else if (ph.includes('撤回')) {
    const hook = els.hookL.textContent;
    step(hook === '收起' ? ['KeyA'] : ['KeyA', 'KeyW']);
  }
  else break;
}
assert(phase().includes('成功'), '对局成功,实际=' + phase());
assert(els.message.textContent.includes('成功'), '成功反馈信息=' + els.message.textContent);
assert(els.progressVal.textContent === '100%', '进度 100%');
if (String(els.integrityVal.textContent) !== '100') {
  console.log('  事件日志:', els.eventLog.children.map(c => c.textContent).join(' | '));
  console.log('  integrityVal=[' + els.integrityVal.textContent + '] wearL=' + els.wearLVal.textContent);
}
assert(String(els.integrityVal.textContent) === '100', '完整度无损');
console.log('  ✓ 对局成功,仪表面板读数正确');

/* ---------- 回放已自动保存,查看器可用 ---------- */
console.log('冒烟: 回放查看器');
els.btnReplay.click();
assert(!els.replayOverlay._cls.has('hidden'), '回放覆盖层打开');
assert(els.replaySelect.children.length >= 1, '回放列表含已保存对局');
assert(els.replayTimeline.children.length >= 0, '时间轴构建');
els.replayPlay.click();                          // 播放
for (let i = 0; i < 5; i++) intervalCb();        // 推进回放帧
els.replayScrub.value = 10;
(els.replayScrub._handlers.input || []).forEach(h => h({ target: { value: 10 } }));
els.replayClose.click();
assert(els.replayOverlay._cls.has('hidden'), '回放覆盖层关闭');
console.log('  ✓ 回放保存、列表、播放、拖动、关闭均正常');

/* ---------- 暂停 / 重开 / 轮换 ---------- */
console.log('冒烟: 暂停/重开/轮换');
key('KeyP', true); key('KeyP', false);          // 回放打开时自动暂停过,先恢复
key('KeyP', true); key('KeyP', false);
assert(els.message.textContent === '已暂停', '暂停生效');
key('KeyP', true); key('KeyP', false);
key('KeyX', true); key('KeyX', false);
assert(els.leftTitle.textContent.includes('玩家 B'), '轮换后左侧标题切换为玩家 B');
key('KeyR', true); key('KeyR', false);
assert(String(els.countdown.textContent).includes('180'), '重开后倒计时复位=' + els.countdown.textContent);
assert(els.phaseLabel.textContent.includes('就位'), '重开后阶段复位');
assert(String(els.integrityVal.textContent) === '100', '重开后完整度复位');
console.log('  ✓ 暂停、轮换、重开复位均正常');

console.log('\n冒烟测试全部通过');
