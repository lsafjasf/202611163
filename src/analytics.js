import { HOUR, SAMPLE_HOURS, THRESHOLDS } from "./data.js";

export const WINDOW_OPTIONS = Object.freeze({
  "6h": { label: "近 6 小时", hours: 6 },
  "12h": { label: "近 12 小时", hours: 12 },
  "24h": { label: "近 24 小时", hours: 24 },
  all: { label: "全部时段", hours: SAMPLE_HOURS },
});

export const NUMERIC_FIELDS = Object.freeze([
  "inflow",
  "outflow",
  "level",
  "gate",
  "downstream",
]);

export const FIELD_RULES = Object.freeze({
  inflow: { label: "入库流量", min: 0, max: 500, digits: 1 },
  outflow: { label: "出库流量", min: 0, max: 500, digits: 1 },
  level: { label: "坝前水位", min: 75, max: 95, digits: 2 },
  gate: { label: "闸门开度", min: 0, max: 100, digits: 1 },
  downstream: { label: "下游流量", min: 0, max: 600, digits: 1 },
});

const max = (numbers) => Math.max(...numbers);
const min = (numbers) => Math.min(...numbers);
const mean = (numbers) =>
  numbers.reduce((total, number) => total + number, 0) / numbers.length;

function isMissing(value) {
  return value === null || value === undefined || value === "";
}

function isAnomaly(field, value) {
  const rule = FIELD_RULES[field];
  return (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < rule.min ||
    value > rule.max
  );
}

function interpolateField(rows, field) {
  const valid = [];
  rows.forEach((row, index) => {
    const value = row[field];
    if (typeof value === "number" && Number.isFinite(value)) {
      valid.push({ index, value });
    }
  });
  if (!valid.length) return;

  rows.forEach((row, index) => {
    if (typeof row[field] === "number" && Number.isFinite(row[field])) return;
    const before = [...valid].reverse().find((item) => item.index < index);
    const after = valid.find((item) => item.index > index);
    if (before && after) {
      const ratio = (index - before.index) / (after.index - before.index);
      row[field] = before.value + (after.value - before.value) * ratio;
    } else {
      row[field] = (before || after).value;
    }
  });
}

export function cleanDataset(rawRows) {
  const sorted = [...rawRows].sort((a, b) => a.timestamp - b.timestamp);
  const uniqueByTime = new Map();
  let duplicateRows = 0;

  sorted.forEach((raw) => {
    if (uniqueByTime.has(raw.timestamp)) duplicateRows += 1;
    uniqueByTime.set(raw.timestamp, { ...raw });
  });

  let missingValues = 0;
  let anomalyValues = 0;
  const rows = [...uniqueByTime.values()]
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((row) => {
      const next = {
        ...row,
        _qualityFlags: [],
        _missingFields: [],
        _anomalyFields: [],
        _wasDuplicate: sorted.filter(
          (item) => item.timestamp === row.timestamp,
        ).length > 1,
      };

      NUMERIC_FIELDS.forEach((field) => {
        if (isMissing(next[field])) {
          missingValues += 1;
          next._missingFields.push(field);
          next._qualityFlags.push("missing");
          next[field] = null;
        } else if (isAnomaly(field, next[field])) {
          anomalyValues += 1;
          next._anomalyFields.push(field);
          next._qualityFlags.push("anomaly");
          next[field] = null;
        }
      });
      if (next._wasDuplicate) next._qualityFlags.push("duplicate");
      return next;
    });

  NUMERIC_FIELDS.forEach((field) => interpolateField(rows, field));
  rows.forEach((row) => {
    NUMERIC_FIELDS.forEach((field) => {
      const digits = FIELD_RULES[field].digits;
      row[field] = Number(row[field].toFixed(digits));
    });
  });

  return {
    rows,
    quality: {
      rawRows: rawRows.length,
      duplicateRows,
      missingValues,
      anomalyValues,
      cleanedRows: rows.length,
      flaggedRows: rows.filter((row) => row._qualityFlags.length).length,
      expectedCells: rawRows.length * NUMERIC_FIELDS.length,
      completeness:
        (1 - missingValues / (rawRows.length * NUMERIC_FIELDS.length)) * 100,
    },
  };
}

export function filterRows(rows, windowKey) {
  const option = WINDOW_OPTIONS[windowKey] || WINDOW_OPTIONS["24h"];
  const sorted = [...rows].sort((a, b) => a.timestamp - b.timestamp);
  return sorted.slice(Math.max(0, sorted.length - option.hours));
}

export function aggregateRows(rows) {
  if (!rows.length) return null;
  const inflows = rows.map((row) => row.inflow);
  const outflows = rows.map((row) => row.outflow);
  const levels = rows.map((row) => row.level);
  const downstreams = rows.map((row) => row.downstream);
  const peakLevelRow = rows[levels.indexOf(max(levels))];
  const peakDownstreamRow = rows[downstreams.indexOf(max(downstreams))];
  const peakInflowRow = rows[inflows.indexOf(max(inflows))];
  const peakOutflowRow = rows[outflows.indexOf(max(outflows))];

  return {
    count: rows.length,
    meanInflow: mean(inflows),
    meanOutflow: mean(outflows),
    maxInflow: max(inflows),
    minInflow: min(inflows),
    maxOutflow: max(outflows),
    peakOutflowRow,
    meanLevel: mean(levels),
    maxLevel: max(levels),
    minLevel: min(levels),
    peakLevelRow,
    maxDownstream: max(downstreams),
    peakDownstreamRow,
    peakInflowRow,
  };
}

