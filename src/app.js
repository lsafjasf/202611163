import {
  DEFAULT_DURATION_TICKS,
  SCHEMA,
  TICK_RATE,
  actionForKey,
  advanceTick,
  applyInputEvent,
  cloneState,
  createInitialState,
  hashState,
  nextRandomBundle,
  replayRecording,
  safeSerialize,
  SeededRandom,
} from "./engine.js";
import { InputAudio } from "./audio.js";
import { createRenderer, RENDER_PROFILES } from "./renderer.js";
import { drawTimeline, xToTick } from "./timeline.js";
import { buildScenarios } from "./scenarios.js";
import { runScenarioAudit } from "./benchmark.js";

const $ = (selector) => document.querySelector(selector);
const els = {
  modePill: $("#mode-pill"),
  modeText: $("#mode-text"),
  elapsed: $("#elapsed-value"),
  quality: $("#quality-label"),
  audioToggle: $("#audio-toggle"),
  gameCanvas: $("#game-canvas"),
  timelineCanvas: $("#timeline-canvas"),
  score: $("#hud-score"),
  lives: $("#hud-lives"),
  combo: $("#hud-combo"),
  hudTick: $("#hud-tick"),
  playToggle: $("#play-toggle"),
  step: $("#step-button"),
  replay: $("#replay-button"),
  reset: $("#reset-button"),
  exportButton: $("#export-button"),
  qualityToggle: $("#quality-toggle"),
  timelineReadout: $("#timeline-readout"),
  fps: $("#metric-fps"),
  sim: $("#metric-sim"),
  draws: $("#metric-draws"),
  entities: $("#metric-entities"),
  heap: $("#metric-heap"),
  audio: $("#metric-audio"),
  audioState: $("#audio-state"),
  healthTag: $("#health-tag"),
  resourceStrip: $("#resource-strip"),
  verdictBadge: $("#verdict-badge"),
  finalHash: $("#final-hash"),
  expectedHash: $("#expected-hash"),
  firstDivergence: $("#first-divergence"),
  replayCost: $("#replay-cost"),
  verdictDetail: $("#verdict-detail"),
  recovery: $("#recovery-copy"),
  errorLog: $("#error-log"),
  clearErrors: $("#clear-errors"),
  auditBody: $("#audit-body"),
  auditSummary: $("#audit-summary"),
  auditRepro: $("#audit-repro"),
  scenarioStrip: $("#scenario-strip"),
  scenarioNote: $("#scenario-note"),
};

const MODE_LABELS = Object.freeze({
  idle: "待机",
  running: "实机运行",
  paused: "已暂停",
  verifying: "回放校验中",
  verified: "校验通过",
  diverged: "检测到分叉",
  review: "重放/检视",
  recovery: "错误恢复",
});

function randomSeed() {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return values[0] >>> 0;
  }
  return (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
}

function formatClock(seconds) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remainder = safe - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${remainder
    .toFixed(2)
    .padStart(5, "0")}`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) {
    return "n/a";
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function clockStamp() {
  return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

function truncateHash(hash) {
  return hash ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : "—";
}

function tickLabel(tick) {
  if (!Number.isInteger(tick)) {
    return "T+—";
  }
  return tick < 0 ? `T${tick}` : `T+${tick}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const session = {
  mode: "idle",
  quality: "lean",
  seed: randomSeed(),
  state: createInitialState(),
  initialState: createInitialState(),
  states: [],
  inputs: [],
  randomRows: [],
  tickHashes: [],
  randomSource: null,
  inputCursor: 0,
  inputSequence: 0,
  recording: null,
  validation: null,
  reviewTick: null,
  playback: false,
  accumulator: 0,
  lastFrameTime: 0,
  lastUiTime: 0,
  startedAt: performance.now(),
  wallMs: 0,
  fpsSamples: [],
  lastSimMs: 0,
  frameMetrics: null,
  errors: [],
  errorKeys: new Set(),
  physicalHeld: new Set(),
  currentScenario: null,
  scenarioCache: null,
  injectedFault: false,
};

let renderer = createRenderer(session.quality);
let canvasDpr = 1;

const audio = new InputAudio({
  onError: (error) => {
    logError(error, "audio");
    setRecovery(
      "音频反馈不可用，已继续静音运行；录放与校验不受影响。点击“声音”可重试。",
    );
  },
});

function setMode(mode, recoveryText = null, tone = "neutral") {
  session.mode = mode;
  els.modePill.dataset.mode = mode;
  els.modeText.textContent = MODE_LABELS[mode] ?? mode;
  if (recoveryText) {
    setRecovery(recoveryText, tone);
  }
  updateControlLabels();
}

function setRecovery(text, tone = "neutral") {
  els.recovery.textContent = text;
  els.recovery.dataset.tone = tone;
}

function logError(rawError, source = "APP") {
  const entry = {
    time: clockStamp(),
    source,
    tick: Number.isInteger(rawError?.tick) ? rawError.tick : null,
    code: rawError?.code ?? "E_UNKNOWN",
    message: rawError?.message ?? String(rawError),
    recovery:
      rawError?.recovery ??
      "保留当前诊断信息，导出后重置；不要忽略异常继续写入。",
    severity: rawError?.severity ?? "error",
  };
  const key = `${source}:${entry.code}:${entry.tick}:${entry.message}`;
  if (session.errorKeys.has(key)) {
    return;
  }
  session.errorKeys.add(key);
  session.errors.push(entry);
  if (session.errors.length > 80) {
    session.errors.shift();
  }
  renderErrorLog();
}

