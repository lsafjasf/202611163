export const SCHEMA = "pulse-trace/1";
export const TICK_RATE = 60;
export const WORLD = Object.freeze({ width: 960, height: 540 });
export const DEFAULT_DURATION_TICKS = 900;
export const MAX_DURATION_TICKS = 3600;
export const PLAYER_Y = 0.84;
export const PLAYER_RADIUS = 0.032;

export const VALID_ACTIONS = Object.freeze(["left", "right", "dash"]);
const ACTION_SET = new Set(VALID_ACTIONS);
const PHASE_SET = new Set(["down", "up"]);
const KEY_ACTIONS = Object.freeze({
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  Space: "dash",
});

export function actionForKey(code) {
  return KEY_ACTIONS[code] ?? null;
}

export class SeededRandom {
  constructor(seed) {
    this.initialSeed = seed >>> 0;
    this.state = this.initialSeed || 0x6d2b79f5;
  }

  nextUint32() {
    let value = this.state >>> 0;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state;
  }

  nextUnit() {
    return this.nextUint32() / 0x100000000;
  }
}

function mixHash(hash, value) {
  let next = hash >>> 0;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    next ^= text.charCodeAt(index);
    next = Math.imul(next, 0x01000193);
  }
  return next >>> 0;
}

function fixed(value, digits = 6) {
  return Number(value).toFixed(digits);
}

export function hashState(state) {
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  const fields = [
    state.tick,
    fixed(state.playerX),
    state.score,
    state.lives,
    state.combo,
    state.bestCombo,
    state.dashTicks,
    state.dashCooldown,
    Number(state.held.left),
    Number(state.held.right),
    state.status,
    state.reason ?? "-",
    state.nextEntityId,
  ];
  for (const field of fields) {
    left = mixHash(left, field);
    right = mixHash(right, field);
  }
  for (const entity of state.entities) {
    left = mixHash(left, entity.id);
    right = mixHash(right, entity.id);
    left = mixHash(left, entity.kind);
    right = mixHash(right, entity.kind);
    left = mixHash(left, fixed(entity.x, 5));
    right = mixHash(right, fixed(entity.y, 5));
    left = mixHash(left, fixed(entity.vy, 5));
    right = mixHash(right, fixed(entity.size, 4));
  }
  return `${left.toString(16).padStart(8, "0")}${right
    .toString(16)
    .padStart(8, "0")}`;
}

export function createInitialState() {
  return {
    tick: 0,
    playerX: 0.5,
    score: 0,
    lives: 3,
    combo: 0,
    bestCombo: 0,
    dashTicks: 0,
    dashCooldown: 0,
    held: { left: false, right: false },
    entities: [],
    nextEntityId: 1,
    status: "running",
    reason: null,
  };
}

export function cloneState(state) {
  return {
    tick: state.tick,
    playerX: state.playerX,
    score: state.score,
    lives: state.lives,
    combo: state.combo,
    bestCombo: state.bestCombo,
    dashTicks: state.dashTicks,
    dashCooldown: state.dashCooldown,
    held: { left: state.held.left, right: state.held.right },
    entities: state.entities.map((entity) => ({ ...entity })),
    nextEntityId: state.nextEntityId,
    status: state.status,
    reason: state.reason,
  };
}

export function cloneRecording(recording) {
  return structuredClone(recording);
}

function isValidInitialState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  if (
    value.tick !== 0 ||
    !Number.isFinite(value.playerX) ||
    !Number.isInteger(value.score) ||
    !Number.isInteger(value.lives) ||
    !Number.isInteger(value.nextEntityId) ||
    !value.held ||
    typeof value.held.left !== "boolean" ||
    typeof value.held.right !== "boolean" ||
    !Array.isArray(value.entities) ||
    value.entities.length > 1000
  ) {
    return false;
  }
  return value.entities.every(
    (entity) =>
      entity &&
      Number.isInteger(entity.id) &&
      (entity.kind === "pulse" || entity.kind === "hazard") &&
      Number.isFinite(entity.x) &&
      Number.isFinite(entity.y) &&
      Number.isFinite(entity.vy) &&
      Number.isFinite(entity.size),
  );
}

function errorEntry(code, message, tick = null, recovery = "") {
  return { code, message, tick, recovery, severity: "error" };
}

