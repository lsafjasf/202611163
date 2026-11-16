/* 渲染、输入、模式控制与回放查看器 */
(function () {
'use strict';
var L = window.BridgeLogic, A = window.BridgeAudio;
var C = L.C;

var canvas = document.getElementById('game');
var g = canvas.getContext('2d');

var state = L.createState();
var paused = false, debug = false, swapped = false;
var keys = {};
var lastTs = 0;
var endHandled = false;

var $ = function (id) { return document.getElementById(id); };

/* ---------- 输入:keydown/keyup 集合天然支持双人同时按键 ---------- */
window.addEventListener('keydown', function (e) {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].indexOf(e.code) >= 0) e.preventDefault();
  keys[e.code] = true;
  if (e.code === 'KeyP') togglePause();
  if (e.code === 'KeyR') restart();
  if (e.code === 'KeyT') toggleDebug();
  if (e.code === 'KeyX') toggleSwap();
});
window.addEventListener('keyup', function (e) { keys[e.code] = false; });

function togglePause() {
  paused = !paused;
  $('btnPause').classList.toggle('active', paused);
  setMessage(paused ? '已暂停' : '', 'warn');
}
function toggleDebug() {
  debug = !debug;
  $('btnDebug').classList.toggle('active', debug);
  $('modeLabel').textContent = '模式: ' + (debug ? '单人调试' : '双人');
}
function toggleSwap() {
  swapped = !swapped;
  $('btnSwap').classList.toggle('active', swapped);
  $('leftTitle').textContent = swapped ? '玩家 B · 左侧平台' : '玩家 A · 左侧平台';
  $('rightTitle').textContent = swapped ? '玩家 A · 右侧平台' : '玩家 B · 右侧平台';
  $('keysLeft').textContent = swapped ? '移动 ←/→ · 收放绳 ↑/↓' : '移动 A/D · 收放绳 W/S';
  $('keysRight').textContent = swapped ? '移动 A/D · 收放绳 W/S' : '移动 ←/→ · 收放绳 ↑/↓';
  log2panel('info', '控制侧已轮换');
}

function restart() {
  saveReplay(state);           // 保留上一局完整回放
  state = L.createState();     // 仪表、共享资源、倒计时全部复位
  paused = false; endHandled = false;
  $('btnPause').classList.remove('active');
  $('eventLog').innerHTML = '';
  setMessage('', '');
  A.reset();                   // 音效同步复位
  log2panel('info', '新的一局开始');
  updatePanel();
  draw(L.snapshot(state));
}

function setMessage(text, cls) {
  var m = $('message');
  m.textContent = text;
  m.className = cls || '';
}

var loggedCount = 0;
function log2panel(type, msg) {
  var div = document.createElement('div');
  div.className = type;
  div.textContent = '[' + state.time.toFixed(1) + 's] ' + msg;
  $('eventLog').appendChild(div);
  $('eventLog').scrollTop = 1e9;
}
function flushEvents() {
  while (loggedCount < state.events.length) {
    var ev = state.events[loggedCount++];
    log2panel(ev.type === 'conflict' ? 'conflict' : (ev.type === 'recover' || ev.type === 'success' ? 'recover' : 'info'), ev.msg);
  }
}

/* ---------- 主循环 ---------- */
function frame(ts) {
  requestAnimationFrame(frame);
  var dt = Math.min((ts - lastTs) / 1000, 0.05);
  lastTs = ts;
  if (paused) { draw(L.snapshot(state)); return; }
  var inputs = L.mapKeys(keys, swapped, debug);
  L.update(state, inputs, dt || 0.016);
  flushEvents();
  A.update(state, false);
  if (!endHandled && (state.phase === 'SUCCESS' || state.phase === 'FAILED')) {
    endHandled = true;
    if (state.phase === 'SUCCESS') { setMessage('任务成功!桥板更换完成,双方安全撤回', 'ok'); A.success(); }
    else { setMessage('任务失败:' + state.events[state.events.length - 1].msg, 'bad'); A.failure(); }
    saveReplay(state);
  }
  updatePanel();
  draw(L.snapshot(state));
}

