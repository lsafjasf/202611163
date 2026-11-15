/**
 * jsdom 集成测试：驱动真实 index.html + app.js，验证筛选联动、
 * 视图/窗口状态保留、图形-表格-摘要同步与导出数值一致性。
 * jsdom 无原生 canvas，使用最小 2D 上下文桩，记录绘制调用。
 */
var fs = require('fs');
var path = require('path');
var { JSDOM } = require('jsdom');
var C = require('../src/tide-core.js');

function makeCtx() {
  var calls = [];
  return {
    calls: calls,
    setTransform: function () { calls.push(['setTransform']); },
    fillRect: function () { calls.push(['fillRect'].concat([].slice.call(arguments))); },
    strokeRect: function () {},
    clearRect: function () {},
    beginPath: function () {},
    moveTo: function () {},
    lineTo: function () {},
    arc: function () {},
    fill: function () {},
    stroke: function () {},
    fillText: function (t) { calls.push(['fillText', t]); },
    save: function () {},
    restore: function () {},
    translate: function () {},
    rotate: function () {},
    measureText: function () { return { width: 40 }; },
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '',
    textAlign: '', textBaseline: '', globalAlpha: 1
  };
}

var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
var dom = new JSDOM(html, {
  url: 'http://localhost/',
  runScripts: 'outside-only',
  pretendToBeVisual: true
});
var window = dom.window;
var document = window.document;

var exportedPng = null;
var downloadCalls = [];
window.HTMLCanvasElement.prototype.getContext = function () {
  if (!this.__ctx) this.__ctx = makeCtx();
  return this.__ctx;
};
window.HTMLCanvasElement.prototype.toDataURL = function () {
  exportedPng = { url: 'data:image/png;base64,STUB', canvas: this };
  return exportedPng.url;
};
window.HTMLAnchorElement.prototype.click = function () { downloadCalls.push(this.download); };

window.eval(fs.readFileSync(path.join(__dirname, '..', 'src', 'tide-core.js'), 'utf8'));
window.eval(fs.readFileSync(path.join(__dirname, '..', 'src', 'tide-chart.js'), 'utf8'));
window.eval(fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8'));

var assert = require('assert');
var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }
function $(sel) { return document.querySelector(sel); }
function $all(sel) { return [].slice.call(document.querySelectorAll(sel)); }
function fire(el, type) {
  el.dispatchEvent(new window.Event(type, { bubbles: true }));
}

test('初始渲染：元信息条含数据版本与统计口径，表格行数=8', function () {
  assert.ok($('#meta-bar').textContent.indexOf(C.DATA_VERSION) !== -1);
  assert.ok($('#meta-bar').textContent.indexOf('统计口径') !== -1);
  assert.strictEqual($all('#station-table tbody tr').length, 8);
  assert.strictEqual($all('#detail-table tbody tr').length, C.HOURS);
  var cards = $all('#quality-summary .quality-card .num').map(function (n) { return n.textContent; });
  assert.deepStrictEqual(cards, ['1344', '0', '0', '0', '1344', '1344']);
});

test('切换到重复组：质量卡片显示去重/缺失/异常且均由重算得到', function () {
  var ds = $('#dataset-select');
  ds.value = 'duplicate';
  fire(ds, 'change');
  var q = C.clean(C.buildDatasets().duplicate.raw).quality;
  var cards = $all('#quality-summary .quality-card .num').map(function (n) { return n.textContent; });
  assert.deepStrictEqual(cards.map(Number),
    [q.rawRecords, q.duplicateRecords, q.missingSlots, q.anomalyRecords, q.validSlots, q.expectedSlots]);
  assert.ok(q.duplicateRecords > 0 && q.missingSlots > 0 && q.anomalyRecords > 0);
});

test('切换时间窗口再返回：视图、焦点站点与筛选不丢失', function () {
  $('#view-switch button[data-view="line"]').click();
  var fs = $('#focus-select');
  fs.value = 'S04';
  fire(fs, 'change');
  $all('#station-filter .chip')[7].click();
  var ws = $('#window-select');
  ws.value = 'day3';
  fire(ws, 'change');
  assert.strictEqual($all('#station-table tbody tr').length, 7);
  assert.strictEqual($all('#detail-table tbody tr').length, 24);
  ws.value = 'all';
  fire(ws, 'change');
  assert.strictEqual($('#view-switch button.active').getAttribute('data-view'), 'line');
  assert.strictEqual($('#focus-select').value, 'S04');
  assert.strictEqual($all('#station-table tbody tr').length, 7);
  assert.strictEqual($all('#detail-table tbody tr').length, C.HOURS);
  assert.strictEqual(JSON.parse(window.localStorage.getItem('tide-dashboard-state-v1')).focusStationId, 'S04');
});

