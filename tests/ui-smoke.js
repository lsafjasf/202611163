/* 无头 UI 冒烟测试：jsdom 加载 index.html，验证控件与主循环逻辑 */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const dom = new JSDOM(html, {
  runScripts: 'outside-only',
  pretendToBeVisual: true
});
const { window } = dom;

// Canvas 2D 上下文最小桩
window.HTMLCanvasElement.prototype.getContext = function () {
  return new Proxy({}, { get: (t, p) => {
    if (p === 'canvas') return this;
    return typeof p === 'string' ? () => {} : undefined;
  }, set: () => true });
};
window.HTMLCanvasElement.prototype.getContext;

function load(file) {
  const code = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  window.eval(code);
}
load('js/physics.js');
load('js/audio.js');
load('js/render.js');
load('js/app.js');

const doc = window.document;
const app = window.__app;
let failures = 0;
function assert(cond, msg) {
  if (cond) console.log('PASS', msg);
  else { failures++; console.log('FAIL', msg); }
}

assert(!!app, '应用对象已初始化');
assert(doc.getElementById('metrics-A').innerHTML.length > 0, '面板 A 指标已渲染');
assert(doc.getElementById('metrics-B').innerHTML.length > 0, '面板 B 指标已渲染');

// 运行若干帧（自动控制）
doc.getElementById('btn-run').click();
assert(app.ui.running === true, '点击运行进入运行态');
for (let i = 0; i < 120; i++) {
  app.sim.stepFrame(app.currentInput());
}
app.ui.running = false;
const t1 = app.sim.time;
assert(t1 > 1.9 && t1 < 2.1, '推进约 2 秒，time=' + t1.toFixed(3));

// 暂停不推进
const snapBefore = JSON.stringify(app.sim.snapshot());
doc.getElementById('btn-pause').click();
assert(JSON.stringify(app.sim.snapshot()) === snapBefore, '暂停后物理状态冻结');

// 单步推进一帧
doc.getElementById('btn-step').click();
assert(app.sim.time > t1, '单步使时间推进，time=' + app.sim.time.toFixed(3));

// 回放
doc.getElementById('btn-replay').click();
assert(app.ui.replaying === true, '进入回放模式');
const scrub = doc.getElementById('replay-scrub');
scrub.value = 10;
scrub.dispatchEvent(new window.Event('input'));
assert(app.ui.replayIndex === 10, '回放拖动到第 10 帧');
const replaySnap = app.sim.snapshots[10];
assert(replaySnap.frame === 10, '回放快照帧号正确');

// 确定性复算
const rerun = app.sim.rerun();
assert(JSON.stringify(rerun.snapshot()) === JSON.stringify(app.sim.snapshot()),
  '确定性复算末帧一致');

// 重置无漂移
const initSnap = JSON.stringify(new app.P.WinchSim().snapshot());
doc.getElementById('btn-reset').click();
assert(JSON.stringify(app.sim.snapshot()) === initSnap, '重置后初始快照与新建实例一致');
assert(app.sim.time === 0 && app.sim.frame === 0, '重置归零');

console.log(`\nUI smoke: ${failures ? failures + ' failed' : 'all passed'}`);
process.exitCode = failures ? 1 : 0;
