/* 固定样例数据：由确定性种子生成，三组数据集（正常 / 缺失 / 重复+异常）。
 * 原始记录粒度：传感器 × 时间窗口 × 序列读数。 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RawData = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const GRID = 16;     // 16×16 传感器网格
  const WINDOWS = 6;   // 6 个时间窗口（每窗口 4 小时）
  const SEQS = 4;      // 每窗口 4 次序列读数（每小时 1 次）

  const META = {
    version: 'sample-v1.3.0',
    generated: '2026-11-16',
    gridSize: GRID,
    windows: WINDOWS,
    seqs: SEQS,
    sensors: GRID * GRID,
    unit: 'µg/m³',
    caliber: '统计口径：时间窗口内算术平均；重复记录保留首条；'
      + '异常值（<0 或 >1000 µg/m³）剔除；缺失网格不参与聚合与统计。',
    windowLabels: ['00-04时', '04-08时', '08-12时', '12-16时', '16-20时', '20-24时'],
  };

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* 浓度场：市中心主热点 + 郊区工业次热点 + 时间波动。 */
  function baseValue(gx, gy, w) {
    const c = (GRID - 1) / 2;
    const d2 = (gx - c) * (gx - c) + (gy - c) * (gy - c);
    let v = 18 + 95 * Math.exp(-d2 / 18);
    v += 34 * Math.exp(-((gx - 12) ** 2 + (gy - 3) ** 2) / 5); // 郊区工业源
    v += 12 * Math.sin(gx * 0.8 + w * 0.9) * Math.cos(gy * 0.6 - w * 0.4);
    v += 6 * Math.sin(w * 1.7 + 0.5);
    return v;
  }

  function genNormal() {
    const rng = mulberry32(20261116);
    const out = [];
    for (let gx = 0; gx < GRID; gx++) {
      for (let gy = 0; gy < GRID; gy++) {
        const id = 'S' + String(gx).padStart(2, '0') + String(gy).padStart(2, '0');
        for (let w = 0; w < WINDOWS; w++) {
          for (let s = 0; s < SEQS; s++) {
            const pm25 = baseValue(gx, gy, w) + (rng() - 0.5) * 6 + (rng() - 0.5) * 2;
            const pm10 = pm25 * 1.55 + 4 + (rng() - 0.5) * 8;
            out.push({ sensorId: id, gx, gy, window: w, seq: s, pm25, pm10 });
          }
        }
      }
    }
    return out;
  }

  const normal = genNormal();

  /* 缺失组：随机丢弃约 8% 读数（含 2 个整格缺失）。 */
  function genMissing() {
    const rng = mulberry32(77001);
    const dropCells = new Set(['3,11', '13,12']);
    return normal.filter(r => {
      if (dropCells.has(r.gx + ',' + r.gy)) return false;
      return rng() >= 0.06;
    });
  }

  /* 重复组：追加约 5% 扰动重复记录（验证保留首条），并注入 6 条异常值。 */
  function genDuplicate() {
    const rng = mulberry32(99002);
    const out = normal.slice();
    const dupCount = Math.floor(normal.length * 0.05);
    for (let i = 0; i < dupCount; i++) {
      const src = normal[Math.floor(rng() * normal.length)];
      out.push(Object.assign({}, src, {
        pm25: src.pm25 + 50 + rng() * 50,   // 扰动值，应被去重丢弃
        pm10: src.pm10 + 80 + rng() * 60,
      }));
    }
    const anomalyIdx = [10, 500, 1234, 2222, 3333, 4096];
    for (const idx of anomalyIdx) {
      out[idx] = Object.assign({}, out[idx], {
        pm25: idx % 2 === 0 ? -7.5 : 4500,  // 超量程异常
        pm10: idx % 2 === 0 ? -3.2 : 5200,
      });
    }
    return out;
  }

  const DATASETS = {
    normal: { label: '正常数据', records: normal },
    missing: { label: '缺失数据', records: genMissing() },
    duplicate: { label: '重复+异常数据', records: genDuplicate() },
  };

  return { META, DATASETS };
});
