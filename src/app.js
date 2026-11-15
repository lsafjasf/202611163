import { CONFIG, applyControl, createInitialState, stepSimulation } from "./sim.js";
import { captureFrame, sampleFrames } from "./replay.js";
import { runValidationSuite } from "./validation.js";
import { SceneRenderer } from "./canvas.js";
import { HydraulicAudio } from "./audio.js";

const $ = (id) => document.getElementById(id);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const fmt = (value, digits = 2) => Number(value).toFixed(digits);

const dom = {
  statusPill: $("statusPill"),
  deadlineValue: $("deadlineValue"),
  tickValue: $("tickValue"),
  pauseButton: $("pauseButton"),
  stepButton: $("stepButton"),
  replayButton: $("replayButton"),
  resetButton: $("resetButton"),
  soundButton: $("soundButton"),
  eventBanner: $("eventBanner"),
  eventKicker: $("eventKicker"),
  eventTitle: $("eventTitle"),
  eventDetail: $("eventDetail"),
  resumeHint: $("resumeHint"),
  resumeText: $("resumeText"),
  tankAValue: $("tankAValue"),
  tankBValue: $("tankBValue"),
  pressureValue: $("pressureValue"),
  tempValue: $("tempValue"),
  loadValue: $("loadValue"),
  flowValue: $("flowValue"),
  tankABar: $("tankABar"),
  tankBBar: $("tankBBar"),
  pressureBar: $("pressureBar"),
  tempBar: $("tempBar"),
  loadBar: $("loadBar"),
  flowBar: $("flowBar"),
  tankATrend: $("tankATrend"),
  tankBTrend: $("tankBTrend"),
  pressureTrend: $("pressureTrend"),
  tempTrend: $("tempTrend"),
  loadTrend: $("loadTrend"),
  flowTrend: $("flowTrend"),
  changeTime: $("changeTime"),
  changeKind: $("changeKind"),
  changeText: $("changeText"),
  changeDetail: $("changeDetail"),
  triggerTag: $("triggerTag"),
  triggerEmpty: $("triggerEmpty"),
  triggerRecord: $("triggerRecord"),
  pumpAlarm: $("pumpAlarm"),
  limitSummary: $("limitSummary"),
  validationSummary: $("validationSummary"),
  validationList: $("validationList"),
  validateButton: $("validateButton"),
  hashValue: $("hashValue"),
  controls: [$("control0"), $("control1"), $("control2"), $("controlPump")],
  controlOuts: [$("controlOut0"), $("controlOut1"), $("controlOut2"), $("controlOutPump")],
  actuals: [$("actual0"), $("actual1"), $("actual2"), $("actualPump")],
  rpmValue: $("rpmValue")
};

const limitRows = {};
for (const row of document.querySelectorAll(".limit-row")) {
  limitRows[row.dataset.limit] = row;
}

const renderer = new SceneRenderer($("scene"));
const audio = new HydraulicAudio();
const initialHash = initialStateHash();

const app = {
  sim: createInitialState(),
  paused: false,
  accumulator: 0,
  liveFrames: [],
  lastRunFrames: null,
  lastRunTrip: null,
  replay: null,
  replayRestore: null,
  runFinalized: false,
  resumePulse: 0,
  realTime: 0,
  trendSample: null,
  trends: { A: 0, B: 0, pressure: 0, temperature: 0, load: 0, flow: 0 },
  validation: null,
  validating: false,
  lastTripKey: ""
};
app.liveFrames.push(captureFrame(app.sim));
dom.hashValue.textContent = initialHash;

