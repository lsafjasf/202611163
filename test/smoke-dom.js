/* 页面级冒烟测试：用最小 DOM 桩执行 app.js，模拟筛选/窗口切换/导出。
 * 运行：node test/smoke-dom.js */
const fs = require('fs');
const path = require('path');

global.self = global;
global.RawData = require('../js/data-raw.js');
global.Pipeline = require('../js/pipeline.js');
require('../js/render.js'); // 挂载到 self.Render

function makeCtx(canvas) {
  return new Proxy({ canvas }, {
    get(t, k) {
      if (k in t) return t[k];
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

function makeEl(tag) {
  const el = {
    tagName: tag, children: [], style: {}, dataset: {},
    textContent: '', innerHTML: '', value: '', min: 0, max: 100,
    width: 300, height: 150, className: '',
    classList: { toggle: () => {}, add: () => {}, remove: () => {} },
    listeners: {},
    addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
    dispatch(ev) { (this.listeners[ev] || []).forEach(f => f({ target: el })); },
    appendChild(c) { this.children.push(c); return c; },
    querySelector(sel) {
      if (sel === 'tbody') {
        if (!this._tbody) this._tbody = makeEl('tbody');
        return this._tbody;
      }
      return makeEl('div');
    },
    getContext() { return makeCtx(el); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 760, height: 560 }; },
    toDataURL() { return 'data:image/png;base64,AAAA'; },
    click() { this.dispatch('click'); },
  };
  return el;
}

const ids = ['versionBadge', 'unitBadge', 'caliberLine', 'windowBtns', 'datasetSel',
  'pollutantSel', 'regionSel', 'hSlice', 'hSliceVal', 'vSlice', 'vSliceVal',
  'filterLine', 'meshCanvas', 'legendCanvas', 'profileCanvas', 'hotspotTable',
  'qualityList', 'exportCsv', 'exportPng'];
const els = {};
ids.forEach(id => { els[id] = makeEl(id.startsWith('h') || id.includes('Canvas') ? 'canvas' : 'div'); });
els.meshCanvas.width = 760; els.meshCanvas.height = 560;

global.document = {
  getElementById: id => els[id],
  createElement: tag => makeEl(tag),
};
global.URL.createObjectURL = () => 'blob:fake';

// 执行 app.js
const src = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
eval(src);

let passed = 0, failed = 0;
function assert(cond, name, detail) {
  if (cond) { passed++; console.log('  PASS ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? ' -> ' + detail : '')); }
}

console.log('[冒烟] 初始渲染');
assert(els.filterLine.textContent.includes('数据集=正常数据'), '筛选行显示数据集');
assert(els.filterLine.textContent.includes('时间窗口=00-04时'), '筛选行显示时间窗口');
assert(els.versionBadge.textContent.includes('sample-v'), '显示数据版本');
assert(els.caliberLine.textContent.includes('统计口径'), '显示统计口径');
assert(els.qualityList.innerHTML.includes('去重剔除'), '质量摘要含去重项');
assert(els.qualityList.innerHTML.includes('缺失记录数'), '质量摘要含缺失项');
assert(els.qualityList.innerHTML.includes('异常剔除'), '质量摘要含异常项');

console.log('[冒烟] 切换数据集 → 图形/列表/质量摘要同步');
els.datasetSel.value = 'duplicate';
els.datasetSel.dispatch('change');
assert(els.filterLine.textContent.includes('重复+异常数据'), '筛选行同步更新');
assert(/去重剔除（重复记录）.*<b>307<\/b>/.test(els.qualityList.innerHTML.replace(/\n/g, '')),
  '质量摘要显示去重 307', els.qualityList.innerHTML.slice(0, 200));
assert(els.qualityList.innerHTML.includes('<b>6</b>'), '质量摘要显示异常 6');

console.log('[冒烟] 窗口切换往返状态不丢失');
els.vSlice.value = '9';
els.vSlice.dispatch('input');
assert(els.vSliceVal.textContent === 'gx=9', '垂直切片生效');
const win0Filter = els.filterLine.textContent;
els.windowBtns.children[3].dispatch('click'); // 切到窗口 3
assert(els.filterLine.textContent.includes('12-16时'), '窗口切换生效');
assert(els.vSlice.value == 9, '切换后切片保留', els.vSlice.value);
els.windowBtns.children[0].dispatch('click'); // 返回窗口 0
assert(els.filterLine.textContent === win0Filter, '返回后筛选行复原');
assert(els.vSlice.value == 9, '返回后垂直切片不丢失');

console.log('[冒烟] 导出');
els.exportPng.dispatch('click');
els.exportCsv.dispatch('click');
assert(true, '导出流程无异常');

console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败');
process.exit(failed ? 1 : 0);
