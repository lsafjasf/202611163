import {
  AXES,
  DEFAULT_CONFIG,
  DEFAULT_CONTROLS,
  FIXED_DT,
  GEAR_OPTIONS,
  LIMITS,
  SCENARIOS,
  TARGET_OUTPUT_RPM,
  TARGET_TOLERANCE,
  cloneState,
  createInitialState,
  gearGeometry,
  makeSignature,
  playbackSmoothness,
  sampleState,
  stateHash,
  stepSimulation,
  validateScenarios,
} from "./physics.js";

const $ = (selector) => document.querySelector(selector);
const scene = $("#scene");
const sceneCtx = scene.getContext("2d");
const chart = $("#trendChart");
const chartCtx = chart.getContext("2d");

let config = { ...DEFAULT_CONFIG };
let controls = { ...DEFAULT_CONTROLS };
let physical = createInitialState(config, controls);
let mode = "ready";
let selectedAxis = "input";
let accumulator = 0;
let lastFrameTime = performance.now();
let lastUiTime = 0;
let trace = [];
let lastRun = null;
let replay = null;
let displayState = physical;
let resumeVisualUntil = 0;
let triggerVisualUntil = 0;
let resetAnchor = null;
let resetCount = 0;
let resetDrift = 0;
let repeatDelta = null;
const runHistory = new Map();
const changeLog = [];
let validation = [];
let toastTimer = 0;
let resumeFlagTimer = 0;
const audio = {
  context: null,
  master: null,
  hum: null,
  harmonic: null,
  noise: null,
  noiseGain: null,
  filter: null,
  enabled: true,
};

function formatSigned(value, digits = 1) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function isCompleteConfig() {
  return AXES.every((axis) => Number.isFinite(config[axis.id]) && config[axis.id] > 0);
}

function currentGeometry() {
  return gearGeometry(config);
}

function currentStateForDisplay() {
  return displayState;
}

function installedAxes(teeth) {
  return AXES.filter((axis) => config[axis.id] === teeth).map((axis) => axis.id);
}

function showToast(message, alert = false) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.toggle("alert", alert);
  toast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2600);
}

function addChange(title, value, detail, icon = "↻") {
  changeLog.unshift({
    title,
    value,
    detail,
    icon,
    time: physical.t,
  });
  changeLog.splice(5);
  renderChangePanel();
}

function renderChangePanel() {
  const latest = changeLog[0];
  if (!latest) return;
  $("#changeTime").textContent = `T+ ${latest.time.toFixed(3)}`;
  $("#changeIcon").textContent = latest.icon;
  $("#changeTitle").textContent = latest.title;
  $("#changeValue").textContent = latest.value;
  $("#changeDetail").textContent = latest.detail;
  $("#changeLog").innerHTML = changeLog
    .slice(1)
    .map(
      (entry) =>
        `<div class="change-entry"><span>T+${entry.time.toFixed(3)}</span><b>${entry.value}</b><span>${entry.title}</span></div>`,
    )
    .join("");
}

function renderGearAssembly() {
  $("#gearSlots").innerHTML = AXES.map((axis) => {
    const teeth = config[axis.id];
    const filled = Number.isFinite(teeth);
    const geometry = currentGeometry();
    const gap = axis.id === "input" ? geometry.gapA : axis.id === "idler" ? null : geometry.gapB;
    let stateClass = "";
    let stateText = "空位";
    if (filled) {
      stateText = axis.id === "idler" ? `${teeth} T` : `${formatSigned(gap, 0)} 齿`;
      if (axis.id !== "idler") stateClass = Math.abs(gap) < 0.01 ? "good" : "bad";
    }
    return `
      <button class="gear-slot ${selectedAxis === axis.id ? "selected" : ""} ${filled ? "" : "empty"}" data-axis="${axis.id}" type="button">
        <span class="slot-orb ${filled ? "filled" : ""}">${filled ? "" : "+"}</span>
        <span class="slot-copy"><b>${axis.label}</b><small>${filled ? `${teeth} 齿 · m2.0` : "选择下方齿轮"}</small></span>
        <span class="slot-state ${stateClass}">${stateText}</span>
      </button>`;
  }).join("");

  $("#gearLibrary").innerHTML = GEAR_OPTIONS.map((teeth) => {
    const used = installedAxes(teeth);
    return `
      <button class="gear-chip ${used.length ? "installed" : ""}" data-teeth="${teeth}" type="button" ${used.length && !used.includes(selectedAxis) ? "disabled" : ""}>
        <b>${teeth}</b><small>${used.length ? "已装" : "T / 齿轮"}</small>
      </button>`;
  }).join("");

  $("#selectionHint").textContent = `安装至 ${AXES.find((axis) => axis.id === selectedAxis).label}`;
  const geometry = currentGeometry();
  const worstGap = Math.abs(geometry.gapA) >= Math.abs(geometry.gapB) ? geometry.gapA : geometry.gapB;
  $("#meshGap").textContent = `${formatSigned(worstGap, 0)}`;
  $("#meshGap").parentElement.classList.toggle("warn", geometry.jam);
  $("#tagInput").textContent = Number.isFinite(config.input) ? `${config.input} T` : "— T";
  $("#tagIdler").textContent = Number.isFinite(config.idler) ? `${config.idler} T` : "— T";
  $("#tagOutput").textContent = Number.isFinite(config.output) ? `${config.output} T` : "— T";
}

function renderScenarioResults() {
  $("#scenarioList").innerHTML = SCENARIOS.map((scenario, index) => {
    const result = validation[index];
    const trigger = result?.trigger;
    const resultClass = !result ? "" : result.passed ? (scenario.expected === "success" ? "" : "warn") : "fail";
    const badge = !result
      ? "待验证"
      : scenario.expected === "success"
        ? `达标 ${trigger?.time.toFixed(2)}s`
        : `${trigger?.pressureMPa.toFixed(2)} MPa`;
    const icon = scenario.expected === "success" ? "✓" : scenario.id === "extreme" ? "!" : "≈";
    return `
      <button class="scenario-card ${resultClass}" data-scenario="${scenario.id}" type="button">
        <span class="scenario-icon">${icon}</span>
        <span class="scenario-copy"><b>${scenario.title}</b><small>${scenario.note}</small></span>
        <span class="scenario-result">${badge}</span>
      </button>`;
  }).join("");
}

function runValidationSuite(announce = false) {
  validation = validateScenarios();
  renderScenarioResults();
  const passed = validation.filter((result) => result.passed).length;
  const maxDelta = Math.max(...validation.map((result) => result.repeatDelta));
  $("#repeatDelta").textContent = `${maxDelta.toExponential(1)}`;
  if (announce) {
    showToast(`工况验证完成：${passed}/3 通过，重复偏差 ${maxDelta.toExponential(1)}`);
  }
}

function setSelectedAxis(axisId) {
  selectedAxis = axisId;
  renderGearAssembly();
}

function installGear(teeth) {
  if (!GEAR_OPTIONS.includes(teeth)) return;
  const used = installedAxes(teeth);
  if (used.length && !used.includes(selectedAxis)) {
    showToast(`该齿轮已安装在${AXES.find((axis) => axis.id === used[0]).label}`, true);
    return;
  }
  const before = config[selectedAxis];
  config[selectedAxis] = teeth;
  const axisLabel = AXES.find((axis) => axis.id === selectedAxis).label;
  configureReset(`更换${axisLabel}齿轮`, `${before ?? "空"} T → ${teeth} T`, "装配变更会重建确定性初始状态");
}

function removeGear(axisId) {
  if (!Number.isFinite(config[axisId])) return;
  const before = config[axisId];
  config[axisId] = null;
  const axisLabel = AXES.find((axis) => axis.id === axisId).label;
  configureReset(`拆下${axisLabel}齿轮`, `${before} T → 空位`, "传动链不完整，无法启动");
}

function configureReset(title, value, detail) {
  updateConfigReadouts();
  resetSimulation();
  addChange(title, value, detail, "⚙");
}

function updateConfigReadouts() {
  renderGearAssembly();
  const geometry = currentGeometry();
  $("#centerA").textContent = "70.0";
  $("#centerB").textContent = "82.0";
  $("#liveRatio").textContent = Number.isFinite(geometry.ratio) ? geometry.ratio.toFixed(3) : "—";
}

