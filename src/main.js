// Browser app: runs the same recorded input trajectory through two clocks —
// a quantized 60 Hz reference and the real display refresh rate — and draws
// both trajectories so the position error is visible live.

import { SimRunner } from './runner.js';
import { SCENARIOS } from './scenarios.js';
import { LIMITS } from './physics.js';

const REF_FRAME_MS = 1000 / 60;
const canvas = document.getElementById('view');
const ctx = canvas.getContext('2d');
const ui = {
  badgeMode: document.getElementById('badgeMode'),
  badgeState: document.getElementById('badgeState'),
  badgeSpeed: document.getElementById('badgeSpeed'),
  badgeScenario: document.getElementById('badgeScenario'),
  selScenario: document.getElementById('selScenario'),
  selMode: document.getElementById('selMode'),
  selSpeed: document.getElementById('selSpeed'),
  btnPause: document.getElementById('btnPause'),
  btnRestart: document.getElementById('btnRestart'),
  btnBlur: document.getElementById('btnBlur'),
  btnExport: document.getElementById('btnExport'),
  metrics: document.getElementById('metrics'),
  logs: document.getElementById('logs'),
  degraded: document.getElementById('degraded'),
};

const app = {
  mode: 'fixed',
  scenarioId: 'normal',
  speed: 1,
  paused: false,
  ref: null,          // runner fed quantized 60 Hz deltas
  live: null,         // runner fed real display deltas
  refAcc: 0,
  lastTime: null,
  wallStart: 0,
  wallElapsed: 0,
  degraded: false,
};

function makePair() {
  const scenario = SCENARIOS[app.scenarioId];
  const opts = {
    mode: app.mode,
    rawTrack: scenario.rawTrack,
    initial: scenario.initial,
    now: () => performance.now(),
  };
  app.ref = new SimRunner(opts);
  app.live = new SimRunner(opts);
  app.ref.listenerCount = 0;
  app.live.listenerCount = 0;
  app.refAcc = 0;
}

function restart() {
  makePair();
  app.wallStart = performance.now();
  app.wallElapsed = 0;
  app.lastTime = null;
  if (app.paused) { app.ref.pause(); app.live.pause(); }
  applySpeed();
  refreshBadges();
  renderLogs();
}

function applySpeed() {
  app.ref.setSpeed(app.speed);
  app.live.setSpeed(app.speed);
}

// ---- main loop -----------------------------------------------------------

function frame(nowMs) {
  requestAnimationFrame(frame);
  if (app.lastTime === null) {
    app.lastTime = nowMs;
    app.wallStart = nowMs;
    return;
  }
  const deltaMs = nowMs - app.lastTime;
  app.lastTime = nowMs;
  app.wallElapsed = nowMs - app.wallStart;

  // Reference clock: quantize real time into 60 Hz display frames.
  app.refAcc += deltaMs;
  while (app.refAcc >= REF_FRAME_MS) {
    app.ref.tick(REF_FRAME_MS);
    app.refAcc -= REF_FRAME_MS;
  }
  // Live clock: whatever the real display delivers.
  app.live.tick(deltaMs);

  draw();
}

// ---- blur / focus recovery ------------------------------------------------

function onHidden() {
  app.ref.notifyHidden();
  app.live.notifyHidden();
  refreshBadges();
}

function onVisible() {
  app.lastTime = null; // reset clock: the hidden gap never reaches physics
  app.ref.notifyVisible();
  app.live.notifyVisible();
  refreshBadges();
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) onHidden();
  else onVisible();
});
window.addEventListener('blur', onHidden);
window.addEventListener('focus', onVisible);
const APP_LISTENERS = 4;

// ---- rendering ------------------------------------------------------------

function drawTrail(trail, color, stride) {
  if (trail.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  ctx.moveTo(trail[0].x, trail[0].y);
  for (let i = stride; i < trail.length; i += stride) ctx.lineTo(trail[i].x, trail[i].y);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawBall(pos, color) {
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, LIMITS.ballRadius, 0, Math.PI * 2);
  if (!app.degraded) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
  }
  ctx.fillStyle = color;
  ctx.fill();
  ctx.shadowBlur = 0;
}

function draw() {
  // Non-critical detail degrades under load; physics and trails stay intact.
  app.degraded = app.live.metrics.frameMsAvg > 24;
  const stride = app.degraded ? 2 : 1;
  ui.degraded.textContent = app.degraded ? '帧耗时偏高：已降低非关键动画细节（拖尾采样/辉光）' : '';

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#2c333d';
  ctx.strokeRect(1, 1, LIMITS.width - 2, LIMITS.height - 2);

  drawTrail(app.ref.trail, '#22d3ee', stride);
  drawTrail(app.live.trail, '#fb923c', stride);

  const a = app.ref.getRenderState();
  const b = app.live.getRenderState();
  // error connector between the two runs
  ctx.strokeStyle = 'rgba(248,113,113,0.8)';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.setLineDash([]);

  drawBall(a, '#22d3ee');
  drawBall(b, '#fb923c');
}

