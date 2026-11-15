/* Canvas 2D 等轴测三维网格渲染 + 垂直剖面 + 颜色标尺。 */
(function (root) {
  const COS30 = Math.cos(Math.PI / 6);
  const SIN30 = Math.sin(Math.PI / 6);

  /* 值 → 颜色（蓝→青→绿→黄→红）。 */
  function colorFor(t) {
    t = Math.max(0, Math.min(1, t));
    const stops = [
      [49, 54, 149], [69, 117, 180], [116, 173, 209], [171, 217, 233],
      [255, 255, 191], [254, 224, 144], [253, 174, 97], [244, 109, 67], [215, 48, 39],
    ];
    const p = t * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(p));
    const f = p - i;
    const a = stops[i], b = stops[i + 1];
    const c = a.map((v, k) => Math.round(v + (b[k] - v) * f));
    return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
  }

  function makeProject(W, H, n, maxH) {
    const s = Math.min(W, H) / (n * 1.9);
    const cx = W / 2;
    const cy = H * 0.28;
    return function (gx, gy, h) {
      return [
        cx + (gx - gy) * COS30 * s,
        cy + (gx + gy) * SIN30 * s - (h / maxH) * H * 0.42,
      ];
    };
  }

  /* 角点高度取相邻单元均值，形成连续网格面。 */
  function cornerH(grid, x, y) {
    let s = 0, n = 0;
    for (const [dx, dy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
      const v = grid[x + dx] && grid[x + dx][y + dy];
      if (v !== null && v !== undefined) { s += v; n++; }
    }
    return n ? s / n : null;
  }

  /* 主三维网格图。opts: {stats, region, hSlice, vSlice, highlight} */
  function drawMesh(ctx, grid, opts) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const n = grid.length;
    const { min, max } = opts.stats;
    const span = (max - min) || 1;
    const project = makeProject(W, H, n, span);
    ctx.clearRect(0, 0, W, H);

    const tOf = v => (v - min) / span;
    const hOf = v => v - min;

    // 水平切片平面（先画，半透明）
    if (opts.hSlice !== null && opts.hSlice >= min && opts.hSlice <= max) {
      const hh = hOf(opts.hSlice);
      const p = [[0, 0], [n, 0], [n, n], [0, n]].map(([x, y]) => project(x, y, hh));
      ctx.beginPath();
      ctx.moveTo(p[0][0], p[0][1]);
      for (let i = 1; i < 4; i++) ctx.lineTo(p[i][0], p[i][1]);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 网格面（画家算法：远 → 近）
    for (let d = 0; d <= 2 * (n - 1); d++) {
      for (let x = 0; x < n - 1; x++) {
        const y = d - x;
        if (y < 0 || y >= n - 1) continue;
        const hs = [cornerH(grid, x, y), cornerH(grid, x + 1, y),
          cornerH(grid, x + 1, y + 1), cornerH(grid, x, y + 1)];
        if (hs.some(h => h === null)) continue; // 缺失网格留洞
        const pts = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]]
          .map(([px, py], i) => project(px, py, hOf(hs[i] + min)));
        const mid = (hs[0] + hs[1] + hs[2] + hs[3]) / 4 + min;
        const dim = opts.region !== 'all' &&
          root.Pipeline.regionOf(x, y, n) !== opts.region &&
          root.Pipeline.regionOf(x + 1, y + 1, n) !== opts.region;
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < 4; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.closePath();
        ctx.fillStyle = colorFor(tOf(mid));
        ctx.globalAlpha = dim ? 0.18 : 1;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = 'rgba(10,14,24,0.35)';
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }
    }

    // 垂直切片墙（沿 gx = vSlice 的剖面）
    if (opts.vSlice !== null && opts.vSlice >= 0 && opts.vSlice < n) {
      const k = opts.vSlice;
      ctx.beginPath();
      let started = false;
      const base = project(k, 0, 0);
      ctx.moveTo(base[0], base[1]);
      for (let y = 0; y < n; y++) {
        const v = grid[k][y];
        if (v === null || v === undefined) continue;
        const p = project(k, y, hOf(v));
        if (!started) { ctx.moveTo(p[0], p[1]); started = true; }
        else ctx.lineTo(p[0], p[1]);
      }
      const baseEnd = project(k, n - 1, 0);
      ctx.lineTo(baseEnd[0], baseEnd[1]);
      ctx.closePath();
      ctx.fillStyle = 'rgba(120,200,255,0.25)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(140,220,255,0.9)';
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }

    // 热点标记
    for (const h of opts.highlight || []) {
      const v = grid[h.gx][h.gy];
      if (v === null || v === undefined) continue;
      const p = project(h.gx + 0.5, h.gy + 0.5, hOf(v));
      ctx.beginPath();
      ctx.arc(p[0], p[1], 5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fill();
      ctx.strokeStyle = '#d73027';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  /* 垂直剖面折线图（沿选中列）。 */
  function drawProfile(ctx, grid, col, opts) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    ctx.clearRect(0, 0, W, H);
    const n = grid.length;
    const { min, max } = opts.stats;
    const span = (max - min) || 1;
    const padL = 44, padR = 12, padT = 14, padB = 26;
    const xOf = i => padL + (i / (n - 1)) * (W - padL - padR);
    const yOf = v => padT + (1 - (v - min) / span) * (H - padT - padB);

    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const v = min + (span * i) / 4;
      const y = yOf(v);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
      ctx.fillStyle = '#9aa4b2';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(v.toFixed(0), padL - 5, y + 3);
    }

    if (col === null || col === undefined) {
      ctx.fillStyle = '#9aa4b2';
      ctx.textAlign = 'center';
      ctx.font = '12px sans-serif';
      ctx.fillText('未选择垂直切片列', W / 2, H / 2);
      return;
    }

    ctx.beginPath();
    let started = false;
    for (let y = 0; y < n; y++) {
      const v = grid[col][y];
      if (v === null || v === undefined) { started = false; continue; }
      const px = xOf(y), py = yOf(v);
      if (!started) { ctx.moveTo(px, py); started = true; }
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = '#7cc8ff';
    ctx.lineWidth = 2;
    ctx.stroke();

    if (opts.hSlice !== null && opts.hSlice >= min && opts.hSlice <= max) {
      const y = yOf(opts.hSlice);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y);
      ctx.strokeStyle = 'rgba(255,220,120,0.85)';
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.fillStyle = '#9aa4b2';
    ctx.textAlign = 'center';
    ctx.font = '10px sans-serif';
    ctx.fillText('沿 gx=' + col + ' 列（gy 0 → ' + (n - 1) + '）  单位: ' + opts.unit, W / 2, H - 8);
  }

  /* 颜色标尺（随当前窗口统计实时变化）。 */
  function drawLegend(ctx, stats, label) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    ctx.clearRect(0, 0, W, H);
    const barX = 10, barW = W - 20, barY = 8, barH = 14;
    for (let i = 0; i < barW; i++) {
      ctx.fillStyle = colorFor(i / (barW - 1));
      ctx.fillRect(barX + i, barY, 1, barH);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.strokeRect(barX, barY, barW, barH);
    ctx.fillStyle = '#cfd6e0';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(stats.min.toFixed(1), barX, barY + barH + 14);
    ctx.textAlign = 'right';
    ctx.fillText(stats.max.toFixed(1), barX + barW, barY + barH + 14);
    ctx.textAlign = 'center';
    ctx.fillText(label + '  均值 ' + stats.mean.toFixed(1) + ' µg/m³（n=' + stats.count + '）',
      barX + barW / 2, barY + barH + 14);
  }

  root.Render = { colorFor, drawMesh, drawProfile, drawLegend };
})(typeof self !== 'undefined' ? self : this);