function applyScenario(scenario) {
  config = { ...scenario.config };
  controls = { ...scenario.controls };
  $("#speedSlider").value = controls.inputRpm;
  $("#loadSlider").value = controls.loadNm;
  $("#speedOutput").textContent = `${controls.inputRpm} RPM`;
  $("#loadOutput").textContent = `${controls.loadNm.toFixed(2)} N·m`;
  updateConfigReadouts();
  resetSimulation();
  addChange(`载入 ${scenario.title}`, scenario.note, "工况参数已应用，安全联锁就绪", "◎");
  beginRun();
}

function resetSimulation() {
  physical = createInitialState(config, controls);
  mode = "ready";
  accumulator = 0;
  trace = [];
  replay = null;
  displayState = physical;
  $("#resumeFlag").classList.remove("visible");
  const signature = makeSignature(config, controls);
  const hash = stateHash(physical);
  if (!resetAnchor || resetAnchor.signature !== signature) {
    resetAnchor = { signature, hash };
    resetDrift = 0;
  } else {
    resetCount += 1;
    resetDrift = hash === resetAnchor.hash ? 0 : 1;
  }
  $("#resetDrift").textContent = `${resetDrift.toFixed(6)} / ${resetCount}`;
  renderTriggerCard();
  renderTransport();
  updateAudio(0);
}

function beginRun() {
  if (!isCompleteConfig()) {
    showToast("传动链不完整：请先为三根轴安装齿轮", true);
    return;
  }
  if (resetAnchor && resetAnchor.signature === makeSignature(config, controls)) {
    const hash = stateHash(createInitialState(config, controls));
    resetDrift = hash === resetAnchor.hash ? 0 : 1;
    $("#resetDrift").textContent = `${resetDrift.toFixed(6)} / ${resetCount}`;
  }
  physical = createInitialState(config, controls);
  physical.status = "running";
  displayState = physical;
  mode = "running";
  accumulator = 0;
  lastFrameTime = performance.now();
  trace = [sampleState(physical, config, controls)];
  replay = null;
  $("#resumeFlag").classList.remove("visible");
  initAudio();
  addChange(
    "启动仿真",
    `${controls.inputRpm} RPM / ${controls.loadNm.toFixed(2)} N·m`,
    `固定步长 ${(FIXED_DT * 1000).toFixed(1)} ms · 安全包络监测中`,
    "▶",
  );
  renderTriggerCard();
  renderTransport();
}

function completeRun() {
  if (mode !== "running") return;
  if (!trace.length || trace.at(-1).t !== physical.t) {
    trace.push(sampleState(physical, config, controls));
  }
  mode = physical.status;
  const signature = makeSignature(config, controls);
  const previous = runHistory.get(signature);
  if (previous) {
    repeatDelta = Math.max(
      Math.abs(previous.trigger.time - physical.trigger.time) / 10,
      Math.abs(previous.trigger.speedRpm - physical.trigger.speedRpm) / 100,
      Math.abs(previous.trigger.pressureMPa - physical.trigger.pressureMPa),
      Math.abs(previous.trigger.tempC - physical.trigger.tempC) / 100,
      Math.abs(previous.trigger.positionDeg - physical.trigger.positionDeg) / 3600,
    );
    $("#repeatDelta").textContent = `${(repeatDelta * 100).toExponential(2)}%`;
  } else {
    runHistory.set(signature, {
      trigger: { ...physical.trigger },
      finalHash: stateHash(physical),
    });
    $("#repeatDelta").textContent = "记录基线";
  }
  lastRun = {
    samples: trace.slice(),
    config: { ...config },
    controls: { ...controls },
    final: cloneState(physical),
    smoothness: playbackSmoothness(trace),
    signature,
  };
  triggerVisualUntil = performance.now() + 2200;
  const isSuccess = physical.status === "success";
  addChange(
    isSuccess ? "输出转速达标" : physical.trigger.title,
    isSuccess ? `${physical.outputRpm.toFixed(2)} RPM` : `${physical.trigger.pressureMPa.toFixed(2)} MPa`,
    `T+${physical.trigger.time.toFixed(3)} s · 输出相位 ${physical.trigger.positionDeg.toFixed(1)}°`,
    isSuccess ? "✓" : "!",
  );
  showToast(
    isSuccess
      ? `目标达成：${physical.outputRpm.toFixed(2)} RPM，保持 750 ms`
      : `${physical.trigger.title} @ T+${physical.trigger.time.toFixed(3)} s`,
    !isSuccess,
  );
  updateAudio(0);
  renderTriggerCard();
  renderTransport();
}

function pauseRun() {
  if (mode !== "running") return;
  mode = "paused";
  physical.status = "paused";
  accumulator = 0;
  $("#resumeFlag").classList.remove("visible");
  addChange("仿真暂停", `T+ ${physical.t.toFixed(3)} s`, "物理积分暂停，状态已冻结", "Ⅱ");
  renderTransport();
  updateAudio(0);
}

function resumeRun() {
  if (mode !== "paused") return;
  mode = "running";
  physical.status = "running";
  lastFrameTime = performance.now();
  accumulator = 0;
  resumeVisualUntil = performance.now() + 1600;
  $("#resumeFlag").classList.add("visible");
  window.clearTimeout(resumeFlagTimer);
  resumeFlagTimer = window.setTimeout(() => $("#resumeFlag").classList.remove("visible"), 1600);
  addChange("恢复运行", `T+ ${physical.t.toFixed(3)} s`, "受力箭头与趋势方向已刷新", "▶");
  renderTransport();
}

function toggleRun() {
  if (mode === "running") {
    pauseRun();
  } else if (mode === "paused") {
    resumeRun();
  } else {
    beginRun();
  }
}

function singleStep() {
  if (mode === "replay") {
    resetSimulation();
  }
  if (physical.status === "failed" || physical.status === "success" || mode === "success" || mode === "failed") {
    resetSimulation();
  }
  if (mode === "running") pauseRun();
  if (mode === "ready") {
    physical = createInitialState(config, controls);
    physical.status = "paused";
    displayState = physical;
    trace = [sampleState(physical, config, controls)];
    lastFrameTime = performance.now();
    initAudio();
  }
  if (mode !== "paused" && mode !== "ready") return;
  mode = "paused";
  physical.status = "paused";
  accumulator = 0;
  stepSimulation(physical, config, controls, FIXED_DT);
  displayState = physical;
  trace.push(sampleState(physical, config, controls));
  addChange("单步推进", `T+ ${physical.t.toFixed(3)} s`, `Δt ${(FIXED_DT * 1000).toFixed(1)} ms · 哈希 ${stateHash(physical)}`, "⇥");
  if (physical.status === "failed" || physical.status === "success") {
    mode = "running";
    completeRun();
  } else {
    physical.status = "paused";
    mode = "paused";
  }
  renderTransport();
}

function startReplay() {
  if (!lastRun || lastRun.samples.length < 2) {
    showToast("暂无可回放数据，请先完成一次运行", true);
    return;
  }
  mode = "replay";
  accumulator = 0;
  replay = {
    samples: lastRun.samples,
    elapsed: 0,
    duration: Math.max(0.08, lastRun.samples.at(-1).t - lastRun.samples[0].t),
    smoothness: lastRun.smoothness,
  };
  displayState = interpolateReplay(0);
  $("#replaySmoothness").textContent = `${replay.smoothness < 1 ? "PASS" : "CHECK"} ${replay.smoothness.toFixed(3)}`;
  addChange("开始回放", `${lastRun.samples.length} 个采样点`, "线性插值回放，关键状态连续", "▷");
  initAudio();
  renderTransport();
}

function interpolateReplay(elapsed) {
  const samples = replay.samples;
  const startTime = samples[0].t;
  const targetTime = startTime + clamp(elapsed, 0, replay.duration);
  let index = 1;
  while (index < samples.length && samples[index].t < targetTime) index += 1;
  const current = samples[Math.min(index, samples.length - 1)];
  const previous = samples[Math.max(0, index - 1)];
  const span = Math.max(1e-9, current.t - previous.t);
  const mix = clamp((targetTime - previous.t) / span, 0, 1);
  const keys = [
    "t",
    "phaseInput",
    "phaseIdler",
    "phaseOutput",
    "inputRpm",
    "outputRpm",
    "pressureMPa",
    "tempC",
    "vibration",
    "noiseDb",
    "gapA",
    "gapB",
    "ratio",
    "loadNm",
  ];
  const result = { ...previous };
  for (const key of keys) {
    result[key] = previous[key] + (current[key] - previous[key]) * mix;
  }
  result.status = elapsed >= replay.duration ? lastRun.final.status : "running";
  result.trigger = elapsed >= replay.duration ? lastRun.final.trigger : null;
  result.successHold = 0;
  return result;
}