function initialStateHash() {
  const state = createInitialState();
  const values = [
    state.tankA,
    state.tankB,
    state.pump,
    ...state.valves,
    state.temperature,
    state.pressure
  ];
  let hash = 0x811c9dc5;
  for (const value of values) {
    const scaled = Math.round(value * 10000);
    hash ^= scaled;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `SEED 0x${hash.toString(16).padStart(8, "0").toUpperCase()}`;
}

function recordLiveFrame() {
  app.liveFrames.push(captureFrame(app.sim));
  if (app.liveFrames.length > 6000) app.liveFrames.shift();
}

function finalizeRun() {
  if (app.runFinalized) return;
  app.runFinalized = true;
  app.lastRunFrames = app.liveFrames.slice();
  app.lastRunTrip = app.sim.trip;
  dom.stepButton.disabled = true;
}

function flowDirections(state) {
  return {
    A: state.flows.feed - state.flows.balance - state.flows.pumped,
    B: state.flows.balance + state.flows.pumped - state.flows.drain
  };
}

function trendSymbol(value, deadband = 0.00008) {
  if (value > deadband) return "↑";
  if (value < -deadband) return "↓";
  return "→";
}

function updateTrends(view) {
  if (!app.trendSample || view.time <= app.trendSample.time) {
    app.trendSample = {
      time: view.time,
      tankA: view.tankA,
      tankB: view.tankB,
      pressure: view.pressure,
      temperature: view.temperature,
      load: view.load,
      flow: view.flows.feed + view.flows.balance + view.flows.pumped + view.flows.drain
    };
    if (!app.trendSample || view.time === 0) {
      app.trends = { A: 0, B: 0, pressure: 0, temperature: 0, load: 0, flow: 0 };
    }
    return;
  }
  const previous = app.trendSample;
  const dt = view.time - previous.time;
  if (dt > 0.5) {
    app.trendSample = null;
    return;
  }
  const raw = {
    A: (view.tankA - previous.tankA) / dt,
    B: (view.tankB - previous.tankB) / dt,
    pressure: (view.pressure - previous.pressure) / dt,
    temperature: (view.temperature - previous.temperature) / dt,
    load: (view.load - previous.load) / dt,
    flow:
      (view.flows.feed + view.flows.balance + view.flows.pumped + view.flows.drain - previous.flow) / dt
  };
  const blend = clamp(dt * 8, 0.08, 0.75);
  for (const key of Object.keys(app.trends)) {
    app.trends[key] += (raw[key] - app.trends[key]) * blend;
  }
  app.trendSample = {
    time: view.time,
    tankA: view.tankA,
    tankB: view.tankB,
    pressure: view.pressure,
    temperature: view.temperature,
    load: view.load,
    flow: view.flows.feed + view.flows.balance + view.flows.pumped + view.flows.drain
  };
}

function currentPressureTrail(view) {
  let frames = app.replay ? app.replay.frames : app.liveFrames;
  if (!frames?.length) return [{ time: view.time, pressure: view.pressure }];
  if (app.replay) {
    let low = 0;
    let high = frames.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (frames[middle].time <= view.time) low = middle + 1;
      else high = middle;
    }
    frames = frames.slice(Math.max(0, low - 721), low);
  } else {
    frames = frames.slice(-721);
  }
  return frames.map((frame) => ({ time: frame.time, pressure: frame.pressure }));
}

function updateResumeHint(view) {
  if (app.resumePulse <= 0) {
    dom.resumeHint.hidden = true;
    return;
  }
  const directions = flowDirections(view);
  const pressure = app.trends.pressure;
  dom.resumeText.textContent = `泵推力 A → B · A 水位${trendSymbol(directions.A)} · B 水位${trendSymbol(
    directions.B
  )} · 压力${pressure > 0.2 ? "↗" : pressure < -0.2 ? "↘" : "→"}`;
  dom.resumeHint.hidden = false;
}

function setButtonLabel(button, label) {
  const spans = button.querySelectorAll("span");
  const last = spans[spans.length - 1];
  if (last) last.textContent = label;
}

function currentStatus(view) {
  if (app.replay) {
    if (app.replay.ended) return { text: "回放结束", className: "paused" };
    return { text: app.paused ? "回放暂停" : "回放中", className: app.paused ? "paused" : "success" };
  }
  if (view.status === "success") return { text: "任务达成", className: "success" };
  if (view.status === "trip") return { text: "保护触发", className: "trip" };
  if (view.status === "timeout") return { text: "截止超时", className: "timeout" };
  if (app.paused) return { text: "已暂停", className: "paused" };
  return { text: "运行中", className: "running" };
}

function displayTripFor(view) {
  if (app.replay) {
    if (!app.replay.ended) return null;
    return app.replay.trip;
  }
  return ["trip", "timeout"].includes(view.status) ? app.sim.trip : null;
}

