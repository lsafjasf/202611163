import "./styles.css";
import { SoundEngine } from "./audio.js";
import { ROLES, SIDE_KEYS, TARGETS, RISK_ZONES } from "./config.js";
import { FieldLinkGame, formatTime, seatLabel } from "./game.js";
import { SurveyMap } from "./map.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const elements = {
  canvas: $("#mapCanvas"),
  canvasFrame: $("#canvasFrame"),
  soundBtn: $("#soundBtn"),
  soundLabel: $("#soundLabel"),
  pauseBtn: $("#pauseBtn"),
  restartBtn: $("#restartBtn"),
  rotateBtn: $("#rotateBtn"),
  debugBtn: $("#debugBtn"),
  zoomIn: $("#zoomIn"),
  zoomOut: $("#zoomOut"),
  zoomLabel: $("#zoomLabel"),
  coordText: $("#coordText"),
  mapStatus: $("#mapStatus"),
  activeHint: $("#activeHint"),
  hintRole: $("#hintRole"),
  hintText: $("#hintText"),
  toast: $("#toast"),
  countdown: $("#countdown"),
  timerBar: $("#timerBar"),
  timerProgress: $(".timer-progress"),
  sessionState: $("#sessionState"),
  roleAssignment: $("#roleAssignment"),
  taskPercent: $("#taskPercent"),
  taskProgressBar: $("#taskProgressBar"),
  pointsProgress: $("#pointsProgress"),
  routesProgress: $("#routesProgress"),
  risksProgress: $("#risksProgress"),
  objectivePoints: $("#objectivePoints"),
  objectiveRoutes: $("#objectiveRoutes"),
  objectiveRisks: $("#objectiveRisks"),
  scoreValue: $("#scoreValue"),
  teamSignal: $("#teamSignal"),
  teamSignalBar: $("#teamSignalBar"),
  duplicateCount: $("#duplicateCount"),
  conflictCount: $("#conflictCount"),
  recoveryCount: $("#recoveryCount"),
  recoveryState: $("#recoveryState"),
  linkPulse: $("#linkPulse"),
  viewportReadout: $("#viewportReadout"),
  miniTimeline: $("#miniTimeline"),
  openReplayBtn: $("#openReplayBtn"),
  announcer: $("#announcer"),
  pauseOverlay: $("#pauseOverlay"),
  resultOverlay: $("#resultOverlay"),
  resultCard: $("#resultCard"),
  resultMark: $("#resultMark"),
  resultEyebrow: $("#resultEyebrow"),
  resultTitle: $("#resultTitle"),
  resultReason: $("#resultReason"),
  resultScore: $("#resultScore"),
  resultTime: $("#resultTime"),
  resultConflicts: $("#resultConflicts"),
  replayOverlay: $("#replayOverlay"),
  replayStatus: $("#replayStatus"),
  replayRoles: $("#replayRoles"),
  replayConflictCount: $("#replayConflictCount"),
  replayEventCount: $("#replayEventCount"),
  conflictIndex: $("#conflictIndex"),
  replayEvents: $("#replayEvents"),
  helpOverlay: $("#helpOverlay"),
  helpBtn: $("#helpBtn"),
  leftCard: $("#leftPlayerCard"),
  rightCard: $("#rightPlayerCard"),
  leftRoleSymbol: $("#leftRoleSymbol"),
  rightRoleSymbol: $("#rightRoleSymbol"),
  leftRoleName: $("#leftRoleName"),
  rightRoleName: $("#rightRoleName"),
  leftRoleDescription: $("#leftRoleDescription"),
  leftStatValue: $("#leftStatValue"),
  leftStatTotal: $("#leftStatTotal"),
  leftStatLabel: $("#leftStatLabel"),
  leftProgressBar: $("#leftProgressBar"),
  leftInstrumentStatus: $("#leftInstrumentStatus"),
  leftSignal: $("#leftSignal"),
  leftSignalBars: $("#leftSignalBars"),
  leftLastSync: $("#leftLastSync"),
  leftKeyGuide: $("#leftKeyGuide"),
  rightStatValue: $("#rightStatValue"),
  rightStatTotal: $("#rightStatTotal"),
  rightProgressBar: $("#rightProgressBar"),
  rightInstrumentStatus: $("#rightInstrumentStatus"),
  rightSignal: $("#rightSignal"),
  rightLastSync: $("#rightLastSync"),
  rightKeyGuide: $("#rightKeyGuide"),
};