function updateReplay(deltaSeconds) {
  if (!replay) return;
  replay.elapsed += Math.min(0.04, Math.max(0, deltaSeconds));
  const elapsed = replay.elapsed;
  displayState = interpolateReplay(elapsed);
  if (elapsed >= replay.duration) {
    mode = "replayDone";
    displayState = { ...replay.samples.at(-1) };
    displayState.status = lastRun.final.status;
    displayState.trigger = lastRun.final.trigger;
    mode = lastRun.final.status === "success" ? "replayDone" : "replayDone";
    showToast(`回放完成：最大状态跳变 ${replay.smoothness.toFixed(3)} rad`);
    renderTransport();
    updateAudio(0);
  }
}

function animationLoop(now) {
  const delta = Math.min(0.08, Math.max(0, (now - lastFrameTime) / 1000));
  lastFrameTime = now;

  if (mode === "running") {
    accumulator += delta;
    let iterations = 0;
    while (accumulator >= FIXED_DT && iterations < 8 && mode === "running") {
      stepSimulation(physical, config, controls, FIXED_DT);
      accumulator -= FIXED_DT;
      iterations += 1;
      if (physical.steps % 3 === 0 || physical.status === "failed" || physical.status === "success") {
        trace.push(sampleState(physical, config, controls));
      }
      if (physical.status === "failed" || physical.status === "success") {
        completeRun();
        break;
      }
    }
    displayState = physical;
  } else if (mode === "replay") {
    updateReplay(delta);
  } else {
    displayState = physical;
  }

  drawScene(displayState, now);
  if (now - lastUiTime > 66) {
    lastUiTime = now;
    renderTelemetry(displayState);
    drawTrendChart(displayState);
  }
  updateAudio(displayState);
  requestAnimationFrame(animationLoop);
}

function configureCanvas(canvas, context, width, height) {
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  return { width, height, ratio };
}

function roundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function drawArrow(context, x, y, dx, dy, color, lineWidth = 2) {
  const length = Math.hypot(dx, dy);
  if (length < 0.1) return;
  const ux = dx / length;
  const uy = dy / length;
  const head = 7;
  context.save();
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = lineWidth;
  context.shadowColor = color;
  context.shadowBlur = 8;
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(x + dx - ux * head, y + dy - uy * head);
  context.stroke();
  context.beginPath();
  context.moveTo(x + dx, y + dy);
  context.lineTo(x + dx - ux * head - uy * head * 0.48, y + dy - uy * head + ux * head * 0.48);
  context.lineTo(x + dx - ux * head + uy * head * 0.48, y + dy - uy * head - ux * head * 0.48);
  context.closePath();
  context.fill();
  context.restore();
}

function drawScene(state, now) {
  const { width, height } = configureCanvas(scene, sceneCtx, 940, 520);
  const context = sceneCtx;
  const geometry = currentGeometry();
  const running = mode === "running" || mode === "replay" || mode === "replayDone";
  const resumeGlow = now < resumeVisualUntil;
  const triggerGlow = state.trigger && (now < triggerVisualUntil || mode === "failed");

  const background = context.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, "#0b141b");
  background.addColorStop(0.58, "#091117");
  background.addColorStop(1, "#060b0f");
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  context.strokeStyle = "rgba(106, 140, 158, 0.055)";
  context.lineWidth = 1;
  for (let x = 20; x < width; x += 26) {
    context.beginPath();
    context.moveTo(x + 0.5, 0);
    context.lineTo(x + 0.5, height);
    context.stroke();
  }
  for (let y = 18; y < height; y += 26) {
    context.beginPath();
    context.moveTo(0, y + 0.5);
    context.lineTo(width, y + 0.5);
    context.stroke();
  }

  const housingGradient = context.createLinearGradient(30, 60, 700, 470);
  housingGradient.addColorStop(0, "#18252e");
  housingGradient.addColorStop(0.52, "#101a22");
  housingGradient.addColorStop(1, "#0b1218");
  roundedRect(context, 26, 55, 680, 436, 18);
  context.fillStyle = housingGradient;
  context.fill();
  context.strokeStyle = "#2c3e4a";
  context.lineWidth = 2;
  context.stroke();

  roundedRect(context, 40, 68, 652, 410, 13);
  context.fillStyle = "#091117";
  context.fill();
  context.strokeStyle = "rgba(114, 146, 163, 0.2)";
  context.lineWidth = 1;
  context.stroke();

  context.fillStyle = "rgba(255,255,255,0.018)";
  context.beginPath();
  context.moveTo(42, 70);
  context.lineTo(250, 70);
  context.lineTo(88, 476);
  context.lineTo(42, 476);
  context.closePath();
  context.fill();

  context.fillStyle = "#425866";
  context.font = '600 9px "SFMono-Regular", monospace';
  context.fillText("H-07 / TRANSMISSION CUTAWAY", 52, 88);
  context.fillStyle = "#2e424e";
  context.fillText("M2.0 · 20° PRESSURE ANGLE", 494, 88);

  drawPanel(context, geometry, state);
  drawShaftRail(context, geometry, state, running);
  drawGearTrain(context, geometry, state, now, resumeGlow, triggerGlow);
  drawForceOverlay(context, geometry, state, now, resumeGlow);
  drawHousingDetails(context, state, geometry, triggerGlow);

  if (triggerGlow && state.trigger) {
    drawTriggerOverlay(context, state.trigger, geometry, now);
  }

  if (state.noiseDb > 50) {
    drawNoiseWaves(context, state, now);
  }
}