const clamp = (value, lower, upper) =>
  Math.min(upper, Math.max(lower, value));

export function simulateScenario(rows, gateOpening) {
  if (!rows.length) return null;
  const ordered = [...rows].sort((a, b) => a.timestamp - b.timestamp);
  const last = ordered.at(-1);
  const baselineGate = last.gate;
  const releaseRatio = clamp(gateOpening / Math.max(baselineGate, 0.1), 0, 3);
  const downstreamFactor = clamp(releaseRatio, 0.08, 2.75);
  const levelTarget = clamp((1 - releaseRatio) * 0.92, -1.1, 0.95);
  const lagShape = [0, 0, 0.005, 0.18, 0.42, 0.66, 0.84];
  const forecast = lagShape.map((lag, index) => {
    return {
      timestamp: last.timestamp + index * HOUR,
      inflow: Number(last.inflow.toFixed(1)),
      outflow: Number((last.outflow * downstreamFactor).toFixed(1)),
      level: Number((last.level + levelTarget * lag).toFixed(2)),
      downstream: Number((last.downstream * downstreamFactor).toFixed(1)),
      gate: gateOpening,
      isForecast: true,
    };
  });

  const maxLevel = max(forecast.map((row) => row.level));
  const maxDownstream = max(forecast.map((row) => row.downstream));
  return {
    baselineGate,
    gateOpening,
    releaseRatio,
    levelDelta: levelTarget,
    forecast,
    maxLevel,
    maxDownstream,
    levelAlarm: maxLevel > THRESHOLDS.warningLevel,
    downstreamAlarm: maxDownstream > THRESHOLDS.downstreamCap,
    delayHours: THRESHOLDS.delayHours,
  };
}

export function simulateOperation(rows, rowIndex, gate) {
  const row = rows[Math.min(rowIndex, rows.length - 1)];
  if (!row) return null;
  const ratio = clamp(gate / Math.max(row.gate, 0.1), 0, 3);
  const downstream = row.downstream * clamp(ratio, 0.08, 2.75);
  const downstreamLevelDelta = clamp((1 - ratio) * 0.92, -1.1, 0.95) * 0.28;
  const level = Math.min(
    THRESHOLDS.warningLevel + 1.8,
    row.level + downstreamLevelDelta,
  );
  return {
    row,
    outflow: row.outflow * clamp(ratio, 0.08, 2.75),
    downstream,
    level,
    delayed: Math.abs(downstreamLevelDelta) > 0.02,
  };
}

export const formatOne = (value) =>
  Number(value).toLocaleString("zh-CN", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

export const formatTwo = (value) =>
  Number(value).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export function qualityLabel(row) {
  if (row._anomalyFields.length) return "异常已插补";
  if (row._missingFields.length) return "缺失已插补";
  if (row._wasDuplicate) return "重复已去重";
  return "完整";
}

function csvCell(value) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function buildExportCsv({
  rows,
  datasetMeta,
  windowLabel,
  scenario,
  quality,
}) {
  const lines = [
    ["青岚水库调度视图导出"],
    ["数据版本", datasetMeta.version],
    ["数据更新时间", datasetMeta.updatedAt],
    ["当前筛选", `${datasetMeta.label} / ${windowLabel}`],
    [
      "统计口径",
      "按小时对齐；流量 m³/s，水位 m；均值与峰值基于清洗后有效记录；首末时刻均包含",
    ],
    [
      "数据质量",
      `原始 ${quality.rawRows}，去重 ${quality.duplicateRows}，缺失 ${quality.missingValues}，异常 ${quality.anomalyValues}，清洗后 ${quality.cleanedRows}`,
    ],
    [],
    [
      "时刻",
      "入库流量(m³/s)",
      "出库流量(m³/s)",
      "坝前水位(m)",
      "下游流量(m³/s)",
      "闸门开度(%)",
      "数据状态",
    ],
    ...rows.map((row) => [
      new Date(row.timestamp).toISOString(),
      formatOne(row.inflow),
      formatOne(row.outflow),
      formatTwo(row.level),
      formatOne(row.downstream),
      formatOne(row.gate),
      qualityLabel(row),
    ]),
    [],
    ["推演参数", "数值"],
    ["当前闸门开度(%)", formatOne(scenario.gateOpening)],
    ["基准闸门开度(%)", formatOne(scenario.baselineGate)],
    ["响应延迟(h)", scenario.delayHours],
    ["推演水位峰值(m)", formatTwo(scenario.maxLevel)],
    ["推演下游流量峰值(m³/s)", formatOne(scenario.maxDownstream)],
    ["警戒水位(m)", formatTwo(THRESHOLDS.warningLevel)],
    ["下游流量上限(m³/s)", formatOne(THRESHOLDS.downstreamCap)],
  ];
  return `\uFEFF${lines.map((line) => line.map(csvCell).join(",")).join("\r\n")}`;
}