/* ---------- 仪表:左右面板与共享资源读的是同一份 state,天然同步 ---------- */
function updatePanel() {
  var s = state;
  function set(id, val) { $(id).value = val; $(id + 'Val').textContent = Math.round(val); }
  set('tensionL', s.left.tension); set('stressL', s.left.stress); set('wearL', s.left.wear);
  set('tensionR', s.right.tension); set('stressR', s.right.stress); set('wearR', s.right.wear);
  $('posL').textContent = s.left.x.toFixed(1);
  $('posR').textContent = s.right.x.toFixed(1);
  $('hookL').textContent = s.left.attached ? '已挂接' : (s.left.hookLen > 1 ? '放绳中 ' + s.left.hookLen.toFixed(0) : '收起');
  $('hookR').textContent = s.right.attached ? '已挂接' : (s.right.hookLen > 1 ? '放绳中 ' + s.right.hookLen.toFixed(0) : '收起');
  set('integrity', s.integrity); set('wind', s.wind.force);
  $('progress').value = s.progress;
  $('progressVal').textContent = Math.round(s.progress) + '%';
  $('phaseLabel').textContent = '阶段: ' + L.PHASE_NAMES[s.phase];
  $('countdown').textContent = '倒计时 ' + s.countdown.toFixed(1) + 's';
  $('countdown').style.color = s.countdown < 30 ? '#ef6d6d' : '';
}

/* ---------- 场景绘制(实时状态与回放共用同一视图格式) ---------- */
function X(v) { return 80 + v * 8; }
function deckY(v, view) {
  var sag = 10 * Math.sin(Math.PI * v / 100);
  var sway = view.wdir * (view.wind / 100) * 12 * Math.sin(Math.PI * v / 100) * Math.sin(view.t * 1.3);
  var dip = 4 * Math.exp(-Math.pow((v - view.xL) / 4, 2)) + 4 * Math.exp(-Math.pow((v - view.xR) / 4, 2));
  return 250 + sag + sway + dip;
}
function stressColor(stress) {
  if (stress >= 85) return '#ef6d6d';
  if (stress >= 60) return '#e8c15a';
  return '#6fd68a';
}

function draw(view) {
  g.clearRect(0, 0, canvas.width, canvas.height);
  // 天空渐变与风
  g.fillStyle = '#0b1018'; g.fillRect(0, 0, 960, 480);
  g.strokeStyle = '#3d5170'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(60, 60 + view.wdir * 0); g.lineTo(60 + view.wdir * (20 + view.wind * 0.5), 60);
  g.moveTo(60 + view.wdir * (20 + view.wind * 0.5), 60);
  g.lineTo(60 + view.wdir * (12 + view.wind * 0.5), 54);
  g.moveTo(60 + view.wdir * (20 + view.wind * 0.5), 60);
  g.lineTo(60 + view.wdir * (12 + view.wind * 0.5), 66);
  g.stroke();
  g.fillStyle = '#7c8ba0'; g.font = '12px sans-serif';
  g.fillText('风 ' + Math.round(view.wind), 40, 45);

  // 桥塔
  [0, 100].forEach(function (v) {
    g.fillStyle = '#2b3a4f';
    g.fillRect(X(v) - 6, 110, 12, 160);
  });

  // 主缆:位置差导致横向拉弯,颜色随应力
  var posDiff = (view.xR - view.xL) - (C.DOCK_R - C.DOCK_L);
  var bend = posDiff * 1.5;
  var maxStress = Math.max(view.stressL, view.stressR);
  g.strokeStyle = stressColor(maxStress); g.lineWidth = 3;
  g.beginPath();
  for (var v = 0; v <= 100; v += 2) {
    var cy = 120 + 115 * Math.sin(Math.PI * v / 100);
    var cx = X(v) + bend * Math.sin(Math.PI * v / 100);
    if (v === 0) g.moveTo(cx, cy); else g.lineTo(cx, cy);
  }
  g.stroke();
  // 吊索
  g.lineWidth = 1; g.strokeStyle = '#4a5f80';
  for (var hv = 10; hv < 100; hv += 10) {
    var hx = X(hv) + bend * Math.sin(Math.PI * hv / 100);
    g.beginPath();
    g.moveTo(hx, 120 + 115 * Math.sin(Math.PI * hv / 100));
    g.lineTo(X(hv), deckY(hv, view));
    g.stroke();
  }

  // 桥面(分段绘制以表现形变,桥板槽位在 47..53)
  var lifted = view.lift > 0.02;
  g.lineWidth = 5; g.strokeStyle = '#5a6c86';
  var v0;
  for (v0 = 0; v0 < 100; v0 += 2) {
    if (lifted && v0 >= 46 && v0 < 52) continue; // 旧板吊出后留空槽
    g.beginPath();
    g.moveTo(X(v0), deckY(v0, view));
    g.lineTo(X(v0 + 2), deckY(v0 + 2, view));
    g.stroke();
  }
  // 栏杆
  g.lineWidth = 1.5; g.strokeStyle = '#77879e';
  g.beginPath();
  for (v0 = 0; v0 <= 100; v0 += 2) {
    var ry = deckY(v0, view) - 14;
    if (v0 === 0) g.moveTo(X(v0), ry); else g.lineTo(X(v0), ry);
  }
  g.stroke();
  for (v0 = 0; v0 <= 100; v0 += 5) {
    g.beginPath();
    g.moveTo(X(v0), deckY(v0, view));
    g.lineTo(X(v0), deckY(v0, view) - 14);
    g.stroke();
  }

  // 桥板:随起吊高度上升,随摆动偏移
  var plankX = X(50) + view.swing * 40;
  var plankY = deckY(50, view) + 2 - view.lift * 110;
  g.fillStyle = view.kind === 'new' ? '#4a8f5d' : '#8a6d4a';
  g.save();
  g.translate(plankX, plankY);
  g.rotate(view.swing * 0.25);
  g.fillRect(-24, -4, 48, 8);
  g.restore();

  // 平台与吊钩
  drawPlatform(view.xL, view.hookL, view.attL, view, plankX - 24, plankY, view.stressL, true);
  drawPlatform(view.xR, view.hookR, view.attR, view, plankX + 24, plankY, view.stressR, false);

  // 应力条
  drawStressBar(20, view.stressL, '左');
  drawStressBar(930, view.stressR, '右');

  if (debug) {
    g.fillStyle = '#9fc1ec'; g.font = '11px monospace';
    g.fillText('DEBUG t=' + view.t.toFixed(1) + ' phase=' + view.phase +
      ' lift=' + view.lift.toFixed(2) + ' swing=' + view.swing.toFixed(2) +
      ' posDiff=' + posDiff.toFixed(1), 300, 20);
  }
}

