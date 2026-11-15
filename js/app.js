/* UI  wiring：筛选 → 清洗 → 聚合 → 渲染/列表/导出 全链路同步。 */
(function () {
  const { META, DATASETS } = RawData;
  const P = Pipeline;
  const R = Render;

  const dims = { sensors: META.sensors, windows: META.windows, seqs: META.seqs };
  const REGION_LABEL = { all: '全部', center: '城市中心', suburb: '郊区' };
  const POLLUTANT_LABEL = { pm25: 'PM2.5', pm10: 'PM10' };

  // 清洗结果缓存（每个数据集只清洗一次，派生值均由此重算）
  const cleanedCache = {};
  function cleaned(key) {
    if (!cleanedCache[key]) {
      cleanedCache[key] = P.cleanDataset(DATASETS[key].records, dims);
    }
    return cleanedCache[key];
  }

  const store = P.createStore({
    datasetKey: 'normal', pollutant: 'pm25', window: 0,
    region: 'all', hSlice: null, vSlice: null,
  });

  const $ = id => document.getElementById(id);
  const meshCtx = $('meshCanvas').getContext('2d');
  const profileCtx = $('profileCanvas').getContext('2d');
  const legendCtx = $('legendCanvas').getContext('2d');

  $('versionBadge').textContent = '数据版本 ' + META.version + '（' + META.generated + '）';
  $('unitBadge').textContent = '单位 ' + META.unit;
  $('caliberLine').textContent = META.caliber;

  // 时间窗口按钮
  const windowBtns = [];
  META.windowLabels.forEach((label, i) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', () => { store.switchWindow(i); refresh(); });
    $('windowBtns').appendChild(b);
    windowBtns.push(b);
  });

  $('datasetSel').addEventListener('change', e => { store.set({ datasetKey: e.target.value }); refresh(); });
  $('pollutantSel').addEventListener('change', e => { store.set({ pollutant: e.target.value }); refresh(); });
  $('regionSel').addEventListener('change', e => { store.set({ region: e.target.value }); refresh(); });
  $('hSlice').addEventListener('input', e => {
    const st = store.get();
    const stats = currentStats();
    const v = Number(e.target.value);
    store.set({ hSlice: v <= Math.floor(stats.min) ? null : v });
    refresh();
  });
  $('vSlice').addEventListener('input', e => {
    const v = Number(e.target.value);
    store.set({ vSlice: v < 0 ? null : v });
    refresh();
  });

  // 点击三维图选择垂直切片列（取投影最近的列）
  $('meshCanvas').addEventListener('click', e => {
    const rect = e.target.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (e.target.width / rect.width);
    const n = META.gridSize;
    const s = Math.min(e.target.width, e.target.height) / (n * 1.9);
    const col = Math.round((mx - e.target.width / 2) / (Math.cos(Math.PI / 6) * s) + (n - 1) / 2);
    const clamped = Math.max(0, Math.min(n - 1, col));
    store.set({ vSlice: clamped });
    refresh();
  });

  let lastGrid = null;
  function currentStats() {
    const st = store.get();
    return P.computeStats(lastGrid || gridFor(st), st.region);
  }
  function gridFor(st) {
    return P.aggregateGrid(cleaned(st.datasetKey).records, st.pollutant, st.window, META.gridSize);
  }

  function refresh() {
    const st = store.get();
    const grid = gridFor(st);
    lastGrid = grid;
    const stats = P.computeStats(grid, st.region);
    const hotspots = P.topHotspots(grid, st.region, st.hSlice, 8);

    // 控件回显
    windowBtns.forEach((b, i) => b.classList.toggle('active', i === st.window));
    $('datasetSel').value = st.datasetKey;
    $('pollutantSel').value = st.pollutant;
    $('regionSel').value = st.region;
    const hs = $('hSlice');
    hs.min = Math.floor(stats.min);
    hs.max = Math.ceil(stats.max);
    hs.value = st.hSlice === null ? hs.min : st.hSlice;
    $('hSliceVal').textContent = st.hSlice === null ? '关闭' : '≥ ' + st.hSlice + ' µg/m³';
    $('vSlice').value = st.vSlice === null ? -1 : st.vSlice;
    $('vSliceVal').textContent = st.vSlice === null ? '关闭' : 'gx=' + st.vSlice;

    // 当前筛选条件
    $('filterLine').textContent = '当前筛选：数据集=' + DATASETS[st.datasetKey].label
      + '｜污染物=' + POLLUTANT_LABEL[st.pollutant]
      + '｜时间窗口=' + META.windowLabels[st.window]
      + '｜区域=' + REGION_LABEL[st.region]
      + '｜水平切片=' + (st.hSlice === null ? '关闭' : '≥' + st.hSlice + ' µg/m³')
      + '｜垂直切片=' + (st.vSlice === null ? '关闭' : 'gx=' + st.vSlice);

    // 图形
    R.drawMesh(meshCtx, grid, {
      stats, region: st.region, hSlice: st.hSlice, vSlice: st.vSlice,
      highlight: hotspots.slice(0, 3),
    });
    R.drawProfile(profileCtx, grid, st.vSlice, { stats, hSlice: st.hSlice, unit: META.unit });
    R.drawLegend(legendCtx, stats, POLLUTANT_LABEL[st.pollutant]);

    // 热点清单
    const tbody = $('hotspotTable').querySelector('tbody');
    tbody.innerHTML = '';
    hotspots.forEach((h, i) => {
      const tr = document.createElement('tr');
      if (st.vSlice !== null && h.gx === st.vSlice) tr.className = 'on-slice';
      const reg = P.regionOf(h.gx, h.gy, META.gridSize);
      tr.innerHTML = '<td>' + (i + 1) + '</td><td>(' + h.gx + ',' + h.gy + ')</td><td>'
        + REGION_LABEL[reg] + '</td><td class="num">' + h.value.toFixed(1) + '</td>';
      tbody.appendChild(tr);
    });
    if (!hotspots.length) {
      tbody.innerHTML = '<tr><td colspan="4">当前切面无超标网格</td></tr>';
    }

    // 数据质量摘要
    const q = cleaned(st.datasetKey).quality;
    let missingCells = 0;
    for (let x = 0; x < META.gridSize; x++)
      for (let y = 0; y < META.gridSize; y++)
        if (grid[x][y] === null) missingCells++;
    $('qualityList').innerHTML = [
      ['原始记录数', q.rawCount],
      ['期望记录数（传感器×窗口×序列）', q.expectedCount],
      ['去重剔除（重复记录）', q.duplicatesRemoved],
      ['异常剔除（<0 或 >1000）', q.anomaliesRemoved],
      ['缺失记录数', q.missingCount],
      ['清洗后有效记录', q.cleanCount],
      ['当前窗口缺失网格', missingCells],
    ].map(([k, v]) => '<li><span>' + k + '</span><b>' + v + '</b></li>').join('');
  }

  function download(name, url) {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
  }

  $('exportCsv').addEventListener('click', () => {
    const st = store.get();
    const csv = P.buildCsv(lastGrid, st.region, {
      datasetLabel: DATASETS[st.datasetKey].label,
      version: META.version,
      pollutant: POLLUTANT_LABEL[st.pollutant],
      windowLabel: META.windowLabels[st.window],
      region: REGION_LABEL[st.region],
    });
    download('pm-grid-w' + st.window + '.csv',
      URL.createObjectURL(new Blob([csv], { type: 'text/csv' })));
  });

  $('exportPng').addEventListener('click', () => {
    const st = store.get();
    const stats = P.computeStats(lastGrid, st.region);
    const hotspots = P.topHotspots(lastGrid, st.region, st.hSlice, 5);
    const W = 800;
    const headH = 74, rowH = 20;
    const footH = 30 + rowH * (hotspots.length + 1);
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = headH + $('meshCanvas').height + $('legendCanvas').height + footH;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#0e1420';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#dfe6ef';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText('城市颗粒物浓度三维切片  ' + META.version, 16, 24);
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#9fc2ff';
    ctx.fillText($('filterLine').textContent, 16, 44);
    ctx.fillStyle = '#8fa3bd';
    ctx.fillText(META.caliber, 16, 62);
    let y = headH;
    ctx.drawImage($('meshCanvas'), (W - $('meshCanvas').width) / 2, y);
    y += $('meshCanvas').height;
    ctx.drawImage($('legendCanvas'), (W - $('legendCanvas').width) / 2, y);
    y += $('legendCanvas').height + 8;
    ctx.fillStyle = '#dfe6ef';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText('热点清单（与屏幕一致）', 16, y);
    ctx.font = '12px sans-serif';
    hotspots.forEach((h, i) => {
      y += rowH;
      ctx.fillStyle = '#ffd98a';
      ctx.fillText('#' + (i + 1) + '  网格(' + h.gx + ',' + h.gy + ')  '
        + REGION_LABEL[P.regionOf(h.gx, h.gy, META.gridSize)]
        + '  ' + h.value.toFixed(1) + ' µg/m³', 24, y);
    });
    download('pm3d-w' + st.window + '.png', cv.toDataURL('image/png'));
  });

  refresh();
})();
