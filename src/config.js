export const SENSORS = [
  { id: "S1", label: "传感器 A", short: "A", color: "#d95d39" },
  { id: "S2", label: "传感器 B", short: "B", color: "#167f86" },
  { id: "S3", label: "传感器 C", short: "C", color: "#b3811d" },
];

export const ANOMALY_THRESHOLD = 4;

export const STAT_DEFINITION = {
  intervalSeconds: 30,
  duplicateRule: "同一传感器同一时槽的重复读数取中位数",
  errorRule: "误差 = 测量值 − 参考值；MAE = Σ|误差| / 有效配对样本数",
  maxRule: "最大偏差 = 当前范围内有效配对样本的最大 |误差|",
  missingRule: "缺失 = 期望传感器时槽数 − 去重后实际传感器时槽数",
  anomalyRule: `异常 = |去重后测量值 − 参考值| > ${ANOMALY_THRESHOLD.toFixed(1)} °C`,
  scopeRule: "统计仅覆盖当前时间窗口、已启用传感器及异常处理策略",
};

export const WINDOW_PRESETS = [
  { id: "full", label: "全程", read: (last) => [0, last] },
  { id: "first", label: "前 10 分钟", read: (last) => [0, Math.min(20, last)] },
  { id: "middle", label: "中段", read: (last) => [Math.max(0, Math.round(last * 0.35)), Math.round(last * 0.75)] },
  { id: "last", label: "后 10 分钟", read: (last) => [Math.max(0, last - 20), last] },
];

export const palette = {
  ink: "#21302c",
  muted: "#72807a",
  grid: "#dfe4de",
  paper: "#fbfaf6",
  reference: "#2e3a36",
  anomaly: "#c2412d",
};

export function formatValue(value, digits = 2) {
  if (!Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

export function formatSigned(value, digits = 2) {
  if (!Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

export function formatPercent(value, digits = 1) {
  if (!Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatClock(seconds, withSeconds = true) {
  const base = 8 * 3600;
  const total = base + Math.round(seconds);
  const hh = String(Math.floor(total / 3600) % 24).padStart(2, "0");
  const mm = String(Math.floor(total / 60) % 60).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return withSeconds ? `${hh}:${mm}:${ss}` : `${hh}:${mm}`;
}

export function formatDuration(startSlot, endSlot) {
  const minutes = (endSlot - startSlot) * STAT_DEFINITION.intervalSeconds / 60;
  return Number.isInteger(minutes) ? `${minutes} 分钟` : `${minutes.toFixed(1)} 分钟`;
}
