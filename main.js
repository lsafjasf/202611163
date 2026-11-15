/* 液压升降平台模拟器 UI：Canvas 渲染 + Web Audio + 交互控制 */
'use strict';
(function () {
  const Sim = window.HydraSim;
  const cv = document.getElementById('cv');
  const ctx = cv.getContext('2d');
  const $ = (id) => document.getElementById(id);

  // ---------- 全局状态 ----------
  let st = Sim.createState('normal');   // 物理状态（重置=整体替换，避免漂移）
  let paused = false;
  let auto = false;
  let mode = 'run';                     // run | replay
  let rec = [];                         // 运行记录（用于回放）
  let replayT = 0;
  let loggedEvent = null;
  let prevVars = null;
  let lastChangeText = '—';

  // ---------- Web Audio：泵声随泵压变化 ----------
  let ac = null, osc = null, osc2 = null, gain = null;
  function ensureAudio() {
    if (ac) return;
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      osc = ac.createOscillator(); osc.type = 'sawtooth';
      osc2 = ac.createOscillator(); osc2.type = 'sine';
      gain = ac.createGain(); gain.gain.value = 0;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
      osc.connect(lp); osc2.connect(lp); lp.connect(gain); gain.connect(ac.destination);
      osc.start(); osc2.start();
    } catch (e) { ac = null; }
  }
  function updateAudio(ctl) {
    if (!ac) return;
    const pMPa = ctl.pump / 1e6;
    const flow = (ctl.valveL + ctl.valveR) / 2;
    const running = !paused && mode === 'run' && !st.event;
    const f = 40 + pMPa * 9;
    osc.frequency.setTargetAtTime(f, ac.currentTime, 0.05);
    osc2.frequency.setTargetAtTime(f / 2, ac.currentTime, 0.05);
    gain.gain.setTargetAtTime(running ? Math.min(0.12, 0.02 + pMPa * 0.005 + flow * 0.03) : 0,
      ac.currentTime, 0.08);
  }
  window.addEventListener('pointerdown', ensureAudio, { once: false });

  // ---------- 控制量 ----------
  function manualCtl() {
    return {
      pump: parseFloat($('pump').value) * 1e6,
      valveL: parseFloat($('valveL').value) / 100,
      valveR: parseFloat($('valveR').value) / 100,
    };
  }
  function currentCtl() {
    if (auto) {
      const c = Sim.scriptControl(st);
      $('pump').value = (c.pump / 1e6).toFixed(1);
      $('valveL').value = Math.round(c.valveL * 100);
      $('valveR').value = Math.round(c.valveR * 100);
      return c;
    }
    return manualCtl();
  }
  function syncCtlLabels() {
    $('pumpV').textContent = parseFloat($('pump').value).toFixed(1) + ' MPa';
    $('valveLV').textContent = $('valveL').value + '%';
    $('valveRV').textContent = $('valveR').value + '%';
  }

  // ---------- 主循环：固定步长推进 ----------
  function tick() {
    const ctl = currentCtl();
    syncCtlLabels();
    if (mode === 'run' && !paused && !st.event) {
      Sim.frame(st, ctl);
      rec.push(Sim.snapshot(st));
      if (rec.length > 60 * 600) rec.shift();
      if (st.event && st.event !== loggedEvent) {
        loggedEvent = st.event;
        logEvent(st.event);
      }
    }
    if (mode === 'replay') {
      replayT += Sim.FRAME_DT;
      if (replayT >= (rec.length - 1) * Sim.FRAME_DT) { mode = 'run'; paused = true; }
    }
    updateAudio(ctl);
    updatePanel();
    render(ctl);
    requestAnimationFrame(tick);
  }

  // ---------- 渲染 ----------
  const GEO = { groundY: 500, cx: 300, sx: 125, sy: 125 }; // 像素/米
  function worldX(x) { return GEO.cx + x * GEO.sx; }
  function worldY(y) { return GEO.groundY - y * GEO.sy; }

  // 回放时取插值后的展示状态（保证关键状态不跳变）
  function viewState() {
    if (mode !== 'replay' || rec.length === 0) return st;
    const fi = Math.min(replayT / Sim.FRAME_DT, rec.length - 1);
    const i = Math.floor(fi), a = fi - i;
    const A = rec[i], B = rec[Math.min(i + 1, rec.length - 1)];
    const out = Object.assign({}, st);
    for (const k of ['y', 'vy', 'th', 'w', 's', 'sv', 'pL', 'pR', 'T']) {
      out[k] = A[k] + (B[k] - A[k]) * a;
    }
    return out;
  }

  function arrow(x1, y1, x2, y2, color, w) {
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = w || 2;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    const ang = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - 8 * Math.cos(ang - 0.4), y2 - 8 * Math.sin(ang - 0.4));
    ctx.lineTo(x2 - 8 * Math.cos(ang + 0.4), y2 - 8 * Math.sin(ang + 0.4));
    ctx.closePath(); ctx.fill();
  }

  function render(ctl) {
    const v = viewState();
    ctx.clearRect(0, 0, cv.width, cv.height);
    const halfW = Sim.P.W / 2;

    // 地面
    ctx.strokeStyle = '#3a4a61'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(30, GEO.groundY); ctx.lineTo(580, GEO.groundY); ctx.stroke();
    for (let x = 34; x < 580; x += 14) {
      ctx.beginPath(); ctx.moveTo(x, GEO.groundY); ctx.lineTo(x - 8, GEO.groundY + 8); ctx.stroke();
    }

    // 目标高度虚线
    ctx.setLineDash([5, 5]); ctx.font = '11px sans-serif';
    st.targets.forEach((tg, i) => {
      const done = i < st.targetIdx || st.phase !== 'lift';
      ctx.strokeStyle = done ? '#2e5d3a' : (i === st.targetIdx ? '#8a6d1f' : '#33404f');
      ctx.beginPath(); ctx.moveTo(60, worldY(tg)); ctx.lineTo(560, worldY(tg)); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fillText('目标' + (i + 1) + ' ' + tg.toFixed(1) + 'm', 66, worldY(tg) - 4);
    });
    ctx.setLineDash([]);

    // 缸体与活塞杆
    const xL = v.y - halfW * Math.sin(v.th);
    const xR = v.y + halfW * Math.sin(v.th);
    [[-halfW, xL, v.pL], [halfW, xR, v.pR]].forEach(([off, ext, p]) => {
      const bx = worldX(off);
      ctx.fillStyle = '#2b3a52';
      ctx.fillRect(bx - 16, GEO.groundY - 40, 32, 40);           // 缸筒底座
      ctx.fillStyle = '#54708f';
      ctx.fillRect(bx - 8, worldY(ext) - 6, 16, GEO.groundY - 40 - worldY(ext) + 6); // 活塞杆
      // 压力填充（缸筒内油液颜色随压力）
      const ratio = Math.min(p / Sim.LIMITS.pMax, 1);
      ctx.fillStyle = 'rgba(79,195,247,' + (0.15 + 0.55 * ratio).toFixed(2) + ')';
      ctx.fillRect(bx - 14, GEO.groundY - 38, 28, 36);
    });

    // 平台（按倾角旋转的梁）
    const plx = worldX(-halfW), ply = worldY(xL);
    const prx = worldX(halfW), pry = worldY(xR);
    const dx = prx - plx, dy = pry - ply;
    const nx = -dy, ny = dx, nl = Math.hypot(nx, ny) || 1;
    const ux = nx / nl, uy = ny / nl; // 平台法向
    ctx.strokeStyle = '#c8d4e2'; ctx.lineWidth = 8; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(plx - dx * 0.08, ply - dy * 0.08);
    ctx.lineTo(prx + dx * 0.08, pry + dy * 0.08);
    ctx.stroke();

    // 负载块（位置 s 沿平台）
    const frac = (v.s + halfW) / Sim.P.W;
    const lx = plx + dx * frac, ly = ply + dy * frac;
    const bw = 34, bh = 22;
    ctx.fillStyle = '#d9a441';
    ctx.save(); ctx.translate(lx + ux * (bh / 2 + 4), ly + uy * (bh / 2 + 4));
    ctx.rotate(Math.atan2(dy, dx));
    ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
    ctx.restore();
    ctx.fillStyle = '#0b0f14'; ctx.font = '10px sans-serif';
    ctx.fillText(v.load + 'kg', lx - 18, ly - 16);

    // 力箭头：缸推力(绿,向上) / 负载重力(红,向下) / 平台重力(蓝)
    const fScale = 60 / (800 * 9.81);
    arrow(worldX(-halfW), worldY(xL) - 10, worldX(-halfW), worldY(xL) - 10 - v.pL * Sim.P.A * fScale, '#66bb6a', 3);
    arrow(worldX(halfW), worldY(xR) - 10, worldX(halfW), worldY(xR) - 10 - v.pR * Sim.P.A * fScale, '#66bb6a', 3);
    arrow(lx, ly - 20, lx, ly - 20 + v.load * 9.81 * fScale, '#ef5350', 3);
    arrow(GEO.cx, worldY(v.y) - 14, GEO.cx, worldY(v.y) - 14 + Sim.P.Mp * 9.81 * fScale, '#42a5f5', 2);

    // 暂停时显示变化趋势箭头（速度/角速度方向）
    if (paused && mode === 'run') {
      const ty = worldY(v.y) - 60;
      if (Math.abs(v.vy) > 0.01) {
        arrow(GEO.cx - 160, ty, GEO.cx - 160, ty - Math.sign(v.vy) * 34, '#ffb74d', 3);
        ctx.fillStyle = '#ffb74d'; ctx.font = '12px sans-serif';
        ctx.fillText('vy ' + (v.vy >= 0 ? '↑' : '↓') + ' ' + Math.abs(v.vy).toFixed(2) + 'm/s', GEO.cx - 150, ty - 20);
      }
      if (Math.abs(v.w) > 0.01) {
        const dir = v.w > 0 ? '↻' : '↺';
        ctx.fillStyle = '#ffb74d'; ctx.font = '22px sans-serif';
        ctx.fillText(dir, GEO.cx + 140, ty);
        ctx.font = '12px sans-serif';
        ctx.fillText('ω ' + Math.abs(v.w).toFixed(2) + 'rad/s', GEO.cx + 128, ty + 16);
      }
    }

    renderGauges(v);

    // 事件横幅（冻结在触发点）
    if (st.event && mode === 'run') {
      const bad = st.event.type !== 'success';
      ctx.fillStyle = bad ? 'rgba(120,20,26,0.85)' : 'rgba(20,90,50,0.85)';
      ctx.fillRect(40, 20, 520, 64);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 16px sans-serif';
      ctx.fillText(st.event.label, 56, 44);
      ctx.font = '12px sans-serif';
      ctx.fillText('触发点 t=' + st.event.t.toFixed(2) + 's  y=' + st.event.y.toFixed(3) +
        'm  vy=' + st.event.vy.toFixed(2) + 'm/s  θ=' + (st.event.th * 180 / Math.PI).toFixed(1) +
        '°  pL=' + (st.event.pL / 1e6).toFixed(2) + 'MPa  pR=' + (st.event.pR / 1e6).toFixed(2) +
        'MPa  T=' + st.event.T.toFixed(1) + '°C', 56, 66);
    }
    if (mode === 'replay') {
      ctx.fillStyle = 'rgba(40,60,90,0.85)'; ctx.fillRect(40, 20, 200, 30);
      ctx.fillStyle = '#fff'; ctx.font = '13px sans-serif';
      ctx.fillText('回放中 ' + replayT.toFixed(1) + 's / ' + ((rec.length - 1) * Sim.FRAME_DT).toFixed(1) + 's', 52, 40);
    }
  }

  // 竖直仪表条
  function vbar(x, y, h, w, ratio, limitRatio, color, label, valText) {
    ctx.strokeStyle = '#3a4a61'; ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);
    const fh = Math.max(0, Math.min(ratio, 1)) * h;
    ctx.fillStyle = ratio > limitRatio ? '#ef5350' : color;
    ctx.fillRect(x + 1, y + h - fh, w - 2, fh);
    ctx.strokeStyle = '#ffb74d'; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x - 3, y + h - limitRatio * h); ctx.lineTo(x + w + 3, y + h - limitRatio * h); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#8b98a8'; ctx.font = '11px sans-serif';
    ctx.fillText(label, x - 2, y + h + 14);
    ctx.fillStyle = '#dfe7f0';
    ctx.fillText(valText, x - 6, y - 6);
  }

  function renderGauges(v) {
    const gy = 60, gh = 200;
    ctx.fillStyle = '#8b98a8'; ctx.font = '12px sans-serif';
    ctx.fillText('压力 / 温度 / 高度 / 倾斜', 620, 40);
    vbar(630, gy, gh, 34, v.pL / 16e6, Sim.LIMITS.pMax / 16e6, '#4fc3f7', '左缸', (v.pL / 1e6).toFixed(1));
    vbar(690, gy, gh, 34, v.pR / 16e6, Sim.LIMITS.pMax / 16e6, '#4fc3f7', '右缸', (v.pR / 1e6).toFixed(1));
    vbar(750, gy, gh, 34, v.T / 100, Sim.LIMITS.tMax / 100, '#ff8a65', '油温', v.T.toFixed(0) + '°C');
    vbar(810, gy, gh, 34, v.y / Sim.P.stroke, 1.0, '#81c784', '高度', v.y.toFixed(2) + 'm');
    // 目标高度刻度
    ctx.fillStyle = '#8a6d1f';
    st.targets.forEach((tg) => {
      const yy = gy + gh - (tg / Sim.P.stroke) * gh;
      ctx.fillRect(810, yy, 34, 2);
    });
    // 倾斜仪
    const cx0 = 700, cy0 = 380, r = 60;
    ctx.strokeStyle = '#3a4a61'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx0, cy0, r, Math.PI, 2 * Math.PI); ctx.stroke();
    const lim = Sim.LIMITS.thMax;
    ctx.strokeStyle = '#ffb74d';
    [-lim, lim].forEach((a) => {
      ctx.beginPath();
      ctx.moveTo(cx0 + (r - 8) * Math.sin(a), cy0 - (r - 8) * Math.cos(a));
      ctx.lineTo(cx0 + r * Math.sin(a), cy0 - r * Math.cos(a));
      ctx.stroke();
    });
    const a = Math.max(-0.6, Math.min(0.6, v.th));
    ctx.strokeStyle = Math.abs(v.th) > lim ? '#ef5350' : '#4fc3f7'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx0, cy0);
    ctx.lineTo(cx0 + (r - 4) * Math.sin(a), cy0 - (r - 4) * Math.cos(a)); ctx.stroke();
    ctx.fillStyle = '#8b98a8'; ctx.font = '11px sans-serif';
    ctx.fillText('倾斜 ' + (v.th * 180 / Math.PI).toFixed(1) + '°', cx0 - 30, cy0 + 18);
    // 重心指示：负载偏心 → 重心偏移
    const cog = (v.load * v.s) / (Sim.P.Mp + v.load);
    ctx.fillStyle = '#d9a441';
    ctx.fillText('重心偏移 ' + (cog >= 0 ? '右' : '左') + ' ' + Math.abs(cog).toFixed(2) + 'm', cx0 + 60, cy0 - 10);
  }

  // ---------- 面板：关键物理量 + 最近一次变化 ----------
  const VAR_DEFS = [
    ['t', '时间', (v) => v.t.toFixed(2) + ' s', 1],
    ['y', '平台高度', (v) => v.y.toFixed(3) + ' m', 0.001],
    ['vy', '升降速度', (v) => v.vy.toFixed(3) + ' m/s', 0.005],
    ['th', '倾角', (v) => (v.th * 180 / Math.PI).toFixed(2) + ' °', 0.002],
    ['w', '角速度', (v) => v.w.toFixed(3) + ' rad/s', 0.005],
    ['s', '负载位置', (v) => v.s.toFixed(3) + ' m', 0.002],
    ['pL', '左缸压力', (v) => (v.pL / 1e6).toFixed(2) + ' MPa', 2e4],
    ['pR', '右缸压力', (v) => (v.pR / 1e6).toFixed(2) + ' MPa', 2e4],
    ['T', '油温', (v) => v.T.toFixed(1) + ' °C', 0.05],
    ['load', '负载', (v) => v.load + ' kg', 0.5],
  ];

  function updatePanel() {
    const v = mode === 'replay' ? viewState() : st;
    let html = '';
    for (const [key, name, fmt] of VAR_DEFS) {
      html += '<tr><td class="k">' + name + '</td><td class="v">' + fmt(v) + '</td></tr>';
    }
    $('vars').innerHTML = html;

    // 最近一次变化：取归一化变化量最大的物理量
    if (prevVars) {
      let best = null, bestScore = 0;
      for (const [key, name, fmt, eps] of VAR_DEFS) {
        const d = v[key] - prevVars[key];
        const score = Math.abs(d) / eps;
        if (score > bestScore) { bestScore = score; best = { name, d, key }; }
      }
      if (best && bestScore >= 1) {
        const units = { y: 'm', vy: 'm/s', th: 'rad', w: 'rad/s', s: 'm', T: '°C', t: 's', load: 'kg' };
        const dv = (best.key === 'pL' || best.key === 'pR') ? best.d / 1e6 : best.d;
        const uu = (best.key === 'pL' || best.key === 'pR') ? 'MPa' : (units[best.key] || '');
        lastChangeText = best.name + ' ' + (dv >= 0 ? '+' : '') + dv.toFixed(3) + ' ' + uu +
          ' (t=' + v.t.toFixed(2) + 's)';
      }
    }
    prevVars = {};
    for (const [key] of VAR_DEFS) prevVars[key] = v[key];
    $('lastChange').textContent = '最近变化: ' + lastChangeText;

    // 目标进度
    let th = '';
    st.targets.forEach((tg, i) => {
      const cls = i < st.targetIdx || st.phase !== 'lift' ? 'hit' : (i === st.targetIdx ? 'cur' : '');
      th += '<span class="' + cls + '">' + (cls === 'hit' ? '✓' : '○') + ' ' + tg.toFixed(1) + 'm</span>';
    });
    th += '<span class="' + (st.phase === 'success' ? 'hit' : (st.phase === 'return' ? 'cur' : '')) + '">' +
      (st.phase === 'success' ? '✓' : '○') + ' 回落</span>';
    $('targets').innerHTML = th;

    // 状态条
    const el = $('status');
    if (st.event) {
      el.className = 'status ' + (st.event.type === 'success' ? 'win' : 'fail');
      el.textContent = st.event.label + '（已冻结在触发点）';
    } else if (mode === 'replay') {
      el.className = 'status pause'; el.textContent = '回放中';
    } else if (paused) {
      el.className = 'status pause'; el.textContent = '已暂停（可单步）';
    } else {
      el.className = 'status run';
      el.textContent = '运行中' + (auto ? '（自动驾驶）' : '');
    }
  }

  // ---------- 事件日志 ----------
  function logEvent(ev) {
    const line = '[t=' + ev.t.toFixed(2) + 's] ' + ev.label +
      ' | y=' + ev.y.toFixed(3) + 'm vy=' + ev.vy.toFixed(3) + 'm/s' +
      ' θ=' + (ev.th * 180 / Math.PI).toFixed(2) + '° ω=' + ev.w.toFixed(3) + 'rad/s' +
      ' pL=' + (ev.pL / 1e6).toFixed(2) + 'MPa pR=' + (ev.pR / 1e6).toFixed(2) + 'MPa' +
      ' T=' + ev.T.toFixed(1) + '°C load=' + ev.load + 'kg';
    const log = $('log');
    if (log.textContent === '暂无事件') log.textContent = '';
    log.textContent += line + '\n';
    log.scrollTop = log.scrollHeight;
  }
  function logInfo(msg) {
    const log = $('log');
    if (log.textContent === '暂无事件') log.textContent = '';
    log.textContent += msg + '\n';
    log.scrollTop = log.scrollHeight;
  }

  // ---------- 交互 ----------
  function reset() {
    st = Sim.createState($('scn').value); // 整体替换，初始条件不漂移
    rec = []; replayT = 0; mode = 'run';
    loggedEvent = null; prevVars = null; lastChangeText = '—';
    paused = false;
    $('log').textContent = '暂无事件';
    $('btnPause').textContent = '暂停';
  }

  $('btnPause').onclick = () => {
    if (mode === 'replay') { mode = 'run'; paused = true; }
    paused = !paused;
    $('btnPause').textContent = paused ? '继续' : '暂停';
  };
  $('btnStep').onclick = () => {
    if (mode !== 'run') { mode = 'run'; }
    if (!paused) { paused = true; $('btnPause').textContent = '继续'; }
    if (!st.event) {
      Sim.frame(st, currentCtl());   // 与连续运行同一推进函数 → 状态一致
      rec.push(Sim.snapshot(st));
      if (st.event && st.event !== loggedEvent) { loggedEvent = st.event; logEvent(st.event); }
    }
  };
  $('btnReset').onclick = reset;
  $('scn').onchange = reset;
  $('btnAuto').onclick = () => {
    auto = !auto;
    $('btnAuto').className = auto ? 'active' : '';
    ['pump', 'valveL', 'valveR'].forEach((id) => { $(id).disabled = auto; });
  };
  $('btnReplay').onclick = () => {
    if (rec.length < 2) { logInfo('[提示] 暂无记录可回放'); return; }
    mode = 'replay'; replayT = 0; paused = false;
    $('btnPause').textContent = '暂停';
  };
  $('btnVerify').onclick = () => {
    // 同参数重复运行 → 比较偏差；多次重置 → 检查初始条件漂移
    const scn = $('scn').value;
    const runOnce = () => {
      const s = Sim.createState(scn);
      for (let i = 0; i < 1800 && !s.event; i++) Sim.frame(s, Sim.scriptControl(s));
      return s;
    };
    const a = runOnce(), b = runOnce();
    let maxDiff = 0;
    for (const k of ['y', 'vy', 'th', 'w', 's', 'pL', 'pR', 'T']) {
      maxDiff = Math.max(maxDiff, Math.abs(a[k] - b[k]));
    }
    const pristine = JSON.stringify(Sim.createState(scn));
    let drift = false;
    for (let i = 0; i < 3; i++) {
      const tmp = Sim.createState(scn);
      for (let j = 0; j < 100; j++) Sim.frame(tmp, Sim.scriptControl(tmp));
      if (JSON.stringify(Sim.createState(scn)) !== pristine) drift = true;
    }
    logInfo('[校验] 重复运行最大偏差=' + maxDiff.toExponential(2) +
      (maxDiff === 0 ? ' (完全一致)' : ' (近似一致)') +
      ' | 重置漂移=' + (drift ? '有' : '无'));
  };

  reset();
  requestAnimationFrame(tick);
})();
