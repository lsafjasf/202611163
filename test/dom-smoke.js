/* 无头 DOM 冒烟测试：用最小桩件驱动 app.js，验证控制器全链路不抛错且行为正确。 */
const path = require('path');

function makeCtx() {
  return new Proxy({}, {
    get(t, k) {
      if (k === 'createLinearGradient') return () => ({ addColorStop() {} });
      return typeof k === 'string' ? () => {} : undefined;
    },
    set() { return true; }
  });
}
function makeEl(id) {
  const listeners = {};
  const children = [];
  return {
    id, value: '', innerHTML: '', textContent: '', className: '', hidden: false,
    rows: [], cells: [],
    children,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      toggle(c, f) { f ? this._s.add(c) : this._s.delete(c); },
      contains(c) { return this._s.has(c); }
    },
    addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    dispatch(ev) {
      const self = this;
      (listeners[ev] || []).forEach(fn => fn.call(self, { target: self }));
    },
    getContext() { return makeCtx(); },
    insertRow() { const r = { cells: [], classList: makeEl('row').classList,
      insertCell() { const c = {}; r.cells.push(c); return c; } };
      this.rows.push(r); return r; },
    deleteRow(i) { this.rows.splice(i, 1); },
    prepend(c) { children.unshift(c); }, appendChild(c) { children.push(c); },
    dataset: {}
  };
}

const ids = ['seed-input', 'tunnel-canvas', 'curve-canvas', 'alpha-lim', 'v-lim',
  'p-lim', 't-lim', 'alpha', 'alpha-val', 'velocity', 'v-val', 'pressure',
  'p-val', 'temp', 't-val', 'noise', 'btn-pause', 'btn-step', 'btn-reset',
  'btn-replay', 'btn-average', 'btn-selftest', 'readout', 'last-change',
  'event-log', 'avg-table', 'selftest-panel', 'selftest-log', 'trip-banner',
  'badge-run', 'badge-stall', 'badge-trip'];
const elMap = {};
ids.forEach(id => { elMap[id] = makeEl(id); });
elMap['avg-table'].rows.push({ cells: [{}, {}, {}] });
elMap['seed-input'].value = '20261116';
elMap['noise'].checked = true;
const presetEls = ['normal', 'limit', 'stall'].map(p => {
  const b = makeEl('preset-' + p); b.dataset.preset = p; return b;
});

let rafCb = null, nowMs = 0, timers = [];
global.self = global;
global.window = global;
global.document = {
  getElementById: id => elMap[id],
  createElement: tag => makeEl(tag),
  addEventListener: (ev, fn) => { if (ev === 'DOMContentLoaded') setImmediate(fn); },
  querySelectorAll: () => presetEls
};
global.performance = { now: () => nowMs };
global.requestAnimationFrame = cb => { rafCb = cb; return 1; };
function pump() { if (rafCb) { const cb = rafCb; rafCb = null; cb(nowMs); } }
global.setInterval = fn => { const id = timers.length + 1; timers.push({ id, fn }); return id; };
global.clearInterval = id => { timers = timers.filter(t => t.id !== id); };
global.setTimeout = fn => process.nextTick(fn);

global.WTPhysics = require(path.join(__dirname, '..', 'js', 'physics.js'));
global.WTVerify = require(path.join(__dirname, '..', 'js', 'verify.js'));
require(path.join(__dirname, '..', 'js', 'render.js'));
require(path.join(__dirname, '..', 'js', 'app.js'));

function frames(n, dtMs) {
  for (let i = 0; i < n; i++) { nowMs += dtMs; pump(); }
}
function assert(c, msg) { if (!c) { console.error('[FAIL]', msg); process.exitCode = 1; }
  else console.log('[ok] ' + msg); }

setImmediate(() => {
  frames(10, 20);
  const app = global.__WTApp;
  assert(!!app, '应用初始化成功');
  const eng = global.window.WTPhysics;

  // 暂停 → 单步 → 恢复
  elMap['btn-pause'].dispatch('click');
  assert(elMap['btn-pause'].textContent === '继续', '暂停按钮切换为继续');
  elMap['btn-step'].dispatch('click');
  elMap['btn-step'].dispatch('click');
  assert(elMap['badge-run'].textContent === '已暂停', '单步期间保持暂停态');
  elMap['btn-pause'].dispatch('click');
  frames(5, 20);
  assert(elMap['badge-run'].textContent === '运行中', '恢复后继续运行');

  // 极限载荷预设 → 保护触发并冻结（验证预设按钮的真实事件绑定）
  presetEls.find(b => b.dataset.preset === 'limit').dispatch('click');
  frames(60, 20);
  assert(!elMap['badge-trip'].classList.contains('hidden'), '极限载荷触发保护徽章');
  assert(!elMap['trip-banner'].classList.contains('hidden'), '触发横幅显示触发点');

  // 冻结后继续推帧状态不变
  // 通过 readout 无法直接取引擎，借助重置验证恢复
  elMap['btn-reset'].dispatch('click');
  frames(5, 20);
  assert(elMap['badge-trip'].classList.contains('hidden'), '重置后保护状态清除');
  assert(elMap['event-log'].rows !== undefined, '重置不破坏 DOM 结构');

  // 失稳预设 → 越过临界迎角后出现失速徽章
  presetEls.find(b => b.dataset.preset === 'stall').dispatch('click');
  frames(120, 20);
  assert(!elMap['badge-stall'].classList.contains('hidden'), '失稳预设触发失速状态');
  elMap['btn-reset'].dispatch('click');
  frames(3, 20);

  // 正常工况预设 → 长时间运行无触发
  presetEls.find(b => b.dataset.preset === 'normal').dispatch('click');
  frames(100, 20);
  assert(elMap['badge-trip'].classList.contains('hidden'), '正常工况不触发保护');

  // 回放
  frames(20, 20);
  elMap['btn-replay'].dispatch('click');
  pump();
  assert(elMap['badge-run'].textContent === '回放中', '进入回放状态');
  timers[0] && timers[0].fn();
  elMap['btn-replay'].dispatch('click');
  pump();
  assert(elMap['badge-run'].textContent === '运行中', '退出回放恢复现场');

  // 重复测量
  elMap['btn-average'].dispatch('click');
  assert(elMap['avg-table'].rows.length === 7, '重复测量生成 5 轮+表头+均值行');

  // 内置自检
  elMap['btn-selftest'].dispatch('click');
  setImmediate(() => setImmediate(() => {
    const passCount = elMap['selftest-log'].children.filter(
      li => li.textContent.includes('[PASS]')).length;
    assert(passCount === 8, '内置自检 8 个场景全部通过（实际 ' + passCount + '）');
    console.log(process.exitCode ? 'DOM 冒烟测试存在失败项' : 'DOM 冒烟测试全部通过');
  }));
});
