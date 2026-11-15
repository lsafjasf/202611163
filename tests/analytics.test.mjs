import test from "node:test";
import assert from "node:assert/strict";
import {
  RAW_DATASETS,
  THRESHOLDS,
  DATASET_META,
} from "../src/data.js";
import {
  aggregateRows,
  buildExportCsv,
  cleanDataset,
  filterRows,
  formatOne,
  formatTwo,
  simulateScenario,
} from "../src/analytics.js";

const cleaned = Object.fromEntries(
  Object.entries(RAW_DATASETS).map(([key, rows]) => [key, cleanDataset(rows)]),
);

test("三组原始样例产生可重算的质量计数", () => {
  assert.deepEqual(
    {
      raw: cleaned.normal.quality.rawRows,
      dedup: cleaned.normal.quality.duplicateRows,
      missing: cleaned.normal.quality.missingValues,
      anomaly: cleaned.normal.quality.anomalyValues,
      clean: cleaned.normal.quality.cleanedRows,
    },
    { raw: 48, dedup: 0, missing: 0, anomaly: 0, clean: 48 },
  );
  assert.deepEqual(
    {
      raw: cleaned.missing.quality.rawRows,
      dedup: cleaned.missing.quality.duplicateRows,
      missing: cleaned.missing.quality.missingValues,
      anomaly: cleaned.missing.quality.anomalyValues,
      clean: cleaned.missing.quality.cleanedRows,
    },
    { raw: 48, dedup: 0, missing: 5, anomaly: 2, clean: 48 },
  );
  assert.deepEqual(
    {
      raw: cleaned.duplicate.quality.rawRows,
      dedup: cleaned.duplicate.quality.duplicateRows,
      missing: cleaned.duplicate.quality.missingValues,
      anomaly: cleaned.duplicate.quality.anomalyValues,
      clean: cleaned.duplicate.quality.cleanedRows,
    },
    { raw: 53, dedup: 5, missing: 0, anomaly: 1, clean: 48 },
  );
});

test("清洗后记录唯一、字段完整且异常值已插补", () => {
  Object.values(cleaned).forEach(({ rows }) => {
    assert.equal(
      new Set(rows.map((row) => row.timestamp)).size,
      rows.length,
    );
    rows.forEach((row) => {
      ["inflow", "outflow", "level", "gate", "downstream"].forEach((field) => {
        assert.equal(Number.isFinite(row[field]), true, `${field} should be finite`);
      });
    });
  });
  const missing = cleaned.missing.rows;
  assert.notEqual(missing[15].level, 96.4);
  assert.notEqual(missing[27].inflow, -12.5);
  assert.ok(missing[15].level > 80 && missing[15].level < 90);
  assert.ok(missing[27].inflow >= 0);
});

test("时间窗口筛选返回准确条数并保持小时序列", () => {
  const rows = cleaned.normal.rows;
  assert.equal(filterRows(rows, "6h").length, 6);
  assert.equal(filterRows(rows, "12h").length, 12);
  assert.equal(filterRows(rows, "24h").length, 24);
  assert.equal(filterRows(rows, "all").length, 48);
  const six = filterRows(rows, "6h");
  assert.equal(six.at(-1).timestamp - six[0].timestamp, 5 * 3600000);
});

test("聚合结果由当前窗口记录实时重算", () => {
  const rows = filterRows(cleaned.normal.rows, "12h");
  const stats = aggregateRows(rows);
  const meanInflow =
    rows.reduce((total, row) => total + row.inflow, 0) / rows.length;
  const meanOutflow =
    rows.reduce((total, row) => total + row.outflow, 0) / rows.length;
  assert.ok(Math.abs(stats.meanInflow - meanInflow) < 1e-9);
  assert.ok(Math.abs(stats.meanOutflow - meanOutflow) < 1e-9);
  assert.equal(stats.maxLevel, Math.max(...rows.map((row) => row.level)));
  assert.equal(
    stats.maxDownstream,
    Math.max(...rows.map((row) => row.downstream)),
  );
  assert.notEqual(
    aggregateRows(filterRows(cleaned.normal.rows, "6h")).meanInflow,
    stats.meanInflow,
  );
});

test("闸门推演体现下游即时响应与水位延迟响应", () => {
  const rows = filterRows(cleaned.normal.rows, "24h");
  const baseline = simulateScenario(rows, rows.at(-1).gate);
  const closed = simulateScenario(rows, 0);
  const open = simulateScenario(rows, 100);
  assert.equal(closed.forecast[0].level, rows.at(-1).level);
  assert.ok(closed.forecast[3].level > closed.forecast[0].level);
  assert.ok(closed.forecast[2].level - closed.forecast[0].level < 0.05);
  assert.ok(closed.levelAlarm);
  assert.ok(!closed.downstreamAlarm);
  assert.ok(open.downstreamAlarm);
  assert.ok(open.forecast[0].downstream > closed.forecast[0].downstream);
  assert.equal(baseline.maxLevel, rows.at(-1).level);
  assert.ok(
    Math.abs(closed.maxLevel - THRESHOLDS.warningLevel) < 1,
    "closed scenario should be close enough to exercise warning",
  );
});

test("导出 CSV 的行数与屏幕视图记录一致且数值使用同一格式", () => {
  const viewRows = filterRows(cleaned.missing.rows, "12h");
  const scenario = simulateScenario(viewRows, 48.5);
  const csv = buildExportCsv({
    rows: viewRows,
    datasetMeta: DATASET_META.missing,
    windowLabel: "近 12 小时",
    scenario,
    quality: cleaned.missing.quality,
  });
  const lines = csv.split("\r\n");
  const headerIndex = lines.findIndex((line) => line.startsWith("时刻,"));
  assert.ok(headerIndex > 0);
  const dataLines = [];
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    if (!lines[index]) break;
    dataLines.push(lines[index]);
  }
  assert.equal(dataLines.length, viewRows.length);
  const firstColumns = dataLines[0].split(",");
  assert.equal(firstColumns[1], formatOne(viewRows[0].inflow));
  assert.equal(firstColumns[3], formatTwo(viewRows[0].level));
  assert.equal(firstColumns[5], formatOne(viewRows[0].gate));
  assert.ok(csv.includes(`推演水位峰值(m),${formatTwo(scenario.maxLevel)}`));
  assert.ok(
    csv.includes(
      `推演下游流量峰值(m³/s),${formatOne(scenario.maxDownstream)}`,
    ),
  );
  assert.ok(csv.includes(`数据版本,${DATASET_META.missing.version}`));
});
