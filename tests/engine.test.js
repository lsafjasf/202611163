import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  cleanDataset,
  computeView,
  createDefaultCalibration,
  recomputeStatsFromRows,
  updateAnchor,
} from "../src/engine.js";
import { formatClock, formatSigned, formatValue, SENSORS } from "../src/config.js";
import { buildCalibrationCsv, windowLabel } from "../src/export.js";
import {
  applyWindowPreset,
  createWorkspace,
  restoreWorkspace,
  setActiveDataset,
  setCustomWindow,
} from "../src/state.js";

const root = path.resolve(import.meta.dirname, "..");
const ids = ["normal", "missing", "duplicate"];

async function loadDatasets() {
  return Promise.all(ids.map(async (id) => (
    JSON.parse(await readFile(path.join(root, "data", `${id}.json`), "utf8"))
  )));
}

function viewFor(dataset, overrides = {}) {
  const clean = cleanDataset(dataset);
  const calibration = createDefaultCalibration(clean);
  const view = computeView(dataset, clean, {
    startSlot: 0,
    endSlot: dataset.expectedSlots - 1,
    sensorIds: ["S1", "S2", "S3"],
    excludeAnomalies: true,
    calibration,
    activeSensor: "S1",
    ...overrides,
  });
  return { clean, calibration, view };
}

test("三组原始样例的数据质量摘要由原始记录重算", async () => {
  const [normal, missing, duplicate] = await loadDatasets();
  const normalClean = cleanDataset(normal);
  const missingClean = cleanDataset(missing);
  const duplicateClean = cleanDataset(duplicate);

  assert.deepEqual(normalClean.quality, {
    rawRows: 123,
    uniqueSensorSlots: 123,
    expectedSensorSlots: 123,
    duplicateRemoved: 0,
    missing: 0,
    anomalyCount: 0,
  });
  assert.equal(missingClean.quality.duplicateRemoved, 0);
  assert.equal(missingClean.quality.missing, 9);
  assert.equal(missingClean.quality.anomalyCount, 3);
  assert.equal(duplicateClean.quality.duplicateRemoved, 12);
  assert.equal(duplicateClean.quality.missing, 3);
  assert.equal(duplicateClean.quality.anomalyCount, 2);
  assert.equal(duplicateClean.quality.rawRows, 132);
});

test("重复读数按传感器时槽取中位数", async () => {
  const duplicate = (await loadDatasets())[2];
  const sourceRows = duplicate.readings.filter((row) => row.sensor === "S1" && row.t === 60);
  assert.equal(sourceRows.length, 2);
  const expectedMedian = sourceRows.reduce((sum, row) => sum + row.value, 0) / sourceRows.length;
  const clean = cleanDataset(duplicate);
  const group = clean.groups.S1.find((entry) => entry.slot === 2);

  assert.equal(group.sampleCount, 2);
  assert.equal(group.duplicateRemoved, 1);
  assert.ok(Math.abs(group.raw - expectedMedian) < 1e-12);
});

test("缺失时槽不插值，关闭异常剔除后异常记录重新进入视图", async () => {
  const missing = (await loadDatasets())[1];
  const excluded = viewFor(missing).view;
  const included = viewFor(missing, { excludeAnomalies: false }).view;

  assert.equal(excluded.rows.length, 111);
  assert.equal(included.rows.length, 114);
  assert.equal(excluded.rows.filter((row) => row.anomaly).length, 0);
  assert.equal(included.rows.filter((row) => row.anomaly).length, 3);
  assert.equal(excluded.quality.missingInWindow, 9);
  assert.equal(excluded.quality.presentSensorSlots, 114);
});

test("统计值可由同一视图的明细行完整重算", async () => {
  const datasets = await loadDatasets();
  for (const dataset of datasets) {
    const { view } = viewFor(dataset);
    const recomputed = recomputeStatsFromRows(view.rows);
    assert.equal(view.stats.n, view.rows.length);
    assert.equal(recomputed.n, view.stats.n);
    for (const field of ["rawMae", "rawMax", "calibratedMae", "calibratedMax"]) {
      assert.ok(Math.abs(recomputed[field] - view.stats[field]) < 1e-12, field);
    }
  }
});

test("时间窗口筛选同时约束明细和统计", async () => {
  const dataset = (await loadDatasets())[2];
  const { view } = viewFor(dataset, { startSlot: 9, endSlot: 21 });
  const recomputed = recomputeStatsFromRows(view.rows);

  assert.ok(view.rows.length > 0);
  assert.ok(view.rows.every((row) => row.slot >= 9 && row.slot <= 21));
  assert.equal(view.startSlot, 9);
  assert.equal(view.endSlot, 21);
  assert.equal(view.stats.n, recomputed.n);
  assert.equal(view.stats.calibratedMae, recomputed.calibratedMae);
  assert.equal(view.stats.calibratedMax, recomputed.calibratedMax);
});

