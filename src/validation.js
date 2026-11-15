import { CONFIG, applyControl, createInitialState, stepSimulation } from "./sim.js";
import { captureFrame, frameContinuity } from "./replay.js";

function alternatingActions(start, interval, first, second, count) {
  const actions = [];
  for (let index = 0; index < count; index += 1) {
    actions.push({
      at: start + index * interval,
      channel: 0,
      value: index % 2 === 0 ? first : second
    });
  }
  return actions;
}

export const SCENARIOS = Object.freeze({
  normal: {
    id: "normal",
    name: "正常工况",
    description: "缓慢配平三阀与泵，在截止时间内同时达到双箱目标。",
    initial: {},
    actions: [],
    expected: (state) => state.status === "success"
  },
  extreme: {
    id: "extreme",
    name: "极限载荷",
    description: "泵指令从 35% 快速推至 100%，检查负载与转速保护。",
    initial: {
      tankA: 1.35,
      tankB: 0.75,
      valveTargets: [0.18, 0, 0],
      pumpTarget: 0.35
    },
    actions: [{ at: 20, channel: "pump", value: 1 }],
    expected: (state) => state.status === "trip" && ["load", "speed"].includes(state.trip?.primary)
  },
  unstable: {
    id: "unstable",
    name: "失稳工况",
    description: "高流量下每 0.13 秒反向拉满 G1，叠加水锤直至压力保护。",
    initial: {
      tankA: 1.45,
      tankB: 0.75,
      valveTargets: [0.7, 0.2, 0.29],
      pumpTarget: 0.45
    },
    actions: alternatingActions(6, 8, 0.2, 0.75, 80),
    expected: (state) => state.status === "trip" && state.trip?.primary === "pressure"
  }
});

export function runScenario(id, options = {}) {
  const scenario = SCENARIOS[id];
  if (!scenario) throw new Error(`Unknown scenario: ${id}`);
  const capture = options.capture !== false;
  let state = createInitialState(scenario.initial);
  const frames = capture ? [captureFrame(state)] : [];
  const actionMap = new Map();
  for (const action of scenario.actions) {
    if (!actionMap.has(action.at)) actionMap.set(action.at, []);
    actionMap.get(action.at).push(action);
  }
  const maxTicks = Math.ceil(CONFIG.deadline / CONFIG.dt) + 5;
  for (let index = 0; index < maxTicks; index += 1) {
    for (const action of actionMap.get(state.tick) ?? []) {
      state = applyControl(state, action.channel, action.value);
    }
    state = stepSimulation(state);
    if (capture) frames.push(captureFrame(state));
    if (state.status !== "running") break;
  }
  return {
    id,
    name: scenario.name,
    description: scenario.description,
    passed: Boolean(scenario.expected(state)),
    state,
    frames,
    summary: describeState(state)
  };
}

function describeState(state) {
  if (state.status === "success") {
    return `达标 ${state.time.toFixed(2)} s，A ${state.tankA.toFixed(2)} m / B ${state.tankB.toFixed(2)} m`;
  }
  if (state.status === "trip") {
    return `${state.trip.label} ${state.trip.value} / 限值 ${state.trip.limit}，t=${state.trip.time.toFixed(2)} s`;
  }
  if (state.status === "timeout") {
    return `超时 ${state.time.toFixed(1)} s，A ${state.tankA.toFixed(2)} m / B ${state.tankB.toFixed(2)} m`;
  }
  return "仍在运行";
}

function criticalValues(state) {
  return [
    state.time,
    state.tankA,
    state.tankB,
    state.pump,
    state.pressure,
    state.temperature,
    state.load,
    state.pumpRpm,
    state.valves[0],
    state.valves[1],
    state.valves[2],
    state.flows.feed,
    state.flows.balance,
    state.flows.pumped,
    state.flows.drain
  ];
}

function maxDifference(first, second) {
  const a = criticalValues(first);
  const b = criticalValues(second);
  let maximum = 0;
  for (let index = 0; index < a.length; index += 1) {
    maximum = Math.max(maximum, Math.abs(a[index] - b[index]));
  }
  return maximum;
}

function repeatabilityCheck() {
  const first = runScenario("normal", { capture: false }).state;
  const second = runScenario("normal", { capture: false }).state;
  const difference = maxDifference(first, second);
  return {
    id: "repeatability",
    label: "同参数重复运行",
    passed: difference < 1e-9,
    detail: `关键状态最大偏差 ${difference.toExponential(2)}（阈值 1e-9）`
  };
}

function pauseStepCheck() {
  let continuous = createInitialState();
  let paused = createInitialState();
  for (let index = 1; index <= 240; index += 1) {
    if (index === 40) {
      continuous = applyControl(continuous, 0, 0.7);
      paused = applyControl(paused, 0, 0.7);
    }
    if (index === 95) {
      continuous = applyControl(continuous, "pump", 0.5);
      paused = applyControl(paused, "pump", 0.5);
    }
    continuous = stepSimulation(continuous);
    paused = stepSimulation(paused);
  }
  const difference = maxDifference(continuous, paused);
  return {
    id: "pause-step",
    label: "暂停 / 单步一致性",
    passed: difference < 1e-12,
    detail: `240 步后物理状态偏差 ${difference.toExponential(2)}；暂停只冻结时钟，不修改状态`
  };
}

function resetDriftCheck() {
  const baseline = criticalValues(createInitialState());
  let maximum = 0;
  for (let index = 0; index < 30; index += 1) {
    const values = criticalValues(createInitialState());
    for (let key = 0; key < baseline.length; key += 1) {
      maximum = Math.max(maximum, Math.abs(baseline[key] - values[key]));
    }
  }
  return {
    id: "reset-drift",
    label: "重复重置初始条件",
    passed: maximum === 0,
    detail: `连续重置 30 次，初始状态最大漂移 ${maximum}`
  };
}

export function runValidationSuite(options = {}) {
  const scenarios = ["normal", "extreme", "unstable"].map((id) =>
    runScenario(id, { capture: options.captureScenarioFrames !== false })
  );
  const continuity = frameContinuity(scenarios[0].frames);
  const checks = [
    ...scenarios.map((scenario) => ({
      id: scenario.id,
      label: scenario.name,
      passed: scenario.passed,
      detail: scenario.summary
    })),
    repeatabilityCheck(),
    pauseStepCheck(),
    resetDriftCheck(),
    {
      id: "replay-continuity",
      label: "回放关键状态连续性",
      passed: continuity.passed,
      detail: `水位单步最大 ${continuity.maxLevelStep.toFixed(5)} m，压力帧差 ${continuity.maxPressureStep.toFixed(1)} kPa`
    }
  ];
  return {
    passed: checks.every((check) => check.passed),
    checks,
    scenarios: Object.fromEntries(scenarios.map((scenario) => [scenario.id, scenario])),
    continuity,
    ranAt: new Date().toISOString()
  };
}