export function validateInputEvent(raw, index, endTick) {
  const errors = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      event: null,
      errors: [
        errorEntry(
          "E_INPUT_SHAPE",
          `输入 #${index} 不是对象`,
          null,
          "删除该事件，或从原始导出重新导入。",
        ),
      ],
    };
  }
  if (!Number.isInteger(raw.tick) || raw.tick < 0 || raw.tick > endTick) {
    errors.push(
      errorEntry(
        "E_INPUT_TICK",
        `输入 #${index} 的 tick=${String(raw.tick)} 超出 0..${endTick}`,
        Number.isFinite(raw.tick) ? raw.tick : null,
        "删除越界事件；不要把它静默映射到相邻 tick。",
      ),
    );
  }
  if (!Number.isInteger(raw.seq) || raw.seq < 0) {
    errors.push(
      errorEntry(
        "E_INPUT_SEQ",
        `输入 #${index} 缺少合法的 seq`,
        raw.tick ?? null,
        "按时间顺序重新编号输入事件。",
      ),
    );
  }
  if (!ACTION_SET.has(raw.action)) {
    errors.push(
      errorEntry(
        "E_INPUT_ACTION",
        `输入 #${index} 的 action=${String(raw.action)} 不在协议内`,
        raw.tick ?? null,
        "仅接受 left/right/dash，未知动作必须保留为错误。",
      ),
    );
  }
  if (!PHASE_SET.has(raw.phase)) {
    errors.push(
      errorEntry(
        "E_INPUT_PHASE",
        `输入 #${index} 的 phase=${String(raw.phase)} 非法`,
        raw.tick ?? null,
        "仅接受 down/up；修复后重新回放。",
      ),
    );
  }
  return {
    event: errors.length === 0 ? raw : null,
    errors,
  };
}

export function applyInputEvent(state, event) {
  const isDown = event.phase === "down";
  if (event.action === "left" || event.action === "right") {
    state.held[event.action] = isDown;
    return;
  }
  if (event.action === "dash" && isDown && state.dashCooldown === 0) {
    state.dashTicks = 10;
    state.dashCooldown = 48;
  }
}

function spawnEntity(state, randomValues) {
  const laneUnit = randomValues[1] / 0x100000000;
  const kindUnit = randomValues[2] / 0x100000000;
  const speedUnit = ((randomValues[2] >>> 12) % 1000) / 1000;
  const kind = kindUnit < 0.27 ? "hazard" : "pulse";
  state.entities.push({
    id: state.nextEntityId,
    kind,
    x: 0.1 + laneUnit * 0.8,
    y: 0.055,
    vy: (kind === "hazard" ? 0.0032 : 0.00245) + speedUnit * 0.0011,
    size: kind === "hazard" ? 0.022 : 0.018,
  });
  state.nextEntityId += 1;
}

export function advanceTick(state, randomValues) {
  if (state.status !== "running") {
    return state;
  }

  const direction = Number(state.held.right) - Number(state.held.left);
  state.playerX += direction * (0.56 / TICK_RATE);
  state.playerX = Math.max(0.06, Math.min(0.94, state.playerX));
  state.dashTicks = Math.max(0, state.dashTicks - 1);
  state.dashCooldown = Math.max(0, state.dashCooldown - 1);

  if (state.tick > 55 && randomValues[0] / 0x100000000 < 0.031) {
    spawnEntity(state, randomValues);
  }

  for (const entity of state.entities) {
    entity.y += entity.vy;
  }

  const remaining = [];
  for (const entity of state.entities) {
    const canTouch =
      entity.y >= PLAYER_Y - 0.025 && entity.y <= PLAYER_Y + 0.055;
    const inLane = Math.abs(entity.x - state.playerX) < 0.058;
    if (canTouch && inLane) {
      if (entity.kind === "pulse") {
        state.combo += 1;
        state.bestCombo = Math.max(state.bestCombo, state.combo);
        state.score += 10 + Math.min(state.combo - 1, 8) * 2;
      } else if (state.dashTicks > 0) {
        state.score += 4;
      } else {
        state.lives -= 1;
        state.combo = 0;
        if (state.lives <= 0) {
          state.status = "ended";
          state.reason = "integrity-lost";
        }
      }
      continue;
    }
    if (entity.y <= 1.08) {
      remaining.push(entity);
    } else {
      state.combo = 0;
    }
  }
  state.entities = remaining;
  state.tick += 1;
  return state;
}