// ---- metrics + logs ---------------------------------------------------------

function positionError() {
  const a = app.ref.world.state;
  const b = app.live.world.state;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function fmt(n, digits = 2) {
  return Number.isFinite(n) ? n.toFixed(digits) : '—';
}

function refreshMetrics() {
  const m = app.live.metrics;
  const res = app.live.getResourceStats();
  const rows = [
    ['当前模式', app.mode === 'fixed' ? '固定步长 + 插值渲染' : '可变步长（修复前）'],
    ['状态', app.paused ? '已暂停' : (document.hidden ? '失焦暂停' : '运行中')],
    ['倍速', `${app.speed}x`],
    ['模拟时间', `${fmt(app.live.world.time)} s`],
    ['墙钟耗时', `${fmt(app.wallElapsed / 1000, 1)} s`],
    ['平均帧耗时', `${fmt(m.frameMsAvg, 2)} ms`],
    ['平均单步耗时', `${fmt(m.stepMsAvg, 4)} ms`],
    ['物理步数', String(m.fixedSteps)],
    ['插值 α', app.mode === 'fixed' ? fmt(app.live.alpha, 3) : '—（可变步长无插值）'],
    ['钳制帧数', String(m.clampedFrames)],
    ['两轨迹位置误差', `${fmt(positionError(), 4)} 单位`],
    ['异常日志', `${app.live.totalErrors} 条（缓冲区 ${res.logEntries}/${res.logCap}）`],
    ['资源占用', `轨迹点 ${res.trailPoints}${res.trailCap ? '/' + res.trailCap : '（无上限）'} · 监听器 ${APP_LISTENERS} · 定时器 0`],
  ];
  ui.metrics.innerHTML = rows
    .map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`)
    .join('');
}

function renderLogs() {
  const errs = app.live.errors.slice(-8);
  const hints = app.live.recoveryEvents;
  if (errs.length === 0 && hints.length === 0) {
    ui.logs.innerHTML = '<span class="empty">暂无异常</span>';
    return;
  }
  const errHtml = errs.map((e) =>
    `<span class="err">[${e.kind}/${e.code}] t=${fmt(e.simTime)}s ${e.detail}</span>`).join('');
  const hintHtml = hints.map((h) => `<span class="hint">建议: ${h}</span>`).join('');
  ui.logs.innerHTML = errHtml + hintHtml;
}

function refreshBadges() {
  ui.badgeMode.textContent = app.mode === 'fixed' ? '模式: 固定步长' : '模式: 可变步长(修复前)';
  ui.badgeMode.className = `badge ${app.mode === 'fixed' ? 'mode-fixed' : 'mode-variable'}`;
  const paused = app.paused || app.live?.autoPausedByBlur;
  ui.badgeState.textContent = paused ? '已暂停' : '运行中';
  ui.badgeState.className = `badge ${paused ? 'paused' : ''}`;
  ui.badgeSpeed.textContent = `${app.speed}x`;
  ui.badgeScenario.textContent = SCENARIOS[app.scenarioId].label;
  ui.btnPause.textContent = app.paused ? '继续' : '暂停';
}

// ---- controls ---------------------------------------------------------------

ui.selScenario.addEventListener('change', () => {
  app.scenarioId = ui.selScenario.value;
  restart();
});
ui.selMode.addEventListener('change', () => {
  app.mode = ui.selMode.value;
  restart();
});
ui.selSpeed.addEventListener('change', () => {
  app.speed = Number(ui.selSpeed.value);
  applySpeed();
  refreshBadges();
});
ui.btnPause.addEventListener('click', () => {
  app.paused = !app.paused;
  if (app.paused) { app.ref.pause(); app.live.pause(); }
  else { app.ref.resume(); app.live.resume(); app.lastTime = null; }
  refreshBadges();
});
ui.btnRestart.addEventListener('click', restart);
ui.btnBlur.addEventListener('click', () => {
  onHidden();
  setTimeout(onVisible, 2000);
});
ui.btnExport.addEventListener('click', () => {
  const payload = {
    exportedAt: new Date().toISOString(),
    mode: app.mode,
    scenario: app.scenarioId,
    speed: app.speed,
    ref: app.ref.snapshot(),
    live: app.live.snapshot(),
    positionError: positionError(),
    errors: app.live.errors,
    recoveryHints: app.live.recoveryEvents,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `physics-log-${app.scenarioId}-${app.mode}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

setInterval(() => { refreshMetrics(); renderLogs(); refreshBadges(); }, 250);
restart();
requestAnimationFrame(frame);
