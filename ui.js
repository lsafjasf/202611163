/* 浏览器端：Canvas 取景器 + Web Audio + 键盘输入 + 回放 */
(function () {
  'use strict';
  var game = CameraEngine.createGame();
  var C = game.constants;
  var canvas = document.getElementById('view');
  var ctx = canvas.getContext('2d');
  var SX = canvas.width / C.WORLD.w, SY = canvas.height / C.WORLD.h;

  // ---------- 音频 ----------
  var AC = window.AudioContext || window.webkitAudioContext;
  var ac = null, motorOsc = null, motorGain = null;
  function ensureAudio() {
    if (!ac) {
      ac = new AC();
      motorOsc = ac.createOscillator();
      motorOsc.type = 'sawtooth';
      motorOsc.frequency.value = 70;
      motorGain = ac.createGain();
      motorGain.gain.value = 0;
      motorOsc.connect(motorGain).connect(ac.destination);
      motorOsc.start();
    }
    if (ac.state === 'suspended') ac.resume();
  }
  function motor(on, freq) {
    if (!ac) return;
    motorOsc.frequency.setTargetAtTime(freq || 70, ac.currentTime, 0.02);
    motorGain.gain.setTargetAtTime(on ? 0.05 : 0, ac.currentTime, 0.03);
  }
  function blip(freq, dur, type, vol) {
    if (!ac) return;
    var o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(vol || 0.15, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
    o.connect(g).connect(ac.destination);
    o.start(); o.stop(ac.currentTime + dur);
  }
  function shutterSound() { // 快门：短噪声爆破
    if (!ac) return;
    var buf = ac.createBuffer(1, ac.sampleRate * 0.08, ac.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    var src = ac.createBufferSource(); src.buffer = buf;
    var g = ac.createGain(); g.gain.value = 0.4;
    src.connect(g).connect(ac.destination); src.start();
  }
  function stopAllSound() { if (ac) motor(false); }

  game.onEvent(function (ev) {
    if (ev.type === 'shot_ok') { shutterSound(); blip(660, 0.15); blip(880, 0.25); }
    if (ev.type === 'conflict') { shutterSound(); blip(160, 0.4, 'square', 0.2); }
    if (ev.type === 'gameover') {
      stopAllSound();
      if (ev.reason === 'win') { blip(523, 0.2); setTimeout(function(){blip(784,0.4);},200); }
      else blip(110, 0.8, 'sawtooth', 0.2);
    }
    if (ev.type === 'restart') stopAllSound();
    if (ev.type === 'input') motor(ev.pressed, ev.action.indexOf('pan') === 0 ? 70 : 110);
  });

  // ---------- 键盘 ----------
  // 物理侧固定：左=WASD+Space，右=方向键+Enter；职责由引擎按轮换映射
  var KEYMAP = {
    KeyA: ['left', 'panLeft'], KeyD: ['left', 'panRight'],
    KeyW: ['left', 'panUp'], KeyS: ['left', 'panDown'],
    ArrowLeft: ['right', 'expoDown'], ArrowRight: ['right', 'expoUp'],
    ArrowUp: ['right', 'focusFar'], ArrowDown: ['right', 'focusNear']
  };
  // 轮换后同一物理侧改控另一职责
  function remap(code) {
    var m = KEYMAP[code];
    if (!m) return null;
    var side = m[0], dom = game.domainOf(side);
    if (dom === 'gimbal') {
      var pans = { KeyA: 'panLeft', KeyD: 'panRight', KeyW: 'panUp', KeyS: 'panDown',
        ArrowLeft: 'panLeft', ArrowRight: 'panRight', ArrowUp: 'panUp', ArrowDown: 'panDown' };
      return [side, pans[code]];
    }
    var opt = { KeyA: 'expoDown', KeyD: 'expoUp', KeyW: 'focusFar', KeyS: 'focusNear',
      ArrowLeft: 'expoDown', ArrowRight: 'expoUp', ArrowUp: 'focusFar', ArrowDown: 'focusNear' };
    return [side, opt[code]];
  }
  document.addEventListener('keydown', function (e) {
    ensureAudio();
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      game.pressShutter(e.code === 'Space' ? 'left' : 'right');
      return;
    }
    if (e.code === 'KeyP') { togglePause(); return; }
    if (e.code === 'KeyR') { doRestart(); return; }
    if (e.code === 'KeyT') { game.swapSides(); refreshRoles(); return; }
    if (e.code === 'KeyG') { game.toggleDebug(); refreshRoles(); return; }
    var m = remap(e.code);
    if (m) { e.preventDefault(); game.setHeld(m[0], m[1], true); }
  });
  document.addEventListener('keyup', function (e) {
    var m = remap(e.code);
    if (m) game.setHeld(m[0], m[1], false);
  });

  // ---------- 渲染 ----------
  function drawScene(st) {
    // 亮度分区背景
    var zones = [[0, 0.33, '#20232e'], [0.33, 0.66, '#3a3f4a'], [0.66, 1, '#6a7080']];
    zones.forEach(function (z) {
      ctx.fillStyle = z[2];
      ctx.fillRect(z[0] * canvas.width, 0, (z[1] - z[0]) * canvas.width, canvas.height);
    });
    // 目标（按对焦误差产生焦外模糊）
    var s = st.subject;
    var blur = Math.min(18, Math.abs(st.focus - s.dist) * 2.2);
    ctx.save();
    if (ctx.filter !== undefined) ctx.filter = 'blur(' + blur.toFixed(1) + 'px)';
    ctx.fillStyle = '#ffd54a';
    ctx.beginPath();
    ctx.arc(s.x * SX, s.y * SY, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(s.x * SX - 8, s.y * SY - 6, 4, 0, Math.PI * 2);
    ctx.arc(s.x * SX + 8, s.y * SY - 6, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // 曝光误差：过曝发白 / 欠曝发黑
    var expoErr = st.exposure - s.brightness;
    if (expoErr > 0.05) {
      ctx.fillStyle = 'rgba(255,255,255,' + Math.min(0.75, expoErr * 0.3) + ')';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else if (expoErr < -0.05) {
      ctx.fillStyle = 'rgba(0,0,0,' + Math.min(0.75, -expoErr * 0.3) + ')';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    // 构图框
    var g = st.gimbal;
    var r = st.ready;
    ctx.strokeStyle = r.comp ? '#4c4' : '#ff6b6b';
    ctx.lineWidth = 2;
    ctx.strokeRect((g.x - C.FRAME.w / 2) * SX, (g.y - C.FRAME.h / 2) * SY,
      C.FRAME.w * SX, C.FRAME.h * SY);
    // 取景器信息
    ctx.fillStyle = '#fff';
    ctx.font = '12px monospace';
    ctx.fillText('对焦 ' + st.focus.toFixed(1) + 'm / 目标 ' + s.dist.toFixed(1) + 'm' +
      (r.focus ? ' OK' : ' --'), 10, 18);
    ctx.fillText('曝光 ' + st.exposure.toFixed(2) + 'EV / 场景 ' + s.brightness.toFixed(2) +
      (r.expo ? ' OK' : ' --'), 10, 34);
    if (st.status === 'paused' || st.status === 'won' || st.status === 'lost') {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = st.status === 'won' ? '#7ee787' : st.status === 'lost' ? '#ff6b6b' : '#fff';
      ctx.font = 'bold 28px sans-serif';
      var msg = st.status === 'won' ? '成功！三张照片完成' :
        st.status === 'lost' ? '失败：' + (st.film <= 0 ? '胶片耗尽' : '时间到') : '已暂停';
      ctx.fillText(msg, canvas.width / 2 - ctx.measureText(msg).width / 2, canvas.height / 2);
    }
  }

  function setMeter(id, ratio, ok) {
    var el = document.getElementById(id);
    el.style.width = Math.round(Math.max(0, Math.min(1, ratio)) * 100) + '%';
    el.className = 'fill ' + (ok ? 'ok' : 'bad');
  }

  function refreshHUD() {
    var st = game.getState();
    document.getElementById('film').textContent = st.film;
    document.getElementById('score').textContent = st.score;
    document.getElementById('clock').textContent = (st.timeLeft / 1000).toFixed(1);
    document.getElementById('status').textContent =
      st.status === 'running' ? '进行中' :
      st.status === 'paused' ? '已暂停' :
      st.status === 'won' ? '成功！' : '失败';
    // 两侧面板读同一共享状态 —— 保持同步
    var compRatio = 1 - Math.min(1,
      Math.hypot(st.subject.x - st.gimbal.x, st.subject.y - st.gimbal.y) / 300);
    setMeter('mComp', compRatio, st.ready.comp);
    var fRatio = 1 - Math.min(1, Math.abs(st.focus - st.subject.dist) / 4);
    setMeter('mFocusL', fRatio, st.ready.focus);
    setMeter('mFocusR', (st.focus - C.FOCUS_MIN) / (C.FOCUS_MAX - C.FOCUS_MIN), st.ready.focus);
    var eRatio = 1 - Math.min(1, Math.abs(st.exposure - st.subject.brightness) / 2);
    setMeter('mExpoL', eRatio, st.ready.expo);
    setMeter('mExpoR', (st.exposure - C.EXPO_MIN) / (C.EXPO_MAX - C.EXPO_MIN), st.ready.expo);
  }

  function refreshRoles() {
    var gl = game.domainOf('left') === 'gimbal';
    document.getElementById('roleL').textContent = gl ? '云台' : '对焦+曝光';
    document.getElementById('roleR').textContent = gl ? '对焦+曝光' : '云台';
    document.getElementById('keysL').innerHTML = gl
      ? '<kbd>WASD</kbd> 移动构图框<br><kbd>Space</kbd> 快门'
      : '<kbd>W/S</kbd> 对焦 <kbd>A/D</kbd> 曝光<br><kbd>Space</kbd> 快门';
    document.getElementById('keysR').innerHTML = gl
      ? '<kbd>↑↓</kbd> 对焦 <kbd>←→</kbd> 曝光<br><kbd>Enter</kbd> 快门'
      : '<kbd>方向键</kbd> 移动构图框<br><kbd>Enter</kbd> 快门';
    document.getElementById('btnDebug').className = game.isDebugSolo() ? 'active' : '';
  }

  // ---------- 事件日志 ----------
  var eventsEl = document.getElementById('events');
  game.onEvent(function (ev) {
    if (ev.type !== 'conflict' && ev.type !== 'shot_ok' && ev.type !== 'gameover') return;
    var div = document.createElement('div');
    var t = (ev.t / 1000).toFixed(1) + 's';
    if (ev.type === 'conflict') {
      div.className = 'conflict';
      div.textContent = t + ' 冲突：' + (ev.side === 'left' ? '左' : '右') +
        '侧快门失败 [' + ev.reasons.join(',') + '] 胶片剩' + ev.film;
    } else if (ev.type === 'shot_ok') {
      div.className = 'ok';
      div.textContent = t + ' 拍摄成功 第' + ev.score + '张';
    } else {
      div.textContent = t + (ev.reason === 'win' ? ' 任务成功' : ' 任务失败：' + ev.reason);
    }
    eventsEl.insertBefore(div, eventsEl.firstChild);
  });

  // ---------- 按钮 ----------
  function togglePause() {
    var st = game.getState();
    if (st.status === 'running') { game.pause(); stopAllSound(); }
    else if (st.status === 'paused') game.resume();
  }
  function doRestart() {
    game.restart();
    eventsEl.innerHTML = '';
    exitReplay();
  }
  document.getElementById('btnPause').onclick = function () { ensureAudio(); togglePause(); };
  document.getElementById('btnRestart').onclick = function () { ensureAudio(); doRestart(); };
  document.getElementById('btnSwap').onclick = function () { game.swapSides(); refreshRoles(); };
  document.getElementById('btnDebug').onclick = function () { game.toggleDebug(); refreshRoles(); };

  // ---------- 回放 ----------
  var replayData = null, replayIdx = 0;
  var replayBox = document.getElementById('replayBox');
  var scrub = document.getElementById('scrub');
  function enterReplay() {
    var arch = game.getArchivedReplays();
    var cur = game.getState();
    var data = arch.length ? arch[arch.length - 1]
      : { events: cur.events, replay: cur.replay };
    if (!data.replay.length) return;
    replayData = data;
    game.pause();
    replayBox.style.display = 'flex';
    scrub.max = data.replay.length - 1;
    scrub.value = 0;
    showReplayFrame(0);
  }
  function exitReplay() {
    replayData = null;
    replayBox.style.display = 'none';
  }
  function showReplayFrame(i) {
    replayIdx = i;
    var snap = replayData.replay[i];
    drawScene(snap);
    // 标记该时刻附近的冲突事件
    var marks = replayData.events.filter(function (e) {
      return e.type === 'conflict' && Math.abs(e.t - snap.t) < 500;
    });
    document.getElementById('replayTime').textContent =
      (snap.t / 1000).toFixed(1) + 's' +
      (marks.length ? ' ⚠冲突[' + marks[0].reasons.join(',') + ']' : '');
  }
  scrub.oninput = function () { showReplayFrame(+scrub.value); };
  document.getElementById('btnReplay').onclick = function () {
    if (replayData) exitReplay(); else enterReplay();
  };

  // ---------- 主循环 ----------
  var last = performance.now();
  function loop(now) {
    var dt = Math.min(50, now - last);
    last = now;
    if (!replayData) {
      game.tick(dt);
      drawScene(game.getState());
    }
    refreshHUD();
    requestAnimationFrame(loop);
  }
  refreshRoles();
  requestAnimationFrame(loop);
})();
