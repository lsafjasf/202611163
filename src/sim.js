export const CONFIG = Object.freeze({
  dt: 1 / 60,
  deadline: 80,
  successHold: 1.5,
  tankA: Object.freeze({ area: 2.4, height: 2.8, intakeMin: 0.28, intakeFull: 0.62 }),
  tankB: Object.freeze({ area: 1.85, height: 2.4 }),
  target: Object.freeze({ aMin: 1.05, aMax: 1.9, bMin: 0.62, bMax: 1.38 }),
  sourceHead: 3.8,
  supplyCapacity: 112,
  transferCapacity: 52,
  drainCapacity: 92,
  pumpCapacity: 66,
  valveTravelRate: 0.9,
  pumpSlewRate: 1.4,
  safeValveRate: 1.2,
  limits: Object.freeze({
    pressure: 850,
    temperature: 105,
    load: 78,
    pumpRpm: 3000,
    valveRate: 6
  }),
  nominalValveRate: 6,
  initial: Object.freeze({
    tankA: 0.62,
    tankB: 0.34,
    temperature: 24,
    valveTargets: Object.freeze([0.66, 0.2, 0.29]),
    pumpTarget: 0.42
  })
});

const EPSILON = 1e-9;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const approach = (value, target, maxDelta) => {
  if (Math.abs(target - value) <= maxDelta) return target;
  return value + Math.sign(target - value) * maxDelta;
};
const round = (value, digits = 4) => Number(value.toFixed(digits));

function makeEvent(state, kind, text, detail = "") {
  state.eventSeq += 1;
  state.latestChange = {
    seq: state.eventSeq,
    time: round(state.time, 2),
    kind,
    text,
    detail
  };
}

function calculateFlows(state) {
  const [g1, g2, g3] = state.valves;
  const sourceFactor = Math.sqrt(clamp((CONFIG.sourceHead - state.tankA) / CONFIG.sourceHead, 0, 1.15));
  const feed = CONFIG.supplyCapacity * g1 * sourceFactor;
  const balance = CONFIG.transferCapacity * g2 * Math.sqrt(Math.max(0, state.tankA - state.tankB));
  const intake = clamp(
    (state.tankA - CONFIG.tankA.intakeMin) / (CONFIG.tankA.intakeFull - CONFIG.tankA.intakeMin),
    0,
    1
  );
  const pumped = CONFIG.pumpCapacity * state.pump * intake;
  const drain = CONFIG.drainCapacity * g3 * Math.sqrt(Math.max(0, state.tankB));
  return { feed, balance, pumped, drain, intake };
}

function calculatePressure(state, flows, hammerWave) {
  return (
    255 +
    250 * state.pump +
    0.8 * flows.pumped +
    0.18 * flows.feed +
    18 * state.valves[1] +
    hammerWave
  );
}

function calculatePumpRpm(state) {
  return 2950 * state.pump + Math.max(0, state.load - 65) * 6;
}

export function createInitialState(overrides = {}) {
  const tanks = {
    tankA: overrides.tankA ?? CONFIG.initial.tankA,
    tankB: overrides.tankB ?? CONFIG.initial.tankB
  };
  const valveTargets = [...(overrides.valveTargets ?? CONFIG.initial.valveTargets)].map((v) =>
    clamp(Number(v), 0, 1)
  );
  const pumpTarget = clamp(Number(overrides.pumpTarget ?? CONFIG.initial.pumpTarget), 0, 1);
  const state = {
    tick: 0,
    time: 0,
    status: "running",
    tankA: tanks.tankA,
    tankB: tanks.tankB,
    valves: [...valveTargets],
    valveTargets: [...valveTargets],
    commandTargets: [...valveTargets],
    pump: pumpTarget,
    pumpTarget,
    pumpCommandTarget: pumpTarget,
    pressure: 0,
    temperature: overrides.temperature ?? CONFIG.initial.temperature,
    flows: { feed: 0, balance: 0, pumped: 0, drain: 0, intake: 1 },
    load: 0,
    pumpRpm: 0,
    dryRun: false,
    dryTime: 0,
    hammerAmp: overrides.hammerAmp ?? 0,
    hammerPhase: 0,
    commandRate: 0,
    pumpCommandRate: 0,
    maxCommandRate: 0,
    holdTime: 0,
    inTarget: { a: false, b: false },
    trip: null,
    eventSeq: 0,
    latestChange: null
  };
  const flows = calculateFlows(state);
  state.flows = flows;
  state.pressure = calculatePressure(state, flows, 0);
  state.load = state.pump * (16 + flows.pumped);
  state.pumpRpm = calculatePumpRpm(state);
  makeEvent(state, "system", "系统就绪", "等待阀门与泵指令");
  return state;
}

