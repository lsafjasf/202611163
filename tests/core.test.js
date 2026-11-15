import test from "node:test";
import assert from "node:assert/strict";
import { DATASETS, LINE_DEFS, formatClock, minuteFromIso } from "../js/data.js";
import {
  ALL_LINE_IDS,
  WINDOW_PRESETS,
  buildIntervals,
  buildViewModel,
  formatMinutes,
  makeDisplaySnapshot,
  makeExportSnapshot
} from "../js/core.js";

const fullWindow = WINDOW_PRESETS.find((item) => item.id === "all");
const peakWindow = WINDOW_PRESETS.find((item) => item.id === "peak");

function uniqueArrivals(dataset) {
  const byService = new Map();
  dataset.records
    .slice()
    .sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt))
    .forEach((record) => {
      if (!byService.has(record.serviceKey)) byService.set(record.serviceKey, record);
    });
  return [...byService.values()];
}

function independentWindowStats(dataset, lineIds, window) {
  const selected = new Set(lineIds);
  const canonical = uniqueArrivals(dataset);
  const canonicalKeys = new Set(canonical.map((record) => record.serviceKey));
  const expected = [];
  dataset.lines
    .filter((line) => selected.has(line.id))
    .forEach((line) => {
      for (let index = 0; index < dataset.schedule.slotCount; index += 1) {
        const minute = dataset.schedule.startMinute + index * dataset.schedule.slotMinutes;
        if (minute >= window.startMinute && minute < window.endMinute) {
          expected.push({
            lineId: line.id,
            index,
            key: `${line.id}-${String(index + 1).padStart(3, "0")}`
          });
        }
      }
    });

  const headways = [];
  dataset.lines
    .filter((line) => selected.has(line.id))
    .forEach((line) => {
      const arrivals = canonical
        .filter((record) => record.lineId === line.id)
        .sort((a, b) => Date.parse(a.arrivedAt) - Date.parse(b.arrivedAt));
      for (let index = 0; index < arrivals.length - 1; index += 1) {
        const first = arrivals[index];
        const second = arrivals[index + 1];
        const midpoint = (minuteFromIso(first.arrivedAt) + minuteFromIso(second.arrivedAt)) / 2;
        const seconds = (Date.parse(second.arrivedAt) - Date.parse(first.arrivedAt)) / 1000;
        const hasMissing = Array.from(
          { length: second.scheduleIndex - first.scheduleIndex - 1 },
          (_, offset) => first.scheduleIndex + offset + 1
        ).some((slot) => !canonicalKeys.has(`${line.id}-${String(slot + 1).padStart(3, "0")}`));
        const anomaly = !hasMissing && (seconds < 360 || seconds > 1200);
        if (
          midpoint >= window.startMinute &&
          midpoint < window.endMinute &&
          !hasMissing &&
          !anomaly
        ) {
          headways.push(seconds);
        }
      }
    });

  const expectedKeys = new Set(expected.map((slot) => slot.key));
  const canonicalInWindow = canonical.filter((record) => expectedKeys.has(record.serviceKey));
  const rawInWindow = dataset.records.filter((record) => expectedKeys.has(record.serviceKey));
  return {
    expectedCount: expected.length,
    missingCount: expected.length - canonicalInWindow.length,
    duplicateCount: rawInWindow.length - canonicalInWindow.length,
    validCount: headways.length,
    averageSeconds: headways.reduce((sum, value) => sum + value, 0) / headways.length
  };
}

test("normal, missing and duplicate fixtures expose the expected clean-up signals", () => {
  const normal = buildViewModel(DATASETS.normal, ALL_LINE_IDS, fullWindow);
  assert.equal(normal.quality.duplicateCount, 0);
  assert.equal(normal.quality.missingCount, 0);
  assert.equal(normal.quality.anomalyCount, 0);
  assert.equal(normal.quality.completeness, 100);

  const missing = buildViewModel(DATASETS.missing, ALL_LINE_IDS, fullWindow);
  assert.equal(missing.quality.duplicateCount, 0);
  assert.equal(missing.quality.missingCount, 4);
  assert.ok(missing.quality.missingIntervals.length >= 3);

  const duplicate = buildViewModel(DATASETS.duplicate, ALL_LINE_IDS, fullWindow);
  assert.equal(duplicate.quality.duplicateCount, 6);
  assert.equal(duplicate.quality.missingCount, 0);
  assert.equal(duplicate.quality.canonicalCount, 120);
  assert.ok(duplicate.intervals.some((interval) => interval.status === "duplicate"));
});

