/* 应用主控：UI 绑定、固定步长循环、暂停/单步/重置、回放、确定性复算 */
(function () {
  'use strict';
  const P = globalThis.WinchPhysics;
  const $ = (id) => document.getElementById(id);

  const sim = new P.WinchSim();
  const renderer = new Renderer($('scene'));
  const audio = new TensionAudio();

  const ui = {
    running: false,
    replaying: false,
    replayIndex: 0,
    auto: true,
    showForce: true,
    sound: false,
    manual: {
      A: { targetOmega: 0, brakeOn: true, hardBrake: false },
      B: { targetOmega: 0, brakeOn: true, hardBrake: false }
    },
    prevMetrics: { A: null, B: null }
  };

  // 每个卷扬面板的可编辑参数
  const panelCfg = [
    { id: 'A', load: 800, cw: 700 },
    { id: 'B', load: 1400, cw: 1300 }
  ];

  function buildPanels() {
    for (const cfg of panelCfg) {
      const el = $('panel-' + cfg.id);
      el.innerHTML =
        '<h2>卷扬 ' + cfg.id + ' <span class="badge" id="badge-' + cfg.id + '">就绪</span></h2>' +
        slider('load-' + cfg.id, '货箱 kg', cfg.load, P.LIMITS.loadMin, P.LIMITS.loadMax, 50) +
        slider('cw-' + cfg.id, '配重 kg', cfg.cw, P.LIMITS.cwMin, P.LIMITS.cwMax, 50) +
        '<div class="ctrl-row"><label>卷筒速度</label>' +
        '<input type="range" id="omega-' + cfg.id + '" min="-12" max="12" step="0.5" value="0" />' +
        '<span class="val" id="omega-val-' + cfg.id + '">0.0</span></div>' +
        '<div class="ctrl-row"><button id="brake-' + cfg.id + '">制动: 开</button>' +
        '<button id="hard-' + cfg.id + '">强制动: 关</button></div>' +
        '<div class="metrics" id="metrics-' + cfg.id + '"></div>';
    }
    for (const cfg of panelCfg) {
      $('omega-' + cfg.id).addEventListener('input', (e) => {
        ui.manual[cfg.id].targetOmega = parseFloat(e.target.value);
        $('omega-val-' + cfg.id).textContent = parseFloat(e.target.value).toFixed(1);
      });
      $('brake-' + cfg.id).addEventListener('click', () => {
        ui.manual[cfg.id].brakeOn = !ui.manual[cfg.id].brakeOn;
        $('brake-' + cfg.id).textContent = '制动: ' + (ui.manual[cfg.id].brakeOn ? '开' : '关');
      });
      $('hard-' + cfg.id).addEventListener('click', () => {
        ui.manual[cfg.id].hardBrake = !ui.manual[cfg.id].hardBrake;
        $('hard-' + cfg.id).textContent = '强制动: ' + (ui.manual[cfg.id].hardBrake ? '开' : '关');
      });
    }
  }

  function slider(id, label, val, min, max, step) {
    return '<div class="ctrl-row"><label>' + label + '</label>' +
      '<input type="range" id="' + id + '" min="' + min + '" max="' + max +
      '" step="' + step + '" value="' + val + '" /><span class="val" id="' + id +
      '-val">' + val + '</span></div>';
  }

  buildPanels();

  function currentInput() {
    if (ui.auto) return sim.autopilotInput();
    return {
      A: { ...ui.manual.A },
      B: { ...ui.manual.B }
    };
  }

  function tick() {
    if (ui.running && !ui.replaying && sim.status === 'running') {
      sim.stepFrame(currentInput());
      if (sim.status !== 'running') onEnded();
    }
    render();
    requestAnimationFrame(tick);
  }

  function onEnded() {
    ui.running = false;
    $('btn-run').disabled = false;
    const banner = $('trip-banner');
    banner.classList.remove('hidden');
    if (sim.status === 'success') {
      banner.classList.add('success');
      banner.textContent = '任务成功：两台卷扬均到位并稳定保持';
    } else {
      banner.classList.remove('success');
      const t = sim.trip;
      banner.textContent = '保护触发 [' + t.hoist + '] ' + tripText(t.code) +
        ' @ t=' + t.time.toFixed(3) + 's';
    }
    renderLog();
  }

  function tripText(code) {
    return {
      ROPE_BREAK: '绳索过紧断裂',
      ROPE_TANGLE: '绳索过松缠结',
      SWING_UNSTABLE: '摆动失稳',
      WALL_HIT: '货箱碰撞墙体',
      GROUND_HIT: '货箱触地',
      OVER_SPEED: '卷筒超速',
      OVER_TEMP: '电机/制动器超温',
      OVER_PRESSURE: '制动液压超压'
    }[code] || code;
  }

  function render() {
    const snap = ui.replaying
      ? sim.snapshots[ui.replayIndex]
      : sim.snapshot();
    renderer.draw(snap, sim.hoists, { showForce: ui.showForce });
    renderMetrics(snap);
    if (ui.sound && !ui.replaying) {
      audio.update(snap.hoists.map((h) => h.tensionL), P.LIMITS.tensionMax);
    }
  }

  const METRIC_KEYS = [
    ['y', '高度 m', 2], ['l', '绳长 m', 2], ['theta', '摆角 rad', 3],
    ['omega', '卷筒 rad/s', 2], ['tensionL', '载货张力 N', 0],
    ['tensionC', '配重张力 N', 0], ['temp', '温度 ℃', 1], ['pressure', '压力 MPa', 2]
  ];

  function renderMetrics(snap) {
    for (let i = 0; i < 2; i++) {
      const st = snap.hoists[i];
      const name = st.name;
      const badge = $('badge-' + name);
      badge.className = 'badge' + (st.tripped ? ' tripped' :
        (snap.status === 'success' ? ' success' : ''));
      badge.textContent = st.tripped ? tripText(st.tripped) :
        (snap.status === 'success' ? '成功' : (ui.running ? '运行' : '待机'));

      const prev = ui.prevMetrics[name];
      const rows = METRIC_KEYS.map(([k, label, dp]) => {
        const v = st[k];
        let delta = '';
        if (prev && prev[k] !== undefined) {
          const d = v - prev[k];
          if (Math.abs(d) > Math.pow(10, -dp) / 2) {
            const cls = d > 0 ? 'up' : 'down';
            const arrow = d > 0 ? '▲' : '▼';
            delta = '<span class="delta ' + cls + '">' + arrow +
              Math.abs(d).toFixed(dp) + '</span>';
          }
        }
        const cls = warnClass(k, v);
        return '<div class="k">' + label + '</div><div class="v ' + cls + '">' +
          v.toFixed(dp) + delta + '</div>';
      }).join('');
      $('metrics-' + name).innerHTML = rows;
      ui.prevMetrics[name] = { ...st };
    }
  }

  function warnClass(k, v) {
    if (k === 'tensionL' || k === 'tensionC') {
      if (v > P.LIMITS.tensionMax) return 'bad';
      if (v > P.LIMITS.tensionMax * 0.85) return 'warn';
    }
    if (k === 'temp' && v > P.LIMITS.tempMax * 0.85) return v > P.LIMITS.tempMax ? 'bad' : 'warn';
    if (k === 'pressure' && v > P.LIMITS.pressureMax * 0.85) {
      return v > P.LIMITS.pressureMax ? 'bad' : 'warn';
    }
    if (k === 'omega' && Math.abs(v) > P.LIMITS.speedMax * 0.9) return 'warn';
    if (k === 'theta' && Math.abs(v) > P.LIMITS.swingMax * 0.85) return 'warn';
    return '';
  }

  function renderLog() {
    const ul = $('event-log');
    ul.innerHTML = sim.events.slice(-30).reverse().map((e) =>
      '<li><span class="t">[' + e.time.toFixed(3) + 's]</span>' + e.msg + '</li>').join('');
  }

  function readParams() {
    return panelCfg.map((cfg) => ({
      name: cfg.id,
      load: parseInt($('load-' + cfg.id).value, 10),
      cw: parseInt($('cw-' + cfg.id).value, 10),
      targetH: cfg.id === 'A' ? 6.0 : 9.0,
      lL0: cfg.id === 'A' ? 5.0 : 7.0
    }));
  }

  function doReset() {
    sim.params = readParams();
    sim.reset();
    ui.running = false;
    ui.replaying = false;
    ui.replayIndex = 0;
    ui.prevMetrics = { A: null, B: null };
    $('trip-banner').classList.add('hidden');
    $('btn-run').disabled = false;
    $('replay-scrub').max = 0;
    $('replay-info').textContent = '未开始回放';
    sim.log('系统重置，初始条件已恢复');
    renderLog();
    render();
  }

  $('btn-run').addEventListener('click', () => {
    if (sim.status !== 'running') return;
    ui.running = true;
    ui.replaying = false;
    sim.log('开始运行（' + (ui.auto ? '自动控制' : '手动控制') + '）');
    renderLog();
  });
  $('btn-pause').addEventListener('click', () => {
    if (ui.running) {
      ui.running = false;
      sim.log('暂停于 t=' + sim.time.toFixed(3) + 's，物理状态冻结');
      renderLog();
    }
  });
  $('btn-step').addEventListener('click', () => {
    if (ui.replaying || sim.status !== 'running') return;
    ui.running = false; // 单步与暂停共享同一条物理推进路径
    sim.stepFrame(currentInput());
    sim.log('单步推进至 t=' + sim.time.toFixed(3) + 's');
    if (sim.status !== 'running') onEnded();
    renderLog();
    render();
  });
  $('btn-reset').addEventListener('click', doReset);

  $('chk-auto').addEventListener('change', (e) => { ui.auto = e.target.checked; });
  $('chk-force').addEventListener('change', (e) => { ui.showForce = e.target.checked; render(); });
  $('chk-sound').addEventListener('change', (e) => {
    ui.sound = e.target.checked;
    audio.setEnabled(ui.sound);
  });

  // 回放：在已记录快照间拖动，不重新计算，保证关键状态不跳变
  $('btn-replay').addEventListener('click', () => {
    if (sim.snapshots.length < 2) return;
    ui.running = false;
    ui.replaying = true;
    ui.replayIndex = 0;
    const scrub = $('replay-scrub');
    scrub.max = sim.snapshots.length - 1;
    scrub.value = 0;
    sim.log('进入回放，共 ' + sim.snapshots.length + ' 个快照');
    renderLog();
    render();
  });
  $('replay-scrub').addEventListener('input', (e) => {
    ui.replayIndex = parseInt(e.target.value, 10);
    const s = sim.snapshots[ui.replayIndex];
    $('replay-info').textContent = '帧 ' + s.frame + ' / t=' + s.time.toFixed(3) +
      's，状态=' + s.status;
    render();
  });

  // 确定性复算：用记录的输入序列重跑，比对末帧是否逐位一致
  $('btn-rerun').addEventListener('click', () => {
    const rerun = sim.rerun();
    const same = JSON.stringify(rerun.snapshot()) === JSON.stringify(sim.snapshot());
    sim.log('确定性复算：' + (same ? '通过（末帧完全一致）' : '不一致！'));
    renderLog();
    window.alert(same ?
      '确定性复算通过：同参数同输入，末帧快照完全一致。' :
      '复算结果不一致，请检查物理引擎随机性来源。');
  });

  for (const cfg of panelCfg) {
    for (const kind of ['load', 'cw']) {
      $(kind + '-' + cfg.id).addEventListener('input', (e) => {
        $(kind + '-' + cfg.id + '-val').textContent = e.target.value;
      });
      $(kind + '-' + cfg.id).addEventListener('change', doReset);
    }
  }

  sim.log('仿真就绪，固定步长 ' + P.SUB_DT + 's，帧步长 ' + P.FRAME_DT + 's');
  renderLog();
  render();
  requestAnimationFrame(tick);

  globalThis.__app = { sim, renderer, audio, ui, P, $, render, renderLog, currentInput, doReset };
})();
