/* sim.js — 确定性弹性桥物理核心（无 DOM，可在 Node 中运行）
 * 固定步长积分：dt = 1/240 s，每帧 4 子步 => 暂停/单步/恢复状态完全一致。
 * 所有触发（断裂/超载/过热/失稳）在越限瞬间冻结计算并记录触发点。
 */
(function (global) {
'use strict';

var DEFAULTS = {
  N: 25,               // 桥节点数
  x0: 60,              // 桥左端 x (px)
  span: 840,           // 桥长 (px)
  nodeMass: 1.0,
  k1: 800,             // 相邻节点弹簧
  k2: 280,             // 弯曲刚度（次近邻）
  damp: 3.2,           // 节点阻尼
  gNode: 260,          // 桥自重加速度 px/s^2
  gCar: 1400,          // 车辆重力加速度 px/s^2
  carMass: 6.0,        // 单车质量（乘载重系数）
  suspK: 620,          // 车辆悬挂刚度
  suspC: 30,           // 车辆悬挂阻尼
  dt: 1 / 240,
  substeps: 4,
  nCars: 3,
  // 限值（超出即触发并冻结，不继续计算）
  stressLimit: 115,    // 桥段应力限值（加固段 x1.8）
  loadLimitCars: 5.0,  // 桥上静态载重限值（单车静载倍数）
  tempMax: 120,        // 温度上限 (°C)
  tempAmb: 20,         // 环境温度
  ampMax: 150,         // 中心挠度绝对限值 (px)
  oscMax: 60,          // 振动包络失稳限值 (px)
  oscDecay: 0.998,     // 包络衰减/帧
  // 温度模型
  heatRate: 0.0016,    // 应力生热
  coolRate: 0.25,      // 散热
  // 共振模型：车辆通过频率接近固有频率时载荷放大
  resoBoost: 0.85,
  resoWidth: 0.30,
  // 输入上下限（UI 截断）
  speedMin: 20, speedMax: 300,
  gapMin: 40, gapMax: 400,
  loadMin: 0.5, loadMax: 3.0
};

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

function makeConfig(over) {
  var c = {};
  for (var k in DEFAULTS) c[k] = DEFAULTS[k];
  if (over) for (var k2 in over) c[k2] = over[k2];
  // 输入截断
  c.speed = clamp(c.speed == null ? 120 : c.speed, c.speedMin, c.speedMax);
  c.gap = clamp(c.gap == null ? 200 : c.gap, c.gapMin, c.gapMax);
  c.loadMul = clamp(c.loadMul == null ? 1 : c.loadMul, c.loadMin, c.loadMax);
  if (!c.reinforced) c.reinforced = []; // 加固段索引（最多2个）
  return c;
}

/* 桥基频：离散梁一模态解析解（确定性，与积分器完全一致） */
function estimateNaturalFreq(cfg) {
  var a = Math.PI / (cfg.N - 1);
  var w2 = 2 * cfg.k1 * (1 - Math.cos(a)) + 2 * cfg.k2 * (1 - Math.cos(2 * a));
  return Math.sqrt(w2 / cfg.nodeMass) / (2 * Math.PI);
}

/* 节点内力积分（车辆载荷通过 loads 数组传入） */
function integrateNodes(cfg, y, vy, loads, dt, broken) {
  var n = cfg.N, i;
  var F = integrateNodes._F || (integrateNodes._F = new Float64Array(64));
  for (i = 0; i < n; i++) F[i] = -cfg.gNode * cfg.nodeMass - cfg.damp * vy[i];
  for (i = 0; i < n; i++) {
    if (broken && (broken[i - 1] || broken[i])) continue; // 断裂段不传力
    var k1 = cfg.k1, k2 = cfg.k2;
    if (i > 0 && !(broken && broken[i - 1])) F[i] += k1 * (y[i - 1] - y[i]);
    if (i < n - 1 && !(broken && broken[i])) F[i] += k1 * (y[i + 1] - y[i]);
    if (i > 1 && !(broken && broken[i - 1])) F[i] += k2 * (y[i - 2] - y[i]);
    if (i < n - 2 && !(broken && broken[i])) F[i] += k2 * (y[i + 2] - y[i]);
  }
  if (loads) for (i = 0; i < n; i++) F[i] += loads[i];
  for (i = 0; i < n; i++) {
    if (i === 0 || i === n - 1) { vy[i] = 0; y[i] = 0; continue; } // 简支边界
    vy[i] += (F[i] / cfg.nodeMass) * dt;
    y[i] += vy[i] * dt;
  }
}

/* 创建初始状态 —— 纯函数，重置不漂移 */
function createState(cfg) {
  var n = cfg.N;
  var st = {
    cfg: cfg,
    t: 0, frame: 0,
    y: new Float64Array(n), vy: new Float64Array(n),
    segStress: new Float64Array(n - 1),
    segTemp: new Float64Array(n - 1),
    broken: new Array(n - 1).fill(false),
    cars: [],
    loads: new Float64Array(n),
    f0: cfg.f0 || (cfg.f0 = estimateNaturalFreq(cfg)),
    deflMax: 0, deflMin: 0, oscAmp: 0,
    totalLoad: 0, maxStress: 0, maxTemp: cfg.tempAmb,
    centerDefl: 0, exciteFreq: 0,
    finished: null,   // {type, x, speed, stress, temp, t, message}
    events: []
  };
  for (var i = 0; i < n - 1; i++) st.segTemp[i] = cfg.tempAmb;
  for (var c = 0; c < cfg.nCars; c++) {
    var m = cfg.carMass * cfg.loadMul;
    st.cars.push({
      x: cfg.x0 - 60 - c * cfg.gap, // 依次排队上桥
      y: m * cfg.gCar / cfg.suspK, vy: 0, on: false, done: false,
      mass: m
    });
  }
  return st;
}

/* 单个子步：车辆运动 -> 载荷分配（含共振放大） -> 节点积分 */
function substep(st, dt) {
  var cfg = st.cfg, n = cfg.N, dx = cfg.span / (n - 1);
  var i, c, car;
  st.loads.fill(0);
  var onCars = [];
  var staticLoad = 0;
  for (c = 0; c < st.cars.length; c++) {
    car = st.cars[c];
    if (car.done) continue;
    car.x += cfg.speed * dt;
    var xEnd = cfg.x0 + cfg.span;
    if (car.x > xEnd + 50) { car.done = true; car.on = false; continue; }
    car.on = car.x >= cfg.x0 && car.x <= xEnd;
    if (!car.on) { car.y = 0; car.vy = 0; continue; }
    onCars.push(car);
    staticLoad += car.mass * cfg.gCar;
    var fx = (car.x - cfg.x0) / dx;
    var i0 = clamp(Math.floor(fx), 0, n - 2);
    var tt = fx - i0;
    var yb = st.y[i0] * (1 - tt) + st.y[i0 + 1] * tt;
    var vb = st.vy[i0] * (1 - tt) + st.vy[i0 + 1] * tt;
    // 车辆悬挂动力学
    var Fs = -cfg.suspK * (car.y - yb) - cfg.suspC * (car.vy - vb) + car.mass * cfg.gCar;
    car.vy += (Fs / car.mass) * dt;
    car.y += car.vy * dt;
    // 作用在桥上的动载荷（悬挂反力）
    var L = cfg.suspK * (car.y - yb) + cfg.suspC * (car.vy - vb);
    car.load = L; car.i0 = i0; car.tt = tt;
  }
  // 共振放大：多车在桥且通过频率接近固有频率
  var boost = 1;
  st.exciteFreq = 0;
  if (onCars.length >= 2) {
    var minGap = Infinity;
    for (i = 1; i < onCars.length; i++)
      minGap = Math.min(minGap, Math.abs(onCars[i].x - onCars[i - 1].x));
    var f = cfg.speed / Math.max(minGap, 1);
    st.exciteFreq = f;
    var rel = (f - st.f0) / (cfg.resoWidth * st.f0);
    boost = 1 + cfg.resoBoost * (onCars.length - 1) * Math.exp(-rel * rel);
  }
  for (c = 0; c < onCars.length; c++) {
    car = onCars[c];
    var Lb = car.load * boost;
    st.loads[car.i0] += Lb * (1 - car.tt);
    st.loads[car.i0 + 1] += Lb * car.tt;
  }
  integrateNodes(cfg, st.y, st.vy, st.loads, dt, st.broken);
  st.staticLoad = staticLoad;
}

/* 应力 / 温度 / 载重统计与限值触发（越限即冻结） */
function evaluate(st) {
  var cfg = st.cfg, n = cfg.N, i;
  var dx = cfg.span / (n - 1);
  var kStress = 0.055 * dx; // 曲率 -> 应力系数
  var maxS = 0, maxSi = -1, total = 0, maxT = cfg.tempAmb;
  // 节点曲率（简支边界弯矩为零）
  var curv = evaluate._c || (evaluate._c = new Float64Array(64));
  curv[0] = 0; curv[n - 1] = 0;
  for (i = 1; i < n - 1; i++) curv[i] = st.y[i - 1] - 2 * st.y[i] + st.y[i + 1];
  for (i = 0; i < n - 1; i++) {
    if (st.broken[i]) { st.segStress[i] = 0; continue; }
    var s = kStress * 0.5 * (Math.abs(curv[i]) + Math.abs(curv[i + 1]))
          + 0.0016 * (st.loads[i] + st.loads[i + 1]);
    var rein = cfg.reinforced.indexOf(i) >= 0;
    if (rein) s *= 0.45;
    st.segStress[i] = s;
    // 温度：应力生热 - 环境散热
    var T = st.segTemp[i];
    T += (cfg.heatRate * s * s - cfg.coolRate * (T - cfg.tempAmb)) * cfg.dt * cfg.substeps;
    st.segTemp[i] = T;
    if (T > maxT) maxT = T;
    if (s > maxS) { maxS = s; maxSi = i; }
  }
  for (i = 0; i < n; i++) total += st.loads[i];
  st.totalLoad = total;
  st.maxStress = maxS;
  st.maxTemp = maxT;
  st.centerDefl = st.y[n >> 1];
  // 振动包络（区分准静态下沉与共振失稳）
  st.deflMax = Math.max(st.centerDefl, st.deflMax * cfg.oscDecay);
  st.deflMin = Math.min(st.centerDefl, st.deflMin * cfg.oscDecay);
  st.oscAmp = (st.deflMax - st.deflMin) / 2;

  var lim = cfg.stressLimit;
  if (maxSi >= 0 && cfg.reinforced.indexOf(maxSi) >= 0) lim *= 1.8;
  // 温度软化：限值随温度下降
  lim *= 1 - 0.3 * clamp((maxT - cfg.tempAmb) / (cfg.tempMax - cfg.tempAmb), 0, 1);

  var trig = null;
  if (maxS > lim) trig = { type: 'broken', message: '应力超限，桥段断裂' };
  else if ((st.staticLoad || 0) > cfg.loadLimitCars * cfg.carMass * cfg.gCar)
    trig = { type: 'overload', message: '桥上载重超限' };
  else if (maxT > cfg.tempMax) trig = { type: 'overheat', message: '温度超限' };
  else if (st.oscAmp > cfg.oscMax || Math.abs(st.centerDefl) > cfg.ampMax)
    trig = { type: 'unstable', message: '振幅超限，共振失稳' };
  if (trig) {
    var seg = maxSi >= 0 ? maxSi : (n >> 1);
    var car0 = null;
    for (i = 0; i < st.cars.length; i++) if (st.cars[i].on) { car0 = st.cars[i]; break; }
    st.finished = {
      type: trig.type, message: trig.message,
      x: cfg.x0 + seg * cfg.span / (n - 1),
      speed: cfg.speed,
      stress: maxS, temp: maxT, t: st.t,
      carX: car0 ? car0.x : null
    };
    st.events.push(st.finished);
    return;
  }
  var allDone = true;
  for (i = 0; i < st.cars.length; i++) if (!st.cars[i].done) { allDone = false; break; }
  if (allDone) {
    st.finished = {
      type: 'success', message: '全部车辆安全通过',
      x: null, speed: cfg.speed, stress: maxS, temp: maxT, t: st.t, carX: null
    };
    st.events.push(st.finished);
  }
}

/* 一帧 = substeps 个子步，确定性 */
function stepFrame(st) {
  if (st.finished) return;
  for (var s = 0; s < st.cfg.substeps; s++) {
    substep(st, st.cfg.dt);
    st.t += st.cfg.dt;
  }
  st.frame++;
  evaluate(st);
}

/* 状态指纹：用于重复运行 / 回放一致性校验 */
function stateHash(st) {
  var h = 0, i;
  function mix(v) { h = (h * 31 + Math.round(v * 1e4)) % 1000000007; }
  for (i = 0; i < st.y.length; i++) { mix(st.y[i]); mix(st.vy[i]); }
  for (i = 0; i < st.cars.length; i++) { mix(st.cars[i].x); mix(st.cars[i].y); }
  mix(st.maxStress); mix(st.maxTemp); mix(st.totalLoad);
  return h;
}

/* 无头场景运行：快进直到结束或超时，返回结果与指纹 */
function runScenario(over, maxT) {
  var cfg = makeConfig(over);
  var st = createState(cfg);
  var maxFrames = Math.round((maxT || 60) / (cfg.dt * cfg.substeps));
  while (!st.finished && st.frame < maxFrames) stepFrame(st);
  if (!st.finished) st.finished = { type: 'timeout', message: '超时未结束', t: st.t };
  return { cfg: cfg, state: st, result: st.finished, hash: stateHash(st) };
}

var API = {
  DEFAULTS: DEFAULTS, makeConfig: makeConfig, createState: createState,
  stepFrame: stepFrame, stateHash: stateHash, runScenario: runScenario,
  estimateNaturalFreq: estimateNaturalFreq, clamp: clamp
};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else global.Sim = API;

})(typeof window !== 'undefined' ? window : globalThis);
