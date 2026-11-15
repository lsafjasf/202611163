// 验证：清洗（去重/缺失/异常）、聚合、CSV 导出与视图一致性、状态恢复。
// 运行：node test/pipeline.test.js
'use strict';
const assert = require('assert');
const DATA = require('../js/data.js');
const PIPE = require('../js/pipeline.js');

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('  PASS ' + name);
}

const ALL = { hourStart: 0, hourEnd: 23, from: 'ALL', to: 'ALL' };
const ds = {};
DATA.DATASETS.forEach(d => { ds[d.key] = d; });

console.log('1. 清洗与数据质量摘要');
check('正常数据：无剔除', () => {
  const q = PIPE.clean(ds.normal.records).quality;
  assert.deepStrictEqual(q, { raw: 24, duplicated: 0, missing: 0, anomaly: 0, valid: 24 });
});
check('缺失数据：4 条缺失被剔除', () => {
  const q = PIPE.clean(ds.missing.records).quality;
  assert.strictEqual(q.missing, 4);
  assert.strictEqual(q.valid, q.raw - 4);
});
check('重复数据：3 条重复 + 2 条异常被剔除', () => {
  const q = PIPE.clean(ds.dup.records).quality;
  assert.strictEqual(q.duplicated, 3);
  assert.strictEqual(q.anomaly, 2); // -50 与 99999
  assert.strictEqual(q.valid, 15);
});
check('质量摘要守恒：raw = valid + duplicated + missing + anomaly', () => {
  DATA.DATASETS.forEach(d => {
    const q = PIPE.clean(d.records).quality;
    assert.strictEqual(q.raw, q.valid + q.duplicated + q.missing + q.anomaly);
  });
});

console.log('2. 聚合与筛选');
check('正常数据 8 点 A->B 聚合为 960', () => {
  const v = PIPE.computeView(ds.normal, { hourStart: 8, hourEnd: 8, from: 'A', to: 'B' });
  assert.strictEqual(v.flows.length, 1);
  assert.strictEqual(v.flows[0].count, 960);
});
check('超容量标记：8 点 A->B(960) 超过容量 900', () => {
  const v = PIPE.computeView(ds.normal, { hourStart: 8, hourEnd: 8, from: 'ALL', to: 'ALL' });
  const ab = v.flows.find(f => f.from === 'A' && f.to === 'B');
  assert.strictEqual(ab.overCapacity, true);
});
check('超容量标记：8 点 D->A(540) 超过容量 500', () => {
  const v = PIPE.computeView(ds.normal, { hourStart: 8, hourEnd: 8, from: 'ALL', to: 'ALL' });
  const da = v.flows.find(f => f.from === 'D' && f.to === 'A');
  assert.strictEqual(da.overCapacity, true);
});
check('未超容量通道标记为正常', () => {
  const v = PIPE.computeView(ds.normal, { hourStart: 8, hourEnd: 8, from: 'ALL', to: 'ALL' });
  const ba = v.flows.find(f => f.from === 'B' && f.to === 'A');
  assert.strictEqual(ba.overCapacity, false); // 240 < 900
});
check('来源/目的地筛选生效', () => {
  const v = PIPE.computeView(ds.normal, { hourStart: 0, hourEnd: 23, from: 'B', to: 'ALL' });
  assert.ok(v.flows.every(f => f.from === 'B'));
  const v2 = PIPE.computeView(ds.normal, { hourStart: 0, hourEnd: 23, from: 'ALL', to: 'E' });
  assert.ok(v2.flows.every(f => f.to === 'E'));
});
check('时间窗口过滤生效', () => {
  const v = PIPE.computeView(ds.normal, { hourStart: 7, hourEnd: 7, from: 'ALL', to: 'ALL' });
  assert.strictEqual(v.matchedRecords, 6);
});
check('节点流入流出与流量明细一致', () => {
  const v = PIPE.computeView(ds.normal, ALL);
  const inSum = Object.values(v.nodes).reduce((s, n) => s + n.inflow, 0);
  const outSum = Object.values(v.nodes).reduce((s, n) => s + n.outflow, 0);
  assert.strictEqual(inSum, v.totalPeople);
  assert.strictEqual(outSum, v.totalPeople);
});

console.log('3. 导出与屏幕数值一致');
check('CSV 中每行人次与视图模型一致，合计一致', () => {
  DATA.DATASETS.forEach(d => {
    const states = [ALL, { hourStart: 8, hourEnd: 9, from: 'ALL', to: 'ALL' },
      { hourStart: 0, hourEnd: 23, from: 'B', to: 'A' }];
    states.forEach(st => {
      const v = PIPE.computeView(d, st);
      const csv = PIPE.toCSV(v, st, d);
      v.flows.forEach(f => {
        const line = csv.split('\r\n').find(l =>
          l.startsWith(PIPE.blockName(f.from) + ',' + PIPE.blockName(f.to) + ','));
        assert.ok(line, '缺少行 ' + f.from + '>' + f.to);
        assert.strictEqual(Number(line.split(',')[2]), f.count);
      });
      const totalLine = csv.split('\r\n').find(l => l.startsWith('合计'));
      assert.strictEqual(Number(totalLine.split(',')[2]), v.totalPeople);
    });
  });
});
check('CSV 元信息含数据版本与筛选条件', () => {
  const v = PIPE.computeView(ds.normal, ALL);
  const csv = PIPE.toCSV(v, ALL, ds.normal);
  assert.ok(csv.includes(DATA.DATA_VERSION));
  assert.ok(csv.includes('0:00-23:59'));
});

console.log('4. 派生数值可由原始样例重算（非写死）');
check('总人次等于清洗后记录手工求和', () => {
  DATA.DATASETS.forEach(d => {
    const v = PIPE.computeView(d, ALL);
    const manual = PIPE.clean(d.records).clean.reduce((s, r) => s + r.count, 0);
    assert.strictEqual(v.totalPeople, manual);
  });
});

console.log('5. 状态持久化（模拟 localStorage 往返）');
check('状态序列化/恢复后筛选结果不变', () => {
  const saved = { dataset: 'dup', hourStart: 18, hourEnd: 19, from: 'B', to: 'A' };
  const restored = JSON.parse(JSON.stringify(saved)); // 模拟 localStorage 往返
  const v1 = PIPE.computeView(ds[saved.dataset], saved);
  const v2 = PIPE.computeView(ds[restored.dataset], restored);
  assert.deepStrictEqual(v1.flows, v2.flows);
  assert.strictEqual(v1.totalPeople, v2.totalPeople);
});
check('窗口切换再返回结果可复现', () => {
  const st = { hourStart: 8, hourEnd: 8, from: 'ALL', to: 'ALL' };
  const before = PIPE.computeView(ds.normal, st).totalPeople;
  PIPE.computeView(ds.normal, { hourStart: 9, hourEnd: 10, from: 'ALL', to: 'ALL' });
  const after = PIPE.computeView(ds.normal, st).totalPeople;
  assert.strictEqual(before, after);
});

console.log('\n全部通过：' + passed + ' 项');
