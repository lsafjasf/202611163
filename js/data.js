// 纯数据模块：常量、确定性数据生成。可同时被浏览器与 Node 测试加载。

export const SAMPLE_MS = 25;            // 40 Hz 采样
export const SAMPLE_STEP = SAMPLE_MS / 1000;
export const DURATION_S = 30;
export const SAMPLES_PER_STATION = DURATION_S / SAMPLE_STEP; // 1200
export const BIN_SECONDS = 1;
export const BIN_COUNT = DURATION_S / BIN_SECONDS;
export const WAVE_SPEED_KM_S = 3.5;

export const SOURCE = { id: "EP01", name: "震源 EP01", x: 0, y: 0 };

export const STATIONS = [
  { id: "STA_A", name: "台站 A", x: -10.4, y: 6.0, color: "#4a90d9", seed: 101 },
  { id: "STA_B", name: "台站 B", x: 16.8, y: 12.6, color: "#e0a23b", seed: 202 },
  { id: "STA_C", name: "台站 C", x: 5.6, y: -5.7, color: "#57c98b", seed: 303 },
];

STATIONS.forEach((s) => {
  s.distanceKm = Math.hypot(s.x, s.y);
  s.arrivalS = s.distanceKm / WAVE_SPEED_KM_S;
});

export const TIME_WINDOWS = [
  { id: "full", label: "全程 0–30s", start: 0, end: 30 },
  { id: "w1", label: "0–10s", start: 0, end: 10 },
  { id: "w2", label: "10–20s", start: 10, end: 20 },
  { id: "w3", label: "20–30s", start: 20, end: 30 },
];

export const DATASET_VERSIONS = {
  normal: {
    id: "normal", label: "正常组",
    version: "wave-v1.4.0+normal", seed: 20261116,
  },
  missing: {
    id: "missing", label: "缺失组",
    version: "wave-v1.4.0+missing", seed: 20261117,
  },
  duplicate: {
    id: "duplicate", label: "重复组",
    version: "wave-v1.4.0+duplicate", seed: 20261118,
  },
};

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ricker(timeSec, arrivalSec) {
  const f = 2.5; // 主频 Hz
  const x = timeSec - arrivalSec;
  const k = Math.PI * f * x;
  return (1 - 2 * k * k) * Math.exp(-k * k);
}

// 生成单台站的“干净”原始样例（含小幅噪声、震相脉冲、遥测尖峰）
function baseSamples(station) {
  const rng = mulberry32(station.seed);
  const rows = [];
  for (let i = 0; i < SAMPLES_PER_STATION; i += 1) {
    const t = i * SAMPLE_STEP;
    const noise = (rng() - 0.5) * 0.6;
    const pulse = ricker(t, station.arrivalS);
    rows.push({ stationId: station.id, t, v: noise + pulse });
  }
  // 三个遥测尖峰，均位于震相到达窗口（±1.2s）之外
  [12, 18, 25].forEach((sec, idx) => {
    const row = rows[sec / SAMPLE_STEP];
    row.v = idx % 2 === 0 ? 6.2 : -5.8;
  });
  return rows;
}

// 注入清单：仅供测试交叉核对，界面与导出均不读取该字段
function buildManifest() {
  const spikes = {};
  STATIONS.forEach((s) => { spikes[s.id] = 3; });
  return {
    normal: { spikes, missingSamples: {}, gapEvents: {}, duplicateRows: {} },
    missing: {
      spikes,
      missingSamples: { STA_B: 40, STA_C: 24 },
      gapEvents: { STA_B: 1, STA_C: 2 },
      duplicateRows: {},
    },
    duplicate: {
      spikes,
      missingSamples: {},
      gapEvents: {},
      duplicateRows: { STA_A: 25, STA_C: 10 },
    },
  };
}

function injectMissing(rows, stationId, ranges) {
  const remove = new Set();
  ranges.forEach(([startIdx, count]) => {
    for (let i = startIdx; i < startIdx + count; i += 1) remove.add(i);
  });
  return rows.filter((r) => {
    if (r.stationId !== stationId) return true;
    const idx = Math.round(r.t / SAMPLE_STEP);
    return !remove.has(idx);
  });
}

function injectDuplicates(rows, stationId, startIdx, count) {
  const copies = [];
  rows.forEach((r) => {
    if (r.stationId !== stationId) return;
    const idx = Math.round(r.t / SAMPLE_STEP);
    if (idx >= startIdx && idx < startIdx + count) {
      copies.push({ stationId: r.stationId, t: r.t, v: r.v });
    }
  });
  return rows.concat(copies);
}