const audio = new SoundEngine();
const map = new SurveyMap(elements.canvas);
const pressedKeys = new Set();
const REPLAY_STORAGE_KEY = "field-link-replay-v1";
let archives = loadArchives();
let toastTimer = null;
let lastHudUpdate = 0;
let lastFrame = performance.now();
let gameReady = false;

function loadArchives() {
  try {
    const stored = localStorage.getItem(REPLAY_STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.slice(0, 8) : [];
  } catch {
    return [];
  }
}

function saveArchive(record) {
  archives = [
    record,
    ...archives.filter((candidate) => candidate.id !== record.id),
  ].slice(0, 8);
  try {
    localStorage.setItem(REPLAY_STORAGE_KEY, JSON.stringify(archives));
  } catch {
    // The in-memory archive remains available when storage is blocked.
  }
  refreshReplayAvailability();
}

function refreshReplayAvailability() {
  const latest = archives[0];
  elements.openReplayBtn.title = latest
    ? `最近归档：${latest.id} · ${latest.events.length} 条事件`
    : "当前会话尚未归档";
}

const game = new FieldLinkGame({
  onChange() {
    if (gameReady) updateHUD(true);
  },
  onToast(message, kind) {
    showToast(message, kind);
  },
  onSound(name) {
    if (gameReady) audio.play(name);
  },
  onArchive(record) {
    saveArchive(record);
  },
  onResult(result) {
    showResult(result);
  },
  onReset(state, options) {
    audio.reset();
    pressedKeys.clear();
    map.resetView();
    elements.pauseOverlay.hidden = true;
    elements.resultOverlay.hidden = true;
    elements.helpOverlay.hidden = true;
    elements.replayOverlay.hidden = true;
    document.body.classList.remove("body-paused", "body-result");
    updateDebugClass(state);
    updateMapChrome();
    updateCoordinate(state.cursorReadout.x, state.cursorReadout.y);
    updateHUD(true);
    if (options.rotation) {
      elements.announcer.textContent = "职责已轮换，双方仪表与任务已重置";
    }
  },
});
gameReady = true;

function updateDebugClass(state = game.state) {
  document.body.classList.toggle("debug-active", state.debug);
  elements.debugBtn.classList.toggle("active", state.debug);
  elements.debugBtn.innerHTML = state.debug
    ? '<span aria-hidden="true">⌁</span> 退出调试'
    : '<span aria-hidden="true">⌁</span> 单人调试';
  elements.rotateBtn.disabled = state.debug;
}

function showToast(message, kind = "info") {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.className = `toast visible ${kind}`;
  elements.announcer.textContent = message;
  toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("visible");
  }, 3100);
}

for (let index = 0; index < 12; index += 1) {
  elements.leftSignalBars.append(document.createElement("i"));
}

function rolePanelData(state, side) {
  const role =
    state.debug && side === "left"
      ? state.debugRole
      : state.debug && side === "right"
        ? state.debugRole === "surveyor"
          ? "cartographer"
          : "surveyor"
        : state.roleMap[side];
  const config = ROLES[role];
  const count =
    role === "surveyor" ? state.points.length : state.routes.length + state.risks.length;
  return {
    role,
    config,
    count,
    total: config.personalTotal,
    progress: Math.min(1, count / config.personalTotal),
  };
}