function renderErrorLog() {
  if (session.errors.length === 0) {
    els.errorLog.innerHTML = '<div class="empty-log">尚无异常记录</div>';
  } else {
    els.errorLog.innerHTML = session.errors
      .slice()
      .reverse()
      .map(
        (entry) => `
          <div class="log-entry">
            <div class="log-meta">
              <span>${escapeHtml(entry.code)}</span>
              <span>${escapeHtml(entry.time)}${entry.tick === null ? "" : ` / ${tickLabel(entry.tick)}`}</span>
            </div>
            <div class="log-message">${escapeHtml(entry.message)}</div>
            <div class="log-recovery">建议：${escapeHtml(entry.recovery)}</div>
          </div>
        `,
      )
      .join("");
  }
  const hasErrors = session.errors.length > 0;
  els.healthTag.textContent = hasErrors ? `${session.errors.length} ERR` : "NOMINAL";
  els.healthTag.dataset.health = hasErrors ? "error" : "ok";
}

function handleRuntimeError(error, context = "runtime") {
  const normalized = {
    code: error?.code ?? `E_${String(context).toUpperCase()}`,
    message: error?.message ?? String(error),
    tick: session.state?.tick ?? null,
    recovery:
      "已暂停并保留当前状态。请导出诊断，随后重置；不要通过隐藏异常继续。",
  };
  logError(normalized, context);
  session.playback = false;
  session.accumulator = 0;
  audio.reset();
  setMode("recovery", normalized.recovery, "error");
  updateInterface(true);
}