export function generateDataset(datasetId) {
  const meta = DATASET_VERSIONS[datasetId];
  if (!meta) throw new Error(`未知数据集: ${datasetId}`);
  let rows = STATIONS.flatMap(baseSamples);

  if (datasetId === "missing") {
    rows = injectMissing(rows, "STA_B", [[300, 40]]);          // 7.5s 起单个缺口
    rows = injectMissing(rows, "STA_C", [[150, 12], [600, 12]]); // 两个缺口
  }
  if (datasetId === "duplicate") {
    rows = injectDuplicates(rows, "STA_A", 400, 25);
    rows = injectDuplicates(rows, "STA_C", 700, 10);
  }

  return {
    id: datasetId,
    meta,
    rows,
    manifest: buildManifest()[datasetId],
    generatedFrom: `seed=${meta.seed}, 40Hz, ${DURATION_S}s, 3 stations`,
  };
}

// ---------- 清洗 ----------

// 统计口径：去重按 (台站, 时间戳) 保留首条；缺失按 40Hz 理论网格逐点核对；
// 异常用稳健 z 分数（中位数+MAD，阈值 3.5，MAD 为 0 时回退 3σ），
// 并对震相理论到达 ±2.5s 窗口加掩码，避免真实脉冲被误判。
export const QUALITY_CALIBER =
  "口径：去重按(台站,时间戳)保留首条；缺失按40Hz理论网格逐点核对；" +
  "异常采用稳健z分数(中位数+MAD,阈值3.5,回退3σ)，震相到达±2.5s窗口掩码；聚合为1秒分箱。";

function median(sortedValues) {
  const n = sortedValues.length;
  if (n === 0) return 0;
  const mid = n >> 1;
  return n % 2 ? sortedValues[mid] : (sortedValues[mid - 1] + sortedValues[mid]) / 2;
}

export function cleanDataset(dataset) {
  const stationIds = STATIONS.map((s) => s.id);
  const arrivalById = Object.fromEntries(STATIONS.map((s) => [s.id, s.arrivalS]));
  const perStation = Object.fromEntries(stationIds.map((id) => [id, []]));
  const q = Object.fromEntries(
    stationIds.map((id) => [id, {
      stationId: id, rawRows: 0, duplicatesRemoved: 0,
      missingSamples: 0, gapEvents: 0, anomalySamples: 0,
      cleanRows: 0, binCount: BIN_COUNT,
    }]),
  );

  const sorted = dataset.rows
    .map((r, rowIndex) => ({ ...r, rowIndex }))
    .sort((a, b) => a.stationId.localeCompare(b.stationId) || a.t - b.t || a.rowIndex - b.rowIndex);

  for (const id of stationIds) {
    const stationRows = sorted.filter((r) => r.stationId === id);
    q[id].rawRows = stationRows.length;

    // 去重
    const seen = new Set();
    const unique = [];
    for (const r of stationRows) {
      const key = r.t.toFixed(6);
      if (seen.has(key)) {
        q[id].duplicatesRemoved += 1;
      } else {
        seen.add(key);
        unique.push(r);
      }
    }
    const valueByT = new Map(unique.map((r) => [r.t.toFixed(6), r.v]));

    // 缺失网格
    const samples = new Array(SAMPLES_PER_STATION);
    let prevMissing = false;
    for (let i = 0; i < SAMPLES_PER_STATION; i += 1) {
      const t = i * SAMPLE_STEP;
      const v = valueByT.get(t.toFixed(6));
      const isMissing = v === undefined;
      if (isMissing) {
        q[id].missingSamples += 1;
        if (!prevMissing) q[id].gapEvents += 1;
        prevMissing = true;
        samples[i] = { stationId: id, t, v: null, isAnomaly: false, isMissing: true };
      } else {
        prevMissing = false;
        samples[i] = { stationId: id, t, v, isAnomaly: false, isMissing: false };
      }
    }

    // 稳健异常检测（跳过缺失与到达窗口）
    const valid = samples
      .filter((s) => !s.isMissing)
      .map((s) => s.v);
    const sortedVals = [...valid].sort((a, b) => a - b);
    const med = median(sortedVals);
    const mad = median(sortedVals.map((v) => Math.abs(v - med)).sort((a, b) => a - b));
    if (mad > 0) {
      const scale = 1.4826 * mad;
      for (const s of samples) {
        if (s.isMissing || Math.abs(s.t - arrivalById[id]) <= 2.5) continue;
        if (Math.abs((s.v - med) / scale) > 3.5) s.isAnomaly = true;
      }
    } else {
      const mean = valid.reduce((a, b) => a + b, 0) / (valid.length || 1);
      const variance = valid.reduce((a, b) => a + (b - mean) ** 2, 0) / (valid.length || 1);
      const std = Math.sqrt(variance);
      for (const s of samples) {
        if (s.isMissing || Math.abs(s.t - arrivalById[id]) <= 2.5) continue;
        if (std > 0 && Math.abs((s.v - mean) / std) > 3) s.isAnomaly = true;
      }
    }

    for (const s of samples) if (s.isAnomaly) q[id].anomalySamples += 1;
    q[id].cleanRows = samples.filter((s) => !s.isMissing).length;
    perStation[id] = samples;
  }

  const totals = stationIds.reduce((acc, id) => {
    for (const key of ["rawRows", "duplicatesRemoved", "missingSamples", "gapEvents", "anomalySamples", "cleanRows"]) {
      acc[key] = (acc[key] || 0) + q[id][key];
    }
    acc.binCount = (acc.binCount || 0) + q[id].binCount;
    return acc;
  }, { stationId: "合计" });

  return { samplesByStation: perStation, quality: q, qualityTotals: totals };
}