function updateHUD(force = false) {
  const state = game.state;
  const now = performance.now();
  if (!force && now - lastHudUpdate < 55) return;
  lastHudUpdate = now;

  const left = rolePanelData(state, "left");
  const right = rolePanelData(state, "right");
  elements.leftRoleName.textContent = left.config.name;
  elements.rightRoleName.textContent = right.config.name;
  elements.leftRoleDescription.textContent = left.config.description;
  elements.leftStatValue.textContent = left.count;
  elements.leftStatTotal.textContent = `/ ${left.total}`;
  elements.leftStatLabel.textContent = left.config.personalLabel;
  elements.leftProgressBar.style.width = `${left.progress * 100}%`;
  elements.rightStatValue.textContent = right.count;
  elements.rightStatTotal.textContent = `/ ${right.total}`;
  elements.rightProgressBar.style.width = `${right.progress * 100}%`;
  elements.leftRoleSymbol.textContent = left.config.symbol;
  elements.rightRoleSymbol.textContent = right.config.symbol;
  elements.leftRoleSymbol.className = `role-symbol ${
    left.role === "surveyor" ? "surveyor-symbol" : "cartographer-symbol"
  }`;
  elements.rightRoleSymbol.className = `role-symbol ${
    right.role === "surveyor" ? "surveyor-symbol" : "cartographer-symbol"
  }`;

  const signal = Math.round(state.signal);
  elements.leftSignal.textContent = `${signal}%`;
  elements.rightSignal.textContent = `${signal}%`;
  elements.teamSignal.innerHTML = `${signal}<small>%</small>`;
  elements.teamSignalBar.style.width = `${state.signal}%`;
  const litBars = Math.ceil((state.signal / 100) * 12);
  [...elements.leftSignalBars.children].forEach((bar, index) => {
    bar.style.opacity = index < litBars ? "1" : "0.18";
  });

  const lastMessage = state.lastAction
    ? `${seatLabel(state.lastAction.actor)} · ${state.lastAction.message}`
    : "等待双方提交首个标注…";
  elements.leftLastSync.textContent = lastMessage;
  elements.rightLastSync.textContent = lastMessage;
  elements.leftInstrumentStatus.textContent =
    state.lastAction?.role === left.role ? "同步更新" : "监听中";
  elements.rightInstrumentStatus.textContent =
    state.lastAction?.role === right.role ? "同步更新" : "监听中";

  elements.pointsProgress.textContent = `${state.points.length}/4`;
  elements.routesProgress.textContent = `${state.routes.length}/3`;
  elements.risksProgress.textContent = `${state.risks.length}/2`;
  elements.objectivePoints.classList.toggle("complete", state.points.length >= 4);
  elements.objectiveRoutes.classList.toggle("complete", state.routes.length >= 3);
  elements.objectiveRisks.classList.toggle("complete", state.risks.length >= 2);
  const completion =
    ((Math.min(4, state.points.length) / 4 +
      Math.min(3, state.routes.length) / 3 +
      Math.min(2, state.risks.length) / 2) /
      3) *
    100;
  elements.taskPercent.textContent = `${Math.round(completion)}%`;
  elements.taskProgressBar.style.width = `${completion}%`;
  elements.scoreValue.textContent = Math.round(state.score);
  elements.duplicateCount.textContent = state.metrics.duplicates;
  elements.conflictCount.textContent = state.metrics.conflicts;
  elements.recoveryCount.textContent = state.metrics.recoveries;

  if (state.recovery.active) {
    elements.recoveryState.classList.add("alert");
    elements.recoveryState.innerHTML =
      "<span><i></i> 冲突待恢复</span><small>下一次有效操作将修正并 +2 评分</small>";
  } else {
    elements.recoveryState.classList.remove("alert");
    elements.recoveryState.innerHTML =
      "<span><i></i> 校验稳定</span><small>最近冲突将自动写入回放</small>";
  }

  elements.countdown.textContent = formatTime(Math.ceil(state.timeLeft));
  const timeRatio = Math.max(0, state.timeLeft / 150);
  elements.timerBar.style.width = `${timeRatio * 100}%`;
  elements.timerProgress.classList.toggle("low", state.timeLeft <= 30);

  const statusLabels = {
    running: "作业进行中",
    paused: "作业已暂停",
    success: "任务已完成",
    failed: "任务已失败",
  };
  elements.sessionState.textContent = statusLabels[state.status] ?? state.status;
  const leftAssignment = `${left.config.name}`;
  const rightAssignment = `${right.config.name}`;
  elements.roleAssignment.textContent = state.debug
    ? `单人调试 · 当前控制 ${leftAssignment} · Tab 切换`
    : `左席 P1 → ${leftAssignment} / 右席 P2 → ${rightAssignment}`;
  elements.mapStatus.innerHTML =
    state.status === "paused"
      ? "<i></i> 作业暂停 · 状态保留"
      : state.status === "success"
        ? "<i></i> 全部标注已同步"
        : state.status === "failed"
          ? "<i></i> 链路已冻结"
          : "<i></i> 两台终端在线";

  if (state.debug) {
    elements.hintRole.textContent = "单人调试";
    elements.hintText.textContent = `${left.config.hint} · Tab 切换职责`;
    elements.leftKeyGuide.innerHTML =
      "<span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 移动</span><span><kbd>F</kbd> 执行</span><span><kbd>G</kbd> 风险</span><span><kbd>Tab</kbd> 换职责</span><span><kbd>Z</kbd> 撤回</span>";
    elements.rightKeyGuide.innerHTML =
      "<span>由调试台托管</span><span><kbd>Tab</kbd> 切换控制</span>";
  } else {
    elements.hintRole.textContent = "双端作业";
    elements.hintText.textContent =
      "P1 靠近靶区按 F 布点 · P2 选点后按 Enter 连线 · R 标风险";
    elements.leftKeyGuide.innerHTML =
      "<span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 移动</span><span><kbd>F</kbd> 执行</span><span><kbd>Z</kbd> 撤回</span><span><kbd>G</kbd> 风险</span>";
    elements.rightKeyGuide.innerHTML =
      "<span><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> 移动</span><span><kbd>Enter</kbd> 连线</span><span><kbd>R</kbd> 风险</span><span><kbd>⌫</kbd> 撤回</span>";
  }

  updateDebugClass(state);
  updateMiniTimeline(state);
}