export function nextRandomBundle(random) {
  return [random.nextUint32(), random.nextUint32(), random.nextUint32()];
}

export function sortInputs(inputs) {
  return [...inputs].sort((a, b) => a.tick - b.tick || a.seq - b.seq);
}

export function canonicalRandomRows(seed, count) {
  const random = new SeededRandom(seed);
  const rows = [];
  for (let tick = 0; tick < count; tick += 1) {
    rows.push({ tick, values: nextRandomBundle(random) });
  }
  return rows;
}

function makeRecording({
  seed,
  endTick,
  inputs,
  random,
  tickHashes,
  initialState,
  finalState,
}) {
  return {
    schema: SCHEMA,
    seed: seed >>> 0,
    tickRate: TICK_RATE,
    endTick,
    initial: cloneState(initialState),
    inputs: inputs.map((input) => ({ ...input })),
    random,
    tickHashes,
    finalHash: hashState(finalState),
    finalState: cloneState(finalState),
    stats: {
      ticks: endTick,
      inputEvents: inputs.length,
      randomValues: random.length * 3,
      tickHashes: tickHashes.length,
    },
  };
}

export function recordDeterministicRun({
  seed,
  durationTicks = DEFAULT_DURATION_TICKS,
  inputs = [],
} = {}) {
  const random = new SeededRandom(seed);
  const state = createInitialState();
  const initialState = cloneState(state);
  const randomRows = [];
  const tickHashes = [hashState(state)];
  const sortedInputs = sortInputs(inputs);
  let inputIndex = 0;

  for (let tick = 0; tick < durationTicks; tick += 1) {
    while (
      inputIndex < sortedInputs.length &&
      sortedInputs[inputIndex].tick === tick
    ) {
      applyInputEvent(state, sortedInputs[inputIndex]);
      inputIndex += 1;
    }
    const values = nextRandomBundle(random);
    randomRows.push({ tick, values });
    advanceTick(state, values);
    tickHashes.push(hashState(state));
    if (state.status !== "running") {
      break;
    }
  }

  if (state.status === "running" && state.tick >= durationTicks) {
    state.status = "ended";
    state.reason = "duration";
    tickHashes[tickHashes.length - 1] = hashState(state);
  }
  const endTick = state.tick;
  const usedInputs = sortedInputs.filter((input) => input.tick < endTick);
  return makeRecording({
    seed,
    endTick,
    inputs: usedInputs,
    random: randomRows,
    tickHashes,
    initialState,
    finalState: state,
  });
}

export function recordPolicyRun({
  seed,
  durationTicks = DEFAULT_DURATION_TICKS,
  decide,
  inject = null,
}) {
  const random = new SeededRandom(seed);
  const state = createInitialState();
  const initialState = cloneState(state);
  const randomRows = [];
  const inputs = [];
  const tickHashes = [hashState(state)];
  let sequence = 0;

  const emit = (action, phase) => {
    const event = { tick: state.tick, seq: sequence, action, phase };
    sequence += 1;
    inputs.push(event);
    applyInputEvent(state, event);
  };

  for (let tick = 0; tick < durationTicks; tick += 1) {
    if (inject) {
      inject(state, tick, emit);
    }
    const desired = decide(state, tick) ?? {};
    for (const action of ["left", "right"]) {
      const wanted = Boolean(desired[action]);
      if (wanted !== state.held[action]) {
        emit(action, wanted ? "down" : "up");
      }
    }
    if (desired.dash && state.dashCooldown === 0) {
      emit("dash", "down");
    }
    const values = nextRandomBundle(random);
    randomRows.push({ tick, values });
    advanceTick(state, values);
    tickHashes.push(hashState(state));
    if (state.status !== "running") {
      break;
    }
  }

  if (state.status === "running" && state.tick >= durationTicks) {
    state.status = "ended";
    state.reason = "duration";
    tickHashes[tickHashes.length - 1] = hashState(state);
  }
  return makeRecording({
    seed,
    endTick: state.tick,
    inputs,
    random: randomRows,
    tickHashes,
    initialState,
    finalState: state,
  });
}