// ---------- 聚合 ----------

export function aggregate(cleanResult) {
  const bins = [];
  for (const station of STATIONS) {
    const samples = cleanResult.samplesByStation[station.id];
    for (let b = 0; b < BIN_COUNT; b += 1) {
      const slice = samples.slice(b * 40, (b + 1) * 40);
      const present = slice.filter((s) => !s.isMissing);
      const values = present.map((s) => s.v);
      const n = values.length;
      const sum = values.reduce((a, v) => a + v, 0);
      const mean = n ? sum / n : null;
      const min = n ? Math.min(...values) : null;
      const max = n ? Math.max(...values) : null;
      const rms = n ? Math.sqrt(values.reduce((a, v) => a + v * v, 0) / n) : null;
      const missing = slice.length - n;
      const anomalies = present.filter((s) => s.isAnomaly).length;
      bins.push({
        stationId: station.id,
        binStart: b * BIN_SECONDS,
        binEnd: (b + 1) * BIN_SECONDS,
        count: n,
        mean, min, max, rms,
        missing,
        anomalies,
        flag: anomalies ? "anomaly" : missing ? "missing" : "ok",
      });
    }
  }
  return bins;
}

export function applyFilters(bins, filter) {
  const stationSet = new Set(filter.stations);
  return bins.filter((bin) => {
    if (!stationSet.has(bin.stationId)) return false;
    if (bin.binEnd <= filter.windowStart || bin.binStart >= filter.windowEnd) return false;
    if (filter.quality === "missing" && bin.missing === 0) return false;
    if (filter.quality === "anomaly" && bin.anomalies === 0) return false;
    return true;
  });
}

export function describeFilter(filter) {
  const stations = filter.stations.length
    ? filter.stations.join("、")
    : "（未选择任何台站）";
  const qualityText = {
    all: "全部分箱",
    missing: "仅含缺失分箱",
    anomaly: "仅含异常分箱",
  }[filter.quality];
  return `当前筛选：台站=${stations}；质量=${qualityText}；` +
    `时间窗口=${filter.windowStart}–${filter.windowEnd}s；命中分箱=${filter.matchCount}；` +
    `数据版本=${filter.version}；统计口径=1秒分箱/稳健z(3.5)`;
}

export function fmt(value, digits = 4) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toFixed(digits);
}

export function buildCsv(filteredBins, filter, totals) {
  const lines = [
    "# 地震波形清洗聚合导出",
    `# 数据版本,${filter.version}`,
    `# 统计口径,${QUALITY_CALIBER}`,
    `# 筛选条件,台站=${filter.stations.join("|")};质量=${filter.quality};窗口=${filter.windowStart}-${filter.windowEnd}s`,
    `# 质量摘要,去重删除=${totals.duplicatesRemoved};缺失样例=${totals.missingSamples};异常样例=${totals.anomalySamples}`,
    "station_id,bin_start_s,count,mean,min,max,rms,missing,anomalies,flag",
  ];
  for (const b of filteredBins) {
    lines.push([
      b.stationId,
      b.binStart,
      b.count,
      fmt(b.mean),
      fmt(b.min),
      fmt(b.max),
      fmt(b.rms),
      b.missing,
      b.anomalies,
      b.flag,
    ].join(","));
  }
  return lines.join("\n") + "\n";
}

export function buildFullPipeline(datasetId) {
  const dataset = generateDataset(datasetId);
  const cleaned = cleanDataset(dataset);
  const bins = aggregate(cleaned);
  return { dataset, cleaned, bins };
}
