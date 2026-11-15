import {
  WORLD,
  LIMITS,
  EMPTY_INPUT,
  makeRun,
  startRun,
  stepRun,
  captureSnapshot,
  createDemoReplays,
  simulateReplay,
  formatClock,
  clamp,
} from "./engine.js";
import { CanyonAudio } from "./audio.js";
import { CanyonRenderer } from "./renderer.js";

const STORAGE_KEY = "canyonRelay.replays.v1";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const bind = (root, name) => root.querySelector(`[data-bind="${name}"]`);

const TOTAL_GAUGE = 314;

function safeReadReplays() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

function safeWriteReplays(replays) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(replays.slice(0, 6)));
    return true;
  } catch {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(replays.slice(0, 2)));
      return true;
    } catch {
      return false;
    }
  }
}

function buildAssignments(swapped) {
  return {
    left: swapped
      ? {
          player: "P2",
          name: "收索手",
          station: "左岸 · WEST RIM",
          role: "控制主索：收放张力，把箱子送往中央。",
          keys: ["W", "S", "R"],
        }
      : {
          player: "P1",
          name: "收索手",
          station: "左岸 · WEST RIM",
          role: "控制主索：收放张力，把箱子送往中央。",
          keys: ["W", "S", "R"],
        },
    right: swapped
      ? {
          player: "P1",
          name: "引导手",
          station: "右岸 · EAST RIM",
          role: "控制引导索：移动落点，抵消侧风与横向漂移。",
          keys: ["←", "→", "↑", "↓", "P"],
        }
      : {
          player: "P2",
          name: "引导手",
          station: "右岸 · EAST RIM",
          role: "控制引导索：移动落点，抵消侧风与横向漂移。",
          keys: ["←", "→", "↑", "↓", "P"],
        },
  };
}

class CanyonGame {
  constructor() {
    this.canvas = $("#gameCanvas");
    this.renderer = new CanyonRenderer(this.canvas);
    this.audio = new CanyonAudio();
    this.run = makeRun();
    this.keys = new Set();
    this.swapped = false;
    this.singlePlayer = false;
    this.paused = false;
    this.recording = null;
    this.resultHandled = false;
    this.toastTimer = null;
    this.lastFrame = performance.now();
    this.replays = [...safeReadReplays(), ...createDemoReplays()];
    this.selectedReplay = null;
    this.replayIndex = 0;
    this.replayPlaying = false;
    this.replayLastFrame = 0;
    this.replayAnimation = 0;
    this.replayRenderer = new CanyonRenderer($("#replayCanvas"));

    this.el = {
      leftPanel: $("#leftPanel"),
      rightPanel: $("#rightPanel"),
      startOverlay: $("#startOverlay"),
      pauseOverlay: $("#pauseOverlay"),
      resultOverlay: $("#resultOverlay"),
      toast: $("#toast"),
      warningBanner: $("#warningBanner"),
      warningText: $("#warningText"),
      eventFeed: $("#eventFeed"),
      stageState: $("#stageState"),
      windValue: $("#windValue"),
      objectiveText: $("#objectiveText"),
      objectiveHint: $("#objectiveHint"),
      soloBadge: $("#soloBadge"),
      sideSwapBadge: $("#sideSwapBadge"),
      timer: $("#timer"),
      timerBox: $(".timer-box"),
      ropeIntegrity: $("#ropeIntegrity"),
      cargoIntegrity: $("#cargoIntegrity"),
      taskProgress: $("#taskProgress"),
      ropeTrack: $("#ropeTrack"),
      cargoTrack: $("#cargoTrack"),
      progressTrack: $("#progressTrack"),
      stepSend: $("#stepSend"),
      stepLand: $("#stepLand"),
      stepRetrieve: $("#stepRetrieve"),
      soloBtn: $("#soloBtn"),
      swapBtn: $("#swapBtn"),
      pauseBtn: $("#pauseBtn"),
      soundBtn: $("#soundBtn"),
      soundIcon: $("#soundIcon"),
      replayDialog: $("#replayDialog"),
      replayList: $("#replayList"),
      replayCanvas: $("#replayCanvas"),
      replayTimecode: $("#replayTimecode"),
      replayScrubber: $("#replayScrubber"),
      timelineMarkers: $("#timelineMarkers"),
      conflictList: $("#conflictList"),
      conflictCount: $("#conflictCount"),
      replayStatus: $("#replayStatus"),
      replayPlayBtn: $("#replayPlayBtn"),
    };

    this.bindUI();
    this.updateAssignments();
    this.renderReplayList();
    this.updateHUD();
    this.renderer.draw(this.run);
    requestAnimationFrame((time) => this.frame(time));
  }