function drawPanel(context, geometry, state) {
  roundedRect(context, 720, 55, 196, 436, 16);
  context.fillStyle = "rgba(9, 16, 22, 0.96)";
  context.fill();
  context.strokeStyle = "#263a46";
  context.lineWidth = 1.5;
  context.stroke();

  context.fillStyle = "#465d6b";
  context.font = '600 8px "SFMono-Regular", monospace';
  context.fillText("OUTPUT SHAFT", 740, 84);
  context.fillStyle = state.status === "success" ? "#49d6cb" : "#ff8a3d";
  context.font = '700 27px "SFMono-Regular", monospace';
  context.fillText((state.outputRpm || 0).toFixed(1), 740, 115);
  context.fillStyle = "#566c79";
  context.font = '500 8px "SFMono-Regular", monospace';
  context.fillText("RPM", 860, 114);

  const gaugeX = 818;
  const gaugeY = 193;
  const gaugeRadius = 50;
  const startAngle = Math.PI * 0.78;
  const endAngle = Math.PI * 2.22;
  context.lineCap = "round";
  context.beginPath();
  context.arc(gaugeX, gaugeY, gaugeRadius, startAngle, endAngle);
  context.strokeStyle = "#1d2d37";
  context.lineWidth = 7;
  context.stroke();
  const targetFraction = clamp(TARGET_OUTPUT_RPM / 128, 0, 1);
  const valueFraction = clamp((state.outputRpm || 0) / 128, 0, 1);
  context.beginPath();
  context.arc(gaugeX, gaugeY, gaugeRadius, startAngle, startAngle + (endAngle - startAngle) * valueFraction);
  context.strokeStyle = state.status === "failed" ? "#ff5964" : "#49d6cb";
  context.shadowColor = context.strokeStyle;
  context.shadowBlur = 12;
  context.lineWidth = 5;
  context.stroke();
  context.shadowBlur = 0;
  const targetAngle = startAngle + (endAngle - startAngle) * targetFraction;
  context.beginPath();
  context.moveTo(gaugeX + Math.cos(targetAngle) * (gaugeRadius - 8), gaugeY + Math.sin(targetAngle) * (gaugeRadius - 8));
  context.lineTo(gaugeX + Math.cos(targetAngle) * (gaugeRadius + 8), gaugeY + Math.sin(targetAngle) * (gaugeRadius + 8));
  context.strokeStyle = "#ffb16f";
  context.lineWidth = 2;
  context.stroke();
  const needleAngle = startAngle + (endAngle - startAngle) * valueFraction;
  context.beginPath();
  context.moveTo(gaugeX, gaugeY);
  context.lineTo(gaugeX + Math.cos(needleAngle) * (gaugeRadius - 8), gaugeY + Math.sin(needleAngle) * (gaugeRadius - 8));
  context.strokeStyle = "#f3f8fa";
  context.lineWidth = 1.5;
  context.stroke();
  context.beginPath();
  context.arc(gaugeX, gaugeY, 3, 0, Math.PI * 2);
  context.fillStyle = "#ff8a3d";
  context.fill();
  context.textAlign = "center";
  context.fillStyle = "#526976";
  context.font = '500 7px "SFMono-Regular", monospace';
  context.fillText("TARGET", gaugeX - 27, gaugeY + 30);
  context.fillStyle = "#bd8a63";
  context.fillText(`${TARGET_OUTPUT_RPM.toFixed(1)}`, gaugeX + 24, gaugeY + 30);
  context.textAlign = "start";

  const meters = [
    { label: "PRESSURE", value: state.pressureMPa, max: LIMITS.pressure, color: "#ff8a3d", y: 281 },
    { label: "OIL TEMP", value: state.tempC - LIMITS.ambient, max: LIMITS.temperature - LIMITS.ambient, color: "#f3c85b", y: 316 },
    { label: "VIBRATION", value: state.vibration, max: 6, color: "#49d6cb", y: 351 },
  ];
  for (const meter of meters) {
    const fraction = clamp(meter.value / meter.max, 0, 1);
    context.fillStyle = "#4e6471";
    context.font = '500 7px "SFMono-Regular", monospace';
    context.fillText(meter.label, 739, meter.y);
    context.fillStyle = "#8297a3";
    context.textAlign = "right";
    context.fillText(meter.value.toFixed(meter.label === "VIBRATION" ? 1 : 2), 895, meter.y);
    context.textAlign = "start";
    roundedRect(context, 739, meter.y + 7, 156, 4, 2);
    context.fillStyle = "#1a2932";
    context.fill();
    roundedRect(context, 739, meter.y + 7, Math.max(2, 156 * fraction), 4, 2);
    context.fillStyle = fraction > 0.9 ? "#ff5964" : meter.color;
    context.fill();
  }

  context.strokeStyle = "rgba(102, 133, 149, 0.17)";
  context.beginPath();
  context.moveTo(739, 378);
  context.lineTo(896, 378);
  context.stroke();
  context.fillStyle = "#4a606e";
  context.font = '500 7px "SFMono-Regular", monospace';
  context.fillText("POSITION", 739, 396);
  context.fillStyle = "#bfd0d8";
  context.font = '600 12px "SFMono-Regular", monospace';
  context.fillText(`${((state.phaseOutput * 180) / Math.PI % 360).toFixed(1)}°`, 739, 413);
  context.fillStyle = "#4a606e";
  context.font = '500 7px "SFMono-Regular", monospace';
  context.fillText("RATIO", 739, 436);
  context.fillStyle = "#bfd0d8";
  context.font = '600 12px "SFMono-Regular", monospace';
  context.fillText(Number.isFinite(geometry.ratio) ? geometry.ratio.toFixed(3) : "—", 739, 453);
  context.fillStyle = "#4a606e";
  context.font = '500 7px "SFMono-Regular", monospace';
  context.fillText("NOISE", 819, 436);
  context.fillStyle = "#bfd0d8";
  context.font = '600 12px "SFMono-Regular", monospace';
  context.fillText(`${(state.noiseDb || 0).toFixed(0)} dBA`, 819, 453);
}

const GEAR_VISUAL = Object.freeze({
  module: 5.2,
  inputX: 158,
  idlerX: 340,
  outputX: 553.2,
  centerY: 305,
});

function axisCenter(axisId) {
  return {
    x: axisId === "input" ? GEAR_VISUAL.inputX : axisId === "idler" ? GEAR_VISUAL.idlerX : GEAR_VISUAL.outputX,
    y: GEAR_VISUAL.centerY,
  };
}

function drawShaftRail(context, geometry, state, running) {
  const y = GEAR_VISUAL.centerY;
  const railGradient = context.createLinearGradient(0, y - 8, 0, y + 8);
  railGradient.addColorStop(0, "#3c505d");
  railGradient.addColorStop(0.48, "#19262f");
  railGradient.addColorStop(1, "#0d151b");
  context.fillStyle = railGradient;
  context.fillRect(62, y - 5, 624, 10);
  context.strokeStyle = "rgba(116, 149, 166, 0.2)";
  context.lineWidth = 1;
  context.strokeRect(62.5, y - 5.5, 623, 11);

  for (const axis of AXES) {
    const { x } = axisCenter(axis.id);
    roundedRect(context, x - 31, y - 19, 62, 38, 7);
    context.fillStyle = "#111c24";
    context.fill();
    context.strokeStyle = "#2c404c";
    context.stroke();
    context.fillStyle = "#536a78";
    for (const offset of [-21, 21]) {
      context.beginPath();
      context.arc(x + offset, y - 11, 2.1, 0, Math.PI * 2);
      context.fill();
    }
  }

  const dimensionY = 415;
  context.strokeStyle = "#344b58";
  context.fillStyle = "#526a77";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(GEAR_VISUAL.inputX, dimensionY);
  context.lineTo(GEAR_VISUAL.idlerX, dimensionY);
  context.moveTo(GEAR_VISUAL.inputX, dimensionY - 5);
  context.lineTo(GEAR_VISUAL.inputX, dimensionY + 5);
  context.moveTo(GEAR_VISUAL.idlerX, dimensionY - 5);
  context.lineTo(GEAR_VISUAL.idlerX, dimensionY + 5);
  context.stroke();
  context.beginPath();
  context.moveTo(GEAR_VISUAL.idlerX, dimensionY);
  context.lineTo(GEAR_VISUAL.outputX, dimensionY);
  context.moveTo(GEAR_VISUAL.outputX, dimensionY - 5);
  context.lineTo(GEAR_VISUAL.outputX, dimensionY + 5);
  context.stroke();
  context.font = '500 8px "SFMono-Regular", monospace';
  context.textAlign = "center";
  context.fillText("A · 70.0 mm", (GEAR_VISUAL.inputX + GEAR_VISUAL.idlerX) / 2, dimensionY - 8);
  context.fillText("B · 82.0 mm", (GEAR_VISUAL.idlerX + GEAR_VISUAL.outputX) / 2, dimensionY - 8);
  context.textAlign = "start";

  const hue = geometry.jam ? "#ff5964" : running ? "#49d6cb" : "#637a87";
  context.fillStyle = hue;
  context.font = '600 8px "SFMono-Regular", monospace';
  context.fillText(geometry.jam ? "DRIVELINE LOCKED" : running ? "POWER FLOW →" : "DRIVELINE READY", 66, 450);
}

