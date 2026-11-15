import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, stepOnce, snapshot, checkLoadEnvelope } from '../js/engine.js';
import { makeAutoPilot, makeManualPilot } from '../js/pilot.js';
import { Replay } from '../js/replay.js';
import { SCENARIOS, PHYS, LIMITS } from '../js/constants.js';

function runUntilEnd(cfg, maxSteps = 12000) {
  const state = createState(cfg);
  state.status = 'running';
  const pilot = cfg.auto ? makeAutoPilot(cfg.gain) : makeManualPilot(cfg.command ?? 0);
  for (let n = 0; n < maxSteps; n++) {
    stepOnce(state, pilot);
    if (['triggered', 'success', 'failed'].includes(state.status)) break;
  }
  return state;
}

test('正常工况：干净穿过三环并安全落座', () => {
  const s = runUntilEnd(SCENARIOS.normal);
  assert.equal(s.status, 'success');
  assert.deepEqual(s.ringsPassed, [true, true, true]);
  assert.deepEqual(s.ringsHit, [false, false, false]);
  assert.equal(s.score, 100);
  assert.ok(Math.abs(s.vy) < 0.05, `落座速度应近零，实际 ${s.vy}`);
  assert.ok(s.maxPressure < LIMITS.pressureMax);
  assert.ok(Math.max(...s.temp) < LIMITS.tempMax);
});

test('极限载荷：超出负载上下限时立即触发并记录触发点', () => {
  const s = createState(SCENARIOS.load);
  s.status = 'running';
  assert.equal(checkLoadEnvelope(s), false);
  assert.equal(s.status, 'triggered');
  assert.equal(s.trigger.type, 'load');
  assert.equal(s.trigger.step, 0);
  assert.ok(s.trigger.y > 0 && Number.isFinite(s.trigger.vy));
  const tooLight = createState({ mass: 0.005 });
  tooLight.status = 'running';
  checkLoadEnvelope(tooLight);
  assert.equal(tooLight.trigger.type, 'load');
});

test('失稳工况：零阻尼满电流发散并触发超速保护', () => {
  const s = runUntilEnd(SCENARIOS.instability, 4000);
  assert.equal(s.status, 'triggered');
  assert.equal(s.trigger.type, 'speed');
  assert.ok(Math.abs(s.trigger.vy) > LIMITS.speedMax);
  assert.ok(s.trigger.t < 3, `失稳应在 3s 内触发，实际 ${s.trigger.t}s`);
  assert.ok(Number.isFinite(s.trigger.x) && Number.isFinite(s.trigger.pressure));
});

test('温度限值：持续满电流最终触发温度保护并停止计算', () => {
  const cfg = { mass: 0.05, damping: 1.6, disturb: 0, auto: false, command: 2.0 };
  const s = runUntilEnd(cfg, 200000);
  assert.equal(s.status, 'triggered');
  assert.equal(s.trigger.type, 'temp');
  assert.ok(s.trigger.temp > LIMITS.tempMax);
  const stepAtTrigger = s.step;
  stepOnce(s, makeManualPilot(2.0));
  assert.equal(s.step, stepAtTrigger, '触发后必须停止推进，不能继续计算');
});

test('压力限值：硬撞击接触压力超限时触发保护', () => {
  // Heavy payload dropped from height with no damping produces a hard impact.
  const cfg = { mass: 0.1, damping: 0.0, disturb: 0, auto: false, command: 0 };
  const s = runUntilEnd(cfg, 20000);
  assert.equal(s.status, 'triggered');
  assert.equal(s.trigger.type, 'pressure');
  assert.ok(s.trigger.pressure > LIMITS.pressureMax);
});

test('确定性：同参数重复运行得到完全一致的结果', () => {
  const a = runUntilEnd(SCENARIOS.normal);
  const b = runUntilEnd(SCENARIOS.normal);
  assert.equal(b.step, a.step);
  assert.equal(b.y, a.y);
  assert.equal(b.vy, a.vy);
  assert.equal(b.rngState, a.rngState);
  assert.equal(b.score, a.score);
  assert.deepEqual(b.current, a.current);
  assert.deepEqual(b.temp, a.temp);
});

test('暂停与单步：两条路径产生完全相同的物理状态', () => {
  const mk = () => {
    const s = createState(SCENARIOS.normal);
    s.status = 'running';
    return s;
  };
  // Path A: run N steps continuously, then pause.
  const a = mk();
  const pa = makeAutoPilot(SCENARIOS.normal.gain);
  for (let n = 0; n < 300; n++) stepOnce(a, pa);
  a.status = 'paused';
  // Path B: pause immediately, then 300 single steps.
  const b = mk();
  b.status = 'paused';
  const pb = makeAutoPilot(SCENARIOS.normal.gain);
  for (let n = 0; n < 300; n++) stepOnce(b, pb);
  assert.equal(b.step, a.step);
  assert.equal(b.y, a.y);
  assert.equal(b.vy, a.vy);
  assert.equal(b.x, a.x);
  assert.equal(b.rngState, a.rngState);
  assert.deepEqual(snapshot(b), snapshot(a));
});

test('多次重置：初始条件不发生漂移', () => {
  let s = createState(SCENARIOS.normal);
  s.status = 'running';
  const baseline = snapshot(s);
  const pilot = makeAutoPilot();
  for (let reset = 0; reset < 5; reset++) {
    for (let n = 0; n < 1500; n++) {
      stepOnce(s, pilot);
      if (s.status !== 'running') break;
    }
    s = createState(SCENARIOS.normal);
    s.status = 'running';
  }
  assert.deepEqual(snapshot(s), baseline);
  assert.equal(s.rngState, PHYS.RAND_SEED);
  assert.equal(s.t, 0);
});

test('回放：插值连续，拖动进度不产生状态跳变', () => {
  const s = createState(SCENARIOS.normal);
  s.status = 'running';
  const pilot = makeAutoPilot();
  const replay = new Replay(10);
  replay.record(s);
  for (let n = 0; n < 2000; n++) {
    stepOnce(s, pilot);
    replay.record(s);
  }
  let prev = replay.at(0);
  let maxJump = 0;
  for (let i = 1; i <= 200; i++) {
    const f = replay.at(i / 200);
    maxJump = Math.max(maxJump, Math.abs(f.y - prev.y));
    assert.ok(Number.isFinite(f.y) && Number.isFinite(f.vy));
    prev = f;
  }
  // Adjacent scrub samples move far less than one physical frame (~v*dt).
  assert.ok(maxJump < 0.01, `回放位置跳变过大: ${maxJump}`);
  const end = replay.at(1);
  assert.ok(Math.abs(end.y - s.y) < 0.02);
});

test('碰撞环边：降低评分并计入环碰标记', () => {
  const s = createState({ mass: 0.05, damping: 1.0, disturb: 0, radialK: 0 });
  s.status = 'running';
  // Lateral guidance fault: ball centre is offset so its edge overlaps the
  // annular rim as it falls through ring 1 (y = 0.35 m).
  s.x = PHYS.RING_CLEAR - PHYS.BALL_RADIUS + 0.01;
  s.y = 0.4;
  const pilot = makeManualPilot(0);
  for (let n = 0; n < 400; n++) stepOnce(s, pilot);
  assert.ok(s.ringsHit.some(Boolean));
  assert.ok(s.score < 100);
});