function showEventBanner(view, trip) {
  const replayEnded = app.replay?.ended;
  if (app.replay && !replayEnded) {
    dom.eventBanner.hidden = true;
    return;
  }
  if (replayEnded) {
    const status = view.status;
    dom.eventBanner.hidden = false;
    dom.eventBanner.className = `event-banner${status === "success" ? " success" : ""}`;
    dom.eventKicker.textContent = "回放结束";
    if (status === "success") {
      dom.eventTitle.textContent = "回放结束 · 双箱达标";
      dom.eventDetail.textContent = `t=${fmt(view.time, 2)} s · A ${fmt(view.tankA)} m / B ${fmt(view.tankB)} m`;
    } else {
      dom.eventTitle.textContent = `回放结束 · ${trip?.label ?? "保护触发"}`;
      dom.eventDetail.textContent = trip
        ? `t=${fmt(trip.time, 2)} s · ${trip.value} / 上限 ${trip.limit} · 状态已冻结`
        : "记录播放完毕";
    }
    return;
  }
  if (view.status === "success") {
    dom.eventBanner.hidden = false;
    dom.eventBanner.className = "event-banner success";
    dom.eventKicker.textContent = "MISSION COMPLETE";
    dom.eventTitle.textContent = "双水箱已进入目标区间";
    dom.eventDetail.textContent = `t=${fmt(view.time, 2)} s · 保持 ${CONFIG.successHold.toFixed(1)} s · 物理计算已停止`;
    return;
  }
  if (view.status === "trip" && trip) {
    dom.eventBanner.hidden = false;
    dom.eventBanner.className = "event-banner";
    dom.eventKicker.textContent = "SAFETY INTERLOCK";
    dom.eventTitle.textContent = `保护触发 · ${trip.label}`;
    dom.eventDetail.textContent = `t=${fmt(trip.time, 2)} s · ${trip.value} / 上限 ${trip.limit} · 状态已冻结`;
    return;
  }
  if (view.status === "timeout") {
    dom.eventBanner.hidden = false;
    dom.eventBanner.className = "event-banner";
    dom.eventKicker.textContent = "DEADLINE REACHED";
    dom.eventTitle.textContent = "截止时间到达，双箱未达标";
    dom.eventDetail.textContent = `A ${fmt(view.tankA)} m / B ${fmt(view.tankB)} m · 物理计算已停止`;
    return;
  }
  dom.eventBanner.hidden = true;
}

function renderTriggerRecord(trip) {
  if (!trip) {
    dom.triggerEmpty.hidden = false;
    dom.triggerRecord.hidden = true;
    dom.triggerTag.textContent = "未触发";
    dom.triggerTag.className = "mini-tag idle";
    return;
  }
  const key = `${trip.time}-${trip.primary}-${trip.value}`;
  dom.triggerEmpty.hidden = true;
  dom.triggerRecord.hidden = false;
  dom.triggerTag.textContent = app.replay ? "回放记录" : "记录已冻结";
  dom.triggerTag.className = "mini-tag danger";
  if (key === app.lastTripKey) return;
  app.lastTripKey = key;
  const position = trip.position ?? {};
  const dynamics = trip.dynamics ?? {};
  const flows = dynamics.flows ?? {};
  const valveText = (position.valves ?? []).map((value) => `${Math.round(value * 100)}%`).join(" / ");
  const rows = [
    ["A / B 水位", `${fmt(position.tankA ?? 0)} / ${fmt(position.tankB ?? 0)} m`],
    ["阀位 G1/G2/G3", valveText || "—"],
    ["泵开度", `${Math.round((position.pump ?? 0) * 100)} %`],
    ["泵转速", `${fmt(dynamics.pumpRpm ?? 0, 0)} rpm`],
    ["阀指令速度", `${fmt(dynamics.valveRate ?? 0, 1)} /s`],
    ["压力", `${fmt(dynamics.pressure ?? 0, 1)} kPa`],
    ["温度", `${fmt(dynamics.temperature ?? 0, 1)} °C`],
    ["负载", `${fmt(dynamics.load ?? 0, 1)} kW`],
    ["流量 F/B/P/D", `${fmt(flows.feed ?? 0, 1)} / ${fmt(flows.balance ?? 0, 1)} / ${fmt(flows.pumped ?? 0, 1)} / ${fmt(flows.drain ?? 0, 1)} L/s`]
  ];
  dom.triggerRecord.innerHTML = [
    `<div class="record-lead">t=${fmt(trip.time, 2)} s · ${trip.label} ${trip.value} / 限值 ${trip.limit}</div>`,
    ...rows.map(([label, value]) => `<div><span>${label}</span><b>${value}</b></div>`)
  ].join("");
}

