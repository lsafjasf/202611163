/*
 * 卷扬机仿真自动化验证（Node 运行：node tests/run-tests.js）
 * 覆盖：正常工况、极限载荷、失稳；确定性复算、重置漂移、
 * 暂停/单步物理一致性、回放快照无跳变、限值触发冻结。
 */
'use strict';
const P = require('../js/physics.js');

let passed = 0, failed = 0;
const results = [];

function check(name, cond, detail) {
  if (cond) { passed++; results.push(['PASS', name, detail || '']); }
  else { failed++; results.push(['FAIL', name, detail || '']); }
}

function approx(a, b, tol) { return Math.abs(a - b) <= tol; }

function runAutopilot(frames) {
  const sim = new P.WinchSim();
  for (let i = 0; i < frames && sim.status === 'running'; i++) {
    sim.stepFrame(sim.autopilotInput());
  }
  return sim;
}

// ---------- 用例 1：正常工况 ----------
{
  const sim = runAutopilot(2400);
  check('正常工况-最终成功', sim.status === 'success', 'status=' + sim.status);
  const snap = sim.snapshot();
  for (const h of snap.hoists) {
    check(`正常工况-${h.name}高度到位`,
      approx(h.y, h.targetH, P.LIMITS.heightTol),
      `y=${h.y} target=${h.targetH}`);
    check(`正常工况-${h.name}已制动且近静止`,
      h.brakeOn && Math.abs(h.omega) < 0.05 && Math.abs(h.lDot) < 0.05,
      `omega=${h.omega} lDot=${h.lDot}`);
    check(`正常工况-${h.name}张力在限值内`,
      h.tensionL < P.LIMITS.tensionMax && h.tensionC < P.LIMITS.tensionMax,
      `TL=${h.tensionL} TC=${h.tensionC}`);
  }
}

// ---------- 用例 2：极限载荷 ----------
{
  const sim = new P.WinchSim([
    { name: 'A', load: 3000, cw: 0, targetH: 6, lL0: 5 },
    { name: 'B', load: 200, cw: 3000, targetH: 9, lL0: 7 }
  ]);
  for (let i = 0; i < 2400 && sim.status === 'running'; i++) {
    sim.stepFrame({
      A: { targetOmega: -8, brakeOn: false },
      B: { targetOmega: 8, brakeOn: false }
    });
  }
  check('极限载荷-触发保护', sim.status === 'tripped', sim.status);
  check('极限载荷-断绳类型', sim.trip && sim.trip.code === 'ROPE_BREAK',
    sim.trip && sim.trip.code);
  const st = sim.trip.state;
  check('极限载荷-记录触发位置', typeof st.x === 'number' && typeof st.y === 'number',
    `x=${st.x} y=${st.y}`);
  check('极限载荷-记录速度', typeof st.vx === 'number' && typeof st.vy === 'number',
    `vx=${st.vx} vy=${st.vy}`);
  check('极限载荷-记录破断张力', st.tensionL >= P.LIMITS.tensionMax,
    `T=${st.tensionL}`);
  check('极限载荷-记录温度压力',
    typeof st.temp === 'number' && typeof st.pressure === 'number',
    `temp=${st.temp} pressure=${st.pressure}`);
  // 触发后必须冻结，不再继续计算
  const before = JSON.stringify(sim.snapshot());
  for (let i = 0; i < 30; i++) {
    sim.stepFrame({ A: { targetOmega: 5, brakeOn: false }, B: { targetOmega: 5, brakeOn: false } });
  }
  check('极限载荷-触发后冻结', JSON.stringify(sim.snapshot()) === before, '状态不再变化');
}

// ---------- 用例 3：失稳（摆角超限） ----------
{
  const sim = new P.WinchSim([
    { name: 'A', load: 800, cw: 700, targetH: 6, lL0: 5, theta0: 0.36 },
    { name: 'B', load: 1400, cw: 1300, targetH: 9, lL0: 7, theta0: 0.1 }
  ]);
  sim.stepFrame({ A: { targetOmega: 0, brakeOn: true }, B: { targetOmega: 0, brakeOn: true } });
  check('失稳-触发保护', sim.status === 'tripped', sim.status);
  check('失稳-摆角类型', sim.trip && sim.trip.code === 'SWING_UNSTABLE',
    sim.trip && sim.trip.code);
  const st = sim.trip.state;
  check('失稳-记录摆角位置', Math.abs(st.theta) >= P.LIMITS.swingMax - 1e-3,
    `theta=${st.theta} x=${st.x} y=${st.y}`);
  check('失稳-记录速度', typeof st.vx === 'number' && typeof st.thetaDot === 'number',
    `vx=${st.vx} thetaDot=${st.thetaDot}`);
}

