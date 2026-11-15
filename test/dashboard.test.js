import test from "node:test";
import assert from "node:assert/strict";

import { DATASETS, STATION_BY_ID, WINDOW_BY_ID } from "../src/data.js";
import { buildCsvRows, createCsvExport } from "../src/export.js";
import { createDashboardModel } from "../src/model.js";
import { cleanRecords } from "../src/pipeline.js";
import { loadState, saveState, stateStorageKey } from "../src/state.js";

function modelFor(overrides = {}) {
  return createDashboardModel({
    windowId: "day",
    datasetId: "normal",
    originId: "beigang",
    destinationId: "huizhan",
    ...overrides
  });
}

test("normal sample cleans and aggregates without loss", () => {
  const normal = DATASETS.find((dataset) => dataset.id === "normal");
  const cleaned = cleanRecords(normal.rawRecords);

  assert.equal(cleaned.rawCount, 17);
  assert.deepEqual(cleaned.counts, {
    raw: 17,
    deduplicated: 0,
    missing: 0,
    anomaly: 0,
    valid: 17
  });
  assert.equal(cleaned.valid.length, 17);
});

test("missing sample is classified into missing and anomaly records", () => {
  const missing = DATASETS.find((dataset) => dataset.id === "missing");
  const cleaned = cleanRecords(missing.rawRecords);

  assert.equal(cleaned.rawCount, 17);
  assert.equal(cleaned.counts.missing, 4);
  assert.equal(cleaned.counts.anomaly, 1);
  assert.equal(cleaned.counts.deduplicated, 0);
  assert.equal(cleaned.counts.valid, 12);
  assert.match(cleaned.missing[0].reason, /缺失/);
  assert.match(cleaned.anomalies[0].reason, /时长非正数/);
});

test("duplicate sample removes repeated intervals and invalid rows", () => {
  const duplicate = DATASETS.find((dataset) => dataset.id === "duplicate");
  const cleaned = cleanRecords(duplicate.rawRecords);

  assert.equal(cleaned.rawCount, 24);
  assert.equal(cleaned.counts.deduplicated, 5);
  assert.equal(cleaned.counts.missing, 0);
  assert.equal(cleaned.counts.anomaly, 2);
  assert.equal(cleaned.counts.valid, 17);
  assert.equal(cleaned.duplicates.length, 5);
  assert.deepEqual(
    cleaned.anomalies.map((item) => item.reason).sort(),
    ["时长超限", "未知站点"]
  );
});

test("normal and duplicate samples produce the same effective network", () => {
  const normal = modelFor({ datasetId: "normal" });
  const duplicate = modelFor({ datasetId: "duplicate" });

  assert.equal(normal.network.aggregated.length, 17);
  assert.deepEqual(
    normal.network.aggregated.map((segment) => [
      segment.key,
      segment.minutes,
      segment.sourceCount
    ]),
    duplicate.network.aggregated.map((segment) => [
      segment.key,
      segment.minutes,
      segment.sourceCount
    ])
  );
});

test("off-peak routes expose the time versus transfer trade-off", () => {
  const model = modelFor();

  assert.equal(model.routes.shortest.totalMinutes, 20);
  assert.equal(model.routes.shortest.transfers, 2);
  assert.equal(model.routes.shortest.rideMinutes, 14);
  assert.equal(model.routes.shortest.transferMinutes, 6);
  assert.equal(model.routes.fewest.totalMinutes, 23);
  assert.equal(model.routes.fewest.transfers, 1);
  assert.equal(model.routes.samePath, false);
  assert.deepEqual(
    model.routes.shortest.legs.map((leg) => leg.lineId),
    ["L1", "L4", "L2"]
  );
  assert.deepEqual(
    model.routes.fewest.legs.map((leg) => leg.lineId),
    ["L1", "L2"]
  );
});

test("morning closures force a detour and never appear in a route", () => {
  const window = WINDOW_BY_ID.get("morning");
  const model = modelFor({ windowId: "morning" });

  assert.equal(model.statistics.suspendedSegments, 2);
  assert.equal(model.routes.shortest.totalMinutes, 23);
  assert.equal(model.routes.shortest.transfers, 1);
  assert.equal(model.routes.samePath, true);
  model.routes.shortest.edgeKeys.forEach((key) => {
    assert.equal(window.closures.includes(key), false);
  });
});

test("evening airport route is unreachable and disconnected nodes are marked", () => {
  const model = modelFor({ windowId: "evening", destinationId: "jichang" });

  assert.equal(model.routes.shortest, null);
  assert.equal(model.routes.fewest, null);
  assert.ok(model.routes.disconnected.includes("jichang"));
  assert.ok(model.routes.disconnected.includes("daxuecheng"));
  assert.equal(STATION_BY_ID.get("jichang").name, "机场");
});

test("missing sample removes an interval and exposes an unreachable station", () => {
  const model = modelFor({
    datasetId: "missing",
    destinationId: "jiangpan"
  });

  assert.equal(model.statistics.missingSegments, 5);
  assert.equal(model.routes.shortest, null);
  assert.ok(model.routes.disconnected.includes("jiangpan"));
});

test("CSV export carries exactly the values shown by the model", () => {
  const model = modelFor({ windowId: "evening", datasetId: "duplicate" });
  const rows = buildCsvRows(model);
  const lookup = (type, item) =>
    rows.find((row) => row[0] === type && row[1] === item)?.[2];

  assert.equal(lookup("质量", "去重"), 5);
  assert.equal(lookup("质量", "异常"), 2);
  assert.equal(lookup("质量", "有效记录"), 17);
  assert.equal(lookup("网络", "停运区间"), 2);
  assert.equal(lookup("方案", "最短时间-总分钟"), 20);
  assert.equal(lookup("方案", "最短时间-换乘次数"), 2);
  assert.equal(lookup("方案", "最少换乘-总分钟"), 23);
  assert.equal(lookup("方案", "最少换乘-换乘次数"), 1);
  assert.equal(rows.length, 16 + 14 + model.lineRows.length);
  assert.ok(rows.every((row) => row.length === 6));

  const exported = createCsvExport(model);
  assert.match(exported.filename, /evening_duplicate/);
  assert.ok(exported.content.startsWith("\uFEFF类型,项目,数值"));
  assert.match(exported.content, /最短时间-总分钟,20,分钟/);
  assert.match(exported.content, /NET-2026\.11\.16-C/);
});

test("window switching keeps origin, destination and dataset state", () => {
  const store = new Map();
  const storage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value)
  };
  const initial = {
    windowId: "morning",
    datasetId: "missing",
    originId: "xizhan",
    destinationId: "daxuecheng"
  };

  saveState(initial, storage);
  assert.ok(store.has(stateStorageKey()));
  const afterMorning = loadState(storage);
  saveState({ ...afterMorning, windowId: "evening" }, storage);
  saveState({ ...loadState(storage), windowId: "morning" }, storage);
  const restored = loadState(storage);

  assert.deepEqual(restored, initial);
  assert.equal(restored.datasetId, "missing");
  assert.equal(restored.originId, "xizhan");
  assert.equal(restored.destinationId, "daxuecheng");
});
