/* Node 无头验证：正常工况 / 极限载荷 / 失稳共振 + 重复一致性 + 重置不漂移 */
var Sim = require('./sim.js');

function fmt(r) {
  return 'type=' + r.type + ' t=' + r.t.toFixed(2) + 's x=' +
    (r.x == null ? '-' : r.x.toFixed(0)) + ' v=' + r.speed +
    ' σ=' + r.stress.toFixed(1) + ' T=' + r.temp.toFixed(1);
}

var f0 = Sim.estimateNaturalFreq(Sim.makeConfig({}));
console.log('固有频率 f0 =', f0.toFixed(3), 'Hz');

var scenarios = {
  normal:   { speed: 120, gap: 200, loadMul: 1.0 },
  limit:    { speed: 60,  gap: 120, loadMul: 2.8 },
  unstable: { speed: 100, gap: Math.round(100 / f0), loadMul: 1.0 }
};

var fail = 0;
Object.keys(scenarios).forEach(function (name) {
  var a = Sim.runScenario(scenarios[name], 90);
  var b = Sim.runScenario(scenarios[name], 90);
  var same = a.hash === b.hash && a.result.type === b.result.type;
  console.log('[' + name + ']', fmt(a.result), '| hash=' + a.hash,
    '| 重复一致=' + (same ? 'OK' : 'FAIL'));
  if (!same) fail++;
});

// 重置不漂移：连续 5 次创建初始状态，指纹必须一致
var cfg = Sim.makeConfig(scenarios.normal);
var h0 = Sim.stateHash(Sim.createState(cfg)), drift = false;
for (var i = 0; i < 5; i++) {
  if (Sim.stateHash(Sim.createState(cfg)) !== h0) drift = true;
}
console.log('重置初始状态漂移:', drift ? 'FAIL' : 'OK');
if (drift) fail++;

// 暂停/单步等价：连跑 10 帧 vs 逐帧单步，状态必须相同
var s1 = Sim.createState(Sim.makeConfig(scenarios.normal));
var s2 = Sim.createState(Sim.makeConfig(scenarios.normal));
for (var j = 0; j < 10; j++) { Sim.stepFrame(s1); Sim.stepFrame(s2); }
console.log('单步/连续一致性:', Sim.stateHash(s1) === Sim.stateHash(s2) ? 'OK' : 'FAIL');

process.exit(fail ? 1 : 0);
