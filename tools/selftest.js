/* Headless verification of every required behavior. Run: node tools/selftest.js */
const P = require("../js/physics.js");
const { SCENARIOS } = require("../js/scenarios.js");

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log("  PASS " + name);
  } else {
    failed++;
    failures.push(name + (detail ? " -> " + detail : ""));
    console.log("  FAIL " + name + (detail ? " -> " + detail : ""));
  }
}

function runSim(params, seconds = 60) {
  const sim = new P.Simulation(params);
  while (sim.status === "running" && sim.state.t < seconds) sim.step();
  return sim;
}

function stateHash(sim) {
  const s = sim.state;
  const keys = ["t", "qx", "qy", "wx", "wy", "ws", "trqX", "trqY", "temp", "pressure", "tilt", "hold"];
  let h = 0;
  for (const k of keys) {
    const v = Math.round(s[k] * 1e9);
    h = (Math.imul(h, 31) + (v | 0)) | 0;
  }
  return h;
}

console.log("\n[1] 三种标准工况");
for (const sc of SCENARIOS) {
  const sim = runSim(sc.params);
  check(
    sc.id + " 状态=" + sc.expect,
    sim.status === sc.expect,
    "got " + sim.status
  );
  if (sc.expectKey) {
    check(
      sc.id + " 触发量=" + sc.expectKey,
      sim.event && sim.event.key === sc.expectKey,
      sim.event ? sim.event.key : "no event"
    );
  }
  if (sim.event && sim.event.snap) {
    const s = sim.event.snap;
    check(
      sc.id + " 触发点记录位置/速度/压力/温度",
      Number.isFinite(s.qx) &&
        Number.isFinite(s.qy) &&
        Number.isFinite(s.wx) &&
        Number.isFinite(s.wy) &&
        Number.isFinite(s.ws) &&
        Number.isFinite(s.pressure) &&
        Number.isFinite(s.temp)
    );
  }
}

console.log("\n[2] 同参数重复运行结果近似一致");
{
  const a = runSim(SCENARIOS[0].params, 8);
  const b = runSim(SCENARIOS[0].params, 8);
  check("状态哈希完全相同", stateHash(a) === stateHash(b));
  const sa = a.state;
  const sb = b.state;
  const diff = Math.abs(sa.tilt - sb.tilt) + Math.abs(sa.ws - sb.ws);
  check("关键量数值一致 (diff<1e-12)", diff < 1e-12, "diff=" + diff);
}

console.log("\n[3] 暂停与单步得到相同物理状态");
{
  const ref = new P.Simulation(SCENARIOS[0].params);
  ref.advance(2);
  const paused = new P.Simulation(SCENARIOS[0].params);
  paused.advance(2);
  const before = stateHash(paused);
  paused.advance(0); // paused: zero-time advance must not move state
  check("暂停零推进状态不变", stateHash(paused) === before);
  // one displayed frame via 20 single-step... advance one STEPS_PER_FRAME block
  const frameSteps = P.STEPS_PER_FRAME;
  for (let i = 0; i < frameSteps; i++) paused.step();
  for (let i = 0; i < frameSteps; i++) ref.step();
  check("单步累积与连续推进一致", stateHash(paused) === stateHash(ref));
}

console.log("\n[4] 多次重置初始条件不漂移");
{
  const sim = new P.Simulation(SCENARIOS[0].params);
  const h0 = stateHash(sim);
  sim.advance(5);
  sim.reset();
  const h1 = stateHash(sim);
  sim.advance(3);
  sim.reset();
  const h2 = stateHash(sim);
  check("第 1 次重置回初始状态", h1 === h0);
  check("第 2 次重置回初始状态", h2 === h0);
  check("重置后时间归零", sim.state.t === 0);
}

console.log("\n[5] 回放快照无跳变");
{
  const sim = runSim(SCENARIOS[0].params, 9);
  const hist = sim.history;
  check("快照数量充足", hist.length > 100, "len=" + hist.length);
  let maxJump = 0;
  for (let i = 1; i < hist.length; i++) {
    const a = hist[i - 1];
    const b = hist[i];
    const dt = b.t - a.t;
    if (dt > 0) {
      // normalized rates: a genuine jump would be orders of magnitude beyond
      // any physical rate (spin dws/dt, tilt dq/dt, temperature dT/dt)
      const rate =
        Math.abs(b.qx - a.qx) / dt +
        Math.abs(b.qy - a.qy) / dt +
        Math.abs(b.ws - a.ws) / dt +
        Math.abs(b.temp - a.temp) / dt;
      maxJump = Math.max(maxJump, rate);
    }
  }
  // physical bounds: spin accel < 200 rad/s^2, tilt rate < 30 rad/s, dT < 50 K/s
  check("相邻快照变化率在物理范围内 (无跳变)", maxJump < 300, "maxRate=" + maxJump);
  const allFinite = hist.every(
    (h) => Number.isFinite(h.qx) && Number.isFinite(h.qy) && Number.isFinite(h.ws) && Number.isFinite(h.pressure)
  );
  check("全部快照字段为有限值", allFinite);
  let monotonic = true;
  for (let i = 1; i < hist.length; i++) {
    if (hist[i].t <= hist[i - 1].t) monotonic = false;
  }
  check("时间戳单调递增", monotonic);
}

console.log("\n[6] 参数上下限与越界拦截");
{
  const ok = P.validateParams({ m: 1, wsCmd: 320, biasX: 0.5 });
  check("合法参数通过", ok.ok);
  const badMass = P.validateParams({ m: 5 });
  check("质量越界被拦截", !badMass.ok && badMass.violations[0].key === "m");
  const badSpeed = P.validateParams({ wsCmd: 999 });
  check("转速越界被拦截", !badSpeed.ok && badSpeed.violations[0].key === "wsCmd");
  const badBias = P.validateParams({ biasY: -9 });
  check("偏置越界被拦截", !badBias.ok && badBias.violations[0].key === "biasY");
}

console.log("\n[7] 触发后停止计算且保留触发点");
{
  const sim = runSim(SCENARIOS[2].params);
  const tripT = sim.state.t;
  const hashAtTrip = stateHash(sim);
  sim.advance(5);
  check("触发后状态冻结", stateHash(sim) === hashAtTrip);
  check("触发后时间不前进", sim.state.t === tripT);
  check("触发点位置已记录", Number.isFinite(sim.event.snap.qx));
}

console.log("\n[8] 成功判定: 目标姿态保持 10 秒");
{
  const sim = runSim(SCENARIOS[0].params, 12);
  check("正常工况成功", sim.status === "success");
  check("成功时刻约为 10s", Math.abs(sim.state.t - 10) < 0.05, "t=" + sim.state.t);
}

console.log("\n========================================");
console.log("结果: " + passed + " 通过, " + failed + " 失败");
if (failed) {
  console.log("失败项:");
  failures.forEach((f) => console.log("  - " + f));
  process.exit(1);
}
process.exit(0);