export function applyControl(previous, channel, value) {
  if (previous.status !== "running") return previous;
  const state = {
    ...previous,
    valveTargets: [...previous.valveTargets],
    commandTargets: [...previous.commandTargets],
    inTarget: { ...previous.inTarget }
  };
  const nextValue = clamp(Number(value), 0, 1);
  if (channel === "pump") {
    const oldValue = state.pumpTarget;
    state.pumpTarget = nextValue;
    if (Math.abs(oldValue - nextValue) > EPSILON) {
      makeEvent(state, "pump", `泵指令 ${Math.round(oldValue * 100)}% → ${Math.round(nextValue * 100)}%`);
    }
    return state;
  }
  const index = Number(channel);
  if (!Number.isInteger(index) || index < 0 || index > 2) return previous;
  const oldValue = state.valveTargets[index];
  state.valveTargets[index] = nextValue;
  if (Math.abs(oldValue - nextValue) > EPSILON) {
    makeEvent(
      state,
      "valve",
      `G${index + 1} 指令 ${Math.round(oldValue * 100)}% → ${Math.round(nextValue * 100)}%`
    );
  }
  return state;
}

function addViolation(list, type, label, value, limit) {
  list.push({
    type,
    label,
    value: round(value),
    limit,
    ratio: limit > 0 ? value / limit : 0
  });
}

function triggerTrip(state, violations) {
  const primary = violations.reduce((best, item) => (item.ratio > best.ratio ? item : best));
  state.status = "trip";
  state.trip = {
    tick: state.tick,
    time: round(state.time, 3),
    primary: primary.type,
    label: primary.label,
    value: primary.value,
    limit: primary.limit,
    violations,
    position: {
      tankA: round(state.tankA),
      tankB: round(state.tankB),
      valves: state.valves.map((value) => round(value, 3)),
      pump: round(state.pump, 3)
    },
    dynamics: {
      pumpRpm: round(state.pumpRpm, 1),
      pumpSpeed: round(state.pump * 100, 1),
      valveRate: round(state.commandRate, 2),
      pressure: round(state.pressure, 1),
      temperature: round(state.temperature, 1),
      load: round(state.load, 1),
      flows: {
        feed: round(state.flows.feed, 1),
        balance: round(state.flows.balance, 1),
        pumped: round(state.flows.pumped, 1),
        drain: round(state.flows.drain, 1)
      }
    }
  };
  makeEvent(state, "trip", `保护触发：${primary.label}`, `${primary.value} / 上限 ${primary.limit}`);
}

