import {
  formatClock,
  formatDuration,
  formatPercent,
  formatSigned,
  formatValue,
  SENSORS,
  STAT_DEFINITION,
} from "./config.js";

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvLine(values) {
  return values.map(csvCell).join(",");
}

function sensorLabel(id) {
  return SENSORS.find((sensor) => sensor.id === id)?.label ?? id;
}

export function windowLabel(view) {
  const startSeconds = view.startSlot * view.intervalSeconds;
  const endSeconds = view.endSlot * view.intervalSeconds;
  return `${formatClock(startSeconds)}–${formatClock(endSeconds)}`;
}

export function buildCalibrationCsv(view) {
  const lines = [
    csvLine(["数据集", view.title]),
    csvLine(["数据版本", view.version]),
    csvLine(["时间窗口", windowLabel(view)]),
    csvLine(["窗口时长", `${view.endSlot - view.startSlot + 1} 个时槽`]),
    csvLine(["启用传感器", view.selectedSensors.map(sensorLabel).join(" / ")]),
    csvLine(["异常策略", view.excludeAnomalies ? STAT_DEFINITION.anomalyRule : "保留异常时槽"]),
    csvLine(["统计口径", STAT_DEFINITION.errorRule]),
    "",
    csvLine([
      "时间",
      "传感器",
      "参考值 (°C)",
      "原始值 (°C)",
      "校准值 (°C)",
      "原始误差 (°C)",
      "校准误差 (°C)",
      "原始样本数",
      "异常标记",
      "纳入统计",
    ]),
  ];

  for (const row of view.rows) {
    lines.push(csvLine([
      formatClock(row.t),
      sensorLabel(row.sensor),
      formatValue(row.reference),
      formatValue(row.raw),
      formatValue(row.calibrated),
      formatSigned(row.rawError),
      formatSigned(row.calibratedError),
      row.sampleCount,
      row.anomaly ? "是" : "否",
      row.included ? "是" : "否",
    ]));
  }

  lines.push(
    "",
    csvLine(["指标", "原始", "校准后"]),
    csvLine(["平均绝对误差 MAE (°C)", formatValue(view.stats.rawMae, 3), formatValue(view.stats.calibratedMae, 3)]),
    csvLine(["最大偏差 (°C)", formatValue(view.stats.rawMax, 3), formatValue(view.stats.calibratedMax, 3)]),
    csvLine(["有效配对样本", view.stats.n, view.stats.n]),
    csvLine(["MAE 改善", formatPercent(view.stats.improvement), ""]),
    csvLine(["数据版本", view.version, ""]),
    csvLine(["窗口缺失数", view.quality.missingInWindow, ""]),
    csvLine(["窗口去重数", view.quality.duplicateRemovedInWindow, ""]),
    csvLine(["窗口异常数", view.quality.anomaliesInWindow, ""]),
    csvLine(["统计口径", STAT_DEFINITION.anomalyRule, ""]),
  );

  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function buildRawCsv(dataset) {
  const referenceByT = new Map(dataset.reference.map((point) => [point.t, point.value]));
  const lines = [
    csvLine(["数据版本", dataset.version]),
    csvLine(["数据源", dataset.source]),
    csvLine(["采样间隔", `${dataset.intervalSeconds} 秒`]),
    csvLine(["异常阈值", `${dataset.anomalyThreshold} °C`]),
    "",
    csvLine(["原始记录 ID", "时间", "传感器", "原始测量值 (°C)", "同刻参考值 (°C)"]),
  ];

  for (const row of dataset.readings) {
    lines.push(csvLine([
      row.id,
      formatClock(row.t),
      sensorLabel(row.sensor),
      formatValue(row.value, 3),
      formatValue(referenceByT.get(row.t), 3),
    ]));
  }

  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function downloadText(filename, text, type = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function exportFilename(view, extension) {
  const safeVersion = view.version.replaceAll(/[^\w.-]+/g, "_");
  const start = formatClock(view.startSlot * view.intervalSeconds).replaceAll(":", "");
  const end = formatClock(view.endSlot * view.intervalSeconds).replaceAll(":", "");
  return `trident_${safeVersion}_${start}-${end}.${extension}`;
}

export function durationText(view) {
  return formatDuration(view.startSlot, view.endSlot);
}