function updateMiniTimeline(state) {
  const events = state.events
    .filter((event) => !["session_start", "route_select"].includes(event.type))
    .slice(-5)
    .reverse();
  if (!events.length) {
    elements.miniTimeline.innerHTML =
      '<li class="empty-log">操作记录会在双方终端同步出现</li>';
    return;
  }
  elements.miniTimeline.replaceChildren(
    ...events.map((event) => {
      const item = document.createElement("li");
      if (event.conflict) item.classList.add("conflict");
      if (event.recovery) item.classList.add("recovery");
      const time = document.createElement("time");
      time.textContent = event.timecode;
      const text = document.createElement("p");
      text.textContent = `${event.actorLabel} · ${event.message}`;
      item.append(time, text);
      return item;
    }),
  );
}

function updateCoordinate(x, y) {
  elements.coordText.textContent = `E ${Math.round(x)
    .toString()
    .padStart(4, "0")} / N ${Math.round(y)
    .toString()
    .padStart(4, "0")}`;
}

function showResult(result) {
  const failure = !result.success;
  const leftRole = ROLES[game.state.roleMap.left].name;
  const rightRole = ROLES[game.state.roleMap.right].name;
  elements.resultCard.classList.toggle("failure", failure);
  elements.resultMark.textContent = failure ? "×" : "✓";
  elements.resultEyebrow.textContent = failure
    ? "SURVEY INTERRUPTED"
    : "SURVEY COMPLETE";
  elements.resultTitle.textContent = failure ? "任务失败" : "全部标注完成";
  elements.resultReason.textContent = failure
    ? `${result.reason}。${result.detail}`
    : `${result.reason} P1 完成${leftRole}职责，P2 完成${rightRole}职责，未完成任务的部分为 0。`;
  elements.resultScore.textContent = `${result.score}${result.grade ? ` · ${result.grade}` : ""}`;
  elements.resultTime.textContent = formatTime(result.elapsed);
  elements.resultConflicts.textContent = `${result.conflicts} / ${result.recoveries}`;
  elements.resultOverlay.hidden = false;
  document.body.classList.add("body-result");
  elements.announcer.textContent = failure
    ? `任务失败：${result.reason}`
    : `任务成功，最终评分 ${result.score}`;
}

function requestPause(force) {
  if (game.state.status === "success" || game.state.status === "failed") return;
  game.togglePause(force);
  const paused = game.state.status === "paused";
  elements.pauseOverlay.hidden = !paused;
  document.body.classList.toggle("body-paused", paused);
  updateHUD(true);
}

