var assert = require('assert');
var C = require('../src/tide-core.js');

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

test('生成器：正常组为完整的 8 站点 × 168 小时网格且数值确定', function () {
  var ds = C.buildDatasets();
  assert.strictEqual(ds.normal.raw.length, C.STATIONS.length * C.HOURS);
  assert.strictEqual(C.tideValue(C.STATIONS[0], 0), C.tideValue(C.STATIONS[0], 0));
  var ds2 = C.buildDatasets();
  assert.deepStrictEqual(ds.normal.raw, ds2.normal.raw);
  assert.deepStrictEqual(ds.duplicate.raw, ds2.duplicate.raw);
});

test('清洗：正常组零重复、零缺失、零异常', function () {
  var q = C.clean(C.buildDatasets().normal.raw).quality;
  assert.deepStrictEqual(
    { raw: q.rawRecords, dup: q.duplicateRecords, anom: q.anomalyRecords, miss: q.missingSlots },
    { raw: 1344, dup: 0, anom: 0, miss: 0 }
  );
});

test('清洗：缺失组只产生缺失槽位，无重复与异常', function () {
  var q = C.clean(C.buildDatasets().missing.raw).quality;
  assert.strictEqual(q.duplicateRecords, 0);
  assert.strictEqual(q.anomalyRecords, 0);
  assert.ok(q.missingSlots > 50 && q.missingSlots < 180);
  assert.strictEqual(q.validSlots + q.missingSlots, q.expectedSlots);
});

test('清洗：重复组的重复、异常、缺失均被独立重算确认', function () {
  var raw = C.buildDatasets().duplicate.raw;
  var seen = new Map();
  var expectAnom = 0;
  var expectDup = 0;
  raw.forEach(function (r) {
    if (C.isAnomaly(r.value)) expectAnom++;
    var k = r.stationId + '@' + r.t;
    seen.set(k, (seen.get(k) || 0) + 1);
  });
  seen.forEach(function (n) { expectDup += n - 1; });
  var q = C.clean(raw).quality;
  assert.strictEqual(q.anomalyRecords, expectAnom);
  assert.strictEqual(q.duplicateRecords, expectDup);
  assert.ok(q.anomalyRecords > 0 && q.duplicateRecords > 0 && q.missingSlots > 0);
  assert.strictEqual(q.validSlots + q.missingSlots, q.expectedSlots);
});

test('去重值等于同槽位有效记录的算术平均（由原始样例重算）', function () {
  var raw = C.buildDatasets().duplicate.raw;
  var target = raw.reduce(function (acc, r) {
    if (!C.isAnomaly(r.value)) {
      var k = r.stationId + '@' + r.t;
      if (!acc[k]) acc[k] = [];
      acc[k].push(r.value);
    }
    return acc;
  }, {});
  var dupKey = Object.keys(target).filter(function (k) { return target[k].length > 1; })[0];
  var parts = dupKey.split('@');
  var cleaned = C.clean(raw).slots.get(parts[0] + '@' + Number(parts[1]));
  var sum = target[dupKey].reduce(function (a, b) { return a + b; }, 0);
  var expected = C.round3(sum / target[dupKey].length);
  assert.strictEqual(cleaned.value, expected);
});

test('异常槽位在无有效记录时判为缺失且值为 null', function () {
  var raw = C.buildDatasets().duplicate.raw;
  var result = C.clean(raw);
  var onlyAnomaly = raw.filter(function (r) {
    var k = r.stationId + '@' + r.t;
    var same = raw.filter(function (x) { return (x.stationId + '@' + x.t) === k; });
    return C.isAnomaly(r.value) && same.every(function (x) { return C.isAnomaly(x.value); });
  })[0];
  var slot = result.slots.get(onlyAnomaly.stationId + '@' + onlyAnomaly.t);
  assert.strictEqual(slot.value, null);
  assert.strictEqual(slot.anomalyCount, 1);
});

test('聚合：均值/极值/完整率可由窗口内清洗值重算', function () {
  var ds = C.buildDatasets().duplicate;
  var result = C.clean(ds.raw);
  var agg = C.aggregate(result, { startHour: 48, endHour: 71, stationFilter: ['S03'] });
  var row = agg.matrix[0];
  var vals = row.values.filter(function (v) { return v !== null; });
  var mean = C.round3(vals.reduce(function (a, b) { return a + b; }, 0) / vals.length);
  var st = agg.stationStats[0];
  assert.strictEqual(st.mean, mean);
  assert.strictEqual(st.max, Math.max.apply(null, vals));
  assert.strictEqual(st.min, Math.min.apply(null, vals));
  assert.strictEqual(st.count, vals.length);
  assert.strictEqual(st.missing, row.values.length - vals.length);
  assert.strictEqual(st.completeness, Math.round((vals.length / row.values.length) * 1000) / 10);
});

test('窗口切换：不同窗口质量合计与全量口径一致', function () {
  var result = C.clean(C.buildDatasets().duplicate.raw);
  var a = C.aggregate(result, { startHour: 0, endHour: 83, stationFilter: C.STATIONS.map(function (s) { return s.id; }) });
  var b = C.aggregate(result, { startHour: 84, endHour: C.HOURS - 1, stationFilter: C.STATIONS.map(function (s) { return s.id; }) });
  ['expectedSlots', 'validSlots', 'missingSlots', 'duplicateRecords', 'anomalyRecords'].forEach(function (k) {
    assert.strictEqual(a.windowQuality[k] + b.windowQuality[k], result.quality[k], k);
  });
});

test('站点筛选：矩阵与统计仅包含被选站点', function () {
  var result = C.clean(C.buildDatasets().normal.raw);
  var agg = C.aggregate(result, { startHour: 0, endHour: 23, stationFilter: ['S01', 'S04'] });
  assert.deepStrictEqual(agg.matrix.map(function (r) { return r.stationId; }), ['S01', 'S04']);
  assert.strictEqual(agg.matrix[0].values.length, 24);
});

test('数值格式：屏幕与导出共用同一格式化函数', function () {
  assert.strictEqual(C.formatValue(1.239), '1.24');
  assert.strictEqual(C.formatValue(null), '—');
  assert.strictEqual(C.formatHour(0), '2026-11-09 00:00');
  assert.strictEqual(C.formatHour(C.HOURS - 1), '2026-11-15 23:00');
});

var failed = 0;
tests.forEach(function (t) {
  try {
    t.fn();
    console.log('  ✓ ' + t.name);
  } catch (e) {
    failed++;
    console.error('  ✗ ' + t.name + '\n    ' + e.message);
  }
});
console.log('\n' + (tests.length - failed) + '/' + tests.length + ' 通过');
process.exit(failed ? 1 : 0);