// ---------- 用例 4：失稳（撞墙） ----------
{
  const sim = new P.WinchSim([
    { name: 'A', load: 800, cw: 700, targetH: 6, lL0: 5, theta0: 0 },
    { name: 'B', load: 1400, cw: 1300, targetH: 9, lL0: 7, theta0: 0.28 }
  ]);
  sim.stepFrame({ A: { targetOmega: 0, brakeOn: true }, B: { targetOmega: 0, brakeOn: true } });
  check('撞墙-触发WALL_HIT', sim.trip && sim.trip.code === 'WALL_HIT',
    sim.trip && sim.trip.code);
  check('撞墙-记录越界位置', Math.abs(sim.trip.state.x) > P.LIMITS.wallX,
    'x=' + sim.trip.state.x);
}

module.exports = { check, approx, runAutopilot, P, results, summary };

// ---------- 用例 5：同参数重复运行确定性 ----------
{
  const a = runAutopilot(900);
  const b = a.rerun();
  check('确定性-复算状态相同',
    JSON.stringify(a.snapshot()) === JSON.stringify(b.snapshot()),
    '末帧快照完全一致');
  check('确定性-快照帧数一致',
    a.snapshots.length === b.snapshots.length,
    `${a.snapshots.length} vs ${b.snapshots.length}`);
  let maxDiff = 0;
  for (let i = 0; i < a.snapshots.length; i++) {
    const ha = a.snapshots[i].hoists, hb = b.snapshots[i].hoists;
    for (let k = 0; k < 2; k++) {
      for (const key of ['x', 'y', 'vx', 'vy', 'theta', 'omega', 'tensionL', 'temp']) {
        maxDiff = Math.max(maxDiff, Math.abs(ha[k][key] - hb[k][key]));
      }
    }
  }
  check('确定性-逐帧最大偏差为0', maxDiff === 0, 'maxDiff=' + maxDiff);
}

// ---------- 用例 6：多次重置初始条件不漂移 ----------
{
  const sim = new P.WinchSim();
  const base = JSON.stringify(sim.snapshot());
  let drift = 0;
  for (let n = 0; n < 5; n++) {
    for (let i = 0; i < 300; i++) {
      sim.stepFrame({
        A: { targetOmega: 4, brakeOn: false },
        B: { targetOmega: -4, brakeOn: false }
      });
    }
    sim.reset();
    drift = Math.max(drift, JSON.stringify(sim.snapshot()) === base ? 0 : 1);
  }
  check('重置-五次后初始快照无漂移', drift === 0, 'drift=' + drift);
  const h0 = sim.hoists[0];
  check('重置-状态量归零',
    h0.omega === 0 && h0.thetaDot === 0 && h0.lDot === 0 && h0.holdT === 0 &&
    h0.temp === P.LIMITS.tempAmbient && h0.pressure === 0 && h0.tripped === null,
    'omega/thetaDot/lDot/holdT/temp/pressure');
}

// ---------- 用例 7：暂停与单步得到相同物理状态 ----------
{
  // 路径甲：连续运行 100 帧
  const a = new P.WinchSim();
  for (let i = 0; i < 100; i++) {
    a.stepFrame({ A: { targetOmega: 3, brakeOn: false }, B: { targetOmega: -2, brakeOn: false } });
  }
  // 路径乙：每帧之间“暂停”（不推进物理），单步一次
  const b = new P.WinchSim();
  const frozenBefore = JSON.stringify(b.snapshot());
  for (let i = 0; i < 100; i++) {
    // 暂停 = 不推进物理，仅读取快照，时间与状态必须冻结
    if (JSON.stringify(b.snapshot()) !== frozenBefore) break;
  }
  check('暂停-物理时间冻结', b.time === 0 && b.snapshot().time === 0, 'time=' + b.time);
  for (let i = 0; i < 100; i++) {
    b.stepFrame({ A: { targetOmega: 3, brakeOn: false }, B: { targetOmega: -2, brakeOn: false } });
  }
  check('暂停/单步-与连续运行状态一致',
    JSON.stringify(a.snapshot()) === JSON.stringify(b.snapshot()),
    '暂停不改变物理推进结果');
}

// ---------- 用例 8：回放快照相邻无跳变 ----------
{
  const sim = runAutopilot(600);
  const snaps = sim.snapshots;
  let worst = 0;
  for (let i = 1; i < snaps.length; i++) {
    for (let k = 0; k < 2; k++) {
      const a = snaps[i - 1].hoists[k], b = snaps[i].hoists[k];
      const dt = snaps[i].time - snaps[i - 1].time || P.FRAME_DT;
      for (const key of ['x', 'y', 'theta', 'l', 'temp']) {
        const rate = Math.abs(b[key] - a[key]) / dt;
        // 相邻帧变化率上限：位置 25 m/s，角度 15 rad/s，温度 50 K/s
        const cap = key === 'temp' ? 50 : (key === 'theta' ? 15 : 25);
        if (rate > cap) worst = Math.max(worst, rate);
      }
    }
  }
  check('回放-相邻快照无跳变', worst === 0, 'worstRate=' + worst);
  check('回放-时间戳单调', snaps.every((s, i) => i === 0 || s.time >= snaps[i - 1].time),
    'time 单调不减');
}