function configureCanvas(canvas, logicalWidth, logicalHeight) {
  canvasDpr = Math.min(globalThis.devicePixelRatio || 1, 2);
  const width = Math.round(logicalWidth * canvasDpr);
  const height = Math.round(logicalHeight * canvasDpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d");
  context.setTransform(canvasDpr, 0, 0, canvasDpr, 0, 0);
  return context;
}

function currentTimelineEnd() {
  if (session.recording) {
    return Math.max(1, session.recording.endTick);
  }
  return DEFAULT_DURATION_TICKS;
}

function displayCursor() {
  if (session.reviewTick !== null) {
    return session.reviewTick;
  }
  return session.state.tick;
}

function displayState() {
  if (session.reviewTick === null) {
    return session.state;
  }
  const source = session.validation?.states ?? session.states;
  const state = source[session.reviewTick];
  return state ?? session.state;
}

function drawGameFrame() {
  const context = configureCanvas(els.gameCanvas, 960, 540);
  const state = displayState();
  renderer.resetMetrics();
  renderer.render({
    ctx: context,
    width: 960,
    height: 540,
    state,
    tick: state.tick,
    validation: session.validation,
    mode: session.mode,
  });
  session.frameMetrics = { ...renderer.metrics };
}

function drawTimelineFrame() {
  const context = configureCanvas(els.timelineCanvas, 1000, 88);
  const endTick = currentTimelineEnd();
  const inputs = session.recording?.inputs ?? session.inputs;
  const timeline =
    session.validation?.timeline ??
    new Array(Math.max(1, session.state.tick + 1)).fill("ok");
  drawTimeline(context, {
    width: 1000,
    height: 88,
    endTick,
    timeline,
    inputs,
    cursor: Math.min(displayCursor(), endTick),
    randomDivergence: session.validation?.firstRandomDivergence ?? null,
    stateDivergence: session.validation?.firstStateDivergence ?? null,
    errors: session.errors,
  });
}

function updateControlLabels() {
  let label = "开始游戏";
  if (session.mode === "running") {
    label = "暂停";
  } else if (session.mode === "paused") {
    label = "继续游戏";
  } else if (session.mode === "review") {
    label = session.playback ? "暂停重放" : "继续重放";
  } else if (session.mode === "verified" || session.mode === "diverged") {
    label = "开始新局";
  } else if (session.mode === "recovery") {
    label = "重置并恢复";
  }
  els.playToggle.textContent = label;
  els.playToggle.dataset.state = session.mode === "running" ? "pause" : "play";
  els.step.disabled = !["idle", "paused", "review", "verified", "diverged"].includes(
    session.mode,
  );
  els.replay.disabled = !session.recording && !session.validation;
  els.exportButton.disabled = !session.recording;
}

function updateInterface(force = false) {
  const now = performance.now();
  if (!force && now - session.lastUiTime < 80) {
    return;
  }
  session.lastUiTime = now;
  session.wallMs = now - session.startedAt;
  const state = displayState();
  const cursor = displayCursor();
  const validation = session.validation;
  const frame = session.frameMetrics;

  els.elapsed.textContent = formatClock(cursor / TICK_RATE);
  els.quality.textContent = RENDER_PROFILES[session.quality].label;
  els.score.textContent = String(state.score).padStart(4, "0");
  els.lives.textContent = `${"◆ ".repeat(Math.max(0, state.lives))}${"◇ ".repeat(
    Math.max(0, 3 - state.lives),
  )}`.trim();
  els.combo.textContent = `×${state.combo}`;
  els.hudTick.textContent = String(cursor).padStart(6, "0");

  const averageFrameMs =
    session.fpsSamples.length > 0
      ? session.fpsSamples.reduce((sum, value) => sum + value, 0) /
        session.fpsSamples.length
      : 0;
  els.fps.textContent =
    averageFrameMs > 0 ? String(Math.round(1000 / averageFrameMs)) : "--";
  els.sim.innerHTML = `${session.lastSimMs.toFixed(2)}<em>ms</em>`;
  els.draws.textContent = frame ? String(Math.round(frame.drawCalls)) : "--";
  els.entities.textContent = frame
    ? `${state.entities.length} / ${frame.peakLiveShapes}`
    : String(state.entities.length);
  const heapBytes = performance.memory?.usedJSHeapSize;
  els.heap.textContent = formatBytes(heapBytes);

  const audioSnapshot = audio.snapshot();
  els.audio.textContent = String(audioSnapshot.activeNodes);
  els.audioState.textContent = `${audioSnapshot.state} · peak ${audioSnapshot.peakNodes}`;

  els.resourceStrip.innerHTML = [
    `输入 ${session.inputs.length}`,
    `随机行 ${session.randomRows.length}`,
    `哈希 ${session.tickHashes.length}`,
    `快照 ${(validation?.states ?? session.states).length}`,
  ]
    .map((text) => `<span>${text}</span>`)
    .join("");

  const timelineInputs = session.recording?.inputs ?? session.inputs;
  els.timelineReadout.textContent = `T+${cursor} / 输入 ${timelineInputs.length} / 哈希 ${session.tickHashes.length}`;

  if (validation) {
    const status = validation.status;
    els.verdictBadge.dataset.status = status;
    els.verdictBadge.textContent =
      status === "verified" ? "校验通过" : status === "invalid" ? "录包非法" : "检测到分叉";
    els.finalHash.textContent = truncateHash(validation.finalHash);
    els.finalHash.title = validation.finalHash ?? "";
    els.expectedHash.textContent = truncateHash(validation.expectedFinalHash);
    els.expectedHash.title = validation.expectedFinalHash ?? "";
    els.firstDivergence.textContent = validation.firstDivergence
      ? `${tickLabel(validation.firstDivergence.tick)} · ${validation.firstDivergence.kind.toUpperCase()}`
      : "无分叉";
    els.firstDivergence.title = validation.firstStateDivergence
      ? `expected ${validation.firstStateDivergence.expectedHash} / actual ${validation.firstStateDivergence.actualHash}`
      : "";
    els.replayCost.textContent = `${validation.elapsedMs.toFixed(2)} ms · ${validation.stats.states} 快照`;
    els.verdictDetail.textContent = validation.ok
      ? `从 initial 重放 ${validation.stats.ticks} tick；输入 ${validation.stats.inputsApplied} 条，${validation.stats.randomChecks} 个随机值全部匹配。`
      : `回放失败并保留 ${validation.errors.length} 条异常。首个差异：${
          validation.firstDivergence
            ? `${tickLabel(validation.firstDivergence.tick)} ${validation.firstDivergence.kind}`
            : "结构校验"
        }。`;
  } else {
    els.verdictBadge.dataset.status = "idle";
    els.verdictBadge.textContent = "待校验";
    els.finalHash.textContent = "—";
    els.finalHash.title = "";
    els.expectedHash.textContent = "—";
    els.expectedHash.title = "";
    els.firstDivergence.textContent = "—";
    els.firstDivergence.title = "";
    els.replayCost.textContent = "—";
    els.verdictDetail.textContent =
      "完成一局后自动从初始状态重放，并逐步比对状态哈希。";
  }
  updateControlLabels();
}

function metricsSnapshot() {
  const state = displayState();
  return {
    mode: session.mode,
    cursor: displayCursor(),
    simulatedMs: Math.round((displayCursor() / TICK_RATE) * 1000),
    wallMs: Math.round(performance.now() - session.startedAt),
    quality: session.quality,
    validation: session.validation
      ? {
          ok: session.validation.ok,
          status: session.validation.status,
          finalHash: session.validation.finalHash,
          expectedFinalHash: session.validation.expectedFinalHash,
          firstDivergence: session.validation.firstDivergence,
          errorCount: session.validation.errors.length,
          elapsedMs: Number(session.validation.elapsedMs.toFixed(3)),
        }
      : null,
    errors: session.errors.map((entry) => ({ ...entry })),
    resources: {
      entities: state.entities.length,
      drawCalls: Math.round(session.frameMetrics?.drawCalls ?? 0),
      peakLiveShapes: session.frameMetrics?.peakLiveShapes ?? 0,
      inputEvents: session.inputs.length,
      randomRows: session.randomRows.length,
      tickHashes: session.tickHashes.length,
      snapshots: (session.validation?.states ?? session.states).length,
      audioNodes: audio.snapshot().activeNodes,
      heapBytes: performance.memory?.usedJSHeapSize ?? null,
    },
  };
}

function resetSession() {
  session.seed = randomSeed();
  session.state = createInitialState();
  session.initialState = cloneState(session.state);
  session.states = [cloneState(session.state)];
  session.inputs = [];
  session.randomRows = [];
  session.tickHashes = [hashState(session.state)];
  session.randomSource = new SeededRandom(session.seed);
  session.inputCursor = 0;
  session.inputSequence = 0;
  session.recording = null;
  session.validation = null;
  session.reviewTick = null;
  session.playback = false;
  session.accumulator = 0;
  session.startedAt = performance.now();
  session.wallMs = 0;
  session.lastSimMs = 0;
  session.currentScenario = null;
  session.physicalHeld.clear();
  document.querySelectorAll(".scenario-chip").forEach((chip) => {
    delete chip.dataset.active;
  });
  els.scenarioNote.textContent =
    "点击场景可在当前画布中逐 tick 检视，不改变已有录包。";
  setMode("idle", "按“开始游戏”，使用 ← → 移动、空格 Dash；结束后将自动回放并校验。");
  updateInterface(true);
}

function startNewRun() {
  resetSession();
  setMode(
    "running",
    "实机记录中：每个 tick 的输入、随机数与状态哈希都会进入当前录包。",
    "neutral",
  );
  audio.ensureContext().catch((error) => {
    logError(
      {
        code: "E_AUDIO",
        message: error.message,
        tick: 0,
        recovery: "静音继续游戏；点“声音”可重试，录放不依赖音频。",
      },
      "audio",
    );
  });
  updateInterface(true);
}

function makeRecordingFromSession() {
  session.recording = {
    schema: SCHEMA,
    seed: session.seed >>> 0,
    tickRate: TICK_RATE,
    endTick: session.state.tick,
    initial: cloneState(session.initialState),
    inputs: session.inputs.map((input) => ({ ...input })),
    random: session.randomRows.map((row) => ({
      tick: row.tick,
      values: [...row.values],
    })),
    tickHashes: [...session.tickHashes],
    finalHash: hashState(session.state),
    finalState: cloneState(session.state),
    stats: {
      ticks: session.state.tick,
      inputEvents: session.inputs.length,
      randomValues: session.randomRows.length * 3,
      tickHashes: session.tickHashes.length,
    },
  };
  return session.recording;
}

function completeRun() {
  if (!session.recording) {
    if (session.state.status === "running") {
      session.state.status = "ended";
      session.state.reason = "duration";
      session.tickHashes[session.tickHashes.length - 1] = hashState(
        session.state,
      );
      session.states[session.states.length - 1] = cloneState(session.state);
    }
    const recording = makeRecordingFromSession();
    setMode("verifying", "已结束实机运行，正在从 initial 逐 tick 回放。");
    try {
      session.validation = replayRecording(recording);
    } catch (error) {
      handleRuntimeError(error, "replay");
      return;
    }
    for (const error of session.validation.errors) {
      logError(error, "REPLAY");
    }
    session.reviewTick = session.validation.stats.ticks;
    session.playback = false;
    if (session.validation.ok) {
      setMode(
        "verified",
        "回放校验通过。可拖动时间轴检视，或导出录包做离线复现。",
        "ok",
      );
    } else {
      setMode(
        "diverged",
        session.validation.firstDivergence
          ? `首次分叉在 T+${session.validation.firstDivergence.tick}。保留录包并导出，先检查该 tick 前的输入与随机行。`
          : "录包结构校验失败。异常已保留，请导出后修复或重新录制。",
        "error",
      );
    }
  }
  updateInterface(true);
}

function stepLiveTick() {
  if (session.state.tick >= DEFAULT_DURATION_TICKS) {
    completeRun();
    return;
  }
  const started = performance.now();
  while (
    session.inputCursor < session.inputs.length &&
    session.inputs[session.inputCursor].tick <= session.state.tick
  ) {
    applyInputEvent(session.state, session.inputs[session.inputCursor]);
    session.inputCursor += 1;
  }
  const values = nextRandomBundle(session.randomSource);
  session.randomRows.push({ tick: session.state.tick, values });
  advanceTick(session.state, values);
  session.tickHashes.push(hashState(session.state));
  session.states.push(cloneState(session.state));
  session.lastSimMs = performance.now() - started;
  if (
    session.state.status !== "running" ||
    session.state.tick >= DEFAULT_DURATION_TICKS
  ) {
    completeRun();
  }
}

function togglePlay() {
  if (session.mode === "running") {
    session.accumulator = 0;
    session.playback = false;
    setMode(
      "paused",
      "已暂停。按“单步 +1”检查单个 tick，或继续游戏。",
    );
  } else if (session.mode === "paused") {
    session.reviewTick = null;
    session.accumulator = 0;
    setMode("running");
  } else if (session.mode === "review") {
    if (session.playback) {
      session.playback = false;
      setRecovery("重放已暂停。可单步，或沿时间轴选择任意 tick。");
    } else {
      if (session.reviewTick === null || session.reviewTick >= currentTimelineEnd()) {
        session.reviewTick = 0;
      }
      session.accumulator = 0;
      session.playback = true;
      setRecovery("正在重放录包；校验结果不会因播放速度变化。");
    }
    updateControlLabels();
  } else if (session.mode === "recovery") {
    startNewRun();
  } else {
    startNewRun();
  }
  updateInterface(true);
}

function stepAction() {
  if (session.recording) {
    const endTick = session.recording.endTick;
    const base = session.reviewTick ?? 0;
    if (base >= endTick && session.mode !== "review") {
      updateInterface(true);
      return;
    }
    session.reviewTick = Math.min(endTick, base + 1);
    session.playback = false;
    if (session.mode !== "review") {
      session.mode = "review";
      els.modePill.dataset.mode = "review";
      els.modeText.textContent = "逐 tick 检视";
    }
  } else if (session.mode === "idle") {
    startNewRun();
    session.reviewTick = null;
    session.playback = false;
    setMode("paused", "单步模式：每次推进 1 tick，输入仍会写入录包。");
    stepLiveTick();
  } else if (session.mode === "paused" || session.mode === "running") {
    if (session.mode === "running") {
      session.playback = false;
      setMode("paused");
    }
    session.reviewTick = null;
    stepLiveTick();
  }
  updateInterface(true);
}

function startReplay() {
  if (!session.recording && !session.validation) {
    setRecovery(
      "当前没有可重放录包。请先完成一局，或从下方加载正常/边界/损坏场景。",
      "error",
    );
    return;
  }
  if (!session.validation) {
    session.validation = replayRecording(session.recording);
    for (const error of session.validation.errors) {
      logError(error, "REPLAY");
    }
  }
  if (session.validation.fatal || session.validation.states.length === 0) {
    setRecovery("录包无法构建回放快照。请导出原始 JSON 并检查 schema。", "error");
    return;
  }
  session.reviewTick = 0;
  session.playback = true;
  session.accumulator = 0;
  setMode(
    "review",
    "重放从 initial 开始；拖动时间轴或单步不会改写录包。",
  );
  updateInterface(true);
}

function recordInput(action, phase, source = "KEY") {
  const canRecord =
    session.mode === "running" ||
    (session.mode === "paused" && !session.recording);
  if (!canRecord) {
    return false;
  }
  const input = {
    tick: session.state.tick,
    seq: session.inputSequence,
    action,
    phase,
    source,
  };
  session.inputSequence += 1;
  session.inputs.push(input);
  if (phase === "down") {
    audio.play(action);
  }
  return true;
}

function onKeyDown(event) {
  if (event.target instanceof Element && event.target.closest("button, input, select, textarea, a")) {
    return;
  }
  if (event.code === "KeyP") {
    event.preventDefault();
    if (["running", "paused", "review"].includes(session.mode)) {
      togglePlay();
    }
    return;
  }
  if (event.code === "ArrowUp") {
    event.preventDefault();
    if (!event.repeat) {
      stepAction();
    }
    return;
  }
  const action = actionForKey(event.code);
  if (!action) {
    return;
  }
  event.preventDefault();
  if (event.repeat) {
    return;
  }
  if (
    session.mode === "running" ||
    (session.mode === "paused" && !session.recording)
  ) {
    session.physicalHeld.add(action);
    recordInput(action, "down");
  }
}

function onKeyUp(event) {
  const action = actionForKey(event.code);
  if (!action) {
    return;
  }
  event.preventDefault();
  if (
    session.mode === "running" ||
    (session.mode === "paused" && !session.recording)
  ) {
    session.physicalHeld.delete(action);
    recordInput(action, "up");
  }
}

function releaseHeldInputs() {
  if (session.mode === "running" || session.mode === "paused") {
    for (const action of session.physicalHeld) {
      if (action !== "dash") {
        recordInput(action, "up", "BLUR");
      }
    }
    if (session.mode === "running") {
      session.accumulator = 0;
      setMode("paused", "窗口失焦，已自动暂停并释放按住的方向键。");
    }
  }
  session.physicalHeld.clear();
}

function seekTimeline(clientX) {
  if (session.mode === "verifying") {
    return;
  }
  const rect = els.timelineCanvas.getBoundingClientRect();
  const endTick = currentTimelineEnd();
  const tick = xToTick(clientX - rect.left, endTick, rect.width);
  const states = session.validation?.states ?? session.states;
  const maxTick = Math.max(0, Math.min(endTick, states.length - 1));
  session.reviewTick = Math.min(tick, maxTick);
  session.playback = false;
  if (session.mode === "running") {
    session.accumulator = 0;
    setMode(
      "paused",
      `已暂停并检视 T+${session.reviewTick}；继续游戏会从实机当前 tick 恢复。`,
    );
  } else if (session.mode === "verified" || session.mode === "diverged") {
    setMode(
      "review",
      `正在检视 T+${session.reviewTick}，录包与校验结果保持不变。`,
    );
  }
  updateInterface(true);
}

function bindTimeline() {
  let dragging = false;
  els.timelineCanvas.addEventListener("pointerdown", (event) => {
    dragging = true;
    els.timelineCanvas.setPointerCapture(event.pointerId);
    seekTimeline(event.clientX);
  });
  els.timelineCanvas.addEventListener("pointermove", (event) => {
    if (dragging) {
      seekTimeline(event.clientX);
    }
  });
  const endDrag = (event) => {
    dragging = false;
    if (els.timelineCanvas.hasPointerCapture?.(event.pointerId)) {
      els.timelineCanvas.releasePointerCapture(event.pointerId);
    }
  };
  els.timelineCanvas.addEventListener("pointerup", endDrag);
  els.timelineCanvas.addEventListener("pointercancel", endDrag);
}

function toggleQuality() {
  session.quality = session.quality === "lean" ? "full" : "lean";
  renderer = createRenderer(session.quality);
  els.qualityToggle.textContent =
    session.quality === "lean" ? "切换完整视觉" : "切回精简视觉";
  updateInterface(true);
}

async function toggleAudio() {
  await audio.setEnabled(!audio.enabled);
  els.audioToggle.textContent = audio.enabled ? "声音：开" : "声音：关";
  updateInterface(true);
}

function buildExportBundle() {
  if (!session.recording) {
    return null;
  }
  const validation =
    session.validation ?? replayRecording(session.recording);
  return {
    schema: "pulse-trace-export/1",
    exportedAt: new Date().toISOString(),
    recording: structuredClone(session.recording),
    validation: {
      ok: validation.ok,
      status: validation.status,
      finalHash: validation.finalHash,
      expectedFinalHash: validation.expectedFinalHash,
      firstDivergence: validation.firstDivergence,
      firstRandomDivergence: validation.firstRandomDivergence,
      firstStateDivergence: validation.firstStateDivergence,
      errors: validation.errors,
      elapsedMs: validation.elapsedMs,
      stats: validation.stats,
    },
  };
}

function downloadExport() {
  const bundle = buildExportBundle();
  if (!bundle) {
    setRecovery("当前没有完整录包可导出。请先结束一局或载入场景。", "error");
    return;
  }
  const blob = new Blob([safeSerialize(bundle)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `pulse-trace-${bundle.recording.seed}-${bundle.recording.endTick}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setRecovery(
    `录包已导出：seed=${bundle.recording.seed}，tick=${bundle.recording.endTick}。`,
    "ok",
  );
}

function getScenarios() {
  if (!session.scenarioCache) {
    session.scenarioCache = buildScenarios();
  }
  return session.scenarioCache;
}

function loadScenario(id) {
  const scenario = getScenarios().find((entry) => entry.id === id);
  if (!scenario) {
    setRecovery(`未知场景：${id}`, "error");
    return;
  }
  const recording = structuredClone(scenario.recording);
  const validation = replayRecording(recording);
  session.currentScenario = id;
  session.seed = recording.seed;
  session.initialState = cloneState(recording.initial);
  session.state = cloneState(recording.initial);
  session.states = validation.states;
  session.inputs = recording.inputs.map((input) => ({ ...input }));
  session.randomRows = recording.random;
  session.tickHashes = [...recording.tickHashes];
  session.inputCursor = 0;
  session.inputSequence =
    Math.max(-1, ...recording.inputs.map((input) => input.seq)) + 1;
  session.recording = recording;
  session.validation = validation;
  session.reviewTick = 0;
  session.playback = true;
  session.accumulator = 0;
  session.physicalHeld.clear();
  for (const error of validation.errors) {
    logError(error, `SCENARIO/${id}`);
  }
  if (validation.ok) {
    setMode(
      "review",
      `已载入「${scenario.label}」：${validation.stats.stateChecks} 次状态哈希比对无分叉。`,
      "ok",
    );
  } else {
    setMode(
      "review",
      `已载入「${scenario.label}」：${validation.errors.length} 条异常，首次分叉 T+${validation.firstDivergence?.tick ?? "—"}。错误已保留。`,
      "error",
    );
  }
  document.querySelectorAll(".scenario-chip").forEach((chip) => {
    if (chip.dataset.scenario === id) {
      chip.dataset.active = "true";
    } else {
      delete chip.dataset.active;
    }
  });
  els.scenarioNote.textContent = `${scenario.label}：${scenario.description}`;
  updateInterface(true);
}

function resultMatches(before, after) {
  return (
    before.result.finalHash === after.result.finalHash &&
    before.result.status === after.result.status &&
    JSON.stringify(before.result.firstDivergence) ===
      JSON.stringify(after.result.firstDivergence) &&
    JSON.stringify(before.result.errorCodes) ===
      JSON.stringify(after.result.errorCodes)
  );
}

function profileRow(scenario, source) {
  const result = scenario.result;
  const resources = scenario.resources;
  const failed = result.status !== "verified";
  let divergence = "无分叉";
  if (result.firstRandomDivergence && result.firstStateDivergence) {
    divergence = `${tickLabel(result.firstRandomDivergence.tick)} random<br><small>${tickLabel(
      result.firstStateDivergence.tick,
    )} state</small>`;
  } else if (result.firstDivergence) {
    divergence = `${tickLabel(result.firstDivergence.tick)}<br><small>${escapeHtml(
      result.firstDivergence.kind,
    )}</small>`;
  }
  const codes =
    result.errorCodes.length > 0
      ? result.errorCodes.join("<br>")
      : "无异常";
  return `
    <tr data-profile="${source.profile}">
      <td>
        <span class="scenario-id">${escapeHtml(scenario.label)}
          <small>${escapeHtml(scenario.id)} · seed ${scenario.recording.seed}</small>
        </span>
      </td>
      <td>
        <span class="profile-badge" data-profile="${source.profile}">
          ${source.profile === "full" ? "BEFORE" : "AFTER"} · ${escapeHtml(source.profile)}
        </span>
      </td>
      <td>
        <span class="result-badge" data-status="${escapeHtml(result.status)}">
          ${failed ? "失败" : "通过"}
        </span>
        <span class="hash-mini">${escapeHtml((result.finalHash ?? "—").slice(0, 16))}</span>
        <span class="hash-mini">score ${result.score ?? "—"} / lives ${result.lives ?? "—"}</span>
      </td>
      <td>${divergence}</td>
      <td>
        <span class="error-count" data-zero="${result.errorCount === 0}">
          ${result.errorCount} 条
        </span>
        <span class="hash-mini">${codes}</span>
      </td>
      <td>
        <span class="resource-value">${resources.drawCallsPerFrame} draw/f</span>
        <span class="hash-mini">peak ${resources.peakLiveShapes} · ${resources.particleDrawsPerFrame} particles/f</span>
        <span class="hash-mini">rng ${resources.randomRows} · hashes ${resources.tickHashes} · audio ${resources.audioNodes}</span>
      </td>
      <td>
        <span class="resource-value">${result.replayMs} ms</span>
        <span class="hash-mini">render ${resources.renderMsPerFrame} ms/f</span>
        <span class="hash-mini">${resources.frames} frames</span>
      </td>
    </tr>
  `;
}

function renderAuditEvidence(before, after) {
  const baselineById = new Map(
    (before?.scenarios ?? []).map((scenario) => [scenario.id, scenario]),
  );
  const currentById = new Map(
    (after?.scenarios ?? []).map((scenario) => [scenario.id, scenario]),
  );
  const ids = [...new Set([...baselineById.keys(), ...currentById.keys()])];
  const rows = [];
  let matchingFinal = 0;
  let matchingErrors = 0;
  let matchingDigest = 0;
  let baselineDraws = 0;
  let currentDraws = 0;

  for (const id of ids) {
    const baseline = baselineById.get(id);
    const current = currentById.get(id);
    if (baseline) {
      rows.push(profileRow(baseline, { profile: "full" }));
    }
    if (current) {
      rows.push(profileRow(current, { profile: "lean" }));
    }
    if (baseline && current) {
      if (resultMatches(baseline, current)) {
        matchingFinal += 1;
      }
      if (
        JSON.stringify(baseline.result.errorCodes) ===
          JSON.stringify(current.result.errorCodes) &&
        baseline.result.errorCount === current.result.errorCount
      ) {
        matchingErrors += 1;
      }
      if (baseline.recording.digest === current.recording.digest) {
        matchingDigest += 1;
      }
      baselineDraws += baseline.resources.drawCalls;
      currentDraws += current.resources.drawCalls;
    }
  }

  if (rows.length === 0) {
    els.auditBody.innerHTML =
      '<tr><td colspan="7" class="table-error">未找到可用的审计证据。</td></tr>';
    return;
  }
  els.auditBody.innerHTML = rows.join("");
  const compared = Math.max(1, ids.length);
  const reduction =
    baselineDraws > 0
      ? Math.round((1 - currentDraws / baselineDraws) * 1000) / 10
      : 0;
  els.auditSummary.innerHTML = `
    <span class="summary-chip">最终结果 <strong>${matchingFinal}/${compared}</strong> 一致</span>
    <span class="summary-chip">异常日志 <strong>${matchingErrors}/${compared}</strong> 一致</span>
    <span class="summary-chip">导出摘要 <strong>${matchingDigest}/${compared}</strong> 不变</span>
    <span class="summary-chip" data-tone="warn">Canvas 绘制 <strong>-${reduction}%</strong></span>
  `;
  const corrupt = currentById.get("corrupt");
  if (corrupt?.repro) {
    els.auditRepro.textContent = `损坏场景：tick ${corrupt.repro.tamperTick} 随机行被篡改；复现命令 ${corrupt.repro.command}`;
  }
}

async function loadJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${url} HTTP ${response.status}`);
  }
  return response.json();
}

async function loadAuditEvidence() {
  const scenarios = getScenarios();
  const compute = (profile) => ({
    scenarios: scenarios.map((scenario) => runScenarioAudit(scenario, profile)),
  });
  const [beforeResult, afterResult] = await Promise.allSettled([
    loadJson("./artifacts/audit-before.json"),
    loadJson("./artifacts/audit-after.json"),
  ]);
  const before =
    beforeResult.status === "fulfilled" ? beforeResult.value : compute("full");
  const after =
    afterResult.status === "fulfilled" ? afterResult.value : compute("lean");
  renderAuditEvidence(before, after);
}

function updatePlayback(dt) {
  if (session.mode !== "review" || !session.playback) {
    return;
  }
  const endTick = session.recording?.endTick ?? 0;
  const interval = 1000 / TICK_RATE;
  session.accumulator += Math.min(dt, 120);
  let guard = 0;
  while (
    session.accumulator >= interval &&
    (session.reviewTick ?? 0) < endTick &&
    guard < 10
  ) {
    session.reviewTick = (session.reviewTick ?? 0) + 1;
    session.accumulator -= interval;
    guard += 1;
  }
  if ((session.reviewTick ?? 0) >= endTick) {
    session.playback = false;
    session.accumulator = 0;
    setRecovery(
      "重放完成。可拖动时间轴定位异常，或按“单步 +1”检查相邻 tick。",
      session.validation?.ok ? "ok" : "error",
    );
    setMode("review");
    els.modeText.textContent = "重放完成";
  }
}

function animationLoop(timestamp) {
  try {
    if (session.injectedFault) {
      session.injectedFault = false;
      throw new Error("测试注入异常：渲染循环已安全中止");
    }
    const dt =
      session.lastFrameTime === 0
        ? 0
        : Math.max(0, timestamp - session.lastFrameTime);
    session.lastFrameTime = timestamp;
    if (dt > 0 && dt < 250) {
      session.fpsSamples.push(dt);
      if (session.fpsSamples.length > 40) {
        session.fpsSamples.shift();
      }
    }

    if (session.mode === "running") {
      const interval = 1000 / TICK_RATE;
      session.accumulator += Math.min(dt, 120);
      let guard = 0;
      while (
        session.accumulator >= interval &&
        session.mode === "running" &&
        guard < 8
      ) {
        stepLiveTick();
        session.accumulator -= interval;
        guard += 1;
      }
    } else if (session.mode === "review") {
      updatePlayback(dt);
    } else {
      session.accumulator = 0;
    }

    drawGameFrame();
    drawTimelineFrame();
    updateInterface();
  } catch (error) {
    handleRuntimeError(error, "loop");
  }
  requestAnimationFrame(animationLoop);
}

function bindEvents() {
  els.playToggle.addEventListener("click", () => {
    togglePlay();
    els.gameCanvas.focus({ preventScroll: true });
  });
  els.step.addEventListener("click", () => {
    stepAction();
    els.gameCanvas.focus({ preventScroll: true });
  });
  els.replay.addEventListener("click", () => {
    startReplay();
    els.gameCanvas.focus({ preventScroll: true });
  });
  els.reset.addEventListener("click", () => {
    resetSession();
    els.gameCanvas.focus({ preventScroll: true });
  });
  els.exportButton.addEventListener("click", downloadExport);
  els.qualityToggle.addEventListener("click", toggleQuality);
  els.audioToggle.addEventListener("click", () => {
    toggleAudio().catch((error) => {
      logError(
        {
          code: "E_AUDIO",
          message: error.message,
          tick: session.state.tick,
          recovery: "保持静音继续；声音不是录放成功条件。",
        },
        "audio",
      );
      updateInterface(true);
    });
  });
  els.clearErrors.addEventListener("click", () => {
    session.errors = [];
    session.errorKeys.clear();
    renderErrorLog();
    setRecovery(
      "日志已清空；录包与校验结果未改变。若问题仍存在，请先导出诊断再重置。",
    );
    updateInterface(true);
  });
  window.addEventListener("keydown", onKeyDown, { passive: false });
  window.addEventListener("keyup", onKeyUp, { passive: false });
  window.addEventListener("blur", releaseHeldInputs);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      releaseHeldInputs();
      if (session.mode === "review" && session.playback) {
        session.playback = false;
        setRecovery("页面切换至后台，重放已暂停。");
        updateInterface(true);
      }
    }
  });
  window.addEventListener("error", (event) => {
    if (event.target && event.target !== window) {
      return;
    }
    handleRuntimeError(event.error ?? new Error(event.message), "window");
  });
  window.addEventListener("unhandledrejection", (event) => {
    handleRuntimeError(event.reason ?? new Error("Unhandled rejection"), "promise");
  });
  els.scenarioStrip.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-scenario]");
    if (chip) {
      loadScenario(chip.dataset.scenario);
      els.gameCanvas.focus({ preventScroll: true });
    }
  });
  bindTimeline();
}