function updateLimits(view, trip) {
  const commandRate = view.commandRate ?? 0;
  const ratios = {
    pressure: view.pressure / CONFIG.limits.pressure,
    temperature: view.temperature / CONFIG.limits.temperature,
    load: view.load / CONFIG.limits.load,
    speed: view.pumpRpm / CONFIG.limits.pumpRpm,
    rate: commandRate / CONFIG.limits.valveRate
  };
  for (const [key, ratio] of Object.entries(ratios)) {
    const row = limitRows[key];
    if (!row) continue;
    row.classList.toggle("warning", ratio >= 0.82 && ratio < 1);
    row.classList.toggle("danger", ratio >= 1 || (key === "rate" && commandRate > CONFIG.safeValveRate));
    row.firstElementChild.nextElementSibling.firstElementChild.style.width = `${clamp(ratio * 100, 0, 100)}%`;
  }
  if (trip) {
    dom.limitSummary.textContent = trip.primary === "deadline" ? "截止超时" : "保护动作";
    dom.limitSummary.className = "mini-tag danger";
  } else if (view.dryRun) {
    dom.limitSummary.textContent = "干转预警";
    dom.limitSummary.className = "mini-tag warning";
  } else if (Object.values(ratios).some((ratio) => ratio >= 0.82)) {
    dom.limitSummary.textContent = "接近限值";
    dom.limitSummary.className = "mini-tag warning";
  } else {
    dom.limitSummary.textContent = "全部正常";
    dom.limitSummary.className = "mini-tag safe";
  }
}

function updateControls(view, trip) {
  const frozen = Boolean(app.replay) || view.status !== "running";
  const targets = [...view.valveTargets, view.pumpTarget];
  const actuals = [...view.valves, view.pump];
  dom.controls.forEach((input, index) => {
    const target = clamp(targets[index], 0, 1);
    const percent = Math.round(target * 100);
    if (Number(input.value) !== percent) input.value = String(percent);
    input.disabled = frozen;
    input.style.setProperty("--fill", `${percent}%`);
    dom.controlOuts[index].textContent = `${percent}%`;
    dom.actuals[index].textContent = `${Math.round(actuals[index] * 100)}%`;
    input.closest(".control")?.classList.toggle("pending", Math.abs(target - actuals[index]) > 0.02);
  });
  for (const button of document.querySelectorAll(".nudges button")) {
    button.disabled = frozen;
  }
  dom.rpmValue.textContent = String(Math.round(view.pumpRpm));
  dom.pumpAlarm.hidden = !view.dryRun;
  updateLimits(view, trip);
}

function updateValidationSummary() {
  if (app.validating) {
    dom.validationSummary.className = "validation-summary";
    dom.validationSummary.innerHTML = '<span class="spinner"></span><div><strong>正在校验</strong><p>正常 / 极限 / 失稳 / 确定性</p></div>';
    return;
  }
  if (!app.validation) return;
  const passed = app.validation.checks.filter((check) => check.passed).length;
  const all = app.validation.checks.length;
  dom.validationSummary.className = `validation-summary${app.validation.passed ? "" : " failed"}`;
  dom.validationSummary.innerHTML = `<span class="summary-icon">${app.validation.passed ? "✓" : "!"}</span><div><strong>${
    app.validation.passed ? "全部校验通过" : "存在校验失败"
  }</strong><p>${passed} / ${all} 项 · 确定性回放与保护边界已检查</p></div>`;
}

