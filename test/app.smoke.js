// 页面级冒烟测试：用最小 DOM/Canvas 桩加载 app.js，验证
// 初始化渲染、筛选切换、状态持久化恢复、CSV 导出与屏幕一致。
// 运行：node test/app.smoke.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeCtxStub() {
  const noop = () => {};
  return new Proxy({}, {
    get(t, prop) {
      if (prop === 'measureText') return () => ({ width: 10 });
      return noop;
    },
    set() { return true; }
  });
}

function makeEl(id) {
  return {
    id,
    value: '',
    innerHTML: '',
    textContent: '',
    className: '',
    hidden: true,
    style: {},
    children: [],
    listeners: {},
    appendChild(c) { this.children.push(c); },
    addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
    fire(ev, arg) { (this.listeners[ev] || []).forEach(f => f(arg || { target: this })); },
    getContext: () => makeCtxStub(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 600 }),
    toBlob(cb) { cb({ blob: true }); },
    click() {},
    width: 960,
    height: 600
  };
}

function boot(storageSeed) {
  const els = {};
  const ids = ['flowCanvas', 'tooltip', 'datasetSel', 'hourStart', 'hourEnd',
    'fromSel', 'toSel', 'resetBtn', 'exportCsvBtn', 'exportPngBtn',
    'dataVersion', 'statCaliber', 'filterSummary', 'selfCheck', 'qualityTable'];
  ids.forEach(id => { els[id] = makeEl(id); });
  const tbody = makeEl('tbody'), tfoot = makeEl('tfoot');
  const store = Object.assign({}, storageSeed);
  const downloads = [];
  const sandbox = {
    console,
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; }
    },
    document: {
      getElementById: id => els[id],
      querySelector: sel => (sel.includes('tbody') ? tbody : tfoot),
      createElement: tag => makeEl(tag)
    },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
    Blob: function (parts) { this.parts = parts; },
    setTimeout: fn => fn(),
    window: {}
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const origCreate = sandbox.document.createElement;
  sandbox.document.createElement = tag => {
    const el = origCreate(tag);
    if (tag === 'a') {
      el.click = () => downloads.push({ href: el.href, name: el.download });
    }
    return el;
  };
  const ctx = vm.createContext(sandbox);
  ['js/data.js', 'js/pipeline.js', 'js/app.js'].forEach(f => {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
  });
  return { els, store, downloads, tbody, tfoot, sandbox };
}

let passed = 0;
function check(name, fn) { fn(); passed++; console.log('  PASS ' + name); }

console.log('A. 初始化渲染');
{
  const app = boot({});
  check('显示数据版本与统计口径', () => {
    assert.ok(app.els.dataVersion.textContent.includes('v2026.11.16'));
    assert.ok(app.els.statCaliber.textContent.includes('统计口径'));
  });
  check('状态栏显示当前筛选条件', () => {
    assert.ok(app.els.filterSummary.textContent.includes('时间=0:00–23:59'));
    assert.ok(app.els.filterSummary.textContent.includes('总人次=10920'));
  });
  check('质量摘要渲染到表格', () => {
    assert.ok(app.els.qualityTable.innerHTML.includes('去重剔除'));
  });
  check('明细表合计与视图一致', () => {
    assert.ok(app.tfoot.innerHTML.includes('10920'));
  });
  check('自检通过标记', () => {
    assert.ok(app.els.selfCheck.className.includes('ok'));
  });
}

console.log('B. 筛选切换与状态持久化');
{
  const app = boot({});
  check('切换数据集为 dup 后质量摘要更新', () => {
    app.els.datasetSel.value = 'dup';
    app.els.datasetSel.fire('change');
    assert.ok(app.els.qualityTable.innerHTML.includes('>3<'));
    assert.ok(app.els.filterSummary.textContent.includes('重复数据'));
  });
  check('切换时间窗口后明细与状态栏同步', () => {
    app.els.hourStart.value = '18';
    app.els.hourStart.fire('change');
    app.els.hourEnd.value = '18';
    app.els.hourEnd.fire('change');
    assert.ok(app.els.filterSummary.textContent.includes('时间=18:00–18:59'));
    const view = app.sandbox.__flowApp.getView();
    assert.strictEqual(view.totalPeople, 2940); // 880+720+500+380+460（重复行已剔除）
  });
  check('状态已写入 localStorage', () => {
    const saved = JSON.parse(app.store['flow-viz-state-v1']);
    assert.deepStrictEqual(saved, { dataset: 'dup', hourStart: 18, hourEnd: 18, from: 'ALL', to: 'ALL' });
  });
  check('窗口切走再返回后状态可恢复', () => {
    app.els.hourStart.value = '20';
    app.els.hourStart.fire('change');
    const app2 = boot(app.store);
    const st = app2.sandbox.__flowApp.getState();
    assert.strictEqual(st.dataset, 'dup');
    assert.ok(st.hourStart <= st.hourEnd);
    assert.strictEqual(st.hourEnd, 20);
  });
}

console.log('C. 导出与屏幕一致');
{
  const app = boot({});
  app.els.datasetSel.value = 'missing';
  app.els.datasetSel.fire('change');
  check('CSV 导出触发下载且文件名含数据集', () => {
    app.els.exportCsvBtn.fire('click');
    assert.strictEqual(app.downloads.length, 1);
    assert.ok(app.downloads[0].name.includes('missing'));
  });
  check('PNG 导出触发下载', () => {
    app.els.exportPngBtn.fire('click');
    assert.strictEqual(app.downloads.length, 2);
    assert.ok(app.downloads[1].name.endsWith('.png'));
  });
}

console.log('\n冒烟测试全部通过：' + passed + ' 项');
