import {
  DAY_START_MIN,
  LINE_DEFS,
  SAMPLE_END_MIN,
  formatClock,
  minuteFromIso
} from "./data.js";

export const HEADWAY_MIN_SECONDS = 6 * 60;
export const HEADWAY_MAX_SECONDS = 20 * 60;

export const WINDOW_PRESETS = [
  { id: "morning", label: "06:30–08:00", startMinute: 390, endMinute: 480 },
  { id: "peak", label: "07:30–09:00", startMinute: 450, endMinute: 540 },
  { id: "late", label: "08:30–10:00", startMinute: 510, endMinute: 600 },
  { id: "all", label: "全程", startMinute: DAY_START_MIN, endMinute: SAMPLE_END_MIN }
];

export const ALL_LINE_IDS = LINE_DEFS.map((line) => line.id);

export function windowKey(window) {
  return `${window.startMinute}-${window.endMinute}`;
}

export function describeWindow(window) {
  return `${formatClock(window.startMinute)}–${formatClock(window.endMinute)}`;
}

export function createWindow(startMinute, endMinute) {
  return {
    id: "custom",
    label: describeWindow({ startMinute, endMinute }),
    startMinute,
    endMinute
  };
}

export function formatMinutes(seconds, empty = "—") {
  if (!Number.isFinite(seconds)) return empty;
  return `${(seconds / 60).toFixed(1)} 分`;
}

