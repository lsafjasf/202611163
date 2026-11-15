export const FIXED_DT = 1 / 60;

export const GEAR_OPTIONS = [24, 28, 30, 32, 36, 38, 40, 42, 44, 46];

export const LIMITS = Object.freeze({
  speedHard: [45, 120],
  speedSafe: [50, 115],
  loadHard: [0.2, 3.6],
  loadSafe: [0.2, 3.0],
  pressure: 2.2,
  temperature: 105,
  ambient: 24,
});

export const TARGET_RATIO = 30 / 42;
export const TARGET_OUTPUT_RPM = 90 * TARGET_RATIO;
export const TARGET_TOLERANCE = 0.8;

export const AXES = Object.freeze([
  { id: "input", label: "输入轴", short: "IN" },
  { id: "idler", label: "惰轮轴", short: "ID" },
  { id: "output", label: "输出轴", short: "OUT" },
]);

export const DEFAULT_CONFIG = Object.freeze({
  input: 28,
  idler: 40,
  output: 42,
});

export const DEFAULT_CONTROLS = Object.freeze({
  inputRpm: 90,
  loadNm: 1.15,
});

export const SCENARIOS = Object.freeze([
  {
    id: "normal",
    title: "正常工况",
    note: "标准齿轮组 · 目标转速",
    config: { input: 30, idler: 40, output: 42 },
    controls: { inputRpm: 90, loadNm: 1.15 },
    expected: "success",
  },
  {
    id: "extreme",
    title: "极限载荷",
    note: "3.35 N·m · 压力联锁",
    config: { input: 30, idler: 40, output: 42 },
    controls: { inputRpm: 90, loadNm: 3.35 },
    expected: "pressure",
  },
  {
    id: "instability",
    title: "啮合失稳",
    note: "轴距偏差 · 振动越限",
    config: { input: 28, idler: 40, output: 42 },
    controls: { inputRpm: 104, loadNm: 2.05 },
    expected: "pressure",
  },
]);

export function gearGeometry(config = DEFAULT_CONFIG) {
  const input = Number.isFinite(config.input) ? config.input : 0;
  const idler = Number.isFinite(config.idler) ? config.idler : 0;
  const output = Number.isFinite(config.output) ? config.output : 0;
  const gapA = 70 - (input + idler);
  const gapB = 82 - (idler + output);
  const complete = input > 0 && idler > 0 && output > 0;
  const jam = complete && (gapA < 0 || gapB < 0);
  const underMesh = gapA > 0.5 || gapB > 0.5;
  const ratio = output > 0 ? input / output : 0;
  const ratioError = Math.abs(ratio - TARGET_RATIO);
  return {
    gapA,
    gapB,
    jam,
    underMesh,
    ratio,
    ratioError,
    expectedOutput: 90 * ratio,
    quality: jam ? "jam" : underMesh ? "loose" : ratioError > 0.005 ? "ratio" : "good",
  };
}

export function createInitialState(config = DEFAULT_CONFIG, controls = DEFAULT_CONTROLS) {
  return {
    t: 0,
    steps: 0,
    status: "ready",
    phaseInput: 0,
    phaseIdler: 0,
    phaseOutput: 0,
    inputRpm: 0,
    outputRpm: 0,
    pressureMPa: 0,
    tempC: LIMITS.ambient,
    vibration: 0,
    noiseDb: 0,
    peakPressure: 0,
    peakTemp: LIMITS.ambient,
    successHold: 0,
    offTargetHold: 0,
    trigger: null,
    signature: makeSignature(config, controls),
  };
}

export function cloneState(state) {
  return {
    ...state,
    trigger: state.trigger ? { ...state.trigger } : null,
  };
}