test("all window statistics can be independently recomputed from raw records", () => {
  const lineIds = ["L1", "L4", "L6"];
  const view = buildViewModel(DATASETS.combined, lineIds, peakWindow);
  const expected = independentWindowStats(DATASETS.combined, lineIds, peakWindow);

  assert.equal(view.quality.expectedCount, expected.expectedCount);
  assert.equal(view.quality.missingCount, expected.missingCount);
  assert.equal(view.quality.duplicateCount, expected.duplicateCount);
  assert.equal(view.summary.validCount, expected.validCount);
  assert.ok(Math.abs(view.summary.averageSeconds - expected.averageSeconds) < 1e-9);
  assert.equal(
    view.lineMetrics.reduce((sum, metric) => sum + metric.validCount, 0),
    expected.validCount
  );
});

test("line filtering updates legend and weighted average together", () => {
  const all = buildViewModel(DATASETS.combined, ALL_LINE_IDS, peakWindow);
  const subsetIds = ["L2", "L4", "L5"];
  const subset = buildViewModel(DATASETS.combined, subsetIds, peakWindow);
  const subsetHeadways = subset.intervals
    .filter((interval) => interval.valid)
    .map((interval) => interval.headwaySeconds);
  const expectedAverage =
    subsetHeadways.reduce((sum, value) => sum + value, 0) / subsetHeadways.length;
  const snapshot = makeDisplaySnapshot(subset);

  assert.equal(snapshot.legend.length, 3);
  assert.deepEqual(
    snapshot.legend.map((item) => item.lineId),
    subsetIds
  );
  assert.equal(snapshot.validCount, subsetHeadways.length);
  assert.equal(snapshot.average, formatMinutes(expectedAverage));
  assert.notEqual(snapshot.average, makeDisplaySnapshot(all).average);
  assert.equal(
    subset.lineMetrics.reduce((sum, metric) => sum + metric.validCount, 0),
    subset.summary.validCount
  );
});

test("missing intervals stay visible but are excluded from averages", () => {
  const view = buildViewModel(DATASETS.missing, ALL_LINE_IDS, fullWindow);
  const missingIntervals = view.intervals.filter((interval) => interval.status === "missing");
  assert.ok(missingIntervals.length > 0);
  missingIntervals.forEach((interval) => {
    assert.equal(interval.valid, false);
    assert.ok(interval.missingSlots.length > 0);
  });
  assert.equal(
    view.quality.validIntervalCount,
    view.intervals.filter((interval) => interval.valid).length
  );

  const missingTimes = missingIntervals.flatMap((interval) =>
    interval.missingSlots.map((slot) => formatClock(slot.minute))
  );
  assert.ok(missingTimes.includes("07:06"));
});

test("deduplication does not alter the deduplicated headway sequence", () => {
  const normal = buildIntervals(DATASETS.normal).filter((interval) => interval.valid);
  const duplicate = buildIntervals(DATASETS.duplicate).filter((interval) => interval.valid);
  const normalSeries = normal.map(
    (interval) => `${interval.lineId}:${interval.first.serviceKey}:${interval.headwaySeconds}`
  );
  const duplicateSeries = duplicate.map(
    (interval) => `${interval.lineId}:${interval.first.serviceKey}:${interval.headwaySeconds}`
  );
  assert.deepEqual(duplicateSeries, normalSeries);
});

test("export snapshot carries exactly the same display values as the screen snapshot", () => {
  const view = buildViewModel(DATASETS.combined, ["L3", "L6"], peakWindow);
  const screen = makeDisplaySnapshot(view);
  const exported = makeExportSnapshot(view);
  Object.keys(screen).forEach((key) => {
    assert.deepEqual(exported[key], screen[key], `snapshot field ${key} should match`);
  });
  assert.equal(exported.filterLines, "3号线 · 中山公园、6号线 · 虹桥路");
  assert.equal(exported.timeWindow, "07:30–09:00");
  assert.equal(exported.legend.length, 2);
});

test("combined sample quality counts are internally consistent", () => {
  const view = buildViewModel(DATASETS.combined, ALL_LINE_IDS, fullWindow);
  const quality = view.quality;
  assert.equal(quality.rawRecordCount, quality.canonicalCount + quality.duplicateCount);
  assert.equal(quality.canonicalCount + quality.missingCount, quality.expectedCount);
  assert.equal(quality.duplicateCount, 3);
  assert.equal(quality.missingCount, 4);
  assert.equal(quality.anomalyCount, 1);
  assert.ok(quality.completeness > 96 && quality.completeness < 97);
  assert.equal(
    view.lineMetrics.reduce((sum, metric) => sum + metric.intervals.length, 0),
    view.summary.observedCount
  );
  assert.equal(
    buildViewModel(DATASETS.combined, ALL_LINE_IDS, fullWindow)
      .intervals.filter((interval) => interval.valid)
      .map((interval) => interval.key)
      .length,
    view.summary.validCount
  );
});