export function formatSignedMinutes(seconds) {
  if (!Number.isFinite(seconds)) return "—";
  const value = seconds / 60;
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)} 分`;
}

export function formatPercent(value) {
  return `${value.toFixed(1)}%`;
}

export function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function dedupeRecords(records) {
  const groups = new Map();
  records.forEach((record) => {
    const group = groups.get(record.serviceKey) ?? [];
    group.push(record);
    groups.set(record.serviceKey, group);
  });

  const canonical = [];
  const duplicateRecords = [];
  groups.forEach((group) => {
    const sorted = [...group].sort((a, b) => {
      const receivedDiff = Date.parse(a.receivedAt) - Date.parse(b.receivedAt);
      return receivedDiff || a.id.localeCompare(b.id);
    });
    canonical.push(sorted[0]);
    duplicateRecords.push(...sorted.slice(1));
  });
  canonical.sort((a, b) => Date.parse(a.arrivedAt) - Date.parse(b.arrivedAt));
  return { canonical, groups, duplicateRecords, duplicateCount: duplicateRecords.length };
}

function missingSlotsBetween(dataset, lineId, firstIndex, secondIndex) {
  const canonicalKeys = new Set(dedupeRecords(dataset.records).canonical.map((item) => item.serviceKey));
  const missing = [];
  for (let index = firstIndex + 1; index < secondIndex; index += 1) {
    const key = `${lineId}-${String(index + 1).padStart(3, "0")}`;
    if (!canonicalKeys.has(key)) {
      const minute = dataset.schedule.startMinute + index * dataset.schedule.slotMinutes;
      missing.push({ index, minute });
    }
  }
  return missing;
}

export function buildIntervals(dataset) {
  const { canonical, groups } = dedupeRecords(dataset.records);
  const intervals = [];

  dataset.lines.forEach((line) => {
    const lineRecords = canonical
      .filter((record) => record.lineId === line.id)
      .sort((a, b) => Date.parse(a.arrivedAt) - Date.parse(b.arrivedAt));

    for (let index = 0; index < lineRecords.length - 1; index += 1) {
      const first = lineRecords[index];
      const second = lineRecords[index + 1];
      const firstAt = Date.parse(first.arrivedAt);
      const secondAt = Date.parse(second.arrivedAt);
      const headwaySeconds = (secondAt - firstAt) / 1000;
      const missingSlots = missingSlotsBetween(
        dataset,
        line.id,
        first.scheduleIndex,
        second.scheduleIndex
      );
      const endpointRecords = [
        ...(groups.get(first.serviceKey) ?? [first]),
        ...(groups.get(second.serviceKey) ?? [second])
      ];
      const duplicateCount = endpointRecords.filter((record) => record.duplicate).length;
      const isAnomaly =
        missingSlots.length === 0 &&
        (headwaySeconds < HEADWAY_MIN_SECONDS || headwaySeconds > HEADWAY_MAX_SECONDS);
      const status = missingSlots.length ? "missing" : duplicateCount ? "duplicate" : isAnomaly ? "anomaly" : "normal";

      intervals.push({
        key: `${line.id}|${first.serviceKey}|${second.serviceKey}`,
        lineId: line.id,
        line,
        first,
        second,
        startMinute: minuteFromIso(first.arrivedAt),
        endMinute: minuteFromIso(second.arrivedAt),
        midpoint: (minuteFromIso(first.arrivedAt) + minuteFromIso(second.arrivedAt)) / 2,
        headwaySeconds,
        missingSlots,
        duplicateCount,
        isAnomaly,
        status,
        valid: !missingSlots.length && !isAnomaly,
        records: endpointRecords.sort((a, b) => Date.parse(a.arrivedAt) - Date.parse(b.arrivedAt))
      });
    }
  });

  return intervals;
}

function expectedSlots(dataset, lineIds, window) {
  const selected = new Set(lineIds);
  const slots = [];
  dataset.lines.forEach((line) => {
    if (!selected.has(line.id)) return;
    for (let index = 0; index < dataset.schedule.slotCount; index += 1) {
      const minute = dataset.schedule.startMinute + index * dataset.schedule.slotMinutes;
      if (minute >= window.startMinute && minute < window.endMinute) {
        slots.push({
          key: `${line.id}-${String(index + 1).padStart(3, "0")}`,
          lineId: line.id,
          index,
          minute
        });
      }
    }
  });
  return slots;
}

export function buildQuality(dataset, selectedLineIds, window, intervals) {
  const expected = expectedSlots(dataset, selectedLineIds, window);
  const expectedKeys = new Set(expected.map((slot) => slot.key));
  const { canonical, duplicateRecords } = dedupeRecords(dataset.records);
  const canonicalInWindow = canonical.filter((record) => expectedKeys.has(record.serviceKey));
  const rawInWindow = dataset.records.filter((record) => expectedKeys.has(record.serviceKey));
  const duplicateInWindow = duplicateRecords.filter((record) => expectedKeys.has(record.serviceKey));
  const missing = expected.length - canonicalInWindow.length;
  const anomalyIntervals = intervals.filter((interval) => interval.isAnomaly);
  const validIntervals = intervals.filter((interval) => interval.valid);
  const missingIntervals = intervals.filter((interval) => interval.status === "missing");

  return {
    windowStart: window.startMinute,
    windowEnd: window.endMinute,
    expectedCount: expected.length,
    rawRecordCount: rawInWindow.length,
    canonicalCount: canonicalInWindow.length,
    duplicateCount: duplicateInWindow.length,
    missingCount: Math.max(0, missing),
    anomalyCount: anomalyIntervals.length,
    anomalyIntervals,
    missingIntervals,
    validIntervalCount: validIntervals.length,
    observedIntervalCount: intervals.length,
    completeness: expected.length ? (canonicalInWindow.length / expected.length) * 100 : 100
  };
}

export function buildViewModel(dataset, selectedLineIds, window) {
  const selected = new Set(selectedLineIds);
  const lines = dataset.lines.filter((line) => selected.has(line.id));
  const allIntervals = buildIntervals(dataset);
  const intervals = allIntervals
    .filter(
      (interval) =>
        selected.has(interval.lineId) &&
        interval.midpoint >= window.startMinute &&
        interval.midpoint < window.endMinute
    )
    .sort((a, b) => a.midpoint - b.midpoint || a.lineId.localeCompare(b.lineId));

  const lineMetrics = lines.map((line) => {
    const lineIntervals = intervals.filter((interval) => interval.lineId === line.id);
    const valid = lineIntervals.filter((interval) => interval.valid);
    return {
      line,
      intervals: lineIntervals,
      validIntervals: valid,
      averageSeconds: mean(valid.map((interval) => interval.headwaySeconds)),
      medianSeconds: median(valid.map((interval) => interval.headwaySeconds)),
      validCount: valid.length,
      missingCount: lineIntervals.reduce((sum, interval) => sum + interval.missingSlots.length, 0),
      duplicateCount: lineIntervals.reduce((sum, interval) => sum + interval.duplicateCount, 0),
      anomalyCount: lineIntervals.filter((interval) => interval.isAnomaly).length
    };
  });

  const validIntervals = intervals.filter((interval) => interval.valid);
  const quality = buildQuality(dataset, selectedLineIds, window, intervals);
  const summary = {
    observedCount: intervals.length,
    validCount: validIntervals.length,
    averageSeconds: mean(validIntervals.map((interval) => interval.headwaySeconds)),
    medianSeconds: median(validIntervals.map((interval) => interval.headwaySeconds)),
    missingIntervalCount: intervals.filter((interval) => interval.status === "missing").length,
    duplicateIntervalCount: intervals.filter((interval) => interval.duplicateCount > 0).length,
    anomalyCount: intervals.filter((interval) => interval.isAnomaly).length
  };

  return {
    dataset,
    selectedLineIds: [...selectedLineIds],
    window,
    windowLabel: describeWindow(window),
    lines,
    intervals,
    allIntervals,
    lineMetrics,
    quality,
    summary
  };
}

export function makeDisplaySnapshot(view) {
  return {
    dataVersion: view.dataset.version,
    filterLines: view.lines.map((line) => `${line.name} · ${line.station}`).join("、"),
    filterLineShort: view.lines.map((line) => line.name).join("、"),
    timeWindow: view.windowLabel,
    average: formatMinutes(view.summary.averageSeconds),
    median: formatMinutes(view.summary.medianSeconds),
    validCount: view.summary.validCount,
    observedCount: view.summary.observedCount,
    rawCount: view.quality.rawRecordCount,
    canonicalCount: view.quality.canonicalCount,
    expectedCount: view.quality.expectedCount,
    duplicateCount: view.quality.duplicateCount,
    missingCount: view.quality.missingCount,
    anomalyCount: view.quality.anomalyCount,
    completeness: formatPercent(view.quality.completeness),
    legend: view.lineMetrics.map((metric) => ({
      lineId: metric.line.id,
      name: metric.line.name,
      station: metric.line.station,
      color: metric.line.color,
      average: formatMinutes(metric.averageSeconds),
      validCount: metric.validCount
    }))
  };
}

export function makeExportSnapshot(view) {
  const display = makeDisplaySnapshot(view);
  return {
    ...display,
    title: "六线到站间隔时空图",
    methodology:
      "窗口按间隔中点归属；去重后计算相邻实际到站差。缺失段与异常段不计入平均值，重复记录保留首条。",
    thresholds: "异常阈值：间隔 < 6.0 分或 > 20.0 分"
  };
}

export function findInterval(view, key) {
  return view.intervals.find((interval) => interval.key === key) ?? null;
}