  bindUI() {
    $("#startBtn").addEventListener("click", () => this.beginRun());
    $("#resumeBtn").addEventListener("click", () => this.setPaused(false));
    $("#pauseRestartBtn").addEventListener("click", () => this.restart());
    $("#resultRestartBtn").addEventListener("click", () => this.restart());
    $("#resultReplayBtn").addEventListener("click", () => {
      this.openReplay(this.recording?.savedId || this.replays[0]?.id);
    });
    this.el.pauseBtn.addEventListener("click", () => this.togglePause());
    $("#restartBtn").addEventListener("click", () => this.restart());
    this.el.swapBtn.addEventListener("click", () => this.swapSides());
    this.el.soloBtn.addEventListener("click", () => this.toggleSolo());
    $("#replayBtn").addEventListener("click", () => this.openReplay());
    this.el.soundBtn.addEventListener("click", () => this.toggleSound());
    $("#closeReplayBtn").addEventListener("click", () => this.closeReplay());
    $("#exportReplayBtn").addEventListener("click", () => this.exportReplay());
    this.el.replayPlayBtn.addEventListener("click", () => this.toggleReplayPlayback());
    this.el.replayScrubber.addEventListener("input", (event) => {
      this.setReplayScrubber(Number(event.target.value) / 1000);
    });
    this.el.replayDialog.addEventListener("close", () => this.stopReplayPlayback());

    window.addEventListener("keydown", (event) => this.handleKeyDown(event));
    window.addEventListener("keyup", (event) => this.handleKeyUp(event));
    window.addEventListener("blur", () => {
      this.keys.clear();
      this.updateKeyIndicators();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.isActive() && !this.paused) this.setPaused(true);
    });
  }

  updateAssignments() {
    const assignments = buildAssignments(this.swapped);
    this.assignments = assignments;
    this.fillPanel(this.el.leftPanel, assignments.left);
    this.fillPanel(this.el.rightPanel, assignments.right);
    this.el.soloBadge.hidden = !this.singlePlayer;
    this.el.sideSwapBadge.hidden = !this.swapped;
    this.el.soloBtn.classList.toggle("is-active", this.singlePlayer);
    this.el.swapBtn.classList.toggle("is-active", this.swapped);
  }

  fillPanel(panel, assignment) {
    bind(panel, "playerTag").textContent = assignment.player;
    bind(panel, "playerName").textContent = assignment.name;
    bind(panel, "station").textContent = assignment.station;
    bind(panel, "roleNote").textContent = assignment.role;
  }

  isActive() {
    return this.run.phase === "playing" || this.run.phase === "retrieving";
  }

  inputFromKeys() {
    return {
      reelIn: this.keys.has("KeyW"),
      reelOut: this.keys.has("KeyS"),
      guideLeft: this.keys.has("ArrowLeft"),
      guideRight: this.keys.has("ArrowRight"),
      guideUp: this.keys.has("ArrowUp"),
      guideDown: this.keys.has("ArrowDown"),
      retrieveLeft: this.keys.has("KeyR"),
      retrieveRight: this.keys.has("KeyP"),
    };
  }

  handleKeyDown(event) {
    if (this.el.replayDialog.open) {
      if (event.code === "Escape") {
        event.preventDefault();
        this.closeReplay();
      }
      return;
    }

    const controlKeys = new Set([
      "KeyW",
      "KeyS",
      "KeyR",
      "KeyP",
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
    ]);
    if (controlKeys.has(event.code)) {
      event.preventDefault();
      this.keys.add(event.code);
      this.updateKeyIndicators();
      this.audio.init();
    }

    if (event.repeat) return;
    if (event.code === "Enter") {
      event.preventDefault();
      if (this.run.phase === "ready") this.beginRun();
      else if (this.paused) this.setPaused(false);
      else if (this.run.phase === "won" || this.run.phase === "lost") this.restart();
    } else if (event.code === "Escape") {
      event.preventDefault();
      this.togglePause();
    } else if (event.code === "KeyN") {
      event.preventDefault();
      this.restart();
    } else if (event.code === "F2") {
      event.preventDefault();
      this.toggleSolo();
    }
  }

  handleKeyUp(event) {
    if (this.keys.delete(event.code)) this.updateKeyIndicators();
  }

  updateKeyIndicators() {
    const active = {
      W: this.keys.has("KeyW"),
      S: this.keys.has("KeyS"),
      R: this.keys.has("KeyR"),
      P: this.keys.has("KeyP"),
      "←": this.keys.has("ArrowLeft"),
      "→": this.keys.has("ArrowRight"),
      "↑": this.keys.has("ArrowUp"),
      "↓": this.keys.has("ArrowDown"),
    };
    $$(".key-cluster kbd, .help-strip kbd").forEach((key) => {
      key.classList.toggle("is-pressed", Boolean(active[key.textContent.trim()]));
    });
  }

  frame(time) {
    const dt = Math.min(0.05, Math.max(0, (time - this.lastFrame) / 1000));
    this.lastFrame = time;
    if (!this.paused && this.isActive()) {
      stepRun(this.run, dt, this.inputFromKeys());
      this.captureReplayFrame();
    }
    this.audio.update({
      phase: this.run.phase,
      tension: this.run.drive.displayTension,
      wind: this.run.wind.total,
      muted: this.audio.muted,
    });
    this.renderer.draw(this.run);
    this.updateHUD();
    if ((this.run.phase === "won" || this.run.phase === "lost") && !this.resultHandled) {
      this.handleResult();
    }
    requestAnimationFrame((nextTime) => this.frame(nextTime));
  }

  async beginRun() {
    await this.audio.init();
    if (this.run.phase === "won" || this.run.phase === "lost") {
      this.run = makeRun({ singlePlayer: this.singlePlayer, swapped: this.swapped });
    }
    if (this.run.phase === "ready") startRun(this.run);
    this.paused = false;
    this.resultHandled = false;
    this.el.startOverlay.hidden = true;
    this.el.pauseOverlay.hidden = true;
    this.el.resultOverlay.hidden = true;
    this.startRecording();
    await this.audio.setPaused(false);
    this.showToast(this.singlePlayer ? "单人调试已开始 · 本次不计正式记录" : "双人链路已接通 · 保持张力稳定", false);
  }

  resetModel() {
    this.run = makeRun({ singlePlayer: this.singlePlayer, swapped: this.swapped });
    this.keys.clear();
    this.paused = false;
    this.resultHandled = false;
    this.recording = null;
    this.el.startOverlay.hidden = true;
    this.el.pauseOverlay.hidden = true;
    this.el.resultOverlay.hidden = true;
    this.updateKeyIndicators();
  }

  async restart() {
    await this.audio.init();
    await this.audio.reset();
    this.resetModel();
    startRun(this.run);
    this.startRecording();
    this.showToast("仪表、资源、倒计时与声场已同步复位");
    this.updateHUD();
  }

  async swapSides() {
    this.swapped = !this.swapped;
    this.updateAssignments();
    await this.audio.reset();
    this.resetModel();
    this.el.startOverlay.hidden = false;
    const assignments = this.assignments;
    this.showToast(
      `岸位轮换：${assignments.left.player} 左岸收索 · ${assignments.right.player} 右岸引导`,
      true,
    );
    this.updateHUD();
  }

  async toggleSolo() {
    this.singlePlayer = !this.singlePlayer;
    this.updateAssignments();
    await this.audio.reset();
    this.resetModel();
    this.el.startOverlay.hidden = false;
    this.showToast(
      this.singlePlayer
        ? "单人调试开启：可同时操作 W/S、方向键与 R/P"
        : "已退出单人调试，恢复双人正式记录",
      this.singlePlayer,
    );
    this.updateHUD();
  }

  togglePause() {
    if (this.isActive()) {
      this.setPaused(!this.paused);
    }
  }

  setPaused(paused) {
    if (!this.isActive()) return;
    this.paused = paused;
    this.el.pauseOverlay.hidden = !paused;
    this.el.pauseBtn.querySelector("span:last-child").textContent = paused ? "继续" : "暂停";
    this.el.pauseBtn.querySelector(".button-icon").textContent = paused ? "▶" : "Ⅱ";
    this.audio.setPaused(paused);
    if (paused) this.showToast("任务已暂停 · 物理、计时与声场冻结", true);
  }

  toggleSound() {
    this.audio.init().then(() => {
      const muted = this.audio.toggleMuted();
      this.el.soundIcon.textContent = muted ? "◌" : "◖";
      this.el.soundBtn.setAttribute("aria-label", muted ? "开启声音" : "关闭声音");
      this.showToast(muted ? "声场已静音" : "声场已恢复", muted);
    });
  }

  startRecording() {
    this.recording = {
      id: `run-${Date.now()}`,
      startedAt: new Date().toISOString(),
      nextSnapshot: 0,
      snapshots: [captureSnapshot(this.run)],
      savedId: null,
    };
  }

  captureReplayFrame() {
    if (!this.recording || !this.isActive()) return;
    if (this.run.elapsed < this.recording.nextSnapshot) return;
    this.recording.snapshots.push(captureSnapshot(this.run));
    this.recording.nextSnapshot = this.run.elapsed + 0.1;
  }

  handleResult() {
    this.resultHandled = true;
    this.keys.clear();
    this.updateKeyIndicators();
    const result = this.run.result;
    const success = result?.outcome === "success";
    const replay = this.finalizeReplay(success);
    this.showResult(result, success);
    this.saveReplay(replay);
    this.recording.savedId = replay.id;
  }

  finalizeReplay(success) {
    const snapshots = this.recording?.snapshots || [captureSnapshot(this.run)];
    const finalSnapshot = captureSnapshot(this.run);
    if (snapshots.at(-1)?.t !== finalSnapshot.t) snapshots.push(finalSnapshot);
    const assignments = this.assignments;
    return {
      id: this.recording?.id || `run-${Date.now()}`,
      title: success
        ? this.singlePlayer
          ? "单人调试 · 投送完成"
          : "双人协作 · 投送完成"
        : `任务中断 · ${this.run.result?.title || "链路失效"}`,
      subtitle: `${assignments.left.player} 收索 / ${assignments.right.player} 引导${
        this.swapped ? " · 岸位轮换" : ""
      }`,
      outcome: success ? "success" : "failure",
      reason: this.run.result?.reason || "unknown",
      mode: this.singlePlayer ? "solo" : "coop",
      singlePlayer: this.singlePlayer,
      swapped: this.swapped,
      startedAt: this.recording?.startedAt || new Date().toISOString(),
      duration: Number(this.run.elapsed.toFixed(2)),
      timeLeft: Number(this.run.timeLeft.toFixed(1)),
      conflicts: this.run.stats.conflictCount,
      peakTension: Math.round(this.run.stats.peakTension),
      maxDrift: Math.round(this.run.stats.maxDrift),
      corrections: this.run.stats.corrections,
      snapshots,
      events: [...this.run.events],
      final: finalSnapshot,
      demo: false,
    };
  }

  saveReplay(replay) {
    const actual = this.replays.filter((item) => !item.demo);
    const demos = this.replays.filter((item) => item.demo);
    const nextActual = [replay, ...actual.filter((item) => item.id !== replay.id)].slice(0, 6);
    this.replays = [...nextActual, ...demos];
    const stored = safeWriteReplays(nextActual);
    this.renderReplayList();
    if (!stored) this.showToast("回放已保留在本局内存，浏览器存储空间不足", true);
  }

  showResult(result, success) {
    const icon = $("#resultIcon");
    icon.textContent = success ? "✓" : "×";
    icon.classList.toggle("is-failure", !success);
    $("#resultEyebrow").textContent = success ? "MISSION COMPLETE" : "LINK INTERRUPTED";
    $("#resultTitle").textContent = result?.title || (success ? "物资已送达" : "任务中断");
    $("#resultCopy").textContent =
      result?.detail ||
      (success
        ? "双人回收完成，中央中继台恢复供能。"
        : "救援链路未能闭合，请检查两侧仪表后重试。");
    $("#resultTime").textContent = formatClock(this.run.elapsed);
    $("#resultTension").textContent = `${Math.round(this.run.stats.peakTension)}%`;
    $("#resultConflicts").textContent = String(this.run.stats.conflictCount);
    this.el.resultOverlay.hidden = false;
    this.showToast(
      success ? "任务完成 · 回放已自动保存" : `任务失败 · ${result?.title || "链路中断"} · 回放已保存`,
      !success,
    );
  }

  showToast(message, warn = false) {
    clearTimeout(this.toastTimer);
    this.el.toast.textContent = message;
    this.el.toast.classList.toggle("is-warn", warn);
    this.el.toast.hidden = false;
    this.toastTimer = setTimeout(() => {
      this.el.toast.hidden = true;
    }, 2800);
  }

  ensureHudRefs() {
    if (this.hudRefs) return;
    const mapPanel = (panel) => {
      const refs = {};
      $$("[data-bind]", panel).forEach((element) => {
        refs[element.dataset.bind] = element;
      });
      refs.fill = panel.querySelector(".gauge-fill");
      refs.status = bind(panel, "playerStatus");
      return refs;
    };
    this.hudRefs = {
      left: mapPanel(this.el.leftPanel),
      right: mapPanel(this.el.rightPanel),
    };
  }

  updateHUD() {
    this.ensureHudRefs();
    const run = this.run;
    const tension = run.drive.displayTension;
    const rawTension = run.drive.tension;
    const errorMeters = Math.hypot(
      run.crate.x - WORLD.platform.cx,
      run.crate.y - WORLD.platform.cy,
    ) / 23;
    const assignments = this.assignments;
    const left = this.hudRefs.left;
    const right = this.hudRefs.right;

    left.gaugeValue.innerHTML = `${Math.round(tension)}<small>%</small>`;
    left.gaugeBig.textContent = String(Math.round(tension));
    left.gaugeCaption.textContent =
      tension < 12 ? "松弛" : tension < 36 ? "偏低" : tension <= 78 ? "稳定" : tension < 82 ? "偏高" : "临界";
    left.fill.style.strokeDashoffset = String(TOTAL_GAUGE * (1 - clamp(tension, 0, 100) / 100));
    left.fill.style.stroke =
      rawTension >= LIMITS.tensionWarn
        ? "var(--red)"
        : rawTension >= LIMITS.tensionSafeMax
          ? "var(--orange)"
          : "";
    left.mirrorError.textContent = `${errorMeters.toFixed(1)} m`;
    left.mirrorProgress.textContent = `${Math.round(run.progress)}%`;
    left.mirrorRope.textContent = `${Math.round(run.drive.integrity)}%`;

    right.gaugeValue.innerHTML = `${errorMeters.toFixed(1)}<small>m</small>`;
    right.mirrorTension.textContent = `${Math.round(tension)}%`;
    right.mirrorTensionRow.textContent = `${Math.round(tension)}%`;
    right.mirrorProgress.textContent = `${Math.round(run.progress)}%`;
    right.mirrorCargo.textContent = `${Math.round(run.cargoIntegrity)}%`;

    const targetLeft = clamp(50 + ((run.guide.targetX - WORLD.platform.cx) / 235) * 50, 4, 96);
    const targetTop = clamp(50 + ((run.guide.targetY - WORLD.platform.cy) / 205) * 50, 4, 96);
    const cargoLeft = clamp(50 + ((run.crate.x - WORLD.platform.cx) / 330) * 50, 4, 96);
    const cargoTop = clamp(50 + ((run.crate.y - WORLD.platform.cy) / 205) * 50, 4, 96);
    right.scopeTarget.style.left = `${targetLeft}%`;
    right.scopeTarget.style.top = `${targetTop}%`;
    right.scopeCargo.style.left = `${cargoLeft}%`;
    right.scopeCargo.style.top = `${cargoTop}%`;
    right.alignmentNeedle.style.left = `${clamp(
      50 + ((run.crate.y - WORLD.platform.cy) / 170) * 50,
      4,
      96,
    )}%`;

    this.updatePlayerStatus(left, assignments.left, "left", rawTension, errorMeters);
    this.updatePlayerStatus(right, assignments.right, "right", rawTension, errorMeters);

    this.el.windValue.textContent = (Math.abs(run.wind.total) / 11).toFixed(1);
    this.el.ropeIntegrity.textContent = `${Math.round(run.drive.integrity)}%`;
    this.el.cargoIntegrity.textContent = `${Math.round(run.cargoIntegrity)}%`;
    this.el.taskProgress.textContent = `${Math.round(run.progress)}%`;
    this.el.ropeTrack.style.width = `${run.drive.integrity}%`;
    this.el.cargoTrack.style.width = `${run.cargoIntegrity}%`;
    this.el.progressTrack.style.width = `${run.progress}%`;
    this.el.ropeTrack.style.background =
      run.drive.integrity < 45
        ? "linear-gradient(90deg, #ff6a58, #f4aa62)"
        : "";
    this.el.timer.textContent = formatClock(run.timeLeft);
    this.el.timerBox.classList.toggle("is-urgent", run.timeLeft <= 15 && this.isActive());

    const stageLabel =
      run.phase === "ready"
        ? "待命"
        : run.phase === "playing"
          ? this.paused
            ? "冻结"
            : "双人协作"
          : run.phase === "retrieving"
            ? "同步收索"
            : run.phase === "won"
              ? "任务完成"
              : "链路中断";
    this.el.stageState.textContent = stageLabel;
    this.el.stageState.classList.toggle(
      "is-danger",
      run.phase === "lost" || rawTension >= LIMITS.tensionWarn,
    );

    this.el.stepSend.classList.toggle("is-done", run.progress >= 48 || run.phase === "won");
    this.el.stepSend.classList.toggle(
      "is-active",
      run.phase === "playing" && run.progress < 48,
    );
    this.el.stepLand.classList.toggle("is-done", run.phase === "retrieving" || run.phase === "won");
    this.el.stepLand.classList.toggle(
      "is-active",
      (run.phase === "playing" && run.progress >= 48) || run.settle > 0,
    );
    this.el.stepRetrieve.classList.toggle("is-done", run.phase === "won");
    this.el.stepRetrieve.classList.toggle("is-active", run.phase === "retrieving");

    this.updateObjective(tension);
    this.updateWarning(rawTension);
    this.updateEventFeed();
    this.el.pauseBtn.disabled = !this.isActive();
    this.el.startOverlay.hidden = !(run.phase === "ready" && !this.paused);
  }

  updatePlayerStatus(refs, assignment, station, tension, errorMeters) {
    const run = this.run;
    let label = "在线";
    let tone = "good";
    if (run.phase === "ready") label = "待命";
    else if (this.paused) label = "冻结";
    else if (run.phase === "won") label = "完成";
    else if (run.phase === "lost") {
      label = "断开";
      tone = "danger";
    } else if (run.phase === "retrieving") {
      label = station === "left" ? `${Math.round(run.retrieve.left)}%` : `${Math.round(run.retrieve.right)}%`;
      tone = "warn";
    } else if (station === "left") {
      if (tension >= LIMITS.tensionWarn) {
        label = "过载";
        tone = "danger";
      } else if (tension < LIMITS.tensionSlack) {
        label = "松弛";
        tone = "warn";
      } else {
        label = "受力稳定";
      }
    } else if (errorMeters > 6) {
      label = "偏离";
      tone = "danger";
    } else if (errorMeters > 2.2) {
      label = "修正中";
      tone = "warn";
    } else {
      label = "落点对齐";
    }
    refs.playerStatus.textContent = label;
    refs.playerStatus.className = `status-pill status-pill--${tone}`;
    refs.playerTag.style.color = assignment.player === "P1" ? "var(--cyan)" : "var(--orange)";
  }

  updateObjective(tension) {
    const run = this.run;
    let text = "";
    let hint = "";
    if (run.phase === "ready") {
      text = "等待双人接管 · 按 Enter 开始";
      hint = "两侧输入互不锁定，可同时操作";
    } else if (run.phase === "playing") {
      if (tension >= LIMITS.tensionWarn) {
        text = "主索过载 · 收索手立即放索降压";
        hint = "断裂阈值前有约 0.5 秒恢复窗口";
      } else if (run.progress < 48) {
        text = "建立稳定张力，将物资箱送入中央投送窗口";
        hint = "目标张力 36–78% · 右岸同步抵消侧风";
      } else if (run.settle > 0) {
        text = "箱体正在落位 · 保持低速与落点重合";
        hint = `落位锁定 ${Math.round((run.settle / LIMITS.settleTime) * 100)}%`;
      } else {
        text = "减速并对正平台，避免货箱冲出落位窗口";
        hint = `落点偏差 ${(
          Math.hypot(run.crate.x - WORLD.platform.cx, run.crate.y - WORLD.platform.cy) / 23
        ).toFixed(1)} m`;
      }
    } else if (run.phase === "retrieving") {
      text = "双人同时按住 R 与 P 收回绳索";
      hint = `左岸 ${Math.round(run.retrieve.left)}% · 右岸 ${Math.round(run.retrieve.right)}% · 任一侧松开都会停滞`;
    } else if (run.phase === "won") {
      text = "物资已固定，任务链路安全关闭";
      hint = "完整回放已保存，可按上方“回放”查看冲突时刻";
    } else {
      text = `${run.result?.title || "任务中断"} · 按 N 重新开始`;
      hint = run.result?.detail || "检查两侧仪表后重试";
    }
    this.el.objectiveText.textContent = this.paused ? "任务已暂停 · 仪表与计时冻结" : text;
    this.el.objectiveHint.textContent = this.paused ? "按 Esc 或 Enter 继续" : hint;
  }

  updateWarning(tension) {
    const run = this.run;
    let message = "";
    if (this.paused) {
      this.el.warningBanner.hidden = true;
      return;
    }
    if (run.phase === "playing" && tension >= LIMITS.tensionWarn) {
      message = "主索张力过高 · 立即放索";
    } else if (run.phase === "playing" && run.drive.tension < LIMITS.tensionSlack && run.elapsed > 1) {
      message = "主索松弛 · 无法建立牵引";
    } else if (run.phase === "playing" && Math.abs(run.crate.y - WORLD.platform.cy) > 80) {
      message = "箱体偏离平台 · 右岸修正落点";
    } else if (run.phase === "retrieving" && Math.abs(run.retrieve.left - run.retrieve.right) > 28) {
      message = "回收不同步 · 双方需同时按住";
    }
    this.el.warningBanner.hidden = !message;
    if (message) this.el.warningText.textContent = message;
  }

  updateEventFeed() {
    const event = this.run.events.at(-1);
    const time = event ? formatClock(event.t) : "00:00";
    const label = event?.label || "系统自检完成，等待双人接管";
    const timeNode = this.el.eventFeed.querySelector(".event-feed__time");
    const labelNode = this.el.eventFeed.querySelector(".event-feed__label");
    if (timeNode.textContent !== time) timeNode.textContent = time;
    if (labelNode.textContent !== label) labelNode.textContent = label;
    this.el.eventFeed.classList.toggle("is-danger", event?.severity === "danger");
    this.el.eventFeed.classList.toggle("is-warn", event?.severity === "warn");
    this.el.eventFeed.title = event?.detail || "";
  }

  openReplay(id) {
    this.renderReplayList();
    this.el.replayDialog.showModal();
    requestAnimationFrame(() => {
      this.replayRenderer.resize();
      const replay =
        this.replays.find((item) => item.id === id) ||
        this.replays.find((item) => item.id === this.selectedReplay?.id) ||
        this.replays[0];
      if (replay) this.selectReplay(replay.id);
    });
  }

  closeReplay() {
    this.stopReplayPlayback();
    if (this.el.replayDialog.open) this.el.replayDialog.close();
  }

  renderReplayList() {
    this.el.replayList.replaceChildren();
    if (!this.replays.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "暂无回放。完成或中断一次任务后会自动保存。";
      this.el.replayList.append(empty);
      return;
    }
    for (const replay of this.replays) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "replay-entry";
      button.dataset.replayId = replay.id;
      if (replay.id === this.selectedReplay?.id) button.classList.add("is-selected");
      if (replay.outcome === "failure") button.classList.add("is-failure");
      button.innerHTML = `
        <strong></strong>
        <span></span>
        <em></em>
      `;
      button.querySelector("strong").textContent = replay.title;
      button.querySelector("span").textContent = `${formatClock(replay.duration)} · ${replay.conflicts} 次冲突 · ${
        replay.demo ? "内置验收" : "本局记录"
      }`;
      button.querySelector("em").textContent =
        replay.outcome === "success" ? "完整送达" : `中断 / ${replay.reason}`;
      button.addEventListener("click", () => this.selectReplay(replay.id));
      this.el.replayList.append(button);
    }
  }

  selectReplay(id) {
    const replay = this.replays.find((item) => item.id === id);
    if (!replay) return;
    this.stopReplayPlayback();
    this.selectedReplay = replay;
    this.replayIndex = 0;
    $$(".replay-entry", this.el.replayList).forEach((entry) => {
      entry.classList.toggle("is-selected", entry.dataset.replayId === replay.id);
    });
    this.renderConflictLog(replay);
    this.buildTimelineMarkers(replay);
    this.el.replayScrubber.max = "1000";
    this.el.replayScrubber.value = "0";
    this.el.replayStatus.textContent = `${replay.title} · ${replay.snapshots.length} 帧完整记录`;
    this.el.replayPlayBtn.textContent = "播放";
    requestAnimationFrame(() => {
      this.replayRenderer.resize();
      this.drawReplay(0);
    });
  }

  renderConflictLog(replay) {
    this.el.conflictList.replaceChildren();
    const events = replay.events.filter((event) => event.conflict);
    this.el.conflictCount.textContent = `${events.length} 条`;
    if (!events.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "本次记录没有冲突事件。";
      this.el.conflictList.append(empty);
      return;
    }
    for (const event of events) {
      const row = document.createElement("div");
      row.className = "conflict-row";
      row.tabIndex = 0;
      row.innerHTML = `<time></time><em></em><span></span>`;
      row.querySelector("time").textContent = formatClock(event.t, true);
      row.querySelector("em").textContent = event.type;
      row.querySelector("span").textContent = event.label;
      const seek = () => this.seekReplayTime(event.t);
      row.addEventListener("click", seek);
      row.addEventListener("keydown", (event) => {
        if (event.code === "Enter" || event.code === "Space") seek();
      });
      this.el.conflictList.append(row);
    }
  }

  buildTimelineMarkers(replay) {
    this.el.timelineMarkers.replaceChildren();
    for (const event of replay.events.filter((item) => item.conflict)) {
      const marker = document.createElement("i");
      marker.style.left = `${clamp((event.t / Math.max(0.1, replay.duration)) * 100, 0, 100)}%`;
      marker.classList.toggle("is-critical", event.severity === "danger");
      marker.title = `${formatClock(event.t, true)} · ${event.label}`;
      this.el.timelineMarkers.append(marker);
    }
  }

  drawReplay(ratio) {
    const replay = this.selectedReplay;
    if (!replay) return;
    const safeRatio = clamp(ratio, 0, 1);
    this.replayIndex = Math.min(
      replay.snapshots.length - 1,
      Math.round(safeRatio * (replay.snapshots.length - 1)),
    );
    const snapshot = replay.snapshots[this.replayIndex];
    this.replayRenderer.draw({ ...snapshot, swapped: replay.swapped });
    this.el.replayTimecode.textContent = formatClock(snapshot.t, true);
    this.el.replayScrubber.value = String(Math.round(safeRatio * 1000));
    this.el.replayScrubber.style.setProperty("--scrub", `${safeRatio * 100}%`);
  }

  setReplayScrubber(ratio) {
    if (!this.selectedReplay) return;
    this.drawReplay(ratio);
  }

  seekReplayTime(seconds) {
    if (!this.selectedReplay) return;
    const ratio = clamp(seconds / Math.max(0.1, this.selectedReplay.duration), 0, 1);
    this.stopReplayPlayback();
    this.drawReplay(ratio);
  }

  toggleReplayPlayback() {
    if (!this.selectedReplay) return;
    if (this.replayPlaying) {
      this.stopReplayPlayback();
      return;
    }
    const ratio = Number(this.el.replayScrubber.value) / 1000;
    if (ratio >= 0.999) this.drawReplay(0);
    this.replayPlaying = true;
    this.replayLastFrame = performance.now();
    this.el.replayPlayBtn.textContent = "暂停";
    this.replayAnimation = requestAnimationFrame((time) => this.playReplayFrame(time));
  }

  playReplayFrame(time) {
    if (!this.replayPlaying || !this.selectedReplay) return;
    const dt = Math.min(0.05, (time - this.replayLastFrame) / 1000);
    this.replayLastFrame = time;
    const duration = Math.max(0.1, this.selectedReplay.duration);
    const next = clamp(Number(this.el.replayScrubber.value) / 1000 + dt / duration, 0, 1);
    this.drawReplay(next);
    if (next >= 1) {
      this.stopReplayPlayback();
      return;
    }
    this.replayAnimation = requestAnimationFrame((nextTime) => this.playReplayFrame(nextTime));
  }

  stopReplayPlayback() {
    this.replayPlaying = false;
    if (this.replayAnimation) cancelAnimationFrame(this.replayAnimation);
    this.replayAnimation = 0;
    this.el.replayPlayBtn.textContent = "播放";
  }

  exportReplay() {
    if (!this.selectedReplay) return;
    const blob = new Blob([JSON.stringify(this.selectedReplay, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${this.selectedReplay.id}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  publicState() {
    const leftPlayer = this.assignments.left.player;
    const rightPlayer = this.assignments.right.player;
    const playerActions = {
      [leftPlayer]: Number((this.run.contributions.p1 + this.run.contributions.left).toFixed(2)),
      [rightPlayer]: Number((this.run.contributions.p2 + this.run.contributions.right).toFixed(2)),
    };
    return {
      phase: this.run.phase,
      paused: this.paused,
      singlePlayer: this.singlePlayer,
      swapped: this.swapped,
      elapsed: Number(this.run.elapsed.toFixed(2)),
      timeLeft: Number(this.run.timeLeft.toFixed(1)),
      tension: Number(this.run.drive.tension.toFixed(1)),
      displayTension: Number(this.run.drive.displayTension.toFixed(1)),
      ropeIntegrity: Number(this.run.drive.integrity.toFixed(1)),
      cargoIntegrity: this.run.cargoIntegrity,
      progress: Number(this.run.progress.toFixed(1)),
      cargo: {
        x: Number(this.run.crate.x.toFixed(1)),
        y: Number(this.run.crate.y.toFixed(1)),
        vx: Number(this.run.crate.vx.toFixed(1)),
        vy: Number(this.run.crate.vy.toFixed(1)),
      },
      guide: {
        x: Number(this.run.guide.targetX.toFixed(1)),
        y: Number(this.run.guide.targetY.toFixed(1)),
      },
      wind: Number(this.run.wind.total.toFixed(1)),
      settle: Number(this.run.settle.toFixed(2)),
      retrieve: {
        left: Number(this.run.retrieve.left.toFixed(1)),
        right: Number(this.run.retrieve.right.toFixed(1)),
        progress: Number(this.run.retrieve.progress.toFixed(1)),
      },
      assignments: {
        left: { player: this.assignments.left.player, role: this.assignments.left.name },
        right: { player: this.assignments.right.player, role: this.assignments.right.name },
      },
      contributions: { ...this.run.contributions },
      playerActions,
      events: this.run.events.map((event) => ({
        t: event.t,
        type: event.type,
        label: event.label,
        conflict: event.conflict,
      })),
      result: this.run.result ? { ...this.run.result } : null,
      audio: this.audio.snapshot(),
      replayCount: this.replays.length,
      lastReplayId: this.recording?.savedId || null,
    };
  }
}

const game = new CanyonGame();

window.__relay = {
  getState: () => game.publicState(),
  start: () => game.beginRun(),
  restart: () => game.restart(),
  pause: () => game.setPaused(true),
  resume: () => game.setPaused(false),
  toggleSwap: () => game.swapSides(),
  toggleSolo: () => game.toggleSolo(),
  simulate: (kind, options) => simulateReplay(kind, options),
  getReplays: () =>
    game.replays.map((replay) => ({
      id: replay.id,
      title: replay.title,
      outcome: replay.outcome,
      reason: replay.reason,
      conflicts: replay.conflicts,
      duration: replay.duration,
      demo: replay.demo,
      snapshotCount: replay.snapshots.length,
      swapped: replay.swapped,
    })),
  getReplay: (id) => {
    const replay = game.replays.find((item) => item.id === id) || game.selectedReplay;
    return replay ? JSON.parse(JSON.stringify(replay)) : null;
  },
  openReplay: (id) => game.openReplay(id),
  closeReplay: () => game.closeReplay(),
  selectReplay: (id) => game.selectReplay(id),
  exportReplay: () => game.exportReplay(),
  get selectedReplayId() {
    return game.selectedReplay?.id || null;
  },
};
