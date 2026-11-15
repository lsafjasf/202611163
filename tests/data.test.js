const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../data.js");

function clean(key) {
  return C.cleanDataset(C.DATASETS[key]);
}

function model(key, options, capacities, step) {
  return C.buildModel(clean(key), Object.assign({ windowKey: "14d", region: "全部" }, options), capacities, step === undefined ? 10 : step);
}

test("三组样例的清洗分类闭合且计数稳定", () => {
  const expected = {
    normal: { raw: 24, valid: 24, duplicates: 0, missing: 0, anomalies: 0 },
    missing: { raw: 26, valid: 14, duplicates: 2, missing: 5, anomalies: 5 },
    duplicate: { raw: 36, valid: 22, duplicates: 12, missing: 1, anomalies: 1 }
  };
  Object.keys(expected).forEach((key) => {
    const result = clean(key);
    const counts = {
      raw: result.rawCount,
      valid: result.validCount,
      duplicates: result.duplicates,
      missing: result.missing,
      anomalies: result.anomalies
    };
    assert.deepEqual(counts, expected[key]);
    assert.equal(result.rawCount, result.validCount + result.duplicates + result.missing + result.anomalies);
  });
});

test("去重后有效单据没有完全重复的业务键", () => {
  ["normal", "missing", "duplicate"].forEach((key) => {
    const result = clean(key);
    const signatures = result.cleanRows.map((row) => [row.date, row.factory, row.warehouse, row.store, row.qty].join("|"));
    assert.equal(new Set(signatures).size, signatures.length);
  });
});

test("工厂可供与门店需求可由筛选后的原始数量逐行重算", () => {
  ["normal", "missing", "duplicate"].forEach((key) => {
    const result = clean(key);
    const scoped = C.scopeRows(result, "14d", "全部", C.ANCHOR_DATE);
    const modelResult = C.buildModel(result, { windowKey: "14d", region: "全部", anchorDate: C.ANCHOR_DATE }, null, 10);
    const factorySums = { F1: 0, F2: 0, F3: 0 };
    const storeSums = { S1: 0, S2: 0, S3: 0, S4: 0 };
    scoped.rows.forEach((row) => {
      factorySums[row.factory] += row.qty;
      storeSums[row.store] += row.qty;
    });
    assert.equal(modelResult.totals.supply, scoped.rows.reduce((sum, row) => sum + row.qty, 0));
    assert.equal(modelResult.totals.demand, scoped.rows.reduce((sum, row) => sum + row.qty, 0));
    modelResult.activeNodes.filter((node) => node.type === "factory").forEach((node) => {
      assert.equal(node.supply, factorySums[node.id]);
    });
    modelResult.activeNodes.filter((node) => node.type === "store").forEach((node) => {
      assert.equal(node.demand, storeSums[node.id]);
    });
  });
});

test("计划负载按原始路径聚合，且不与实际最大流混淆", () => {
  const result = clean("normal");
  const scoped = C.scopeRows(result, "14d", "全部", C.ANCHOR_DATE);
  const modelResult = C.buildModel(result, { windowKey: "14d", region: "全部", anchorDate: C.ANCHOR_DATE }, null, 10);
  const expected = {};
  scoped.rows.forEach((row) => {
    const first = "R-" + row.factory + "-" + row.warehouse;
    const second = "R-" + row.warehouse + "-" + row.store;
    expected[first] = (expected[first] || 0) + row.qty;
    expected[second] = (expected[second] || 0) + row.qty;
  });
  modelResult.activeRoutes.forEach((route) => {
    assert.equal(route.planned, expected[route.id] || 0);
    assert.ok(route.flow <= route.capacity);
  });
  assert.ok(modelResult.activeRoutes.some((route) => route.overloaded));
});

test("容量约束最大流满足节点与总量守恒", () => {
  ["normal", "missing", "duplicate"].forEach((key) => {
    ["7d", "14d", "30d"].forEach((windowKey) => {
      ["全部", "华东", "华南"].forEach((region) => {
        const result = model(key, { windowKey, region });
        assert.equal(result.conservation.valid, true);
        assert.equal(result.totals.supply, result.totals.delivered + result.totals.unused);
        assert.equal(result.totals.demand, result.totals.delivered + result.totals.gap);
        result.activeNodes.filter((node) => node.type === "warehouse").forEach((node) => {
          assert.equal(node.inbound, node.outbound);
        });
        result.activeRoutes.forEach((route) => assert.ok(route.flow <= route.capacity));
      });
    });
  });
});

test("容量调整实时改变缺口，归零后所有需求成为缺口", () => {
  const result = clean("normal");
  const zero = Object.fromEntries(C.ROUTE_LIST.map((route) => [route.id, 0]));
  const blocked = C.buildModel(result, { windowKey: "14d", region: "华东", anchorDate: C.ANCHOR_DATE }, zero, 10);
  assert.equal(blocked.totals.delivered, 0);
  assert.equal(blocked.totals.gap, blocked.totals.demand);
  assert.equal(blocked.conservation.valid, true);

  const wide = Object.fromEntries(C.ROUTE_LIST.map((route) => [route.id, 200]));
  const open = C.buildModel(result, { windowKey: "14d", region: "华东", anchorDate: C.ANCHOR_DATE }, wide, 10);
  assert.equal(open.totals.gap, 0);
  assert.equal(open.totals.delivered, open.totals.demand);
  assert.ok(open.totals.overloadedRoutes === 0);
});

test("切换时间窗口再返回时，容量参数与模型指纹保持不变", () => {
  const result = clean("normal");
  const capacities = Object.fromEntries(C.ROUTE_LIST.map((route) => [route.id, route.baseCapacity + 5]));
  const first = C.buildModel(result, { windowKey: "7d", region: "华东", anchorDate: C.ANCHOR_DATE }, capacities, 10);
  C.buildModel(result, { windowKey: "30d", region: "华东", anchorDate: C.ANCHOR_DATE }, capacities, 10);
  const returned = C.buildModel(result, { windowKey: "7d", region: "华东", anchorDate: C.ANCHOR_DATE }, capacities, 10);
  assert.equal(returned.fingerprint, first.fingerprint);
  assert.deepEqual(returned.totals, first.totals);
  returned.activeRoutes.forEach((route) => assert.equal(route.capacity, route.baseCapacity + 5));
});

test("导出快照的 KPI、节点与线路数值和屏幕模型一致", () => {
  ["normal", "missing", "duplicate"].forEach((key) => {
    ["7d", "14d", "30d"].forEach((windowKey) => {
      ["全部", "华东", "华南"].forEach((region) => {
        const result = model(key, { windowKey, region });
        const payload = C.buildExportPayload(result, "2026-11-16T10:00:00.000Z");
        const check = C.validateExportPayload(payload, result);
        assert.equal(check.valid, true);
        assert.deepEqual(payload.totals, result.totals);
        assert.equal(payload.dataVersion, result.version);
        assert.equal(payload.filter.region, region);
        assert.equal(payload.step, 10);
      });
    });
  });
});