function renderValidation() {
  updateValidationSummary();
  if (!app.validation) return;
  dom.validationList.innerHTML = "";
  for (const check of app.validation.checks) {
    const row = document.createElement("div");
    row.className = `validation-row${check.passed ? "" : " failed"}`;
    const state = document.createElement("span");
    state.className = "validation-state";
    state.textContent = check.passed ? "✓" : "!";
    const copy = document.createElement("div");
    copy.className = "validation-copy";
    const title = document.createElement("strong");
    title.textContent = check.label;
    const detail = document.createElement("p");
    detail.textContent = check.detail;
    copy.append(title, detail);
    row.append(state, copy);
    const scenario = app.validation.scenarios[check.id];
    if (scenario?.frames?.length > 1) {
      const replay = document.createElement("button");
      replay.type = "button";
      replay.className = "replay-mini";
      replay.textContent = "回放";
      replay.addEventListener("click", () => startReplay(scenario.frames, scenario.state.trip, scenario.name));
      row.append(replay);
    }
    dom.validationList.append(row);
  }
}

function updateHUD(view) {
  const trip = displayTripFor(view);
  const status = currentStatus(view);
  dom.statusPill.className = `status-pill ${status.className}`;
  dom.statusPill.innerHTML = `<i></i>${status.text}`;

  if (app.replay) {
    dom.deadlineValue.innerHTML = `${fmt(view.time, 1)} <small>/ ${fmt(app.replay.duration, 1)} s</small>`;
  } else {
    dom.deadlineValue.innerHTML = `${fmt(Math.max(0, CONFIG.deadline - view.time), 1)} <small>s</small>`;
  }
  dom.tickValue.textContent = `STEP ${String(view.tick).padStart(6, "0")}`;

  dom.tankAValue.textContent = fmt(view.tankA);
  dom.tankBValue.textContent = fmt(view.tankB);
  dom.pressureValue.textContent = fmt(view.pressure, 0);
  dom.tempValue.textContent = fmt(view.temperature, 1);
  dom.loadValue.textContent = fmt(view.load, 1);
  const totalFlow = view.flows.feed + view.flows.balance + view.flows.pumped + view.flows.drain;
  dom.flowValue.textContent = fmt(totalFlow, 1);

  dom.tankABar.style.width = `${clamp((view.tankA / CONFIG.tankA.height) * 100, 0, 100)}%`;
  dom.tankBBar.style.width = `${clamp((view.tankB / CONFIG.tankB.height) * 100, 0, 100)}%`;
  dom.pressureBar.style.width = `${clamp((view.pressure / (CONFIG.limits.pressure * 1.25)) * 100, 0, 100)}%`;
  dom.tempBar.style.width = `${clamp((view.temperature / (CONFIG.limits.temperature * 1.25)) * 100, 0, 100)}%`;
  dom.loadBar.style.width = `${clamp((view.load / (CONFIG.limits.load * 1.25)) * 100, 0, 100)}%`;
  dom.flowBar.style.width = `${clamp((totalFlow / 320) * 100, 0, 100)}%`;

  dom.tankATrend.textContent = `${trendSymbol(app.trends.A * 1000, 0.08)} ${fmt(Math.abs(app.trends.A * 1000), 1)}`;
  dom.tankBTrend.textContent = `${trendSymbol(app.trends.B * 1000, 0.08)} ${fmt(Math.abs(app.trends.B * 1000), 1)}`;
  dom.pressureTrend.textContent = `${app.trends.pressure > 0.2 ? "↗" : app.trends.pressure < -0.2 ? "↘" : "→"} ${fmt(
    Math.abs(app.trends.pressure),
    0
  )}`;
  dom.tempTrend.textContent = `${trendSymbol(app.trends.temperature, 0.01)} ${fmt(Math.abs(app.trends.temperature), 2)}`;
  dom.loadTrend.textContent = `${trendSymbol(app.trends.load, 0.01)} ${fmt(Math.abs(app.trends.load), 1)}`;
  dom.flowTrend.textContent = `${trendSymbol(app.trends.flow, 0.05)} ${fmt(Math.abs(app.trends.flow), 1)}`;

  if (view.latestChange) {
    const change = view.latestChange;
    dom.changeTime.textContent = `T+${fmt(change.time, 2)}`;
    dom.changeKind.textContent = change.kind.toUpperCase();
    dom.changeKind.className = `change-kind ${change.kind}`;
    dom.changeText.textContent = change.text;
    dom.changeDetail.textContent = change.detail || "控制目标已更新";
  }

  updateControls(view, trip);
  renderTriggerRecord(trip);
  showEventBanner(view, trip);
  updateResumeHint(view);

  const replayEnded = app.replay?.ended;
  dom.pauseButton.disabled = replayEnded || (!app.replay && view.status !== "running");
  setButtonLabel(dom.pauseButton, app.paused ? "继续" : "暂停");
  dom.stepButton.disabled = !app.paused || replayEnded || (!app.replay && view.status !== "running");
  dom.replayButton.disabled = !app.replay && !app.lastRunFrames;
  setButtonLabel(dom.replayButton, app.replay ? "退出回放" : "回放");
  document.body.classList.toggle("replay-mode", Boolean(app.replay));
}