test('筛选摘要随筛选同步更新', function () {
  var text = $('#filter-summary').textContent;
  assert.ok(text.indexOf('重复/异常组') !== -1);
  assert.ok(text.indexOf('line') !== -1);
  assert.ok(text.indexOf('S04') !== -1);
});

test('表格数值与核心模块同源重算一致', function () {
  var agg = C.aggregate(C.clean(C.buildDatasets().duplicate.raw), {
    startHour: 0, endHour: C.HOURS - 1,
    stationFilter: C.STATIONS.filter(function (s) { return s.id !== 'S08'; }).map(function (s) { return s.id; })
  });
  var firstRow = $('#station-table tbody tr');
  var cells = firstRow.querySelectorAll('td');
  var st = agg.stationStats[0];
  assert.strictEqual(cells[3].textContent, C.formatValue(st.mean));
  assert.strictEqual(cells[4].textContent, C.formatValue(st.max));
  assert.strictEqual(cells[6].textContent, st.completeness.toFixed(1));
});

test('悬停命中：tooltip 显示时间、站点、潮高', function () {
  $('#view-switch button[data-view="heatmap"]').click();
  var canvas = $('#tide-canvas');
  var evt = new window.MouseEvent('mousemove', { clientX: 200, clientY: 150, bubbles: true });
  canvas.dispatchEvent(evt);
  var tip = $('#tooltip');
  assert.strictEqual(tip.hidden, false);
  assert.ok(/时间：\d{4}-\d{2}-\d{2} \d{2}:00/.test(tip.textContent));
  assert.ok(tip.textContent.indexOf('潮高：') !== -1);
});

test('导出 PNG：文件名含视图与数据集，画布重画后数值与屏幕格式一致', function () {
  var beforeMax = $('#station-table tbody tr td:nth-child(5)').textContent;
  $('#export-png').click();
  assert.strictEqual(downloadCalls.length, 1);
  assert.ok(/^tide-heatmap-duplicate-all\.png$/.test(downloadCalls[0]));
  var offCtx = exportedPng.canvas.__ctx;
  var textCalls = offCtx.calls.filter(function (c) { return c[0] === 'fillText'; }).map(function (c) { return c[1]; });
  assert.ok(textCalls.some(function (t) { return t.indexOf(C.DATA_VERSION) !== -1; }));
  var agg = C.aggregate(C.clean(C.buildDatasets().duplicate.raw), {
    startHour: 0, endHour: C.HOURS - 1,
    stationFilter: C.STATIONS.filter(function (s) { return s.id !== 'S08'; }).map(function (s) { return s.id; })
  });
  var expectedMax = C.formatValue(agg.stationStats[0].max);
  assert.strictEqual(beforeMax, expectedMax);
});

test('页面内置自检全部通过', function () {
  $('#run-selftest').click();
  var out = $('#selftest-out');
  assert.strictEqual(out.hidden, false);
  assert.ok(out.textContent.indexOf('FAIL') === -1, out.textContent);
  assert.ok(/全部通过/.test(out.textContent));
});

test('导出文件中的数值与屏幕一致（同一份聚合与同一格式化函数）', function () {
  var screenRows = $all('#station-table tbody tr').map(function (tr) {
    return [].slice.call(tr.querySelectorAll('td')).map(function (td) { return td.textContent; });
  });
  $('#view-switch button[data-view="profile"]').click();
  $('#export-png').click();
  var agg2 = C.aggregate(C.clean(C.buildDatasets().duplicate.raw), {
    startHour: 0, endHour: C.HOURS - 1,
    stationFilter: C.STATIONS.filter(function (s) { return s.id !== 'S08'; }).map(function (s) { return s.id; })
  });
  screenRows.forEach(function (cells, i) {
    var st = agg2.stationStats[i];
    assert.strictEqual(cells[3], C.formatValue(st.mean));
    assert.strictEqual(cells[4], C.formatValue(st.max));
    assert.strictEqual(cells[5], C.formatValue(st.min));
  });
  assert.ok(downloadCalls[downloadCalls.length - 1].indexOf('tide-profile-duplicate') === 0);
});

var failed = 0;
tests.forEach(function (t) {
  try {
    t.fn();
    console.log('  ✓ ' + t.name);
  } catch (e) {
    failed++;
    console.error('  ✗ ' + t.name + '\n    ' + e.message);
  }
});
console.log('\n' + (tests.length - failed) + '/' + tests.length + ' UI 测试通过');
process.exit(failed ? 1 : 0);
