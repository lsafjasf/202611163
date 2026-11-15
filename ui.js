// 浏览器端接线：渲染、音效、键盘、回放
(function () {
  'use strict';

  // ---- 音效：引擎声随速度/负载变化 ----
  function createAudio() {
    var ctx = null, osc = null, lfo = null, gain = null;
    function ensure() {
      if (ctx) return;
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      osc = ctx.createOscillator(); osc.type = 'sawtooth';
      lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 6;
      var lfoGain = ctx.createGain(); lfoGain.gain.value = 0;
      gain = ctx.createGain(); gain.gain.value = 0.04;
      lfo.connect(lfoGain); lfoGain.connect(osc.frequency);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(); lfo.start();
      osc._lfoGain = lfoGain;
    }
    function beep(freq, dur, type) {
      ensure();
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type || 'square'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.15, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + dur);
    }
    return {
      setEngine: function (p) {
        if (!ctx) return;
        // 负载越大音调越低、抖动越强；速度越快音调越高
        osc.frequency.value = 60 + p.rpm * 120 - p.load * 25;
        osc._lfoGain.gain.value = 2 + p.load * 14 + (p.rearWheelsOff ? 20 : 0);
        gain.gain.value = 0.03 + p.rpm * 0.04 + p.load * 0.02;
      },
      event: function (type) {
        if (type === 'collision') beep(90, 0.3, 'sawtooth');
        else if (type === 'box_dropped' || type === 'box_destroyed') beep(60, 0.5, 'sawtooth');
        else if (type === 'pickup' || type === 'repickup') beep(440, 0.12);
        else if (type === 'delivered') beep(660, 0.2);
        else if (type === 'win') { beep(523, 0.15); setTimeout(function(){beep(784,0.3);},150); }
        else if (type === 'wheel_lift') beep(220, 0.25, 'triangle');
      },
      reset: function () {
        if (!ctx) return;
        osc.frequency.value = 60; gain.gain.value = 0.03; osc._lfoGain.gain.value = 2;
      }
    };
  }

  var game = ForkliftGame.createGame({ audio: createAudio() });
  var canvas = document.getElementById('game');
  var ctx2d = canvas.getContext('2d');
  var C = game.CONFIG;
  var replayMode = false, replayData = null, replayIdx = 0;

  // ---- 键盘：两套键可同时按下（keydown/keyup 各自独立跟踪）----
  var HANDLED = ['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'];
  window.addEventListener('keydown', function (e) {
    if (HANDLED.indexOf(e.code) >= 0) { game.setKey(e.code, true); e.preventDefault(); }
    else if (e.code === 'KeyP') game.togglePause();
    else if (e.code === 'KeyR') doRestart();
    else if (e.code === 'KeyT') game.toggleDebug();
    else if (e.code === 'Tab') { game.swapRoles(); e.preventDefault(); }
  });
  window.addEventListener('keyup', function (e) {
    if (HANDLED.indexOf(e.code) >= 0) game.setKey(e.code, false);
  });

  document.getElementById('btnPause').onclick = function () { game.togglePause(); };
  document.getElementById('btnRestart').onclick = doRestart;
  document.getElementById('btnDebug').onclick = function () { game.toggleDebug(); };
  document.getElementById('btnSwap').onclick = function () { game.swapRoles(); };
  document.getElementById('btnReplay').onclick = toggleReplay;

  function doRestart() {
    game.restart();
    replayMode = false;
    document.getElementById('replayPanel').style.display = 'none';
  }

  // ---- 渲染 ----
  function drawShelf(r) {
    ctx2d.fillStyle = '#4a3b2a'; ctx2d.fillRect(r.x, r.y, r.w, r.h);
    ctx2d.strokeStyle = '#6b5738'; ctx2d.strokeRect(r.x + 3, r.y + 3, r.w - 6, r.h - 6);
  }

  function drawFrame(snap) {
    var s = game.state;
    var tx = snap ? snap.x : s.truck.x, ty = snap ? snap.y : s.truck.y;
    var heading = snap ? snap.heading : s.truck.heading;
    var fh = snap ? snap.h : s.fork.h, tilt = snap ? snap.tilt : s.fork.tilt;
    var carrying = snap ? snap.carrying : !!s.carrying;
    ctx2d.clearRect(0, 0, canvas.width, canvas.height);
    // 地面网格
    ctx2d.strokeStyle = '#262d38';
    for (var gx = 0; gx < canvas.width; gx += 40) { ctx2d.beginPath(); ctx2d.moveTo(gx, 0); ctx2d.lineTo(gx, canvas.height); ctx2d.stroke(); }
    for (var gy = 0; gy < canvas.height; gy += 40) { ctx2d.beginPath(); ctx2d.moveTo(0, gy); ctx2d.lineTo(canvas.width, gy); ctx2d.stroke(); }
    // 取货站 / 交付区
    ctx2d.fillStyle = 'rgba(80,140,220,.25)'; ctx2d.fillRect(C.pickupStation.x, C.pickupStation.y, C.pickupStation.w, C.pickupStation.h);
    ctx2d.fillStyle = 'rgba(90,220,130,.25)'; ctx2d.fillRect(C.dropZone.x, C.dropZone.y, C.dropZone.w, C.dropZone.h);
    ctx2d.fillStyle = '#8fd0ff'; ctx2d.fillText('取货站', C.pickupStation.x + 18, C.pickupStation.y - 6);
    ctx2d.fillStyle = '#7bff9e'; ctx2d.fillText('交付区', C.dropZone.x + 30, C.dropZone.y - 6);
    C.shelves.forEach(drawShelf);
    // 地面散箱
    if (!snap) s.boxes.forEach(function (b) {
      ctx2d.fillStyle = '#c9a25e'; ctx2d.fillRect(b.x - 9, b.y - 9, 18, 18);
      ctx2d.fillStyle = '#14181f'; ctx2d.fillText(b.integrity, b.x - 10, b.y + 4);
    });
    // 叉车
    ctx2d.save();
    ctx2d.translate(tx, ty); ctx2d.rotate(heading);
    var wheelsOff = snap ? snap.wheelsOff : s.truck.rearWheelsOff;
    ctx2d.fillStyle = wheelsOff ? '#e0a33e' : '#3f8fe0';
    ctx2d.fillRect(-C.truck.w / 2, -C.truck.h / 2, C.truck.w, C.truck.h);
    // 后轮（离地时翘起提示）
    ctx2d.fillStyle = wheelsOff ? '#ff7b7b' : '#14181f';
    ctx2d.fillRect(-C.truck.w / 2 - 3, -C.truck.h / 2, 6, 8);
    ctx2d.fillRect(-C.truck.w / 2 - 3, C.truck.h / 2 - 8, 6, 8);
    // 前轮
    ctx2d.fillStyle = '#14181f';
    ctx2d.fillRect(C.truck.w / 2 - 3, -C.truck.h / 2, 6, 8);
    ctx2d.fillRect(C.truck.w / 2 - 3, C.truck.h / 2 - 8, 6, 8);
    // 货叉（高度用颜色深浅，倾斜用角度）
    ctx2d.save();
    ctx2d.translate(C.truck.w / 2, 0); ctx2d.rotate(tilt * 0.25);
    ctx2d.fillStyle = fh > 0.6 ? '#d0d8e2' : '#8a96a6';
    ctx2d.fillRect(0, -C.truck.h / 2 + 3, C.truck.forkLen, 4);
    ctx2d.fillRect(0, C.truck.h / 2 - 7, C.truck.forkLen, 4);
    if (carrying) {
      ctx2d.fillStyle = '#c9a25e';
      ctx2d.fillRect(C.truck.forkLen - 18, -9, 18, 18);
    }
    ctx2d.restore();
    ctx2d.restore();
  }

  // ---- HUD ----
  function el(id) { return document.getElementById(id); }
  function updateHud() {
    var d = game.getDashboards();
    el('dSpeed').textContent = d.driver.speed.toFixed(0);
    el('dSpeedBar').style.width = Math.min(100, Math.abs(d.driver.speed) / C.truck.maxSpeed * 100) + '%';
    el('dSteer').textContent = d.driver.steer.toFixed(2);
    el('dWheels').textContent = d.driver.rearWheelsOff ? '离地!' : '着地';
    el('dWheels').className = d.driver.rearWheelsOff ? 'warn' : 'ok';
    var recentCrash = game.state.events.some(function (e) { return e.type === 'collision' && game.state.time - e.t < 800; });
    el('dCollision').textContent = recentCrash ? '撞货架!' : '无';
    el('dCollision').className = recentCrash ? 'warn' : '';
    el('oFork').textContent = Math.round(d.operator.forkHeight * 100) + '%';
    el('oForkBar').style.width = (d.operator.forkHeight * 100) + '%';
    el('oTilt').textContent = d.operator.tilt.toFixed(2);
    el('oLoad').textContent = d.operator.load > 0 ? '载货' : '空';
    el('oIntegrity').textContent = d.operator.boxIntegrity == null ? '-' : d.operator.boxIntegrity;
    el('sDelivered').textContent = d.shared.delivered;
    el('sStock').textContent = d.shared.stock;
    el('sLost').textContent = d.shared.lost;
    el('sGround').textContent = d.shared.groundBoxes;
    el('sTime').textContent = (d.shared.timeLeft / 1000).toFixed(1);
    el('sCg').textContent = d.shared.cg.toFixed(2);
    el('sCg').style.color = d.shared.cg > 0.85 ? '#ff7b7b' : '';
    el('driverSide').textContent = game.state.swapped ? '(方向键)' : '(WASD)';
    el('opSide').textContent = game.state.swapped ? '(WASD)' : '(方向键)';
    el('driverKeys').textContent = game.state.swapped ? '↑↓ 前进/后退 ←→ 转向' : 'W/S 前进/后退 A/D 转向';
    el('opKeys').textContent = game.state.swapped ? 'W/S 货叉升降 A/D 倾斜' : '↑↓ 货叉升降 ←→ 倾斜';
    el('btnDebug').className = game.state.debugSolo ? 'active' : '';
    el('btnSwap').className = game.state.swapped ? 'active' : '';
    el('btnPause').className = game.state.paused ? 'active' : '';
    var banner = el('banner');
    if (game.state.phase === 'won') { banner.textContent = '✔ 任务成功：完成 3 次装卸！'; banner.style.color = '#7bff9e'; }
    else if (game.state.phase === 'lost') { banner.textContent = '✘ 任务失败：货物耗尽或超时'; banner.style.color = '#ff7b7b'; }
    else if (game.state.paused) { banner.textContent = '‖ 已暂停'; banner.style.color = '#ffd97b'; }
    else banner.textContent = '';
  }

  // ---- 回放查看器 ----
  var CONFLICT_TYPES = ['collision', 'box_dropped', 'box_destroyed', 'wheel_lift'];
  function toggleReplay() {
    var panel = el('replayPanel');
    replayMode = !replayMode;
    if (replayMode) {
      replayData = game.state.replay.length > 0 ? game.getReplay() : game.getLastReplay();
      if (!replayData || replayData.frames.length === 0) { replayMode = false; return; }
      panel.style.display = 'block';
      var tl = el('timeline');
      tl.max = replayData.frames.length - 1; tl.value = 0; replayIdx = 0;
      var list = el('replayEvents');
      list.innerHTML = replayData.events.map(function (e) {
        var conflict = CONFLICT_TYPES.indexOf(e.type) >= 0;
        return '<div class="' + (conflict ? 'conflict' : '') + '">' +
          (e.t / 1000).toFixed(1) + 's ' + (conflict ? '● ' : '') + e.type + '</div>';
      }).join('');
    } else {
      panel.style.display = 'none';
    }
  }
  el('timeline').addEventListener('input', function (e) { replayIdx = +e.target.value; });

  // ---- 主循环 ----
  var last = performance.now();
  function loop(now) {
    var dt = Math.min(50, now - last); last = now;
    if (!replayMode) {
      game.update(dt);
      drawFrame(null);
    } else if (replayData) {
      var frame = replayData.frames[Math.min(replayIdx, replayData.frames.length - 1)];
      drawFrame(frame);
      el('replayInfo').textContent = 't=' + (frame.t / 1000).toFixed(1) + 's 已交付=' + frame.delivered +
        ' 库存=' + frame.stock + ' 损失=' + frame.lost + (frame.wheelsOff ? ' [后轮离地]' : '');
    }
    updateHud();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