function drawPlatform(x, hookLen, attached, view, plankEdgeX, plankY, stress, isLeft) {
  var px = X(x), py = deckY(x, view);
  g.fillStyle = '#4a6ea9';
  g.fillRect(px - 20, py - 16, 40, 14);
  g.fillStyle = '#22314a';
  g.fillRect(px - 16, py - 24, 32, 8);
  // 吊钩绳:挂接后连到桥板边缘
  g.strokeStyle = stressColor(stress); g.lineWidth = 2;
  g.beginPath();
  g.moveTo(px, py - 2);
  if (attached) g.lineTo(plankEdgeX, plankY);
  else g.lineTo(px, py - 2 + hookLen * 3);
  g.stroke();
  if (!attached && hookLen > 0.5) {
    g.fillStyle = '#c9d4e4';
    g.fillRect(px - 3, py - 2 + hookLen * 3, 6, 6);
  }
  g.fillStyle = '#9fc1ec'; g.font = '11px sans-serif';
  g.fillText(isLeft ? '左平台' : '右平台', px - 18, py - 30);
}

function drawStressBar(x, stress, label) {
  g.fillStyle = '#22314a'; g.fillRect(x, 300, 12, 120);
  g.fillStyle = stressColor(stress);
  var h = stress / 100 * 120;
  g.fillRect(x, 420 - h, 12, h);
  g.fillStyle = '#7c8ba0'; g.font = '11px sans-serif';
  g.fillText(label, x - 2, 435);
}

/* ---------- 回放:localStorage 持久保存,结束自动留存 ---------- */
var REPLAY_KEY = 'bridgeReplays';
function saveReplay(s) {
  if (!s.replay.result || s.replay.snapshots.length < 5) return;
  if (s._saved) return;
  s._saved = true;
  var list = [];
  try { list = JSON.parse(localStorage.getItem(REPLAY_KEY) || '[]'); } catch (e) {}
  list.push({
    id: 'run-' + Date.now(),
    label: (s.replay.result.ok ? '成功' : '失败(' + s.replay.result.reason + ')') +
           ' · ' + s.replay.result.t + 's · ' + new Date().toLocaleTimeString(),
    data: s.replay
  });
  while (list.length > 5) list.shift();
  try { localStorage.setItem(REPLAY_KEY, JSON.stringify(list)); } catch (e) {}
}
function loadReplayList() {
  try { return JSON.parse(localStorage.getItem(REPLAY_KEY) || '[]'); } catch (e) { return []; }
}

