export const HOUR = 60 * 60 * 1000;
export const START_TIME = Date.UTC(2026, 10, 14, 0, 0, 0);
export const SAMPLE_HOURS = 48;

export const THRESHOLDS = Object.freeze({
  warningLevel: 85.2,
  downstreamCap: 280,
  delayHours: 3,
});

export const DATASET_META = Object.freeze({
  normal: {
    label: "正常样例",
    short: "正常",
    version: "QL-HYD-261116-A",
    updatedAt: "2026-11-16 07:45",
    description: "连续完整、无重复记录",
  },
  missing: {
    label: "缺失样例",
    short: "缺失",
    version: "QL-HYD-261116-B",
    updatedAt: "2026-11-16 07:48",
    description: "含字段缺失与越界值",
  },
  duplicate: {
    label: "重复样例",
    short: "重复",
    version: "QL-HYD-261116-C",
    updatedAt: "2026-11-16 07:52",
    description: "含同一时刻重复上报",
  },
});

const round = (value, digits = 1) => Number(value.toFixed(digits));

function buildRecord(index) {
  const rainPulse =
    index >= 16 && index <= 34
      ? 14 * Math.sin(((index - 16) / 18) * Math.PI)
      : 0;
  const inflow = round(
    62 +
      15 * Math.sin(index / 5.5 + 0.5) +
      8 * Math.sin(index / 2.1) +
      rainPulse,
  );
  const outflow = round(
    56 + 0.55 * inflow + 9 * Math.sin(index / 4.4 + 1.2),
  );
  const level = round(
    83.77 +
      index * 0.022 +
      0.36 * Math.sin(index / 8.4 + 0.7) +
      0.12 * Math.sin(index / 2.6) +
      rainPulse * 0.004,
    2,
  );
  const gate = round(
    38 + 6 * Math.sin(index / 8 + 0.3) + 3 * Math.cos(index / 3.2),
  );
  const downstream = round(
    outflow * 1.12 + 15 + 6 * Math.sin(index / 3.7 + 0.5),
  );

  return {
    id: `QL-${String(index + 1).padStart(3, "0")}`,
    timestamp: START_TIME + index * HOUR,
    inflow,
    outflow,
    level,
    gate,
    downstream,
  };
}

const normalRows = Array.from({ length: SAMPLE_HOURS }, (_, index) =>
  buildRecord(index),
);

const cloneRows = (rows) =>
  rows.map((row) => ({
    ...row,
  }));

function withMissing(rows) {
  const next = cloneRows(rows);
  next[7].inflow = null;
  next[10].level = null;
  next[22].outflow = null;
  next[34].downstream = null;
  next[39].downstream = null;
  next[15].level = 96.4;
  next[27].inflow = -12.5;
  return next;
}

function withDuplicates(rows) {
  const next = cloneRows(rows);
  const duplicated = [9, 17, 26, 33, 42].map((index) => ({
    ...rows[index],
    id: `${rows[index].id}-DUP`,
    outflow: round(rows[index].outflow + 6.8),
    gate: round(rows[index].gate + 1.2),
    downstream: index === 26 ? 950 : rows[index].downstream,
  }));
  return [...next, ...duplicated];
}

export const RAW_DATASETS = Object.freeze({
  normal: normalRows,
  missing: withMissing(normalRows),
  duplicate: withDuplicates(normalRows),
});

export const OPERATION_SAMPLES = Object.freeze([
  {
    id: "OP-09-18",
    rowIndex: 9,
    gate: 46.5,
    operator: "调度一班",
    note: "雨前预泄",
  },
  {
    id: "OP-14-06",
    rowIndex: 27,
    gate: 36.8,
    operator: "调度二班",
    note: "削减下泄",
  },
  {
    id: "OP-20-22",
    rowIndex: 38,
    gate: 44.2,
    operator: "值班长",
    note: "洪峰后回调",
  },
]);

export const SERIES_META = Object.freeze({
  inflow: {
    label: "入库流量",
    unit: "m³/s",
    color: "#1b8b8b",
  },
  outflow: {
    label: "出库流量",
    unit: "m³/s",
    color: "#e6a044",
  },
  level: {
    label: "坝前水位",
    unit: "m",
    color: "#2e66d0",
  },
  downstream: {
    label: "下游流量",
    unit: "m³/s",
    color: "#d15c4c",
  },
});