function closePlayOverlays() {
  elements.helpOverlay.hidden = true;
  elements.replayOverlay.hidden = true;
}

function currentReplayRecord() {
  const snapshot = game.snapshot;
  return {
    id: snapshot.sessionId,
    runNumber: snapshot.runNumber,
    startedAt: game.state.startedAt,
    archivedAt: new Date().toISOString(),
    reason: "当前会话 · 尚未归档",
    outcome: snapshot.status,
    debug: snapshot.debug,
    roleMap: snapshot.roleMap,
    elapsed: snapshot.elapsed,
    score: snapshot.score,
    signal: snapshot.signal,
    metrics: snapshot.metrics,
    result: snapshot.result,
    events: snapshot.events,
  };
}

function replayRecordToRender() {
  return archives[0] ?? currentReplayRecord();
}

function openReplay() {
  const record = replayRecordToRender();
  const outcomeLabels = {
    running: "进行中",
    paused: "已暂停",
    success: "任务成功",
    failed: "任务失败",
  };
  const outcomeLabel = outcomeLabels[record.outcome] ?? record.outcome;
  elements.replayStatus.textContent =
    record.reason && record.reason !== outcomeLabel
      ? `${outcomeLabel} · ${record.reason}`
      : outcomeLabel;
  const roles = record.roleMap ?? { left: "surveyor", right: "cartographer" };
  elements.replayRoles.textContent = `${record.debug ? "调试 · " : ""}P1 ${ROLES[roles.left].name} / P2 ${ROLES[roles.right].name}`;
  const conflictEvents = record.events.filter((event) => event.conflict);
  elements.replayConflictCount.textContent = `${conflictEvents.length} 条`;
  elements.replayEventCount.textContent = record.events.length;

  if (conflictEvents.length) {
    elements.conflictIndex.replaceChildren(
      ...conflictEvents.map((event) => {
        const item = document.createElement("li");
        const time = document.createElement("time");
        time.textContent = event.timecode;
        const text = document.createElement("p");
        text.textContent = `${event.actorLabel}：${event.message}`;
        item.append(time, text);
        return item;
      }),
    );
  } else {
    elements.conflictIndex.innerHTML = '<li class="empty-log">本轮暂无冲突</li>';
  }

  if (record.events.length) {
    elements.replayEvents.replaceChildren(
      ...record.events.map((event) => {
        const item = document.createElement("li");
        if (event.conflict) item.classList.add("conflict");
        if (event.recovery) item.classList.add("recovery");
        const time = document.createElement("time");
        time.textContent = event.timecode;
        const actor = document.createElement("span");
        actor.className = `event-actor ${
          event.recovery ? "recovery" : event.actor === "right" ? "right" : event.actor === "system" ? "system" : ""
        }`;
        actor.textContent =
          event.actor === "left"
            ? "P1"
            : event.actor === "right"
              ? "P2"
              : event.actor === "debug"
                ? "DBG"
                : "SYS";
        const text = document.createElement("p");
        text.textContent = event.message;
        item.append(time, actor, text);
        return item;
      }),
    );
  } else {
    elements.replayEvents.innerHTML = '<li class="empty-log">尚无事件</li>';
  }
  elements.replayOverlay.hidden = false;
  $("#replayTitle").textContent = record.archivedAt
    ? "完整协作回放"
    : "当前会话回放";
}

function toggleHelp(show) {
  elements.helpOverlay.hidden =
    typeof show === "boolean" ? !show : !elements.helpOverlay.hidden;
}

function updateSoundUI() {
  elements.soundLabel.textContent = audio.muted ? "音效关" : "音效开";
  elements.soundBtn.classList.toggle("muted", audio.muted);
  elements.soundBtn.setAttribute("aria-pressed", String(!audio.muted));
}

function sideForRole(role) {
  return Object.keys(game.state.roleMap).find(
    (side) => game.state.roleMap[side] === role,
  );
}

function setTargetCursor(role, targetId) {
  const target = TARGETS.find((candidate) => candidate.id === targetId);
  if (!target) throw new Error(`Unknown target: ${targetId}`);
  game.setCursor(role, target.x, target.y);
  return target;
}

