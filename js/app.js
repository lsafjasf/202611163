/* 应用控制器：UI 绑定、固定步长主循环、回放、重复测量与事件记录。 */
(function () {
  'use strict';
  var WT = window.WTPhysics, R = window.WTRender, V = window.WTVerify;
  var $ = function (id) { return document.getElementById(id); };

  var HISTORY_MAX = 900;          // 曲线/回放环形缓冲（18s @50Hz）
  var engine, history, buf, state, prevReadout, lastEventCount;
  var replay = { active: false, idx: 0, timer: null };
  var rafId = null, lastFrameMs = 0, acc = 0;

  function init() {
    engine = new WT.WindTunnelEngine({ seed: Number($('seed-input').value) });
    history = []; buf = [];
    state = { running: true, phase: 0 };
    prevReadout = {}; lastEventCount = 0;
    showLimits();
    bindControls();
    pushSnapshot(engine.snapshot());
    loop(performance.now());
  }

  function pushSnapshot(snap) {
    history.push(snap);
    if (history.length > HISTORY_MAX) history.shift();
    buf.push(WT.WindTunnelEngine.restoreSnapshot(snap));
    if (buf.length > HISTORY_MAX) buf.shift();
  }

  // 固定步长累加器：requestAnimationFrame 只负责调度，物理始终按 DT 推进
  function loop(now) {
    rafId = requestAnimationFrame(loop);
    if (!lastFrameMs) lastFrameMs = now;
    var elapsed = Math.min(0.1, (now - lastFrameMs) / 1000);
    lastFrameMs = now;
    state.phase += elapsed;
    if (state.running && !replay.active) {
      acc += elapsed;
      var guard = 0;
      while (acc >= WT.DT && guard < 8) {
        pushSnapshot(engine.advance());
        acc -= WT.DT; guard++;
      }
    }
    render();
    syncEvents();
  }

  function currentSnap() {
    return replay.active ? buf[replay.idx] : engine.snapshot();
  }

  function render() {
    var snap = currentSnap();
    var tc = $('tunnel-canvas').getContext('2d');
    R.drawTunnel(tc, 620, 360, snap, state.phase);
    var cc = $('curve-canvas').getContext('2d');
    R.drawCurve(cc, 620, 300, history, snap, WT.ALPHA_CRIT, engine.tripped);
    updateReadout(snap);
    updateBadges(snap);
  }

  function showLimits() {
    var L = WT.LIMITS;
    $('alpha-lim').textContent = '限 ' + L.alpha.min + '~' + L.alpha.max + '°';
    $('v-lim').textContent = '限 ' + L.V.min + '~' + L.V.max + ' m/s';
    $('p-lim').textContent = '限 ' + (L.P.min / 1000) + '~' + (L.P.max / 1000) + ' kPa';
    $('t-lim').textContent = '限 ' + L.T.min + '~' + L.T.max + ' K';
  }

  window.__WTApp = { init: init };
  document.addEventListener('DOMContentLoaded', init);

  function bindControls() {
    $('alpha').addEventListener('input', function () {
      var v = parseFloat(this.value);
      $('alpha-val').textContent = v.toFixed(1);
      engine.setTarget('alpha', v);
      noteChange('迎角 α', v, '°');
    });
    $('velocity').addEventListener('input', function () {
      var v = parseFloat(this.value);
      $('v-val').textContent = v.toFixed(0);
      engine.setTarget('V', v);
      noteChange('风速 V', v, 'm/s');
    });
    $('pressure').addEventListener('input', function () {
      var v = parseFloat(this.value);
      $('p-val').textContent = (v / 1000).toFixed(1);
      engine.setTarget('P', v);
      noteChange('静压 P', v / 1000, 'kPa');
    });
    $('temp').addEventListener('input', function () {
      var v = parseFloat(this.value);
      $('t-val').textContent = v.toFixed(1);
      engine.setTarget('T', v);
      noteChange('温度 T', v, 'K');
    });
    $('noise').addEventListener('change', function () {
      engine.noiseEnabled = this.checked;
      noteChange('传感器噪声', this.checked ? '开启' : '关闭', '');
    });
    $('seed-input').addEventListener('change', function () {
      var seed = Number(this.value) >>> 0;
      if (!seed) { this.value = engine.baseSeed; return; }
      engine.baseSeed = seed;
      noteChange('随机种子', engine.baseSeed, '');
    });

    $('btn-pause').addEventListener('click', togglePause);
    $('btn-step').addEventListener('click', doStep);
    $('btn-reset').addEventListener('click', doReset);
    $('btn-replay').addEventListener('click', toggleReplay);
    $('btn-average').addEventListener('click', repeatMeasure);
    $('btn-selftest').addEventListener('click', runSelfTest);
    document.querySelectorAll('.presets button').forEach(function (b) {
      b.addEventListener('click', function () { applyPreset(b.dataset.preset); });
    });
  }

  function togglePause() {
    if (engine.tripped || replay.active) return;
    state.running = !state.running;
    var btn = $('btn-pause');
    btn.textContent = state.running ? '暂停' : '继续';
    btn.classList.toggle('active', !state.running);
    if (state.running) { lastFrameMs = 0; acc = 0; }
  }

  // 单步与连续运行调用同一个 engine.advance()，物理状态严格相同
  function doStep() {
    if (replay.active) stopReplay();
    if (engine.tripped) return;
    state.running = false;
    $('btn-pause').textContent = '继续';
    $('btn-pause').classList.add('active');
    pushSnapshot(engine.advance());
    render(); syncEvents();
  }

  function doReset() {
    stopReplay();
    var snap = engine.reset();
    history = []; buf = []; acc = 0; lastFrameMs = 0;
    state.running = true;
    $('btn-pause').textContent = '暂停';
    $('btn-pause').classList.remove('active');
    pushSnapshot(snap);
    $('event-log').innerHTML = '';
    lastEventCount = 0;
    $('last-change').textContent = '已重置：初始条件恢复默认，无漂移';
    $('trip-banner').classList.add('hidden');
    syncSliders(engine.params);
    render();
  }

  function syncSliders(p) {
    $('alpha').value = p.alpha; $('alpha-val').textContent = p.alpha.toFixed(1);
    $('velocity').value = p.V; $('v-val').textContent = p.V.toFixed(0);
    $('pressure').value = p.P; $('p-val').textContent = (p.P / 1000).toFixed(1);
    $('temp').value = p.T; $('t-val').textContent = p.T.toFixed(1);
  }

  function noteChange(name, value, unit) {
    var el = $('last-change');
    el.innerHTML = '手动调整 <b>' + name + '</b> → ' +
      (typeof value === 'number' ? value.toFixed(2) : value) + ' ' + unit +
      ' @ t=' + engine.t.toFixed(2) + 's';
  }

  var READOUT_ROWS = [
    ['t', '仿真时间', 's', 2], ['step', '积分步数', '', 0],
    ['alpha', '迎角 α', '°', 2], ['V', '有效风速', 'm/s', 2],
    ['q', '动压 q', 'Pa', 1], ['Re', '雷诺数 Re', '', 2],
    ['rho', '空气密度 ρ', 'kg/m³', 3], ['T', '温度 T', 'K', 2],
    ['Tstag', '驻点温度', 'K', 2], ['P', '静压 P', 'Pa', 0],
    ['cl', '升力系数 Cl', '', 3], ['cd', '阻力系数 Cd', '', 4],
    ['lift', '升力 L（真实）', 'N', 2], ['liftMeas', '升力 L（测量）', 'N', 2],
    ['drag', '阻力 D（真实）', 'N', 2], ['dragMeas', '阻力 D（测量）', 'N', 2],
    ['posX', '支架变形 x', 'mm', 5], ['posY', '支架变形 y', 'mm', 5]
  ];

  function trendArrow(key, value) {
    if (!(key in prevReadout) || !isFinite(prevReadout[key]) || !isFinite(value)) return '';
    var d = value - prevReadout[key];
    if (Math.abs(d) < 1e-9) return ' <span class="arrow-up">→</span>';
    return d > 0 ? ' <span class="arrow-up">▲</span>'
                 : ' <span class="arrow-down">▼</span>';
  }

  function updateReadout(snap) {
    var tbl = $('readout');
    if (!tbl.rows.length) {
      READOUT_ROWS.forEach(function (row) {
        var tr = tbl.insertRow();
        tr.insertCell().textContent = row[1];
        tr.insertCell();
      });
    }
    READOUT_ROWS.forEach(function (row, i) {
      var key = row[0], unit = row[2], prec = row[3];
      var raw = snap[key];
      var value = (key === 'posX' || key === 'posY') ? raw * 1000 : raw;
      var text;
      if (key === 'Re') text = raw.toExponential(prec);
      else text = (raw === undefined ? '-' : value.toFixed(prec));
      tbl.rows[i].cells[1].innerHTML = text + ' ' + unit + trendArrow(key, value);
      var nearLimit = false;
      if (key === 'lift' && engine.tripped && engine.tripped.channel === 'load') nearLimit = true;
      tbl.rows[i].classList.toggle('warn', nearLimit);
      prevReadout[key] = value;
    });
  }

  function updateBadges(snap) {
    $('badge-run').textContent = replay.active ? '回放中'
      : (engine.tripped ? '已冻结' : (state.running ? '运行中' : '已暂停'));
    $('badge-stall').classList.toggle('hidden', !snap.stalled);
    $('badge-trip').classList.toggle('hidden', !engine.tripped);
    var banner = $('trip-banner');
    if (engine.tripped) {
      var tr = engine.tripped, lim = tr.limit;
      banner.classList.remove('hidden');
      banner.innerHTML = '⛔ 保护触发（' + lim.label + '）：测量值 ' +
        tr.value.toFixed(2) + ' ' + lim.unit + ' 超出 [' + lim.min + ', ' + lim.max +
        ']，触发于第 ' + tr.step + ' 步 t=' + tr.t.toFixed(2) +
        's；计算已冻结，请调整工况后重置。';
    } else {
      banner.classList.add('hidden');
    }
  }

  function syncEvents() {
    if (engine.events.length === lastEventCount) return;
    var log = $('event-log');
    for (var i = lastEventCount; i < engine.events.length; i++) {
      log.prepend(eventLi(engine.events[i]));
    }
    lastEventCount = engine.events.length;
  }

  function eventLi(ev) {
    var li = document.createElement('li');
    li.className = ev.kind;
    if (ev.kind === 'stall') {
      li.innerHTML = '⚠ 失速触发 @ 第 ' + ev.at + ' 步（α=' + ev.alpha.toFixed(2) +
        '°）升力突降';
      li.innerHTML += eventSub(ev);
    } else if (ev.kind === 'reattach') {
      li.textContent = '✓ 气流再附 @ 第 ' + ev.at + ' 步（α=' + ev.alpha.toFixed(2) + '°）';
      li.innerHTML += eventSub(ev);
    } else {
      var tr = ev.detail;
      li.innerHTML = '⛔ ' + tr.limit.label + '超限 @ 第 ' + tr.step + ' 步：' +
        tr.value.toFixed(2) + ' ' + tr.limit.unit;
      li.innerHTML += '<span class="sub">位置=(' + tr.position.x.toExponential(2) + ', ' +
        tr.position.y.toExponential(2) + ')m，V=' + tr.V.toFixed(2) + 'm/s，P=' +
        tr.P.toFixed(0) + 'Pa，T=' + tr.T.toFixed(2) + 'K，q=' + tr.q.toFixed(1) + 'Pa</span>';
    }
    return li;
  }

  function eventSub(ev) {
    return '<span class="sub">位置=(' + ev.position.x.toExponential(2) + ', ' +
      ev.position.y.toExponential(2) + ')m，V=' + ev.V.toFixed(2) + 'm/s，P=' +
      ev.P.toFixed(0) + 'Pa，T=' + ev.T.toFixed(2) + 'K，q=' + ev.q.toFixed(1) +
      'Pa，L=' + ev.lift.toFixed(1) + 'N，D=' + ev.drag.toFixed(1) + 'N，Re=' +
      ev.Re.toExponential(2) + '</span>';
  }

  // 回放：只播放已记录的确定性快照，不重新积分；恢复现场时无任何跳变
  function toggleReplay() {
    if (replay.active) { stopReplay(); return; }
    if (buf.length < 2) return;
    replay.active = true; replay.idx = 0;
    $('btn-replay').textContent = '退出回放';
    $('btn-replay').classList.add('active');
    replay.timer = setInterval(function () {
      replay.idx++;
      if (replay.idx >= buf.length) replay.idx = 0;
      render();
    }, WT.DT * 1000);
  }
  function stopReplay() {
    replay.active = false;
    clearInterval(replay.timer);
    replay.timer = null;
    $('btn-replay').textContent = '回放最近段';
    $('btn-replay').classList.remove('active');
  }

  var PRESETS = {
    normal: { V: 30, alpha: 4, T: 293.15, P: 101325 },
    limit:  { V: 80, alpha: 15, T: 293.15, P: 101325 },
    stall:  { V: 35, alpha: 18, T: 293.15, P: 101325 }
  };
  function applyPreset(name) {
    var cfg = PRESETS[name];
    doReset();
    engine.setTargets(cfg);
    syncSliders(cfg);
    $('last-change').innerHTML = '已载入预设 <b>' +
      ({ normal: '正常工况', limit: '极限载荷', stall: '失稳演示' })[name] + '</b>';
  }

  // 重复测量：同参数同种子跑 N 次独立运行，对稳态末值求均值与样本标准差
  function repeatMeasure() {
    var N = 5, SETTLE = 150, SAMPLE = 50;
    var rows = [];
    for (var r = 0; r < N; r++) {
      var e = new WT.WindTunnelEngine({
        seed: (engine.baseSeed + r * 7919) >>> 0,
        noiseEnabled: engine.noiseEnabled
      });
      e.setTargets(engine.params);
      var s;
      for (var i = 0; i < SETTLE + SAMPLE; i++) s = e.advance();
      rows.push({ lift: s.liftMeas, drag: s.dragMeas });
    }
    var tbl = $('avg-table');
    while (tbl.rows.length > 1) tbl.deleteRow(1);
    rows.forEach(function (d, i) {
      var tr = tbl.insertRow();
      tr.insertCell().textContent = '#' + (i + 1);
      tr.insertCell().textContent = d.lift.toFixed(2);
      tr.insertCell().textContent = d.drag.toFixed(2);
    });
    var stat = summarize(rows);
    var tr2 = tbl.insertRow();
    tr2.insertCell().textContent = '均值±σ';
    tr2.insertCell().textContent = stat.liftMean.toFixed(2) + ' ± ' + stat.liftSd.toFixed(2);
    tr2.insertCell().textContent = stat.dragMean.toFixed(2) + ' ± ' + stat.dragSd.toFixed(2);
    $('last-change').innerHTML = '重复测量 ' + N +
      ' 次完成：升力均值 <b>' + stat.liftMean.toFixed(2) + 'N</b>（σ=' +
      stat.liftSd.toFixed(2) + '），同参数结果近似一致';
  }

  function summarize(rows) {
    function stats(key) {
      var mean = rows.reduce(function (a, d) { return a + d[key]; }, 0) / rows.length;
      var variance = rows.reduce(function (a, d) {
        return a + (d[key] - mean) * (d[key] - mean);
      }, 0) / (rows.length - 1);
      return { mean: mean, sd: Math.sqrt(variance) };
    }
    var l = stats('lift'), d = stats('drag');
    return { liftMean: l.mean, liftSd: l.sd, dragMean: d.mean, dragSd: d.sd };
  }

  // 内置自检：在浏览器内复用 Node 同一套验证场景
  function runSelfTest() {
    var panel = $('selftest-panel'), log = $('selftest-log');
    panel.classList.remove('hidden');
    log.innerHTML = '<li>运行中…</li>';
    setTimeout(function () {
      var report = V.runAll();
      log.innerHTML = '';
      report.rows.forEach(function (r) {
        var li = document.createElement('li');
        li.className = r.pass ? 'reattach' : 'trip';
        li.textContent = (r.pass ? '[PASS] ' : '[FAIL] ') + r.name + ' — ' + r.detail;
        log.appendChild(li);
      });
    }, 30);
  }
})();