var replayState = { list: [], current: null, playing: false, idx: 0 };
function openReplay() {
  if (!paused) togglePause(); // 查看回放时暂停对局
  replayState.list = loadReplayList();
  var sel = $('replaySelect');
  sel.innerHTML = '';
  replayState.list.forEach(function (r, i) {
    var o = document.createElement('option');
    o.value = i; o.textContent = r.label;
    sel.appendChild(o);
  });
  if (replayState.list.length === 0) { setMessage('暂无回放,先完成或失败一局', 'warn'); return; }
  sel.selectedIndex = replayState.list.length - 1;
  loadReplay(replayState.list.length - 1);
  $('replayOverlay').classList.remove('hidden');
}
function loadReplay(i) {
  replayState.current = replayState.list[i];
  replayState.idx = 0;
  replayState.playing = false;
  $('replayPlay').textContent = '播放';
  var snaps = replayState.current.data.snapshots;
  $('replayScrub').max = snaps.length - 1;
  // 时间轴冲突标记:红色=冲突,绿色=恢复
  var tl = $('replayTimeline');
  tl.innerHTML = '';
  var tMax = snaps[snaps.length - 1].t || 1;
  replayState.current.data.events.forEach(function (ev) {
    if (ev.type !== 'conflict' && ev.type !== 'recover' && ev.type !== 'fail') return;
    var m = document.createElement('div');
    m.className = 'marker' + (ev.type === 'recover' ? ' recover' : '');
    m.style.left = (ev.t / tMax * 99) + '%';
    m.title = ev.t.toFixed(1) + 's ' + ev.msg;
    m.addEventListener('click', function () { seekToTime(ev.t); });
    tl.appendChild(m);
  });
  drawReplayFrame();
}
function seekToTime(t) {
  var snaps = replayState.current.data.snapshots;
  var best = 0;
  for (var i = 0; i < snaps.length; i++) if (snaps[i].t <= t) best = i;
  replayState.idx = best;
  $('replayScrub').value = best;
  drawReplayFrame();
}
function drawReplayFrame() {
  var snaps = replayState.current.data.snapshots;
  var snap = snaps[Math.min(replayState.idx, snaps.length - 1)];
  var ctx2 = $('replayCanvas').getContext('2d');
  var saved = g; g = ctx2;           // 复用同一绘制函数
  var savedCanvas = canvas; canvas = $('replayCanvas');
  draw(snap);
  g = saved; canvas = savedCanvas;
  $('replayScrub').value = replayState.idx;
}

/* ---------- 按钮与启动 ---------- */
$('btnPause').addEventListener('click', togglePause);
$('btnRestart').addEventListener('click', restart);
$('btnDebug').addEventListener('click', toggleDebug);
$('btnSwap').addEventListener('click', toggleSwap);
$('btnReplay').addEventListener('click', openReplay);
$('replayClose').addEventListener('click', function () {
  $('replayOverlay').classList.add('hidden');
  replayState.playing = false;
});
$('replaySelect').addEventListener('change', function (e) { loadReplay(+e.target.value); });
$('replayScrub').addEventListener('input', function (e) {
  replayState.idx = +e.target.value;
  replayState.playing = false;
  drawReplayFrame();
});
$('replayPlay').addEventListener('click', function () {
  replayState.playing = !replayState.playing;
  $('replayPlay').textContent = replayState.playing ? '暂停' : '播放';
});
setInterval(function () {
  if (!replayState.playing || !replayState.current) return;
  var snaps = replayState.current.data.snapshots;
  replayState.idx++;
  if (replayState.idx >= snaps.length) { replayState.idx = snaps.length - 1; replayState.playing = false; $('replayPlay').textContent = '播放'; }
  drawReplayFrame();
}, 100);

// 若通过 http 服务访问,预载测试生成的完整回放样例
fetch('replays/cooperation.json').then(function (r) {
  if (!r.ok) return;
  return r.json();
}).then(function (data) {
  if (!data || !data.snapshots) return;
  var list = loadReplayList();
  if (!list.some(function (r) { return r.id === 'sample-cooperation'; })) {
    list.push({ id: 'sample-cooperation', label: '样例 · 完整协作成功回放', data: data });
    try { localStorage.setItem(REPLAY_KEY, JSON.stringify(list)); } catch (e) {}
  }
}).catch(function () {});

setMessage('双方将平台移至中央对接,更换桥板后安全撤回', 'warn');
requestAnimationFrame(frame);
})();
