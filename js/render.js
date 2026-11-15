/* Canvas 渲染：风洞试验段（翼型、风线、分离涡、受力箭头）与特性曲线。 */
(function (root) {
  'use strict';

  // NACA 四位数字翼型半厚度（t=0.12），x 为 0..1 弦向坐标
  function halfThickness(x, t) {
    return t / 0.2 * (0.2969 * Math.sqrt(x) - 0.126 * x -
      0.3516 * x * x + 0.2843 * x * x * x - 0.1015 * x * x * x * x);
  }
  function airfoilPoints(chordPx, t) {
    var n = 34, upper = [], lower = [];
    for (var i = 0; i <= n; i++) {
      var x = i / n;
      var yt = halfThickness(x, t);
      upper.push({ x: x * chordPx, y: -yt * chordPx });
      lower.push({ x: x * chordPx, y: yt * chordPx });
    }
    return upper.concat(lower.reverse());
  }

  function drawTunnel(ctx, W, H, snap, phase) {
    ctx.clearRect(0, 0, W, H);
    // 试验段上下壁
    ctx.strokeStyle = '#2a4368'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, 26); ctx.lineTo(W, 26);
    ctx.moveTo(0, H - 26); ctx.lineTo(W, H - 26); ctx.stroke();

    var cx = W * 0.42, cy = H * 0.5;
    var chordPx = Math.min(W * 0.32, 200);
    var Vn = Math.max(0, Math.min(1, snap.V / 80));

    drawStreamlines(ctx, W, H, cx, cy, chordPx, snap, phase, Vn);

    // 翼型（绕 1/4 弦点旋转迎角）
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-snap.alpha * Math.PI / 180);
    var pts = airfoilPoints(chordPx, 0.12);
    ctx.beginPath();
    ctx.moveTo(pts[0].x - chordPx * 0.25, pts[0].y);
    for (var i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x - chordPx * 0.25, pts[i].y);
    }
    ctx.closePath();
    var grad = ctx.createLinearGradient(0, -20, 0, 20);
    grad.addColorStop(0, '#9fc2ee'); grad.addColorStop(1, '#4a74ad');
    ctx.fillStyle = grad; ctx.fill();
    ctx.strokeStyle = '#cfe0f7'; ctx.lineWidth = 1.2; ctx.stroke();
    // 弦线参考
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(-chordPx * 0.25, 0);
    ctx.lineTo(chordPx * 0.75, 0); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // 支架与弹性变形位置（放大显示，单位换算为像素）
    var defl = 6000;
    var px = cx + snap.posX * defl, py = cy - snap.posY * defl;
    ctx.strokeStyle = '#5f7796'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, H - 26); ctx.lineTo(px, py); ctx.stroke();
    ctx.fillStyle = '#ffd479';
    ctx.beginPath(); ctx.arc(px, py, 3.5, 0, Math.PI * 2); ctx.fill();

    drawForceArrows(ctx, cx, cy, snap);
  }

  function drawStreamlines(ctx, W, H, cx, cy, chordPx, snap, phase, Vn) {
    var rows = 7, speed = 120 + Vn * 260;
    ctx.lineWidth = 1.4;
    for (var r = 0; r < rows; r++) {
      var baseY = 50 + r * (H - 100) / (rows - 1);
      var offset = (phase * speed) % 46;
      for (var x0 = -46; x0 < W; x0 += 46) {
        var x = x0 + offset;
        var dy = baseY - cy;
        // 近翼流线上偏（环量效应），失速后下游抖动并形成分离涡
        var near = Math.exp(-(dy * dy) / (2 * 55 * 55));
        var liftBend = near * 14 * Math.max(0, snap.cl) *
          Math.exp(-Math.pow((x - cx) / 130, 2));
        var wobble = 0;
        if (snap.stalled && x > cx) {
          wobble = Math.sin((x - cx) * 0.18 + phase * 9 + r) * 7 *
            Math.min(1, (x - cx) / 120);
        }
        var y = baseY - liftBend + wobble;
        var alpha = 0.25 + Vn * 0.45;
        ctx.strokeStyle = 'rgba(90,160,235,' + alpha.toFixed(2) + ')';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 20, y - (snap.stalled && x > cx ? wobble * 0.4 : 0));
        ctx.stroke();
        // 流动方向小箭头
        ctx.beginPath();
        ctx.moveTo(x + 20, y);
        ctx.lineTo(x + 14, y - 3); ctx.lineTo(x + 14, y + 3);
        ctx.closePath(); ctx.fillStyle = ctx.strokeStyle; ctx.fill();
      }
    }
    // 失速分离涡：翼型后上方两个旋转涡
    if (snap.stalled) {
      for (var v = 0; v < 2; v++) {
        var ex = cx + chordPx * (0.55 + v * 0.45);
        var ey = cy - 26 - v * 10 + Math.sin(phase * 6 + v) * 4;
        ctx.strokeStyle = 'rgba(240,160,90,.75)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        for (var a = 0; a < Math.PI * 1.6; a += 0.25) {
          var rr = 2 + a * 3.2;
          var ang = a + phase * (4 + v * 2);
          var vx = ex + Math.cos(ang) * rr, vy = ey + Math.sin(ang) * rr;
          if (a === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
        }
        ctx.stroke();
      }
    }
  }

  function arrow(ctx, x, y, dx, dy, color, label) {
    var len = Math.hypot(dx, dy);
    if (len < 2) return;
    var ux = dx / len, uy = dy / len;
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dx, y + dy); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + dx, y + dy);
    ctx.lineTo(x + dx - ux * 9 - uy * 4, y + dy - uy * 9 + ux * 4);
    ctx.lineTo(x + dx - ux * 9 + uy * 4, y + dy - uy * 9 - ux * 4);
    ctx.closePath(); ctx.fill();
    ctx.font = '12px sans-serif';
    ctx.fillText(label, x + dx + 6, y + dy + 4);
  }

  function drawForceArrows(ctx, cx, cy, snap) {
    var scale = 0.22;
    // 升力（绿，垂直来流向上）与阻力（红，沿来流向后）
    arrow(ctx, cx, cy, 0, -Math.max(0, snap.lift) * scale, '#7fe3a8',
      'L ' + snap.lift.toFixed(1) + 'N');
    arrow(ctx, cx, cy, snap.drag * scale * 4, 0, '#ff9aa2',
      'D ' + snap.drag.toFixed(1) + 'N');
  }

  // 特性曲线：x=迎角，双 y 轴（升力 N / 阻力 N），含历史轨迹与触发点
  function drawCurve(ctx, W, H, history, snap, crit, trip) {
    ctx.clearRect(0, 0, W, H);
    var pad = { l: 46, r: 46, t: 16, b: 34 };
    var xMin = -25, xMax = 30;
    var maxLift = 650, maxDrag = 120;
    function X(a) { return pad.l + (a - xMin) / (xMax - xMin) * (W - pad.l - pad.r); }
    function YL(l) { return H - pad.b - l / maxLift * (H - pad.t - pad.b); }
    function YD(d) { return H - pad.b - d / maxDrag * (H - pad.t - pad.b); }

    // 网格与轴
    ctx.strokeStyle = '#1e3355'; ctx.fillStyle = '#7e96b4';
    ctx.lineWidth = 1; ctx.font = '11px sans-serif';
    for (var g = -20; g <= 30; g += 10) {
      ctx.beginPath(); ctx.moveTo(X(g), pad.t); ctx.lineTo(X(g), H - pad.b); ctx.stroke();
      ctx.fillText(g + '°', X(g) - 8, H - pad.b + 16);
    }
    for (g = 0; g <= 600; g += 150) {
      ctx.fillText(g.toString(), 8, YL(g) + 4);
    }
    for (g = 0; g <= 120; g += 30) {
      ctx.fillText(g.toString(), W - pad.r + 6, YD(g) + 4);
    }
    // 失速区底色与临界角虚线
    ctx.fillStyle = 'rgba(212,80,94,0.08)';
    ctx.fillRect(X(crit), pad.t, X(xMax) - X(crit), H - pad.t - pad.b);
    ctx.strokeStyle = 'rgba(240,194,123,.8)'; ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.moveTo(X(crit), pad.t);
    ctx.lineTo(X(crit), H - pad.b); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#f0c27b';
    ctx.fillText('临界迎角 ' + crit + '°', X(crit) + 5, pad.t + 12);

    if (history.length < 2) return;
    // 升力轨迹（绿）与阻力轨迹（红）
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = '#7fe3a8'; ctx.beginPath();
    history.forEach(function (s, i) {
      var x = X(s.alpha), y = YL(s.liftMeas);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.strokeStyle = '#ff9aa2'; ctx.beginPath();
    history.forEach(function (s, i) {
      var x = X(s.alpha), y = YD(s.dragMeas);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // 当前工况点
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(X(snap.alpha), YL(snap.liftMeas), 4, 0, Math.PI * 2); ctx.fill();
    // 保护触发点
    if (trip) {
      var tr = YL(trip.lift);
      ctx.fillStyle = '#ff5a68';
      ctx.beginPath(); ctx.arc(X(trip.alpha), tr, 6, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#ff5a68'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(X(trip.alpha), tr, 10, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#ff9aa2';
      ctx.fillText('触发点 t=' + trip.t.toFixed(2) + 's', X(trip.alpha) - 20, tr - 14);
    }
    ctx.fillStyle = '#7fe3a8'; ctx.fillText('升力 L (N)', pad.l, pad.t + 10);
    ctx.fillStyle = '#ff9aa2'; ctx.fillText('阻力 D (N)', W - pad.r - 70, pad.t + 10);
  }

  root.WTRender = { drawTunnel: drawTunnel, drawCurve: drawCurve,
    airfoilPoints: airfoilPoints, halfThickness: halfThickness };
})(typeof window !== 'undefined' ? window : globalThis);
