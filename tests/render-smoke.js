/* 渲染冒烟：用记录型 canvas 桩执行全部绘制路径，校验坐标合法且在画布内 */
'use strict';
const fs = require('fs');
const path = require('path');
const P = require('../js/physics.js');

const W = 900, H = 560;
const calls = [];
function makeCtx() {
  return {
    canvas: { width: W, height: H },
    _fill: '', _stroke: '', lineWidth: 1,
    _path: [],
    set fillStyle(v) { this._fill = v; }, get fillStyle() { return this._fill; },
    set strokeStyle(v) { this._stroke = v; }, get strokeStyle() { return this._stroke; },
    font: '', globalAlpha: 1,
    clearRect() {}, save() {}, restore() {},
    translate(x, y) { calls.push(['translate', x, y]); },
    rotate(a) { if (Number.isNaN(a)) throw new Error('NaN rotate'); },
    scale() {},
    beginPath() { this._path = []; },
    moveTo(x, y) { this._path.push(['m', x, y]); },
    lineTo(x, y) { this._path.push(['l', x, y]); },
    quadraticCurveTo(cx, cy, x, y) { this._path.push(['q', x, y]); checkXY(cx, cy, 'quadC'); checkXY(x, y, 'quad'); },
    arc(x, y, r) { checkXY(x, y, 'arc'); if (!Number.isFinite(r)) throw new Error('NaN arc r'); },
    closePath() {},
    fillRect(x, y, w, h) { checkXY(x, y, 'fillRect'); checkXY(x + w, y + h, 'fillRect'); },
    strokeRect(x, y) { checkXY(x, y, 'strokeRect'); },
    fill() { for (const pt of this._path || []) if (typeof pt[1] === 'number') checkXY(pt[1], pt[2], 'fill'); },
    stroke() { for (const pt of this._path || []) if (typeof pt[1] === 'number') checkXY(pt[1], pt[2], 'stroke'); },
    fillText(t, x, y) { checkXY(x, y, 'fillText'); },
    setLineDash() { this._path = this._path || []; }, createLinearGradient() { return {}; }
  };
}
function checkXY(x, y, where) {
  if (typeof x !== 'number' || typeof y !== 'number' || Number.isNaN(x) || Number.isNaN(y)) {
    throw new Error('NaN/非法坐标 in ' + where + ': ' + x + ',' + y);
  }
  if (x < -200 || x > W + 200 || y < -200 || y > H + 200) {
    throw new Error('坐标越界 in ' + where + ': ' + x.toFixed(1) + ',' + y.toFixed(1));
  }
}

// 加载 Renderer（它挂到 globalThis）
global.HTMLCanvasElement = function () {};
global.document = {};
const rendererSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'render.js'), 'utf8');
eval(rendererSrc);

const canvas = { width: W, height: H, getContext: () => makeCtx() };
const renderer = new Renderer(canvas);

// 场景 1：正常运行中段
const sim = new P.WinchSim();
for (let i = 0; i < 300 && sim.status === 'running'; i++) sim.stepFrame(sim.autopilotInput());
renderer.draw(sim.snapshot(), sim.hoists, { showForce: true });

// 场景 2：带摆动与松弛
const sim2 = new P.WinchSim([
  { name: 'A', load: 400, cw: 1400, targetH: 6, lL0: 5, theta0: 0.2 },
  { name: 'B', load: 1400, cw: 1300, targetH: 9, lL0: 7, theta0: -0.15 }
]);
for (let i = 0; i < 40 && sim2.status === 'running'; i++) {
  sim2.stepFrame({ A: { targetOmega: 4, brakeOn: false }, B: { targetOmega: -3, brakeOn: false } });
}
renderer.draw(sim2.snapshot(), sim2.hoists, { showForce: true });

// 场景 3：跳闸后（断绳 + 冻结）
const sim3 = new P.WinchSim([
  { name: 'A', load: 3000, cw: 0, targetH: 6, lL0: 5 },
  { name: 'B', load: 200, cw: 3000, targetH: 9, lL0: 7 }
]);
for (let i = 0; i < 100 && sim3.status === 'running'; i++) {
  sim3.stepFrame({ A: { targetOmega: -8, brakeOn: false }, B: { targetOmega: 8, brakeOn: false } });
}
renderer.draw(sim3.snapshot(), sim3.hoists, { showForce: true });

console.log('PASS 渲染冒烟：3 个场景全部坐标合法、无 NaN、无越界');
console.log('PASS 跳闸场景状态=' + sim3.status + ' 类型=' + (sim3.trip && sim3.trip.code));
process.exit(0);
