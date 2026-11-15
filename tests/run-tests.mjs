import assert from 'node:assert/strict';
import { SinglePendulum } from '../src/physics/single-pendulum.mjs';
import { DoublePendulum } from '../src/physics/double-pendulum.mjs';
import { SimulationRunner } from '../src/simulation/runner.mjs';
import { createModel } from '../src/simulation/factory.mjs';

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  ✗ ${name}: ${err.message}`);
  }
}

const base = {
  mode: 'single',
  massKg: 1,
  lengthM: 1,
  angleDeg: 30,
  dampingPerSec: 0.2,
  frictionOn: false
};
const runner = (cfg) => {
  const { model, params } = createModel({ ...base, ...cfg });
  return new SimulationRunner(model, params);
};

console.log('正常工况：无摩擦能量守恒（单摆）');
test('5 秒后总机械能漂移 < 0.1%', () => {
  const r = runner({ frictionOn: false });
  const e0 = r.currentFrame.totalEnergyJ;
  r.runSeconds(5);
  const drift = Math.abs(r.currentFrame.totalEnergyJ - e0) / e0;
  assert.ok(drift < 1e-3, `漂移 ${drift}`);
});

console.log('正常工况：摩擦开启后能量衰减且温升为正');
test('耗散功 = 机械能损失，温度单调上升', () => {
  const r = runner({ frictionOn: true, dampingPerSec: 0.5 });
  const e0 = r.currentFrame.totalEnergyJ;
  r.runSeconds(8);
  const f = r.currentFrame;
  assert.ok(f.totalEnergyJ < e0 * 0.9, '能量应显著衰减');
  const balance = Math.abs(f.dissipatedJ - (e0 - f.totalEnergyJ));
  assert.ok(balance < 1e-6, `能量收支不平衡 ${balance}`);
  assert.ok(f.temperatureC > 20, '温度应高于环境温度');
});

console.log('极限载荷：大质量触发压力上限并记录触发点');
test('50 kg 摆球越过 1500 N 压力限值即停止', () => {
  const r = runner({ massKg: 50, lengthM: 1, angleDeg: 150 });
  r.runSeconds(20);
  assert.ok(r.trigger, '应触发限值');
  assert.equal(r.trigger.reason, 'pressureN');
  assert.ok(r.trigger.pressureN > 1490, `触发点压力 ${r.trigger.pressureN}`);
  assert.ok(Array.isArray(r.trigger.positions) && r.trigger.positions.length >= 1);
  const frozen = r.currentFrame;
  r.runSeconds(2);
  assert.deepEqual(r.currentFrame.positions, frozen.positions, '触发后不得继续计算');
});

console.log('失稳：双摆混沌运动触发速度/边界限值');
test('大角度双摆进入高速并触发，记录位置/速度/压力/温度', () => {
  const r = runner({
    mode: 'double',
    massKg: 3,
    secondMassKg: 3,
    lengthM: 2,
    secondLengthM: 2,
    angleDeg: 150,
    secondAngleDeg: 120
  });
  r.runSeconds(40);
  assert.ok(r.trigger, '双摆应触发速度或边界限值');
  assert.ok(['speed', 'boundary', 'pressureN'].includes(r.trigger.reason));
  for (const key of ['positions', 'speed', 'pressureN', 'temperatureC', 'time']) {
    assert.ok(r.trigger[key] !== undefined, `触发点缺少 ${key}`);
  }
});

console.log('确定性：同参数重复运行近似一致');
test('两次独立运行末态状态完全相同（定步长确定性）', () => {
  const a = runner({ mode: 'double', angleDeg: 80, secondAngleDeg: 40 });
  const b = runner({ mode: 'double', angleDeg: 80, secondAngleDeg: 40 });
  a.runSeconds(10);
  b.runSeconds(10);
  assert.ok(Math.abs(a.currentFrame.theta - b.currentFrame.theta) < 1e-12);
  assert.ok(Math.abs(a.currentFrame.speed - b.currentFrame.speed) < 1e-12);
});

console.log('暂停与单步等价性');
test('连续单步 N 次 == 一次性推进 N 帧', () => {
  const stepped = runner({ angleDeg: 45 });
  for (let i = 0; i < 60; i++) stepped.stepOnce();
  const continuous = runner({ angleDeg: 45 });
  continuous.runSeconds(1);
  assert.ok(
    Math.abs(stepped.currentFrame.theta - continuous.currentFrame.theta) < 1e-12,
    '暂停单步与连续运行状态必须一致'
  );
  assert.equal(stepped.running, false);
});

console.log('多次重置后初始条件不漂移');
test('反复重置+运行后初始帧与首帧一致', () => {
  const r = runner({ angleDeg: 75 });
  const initial = r.currentFrame;
  for (let i = 0; i < 5; i++) {
    r.runSeconds(3);
    r.reset();
  }
  assert.ok(Math.abs(r.currentFrame.theta - initial.theta) < 1e-15);
  assert.equal(r.currentFrame.omega, 0);
  assert.equal(r.time, 0);
});

console.log('回放连续性：关键状态无跳变');
test('记录器连续性校验通过', () => {
  const r = runner({ mode: 'double', angleDeg: 90, secondAngleDeg: 60 });
  r.runSeconds(5);
  const result = r.recorder.verifyContinuity();
  assert.ok(result.ok, `存在跳变: ${JSON.stringify(result.violations[0])}`);
});

console.log('双摆能量守恒');
test('无摩擦双摆 10 秒能量漂移 < 0.5%', () => {
  const r = runner({ mode: 'double', angleDeg: 100, secondAngleDeg: 70, frictionOn: false });
  const e0 = r.currentFrame.totalEnergyJ;
  r.runSeconds(10);
  const drift = Math.abs(r.currentFrame.totalEnergyJ - e0) / e0;
  assert.ok(drift < 5e-3, `漂移 ${drift}`);
});

console.log(`\n结果：${passed} 通过，${failures.length} 失败`);
process.exit(failures.length ? 1 : 0);