function drawGearTrain(context, geometry, state, now, resumeGlow, triggerGlow) {
  const layout = [
    { id: "input", teeth: config.input, phase: state.phaseInput, direction: 1 },
    { id: "idler", teeth: config.idler, phase: state.phaseIdler + Math.PI / Math.max(1, config.idler), direction: -1 },
    { id: "output", teeth: config.output, phase: state.phaseOutput, direction: 1 },
  ];

  for (const gear of layout) {
    const { x, y } = axisCenter(gear.id);
    if (!Number.isFinite(gear.teeth)) {
      drawMissingGear(context, x, y, gear.id);
      continue;
    }
    const radius = (gear.teeth * GEAR_VISUAL.module) / 2;
    const selected = selectedAxis === gear.id;
    drawGear(context, x, y, gear.teeth, gear.phase || 0, radius, {
      selected,
      output: gear.id === "output",
      jam: geometry.jam,
      running: mode === "running" || mode === "replay",
      now,
    });
    drawGearDirection(context, x, y, radius, gear.direction, mode === "running" || mode === "replay");
    if (gear.id === "output" && Number.isFinite(state.phaseOutput)) {
      drawPositionNeedle(context, x, y, radius, state.phaseOutput);
    }
  }

  if (resumeGlow) {
    const pulse = 0.55 + Math.sin(now / 95) * 0.22;
    context.save();
    context.globalAlpha = pulse;
    context.strokeStyle = "#49d6cb";
    context.lineWidth = 1.5;
    context.setLineDash([5, 5]);
    context.beginPath();
    context.arc(GEAR_VISUAL.idlerX, GEAR_VISUAL.centerY, 122, Math.PI * 1.08, Math.PI * 1.78);
    context.stroke();
    context.restore();
  }

  if (triggerGlow) {
    const triggerColor = state.trigger?.code === "TARGET_REACHED" ? "#49d6cb" : "#ff5964";
    context.save();
    context.strokeStyle = triggerColor;
    context.lineWidth = 2;
    context.globalAlpha = 0.6 + Math.sin(now / 110) * 0.25;
    context.beginPath();
    context.arc(GEAR_VISUAL.outputX, GEAR_VISUAL.centerY, (config.output || 24) * GEAR_VISUAL.module * 0.5 + 16, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }
}

function drawGear(context, cx, cy, teeth, phase, radius, options) {
  const step = (Math.PI * 2) / teeth;
  const outer = radius + GEAR_VISUAL.module * 0.78;
  const root = radius - GEAR_VISUAL.module * 0.72;
  context.save();
  context.translate(cx, cy);
  context.rotate(phase);
  context.beginPath();
  for (let index = 0; index < teeth; index += 1) {
    const start = index * step - step / 2;
    const points = [
      { angle: start, r: root },
      { angle: start + step * 0.26, r: outer },
      { angle: start + step * 0.72, r: outer },
      { angle: start + step, r: root },
    ];
    for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
      const point = points[pointIndex];
      const x = Math.cos(point.angle) * point.r;
      const y = Math.sin(point.angle) * point.r;
      if (index === 0 && pointIndex === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
  }
  context.closePath();
  const body = context.createRadialGradient(-radius * 0.35, -radius * 0.42, radius * 0.1, 0, 0, outer);
  if (options.jam) {
    body.addColorStop(0, "#6c3f42");
    body.addColorStop(0.52, "#3b2a30");
    body.addColorStop(1, "#21181d");
  } else if (options.output) {
    body.addColorStop(0, "#8f7967");
    body.addColorStop(0.42, "#554a42");
    body.addColorStop(1, "#292b2e");
  } else {
    body.addColorStop(0, "#7b8d96");
    body.addColorStop(0.42, "#465963");
    body.addColorStop(1, "#222e35");
  }
  context.fillStyle = body;
  context.shadowColor = options.output ? "rgba(255,138,61,0.19)" : "rgba(0,0,0,0.65)";
  context.shadowBlur = 15;
  context.shadowOffsetY = 5;
  context.fill();
  context.shadowBlur = 0;
  context.shadowOffsetY = 0;
  context.strokeStyle = options.jam ? "rgba(255,89,100,0.7)" : "rgba(195,210,216,0.35)";
  context.lineWidth = 1.2;
  context.stroke();

  context.beginPath();
  context.arc(0, 0, root - 1, 0, Math.PI * 2);
  context.strokeStyle = "rgba(9,15,19,0.65)";
  context.lineWidth = 3;
  context.stroke();

  const holeCount = teeth >= 40 ? 6 : teeth >= 30 ? 5 : 4;
  const holeOrbit = radius * 0.58;
  const holeRadius = radius * 0.115;
  for (let index = 0; index < holeCount; index += 1) {
    const angle = (index / holeCount) * Math.PI * 2;
    const hx = Math.cos(angle) * holeOrbit;
    const hy = Math.sin(angle) * holeOrbit;
    const holeGradient = context.createRadialGradient(hx - 2, hy - 2, 1, hx, hy, holeRadius);
    holeGradient.addColorStop(0, "#05090c");
    holeGradient.addColorStop(0.75, "#0a1116");
    holeGradient.addColorStop(1, "#33434c");
    context.beginPath();
    context.arc(hx, hy, holeRadius, 0, Math.PI * 2);
    context.fillStyle = holeGradient;
    context.fill();
    context.strokeStyle = "rgba(174,191,200,0.2)";
    context.lineWidth = 1;
    context.stroke();
  }

  const hub = context.createRadialGradient(-4, -5, 2, 0, 0, radius * 0.28);
  hub.addColorStop(0, options.output ? "#d6ab83" : "#a5b4bb");
  hub.addColorStop(0.38, options.output ? "#8d6247" : "#566873");
  hub.addColorStop(1, "#1d282f");
  context.beginPath();
  context.arc(0, 0, radius * 0.28, 0, Math.PI * 2);
  context.fillStyle = hub;
  context.fill();
  context.strokeStyle = "#202e36";
  context.lineWidth = 2;
  context.stroke();
  context.beginPath();
  context.arc(0, 0, radius * 0.085, 0, Math.PI * 2);
  context.fillStyle = "#060b0e";
  context.fill();
  context.strokeStyle = "#263740";
  context.lineWidth = 1;
  context.stroke();
  context.fillStyle = "#0b1318";
  context.fillRect(radius * 0.055, -radius * 0.024, radius * 0.07, radius * 0.048);

  if (options.selected) {
    context.setLineDash([4, 5]);
    context.strokeStyle = "rgba(255, 138, 61, 0.86)";
    context.lineWidth = 1.3;
    context.beginPath();
    context.arc(0, 0, outer + 9, 0, Math.PI * 2);
    context.stroke();
    context.setLineDash([]);
  }
  context.restore();
}

function drawMissingGear(context, x, y, axisId) {
  context.save();
  context.setLineDash([6, 6]);
  context.strokeStyle = "rgba(255, 89, 100, 0.45)";
  context.lineWidth = 1.5;
  context.beginPath();
  context.arc(x, y, 58, 0, Math.PI * 2);
  context.stroke();
  context.setLineDash([]);
  context.fillStyle = "rgba(255, 89, 100, 0.55)";
  context.font = '600 10px "SFMono-Regular", monospace';
  context.textAlign = "center";
  context.fillText("MISSING", x, y + 2);
  context.fillStyle = "#4f6571";
  context.font = '500 7px "SFMono-Regular", monospace';
  context.fillText(axisId.toUpperCase(), x, y + 15);
  context.textAlign = "start";
  context.restore();
}

function drawGearDirection(context, x, y, radius, direction, active) {
  if (!active) return;
  context.save();
  context.strokeStyle = "rgba(73, 214, 203, 0.42)";
  context.lineWidth = 1.2;
  const arcRadius = radius + 14;
  const start = direction > 0 ? -1.24 : -1.9;
  const end = direction > 0 ? -1.9 : -1.24;
  context.beginPath();
  context.arc(x, y, arcRadius, start, end, direction > 0);
  context.stroke();
  const angle = end;
  const px = x + Math.cos(angle) * arcRadius;
  const py = y + Math.sin(angle) * arcRadius;
  context.fillStyle = "rgba(73, 214, 203, 0.65)";
  context.beginPath();
  context.moveTo(px + 4 * direction, py);
  context.lineTo(px - 3, py - 4);
  context.lineTo(px - 3, py + 4);
  context.closePath();
  context.fill();
  context.restore();
}

function drawPositionNeedle(context, x, y, radius, phase) {
  context.save();
  context.translate(x, y);
  context.rotate(phase);
  context.strokeStyle = "#ff9d5a";
  context.lineWidth = 2;
  context.shadowColor = "#ff8a3d";
  context.shadowBlur = 7;
  context.beginPath();
  context.moveTo(radius * 0.2, 0);
  context.lineTo(radius * 0.9, 0);
  context.stroke();
  context.restore();
}

function drawForceOverlay(context, geometry, state, now, resumeGlow) {
  const active = mode === "running" || mode === "paused" || mode === "replay" || mode === "replayDone";
  if (!active || !Number.isFinite(config.input) || !Number.isFinite(config.idler)) return;
  const y = GEAR_VISUAL.centerY;
  const loadScale = clamp((state.loadNm || controls.loadNm) / 2.2, 0.45, 1.55);
  const forceLength = 27 + loadScale * 22 + Math.sin(now / 240) * (mode === "running" ? 2 : 0);
  const alpha = resumeGlow ? 1 : mode === "paused" ? 0.6 : 0.78;
  context.save();
  context.globalAlpha = alpha;

  const meshAX = (GEAR_VISUAL.inputX + GEAR_VISUAL.idlerX) / 2;
  const meshBX = (GEAR_VISUAL.idlerX + GEAR_VISUAL.outputX) / 2;
  drawArrow(context, meshAX, y - 20, 0, forceLength, "#f3c85b", resumeGlow ? 2.6 : 1.8);
  drawArrow(context, meshAX, y + 20, 0, -forceLength, "#f3c85b", resumeGlow ? 2.6 : 1.8);
  drawArrow(context, meshBX, y - 20, 0, -forceLength, "#f3c85b", resumeGlow ? 2.6 : 1.8);
  drawArrow(context, meshBX, y + 20, 0, forceLength, "#f3c85b", resumeGlow ? 2.6 : 1.8);

  context.fillStyle = "#f3c85b";
  context.font = '600 7px "SFMono-Regular", monospace';
  context.fillText("Ft", meshAX + 7, y - 24);
  context.fillText("Ft", meshBX + 7, y + 28);

  if (resumeGlow) {
    const x = 64 + Math.sin(now / 120) * 5;
    drawArrow(context, x, y - 103, 54, 0, "#49d6cb", 2);
    context.fillStyle = "#49d6cb";
    context.font = '600 8px "SFMono-Regular", monospace';
    context.fillText("TORQUE ↑", x, y - 111);
  }
  context.restore();
}

function drawHousingDetails(context, state, geometry, triggerGlow) {
  const bolts = [
    [51, 80],
    [681, 80],
    [51, 466],
    [681, 466],
  ];
  for (const [x, y] of bolts) {
    context.beginPath();
    context.arc(x, y, 5, 0, Math.PI * 2);
    context.fillStyle = "#1f2f38";
    context.fill();
    context.strokeStyle = "#405663";
    context.lineWidth = 1;
    context.stroke();
    context.beginPath();
    context.moveTo(x - 2.5, y);
    context.lineTo(x + 2.5, y);
    context.stroke();
  }

  context.fillStyle = "#1a2730";
  context.fillRect(55, 490, 190, 12);
  context.fillRect(512, 490, 172, 12);
  context.fillStyle = "#30434e";
  context.fillRect(66, 488, 28, 3);
  context.fillRect(152, 488, 28, 3);

  context.save();
  context.globalAlpha = 0.26;
  for (let x = 58; x < 685; x += 18) {
    context.fillStyle = x % 36 === 4 ? "#f3c85b" : "#10181e";
    context.beginPath();
    context.moveTo(x, 471);
    context.lineTo(x + 9, 471);
    context.lineTo(x + 17, 481);
    context.lineTo(x + 8, 481);
    context.closePath();
    context.fill();
  }
  context.restore();

  const statusColor = state.status === "failed" ? "#ff5964" : state.status === "success" ? "#49d6cb" : "#ff8a3d";
  context.fillStyle = statusColor;
  context.shadowColor = statusColor;
  context.shadowBlur = 9;
  context.beginPath();
  context.arc(653, 80, 3.5, 0, Math.PI * 2);
  context.fill();
  context.shadowBlur = 0;

  if (geometry.jam) {
    context.fillStyle = "rgba(255, 89, 100, 0.88)";
    context.font = '700 9px "SFMono-Regular", monospace';
    context.fillText("INTERFERENCE", 490, 430);
  } else if (geometry.underMesh) {
    context.fillStyle = "rgba(243, 200, 91, 0.8)";
    context.font = '600 9px "SFMono-Regular", monospace';
    context.fillText("LASH WARNING", 510, 430);
  }

  if (triggerGlow) {
    context.strokeStyle =
      state.trigger?.code === "TARGET_REACHED" ? "rgba(73, 214, 203, 0.25)" : "rgba(255, 89, 100, 0.25)";
    context.lineWidth = 3;
    roundedRect(context, 42, 70, 648, 406, 12);
    context.stroke();
  }
}

function drawTriggerOverlay(context, trigger, geometry, now) {
  const x = 655;
  const y = 114;
  const flash = 0.72 + Math.sin(now / 150) * 0.2;
  context.save();
  context.globalAlpha = flash;
  roundedRect(context, 480, 100, 170, 48, 5);
  context.fillStyle = trigger.code === "TARGET_REACHED" ? "rgba(10, 41, 41, 0.94)" : "rgba(47, 13, 19, 0.94)";
  context.fill();
  context.strokeStyle = trigger.code === "TARGET_REACHED" ? "#49d6cb" : "#ff5964";
  context.lineWidth = 1;
  context.stroke();
  context.fillStyle = trigger.code === "TARGET_REACHED" ? "#49d6cb" : "#ff7a83";
  context.font = '700 8px "SFMono-Regular", monospace';
  context.fillText(trigger.code === "TARGET_REACHED" ? "TARGET LOCKED" : "SAFETY TRIP", 492, 118);
  context.fillStyle = "#ffe5e7";
  context.font = '600 10px "SFMono-Regular", monospace';
  context.fillText(`T+${trigger.time.toFixed(3)}s  ${trigger.pressureMPa.toFixed(2)} MPa`, 492, 134);
  context.restore();
}

function drawNoiseWaves(context, state, now) {
  const x = GEAR_VISUAL.outputX;
  const y = GEAR_VISUAL.centerY;
  const radius = (config.output || 24) * GEAR_VISUAL.module * 0.5 + 20;
  context.save();
  for (let index = 0; index < 3; index += 1) {
    const phase = ((now / 720 + index / 3) % 1);
    context.globalAlpha = (1 - phase) * clamp(state.vibration / 7, 0.08, 0.42);
    context.strokeStyle = "#49d6cb";
    context.lineWidth = 1;
    context.beginPath();
    context.arc(x, y, radius + phase * 35, -0.5, 0.6);
    context.stroke();
  }
  context.restore();
}

let previousTelemetry = {
  outputRpm: 0,
  pressureMPa: 0,
  tempC: 0,
  vibration: 0,
};

function trendFor(value, previous, threshold = 0.03) {
  const delta = value - previous;
  if (Math.abs(delta) <= threshold) return { symbol: "→", className: "" };
  return { symbol: delta > 0 ? "↗" : "↘", className: delta > 0 ? "up" : "down" };
}

function renderTelemetry(state) {
  const geometry = currentGeometry();
  const output = state.outputRpm || 0;
  const pressure = state.pressureMPa || 0;
  const temperature = state.tempC ?? LIMITS.ambient;
  const vibration = state.vibration || 0;
  const noise = state.noiseDb || 0;
  const ratio = Number.isFinite(geometry.ratio) ? geometry.ratio : 0;
  const outputTrend = trendFor(output, previousTelemetry.outputRpm, 0.08);
  const pressureTrend = trendFor(pressure, previousTelemetry.pressureMPa, 0.001);
  const tempTrend = trendFor(temperature, previousTelemetry.tempC, 0.01);
  const vibrationTrend = trendFor(vibration, previousTelemetry.vibration, 0.02);
  const load = controls.loadNm;

  const metrics = [
    { label: "OUTPUT SPEED", value: output.toFixed(1), unit: "rpm", trend: outputTrend },
    { label: "RATIO i", value: ratio.toFixed(3), unit: "fixed", trend: { symbol: "→", className: "" } },
    { label: "MESH PRESSURE", value: pressure.toFixed(2), unit: "MPa", trend: pressureTrend, alert: pressure > LIMITS.pressure * 0.9 },
    { label: "OIL TEMP", value: temperature.toFixed(1), unit: "°C", trend: tempTrend, alert: temperature > LIMITS.temperature * 0.9 },
    { label: "VIBRATION", value: vibration.toFixed(1), unit: "mm/s", trend: vibrationTrend, alert: vibration > 5 },
    { label: "LOAD TORQUE", value: load.toFixed(2), unit: "N·m", trend: { symbol: load > 3 ? "!" : "→", className: load > 3 ? "alert" : "" } },
  ];
  $("#metricStrip").innerHTML = metrics
    .map(
      (metric) => `
      <div class="metric ${metric.alert ? "alert" : ""}">
        <span>${metric.label}</span>
        <b>${metric.value}</b><small>${metric.unit}</small>
        <i class="trend">${metric.trend.symbol}</i>
      </div>`,
    )
    .join("");

  $("#stageInput").textContent = (state.inputRpm || 0).toFixed(1);
  $("#stageOutput").textContent = output.toFixed(1);
  $("#stageNoise").textContent = mode === "ready" ? "—" : noise.toFixed(0);
  $("#gaugeOutput").textContent = output.toFixed(1);
  const gaugeDelta = output - TARGET_OUTPUT_RPM;
  $("#gaugeDelta").textContent = mode === "ready" ? "等待启动" : `${formatSigned(gaugeDelta, 1)} RPM`;
  const fraction = clamp(output / 128, 0, 1);
  $("#targetNeedle").style.left = `${fraction * 100}%`;
  const low = (TARGET_OUTPUT_RPM - TARGET_TOLERANCE) / 128;
  const high = (TARGET_OUTPUT_RPM + TARGET_TOLERANCE) / 128;
  $("#targetZone").style.left = `${low * 100}%`;
  $("#targetZone").style.width = `${(high - low) * 100}%`;
  $("#livePressure").textContent = pressure.toFixed(2);
  $("#liveTemp").textContent = temperature.toFixed(1);
  $("#liveVibration").textContent = vibration.toFixed(1);
  $("#liveRatio").textContent = Number.isFinite(geometry.ratio) ? geometry.ratio.toFixed(3) : "—";
  $("#stateHash").textContent = stateHash(physical);

  updateLimitBar("#pressureBar", pressure / LIMITS.pressure, pressure > LIMITS.pressure);
  updateLimitBar("#tempBar", (temperature - LIMITS.ambient) / (LIMITS.temperature - LIMITS.ambient), temperature > LIMITS.temperature);
  updateLimitBar("#loadBar", load / LIMITS.loadSafe[1], load > LIMITS.loadSafe[1]);
  $("#loadLimitText").textContent = `${load.toFixed(2)} / ${LIMITS.loadSafe[1].toFixed(2)}`;

  const nearLimit = pressure > LIMITS.pressure * 0.9 || temperature > LIMITS.temperature * 0.9 || load > LIMITS.loadSafe[1];
  const tripped = physical.status === "failed";
  $("#safetyStatus").textContent = tripped ? "TRIP" : nearLimit ? "WARNING" : "NOMINAL";
  $("#safetyStatus").classList.toggle("alert", tripped || nearLimit);
  $("#systemState").textContent = statusLabel();
  $("#clockLabel").textContent = `T+ ${state.t.toFixed(3)} s`;
  $("#stageTitle").textContent =
    physical.status === "failed"
      ? physical.trigger?.title || "安全联锁"
      : physical.status === "success"
        ? "输出转速已锁定"
        : mode === "replay"
          ? "历史数据回放"
          : "三轴减速箱";
  $("#stageLight").style.background = tripped ? "#ff5964" : physical.status === "success" ? "#49d6cb" : mode === "paused" ? "#f3c85b" : "#49d6cb";
  $("#stageLight").style.boxShadow = `0 0 0 4px ${tripped ? "rgba(255,89,100,.1)" : "rgba(73,214,203,.1)"}, 0 0 15px ${tripped ? "#ff5964" : "#49d6cb"}`;
  const pulseDot = $(".pulse-dot");
  pulseDot.style.background = tripped ? "#ff5964" : "#49d6cb";
  pulseDot.style.boxShadow = `0 0 0 4px ${tripped ? "rgba(255,89,100,.1)" : "rgba(73,214,203,.1)"}, 0 0 15px ${tripped ? "#ff5964" : "#49d6cb"}`;

  previousTelemetry = {
    outputRpm: output,
    pressureMPa: pressure,
    tempC: temperature,
    vibration,
  };
}

function updateLimitBar(selector, normalized, alert) {
  const bar = $(selector);
  bar.style.width = `${clamp(normalized, 0, 1) * 100}%`;
  bar.classList.toggle("warn", normalized > 0.8 && !alert);
  bar.classList.toggle("alert", alert);
}

function statusLabel() {
  if (mode === "running") return "仿真运行";
  if (mode === "paused") return "积分暂停";
  if (mode === "replay") return "数据回放";
  if (mode === "replayDone") return "回放完成";
  if (physical.status === "success") return "目标达成";
  if (physical.status === "failed") return "安全联锁";
  return "系统待机";
}

function renderTriggerCard() {
  const trigger = physical.trigger;
  const card = $("#triggerCard");
  card.classList.toggle("alert", Boolean(trigger) && trigger.code !== "TARGET_REACHED");
  card.classList.toggle("success", trigger?.code === "TARGET_REACHED");
  if (!trigger) {
    $("#triggerTitle").textContent = "尚无触发";
    $("#triggerDetail").textContent = "安全联锁已就绪，越限后停止积分。";
    return;
  }
  $("#triggerTitle").textContent = trigger.title;
  $("#triggerDetail").textContent =
    `T+${trigger.time.toFixed(3)} s · 输出相位 ${trigger.positionDeg.toFixed(1)}° · `
    + `${trigger.speedRpm.toFixed(2)} RPM · ${trigger.pressureMPa.toFixed(2)} MPa · ${trigger.tempC.toFixed(1)} °C`;
}

function renderTransport() {
  const runButton = $("#runButton");
  const labels = {
    ready: ["启动仿真", "SPACE"],
    running: ["暂停仿真", "SPACE"],
    paused: ["恢复运行", "SPACE"],
    success: ["再次运行", "SPACE"],
    failed: ["重新运行", "SPACE"],
    replay: ["回放中", "—"],
    replayDone: ["再次运行", "SPACE"],
  };
  const [label, subLabel] = labels[mode] || labels.ready;
  $("#runLabel").textContent = label;
  $("#runSubLabel").textContent = subLabel;
  $("#runIcon").textContent = mode === "running" ? "Ⅱ" : mode === "paused" ? "▶" : mode === "replay" ? "▷" : "▶";
  runButton.classList.toggle("running", mode === "running" || mode === "paused");
  $("#stepButton").disabled = mode === "replay";
  $("#replayButton").disabled = !lastRun || mode === "running" || mode === "replay";
  $("#soundButton").disabled = false;
  $("#soundLabel").textContent = audio.enabled ? "声音开启" : "声音静音";
  $(".sound-icon").textContent = audio.enabled ? "◖" : "◌";
  $("#selectionHint").textContent = `安装至 ${AXES.find((axis) => axis.id === selectedAxis).label}`;
}

function drawTrendChart(state) {
  const { width, height } = configureCanvas(chart, chartCtx, 920, 190);
  const context = chartCtx;
  const samples = mode === "replay" || mode === "replayDone" ? lastRun?.samples || [] : trace;
  const padding = { left: 32, right: 12, top: 24, bottom: 23 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  context.fillStyle = "rgba(7, 13, 18, 0.48)";
  context.fillRect(0, 0, width, height);

  context.strokeStyle = "rgba(99, 128, 143, 0.11)";
  context.lineWidth = 1;
  for (let index = 0; index <= 4; index += 1) {
    const y = padding.top + (plotHeight / 4) * index;
    context.beginPath();
    context.moveTo(padding.left, y + 0.5);
    context.lineTo(width - padding.right, y + 0.5);
    context.stroke();
  }

  if (!samples.length) {
    context.fillStyle = "#465b68";
    context.font = '500 9px "SFMono-Regular", monospace';
    context.textAlign = "center";
    context.fillText("等待启动 · 固定步长遥测", width / 2, height / 2);
    context.textAlign = "start";
    return;
  }

  const maxTime = Math.max(2, samples.at(-1).t || 0);
  const xFor = (time) => padding.left + (time / maxTime) * plotWidth;
  const yFor = (value, maximum, minimum = 0) =>
    padding.top + (1 - clamp((value - minimum) / (maximum - minimum), 0, 1)) * plotHeight;
  const speedY = (value) => yFor(value, 128);
  const pressureY = (value) => yFor(value, 2.45);
  const tempY = (value) => yFor(value, LIMITS.temperature, LIMITS.ambient);

  const targetLow = yFor(TARGET_OUTPUT_RPM - TARGET_TOLERANCE, 128);
  const targetHigh = yFor(TARGET_OUTPUT_RPM + TARGET_TOLERANCE, 128);
  context.fillStyle = "rgba(255, 138, 61, 0.07)";
  context.fillRect(padding.left, targetHigh, plotWidth, Math.max(2, targetLow - targetHigh));
  context.strokeStyle = "rgba(255, 138, 61, 0.22)";
  context.setLineDash([4, 5]);
  const targetY = speedY(TARGET_OUTPUT_RPM);
  context.beginPath();
  context.moveTo(padding.left, targetY);
  context.lineTo(width - padding.right, targetY);
  context.stroke();
  context.setLineDash([]);

  drawSeries(context, samples, xFor, speedY, (sample) => sample.outputRpm, "#49d6cb", 1.7);
  drawSeries(context, samples, xFor, pressureY, (sample) => sample.pressureMPa, "#ff8a3d", 1.4);
  drawSeries(context, samples, xFor, tempY, (sample) => sample.tempC, "#f3c85b", 1.2);

  const trigger = state.trigger || physical.trigger || lastRun?.final?.trigger;
  if (trigger) {
    const eventX = xFor(trigger.time);
    context.strokeStyle = trigger.code === "TARGET_REACHED" ? "rgba(73,214,203,.7)" : "rgba(255,89,100,.8)";
    context.setLineDash([3, 3]);
    context.beginPath();
    context.moveTo(eventX, padding.top);
    context.lineTo(eventX, padding.top + plotHeight);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = trigger.code === "TARGET_REACHED" ? "#49d6cb" : "#ff7a83";
    context.font = '600 7px "SFMono-Regular", monospace';
    const labelX = Math.min(width - 72, eventX + 4);
    context.fillText(trigger.code === "TARGET_REACHED" ? "TARGET" : "TRIP", labelX, padding.top + 8);
  }

  if (mode === "replay" || mode === "replayDone") {
    const playX = xFor(state.t);
    context.strokeStyle = "rgba(230, 238, 242, 0.65)";
    context.beginPath();
    context.moveTo(playX, padding.top);
    context.lineTo(playX, padding.top + plotHeight);
    context.stroke();
  }

  context.fillStyle = "#465b68";
  context.font = '500 7px "SFMono-Regular", monospace';
  context.fillText("128", 7, padding.top + 3);
  context.fillText("64", 14, yFor(64, 128) + 2);
  context.fillText("0", 22, padding.top + plotHeight + 3);
  context.fillText("0 s", padding.left, height - 6);
  context.textAlign = "right";
  context.fillText(`${maxTime.toFixed(1)} s`, width - padding.right, height - 6);
  context.textAlign = "start";
}

function drawSeries(context, samples, xFor, yFor, selector, color, lineWidth) {
  context.beginPath();
  for (let index = 0; index < samples.length; index += 1) {
    const x = xFor(samples[index].t);
    const y = yFor(selector(samples[index]));
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  context.shadowColor = color;
  context.shadowBlur = 4;
  context.stroke();
  context.shadowBlur = 0;
}

function initAudio() {
  if (audio.context) {
    if (audio.context.state === "suspended") audio.context.resume();
    return;
  }
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  try {
    const context = new AudioContextClass();
    const master = context.createGain();
    const filter = context.createBiquadFilter();
    const hum = context.createOscillator();
    const harmonic = context.createOscillator();
    const humGain = context.createGain();
    const harmonicGain = context.createGain();
    const noiseGain = context.createGain();
    const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < channel.length; index += 1) {
      channel[index] = Math.sin(index * 12.9898) * 0.16 + Math.sin(index * 0.063) * 0.08;
    }
    const noise = context.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    master.gain.value = 0.0001;
    filter.type = "bandpass";
    filter.frequency.value = 420;
    filter.Q.value = 0.8;
    hum.type = "sawtooth";
    hum.frequency.value = 42;
    harmonic.type = "triangle";
    harmonic.frequency.value = 84;
    humGain.gain.value = 0.018;
    harmonicGain.gain.value = 0.011;
    noiseGain.gain.value = 0.0001;

    hum.connect(humGain).connect(filter);
    harmonic.connect(harmonicGain).connect(filter);
    noise.connect(noiseGain).connect(filter);
    filter.connect(master).connect(context.destination);
    hum.start();
    harmonic.start();
    noise.start();

    audio.context = context;
    audio.master = master;
    audio.hum = hum;
    audio.harmonic = harmonic;
    audio.noise = noise;
    audio.noiseGain = noiseGain;
    audio.filter = filter;
    context.resume();
  } catch {
    audio.context = null;
  }
}

function updateAudio(state) {
  if (!audio.context) return;
  const active = mode === "running" || mode === "replay";
  const now = audio.context.currentTime;
  const output = active ? state.outputRpm || 0 : 0;
  const pressure = active ? state.pressureMPa || 0 : 0;
  const vibration = active ? state.vibration || 0 : 0;
  const baseFrequency = 35 + output * 0.72 + pressure * 9;
  audio.hum.frequency.setTargetAtTime(baseFrequency, now, 0.08);
  audio.harmonic.frequency.setTargetAtTime(baseFrequency * 2.02, now, 0.08);
  audio.filter.frequency.setTargetAtTime(220 + pressure * 260 + vibration * 45, now, 0.12);
  const humLevel = active ? clamp(0.014 + pressure * 0.008, 0.01, 0.041) : 0.0001;
  audio.master.gain.setTargetAtTime(audio.enabled ? humLevel : 0.0001, now, 0.08);
  audio.noiseGain.gain.setTargetAtTime(active ? clamp(vibration * 0.0018, 0.0001, 0.012) : 0.0001, now, 0.1);
}

function toggleSound() {
  audio.enabled = !audio.enabled;
  if (audio.enabled) initAudio();
  renderTransport();
  showToast(audio.enabled ? "合成转动声已开启" : "声音已静音");
}

function bindEvents() {
  $("#gearSlots").addEventListener("click", (event) => {
    const slot = event.target.closest("[data-axis]");
    if (!slot) return;
    setSelectedAxis(slot.dataset.axis);
  });

  $("#gearLibrary").addEventListener("click", (event) => {
    const chip = event.target.closest("[data-teeth]");
    if (!chip || chip.disabled) return;
    installGear(Number(chip.dataset.teeth));
  });

  $("#scenarioList").addEventListener("click", (event) => {
    const card = event.target.closest("[data-scenario]");
    if (!card) return;
    const scenario = SCENARIOS.find((item) => item.id === card.dataset.scenario);
    if (scenario) applyScenario(scenario);
  });

  $("#clearGearsButton").addEventListener("click", () => {
    config = { input: null, idler: null, output: null };
    configureReset("拆下全部齿轮", "3 / 3 → 空位", "所有轴位已清空，等待重新装配");
  });

  $("#runButton").addEventListener("click", toggleRun);
  $("#stepButton").addEventListener("click", singleStep);
  $("#resetButton").addEventListener("click", () => {
    resetSimulation();
    addChange("系统重置", `T+ 0.000 s · ${stateHash(physical)}`, "初始条件恢复，积分器与相位归零", "↺");
    showToast(`已重置：初始哈希 ${stateHash(physical)}，漂移 ${resetDrift.toFixed(6)}`);
  });
  $("#replayButton").addEventListener("click", startReplay);
  $("#soundButton").addEventListener("click", toggleSound);
  $("#validateButton").addEventListener("click", () => runValidationSuite(true));

  $("#speedSlider").addEventListener("input", (event) => {
    const next = Number(event.target.value);
    const previous = controls.inputRpm;
    controls.inputRpm = next;
    $("#speedOutput").textContent = `${next} RPM`;
    if (mode === "ready") physical = createInitialState(config, controls);
    if (next < LIMITS.speedHard[0] || next > LIMITS.speedHard[1]) {
      $("#speedOutput").style.color = "#ff5964";
    } else {
      $("#speedOutput").style.color = "";
    }
    if (next !== previous) {
      addChange("输入转速调整", `${previous} → ${next} RPM`, `Δ ${formatSigned(next - previous, 0)} RPM`, "↻");
    }
  });

  $("#loadSlider").addEventListener("input", (event) => {
    const next = Number(event.target.value);
    const previous = controls.loadNm;
    controls.loadNm = next;
    $("#loadOutput").textContent = `${next.toFixed(2)} N·m`;
    $("#loadOutput").style.color = next > LIMITS.loadSafe[1] ? "#ff5964" : "";
    if (mode === "ready") physical = createInitialState(config, controls);
    if (Math.abs(next - previous) >= 0.049) {
      addChange("负载扭矩调整", `${previous.toFixed(2)} → ${next.toFixed(2)} N·m`, next > LIMITS.loadSafe[1] ? "超出建议负载包络" : "负载处于安全包络", "↻");
    }
  });

  document.addEventListener("keydown", (event) => {
    const tag = event.target.tagName;
    if (tag === "INPUT" || tag === "BUTTON" || tag === "TEXTAREA") return;
    if (event.code === "Space") {
      event.preventDefault();
      toggleRun();
    } else if (event.key.toLowerCase() === "n") {
      event.preventDefault();
      singleStep();
    } else if (event.key.toLowerCase() === "r") {
      event.preventDefault();
      resetSimulation();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && mode === "running") pauseRun();
  });

  window.addEventListener("resize", () => {
    drawScene(displayState, performance.now());
    drawTrendChart(displayState);
  });
}

function initialize() {
  document.documentElement.classList.add("ready");
  $("#speedOutput").textContent = `${controls.inputRpm} RPM`;
  $("#loadOutput").textContent = `${controls.loadNm.toFixed(2)} N·m`;
  $("#pressureBar").parentElement.style.setProperty("--limit", String(LIMITS.pressure));
  runValidationSuite(false);
  updateConfigReadouts();
  resetAnchor = null;
  resetSimulation();
  addChange("初始条件锁定", "28 / 40 / 42 T", "所有积分器归零，等待装配与启动", "◇");
  renderTransport();
  bindEvents();
  requestAnimationFrame((now) => {
    lastFrameTime = now;
    animationLoop(now);
  });
}

initialize();
