/* 验证：清洗、聚合、导出一致性、状态保持。运行：node test/run-tests.js */
const RawData = require('../js/data-raw.js');
const P = require('../js/pipeline.js');

const { META, DATASETS } = RawData;
const dims = { sensors: META.sensors, windows: META.windows, seqs: META.seqs };
let passed = 0, failed = 0;

function assert(cond, name, detail) {
  if (cond) { passed++; console.log('  PASS ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? ' -> ' + detail : '')); }
}
function approx(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-9); }

// ---- 1. 正常数据集：无重复、无缺失、无异常 ----
console.log('[1] 正常数据集清洗');
const normalClean = P.cleanDataset(DATASETS.normal.records, dims);
assert(normalClean.quality.duplicatesRemoved === 0, '正常组无重复');
assert(normalClean.quality.anomaliesRemoved === 0, '正常组无异常');
assert(normalClean.quality.missingCount === 0, '正常组无缺失');
assert(normalClean.quality.cleanCount === normalClean.quality.expectedCount,
  '清洗后=期望数', normalClean.quality.cleanCount + ' vs ' + normalClean.quality.expectedCount);

// ---- 2. 缺失数据集：缺失计数正确，聚合均值可重算 ----
console.log('[2] 缺失数据集清洗与聚合');
const missingClean = P.cleanDataset(DATASETS.missing.records, dims);
assert(missingClean.quality.missingCount > 0, '缺失组存在缺失', missingClean.quality.missingCount);
assert(missingClean.quality.cleanCount === missingClean.quality.expectedCount - missingClean.quality.missingCount,
  '缺失组：有效=期望-缺失');
// 手工重算某格均值（取一个有缺失的格）
const gridM = P.aggregateGrid(missingClean.records, 'pm25', 2, META.gridSize);
const manual = DATASETS.missing.records
  .filter(r => r.gx === 5 && r.gy === 7 && r.window === 2)
  .map(r => r.pm25);
const manualMean = manual.reduce((a, b) => a + b, 0) / manual.length;
assert(approx(gridM[5][7], manualMean), '聚合均值=手工重算', gridM[5][7] + ' vs ' + manualMean);
assert(gridM[3][11] === null && gridM[13][12] === null, '整格缺失为 null（不参与聚合）');

// ---- 3. 重复+异常数据集：去重保留首条，异常剔除 ----
console.log('[3] 重复+异常数据集清洗');
const dupClean = P.cleanDataset(DATASETS.duplicate.records, dims);
const expectedDups = Math.floor(DATASETS.normal.records.length * 0.05);
assert(dupClean.quality.duplicatesRemoved === expectedDups, '去重数量=注入数量',
  dupClean.quality.duplicatesRemoved + ' vs ' + expectedDups);
assert(dupClean.quality.anomaliesRemoved === 6, '异常剔除=6', dupClean.quality.anomaliesRemoved);
// 未受异常注入影响的格，聚合结果应与正常组完全一致（去重保留首条）
const gridN = P.aggregateGrid(normalClean.records, 'pm25', 0, META.gridSize);
const gridD = P.aggregateGrid(dupClean.records, 'pm25', 0, META.gridSize);
assert(approx(gridD[8][8], gridN[8][8]), '去重后聚合=正常组（保留首条）',
  gridD[8][8] + ' vs ' + gridN[8][8]);
assert(approx(gridD[2][14], gridN[2][14]), '郊区格去重后聚合一致');

// ---- 4. 导出 CSV 与屏幕网格数值一致 ----
console.log('[4] 导出一致性');
const csv = P.buildCsv(gridN, 'all', {
  datasetLabel: '正常数据', version: META.version,
  pollutant: 'PM2.5', windowLabel: META.windowLabels[0], region: '全部',
});
const line = csv.split('\n').find(l => l.startsWith('8,8,'));
assert(!!line, 'CSV 含目标网格行');
assert(approx(Number(line.split(',')[3]), Number(gridN[8][8].toFixed(3))),
  'CSV 数值=屏幕网格值', line);
const csvCenter = P.buildCsv(gridN, 'center', {
  datasetLabel: '正常数据', version: META.version,
  pollutant: 'PM2.5', windowLabel: META.windowLabels[0], region: '城市中心',
});
assert(csvCenter.split('\n').every(l => !/^\d/.test(l) || l.endsWith(',center,' + l.split(',')[3]) || l.split(',')[2] === 'center'),
  '区域筛选后 CSV 仅含中心网格');

// ---- 5. 颜色标尺随时间窗口变化 ----
console.log('[5] 颜色标尺随时间变化');
const statsW0 = P.computeStats(P.aggregateGrid(normalClean.records, 'pm25', 0, META.gridSize), 'all');
const statsW3 = P.computeStats(P.aggregateGrid(normalClean.records, 'pm25', 3, META.gridSize), 'all');
assert(!approx(statsW0.mean, statsW3.mean, 1e-6), '不同窗口统计不同（标尺随时间变化）',
  statsW0.mean.toFixed(3) + ' vs ' + statsW3.mean.toFixed(3));
assert(statsW0.min <= statsW0.mean && statsW0.mean <= statsW0.max, 'min<=mean<=max');

// ---- 6. 状态保持：切换窗口再返回不丢失 ----
console.log('[6] 状态保持');
const store = P.createStore({ datasetKey: 'normal', pollutant: 'pm25', window: 0, region: 'center', hSlice: 60, vSlice: 7 });
store.switchWindow(3);
store.set({ hSlice: 45 });           // 在窗口 3 调整切片
store.switchWindow(0);               // 返回窗口 0
const back = store.get();
assert(back.hSlice === 60 && back.vSlice === 7 && back.region === 'center',
  '返回后切片/筛选状态恢复', JSON.stringify(back));
store.switchWindow(3);
assert(store.get().hSlice === 45, '再次切换后窗口 3 状态保留');

// ---- 7. 热点清单与切面同步 ----
console.log('[7] 热点清单与切面同步');
const thr = statsW0.mean;
const spots = P.topHotspots(P.aggregateGrid(normalClean.records, 'pm25', 0, META.gridSize), 'all', thr, 8);
assert(spots.length > 0 && spots.every(s => s.value >= thr), '热点均≥水平切片阈值');
assert(spots.every((s, i) => i === 0 || spots[i - 1].value >= s.value), '热点按浓度降序');

console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败');
process.exit(failed ? 1 : 0);
