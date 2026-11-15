/* app.js — 渲染 / UI / Web Audio / 场景验证 */
(function () {
'use strict';
var Sim = window.Sim;
var cv = document.getElementById('cv'), ctx = cv.getContext('2d');
var W = cv.width, H = cv.height, DECK = 190; // 桥面基准 y

var ui = {
  status: document.getElementById('status'),
  segHint: document.getElementById('segHint'),
  log: document.getElementById('log'),
  btnStart: document.getElementById('btnStart'),
  btnPause: document.getElementById('btnPause'),
  btnStep: document.getElementById('btnStep'),
  btnReset: document.getElementById('btnReset'),
  btnReplay: document.getElementById('btnReplay'),
  btnAudio: document.getElementById('btnAudio'),
  inSpeed: document.getElementById('inSpeed'),
  inGap: document.getElementById('inGap'),
  inLoad: document.getElementById('inLoad'),
  vSpeed: document.getElementById('vSpeed'),
  vGap: document.getElementById('vGap'),
  vLoad: document.getElementById('vLoad')
};

var cfg, st = null, mode = 'idle'; // idle|running|paused|finished
var reinforceLeft = 2;
var trace = [], lastRunCfg = null, lastTrace = null; // 回放验证用
var metrics = { t: 0, prev: null };

function readInputs() {
  return {
    speed: Sim.clamp(+ui.inSpeed.value, Sim.DEFAULTS.speedMin, Sim.DEFAULTS.speedMax),
    gap: Sim.clamp(+ui.inGap.value, Sim.DEFAULTS.gapMin, Sim.DEFAULTS.gapMax),
    loadMul: Sim.clamp(+ui.inLoad.value, Sim.DEFAULTS.loadMin, Sim.DEFAULTS.loadMax)
  };
}
function refreshLabels() {
  var p = readInputs();
  ui.vSpeed.textContent = p.speed + ' px/s';
  ui.vGap.textContent = p.gap + ' px';
  ui.vLoad.textContent = 'x ' + p.loadMul.toFixed(2);
}

function reset() {
  var p = readInputs();
  cfg = Sim.makeConfig({ speed: p.speed, gap: p.gap, loadMul: p.loadMul });
  st = Sim.createState(cfg); // 纯函数 => 多次重置初始条件不漂移
  mode = 'idle'; trace = [];
  reinforceLeft = 2;
  ui.segHint.textContent = '加固：点击桥面两个桥段进行加固（剩余 2 次）';
  setStatus('就绪 · f0=' + st.f0.toFixed(2) + 'Hz');
  ui.btnPause.disabled = true; ui.btnStep.disabled = false;
  ui.btnStart.disabled = false; ui.btnReplay.disabled = !lastRunCfg;
  updateMetrics(true);
  draw();
}

function setStatus(s) { ui.status.textContent = s; }

function logLine(s) {
  ui.log.textContent += s + '\n';
  ui.log.scrollTop = ui.log.scrollHeight;
}

/* ---------- 主循环：固定步长，暂停/单步/恢复状态一致 ---------- */
function frame() {
  if (mode === 'running') {
    Sim.stepFrame(st);
    if (st.frame % 30 === 0) trace.push({ f: st.frame, h: Sim.stateHash(st) });
    if (st.finished) onFinish();
    updateMetrics(false);
    audioUpdate();
  }
  draw();
  requestAnimationFrame(frame);
}

function onFinish() {
  mode = 'finished';
  var r = st.finished;
  var s = r.message + ' | t=' + r.t.toFixed(2) + 's';
  if (r.x != null) s += ' 触发点x=' + r.x.toFixed(0);
  s += ' v=' + r.speed + ' σ=' + r.stress.toFixed(1) + ' T=' + r.temp.toFixed(1);
  setStatus(s);
  logLine('[运行] ' + s);
  ui.btnPause.disabled = true; ui.btnStep.disabled = true;
  ui.btnReplay.disabled = false;
  lastRunCfg = cfg;
  lastTrace = trace.slice();
}

/* ---------- 渲染 ---------- */
function stressColor(r) { // r: 0..1 应力占比
  var h = 210 - 210 * Math.min(r, 1); // 蓝->红
  return 'hsl(' + h + ',85%,' + (45 + 15 * Math.min(r, 1)) + '%)';
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  if (!st) return;
  var n = cfg.N, dx = cfg.span / (n - 1), i;
  // 桥塔/支座
  ctx.fillStyle = '#3a4a6b';
  ctx.fillRect(cfg.x0 - 26, DECK, 26, H - DECK);
  ctx.fillRect(cfg.x0 + cfg.span, DECK, 26, H - DECK);
  // 桥段（按应力着色 + 受力方向箭头）
  for (i = 0; i < n - 1; i++) {
    var x1 = cfg.x0 + i * dx, x2 = x1 + dx;
    var y1 = DECK + st.y[i], y2 = DECK + st.y[i + 1];
    var mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - 12;
    var lim = cfg.stressLimit * (cfg.reinforced.indexOf(i) >= 0 ? 1.8 : 1);
    var r = st.segStress[i] / lim;
    ctx.strokeStyle = st.broken[i] ? '#222' : stressColor(r);
    ctx.lineWidth = cfg.reinforced.indexOf(i) >= 0 ? 9 : 5;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    // 受力方向：拉(红,向外)/压(蓝,向内)，恢复画面即可见趋势
    if (!st.broken[i] && st.segStress[i] > lim * 0.15) {
      var a = Math.min(st.segStress[i] / lim, 1) * 8 + 3;
      ctx.strokeStyle = stressColor(r); ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(mx - a, my); ctx.lineTo(mx - a - 4, my - 3);
      ctx.moveTo(mx - a, my); ctx.lineTo(mx - a - 4, my + 3);
      ctx.moveTo(mx + a, my); ctx.lineTo(mx + a + 4, my - 3);
      ctx.moveTo(mx + a, my); ctx.lineTo(mx + a + 4, my + 3);
      ctx.stroke();
    }
    // 加固标记
    if (cfg.reinforced.indexOf(i) >= 0) {
      ctx.fillStyle = '#ffd54f';
      ctx.fillRect(mx - 3, Math.max(y1, y2) + 6, 6, 6);
    }
  }
  // 节点
  ctx.fillStyle = '#8b98b0';
  for (i = 0; i < n; i++) ctx.fillRect(cfg.x0 + i * dx - 1, DECK + st.y[i] - 1, 2, 2);
  // 触发点标记
  if (st.finished && st.finished.x != null) {
    var fx = st.finished.x;
    ctx.strokeStyle = '#ff5252'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(fx - 10, DECK - 40); ctx.lineTo(fx + 10, DECK - 20);
    ctx.moveTo(fx + 10, DECK - 40); ctx.lineTo(fx - 10, DECK - 20); ctx.stroke();
    ctx.fillStyle = '#ff5252';
    ctx.fillText('触发点', fx - 16, DECK - 46);
  }
  // 车辆
  st.cars.forEach(function (c, idx) {
    if (c.done) return;
    var cy = c.on ? DECK + c.y - 18 : DECK - 18;
    ctx.fillStyle = ['#4fc3f7', '#aed581', '#ffb74d'][idx % 3];
    ctx.fillRect(c.x - 16, cy, 32, 14);
    ctx.fillStyle = '#10141c';
    ctx.beginPath(); ctx.arc(c.x - 9, cy + 16, 4, 0, 7); ctx.arc(c.x + 9, cy + 16, 4, 0, 7); ctx.fill();
    ctx.fillStyle = '#10141c'; ctx.font = '10px sans-serif';
    ctx.fillText(String(idx + 1), c.x - 3, cy + 11);
  });
  // 共振提示
  if (st.exciteFreq > 0) {
    var near = Math.abs(st.exciteFreq - st.f0) < 0.3 * st.f0;
    ctx.fillStyle = near ? '#ff8a65' : '#8b98b0';
    ctx.font = '13px sans-serif';
    ctx.fillText('激励 ' + st.exciteFreq.toFixed(2) + 'Hz / 固有 ' + st.f0.toFixed(2) + 'Hz'
      + (near ? ' ⚠共振区' : ''), 16, 24);
  }
  if (mode === 'paused') {
    ctx.fillStyle = '#ffd54f'; ctx.font = '14px sans-serif';
    ctx.fillText('⏸ 已暂停（单步与连续运行状态一致）', 16, 44);
  }
}

/* ---------- 关键物理量与最近变化 ---------- */
function setDelta(id, dv, unit) {
  var el = document.getElementById(id);
  if (Math.abs(dv) < 1e-9) { el.textContent = ''; el.className = 'delta'; return; }
  el.textContent = (dv > 0 ? '▲+' : '▼') + dv.toFixed(1) + unit;
  el.className = 'delta ' + (dv > 0 ? 'up' : 'down');
}
function updateMetrics(force) {
  if (!st) return;
  var now = { s: st.maxStress, y: st.centerDefl, w: st.staticLoad || 0, T: st.maxTemp };
  document.getElementById('mStress').textContent = now.s.toFixed(1) + ' / ' + cfg.stressLimit;
  document.getElementById('mDefl').textContent = now.y.toFixed(1) + ' px';
  document.getElementById('mWeight').textContent = (now.w / (cfg.carMass * cfg.gCar)).toFixed(2) + ' 车';
  document.getElementById('mTemp').textContent = now.T.toFixed(1) + ' °C';
  document.getElementById('mFreq').textContent =
    (st.exciteFreq ? st.exciteFreq.toFixed(2) : '-') + ' / ' + st.f0.toFixed(2) + ' Hz';
  if (force || st.t - metrics.t >= 0.25) {
    if (metrics.prev) {
      setDelta('dStress', now.s - metrics.prev.s, '');
      setDelta('dDefl', now.y - metrics.prev.y, '');
      setDelta('dWeight', (now.w - metrics.prev.w) / (cfg.carMass * cfg.gCar), '车');
      setDelta('dTemp', now.T - metrics.prev.T, '°');
    }
    metrics.prev = now; metrics.t = st.t;
  }
}

/* ---------- 控件 ---------- */
ui.btnStart.onclick = function () {
  if (mode === 'idle' || mode === 'finished') {
    if (mode === 'finished') reset();
    mode = 'running';
    ui.btnStart.disabled = true; ui.btnPause.disabled = false; ui.btnStep.disabled = true;
    setStatus('运行中');
    audioEnsure();
  }
};
ui.btnPause.onclick = function () {
  if (mode === 'running') {
    mode = 'paused';
    ui.btnPause.textContent = '继续';
    ui.btnStep.disabled = false;
    setStatus('已暂停 · 受力方向见桥面箭头');
    if (gain && ac) gain.gain.setTargetAtTime(0, ac.currentTime, 0.03);
    draw(); // 恢复画面展示受力方向/趋势
  } else if (mode === 'paused') {
    mode = 'running';
    ui.btnPause.textContent = '暂停';
    ui.btnStep.disabled = true;
    setStatus('运行中');
  }
};
ui.btnStep.onclick = function () {
  if (mode === 'idle') { mode = 'paused'; ui.btnPause.disabled = false; ui.btnPause.textContent = '继续'; }
  if (mode !== 'paused') return;
  Sim.stepFrame(st); // 与连续运行完全相同的固定步长
  if (st.frame % 30 === 0) trace.push({ f: st.frame, h: Sim.stateHash(st) });
  if (st.finished) onFinish();
  updateMetrics(false);
  draw();
};
ui.btnReset.onclick = function () {
  ui.btnPause.textContent = '暂停';
  reset();
};
ui.btnReplay.onclick = function () {
  if (!lastRunCfg) return;
  var st2 = Sim.createState(lastRunCfg); // 同参数重跑
  var i = 0, ok = true;
  while (!st2.finished && st2.frame < 60 * 240 * 4) {
    Sim.stepFrame(st2);
    if (st2.frame % 30 === 0 && lastTrace && i < lastTrace.length) {
      if (lastTrace[i].f === st2.frame && lastTrace[i].h !== Sim.stateHash(st2)) ok = false;
      i++;
    }
  }
  logLine('[回放] 关键帧 ' + i + ' 个 · ' +
    (ok ? '状态指纹全部一致，关键状态无跳变 ✓' : '出现偏差 ✗'));
  setStatus(ok ? '回放验证通过' : '回放验证失败');
};

// 点击桥面加固两个桥段
cv.addEventListener('click', function (e) {
  if (mode === 'running') return;
  if (reinforceLeft <= 0) return;
  var rect = cv.getBoundingClientRect();
  var px = (e.clientX - rect.left) * (cv.width / rect.width);
  var dx = cfg.span / (cfg.N - 1);
  var seg = Math.round((px - cfg.x0) / dx - 0.5);
  seg = Sim.clamp(seg, 0, cfg.N - 2);
  if (cfg.reinforced.indexOf(seg) >= 0) return;
  cfg.reinforced.push(seg);
  reinforceLeft--;
  ui.segHint.textContent = reinforceLeft > 0
    ? '加固：已加固段 ' + cfg.reinforced.join(', ') + '（剩余 ' + reinforceLeft + ' 次）'
    : '加固：已加固段 ' + cfg.reinforced.join(', ') + '（已用完）';
  draw();
});

[ui.inSpeed, ui.inGap, ui.inLoad].forEach(function (el) {
  el.addEventListener('input', function () {
    refreshLabels();
    if (mode === 'idle') reset(); // 参数变更即重建初始状态
  });
});

/* ---------- Web Audio：张力映射音高/响度 ---------- */
var ac = null, osc = null, gain = null, audioOn = false;
function audioEnsure() {
  if (ac) return;
  try {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    osc = ac.createOscillator(); gain = ac.createGain();
    osc.type = 'sawtooth'; gain.gain.value = 0;
    osc.connect(gain); gain.connect(ac.destination); osc.start();
  } catch (e) { ac = null; }
}
function audioUpdate() {
  if (!ac || !audioOn || !st) return;
  var tension = Math.min(st.maxStress / cfg.stressLimit, 1.5);
  osc.frequency.setTargetAtTime(70 + tension * 320, ac.currentTime, 0.05);
  gain.gain.setTargetAtTime(0.02 + Math.min(st.oscAmp / cfg.oscMax, 1) * 0.09,
    ac.currentTime, 0.05);
}
ui.btnAudio.onclick = function () {
  audioEnsure();
  audioOn = !audioOn;
  if (ac && ac.state === 'suspended') ac.resume();
  if (!audioOn && gain) gain.gain.setTargetAtTime(0, ac.currentTime, 0.03);
  ui.btnAudio.textContent = '声音: ' + (audioOn ? '开' : '关');
};

/* ---------- 场景验证：正常 / 极限载荷 / 失稳，各跑两遍校验一致性 ---------- */
function runScenarios(name, over) {
  var f0 = Sim.estimateNaturalFreq(Sim.makeConfig({}));
  if (over.gap === 'reso') over.gap = Math.round(over.speed / f0);
  function once() {
    var r = Sim.runScenario(over, 90), res = r.result;
    return { r: res, h: r.hash };
  }
  var a = once(), b = once();
  var same = a.h === b.h && a.r.type === b.r.type;
  var s = '[' + name + '] ' + a.r.message +
    ' | t=' + a.r.t.toFixed(2) + 's' +
    (a.r.x != null ? ' 触发点x=' + a.r.x.toFixed(0) : '') +
    ' v=' + a.r.speed +
    ' σ=' + a.r.stress.toFixed(1) +
    ' T=' + a.r.temp.toFixed(1) +
    ' | 重复' + (same ? '一致✓' : '不一致✗');
  logLine(s);
  return same;
}
document.getElementById('btnScnNormal').onclick = function () {
  runScenarios('正常工况', { speed: 120, gap: 200, loadMul: 1.0 });
};
document.getElementById('btnScnLimit').onclick = function () {
  runScenarios('极限载荷', { speed: 60, gap: 120, loadMul: 2.8 });
};
document.getElementById('btnScnUnstable').onclick = function () {
  runScenarios('失稳共振', { speed: 100, gap: 'reso', loadMul: 1.0 });
};

/* ---------- 初始化 ---------- */
refreshLabels();
reset();
requestAnimationFrame(frame);

})();