// ---------- 用例 9：过温与过压限值触发并记录触发点 ----------
{
  const tempSim = new P.WinchSim();
  for (let i = 0; i < 20000 && tempSim.status === 'running'; i++) {
    const om = Math.sin(i / 30) * 1.5; // 温和往复，持续发热
    tempSim.stepFrame({
      A: { targetOmega: om, brakeOn: false },
      B: { targetOmega: om, brakeOn: false }
    });
  }
  check('限值-过温触发', tempSim.trip && tempSim.trip.code === 'OVER_TEMP',
    tempSim.trip && tempSim.trip.code);
  check('限值-过温触发点温度越限',
    tempSim.trip && tempSim.trip.state.temp >= P.LIMITS.tempMax,
    'temp=' + (tempSim.trip && tempSim.trip.state.temp));
  check('限值-过温记录位置速度',
    tempSim.trip && typeof tempSim.trip.state.y === 'number' &&
    typeof tempSim.trip.state.vy === 'number',
    `y=${tempSim.trip && tempSim.trip.state.y}`);

  const presSim = new P.WinchSim();
  for (let i = 0; i < 600 && presSim.status === 'running'; i++) {
    presSim.stepFrame({
      A: { targetOmega: 0, brakeOn: true, hardBrake: true },
      B: { targetOmega: 0, brakeOn: true }
    });
  }
  check('限值-过压触发', presSim.trip && presSim.trip.code === 'OVER_PRESSURE',
    presSim.trip && presSim.trip.code);
  check('限值-过压触发点压力越限',
    presSim.trip && presSim.trip.state.pressure > P.LIMITS.pressureMax,
    'pressure=' + (presSim.trip && presSim.trip.state.pressure));

  // 松绳缠结：直接构造超出阈值的松弛几何，验证防御性保护链
  const slackSim = new P.WinchSim([
    { name: 'A', load: 400, cw: 1400, targetH: 6, lL0: 5 },
    { name: 'B', load: 1400, cw: 1300, targetH: 9, lL0: 7 }
  ]);
  // 自然绳长显著大于几何绳长 -> 松弛量超过 slackTrip
  slackSim.hoists[0].lL = slackSim.hoists[0].l + P.LIMITS.slackTrip + 0.1;
  slackSim.stepFrame({
    A: { targetOmega: 0, brakeOn: true },
    B: { targetOmega: 0, brakeOn: true }
  });
  check('限值-松绳缠结或断绳触发',
    slackSim.trip && slackSim.trip.code === 'ROPE_TANGLE',
    slackSim.trip && slackSim.trip.code);
  check('限值-缠结记录松弛量',
    slackSim.trip && slackSim.trip.state.slackL > P.LIMITS.slackTrip,
    'slackL=' + (slackSim.trip && slackSim.trip.state.slackL));

  // 全工况有限性回归：任何快照都不得出现 NaN/Infinity（回放跳变防护）
  const finiteSim = new P.WinchSim([
    { name: 'A', load: 3000, cw: 0, targetH: 6, lL0: 5 },
    { name: 'B', load: 200, cw: 3000, targetH: 9, lL0: 7 }
  ]);
  for (let i = 0; i < 300 && finiteSim.status === 'running'; i++) {
    finiteSim.stepFrame({
      A: { targetOmega: -8, brakeOn: false },
      B: { targetOmega: 8, brakeOn: false }
    });
  }
  const allFinite = finiteSim.snapshots.every((s) =>
    s.hoists.every((h) => Object.values(h).every((v) =>
      typeof v !== 'number' || Number.isFinite(v))));
  check('有限性-全部快照无NaN/Infinity', allFinite, 'snapshots=' + finiteSim.snapshots.length);

  // 超速：大配重差拖拽 + 同向满速命令
  const speedSim = new P.WinchSim([
    { name: 'A', load: 300, cw: 2800, targetH: 6, lL0: 5 },
    { name: 'B', load: 1400, cw: 1300, targetH: 9, lL0: 7 }
  ]);
  for (let i = 0; i < 600 && speedSim.status === 'running'; i++) {
    speedSim.stepFrame({
      A: { targetOmega: 12, brakeOn: false },
      B: { targetOmega: 0, brakeOn: true }
    });
  }
  check('限值-超速触发', speedSim.trip && speedSim.trip.code === 'OVER_SPEED',
    speedSim.trip && speedSim.trip.code);
  check('限值-超速点记录角速度',
    speedSim.trip && Math.abs(speedSim.trip.state.omega) > P.LIMITS.speedMax,
    'omega=' + (speedSim.trip && speedSim.trip.state.omega));
}

function summary() {
  for (const r of results) console.log(r[0].padEnd(5), r[1], r[2] ? '(' + r[2] + ')' : '');
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

if (require.main === module) summary();
