// Headless before/after comparison harness.
//   node test/headless.js
// Runs every scenario under the legacy variable-step mode ("before") and
// the fixed-step + interpolation mode ("after") at several emulated
// refresh rates, then compares final positions, error logs and resource
// counts. All randomness is seeded, so every run prints identical output.

import { SimRunner, FIXED_DT, TRAIL_CAP_FIXED } from '../src/runner.js';
import { SCENARIOS, framePatternsFor } from '../src/scenarios.js';

const EPS = 1e-9;
let failures = 0;

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function makeRunner(mode, scenario) {
  let clock = 0;
  return new SimRunner({
    mode,
    rawTrack: scenario.rawTrack,
    initial: scenario.initial,
    now: () => (clock += 0.003), // deterministic fake clock: 3us per call
  });
}

function runWithPattern(mode, scenario, pattern) {
  const runner = makeRunner(mode, scenario);
  for (const deltaMs of pattern) runner.tick(deltaMs);
  return runner;
}

// Fixed mode: record the state after every physics step, so runs at
// different refresh rates can be compared at exactly the same step count
// (a single tick may complete 1..n steps, so naive end-state comparison
// could straddle a step boundary).
function runFixedHistory(scenario, pattern, targetSteps) {
  const runner = makeRunner('fixed', scenario);
  const history = new Map();
  const orig = runner.stepOnce.bind(runner);
  runner.stepOnce = (dt) => {
    orig(dt);
    history.set(runner.world.steps, { ...runner.world.state });
  };
  let i = 0;
  while (runner.world.steps < targetSteps && i < pattern.length * 4) {
    runner.tick(pattern[i % pattern.length]);
    i += 1;
  }
  return { runner, history };
}

function compareScenario(scenario) {
  const patterns = framePatternsFor(scenario);
  const lines = [];
  lines.push(`\n=== 场景: ${scenario.label} (${scenario.id}) ===`);

  // ---- BEFORE: variable step ----
  const beforeRef = runWithPattern('variable', scenario, patterns.hz60);
  const beforeJitter = runWithPattern('variable', scenario, patterns.jitter);
  const before144 = runWithPattern('variable', scenario, patterns.hz144);
  const beforeErr = Math.max(
    dist(beforeRef.world.state, beforeJitter.world.state),
    dist(beforeRef.world.state, before144.world.state),
  );
  lines.push(`[修复前/可变步长] 60Hz vs 抖动/144Hz 最大位置误差: ${beforeErr.toFixed(4)} 单位`);
  lines.push(`  异常日志: ${beforeRef.totalErrors} 条, 资源: ${JSON.stringify(beforeRef.getResourceStats())}`);

  // ---- AFTER: fixed step + interpolation ----
  const totalMs = scenario.duration * 1000;
  const targetSteps = Math.floor((totalMs / 1000) / FIXED_DT);
  const afterRef = runFixedHistory(scenario, patterns.hz60, targetSteps);
  const afterJitter = runFixedHistory(scenario, patterns.jitter, targetSteps);
  const after30 = runFixedHistory(scenario, patterns.hz30, targetSteps);
  const commonSteps = Math.min(afterRef.runner.world.steps, afterJitter.runner.world.steps, after30.runner.world.steps);
  const afterErr = Math.max(
    dist(afterRef.history.get(commonSteps), afterJitter.history.get(commonSteps)),
    dist(afterRef.history.get(commonSteps), after30.history.get(commonSteps)),
  );
  lines.push(`[修复后/固定步长] 60Hz vs 抖动/30Hz 最大位置误差: ${afterErr.toExponential(3)} 单位`);
  lines.push(`  异常日志: ${afterRef.runner.totalErrors} 条, 资源: ${JSON.stringify(afterRef.runner.getResourceStats())}`);

  // ---- invariants ----
  if (afterErr > EPS) {
    failures += 1;
    lines.push(`  x 固定步长结果随刷新率漂移 (${afterErr})`);
  } else {
    lines.push('  ✓ 不同刷新率下最终结果完全一致');
  }
  if (afterRef.runner.getResourceStats().trailPoints > TRAIL_CAP_FIXED) {
    failures += 1;
    lines.push('  x 轨迹缓冲超出上限');
  }
  if (scenario.id === 'corrupted') {
    if (afterRef.runner.totalErrors === 0) {
      failures += 1;
      lines.push('  x 损坏输入未产生任何异常日志（疑似被隐藏）');
    } else {
      lines.push(`  ✓ 损坏输入产生 ${afterRef.runner.totalErrors} 条已恢复异常日志，模拟仍完成`);
    }
    const s = afterRef.runner.world.state;
    if (![s.x, s.y, s.vx, s.vy].every(Number.isFinite)) {
      failures += 1;
      lines.push('  x 损坏输入导致状态非有限值');
    }
  }
  return lines;
}

