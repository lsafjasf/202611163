import {
  DEFAULT_DURATION_TICKS,
  cloneRecording,
  recordPolicyRun,
} from "./engine.js";

function chooseControl(state) {
  const nearby = state.entities.filter(
    (entity) => entity.y > 0.14 && entity.y < 0.94,
  );
  const hazard = nearby.find(
    (entity) =>
      entity.kind === "hazard" &&
      entity.y > 0.6 &&
      Math.abs(entity.x - state.playerX) < 0.095,
  );
  const pulse = nearby
    .filter((entity) => entity.kind === "pulse" && entity.y > 0.2)
    .sort((left, right) => right.y - left.y)[0];
  const delta = pulse ? pulse.x - state.playerX : 0;
  return {
    left: delta < -0.012,
    right: delta > 0.012,
    dash: Boolean(hazard),
  };
}

function boundaryInject(state, tick, emit) {
  if (tick === 0) {
    emit("left", "down");
    emit("left", "down");
    emit("right", "down");
  }
  if (tick === 1) {
    emit("left", "up");
  }
  if (tick === 2) {
    emit("right", "up");
  }
  if (tick === 3) {
    emit("dash", "down");
    emit("dash", "down");
  }
  if (tick === 46) {
    emit("dash", "down");
  }
  if (tick === 718) {
    emit("left", "down");
    emit("right", "down");
    emit("left", "up");
    emit("right", "up");
  }
}

function buildNormal() {
  return recordPolicyRun({
    seed: 0x00c0ffee,
    durationTicks: DEFAULT_DURATION_TICKS,
    decide: chooseControl,
  });
}

function buildBoundary() {
  const recording = recordPolicyRun({
    seed: 0x00b0a7d2,
    durationTicks: 720,
    decide: chooseControl,
    inject: boundaryInject,
  });
  recording.inputs.push({
    tick: recording.endTick,
    seq: recording.inputs.length,
    action: "dash",
    phase: "down",
  });
  recording.stats.inputEvents = recording.inputs.length;
  return recording;
}

function buildCorrupt() {
  const recording = cloneRecording(buildNormal());
  const tamperIndex = Math.max(
    1,
    Math.min(recording.random.length - 2, Math.floor(recording.random.length * 0.37)),
  );
  const row = recording.random[tamperIndex];
  row.values[0] = 0;
  row.values[1] = (row.values[1] ^ 0x1f123bb5) >>> 0;
  recording.inputs.push(
    {
      tick: -3,
      seq: 9001,
      action: "warp",
      phase: "down",
    },
    {
      tick: 12,
      seq: 9002,
      action: "left",
      phase: "hold",
    },
    {
      tick: recording.endTick + 12,
      seq: 9003,
      action: "right",
      phase: "up",
    },
  );
  recording.stats.inputEvents = recording.inputs.length;
  return recording;
}

export const SCENARIO_META = Object.freeze([
  {
    id: "normal",
    label: "正常输入",
    description: "完整 15 秒自动操作，结构、随机源与状态哈希均应一致。",
    shouldPass: true,
  },
  {
    id: "boundary",
    label: "边界输入",
    description: "覆盖 tick 0 / 末 tick、同 tick 重复键与冷却期内 Dash。",
    shouldPass: true,
  },
  {
    id: "corrupt",
    label: "损坏输入",
    description: "随机数被篡改，并混入负 tick、未知动作和非法 phase。",
    shouldPass: false,
  },
]);

export function buildScenarios() {
  const recordings = {
    normal: buildNormal(),
    boundary: buildBoundary(),
    corrupt: buildCorrupt(),
  };
  return SCENARIO_META.map((meta) => ({
    ...meta,
    recording: recordings[meta.id],
  }));
}

export function getScenario(id) {
  return buildScenarios().find((scenario) => scenario.id === id);
}
