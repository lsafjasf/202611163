/* 数据清洗 / 聚合 / 统计 / 导出 的纯函数管线。
 * 浏览器与 Node 共用，所有派生数值均由原始样例实时重算。 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Pipeline = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const ANOMALY_MIN = 0;      // µg/m³，小于该值视为异常
  const ANOMALY_MAX = 1000;   // µg/m³，大于该值视为异常

  function recordKey(r) {
    return r.sensorId + '|' + r.window + '|' + r.seq;
  }

  function isAnomalyValue(v) {
    return typeof v !== 'number' || !isFinite(v) || v < ANOMALY_MIN || v > ANOMALY_MAX;
  }

  /* 清洗：按 (sensorId, window, seq) 去重保留首条；剔除异常值记录。 */
  function cleanDataset(rawRecords, dims) {
    const seen = new Set();
    const records = [];
    let duplicatesRemoved = 0;
    let anomaliesRemoved = 0;
    for (const r of rawRecords) {
      const k = recordKey(r);
      if (seen.has(k)) { duplicatesRemoved++; continue; }
      seen.add(k);
      if (isAnomalyValue(r.pm25) || isAnomalyValue(r.pm10)) { anomaliesRemoved++; continue; }
      records.push(r);
    }
    const expectedCount = dims.sensors * dims.windows * dims.seqs;
    const missingCount = expectedCount - seen.size;
    return {
      records,
      quality: {
        rawCount: rawRecords.length,
        expectedCount,
        duplicatesRemoved,
        anomaliesRemoved,
        missingCount,
        cleanCount: records.length,
      },
    };
  }

  /* 聚合：指定时间窗口内，按网格单元对传感器读数取算术平均。 */
  function aggregateGrid(records, pollutant, windowIdx, gridSize) {
    const sum = new Map();
    for (const r of records) {
      if (r.window !== windowIdx) continue;
      const k = r.gx + ',' + r.gy;
      const cell = sum.get(k) || { s: 0, n: 0 };
      cell.s += r[pollutant];
      cell.n += 1;
      sum.set(k, cell);
    }
    const grid = [];
    for (let x = 0; x < gridSize; x++) {
      const row = [];
      for (let y = 0; y < gridSize; y++) {
        const cell = sum.get(x + ',' + y);
        row.push(cell ? cell.s / cell.n : null); // null = 缺失网格
      }
      grid.push(row);
    }
    return grid;
  }

  function isCenter(gx, gy, gridSize) {
    const c = (gridSize - 1) / 2;
    return Math.hypot(gx - c, gy - c) <= gridSize * 0.3;
  }

  function regionOf(gx, gy, gridSize) {
    return isCenter(gx, gy, gridSize) ? 'center' : 'suburb';
  }

  /* 按区域筛选收集单元值（region: 'all' | 'center' | 'suburb'）。 */
  function collectCells(grid, region) {
    const out = [];
    const n = grid.length;
    for (let x = 0; x < n; x++) {
      for (let y = 0; y < n; y++) {
        const v = grid[x][y];
        if (v === null || v === undefined) continue;
        if (region !== 'all' && regionOf(x, y, n) !== region) continue;
        out.push({ gx: x, gy: y, value: v });
      }
    }
    return out;
  }

  /* 颜色标尺统计：随当前窗口与筛选实时重算。 */
  function computeStats(grid, region) {
    const cells = collectCells(grid, region);
    if (!cells.length) return { min: 0, max: 0, mean: 0, count: 0 };
    let min = Infinity, max = -Infinity, s = 0;
    for (const c of cells) {
      if (c.value < min) min = c.value;
      if (c.value > max) max = c.value;
      s += c.value;
    }
    return { min, max, mean: s / cells.length, count: cells.length };
  }

  /* 热点清单：与当前切面/筛选同步；threshold 为水平切片阈值（可空）。 */
  function topHotspots(grid, region, threshold, limit) {
    let cells = collectCells(grid, region);
    if (threshold !== null && threshold !== undefined) {
      cells = cells.filter(c => c.value >= threshold);
    }
    cells.sort((a, b) => b.value - a.value);
    return cells.slice(0, limit);
  }

  /* CSV 导出：数值与屏幕网格完全一致（同一聚合结果序列化）。 */
  function buildCsv(grid, region, meta) {
    const lines = ['# dataset=' + meta.datasetLabel,
      '# version=' + meta.version,
      '# pollutant=' + meta.pollutant,
      '# window=' + meta.windowLabel,
      '# region=' + meta.region,
      '# unit=ug/m3, agg=window-mean',
      'gx,gy,region,value'];
    const n = grid.length;
    for (let x = 0; x < n; x++) {
      for (let y = 0; y < n; y++) {
        const v = grid[x][y];
        if (v === null || v === undefined) continue;
        const reg = regionOf(x, y, n);
        if (region !== 'all' && reg !== region) continue;
        lines.push([x, y, reg, v.toFixed(3)].join(','));
      }
    }
    return lines.join('\n') + '\n';
  }

  /* 状态仓库：切换时间窗口只改 window 字段，其余状态保留；
   * 每个窗口可保存/恢复快照，返回时不丢失。 */
  function createStore(initial) {
    const state = Object.assign({}, initial);
    const snapshots = new Map();
    return {
      get: () => Object.assign({}, state),
      set(patch) { Object.assign(state, patch); },
      switchWindow(w) {
        snapshots.set(state.window, Object.assign({}, state));
        state.window = w;
        const snap = snapshots.get(w);
        if (snap) Object.assign(state, snap);
      },
    };
  }

  return {
    ANOMALY_MIN, ANOMALY_MAX,
    cleanDataset, aggregateGrid, collectCells, computeStats,
    topHotspots, buildCsv, regionOf, createStore,
  };
});