function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function replayFatal(message, code = "E_RECORDING_SHAPE") {
  return {
    ok: false,
    fatal: true,
    status: "invalid",
    errors: [errorEntry(code, message, null, "导入原始 JSON 录包后重试。")],
    firstDivergence: null,
    firstRandomDivergence: null,
    firstStateDivergence: null,
    finalState: null,
    finalHash: null,
    expectedFinalHash: null,
    states: [],
    timeline: ["error"],
    elapsedMs: 0,
    stats: {
      ticks: 0,
      inputsApplied: 0,
      inputsRejected: 0,
      randomChecks: 0,
      stateChecks: 0,
      states: 0,
      timelineSegments: 1,
      errors: 1,
    },
  };
}

export function replayRecording(recording, options = {}) {
  const started = now();
  const collectStates = options.collectStates !== false;
  if (!recording || typeof recording !== "object" || Array.isArray(recording)) {
    return replayFatal("录包根节点不是对象");
  }

  const errors = [];
  const fatalError = (code, message, tick = null, recovery = "") => {
    errors.push(errorEntry(code, message, tick, recovery));
  };

  if (recording.schema !== SCHEMA) {
    fatalError(
      "E_SCHEMA",
      `录包 schema=${String(recording.schema)}，期望 ${SCHEMA}`,
      null,
      "保留原始录包；使用匹配版本的播放器回放。",
    );
  }
  if (
    !Number.isInteger(recording.seed) ||
    recording.seed < 0 ||
    recording.seed > 0xffffffff
  ) {
    fatalError(
      "E_SEED",
      "seed 必须是 0..4294967295 的整数",
      null,
      "使用原始 32 位无符号 seed；修复后重新回放。",
    );
  }
  if (
    !Number.isInteger(recording.endTick) ||
    recording.endTick < 0 ||
    recording.endTick > MAX_DURATION_TICKS
  ) {
    return replayFatal(
      `endTick=${String(recording.endTick)} 超出 0..${MAX_DURATION_TICKS}`,
      "E_END_TICK",
    );
  }
  let initial = createInitialState();
  if (!isValidInitialState(recording.initial)) {
    fatalError(
      "E_INITIAL_SHAPE",
      "initial 状态结构不完整或字段非法",
      null,
      "已用安全初始状态继续取证；结果会失败，且不会伪造通过。",
    );
  } else {
    initial = cloneState(recording.initial);
  }
  if (!Array.isArray(recording.inputs)) {
    fatalError(
      "E_INPUTS",
      "inputs 不是数组",
      0,
      "保留错误并重新导出；不会把缺失输入当作空输入成功。",
    );
  } else if (recording.inputs.length > 10000) {
    fatalError(
      "E_INPUT_LIMIT",
      `inputs 数量 ${recording.inputs.length} 超过取证上限 10000`,
      0,
      "保留原始文件；只对前 10000 条取证，结果将标记失败。",
    );
  }
  if (!Array.isArray(recording.random)) {
    fatalError(
      "E_RANDOM_ROWS",
      "random 不是数组",
      null,
      "使用 seed 重建随机数，或将原始录制重新导出。",
    );
  } else if (recording.random.length > MAX_DURATION_TICKS + 1) {
    fatalError(
      "E_RANDOM_LIMIT",
      `random 行数 ${recording.random.length} 超过取证上限`,
      0,
      "保留原始文件；只对上限内的随机行取证，结果将标记失败。",
    );
  }
  if (!Array.isArray(recording.tickHashes)) {
    fatalError(
      "E_HASHES",
      "tickHashes 不是数组",
      null,
      "校验需要逐 tick 哈希；请不要裁剪导出字段。",
    );
  }
  if (typeof recording.finalHash !== "string") {
    fatalError(
      "E_FINAL_HASH",
      "finalHash 缺失或类型错误",
      recording.endTick,
      "重新导出完整录包。",
    );
  }
  if (!recording.finalState || typeof recording.finalState !== "object") {
    fatalError(
      "E_FINAL_STATE",
      "finalState 缺失",
      recording.endTick,
      "导出原始终态；不能只凭 finalHash 伪造完整录包。",
    );
  }

  const state = initial;
  const sourceRandom = new SeededRandom(Number(recording.seed) >>> 0);
  const endTick = recording.endTick;
  const inputErrors = [];
  const rawInputs = Array.isArray(recording.inputs)
    ? recording.inputs.slice(0, 10000)
    : [];
  const validInputs = [];
  const seenSequences = new Set();

  rawInputs.forEach((raw, index) => {
    const validation = validateInputEvent(raw, index, endTick);
    inputErrors.push(...validation.errors);
    if (Number.isInteger(raw?.seq)) {
      if (seenSequences.has(raw.seq)) {
        inputErrors.push(
          errorEntry(
            "E_INPUT_SEQ_DUP",
            `输入 seq=${raw.seq} 重复`,
            raw.tick ?? null,
            "重新编号输入事件；重复项不会被静默合并。",
          ),
        );
      }
      seenSequences.add(raw.seq);
    }
    if (validation.event) {
      validInputs.push(validation.event);
    }
  });
  errors.push(...inputErrors);
  validInputs.sort((a, b) => a.tick - b.tick || a.seq - b.seq);

  const randomRows = new Map();
  if (Array.isArray(recording.random)) {
    if (recording.random.length !== endTick) {
      errors.push(
        errorEntry(
          "E_RANDOM_COUNT",
          `random 行数 ${recording.random.length} 与 endTick=${endTick} 不一致`,
          null,
          "使用安全恢复会以 seed 生成缺失的随机数，但校验仍标记失败。",
        ),
      );
    }
    recording.random.slice(0, MAX_DURATION_TICKS + 1).forEach((row, index) => {
      if (!row || !Number.isInteger(row.tick)) {
        errors.push(
          errorEntry(
            "E_RANDOM_ROW",
            `随机数行 #${index} 缺少 tick`,
            null,
            "删除损坏行或从 seed 重建。",
          ),
        );
        return;
      }
      if (randomRows.has(row.tick)) {
        errors.push(
          errorEntry(
            "E_RANDOM_TICK_DUP",
            `随机数 tick=${row.tick} 重复`,
            row.tick,
            "每个 tick 只能有一组三项随机数。",
          ),
        );
      }
      randomRows.set(row.tick, row);
    });
  }

  const tickHashes = Array.isArray(recording.tickHashes)
    ? recording.tickHashes
    : [];
  if (tickHashes.length !== endTick + 1) {
    errors.push(
      errorEntry(
        "E_HASH_COUNT",
        `tickHashes 长度 ${tickHashes.length}，期望 ${endTick + 1}`,
        null,
        "保留原始错误；重新导出逐 tick 哈希。",
      ),
    );
  }

  const timeline = new Array(endTick + 1).fill("ok");
  for (const inputError of inputErrors) {
    if (Number.isInteger(inputError.tick)) {
      const safeTick = Math.max(0, Math.min(endTick, inputError.tick));
      timeline[safeTick] = "error";
    }
  }
  if (Array.isArray(recording.random) && Array.isArray(recording.tickHashes)) {
    if (randomRows.size !== endTick || tickHashes.length !== endTick + 1) {
      timeline[0] = "error";
    }
  }

  let firstRandomDivergence = null;
  let firstStateDivergence = null;
  let applied = 0;
  let rejected = rawInputs.length - validInputs.length;
  if (Array.isArray(recording.inputs)) {
    rejected += Math.max(0, recording.inputs.length - rawInputs.length);
  }
  let randomChecks = 0;
  let stateChecks = 0;
  let inertInputs = 0;
  let inputIndex = 0;
  const states = collectStates ? [cloneState(initial)] : [];
  const initialHash = hashState(initial);
  stateChecks += 1;
  if (tickHashes[0] !== initialHash && !firstStateDivergence) {
    firstStateDivergence = {
      tick: 0,
      kind: "state",
      expectedHash: tickHashes[0] ?? null,
      actualHash: initialHash,
    };
    timeline[0] = "mismatch";
  }

  for (let tick = 0; tick < endTick; tick += 1) {
    const expectedValues = nextRandomBundle(sourceRandom);
    const recordedRow = randomRows.get(tick);
    const recordedValues = recordedRow?.values;
    randomChecks += 3;
    const randomIsValid =
      Array.isArray(recordedValues) &&
      recordedValues.length === 3 &&
      recordedValues.every(
        (value) => Number.isInteger(value) && value >= 0 && value < 0x100000000,
      );
    let actualValues = recordedValues;
    if (!randomIsValid) {
      actualValues = expectedValues;
      errors.push(
        errorEntry(
          "E_RANDOM_VALUE",
          `tick=${tick} 的随机数缺失或非法`,
          tick,
          "已用 seed 期望值安全恢复该 tick；结果不会被标记为校验成功。",
        ),
      );
      timeline[tick] = "error";
    } else {
      const differs = recordedValues.some(
        (value, index) => value !== expectedValues[index],
      );
      if (differs && !firstRandomDivergence) {
        firstRandomDivergence = {
          tick,
          kind: "random",
          expectedValues,
          actualValues: [...recordedValues],
        };
      }
      if (differs && timeline[tick] !== "error") {
        timeline[tick] = "random";
      }
    }

    while (
      inputIndex < validInputs.length &&
      validInputs[inputIndex].tick === tick
    ) {
      applyInputEvent(state, validInputs[inputIndex]);
      applied += 1;
      inputIndex += 1;
    }
    while (
      inputIndex < validInputs.length &&
      validInputs[inputIndex].tick < tick
    ) {
      rejected += 1;
      inputIndex += 1;
    }

    advanceTick(state, actualValues);
    if (tick + 1 === endTick && state.status === "running") {
      state.status = "ended";
      state.reason = "duration";
    }
    const actualHash = hashState(state);
    const expectedHash = tickHashes[tick + 1];
    stateChecks += 1;
    if (actualHash !== expectedHash) {
      if (!firstStateDivergence) {
        firstStateDivergence = {
          tick: tick + 1,
          kind: "state",
          expectedHash: expectedHash ?? null,
          actualHash,
        };
      }
      if (timeline[tick + 1] !== "random" && timeline[tick + 1] !== "error") {
        timeline[tick + 1] = "mismatch";
      }
    }
    if (collectStates) {
      states.push(cloneState(state));
    }
    if (state.status !== "running") {
      break;
    }
  }
  inertInputs += Math.max(0, validInputs.length - inputIndex);

  const finalHash = hashState(state);
  const expectedFinalHash =
    typeof recording.finalHash === "string" ? recording.finalHash : null;
  if (finalHash !== expectedFinalHash && !firstStateDivergence) {
    firstStateDivergence = {
      tick: endTick,
      kind: "final-hash",
      expectedHash: expectedFinalHash,
      actualHash: finalHash,
    };
    timeline[endTick] = "mismatch";
  }
  if (recording.finalState && typeof recording.finalState === "object") {
    let recordedFinalHash = null;
    try {
      recordedFinalHash = hashState(recording.finalState);
    } catch {
      recordedFinalHash = null;
    }
    if (recordedFinalHash === null) {
      errors.push(
        errorEntry(
          "E_FINAL_STATE_SHAPE",
          "finalState 无法计算哈希",
          endTick,
          "保留原始错误；修复终态结构后重新导出。",
        ),
      );
    } else if (recordedFinalHash !== expectedFinalHash) {
      errors.push(
        errorEntry(
          "E_FINAL_STATE_HASH",
          "finalState 与 finalHash 不一致",
          endTick,
          "导出内容被截断或改写；请使用原始录包。",
        ),
      );
    }
  }

  const firstDivergence =
    firstRandomDivergence && firstStateDivergence
      ? firstRandomDivergence.tick <= firstStateDivergence.tick
        ? firstRandomDivergence
        : firstStateDivergence
      : firstRandomDivergence ?? firstStateDivergence;
  const ok =
    errors.length === 0 &&
    !firstDivergence &&
    finalHash === expectedFinalHash &&
    state.tick === endTick;

  const elapsedMs = now() - started;
  return {
    ok,
    fatal: false,
    status: ok ? "verified" : "failed",
    replayFrom: "initial",
    errors,
    firstDivergence,
    firstRandomDivergence,
    firstStateDivergence,
    finalState: cloneState(state),
    finalHash,
    expectedFinalHash,
    states,
    timeline,
    elapsedMs,
    stats: {
      ticks: state.tick,
      inputsApplied: applied,
      inputsRejected: rejected,
      inertInputs,
      randomChecks,
      stateChecks,
      states: states.length,
      timelineSegments: timeline.length,
      errors: errors.length,
    },
  };
}

export function safeSerialize(value) {
  return JSON.stringify(value, null, 2);
}