function triggerResumeHint(view) {
  app.resumePulse = 1.35;
  const directions = flowDirections(view);
  dom.resumeText.textContent = `泵推力 A → B · A 水位${trendSymbol(directions.A)} · B 水位${trendSymbol(directions.B)}`;
  dom.resumeHint.hidden = false;
}

function togglePause() {
  if (app.replay?.ended) return;
  if (app.replay) {
    app.paused = !app.paused;
    return;
  }
  if (app.sim.status !== "running") return;
  app.paused = !app.paused;
  app.accumulator = 0;
  if (!app.paused) {
    triggerResumeHint(app.sim);
  } else {
    app.resumePulse = 0;
    dom.resumeHint.hidden = true;
  }
}

function stepOnce() {
  if (!app.paused) return;
  app.accumulator = 0;
  if (app.replay) {
    if (app.replay.ended) return;
    app.replay.cursor = Math.min(app.replay.duration, app.replay.cursor + CONFIG.dt);
    if (app.replay.cursor >= app.replay.duration - 1e-9) app.replay.ended = true;
    return;
  }
  if (app.sim.status !== "running") return;
  app.sim = stepSimulation(app.sim);
  recordLiveFrame();
  if (app.sim.status !== "running") finalizeRun();
}

function startReplay(frames, trip, label) {
  if (!frames || frames.length < 2) return;
  if (!app.replay) {
    app.replayRestore = {
      sim: app.sim,
      paused: app.paused,
      liveFrames: app.liveFrames,
      runFinalized: app.runFinalized
    };
  }
  app.replay = {
    frames,
    cursor: 0,
    duration: frames[frames.length - 1].time,
    trip: trip ?? null,
    label: label || "回放",
    ended: false
  };
  app.paused = false;
  app.accumulator = 0;
  app.resumePulse = 0;
  app.trendSample = null;
  app.lastTripKey = "";
  dom.resumeHint.hidden = true;
}

function exitReplay() {
  if (!app.replay) return;
  const restore = app.replayRestore;
  app.replay = null;
  app.replayRestore = null;
  app.accumulator = 0;
  app.trendSample = null;
  app.lastTripKey = "";
  if (restore) {
    app.sim = restore.sim;
    app.paused = restore.paused;
    app.liveFrames = restore.liveFrames;
    app.runFinalized = restore.runFinalized;
  }
  document.body.classList.remove("replay-mode");
}

function resetSimulation() {
  exitReplay();
  app.sim = createInitialState();
  app.paused = false;
  app.accumulator = 0;
  app.liveFrames = [captureFrame(app.sim)];
  app.runFinalized = false;
  app.resumePulse = 0;
  app.trendSample = null;
  app.trends = { A: 0, B: 0, pressure: 0, temperature: 0, load: 0, flow: 0 };
  app.lastTripKey = "";
  dom.resumeHint.hidden = true;
  dom.eventBanner.hidden = true;
  dom.hashValue.textContent = initialHash;
}

function applyUserControl(channel, percent) {
  if (app.replay || app.sim.status !== "running") return;
  app.sim = applyControl(app.sim, channel, percent / 100);
}

for (const input of dom.controls) {
  input.addEventListener("input", () => {
    const index = Array.from(dom.controls).indexOf(input);
    applyUserControl(index === 3 ? "pump" : index, Number(input.value));
  });
}

for (const button of document.querySelectorAll(".nudges button")) {
  button.addEventListener("click", () => {
    const channel = button.dataset.channel;
    const index = channel === "pump" ? 3 : Number(channel);
    const current = channel === "pump" ? app.sim.pumpTarget : app.sim.valveTargets[index];
    applyUserControl(channel === "pump" ? "pump" : index, clamp(current * 100 + Number(button.dataset.delta), 0, 100));
  });
}