function isOverlayOpen() {
  return (
    !elements.helpOverlay.hidden ||
    !elements.replayOverlay.hidden ||
    !elements.pauseOverlay.hidden
  );
}

function handleKeyDown(event) {
  const code = event.code;
  if (code === "Escape") {
    if (!elements.helpOverlay.hidden) {
      elements.helpOverlay.hidden = true;
      return;
    }
    if (!elements.replayOverlay.hidden) {
      elements.replayOverlay.hidden = true;
      return;
    }
    if (!elements.pauseOverlay.hidden) {
      requestPause(false);
      return;
    }
  }

  if (!elements.helpOverlay.hidden || !elements.replayOverlay.hidden) return;
  if (code === "KeyP" && !event.repeat && !event.metaKey && !event.ctrlKey) {
    event.preventDefault();
    audio.ensure();
    requestPause();
    return;
  }
  if (game.state.status !== "running" || !elements.pauseOverlay.hidden) return;

  if (code === "Tab" && game.state.debug) {
    event.preventDefault();
    if (!event.repeat) game.toggleDebugRole();
    return;
  }

  const movementCodes = new Set([
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "KeyW",
    "KeyA",
    "KeyS",
    "KeyD",
    "Backspace",
  ]);
  if (movementCodes.has(code)) event.preventDefault();
  pressedKeys.add(code);
  if (event.repeat) return;
  audio.ensure();

  if (game.state.debug) {
    if (code === "KeyF" || code === "Enter") game.performAction("left");
    else if (code === "KeyG" || code === "KeyR") game.performRisk("left");
    else if (code === "KeyZ" || code === "Backspace") game.performUndo("left");
    return;
  }

  if (code === SIDE_KEYS.left.action) game.performAction("left");
  else if (code === SIDE_KEYS.right.action) game.performAction("right");
  else if (code === SIDE_KEYS.left.risk) game.performRisk("left");
  else if (code === SIDE_KEYS.right.risk) game.performRisk("right");
  else if (code === SIDE_KEYS.left.undo) game.performUndo("left");
  else if (code === SIDE_KEYS.right.undo) game.performUndo("right");
}

function handleKeyUp(event) {
  pressedKeys.delete(event.code);
}

window.addEventListener("keydown", handleKeyDown);
window.addEventListener("keyup", handleKeyUp);
window.addEventListener("blur", () => pressedKeys.clear());
window.addEventListener("pointerdown", () => audio.ensure(), { passive: true });

elements.canvas.addEventListener("pointermove", (event) => {
  const rect = elements.canvas.getBoundingClientRect();
  const world = map.screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
  updateCoordinate(world.x, world.y);
});

elements.canvas.addEventListener("pointerleave", () => {
  const readout = game.state.cursorReadout;
  updateCoordinate(readout.x, readout.y);
});

elements.canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    const rect = elements.canvas.getBoundingClientRect();
    map.zoomBy(
      Math.exp(-event.deltaY * 0.0014),
      event.clientX - rect.left,
      event.clientY - rect.top,
    );
    updateMapChrome();
  },
  { passive: false },
);

function updateMapChrome() {
  elements.zoomLabel.textContent = `${Math.round(map.camera.zoom * 100)}%`;
  const visibleWidth = map.width / map.scale;
  const visibleHeight = map.height / map.scale;
  elements.viewportReadout.textContent = `${Math.round(visibleWidth)} × ${Math.round(
    visibleHeight,
  )} m`;
}

elements.zoomIn.addEventListener("click", () => {
  map.zoomBy(1.22);
  updateMapChrome();
  audio.play("ui");
});

elements.zoomOut.addEventListener("click", () => {
  map.zoomBy(1 / 1.22);
  updateMapChrome();
  audio.play("ui");
});

elements.soundBtn.addEventListener("click", () => {
  audio.ensure();
  audio.toggleMuted();
  updateSoundUI();
  if (!audio.muted) audio.play("ui");
  showToast(audio.muted ? "音效已关闭 · 操作反馈静音" : "音效已开启 · 确认提示恢复");
});