export function stateHash(state) {
  const values = [
    state.t,
    state.phaseInput,
    state.phaseIdler,
    state.phaseOutput,
    state.inputRpm,
    state.outputRpm,
    state.pressureMPa,
    state.tempC,
    state.vibration,
  ];
  let hash = 2166136261;
  for (const value of values) {
    const rounded = Math.round(value * 100000) | 0;
    hash ^= rounded;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").toUpperCase();
}

export function makeSignature(config, controls) {
  return [
    config.input,
    config.idler,
    config.output,
    Number(controls.inputRpm).toFixed(2),
    Number(controls.loadNm).toFixed(2),
  ].join(":");
}

function safetyTrigger(code, title, state, config, controls, extra = {}) {
  return {
    code,
    title,
    time: state.t,
    positionDeg: normalizeDegrees(state.phaseOutput),
    positionInputDeg: normalizeDegrees(state.phaseInput),
    speedRpm: state.outputRpm,
    inputRpm: state.inputRpm,
    pressureMPa: state.pressureMPa,
    tempC: state.tempC,
    loadNm: controls.loadNm,
    axis: "输出轴",
    gears: `${config.input} / ${config.idler} / ${config.output} T`,
    ...extra,
  };
}

function normalizeDegrees(radians) {
  const value = (radians * 180) / Math.PI;
  return ((value % 360) + 360) % 360;
}

function stopWithTrigger(state, config, controls, code, title, extra) {
  state.status = "failed";
  state.trigger = safetyTrigger(code, title, state, config, controls, extra);
  state.peakPressure = Math.max(state.peakPressure, state.pressureMPa);
  state.peakTemp = Math.max(state.peakTemp, state.tempC);
  return state;
}

export function stepSimulation(state, config = DEFAULT_CONFIG, controls = DEFAULT_CONTROLS, dt = FIXED_DT) {
  if (state.status === "failed" || state.status === "success") {
    return state;
  }

  const geometry = gearGeometry(config);
  const hardSpeedOk = Number.isFinite(controls.inputRpm)
    && controls.inputRpm >= LIMITS.speedHard[0]
    && controls.inputRpm <= LIMITS.speedHard[1];
  const hardLoadOk = Number.isFinite(controls.loadNm)
    && controls.loadNm >= LIMITS.loadHard[0]
    && controls.loadNm <= LIMITS.loadHard[1];

  if (!hardSpeedOk || !hardLoadOk) {
    state.outputRpm = 0;
    return stopWithTrigger(
      state,
      config,
      controls,
      "INPUT_LIMIT",
      !hardSpeedOk ? "输入转速越限 · 联锁停机" : "负载扭矩越限 · 联锁停机",
      { note: "控制量超出硬限，积分器未继续推进" },
    );
  }

  if (geometry.jam) {
    state.inputRpm = 0;
    state.outputRpm = 0;
    state.pressureMPa = Math.max(state.pressureMPa, 2.85);
    state.vibration = 8.4;
    state.noiseDb = 89;
    state.peakPressure = Math.max(state.peakPressure, state.pressureMPa);
    return stopWithTrigger(
      state,
      config,
      controls,
      "SHAFT_JAM",
      "轴距过紧 · 轮齿卡滞",
      {
        note: `轴距侵占 ${Math.abs(Math.min(geometry.gapA, geometry.gapB))} 齿，传动链锁死`,
      },
    );
  }

  state.status = "running";
  state.t += dt;
  state.steps += 1;

  const speedTau = 0.28;
  state.inputRpm += (controls.inputRpm - state.inputRpm) * (1 - Math.exp(-dt / speedTau));
  const inputOmega = (state.inputRpm * Math.PI * 2) / 60;
  const ratio = geometry.ratio;
  state.outputRpm = state.inputRpm * ratio;
  state.phaseInput += inputOmega * dt;
  state.phaseIdler -= inputOmega * (config.input / config.idler) * dt;
  state.phaseOutput += inputOmega * ratio * dt;

  const speedFactor = 0.72 + 0.28 * Math.min(1, state.inputRpm / controls.inputRpm);
  const gapStress = (Math.abs(geometry.gapA) + Math.abs(geometry.gapB)) * 0.4;
  const ratioStress = geometry.ratioError * 2;
  const speedStress = Math.max(0, state.inputRpm - 100) * 0.003;
  const meshFrequency = Math.max(0.5, (state.inputRpm / 60) * config.input * 0.13);
  const oscillationAmplitude =
    0.014
    + (Math.abs(geometry.gapA) + Math.abs(geometry.gapB)) * 0.065
    + geometry.ratioError * 0.35;
  const oscillation = Math.sin(state.t * Math.PI * 2 * meshFrequency) * oscillationAmplitude;
  const pressureTarget =
    controls.loadNm * 0.72 * speedFactor
    + gapStress
    + ratioStress
    + speedStress
    + oscillation;
  const pressureTau = 0.38;
  state.pressureMPa +=
    (Math.max(0, pressureTarget) - state.pressureMPa) * (1 - Math.exp(-dt / pressureTau));

  const meshFault = Math.abs(geometry.gapA) > 0.01 || Math.abs(geometry.gapB) > 0.01;
  const vibrationTarget =
    0.7
    + (Math.abs(geometry.gapA) + Math.abs(geometry.gapB)) * 1.05
    + state.pressureMPa * 0.32
    + geometry.ratioError * 18
    + Math.abs(Math.sin(state.t * Math.PI * 2 * meshFrequency * 0.7)) * (meshFault ? 0.85 : 0.12);
  state.vibration += (vibrationTarget - state.vibration) * (1 - Math.exp(-dt / 0.18));

  const heatInput =
    0.075
    + controls.loadNm * 0.22
    + state.pressureMPa * 0.105
    + (Math.abs(geometry.gapA) + Math.abs(geometry.gapB)) * 0.31;
  const cooling = (state.tempC - LIMITS.ambient) * 0.011;
  state.tempC += Math.max(-0.2, heatInput - cooling) * dt;

  state.noiseDb = Math.min(
    104,
    42
      + state.pressureMPa * 7
      + state.vibration * 1.3
      + geometry.ratioError * 55
      + Math.sin(state.t * 17.3) * 0.4,
  );
  state.peakPressure = Math.max(state.peakPressure, state.pressureMPa);
  state.peakTemp = Math.max(state.peakTemp, state.tempC);

  if (state.pressureMPa > LIMITS.pressure) {
    return stopWithTrigger(
      state,
      config,
      controls,
      "PRESSURE_LIMIT",
      meshFault ? "啮合失稳 · 压力越限" : "传动压力越限",
      {
        note: meshFault
          ? `轴距偏差 ${Math.abs(geometry.gapA || geometry.gapB).toFixed(1)} 齿，冲击载荷超过包络`
          : `峰值 ${state.pressureMPa.toFixed(3)} MPa，超过 ${LIMITS.pressure.toFixed(2)} MPa`,
      },
    );
  }

  if (state.tempC > LIMITS.temperature) {
    return stopWithTrigger(
      state,
      config,
      controls,
      "TEMP_LIMIT",
      "润滑油温越限 · 热停机",
      { note: `油温 ${state.tempC.toFixed(1)} °C，超过 ${LIMITS.temperature} °C` },
    );
  }

  const speedError = Math.abs(state.outputRpm - TARGET_OUTPUT_RPM);
  if (speedError <= TARGET_TOLERANCE) {
    state.successHold += dt;
    state.offTargetHold = 0;
  } else {
    state.successHold = 0;
    state.offTargetHold += dt;
  }

  if (state.successHold >= 0.75) {
    state.status = "success";
    state.trigger = safetyTrigger("TARGET_REACHED", "目标转速达成", state, config, controls, {
      note: `输出稳定在 ${state.outputRpm.toFixed(2)} RPM，窗口保持 750 ms`,
    });
  } else if (state.offTargetHold >= 2.4 && state.inputRpm >= controls.inputRpm * 0.97) {
    return stopWithTrigger(
      state,
      config,
      controls,
      "SPEED_MISMATCH",
      "输出转速偏离目标",
      {
        note: `稳定输出 ${state.outputRpm.toFixed(2)} RPM，目标 ${TARGET_OUTPUT_RPM.toFixed(2)} ± ${TARGET_TOLERANCE} RPM`,
      },
    );
  }

  return state;
}

export function sampleState(state, config, controls) {
  const geometry = gearGeometry(config);
  return {
    t: state.t,
    status: state.status,
    phaseInput: state.phaseInput,
    phaseIdler: state.phaseIdler,
    phaseOutput: state.phaseOutput,
    inputRpm: state.inputRpm,
    outputRpm: state.outputRpm,
    pressureMPa: state.pressureMPa,
    tempC: state.tempC,
    vibration: state.vibration,
    noiseDb: state.noiseDb,
    gapA: geometry.gapA,
    gapB: geometry.gapB,
    ratio: geometry.ratio,
    loadNm: controls.loadNm,
  };
}

export function runScenario(scenario, options = {}) {
  const steps = options.steps ?? Math.ceil(9 / FIXED_DT);
  const sampleEvery = options.sampleEvery ?? 3;
  const state = createInitialState(scenario.config, scenario.controls);
  const samples = [];
  let finalState = null;

  for (let index = 0; index < steps; index += 1) {
    stepSimulation(state, scenario.config, scenario.controls);
    if (index % sampleEvery === 0) {
      samples.push(sampleState(state, scenario.config, scenario.controls));
    }
    if (state.status === "failed" || state.status === "success") {
      finalState = cloneState(state);
      samples.push(sampleState(state, scenario.config, scenario.controls));
      break;
    }
  }

  if (!finalState) {
    finalState = cloneState(state);
    if (samples.length === 0 || samples.at(-1).t !== state.t) {
      samples.push(sampleState(state, scenario.config, scenario.controls));
    }
  }

  return { state: finalState, samples };
}

export function repeatabilityDelta(runA, runB) {
  const sampleCount = Math.min(runA.samples.length, runB.samples.length);
  let maxDelta = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const a = runA.samples[index];
    const b = runB.samples[index];
    maxDelta = Math.max(
      maxDelta,
      Math.abs(a.t - b.t),
      Math.abs(a.phaseOutput - b.phaseOutput) * 10,
      Math.abs(a.outputRpm - b.outputRpm) / 100,
      Math.abs(a.pressureMPa - b.pressureMPa),
      Math.abs(a.tempC - b.tempC) / 100,
    );
  }
  return maxDelta;
}

export function playbackSmoothness(samples) {
  if (samples.length < 2) return 0;
  let maximum = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    maximum = Math.max(
      maximum,
      Math.abs(current.phaseOutput - previous.phaseOutput),
      Math.abs(current.outputRpm - previous.outputRpm) * 0.04,
      Math.abs(current.pressureMPa - previous.pressureMPa) * 2,
      Math.abs(current.tempC - previous.tempC) * 0.08,
    );
  }
  return maximum;
}

export function validateScenarios() {
  return SCENARIOS.map((scenario) => {
    const runA = runScenario(scenario);
    const runB = runScenario(scenario);
    const trigger = runA.state.trigger;
    return {
      ...scenario,
      state: runA.state,
      trigger,
      passed:
        scenario.expected === "success"
          ? runA.state.status === "success"
          : runA.state.status === "failed" && trigger?.code !== "TARGET_REACHED",
      repeatDelta: repeatabilityDelta(runA, runB),
      smoothness: playbackSmoothness(runA.samples),
      samples: runA.samples,
    };
  });
}