dom.pauseButton.addEventListener("click", togglePause);
dom.stepButton.addEventListener("click", stepOnce);
dom.resetButton.addEventListener("click", resetSimulation);
dom.replayButton.addEventListener("click", () => {
  if (app.replay) exitReplay();
  else if (app.lastRunFrames) startReplay(app.lastRunFrames, app.lastRunTrip, "最近一次运行");
});

dom.soundButton.addEventListener("click", async () => {
  try {
    const enabled = await audio.toggle();
    dom.soundButton.classList.toggle("audio-on", enabled);
    dom.soundButton.setAttribute("aria-pressed", String(enabled));
    dom.soundButton.title = enabled ? "关闭声音" : "开启声音";
  } catch {
    dom.soundButton.disabled = true;
    dom.soundButton.title = "当前浏览器不支持 Web Audio";
  }
});

document.addEventListener("keydown", (event) => {
  if (event.repeat || ["INPUT", "TEXTAREA"].includes(event.target?.tagName)) return;
  if (event.code === "Space") {
    event.preventDefault();
    togglePause();
  } else if (event.key.toLowerCase() === "n") {
    event.preventDefault();
    stepOnce();
  } else if (event.key.toLowerCase() === "r") {
    event.preventDefault();
    resetSimulation();
  } else if (event.key === "Escape" && app.replay) {
    exitReplay();
  }
});

async function runValidation() {
  if (app.validating) return;
  app.validating = true;
  dom.validateButton.disabled = true;
  dom.validateButton.textContent = "校验中…";
  updateValidationSummary();
  await new Promise((resolve) => setTimeout(resolve, 40));
  try {
    app.validation = runValidationSuite();
  } catch (error) {
    app.validation = {
      passed: false,
      checks: [
        {
          id: "validation-error",
          label: "校验执行失败",
          passed: false,
          detail: String(error?.message ?? error)
        }
      ],
      scenarios: {}
    };
  }
  app.validating = false;
  dom.validateButton.disabled = false;
  dom.validateButton.textContent = "重新运行";
  renderValidation();
}

dom.validateButton.addEventListener("click", runValidation);

let lastFrameTime = performance.now();
let audioTick = 0;

function animationFrame(now) {
  const realDt = Math.min(0.08, Math.max(0, (now - lastFrameTime) / 1000));
  lastFrameTime = now;
  app.realTime += realDt;

  if (app.replay) {
    if (!app.paused && !app.replay.ended) {
      app.replay.cursor = Math.min(app.replay.duration, app.replay.cursor + realDt);
      if (app.replay.cursor >= app.replay.duration - 1e-9) {
        app.replay.cursor = app.replay.duration;
        app.replay.ended = true;
      }
    }
  } else if (!app.paused && app.sim.status === "running") {
    app.accumulator += realDt;
    let steps = 0;
    while (app.accumulator >= CONFIG.dt && steps < 10) {
      app.sim = stepSimulation(app.sim);
      recordLiveFrame();
      app.accumulator -= CONFIG.dt;
      steps += 1;
      if (app.sim.status !== "running") {
        app.accumulator = 0;
        finalizeRun();
        break;
      }
    }
  }
  app.resumePulse = Math.max(0, app.resumePulse - realDt);

  const view = app.replay ? sampleFrames(app.replay.frames, app.replay.cursor) : app.sim;
  updateTrends(view);
  updateHUD(view);
  renderer.draw(view, {
    paused: app.paused || Boolean(app.replay?.ended),
    replay: Boolean(app.replay),
    resumePulse: app.resumePulse,
    trends: app.trends,
    pressureTrail: currentPressureTrail(view),
    realTime: app.realTime
  });

  audioTick += 1;
  if (audioTick % 2 === 0) {
    audio.setPhysics(view, {
      paused: app.paused || Boolean(app.replay?.ended),
      dryRun: view.dryRun
    });
  }
  requestAnimationFrame(animationFrame);
}

renderer.draw(app.sim, {
  paused: false,
  replay: false,
  resumePulse: 0,
  trends: app.trends,
  pressureTrail: currentPressureTrail(app.sim),
  realTime: 0
});
updateHUD(app.sim);
setTimeout(runValidation, 180);
requestAnimationFrame(animationFrame);