elements.pauseBtn.addEventListener("click", () => requestPause());
elements.restartBtn.addEventListener("click", () => {
  game.restart();
});
elements.rotateBtn.addEventListener("click", () => {
  if (!elements.rotateBtn.disabled) game.rotateRoles();
});
elements.debugBtn.addEventListener("click", () => game.toggleDebug());
elements.openReplayBtn.addEventListener("click", openReplay);
elements.helpBtn.addEventListener("click", () => toggleHelp(true));

$("#resumeBtn").addEventListener("click", () => requestPause(false));
$("#pauseRestartBtn").addEventListener("click", () => game.restart());
$("#pauseReplayBtn").addEventListener("click", openReplay);
$("#resultRestartBtn").addEventListener("click", () => game.restart());
$("#resultRotateBtn").addEventListener("click", () => game.rotateRoles());
$("#resultReplayBtn").addEventListener("click", openReplay);
$("#closeReplayBtn").addEventListener("click", () => {
  elements.replayOverlay.hidden = true;
});
$("#replayCloseFootBtn").addEventListener("click", () => {
  elements.replayOverlay.hidden = true;
});
$("#closeHelpBtn").addEventListener("click", () => toggleHelp(false));
$("#helpCloseFootBtn").addEventListener("click", () => toggleHelp(false));

let lastLoopHud = 0;
function animate(now) {
  const delta = Math.max(0, Math.min(0.1, (now - lastFrame) / 1000));
  lastFrame = now;
  game.moveFromInput(pressedKeys, delta);
  game.update(delta);
  map.draw(game.state, now);
  if (now - lastLoopHud > 110) {
    updateHUD(true);
    lastLoopHud = now;
  }
  requestAnimationFrame(animate);
}

function performKeyboardActionForTest(side) {
  game.performAction(side);
}

const api = {
  game,
  map,
  getState: () => game.snapshot,
  getAudioState: () => audio.getState(),
  getArchives: () => archives.map((record) => ({ ...record })),
  placeAt(targetId, side = sideForRole("surveyor")) {
    setTargetCursor("surveyor", targetId);
    if (game.state.debug) {
      if (game.state.debugRole !== "surveyor") {
        throw new Error("Debug role is not surveyor");
      }
      game.performAction("left");
    } else {
      game.performAction(side);
    }
  },
  connect(fromId, toId, side = sideForRole("cartographer")) {
    setTargetCursor("cartographer", fromId);
    if (game.state.debug) {
      if (game.state.debugRole !== "cartographer") {
        throw new Error("Debug role is not cartographer");
      }
      game.performAction("left");
    } else {
      game.performAction(side);
    }
    setTargetCursor("cartographer", toId);
    if (game.state.debug) game.performAction("left");
    else game.performAction(side);
  },
  markRiskAt(zoneId, side = sideForRole("cartographer")) {
    const zone = RISK_ZONES.find((candidate) => candidate.id === zoneId);
    if (!zone) throw new Error(`Unknown risk zone: ${zoneId}`);
    game.setCursor("cartographer", zone.x, zone.y);
    if (game.state.debug) {
      if (game.state.debugRole !== "cartographer") {
        throw new Error("Debug role is not cartographer");
      }
      game.performRisk("left");
    } else {
      game.performRisk(side);
    }
  },
  setCursor: (role, x, y) => game.setCursor(role, x, y),
  setDebugRole(role) {
    if (!game.state.debug) throw new Error("Not in debug mode");
    if (game.state.debugRole !== role) game.toggleDebugRole();
  },
  performKeyboardActionForTest,
  pause: requestPause,
  restart: () => game.restart(),
  rotate: () => game.rotateRoles(),
  toggleDebug: () => game.toggleDebug(),
  setTimeLeft: (seconds) => game.setTimeLeft(seconds),
  setSignal: (value) => game.setSignal(value),
  openReplay,
  getSnapshot: () => JSON.parse(JSON.stringify(game.snapshot)),
};

window.__FIELD_LINK__ = api;

map.resetView();
updateMapChrome();
updateSoundUI();
updateDebugClass();
updateHUD(true);
updateCoordinate(game.state.cursorReadout.x, game.state.cursorReadout.y);
refreshReplayAvailability();

const chromeObserver = new ResizeObserver(() => updateMapChrome());
chromeObserver.observe(elements.canvasFrame);

requestAnimationFrame(animate);