function robustnessChecks() {
  const lines = ['\n=== 健壮性检查（暂停/倍速/失焦/钳制） ==='];
  const scenario = SCENARIOS.normal;
  const maxSane = 30; // one frame of motion can never exceed this

  // Pause must freeze the world exactly.
  const r1 = makeRunner('fixed', scenario);
  for (let i = 0; i < 60; i += 1) r1.tick(16.6667);
  const frozen = { ...r1.world.state };
  r1.pause();
  for (let i = 0; i < 120; i += 1) r1.tick(16.6667);
  const pausedDrift = dist(frozen, r1.world.state);
  lines.push(`暂停期间位置漂移: ${pausedDrift} ${pausedDrift === 0 ? '✓' : 'x'}`);
  if (pausedDrift !== 0) failures += 1;

  // Resume must not jump (accumulator reset).
  r1.resume();
  r1.tick(16.6667);
  const resumeJump = dist(frozen, r1.world.state);
  lines.push(`恢复后单帧位移: ${resumeJump.toFixed(3)} ${resumeJump < maxSane ? '✓' : 'x'}`);
  if (resumeJump >= maxSane) failures += 1;

  // Huge delta (tab was hidden) must be clamped, logged, and not teleport.
  const r2 = makeRunner('fixed', scenario);
  for (let i = 0; i < 60; i += 1) r2.tick(16.6667);
  const before2 = { ...r2.world.state };
  r2.tick(5000);
  const clampJump = dist(before2, r2.world.state);
  const clampOk = r2.metrics.clampedFrames === 1 && r2.totalErrors >= 1;
  lines.push(`5000ms 帧钳制: 位移 ${clampJump.toFixed(2)}, 钳制计数 ${r2.metrics.clampedFrames}, 日志 ${r2.totalErrors} ${clampOk ? '✓' : 'x'}`);
  if (!clampOk) failures += 1;

  // Blur/focus cycle must not advance simulation while hidden.
  const r3 = makeRunner('fixed', scenario);
  for (let i = 0; i < 60; i += 1) r3.tick(16.6667);
  r3.notifyHidden();
  const hiddenState = { ...r3.world.state };
  for (let i = 0; i < 300; i += 1) r3.tick(16.6667);
  const hiddenDrift = dist(hiddenState, r3.world.state);
  r3.notifyVisible();
  r3.tick(16.6667);
  const focusJump = dist(hiddenState, r3.world.state);
  const blurOk = hiddenDrift === 0 && focusJump < maxSane;
  lines.push(`失焦漂移: ${hiddenDrift}, 恢复跳变: ${focusJump.toFixed(3)} ${blurOk ? '✓' : 'x'}`);
  if (!blurOk) failures += 1;

  // Speed multiplier: 2x must advance exactly twice the sim time.
  const r4 = makeRunner('fixed', scenario);
  r4.setSpeed(2);
  for (let i = 0; i < 120; i += 1) r4.tick(16.6667);
  const r5 = makeRunner('fixed', scenario);
  for (let i = 0; i < 120; i += 1) r5.tick(16.6667);
  const ratio = r4.world.time / r5.world.time;
  const speedOk = Math.abs(ratio - 2) < 0.02;
  lines.push(`2x 倍速时间比: ${ratio.toFixed(3)} ${speedOk ? '✓' : 'x'}`);
  if (!speedOk) failures += 1;
  r4.setSpeed(Infinity);
  lines.push(`非法倍速被拒绝并记录: ${r4.totalErrors > 0 ? '✓' : 'x'}`);
  if (r4.totalErrors === 0) failures += 1;

  return lines;
}

function runAll() {
  const lines = [];
  for (const scenario of Object.values(SCENARIOS)) {
    lines.push(...compareScenario(scenario));
  }
  lines.push(...robustnessChecks());
  return lines;
}

const first = runAll();
const firstFailures = failures;
failures = 0;
const second = runAll();
const reproducible = JSON.stringify(first) === JSON.stringify(second);
failures = firstFailures;

console.log(first.join('\n'));
console.log(`\n=== 可重复性: 两次完整运行输出${reproducible ? '完全一致 ✓' : '不一致 x'} ===`);
if (!reproducible) failures += 1;

console.log(failures === 0 ? '\n全部检查通过。' : `\n${failures} 项检查失败。`);
process.exit(failures === 0 ? 0 : 1);
