import assert from "node:assert/strict";
import {
  STATIONS, SAMPLES_PER_STATION, BIN_COUNT,
  generateDataset, cleanDataset, aggregate, applyFilters,
  buildCsv, buildFullPipeline, fmt,
} from "../js/data.js";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log("正常 / 缺失 / 重复三组数据管线测试");

test("正常组：无缺失、无重复，每台站仅 3 个注入尖峰被判异常", () => {
  const { dataset, cleaned } = buildFullPipeline("normal");
  assert.equal(dataset.rows.length, SAMPLES_PER_STATION * 3);
  for (const s of STATIONS) {
    const q = cleaned.quality[s.id];
    assert.equal(q.rawRows, 1200);
    assert.equal(q.duplicatesRemoved, 0);
    assert.equal(q.missingSamples, 0);
    assert.equal(q.anomalySamples, dataset.manifest.spikes[s.id]);
    assert.equal(q.cleanRows, 1200);
  }
});

test("缺失组：缺失样例数、缺口事件数与注入清单一致", () => {
  const { dataset, cleaned } = buildFullPipeline("missing");
  for (const s of STATIONS) {
    const q = cleaned.quality[s.id];
    assert.equal(q.missingSamples, dataset.manifest.missingSamples[s.id] || 0);
    assert.equal(q.gapEvents, dataset.manifest.gapEvents[s.id] || 0);
    assert.equal(q.cleanRows, 1200 - q.missingSamples);
  }
  assert.equal(cleaned.qualityTotals.missingSamples, 64);
  assert.equal(cleaned.qualityTotals.gapEvents, 3);
});

test("重复组：去重数量与注入清单一致，清洗后恢复 1200 行/台", () => {
  const { dataset, cleaned } = buildFullPipeline("duplicate");
  for (const s of STATIONS) {
    const q = cleaned.quality[s.id];
    assert.equal(q.duplicatesRemoved, dataset.manifest.duplicateRows[s.id] || 0);
    assert.equal(q.cleanRows, 1200);
  }
  assert.equal(cleaned.qualityTotals.duplicatesRemoved, 35);
});

test("清洗结果可由原始样例重算：缺失网格位为 null，其余逐点可回放", () => {
  const { dataset, cleaned } = buildFullPipeline("missing");
  const staB = cleaned.samplesByStation.STA_B;
  assert.equal(staB.length, SAMPLES_PER_STATION);
  const nullCount = staB.filter((r) => r.isMissing && r.v === null).length;
  assert.equal(nullCount, 40);
  const present = staB.filter((r) => !r.isMissing);
  for (const row of present) {
    const hit = dataset.rows.find((r) => r.stationId === "STA_B" && r.t === row.t && r.v === row.v);
    assert.ok(hit, `样例 t=${row.t} 必须能在原始数据中找到`);
  }
});

test("聚合：每台站 30 个 1 秒分箱，统计值与样例直接重算一致", () => {
  const { cleaned, bins } = buildFullPipeline("normal");
  assert.equal(bins.length, BIN_COUNT * STATIONS.length);
  const bin = bins.find((b) => b.stationId === "STA_A" && b.binStart === 12);
  const samples = cleaned.samplesByStation.STA_A.slice(480, 520);
  const values = samples.map((s) => s.v);
  const expectMean = values.reduce((a, v) => a + v, 0) / 40;
  const expectRms = Math.sqrt(values.reduce((a, v) => a + v * v, 0) / 40);
  assert.ok(Math.abs(bin.mean - expectMean) < 1e-12);
  assert.ok(Math.abs(bin.rms - expectRms) < 1e-12);
  assert.equal(bin.min, Math.min(...values));
  assert.equal(bin.max, Math.max(...values));
  assert.equal(bin.anomalies, 1); // t=12s 尖峰落在该分箱
});

test("筛选联动：台站、质量、时间窗口同时生效", () => {
  const { bins } = buildFullPipeline("missing");
  const base = { stations: ["STA_B"], quality: "all", windowStart: 0, windowEnd: 30 };
  assert.equal(applyFilters(bins, base).length, 30);
  assert.equal(
    applyFilters(bins, { ...base, windowStart: 10, windowEnd: 20 }).length,
    10,
  );
  const missingOnly = applyFilters(bins, { ...base, quality: "missing" });
  assert.ok(missingOnly.every((b) => b.missing > 0));
  assert.equal(missingOnly.length, 2); // STA_B 缺口 7.5–8.5s，跨越两个 1 秒分箱
  const twoStations = applyFilters(bins, {
    ...base, stations: ["STA_A", "STA_C"], windowStart: 0, windowEnd: 10,
  });
  assert.equal(twoStations.length, 20);
});

test("导出 CSV 数值与聚合结果（屏幕同源）一致，且包含版本与口径头", () => {
  const { bins } = buildFullPipeline("duplicate");
  const filter = {
    stations: ["STA_A"], quality: "all", windowStart: 0, windowEnd: 30,
    matchCount: 30, version: "wave-v1.4.0+duplicate", datasetId: "duplicate",
  };
  const filtered = applyFilters(bins, filter);
  const totals = { duplicatesRemoved: 35, missingSamples: 0, anomalySamples: 9 };
  const csv = buildCsv(filtered, filter, totals);
  assert.ok(csv.includes("# 数据版本,wave-v1.4.0+duplicate"));
  assert.ok(csv.includes("统计口径"));
  const lines = csv.trim().split("\n").filter((l) => !l.startsWith("#"));
  assert.equal(lines.length - 1, 30); // 表头 + 30 行
  const firstData = lines[1].split(",");
  const firstBin = filtered[0];
  assert.equal(firstData[3], fmt(firstBin.mean));
  assert.equal(firstData[6], fmt(firstBin.rms));
  assert.equal(Number(firstData[7]), firstBin.missing);
});

test("同种子确定性：重复生成数据集得到完全相同的原始样例", () => {
  const a = generateDataset("normal").rows;
  const b = generateDataset("normal").rows;
  assert.equal(a.length, b.length);
  assert.ok(a.every((r, i) => r.t === b[i].t && r.v === b[i].v && r.stationId === b[i].stationId));
});

console.log(`\n全部 ${passed} 项测试通过`);