function exposeDiagnosticsApi() {
  window.__pulseTrace = Object.freeze({
    snapshot: metricsSnapshot,
    exportBundle: buildExportBundle,
    loadScenario,
    start: startNewRun,
    togglePause: togglePlay,
    step: stepAction,
    replay: startReplay,
    toggleQuality,
    setProfile(profile) {
      if (!RENDER_PROFILES[profile]) {
        throw new Error(`未知视觉档位：${profile}`);
      }
      session.quality = profile;
      renderer = createRenderer(profile);
      els.qualityToggle.textContent =
        profile === "lean" ? "切换完整视觉" : "切回精简视觉";
      updateInterface(true);
    },
    injectFault() {
      session.injectedFault = true;
    },
    scenarios() {
      return getScenarios().map((scenario) => ({
        id: scenario.id,
        label: scenario.label,
        seed: scenario.recording.seed,
        endTick: scenario.recording.endTick,
        expectedPass: scenario.shouldPass,
      }));
    },
  });
}

function boot() {
  bindEvents();
  exposeDiagnosticsApi();
  els.audioToggle.textContent = "声音：开";
  els.qualityToggle.textContent = "切换完整视觉";
  resetSession();
  requestAnimationFrame(animationLoop);
  loadAuditEvidence().catch((error) => {
    els.auditBody.innerHTML = `<tr><td colspan="7" class="table-error">审计证据载入失败：${escapeHtml(
      error.message,
    )}。请运行 npm run audit 后刷新。</td></tr>`;
    els.auditSummary.innerHTML =
      '<span class="summary-chip" data-tone="warn">审计证据不可用</span>';
  });
}

boot();