export function stepSimulation(previous) {
  if (previous.status !== "running") return previous;
  const dt = CONFIG.dt;
  const state = {
    ...previous,
    valves: [...previous.valves],
    valveTargets: [...previous.valveTargets],
    commandTargets: [...previous.commandTargets],
    flows: { ...previous.flows },
    inTarget: { ...previous.inTarget }
  };
  state.tick += 1;
  state.time = state.tick * dt;

  let commandRate = 0;
  let commandDelta = 0;
  for (let i = 0; i < 3; i += 1) {
    const delta = Math.abs(state.valveTargets[i] - state.commandTargets[i]);
    commandDelta = Math.max(commandDelta, delta);
    commandRate = Math.max(commandRate, delta / dt);
    state.commandTargets[i] = state.valveTargets[i];
    state.valves[i] = approach(state.valves[i], state.valveTargets[i], CONFIG.valveTravelRate * dt);
  }
  const pumpDelta = Math.abs(state.pumpTarget - state.pumpCommandTarget);
  state.pumpCommandTarget = state.pumpTarget;
  state.commandRate = commandRate;
  state.pumpCommandRate = pumpDelta / dt;
  state.maxCommandRate = Math.max(state.maxCommandRate, commandRate);
  state.pump = approach(state.pump, state.pumpTarget, CONFIG.pumpSlewRate * dt);

  const flows = calculateFlows(state);
  const totalFlow = flows.feed + flows.balance + flows.pumped + flows.drain;
  if (commandRate > CONFIG.safeValveRate) {
    const flowScale = clamp(totalFlow / 45, 0.35, 2.4);
    const ratePenalty = 18 * Math.min(4, commandRate - CONFIG.safeValveRate);
    const surge = 280 * flowScale * commandDelta + ratePenalty;
    state.hammerAmp = Math.min(1150, state.hammerAmp + surge);
    state.hammerPhase = 0;
    makeEvent(
      state,
      "hammer",
      "水锤冲击",
      `阀门指令速度 ${commandRate.toFixed(1)} /s，超过安全值 ${CONFIG.safeValveRate.toFixed(1)} /s`
    );
  }
  const hammerWave = state.hammerAmp * Math.cos(state.hammerPhase);
  state.hammerPhase = (state.hammerPhase + Math.PI * 2 * 5.5 * dt) % (Math.PI * 2);
  state.hammerAmp *= Math.exp(-2.05 * dt);
  if (state.hammerAmp < 0.05) state.hammerAmp = 0;

  state.pressure = calculatePressure(state, flows, hammerWave);
  const dryFactor = state.pump * (1 - flows.intake);
  state.dryRun = state.pump > 0.1 && flows.intake < 0.05;
  state.dryTime = state.dryRun ? state.dryTime + dt : Math.max(0, state.dryTime - dt * 2);
  state.load = state.pump * (16 + flows.pumped) + dryFactor * 12;
  state.pumpRpm = calculatePumpRpm(state);

  state.tankA = Math.max(0, state.tankA + ((flows.feed - flows.balance - flows.pumped) / 1000 / CONFIG.tankA.area) * dt);
  state.tankB = Math.max(0, state.tankB + ((flows.balance + flows.pumped - flows.drain) / 1000 / CONFIG.tankB.area) * dt);
  state.flows = flows;

  const heat = state.load * 0.42 + (state.dryRun ? state.pump * 48 : 0);
  const cooling = 0.22 * (state.temperature - CONFIG.initial.temperature);
  state.temperature += ((heat - cooling) / 8) * dt;

  state.inTarget = {
    a: state.tankA >= CONFIG.target.aMin && state.tankA <= CONFIG.target.aMax,
    b: state.tankB >= CONFIG.target.bMin && state.tankB <= CONFIG.target.bMax
  };
  if (state.inTarget.a && state.inTarget.b) {
    state.holdTime += dt;
  } else {
    state.holdTime = 0;
  }

  const violations = [];
  if (state.pressure > CONFIG.limits.pressure) {
    addViolation(violations, "pressure", "管路压力", state.pressure, CONFIG.limits.pressure);
  }
  if (state.temperature > CONFIG.limits.temperature) {
    addViolation(violations, "temperature", "泵体温度", state.temperature, CONFIG.limits.temperature);
  }
  if (state.load > CONFIG.limits.load) {
    addViolation(violations, "load", "泵负载", state.load, CONFIG.limits.load);
  }
  if (state.pumpRpm > CONFIG.limits.pumpRpm) {
    addViolation(violations, "speed", "泵转速", state.pumpRpm, CONFIG.limits.pumpRpm);
  }
  if (state.tankA > CONFIG.tankA.height || state.tankB > CONFIG.tankB.height) {
    addViolation(
      violations,
      "overflow",
      "水箱溢流",
      Math.max(state.tankA, state.tankB),
      state.tankA > CONFIG.tankA.height ? CONFIG.tankA.height : CONFIG.tankB.height
    );
  }
  if (violations.length) {
    triggerTrip(state, violations);
    return state;
  }

  if (state.holdTime >= CONFIG.successHold) {
    state.status = "success";
    makeEvent(state, "success", "双水箱进入目标区间", `保持 ${CONFIG.successHold.toFixed(1)} s`);
    return state;
  }
  if (state.time >= CONFIG.deadline) {
    state.status = "timeout";
    state.trip = {
      tick: state.tick,
      time: round(state.time, 3),
      primary: "deadline",
      label: "超时未达标",
      value: round(state.time, 1),
      limit: CONFIG.deadline,
      violations: [],
      position: {
        tankA: round(state.tankA),
        tankB: round(state.tankB),
        valves: state.valves.map((value) => round(value, 3)),
        pump: round(state.pump, 3)
      },
      dynamics: {
        pumpRpm: round(state.pumpRpm, 1),
        pumpSpeed: round(state.pump * 100, 1),
        valveRate: round(state.commandRate, 2),
        pressure: round(state.pressure, 1),
        temperature: round(state.temperature, 1),
        load: round(state.load, 1),
        flows: {
          feed: round(state.flows.feed, 1),
          balance: round(state.flows.balance, 1),
          pumped: round(state.flows.pumped, 1),
          drain: round(state.flows.drain, 1)
        }
      }
    };
    makeEvent(state, "timeout", "截止时间到达", "双水箱未同时进入目标区间");
  }
  return state;
}

export function getControlSnapshot(state) {
  return {
    valves: [...state.valveTargets],
    pump: state.pumpTarget
  };
}

export function formatTripCause(trip) {
  if (!trip) return "";
  const labels = {
    pressure: "压力越限",
    temperature: "温度越限",
    load: "负载越限",
    speed: "速度越限",
    overflow: "溢流越限",
    deadline: "截止超时"
  };
  return labels[trip.primary] ?? trip.label;
}