test("拖动校准点只改变派生值，不改变原始数据或数据结构", async () => {
  const dataset = (await loadDatasets())[0];
  const snapshot = JSON.stringify(dataset);
  const clean = cleanDataset(dataset);
  const calibration = createDefaultCalibration(clean);
  const base = computeView(dataset, clean, {
    startSlot: 0,
    endSlot: 40,
    sensorIds: ["S1", "S2", "S3"],
    excludeAnomalies: true,
    calibration,
    activeSensor: "S1",
  });
  const changedCalibration = updateAnchor(
    calibration,
    "S1",
    calibration.S1[1].id,
    { slot: 18, targetError: 1.25 },
    40,
  );
  const changed = computeView(dataset, clean, {
    startSlot: 0,
    endSlot: 40,
    sensorIds: ["S1", "S2", "S3"],
    excludeAnomalies: true,
    calibration: changedCalibration,
    activeSensor: "S1",
  });

  assert.equal(JSON.stringify(dataset), snapshot);
  assert.equal(changed.rows.length, base.rows.length);
  assert.deepEqual(changed.rows.map((row) => row.raw), base.rows.map((row) => row.raw));
  assert.notEqual(changed.stats.calibratedMae, base.stats.calibratedMae);
  assert.equal(changedCalibration.S1.find((anchor) => anchor.id === "S1-anchor-2").targetError, 1.25);
});

test("CSV 首条明细与屏幕表格使用相同格式和同一视图数值", async () => {
  const dataset = (await loadDatasets())[1];
  const { view } = viewFor(dataset, { startSlot: 7, endSlot: 40 });
  const csv = buildCalibrationCsv(view).replace(/^\uFEFF/, "");
  const lines = csv.split("\r\n");
  const headerIndex = lines.findIndex((line) => line.startsWith("时间,传感器,"));
  const firstRow = lines[headerIndex + 1].split(",");
  const row = view.rows[0];
  const label = SENSORS.find((sensor) => sensor.id === row.sensor).label;

  assert.ok(lines.includes(`数据版本,${view.version}`));
  assert.ok(lines.includes(`时间窗口,${windowLabel(view)}`));
  assert.deepEqual(firstRow, [
    formatClock(row.t),
    label,
    formatValue(row.reference),
    formatValue(row.raw),
    formatValue(row.calibrated),
    formatSigned(row.rawError),
    formatSigned(row.calibratedError),
    String(row.sampleCount),
    row.anomaly ? "是" : "否",
    "是",
  ]);
  assert.ok(lines.includes(`平均绝对误差 MAE (°C),${formatValue(view.stats.rawMae, 3)},${formatValue(view.stats.calibratedMae, 3)}`));
  assert.ok(lines.includes(`最大偏差 (°C),${formatValue(view.stats.rawMax, 3)},${formatValue(view.stats.calibratedMax, 3)}`));
});

test("切换预设、数据集并序列化恢复时，自定义窗口与校准状态不丢失", async () => {
  const datasets = await loadDatasets();
  const workspace = createWorkspace(datasets);
  const normal = datasets[0];
  const missing = datasets[1];

  setCustomWindow(workspace, normal, 7, 24);
  workspace.perDataset.normal.calibration = { S1: [{ id: "S1-anchor-1", slot: 8, targetError: 0.4 }] };
  applyWindowPreset(workspace, normal, "full");
  assert.equal(workspace.perDataset.normal.window.start, 0);
  assert.equal(workspace.perDataset.normal.window.end, 40);
  applyWindowPreset(workspace, normal, "custom");
  assert.deepEqual(
    [workspace.perDataset.normal.window.start, workspace.perDataset.normal.window.end],
    [7, 24],
  );

  setActiveDataset(workspace, missing);
  setCustomWindow(workspace, missing, 10, 30);
  setActiveDataset(workspace, normal);
  assert.deepEqual(
    [workspace.perDataset.normal.window.start, workspace.perDataset.normal.window.end],
    [7, 24],
  );

  const restored = restoreWorkspace(JSON.parse(JSON.stringify(workspace)), datasets);
  assert.equal(restored.activeDatasetId, "normal");
  assert.deepEqual(
    [restored.perDataset.normal.window.start, restored.perDataset.normal.window.end],
    [7, 24],
  );
  assert.equal(restored.perDataset.normal.calibration.S1[0].targetError, 0.4);
});
