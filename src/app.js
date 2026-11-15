import {
  DRAFT_KEY,
  MIN_SHOT_DURATION,
  SOURCE_LENGTH,
  STORAGE_KEY,
  clamp,
  cloneProject,
  computeAudioEvents,
  computeLayout,
  createDefaultProject,
  formatClock,
  formatShortDuration,
  formatTimecode,
  getActiveCaption,
  getAudioEventAt,
  getBeatInfo,
  getSceneAt,
  normalizeProject,
  projectForStorage,
  roundFrame,
  roundTime,
  sceneDuration,
  snapshotHash,
  timelineSnapshot,
} from "./project.js";
import { drawContactThumbnail, drawProgramFrame, hashCanvas } from "./scenes.js";
import { DrumEngine, renderDrumBuffer } from "./audio.js";
import {
  buildExportManifest,
  buildStoryboardCsv,
  drawStoryboardSheet,
  validateTimelineIntegrity,
} from "./exporters.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const elements = {
  projectTitle: $("#projectTitle"),
  fpsPill: $("#fpsPill"),
  saveState: $("#saveState"),
  saveStateText: $("#saveStateText"),
  saveProjectBtn: $("#saveProjectBtn"),
  reloadProjectBtn: $("#reloadProjectBtn"),
  openProjectBtn: $("#openProjectBtn"),
  projectFile: $("#projectFile"),
  exportBtn: $("#exportBtn"),
  exportMenu: $("#exportMenu"),
  shotList: $("#shotList"),
  stageShotNo: $("#stageShotNo"),
  stageShotName: $("#stageShotName"),
  stageClock: $("#stageClock"),
  previewCanvas: $("#previewCanvas"),
  previewFrame: $("#previewFrame"),
  previewLoading: $("#previewLoading"),
  frameShotLabel: $("#frameShotLabel"),
  frameTimeLabel: $("#frameTimeLabel"),
  safeFrame: $("#safeFrame"),
  safeFrameBtn: $("#safeFrameBtn"),
  beatDots: $$(".beat-dot"),
  beatCount: $("#beatCount"),
  playBtn: $("#playBtn"),
  toStartBtn: $("#toStartBtn"),
  prevShotBtn: $("#prevShotBtn"),
  nextShotBtn: $("#nextShotBtn"),
  loopBtn: $("#loopBtn"),
  currentTimecode: $("#currentTimecode"),
  totalTimecode: $("#totalTimecode"),
  audioStatus: $("#audioStatus"),
  validateBtn: $("#validateBtn"),
  inspectorNo: $("#inspectorNo"),
  inspectorName: $("#inspectorName"),
  shotColor: $("#shotColor"),
  sourceRange: $("#sourceRange"),
  inPointInput: $("#inPointInput"),
  outPointInput: $("#outPointInput"),
  durationInput: $("#durationInput"),
  durationMinus: $("#durationMinus"),
  durationPlus: $("#durationPlus"),
  timelineSpan: $("#timelineSpan"),
  captionState: $("#captionState"),
  subtitleInput: $("#subtitleInput"),
  subtitleInInput: $("#subtitleInInput"),
  subtitleOutInput: $("#subtitleOutInput"),
  transitionSelect: $("#transitionSelect"),
  transitionDurationInput: $("#transitionDurationInput"),
  transitionPreviewLabel: $("#transitionPreviewLabel"),
  keyframeCount: $("#keyframeCount"),
  keyframeList: $("#keyframeList"),
  addKeyframeBtn: $("#addKeyframeBtn"),
  bpmInput: $("#bpmInput"),
  audioStartInput: $("#audioStartInput"),
  waveVisual: $("#waveVisual"),
  timelineMeta: $("#timelineMeta"),
  snapBtn: $("#snapBtn"),
  fitBtn: $("#fitBtn"),
  timelineScroll: $("#timelineScroll"),
  timelineCanvas: $("#timelineCanvas"),
  timelineHint: $("#timelineHint"),
  toastRegion: $("#toastRegion"),
  modalBackdrop: $("#modalBackdrop"),
  modal: $("#modal"),
  modalEyebrow: $("#modalEyebrow"),
  modalTitle: $("#modalTitle"),
  modalBody: $("#modalBody"),
  modalActions: $("#modalActions"),
  modalCloseBtn: $("#modalCloseBtn"),
};

const audioEngine = new DrumEngine();
const timelineBase = document.createElement("canvas");
const previewContext = elements.previewCanvas.getContext("2d", { alpha: false });
const timelineContext = elements.timelineCanvas.getContext("2d", { alpha: false });

const TRANSITION_LABELS = {
  cut: "硬切",
  dissolve: "叠化",
  wipe: "横向擦除",
  flash: "闪白",
};

const state = {
  project: createDefaultProject(),
  selectedId: null,
  currentTime: 0,
  playing: false,
  loop: false,
  snap: true,
  dirty: false,
  restored: false,
  playToken: 0,
  rafId: null,
  clockSource: "audio",
  clockAnchorPerformance: 0,
  clockAnchorTime: 0,
  timelineMetrics: null,
  timelineHit: { clips: [], captions: [] },
  timelineHover: null,
  drag: null,
  persistTimer: null,
  lastSavedLabel: "",
  validating: false,
  exportInProgress: false,
  forceExportFailure: false,
  modalKind: null,
};

function selectedScene() {
  return (
    state.project.scenes.find((scene) => scene.id === state.selectedId) ||
    state.project.scenes[0]
  );
}

function selectedSceneItem(layout = computeLayout(state.project)) {
  return layout.sceneById.get(selectedScene().id) || layout.scenes[0];
}

function loadStoredProject(primary = DRAFT_KEY) {
  const keys = primary === DRAFT_KEY ? [DRAFT_KEY, STORAGE_KEY] : [STORAGE_KEY, DRAFT_KEY];
  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      return { project: normalizeProject(parsed), savedAt: parsed.savedAt || parsed.updatedAt || null, key };
    } catch (error) {
      console.warn(`无法读取工程 ${key}`, error);
    }
  }
  return null;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function toast(message, kind = "success") {
  const item = document.createElement("div");
  item.className = `toast ${kind}`;
  item.textContent = message;
  elements.toastRegion.append(item);
  window.setTimeout(() => {
    item.classList.add("leaving");
    window.setTimeout(() => item.remove(), 220);
  }, 2700);
}

function markDirty() {
  state.dirty = true;
  elements.saveState.classList.add("unsaved");
  elements.saveStateText.textContent = "有未保存更改";
  window.clearTimeout(state.persistTimer);
  state.persistTimer = window.setTimeout(() => {
    state.persistTimer = null;
    persistDraft();
  }, 320);
}

function clearPendingAutosave() {
  if (state.persistTimer !== null) {
    window.clearTimeout(state.persistTimer);
    state.persistTimer = null;
  }
}

function persistDraft() {
  try {
    const storageProject = projectForStorage(state.project);
    localStorage.setItem(DRAFT_KEY, JSON.stringify(storageProject));
    state.lastSavedLabel = new Date(storageProject.savedAt).toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (error) {
    console.warn("草稿保存失败", error);
  }
}

function saveProject() {
  clearPendingAutosave();
  persistDraft();
  const stored = projectForStorage(state.project);
  state.project.updatedAt = stored.savedAt;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  state.dirty = false;
  state.lastSavedLabel = new Date(stored.savedAt).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
  elements.saveState.classList.remove("unsaved");
  elements.saveStateText.textContent = `已保存 ${state.lastSavedLabel}`;
  toast("工程已保存，刷新页面也会恢复当前时间线");
}

function setProject(project, options = {}) {
  state.project = normalizeProject(project);
  const layout = computeLayout(state.project);
  state.selectedId =
    options.selectedId && layout.sceneById.has(options.selectedId)
      ? options.selectedId
      : state.project.scenes[0].id;
  state.currentTime = clamp(options.time || 0, 0, layout.total);
  state.dirty = Boolean(options.dirty);
  if (state.dirty) {
    elements.saveState.classList.add("unsaved");
    elements.saveStateText.textContent = "有未保存更改";
  } else {
    elements.saveState.classList.remove("unsaved");
    elements.saveStateText.textContent = options.savedAt
      ? `已恢复 ${new Date(options.savedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`
      : "自动保存已开启";
  }
  renderStatic();
  drawPreview();
  updateTransportUI();
}

function updateTimelineMeta(layout = computeLayout(state.project)) {
  elements.timelineMeta.textContent = `${state.project.scenes.length} SHOTS · ${layout.total.toFixed(1)}s`;
  elements.totalTimecode.textContent = formatTimecode(layout.total, state.project.fps);
  elements.fpsPill.textContent = `${state.project.fps} FPS`;
  elements.projectTitle.textContent = state.project.title;
}

function renderShotList() {
  const layout = computeLayout(state.project);
  const fragment = document.createDocumentFragment();
  layout.scenes.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `shot-item${item.scene.id === state.selectedId ? " active" : ""}`;
    button.dataset.sceneId = item.scene.id;
    button.setAttribute("aria-label", `选择镜头 ${item.scene.no} ${item.scene.name}`);

    const thumb = document.createElement("span");
    thumb.className = "shot-thumb";
    const canvas = document.createElement("canvas");
    canvas.width = 104;
    canvas.height = 68;
    thumb.append(canvas);
    const badge = document.createElement("span");
    badge.textContent = item.scene.no;
    thumb.append(badge);

    const copy = document.createElement("span");
    copy.className = "shot-copy";
    const name = document.createElement("strong");
    name.textContent = item.scene.name;
    const meta = document.createElement("span");
    meta.textContent = `${formatShortDuration(item.duration)} · IN ${item.scene.sourceIn.toFixed(1)}`;
    copy.append(name, meta);
    button.append(thumb, copy);
    fragment.append(button);

    requestAnimationFrame(() => {
      const context = canvas.getContext("2d");
      context.setTransform(2, 0, 0, 2, 0, 0);
      drawContactThumbnail(
        context,
        52,
        34,
        item.scene,
        Math.min(item.duration * 0.44, item.scene.sourceOut),
      );
      context.setTransform(1, 0, 0, 1, 0, 0);
    });
  });
  elements.shotList.replaceChildren(fragment);
}

function setInputValue(input, value) {
  if (document.activeElement !== input) input.value = value;
}

function syncInspector() {
  const layout = computeLayout(state.project);
  const item = selectedSceneItem(layout);
  const scene = item.scene;
  elements.inspectorNo.textContent = scene.no;
  elements.inspectorName.textContent = scene.name;
  elements.shotColor.style.background = `radial-gradient(circle at 35% 32%, ${scene.palette[2]}, ${scene.palette[1]} 55%, ${scene.palette[0]})`;
  elements.sourceRange.textContent = `SOURCE ${SOURCE_LENGTH.toFixed(1)}s`;
  setInputValue(elements.inPointInput, scene.sourceIn.toFixed(1));
  setInputValue(elements.outPointInput, scene.sourceOut.toFixed(1));
  setInputValue(elements.durationInput, item.duration.toFixed(1));
  elements.timelineSpan.textContent = `${formatClock(item.start, state.project.fps)} – ${formatClock(item.end, state.project.fps)}`;
  setInputValue(elements.subtitleInput, scene.subtitle.text);
  setInputValue(elements.subtitleInInput, scene.subtitle.in.toFixed(1));
  setInputValue(elements.subtitleOutInput, scene.subtitle.out.toFixed(1));
  elements.captionState.textContent = scene.subtitle.text ? "可见" : "空白";
  elements.transitionSelect.value = scene.transition.type;
  setInputValue(elements.transitionDurationInput, scene.transition.duration.toFixed(1));
  elements.transitionPreviewLabel.textContent = TRANSITION_LABELS[scene.transition.type];
  setInputValue(elements.bpmInput, String(state.project.audio.bpm));
  setInputValue(elements.audioStartInput, state.project.audio.start.toFixed(1));
  elements.keyframeCount.textContent = String(scene.keyframes.length).padStart(2, "0");

  const fragment = document.createDocumentFragment();
  if (scene.keyframes.length === 0) {
    const empty = document.createElement("div");
    empty.className = "keyframe-empty";
    empty.textContent = "这一格还没有关键帧";
    fragment.append(empty);
  } else {
    scene.keyframes.forEach((keyframe) => {
      const row = document.createElement("div");
      row.className = "keyframe-row";
      const diamond = document.createElement("i");
      diamond.className = "diamond";
      const time = document.createElement("time");
      time.textContent = `+${keyframe.time.toFixed(2)}s`;
      const zoom = document.createElement("span");
      zoom.textContent = `${Math.round(keyframe.zoom * 100)}%`;
      row.append(diamond, time, zoom);
      fragment.append(row);
    });
  }
  elements.keyframeList.replaceChildren(fragment);

  const activeCaption = getActiveCaption(item, state.currentTime);
  elements.captionState.classList.toggle("quiet", !activeCaption);
}

function syncSelectionToActive(layout = computeLayout(state.project)) {
  const active = getSceneAt(layout, state.currentTime);
  if (!active || active.scene.id === state.selectedId) return false;
  state.selectedId = active.scene.id;
  renderShotList();
  syncInspector();
  renderTimelineBase();
  return true;
}

function renderStatic() {
  updateTimelineMeta();
  renderShotList();
  syncInspector();
  resizeTimelineCanvas();
  renderTimelineBase();
  updateTransportUI();
}

function resizePreviewCanvas() {
  const rect = elements.previewCanvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (elements.previewCanvas.width !== width || elements.previewCanvas.height !== height) {
    elements.previewCanvas.width = width;
    elements.previewCanvas.height = height;
  }
  return {
    width: rect.width,
    height: rect.height,
    dpr,
  };
}

function drawCaption(context, width, height, caption) {
  if (!caption) return;
  const fontSize = clamp(height * 0.032, 12, 42);
  context.save();
  context.font = `600 ${fontSize}px "Noto Sans SC", "PingFang SC", sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  const textWidth = context.measureText(caption).width;
  const boxWidth = Math.min(width * 0.82, textWidth + fontSize * 2.2);
  const boxHeight = fontSize * 2;
  const x = (width - boxWidth) / 2;
  const y = height - boxHeight - height * 0.095;
  context.fillStyle = "rgba(4, 7, 8, 0.58)";
  context.beginPath();
  context.roundRect(x, y, boxWidth, boxHeight, 3);
  context.fill();
  context.fillStyle = "rgba(244,182,67,0.9)";
  context.fillRect(x + boxWidth / 2 - 9, y, 18, 1.5);
  context.fillStyle = "rgba(244,246,241,0.94)";
  context.fillText(caption, width / 2, y + boxHeight / 2 + 1);
  context.restore();
}

function drawPreview() {
  const { width, height, dpr } = resizePreviewCanvas();
  if (width < 2 || height < 2) return;
  const layout = computeLayout(state.project);
  previewContext.setTransform(dpr, 0, 0, dpr, 0, 0);
  previewContext.clearRect(0, 0, width, height);
  const rendered = drawProgramFrame(
    previewContext,
    width,
    height,
    state.project,
    state.currentTime,
    layout,
  );
  if (!rendered.active) return;
  drawCaption(
    previewContext,
    width,
    height,
    getActiveCaption(rendered.active, state.currentTime),
  );
  elements.previewLoading.classList.add("ready");
}

function updateTransportUI() {
  const layout = computeLayout(state.project);
  const active = getSceneAt(layout, state.currentTime);
  const beat = getBeatInfo(state.project, state.currentTime);
  const event = getAudioEventAt(state.project, layout, state.currentTime);
  elements.currentTimecode.textContent = formatTimecode(state.currentTime, state.project.fps);
  elements.totalTimecode.textContent = formatTimecode(layout.total, state.project.fps);
  elements.stageClock.textContent = formatClock(state.currentTime, state.project.fps);
  elements.frameTimeLabel.textContent = formatClock(state.currentTime, state.project.fps);
  elements.playBtn.classList.toggle("is-playing", state.playing);
  elements.playBtn.title = state.playing ? "暂停（空格）" : "播放（空格）";
  elements.loopBtn.classList.toggle("active", state.loop);
  elements.loopBtn.setAttribute("aria-pressed", String(state.loop));
  elements.safeFrame.hidden = !elements.safeFrameBtn.classList.contains("active");
  if (active) {
    elements.stageShotNo.textContent = `SHOT ${active.scene.no}`;
    elements.stageShotName.textContent = active.scene.name;
    elements.frameShotLabel.textContent = `${active.scene.no} / ${active.scene.english}`;
    elements.inspectorNo.textContent = selectedScene().no;
  }
  elements.beatDots.forEach((dot, index) => {
    dot.classList.toggle("on", beat.active && beat.beatInBar === index);
  });
  elements.beatCount.textContent = String(beat.beat + 1).padStart(2, "0");
  elements.audioStatus.innerHTML = `<i></i> DRUMS · ${event ? event.type.toUpperCase() : "ARMED"} ${String((event?.beat ?? 0) + 1).padStart(2, "0")}`;
  elements.captionState.classList.toggle(
    "quiet",
    !getActiveCaption(active, state.currentTime),
  );
}

function currentClockTime() {
  if (state.clockSource === "audio" && audioEngine.running) {
    const time = audioEngine.getTime();
    if (time !== null) return time;
  }
  return (
    state.clockAnchorTime +
    (performance.now() - state.clockAnchorPerformance) / 1000
  );
}

function stopAnimationFrame() {
  if (state.rafId !== null) {
    cancelAnimationFrame(state.rafId);
    state.rafId = null;
  }
}

function animationFrame() {
  if (!state.playing) return;
  const layout = computeLayout(state.project);
  const time = currentClockTime();
  if (time >= layout.total - 0.0005) {
    if (state.loop && layout.total > 0.5) {
      const token = ++state.playToken;
      state.currentTime = 0;
      state.clockAnchorTime = 0;
      state.clockAnchorPerformance = performance.now();
      state.clockSource = "performance";
      audioEngine
        .start(state.project, layout, 0)
        .then(() => {
          if (token !== state.playToken || !state.playing) return;
          state.clockSource = "audio";
        })
        .catch(() => {
          state.clockSource = "performance";
        });
      drawPreview();
      drawTimeline();
      updateTransportUI();
      state.rafId = requestAnimationFrame(animationFrame);
      return;
    }
    state.playing = false;
    audioEngine.stop();
    state.currentTime = layout.total;
    stopAnimationFrame();
    drawPreview();
    drawTimeline();
    updateTransportUI();
    return;
  }
  state.currentTime = roundFrame(clamp(time, 0, layout.total), state.project.fps);
  syncSelectionToActive(layout);
  drawPreview();
  drawTimeline();
  updateTransportUI();
  state.rafId = requestAnimationFrame(animationFrame);
}

async function play() {
  if (state.playing || state.exportInProgress) return;
  const layout = computeLayout(state.project);
  if (layout.total <= 0.1) return;
  if (state.currentTime >= layout.total - 1 / state.project.fps) {
    state.currentTime = 0;
  }
  const from = state.currentTime;
  const token = ++state.playToken;
  state.playing = true;
  state.clockAnchorTime = from;
  state.clockAnchorPerformance = performance.now();
  state.clockSource = "performance";
  updateTransportUI();
  try {
    await audioEngine.start(state.project, layout, from);
    if (token !== state.playToken) return;
    state.clockSource = "audio";
  } catch (error) {
    if (token !== state.playToken) return;
    toast(`音频不可用，画面继续使用内部时钟：${error.message}`, "warn");
  }
  stopAnimationFrame();
  state.rafId = requestAnimationFrame(animationFrame);
}

function pause() {
  if (!state.playing) {
    audioEngine.stop();
    return;
  }
  const time = currentClockTime();
  state.playToken += 1;
  state.playing = false;
  audioEngine.stop();
  stopAnimationFrame();
  const layout = computeLayout(state.project);
  state.currentTime = roundFrame(clamp(time, 0, layout.total), state.project.fps);
  drawPreview();
  drawTimeline();
  updateTransportUI();
}

async function seekTo(time, options = {}) {
  const layout = computeLayout(state.project);
  const next = roundFrame(clamp(Number(time) || 0, 0, layout.total), state.project.fps);
  const wasPlaying = state.playing;
  audioEngine.stop();
  state.currentTime = next;
  if (wasPlaying) {
    const token = ++state.playToken;
    state.clockAnchorTime = next;
    state.clockAnchorPerformance = performance.now();
    state.clockSource = "performance";
    try {
      await audioEngine.start(state.project, layout, next);
      if (!state.playing || token !== state.playToken) return;
      state.clockSource = "audio";
    } catch {
      state.clockSource = "performance";
    }
    if (state.playing) {
      stopAnimationFrame();
      state.rafId = requestAnimationFrame(animationFrame);
    }
  } else if (options.startPlaying) {
    await play();
    return;
  }
  drawPreview();
  syncSelectionToActive(layout);
  drawTimeline();
  updateTransportUI();
}

function selectScene(sceneId, options = {}) {
  const layout = computeLayout(state.project);
  const item = layout.sceneById.get(sceneId);
  if (!item) return;
  state.selectedId = sceneId;
  const shouldSeek = options.seek !== false;
  if (shouldSeek) {
    seekTo(item.start);
  }
  renderShotList();
  renderTimelineBase();
  syncInspector();
  drawPreview();
  drawTimeline();
  updateTransportUI();
}

function stepScene(direction) {
  const layout = computeLayout(state.project);
  const current = getSceneAt(layout, state.currentTime);
  if (!current) return;
  const index = clamp(current.index + direction, 0, layout.scenes.length - 1);
  selectScene(layout.scenes[index].scene.id);
}

function timelineMetrics() {
  const layout = computeLayout(state.project);
  const containerWidth = Math.max(640, elements.timelineScroll.clientWidth);
  const height = Math.max(205, elements.timelineScroll.clientHeight);
  const left = 94;
  const right = 22;
  const desired = left + right + Math.max(620, layout.total * 43);
  const width = Math.max(containerWidth, desired);
  const pps = (width - left - right) / Math.max(layout.total, 0.5);
  const videoY = 35;
  const videoH = clamp(height * 0.37, 72, 96);
  const captionY = videoY + videoH + 8;
  const captionH = 23;
  const audioY = captionY + captionH + 8;
  const audioH = Math.max(40, height - audioY - 9);
  return {
    layout,
    width,
    height,
    left,
    right,
    pps,
    rulerH: 28,
    videoY,
    videoH,
    captionY,
    captionH,
    audioY,
    audioH,
    dpr: Math.min(window.devicePixelRatio || 1, 2),
  };
}

function resizeTimelineCanvas() {
  const metrics = timelineMetrics();
  const dpr = metrics.dpr;
  const pixelWidth = Math.round(metrics.width * dpr);
  const pixelHeight = Math.round(metrics.height * dpr);
  if (elements.timelineCanvas.width !== pixelWidth || elements.timelineCanvas.height !== pixelHeight) {
    elements.timelineCanvas.width = pixelWidth;
    elements.timelineCanvas.height = pixelHeight;
    elements.timelineCanvas.style.width = `${metrics.width}px`;
    elements.timelineCanvas.style.height = `${metrics.height}px`;
  }
  if (timelineBase.width !== pixelWidth || timelineBase.height !== pixelHeight) {
    timelineBase.width = pixelWidth;
    timelineBase.height = pixelHeight;
  }
  state.timelineMetrics = metrics;
  return metrics;
}

function timelineX(time, metrics = state.timelineMetrics) {
  return metrics.left + time * metrics.pps;
}

function drawRoundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.roundRect(x, y, width, height, Math.min(radius, height / 2, width / 2));
}

function drawTimelineRuler(context, metrics) {
  const { width, height, left, right, pps, rulerH, layout } = metrics;
  context.fillStyle = "#0d1215";
  context.fillRect(0, 0, width, rulerH);
  context.fillStyle = "#0a0e11";
  context.fillRect(left, 0, width - left - right, rulerH);

  context.strokeStyle = "#222a2f";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0, rulerH + 0.5);
  context.lineTo(width, rulerH + 0.5);
  context.stroke();

  const beatDuration = 60 / state.project.audio.bpm;
  const halfBeat = beatDuration / 2;
  const labelStep = pps * 2 < 56 ? 4 : pps * 2 < 90 ? 2 : 1;
  const end = Math.ceil(layout.total / halfBeat) + 1;
  for (let index = 0; index <= end; index += 1) {
    const time = index * halfBeat;
    if (time > layout.total + 0.01) break;
    const x = left + time * pps;
    const isBeat = index % 2 === 0;
    const isBar = isBeat && (index / 2) % 4 === 0;
    context.strokeStyle = isBar
      ? "rgba(201,211,205,0.19)"
      : isBeat
        ? "rgba(171,184,179,0.11)"
        : "rgba(155,168,163,0.055)";
    context.beginPath();
    context.moveTo(x + 0.5, isBar ? rulerH - 9 : isBeat ? rulerH - 5 : rulerH - 3);
    context.lineTo(x + 0.5, height);
    context.stroke();
  }

  context.font = '8px "DM Mono", monospace';
  context.textBaseline = "middle";
  context.textAlign = "left";
  const labelEvery = labelStep;
  for (let second = 0; second <= Math.ceil(layout.total); second += labelEvery) {
    if (second > layout.total + 0.4) break;
    const x = left + second * pps;
    const minutes = Math.floor(second / 60);
    const seconds = second % 60;
    context.fillStyle = second === 0 ? "#d2d7d2" : "#677276";
    context.fillText(
      `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`,
      x + 4,
      rulerH / 2, 
    );
  }

  context.font = '7px "DM Mono", monospace';
  context.fillStyle = "#596469";
  context.fillText("TIME", 14, rulerH / 2);
  context.fillStyle = "#333d42";
  context.fillText("120 BPM · 4/4", 46, rulerH / 2);
  context.textAlign = "right";
  context.fillStyle = "#465156";
  context.fillText(`${layout.total.toFixed(1)}s`, width - 12, rulerH / 2);
}

function drawTrackLabels(context, metrics) {
  const { left, videoY, videoH, captionY, captionH, audioY, audioH } = metrics;
  context.fillStyle = "#0a0e11";
  context.fillRect(0, metrics.rulerH, left, metrics.height - metrics.rulerH);
  context.strokeStyle = "#1e262b";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(left - 0.5, metrics.rulerH);
  context.lineTo(left - 0.5, metrics.height);
  context.stroke();

  const sections = [
    { y: videoY, h: videoH, color: "#f4b643", label: "画面", sub: "VIDEO", icon: "▣" },
    { y: captionY, h: captionH, color: "#9ba9ad", label: "字幕", sub: "TEXT", icon: "T" },
    { y: audioY, h: audioH, color: "#49c5b6", label: "鼓组", sub: "DRUMS", icon: "◉" },
  ];

  sections.forEach((section) => {
    context.fillStyle = "#11171a";
    context.beginPath();
    context.roundRect(8, section.y, 72, Math.min(section.h, 48), 4);
    context.fill();
    context.fillStyle = section.color;
    context.fillRect(8, section.y, 2, Math.min(section.h, 48));
    context.font = '10px "Noto Sans SC", sans-serif';
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.fillStyle = "#9da8a5";
    context.fillText(section.label, 17, section.y + 15);
    context.font = '7px "DM Mono", monospace';
    context.fillStyle = "#526066";
    context.fillText(section.sub, 17, section.y + 28);
    context.font = '12px "DM Mono", monospace';
    context.textAlign = "right";
    context.fillStyle = section.color;
    context.globalAlpha = 0.55;
    context.fillText(section.icon, 74, section.y + 22);
    context.globalAlpha = 1;
  });
}

function drawClip(context, metrics, item) {
  const { videoY, videoH } = metrics;
  const gap = 1.5;
  const x1 = timelineX(item.start, metrics) + gap;
  const x2 = timelineX(item.end, metrics) - gap;
  const width = Math.max(4, x2 - x1);
  const selected = item.scene.id === state.selectedId;
  const radius = 5;

  context.save();
  drawRoundedRect(context, x1, videoY, width, videoH, radius);
  context.clip();
  context.fillStyle = item.scene.palette[0];
  context.fillRect(x1, videoY, width, videoH);

  const thumbWidth = Math.min(width * 0.66, Math.max(38, width - 46));
  if (thumbWidth > 10) {
    context.save();
    context.beginPath();
    context.rect(x1, videoY, thumbWidth, videoH);
    context.clip();
    context.translate(x1, videoY);
    drawContactThumbnail(
      context,
      thumbWidth,
      videoH,
      item.scene,
      Math.min(item.duration * 0.42, item.scene.sourceOut),
    );
    context.restore();
    const fade = context.createLinearGradient(
      x1 + thumbWidth * 0.5,
      0,
      x1 + thumbWidth,
      0,
    );
    fade.addColorStop(0, "rgba(8,11,14,0)");
    fade.addColorStop(1, "rgba(8,11,14,0.78)");
    context.fillStyle = fade;
    context.fillRect(x1 + thumbWidth * 0.5, videoY, thumbWidth * 0.5, videoH);
  }

  context.fillStyle = "rgba(7,10,12,0.55)";
  context.fillRect(x1, videoY + videoH * 0.66, width, videoH * 0.34);

  ctxText(context, {
    text: item.scene.no,
    x: x1 + 7,
    y: videoY + 12,
    font: '8px "DM Mono", monospace',
    color: selected ? "#f4b643" : "rgba(244,182,67,0.72)",
  });
  if (width > 66) {
    ctxText(context, {
      text: item.scene.name,
      x: x1 + 7,
      y: videoY + 28,
      font: '600 10px "Noto Sans SC", sans-serif',
      color: "#eef0ec",
    });
    ctxText(context, {
      text: `${item.duration.toFixed(1)}s  ${item.scene.sourceIn.toFixed(1)}→${item.scene.sourceOut.toFixed(1)}`,
      x: x1 + 7,
      y: videoY + videoH - 10,
      font: '7px "DM Mono", monospace',
      color: "rgba(224,231,225,0.62)",
    });
  }
  context.restore();

  context.strokeStyle = selected ? "#f4b643" : "rgba(255,255,255,0.12)";
  context.lineWidth = selected ? 1.5 : 1;
  drawRoundedRect(context, x1 + 0.5, videoY + 0.5, width - 1, videoH - 1, radius);
  context.stroke();

  if (selected) {
    context.fillStyle = "#f4b643";
    context.fillRect(x1 + 2.5, videoY + videoH * 0.27, 2, videoH * 0.46);
    context.fillRect(x2 - 4.5, videoY + videoH * 0.27, 2, videoH * 0.46);
    context.font = '6px "DM Mono", monospace';
    context.textBaseline = "bottom";
    context.textAlign = "left";
    context.fillStyle = "rgba(244,182,67,0.8)";
    context.fillText("IN", x1 + 1, videoY - 3);
    context.textAlign = "right";
    context.fillText("OUT", x2 - 1, videoY - 3);
  }

  state.timelineHit.clips.push({
    sceneId: item.scene.id,
    x1,
    x2,
    y1: videoY,
    y2: videoY + videoH,
    item,
  });
}

function ctxText(context, { text, x, y, font, color }) {
  context.font = font;
  context.fillStyle = color;
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.fillText(text, x, y);
}

function drawCaptionSegments(context, metrics) {
  const { captionY, captionH, left } = metrics;
  context.fillStyle = "#0c1114";
  context.fillRect(left, captionY, metrics.width - left - metrics.right, captionH);
  metrics.layout.scenes.forEach((item) => {
    const start = item.start + item.scene.subtitle.in;
    const end = Math.min(item.end, item.start + item.scene.subtitle.out);
    if (end <= start) return;
    const x1 = timelineX(start, metrics);
    const x2 = timelineX(end, metrics);
    const width = Math.max(3, x2 - x1);
    context.fillStyle = "rgba(140,160,164,0.17)";
    drawRoundedRect(context, x1 + 1, captionY + 4, width - 2, captionH - 8, 3);
    context.fill();
    context.strokeStyle = "rgba(188,204,205,0.22)";
    context.lineWidth = 1;
    context.stroke();
    if (width > 42) {
      context.save();
      context.beginPath();
      context.rect(x1 + 3, captionY, width - 6, captionH);
      context.clip();
      ctxText(context, {
        text: item.scene.subtitle.text,
        x: x1 + 7,
        y: captionY + captionH / 2,
        font: '8px "Noto Sans SC", sans-serif',
        color: "#aeb9b5",
      });
      context.restore();
    }
    state.timelineHit.captions.push({ x1, x2, y1: captionY, y2: captionY + captionH });
  });
}

function drawAudioTrack(context, metrics) {
  const { audioY, audioH, left } = metrics;
  const events = computeAudioEvents(state.project, metrics.layout);
  context.fillStyle = "#0b1314";
  context.fillRect(left, audioY, metrics.width - left - metrics.right, audioH);
  context.strokeStyle = "rgba(51,80,77,0.22)";
  context.lineWidth = 1;
  for (let index = 0; index < 4; index += 1) {
    const y = audioY + (audioH / 4) * index + 0.5;
    context.beginPath();
    context.moveTo(left, y);
    context.lineTo(metrics.width - metrics.right, y);
    context.stroke();
  }

  if (state.project.audio.start > 0) {
    const x = timelineX(state.project.audio.start, metrics);
    context.strokeStyle = "rgba(244,182,67,0.38)";
    context.lineDashOffset = 0;
    context.setLineDash([3, 3]);
    context.beginPath();
    context.moveTo(x + 0.5, audioY);
    context.lineTo(x + 0.5, audioY + audioH);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = "rgba(244,182,67,0.75)";
    context.font = '6px "DM Mono", monospace';
    context.textBaseline = "top";
    context.textAlign = "left";
    context.fillText("IN", x + 3, audioY + 4);
  }

  const center = audioY + audioH * 0.57;
  for (const event of events) {
    const x = timelineX(event.time, metrics);
    const isKick = event.type === "kick";
    const isSnare = event.type === "snare";
    const height = isKick
      ? audioH * 0.64
      : isSnare
        ? audioH * 0.48
        : event.type === "rim"
          ? audioH * 0.35
          : audioH * 0.22;
    const color = isKick
      ? "rgba(72,205,185,0.9)"
      : isSnare
        ? "rgba(72,205,185,0.58)"
        : "rgba(72,205,185,0.3)";
    context.fillStyle = color;
    const barWidth = isKick ? 3 : isSnare ? 2.4 : 1.3;
    context.fillRect(x - barWidth / 2, center - height, barWidth, height);
    if (isKick || isSnare) {
      context.fillStyle = "rgba(100,226,205,0.14)";
      context.beginPath();
      context.arc(x, center + 5, isKick ? 3 : 2, 0, Math.PI * 2);
      context.fill();
    }
  }

  context.strokeStyle = "rgba(73,197,182,0.38)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(left, center + 0.5);
  context.lineTo(metrics.width - metrics.right, center + 0.5);
  context.stroke();

  metrics.layout.scenes.forEach((item, index) => {
    const x = timelineX(item.start, metrics);
    context.font = '6px "DM Mono", monospace';
    context.textAlign = "left";
    context.textBaseline = "top";
    context.fillStyle = "rgba(117,194,182,0.55)";
    context.fillText(`S${String(index + 1).padStart(2, "0")}`, x + 4, audioY + 3);
  });
}

function renderTimelineBase() {
  const metrics = resizeTimelineCanvas();
  state.timelineMetrics = metrics;
  state.timelineHit = { clips: [], captions: [] };
  const context = timelineBase.getContext("2d");
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = "#0a0e11";
  context.fillRect(0, 0, timelineBase.width, timelineBase.height);
  context.setTransform(metrics.dpr, 0, 0, metrics.dpr, 0, 0);
  context.fillStyle = "#0a0e11";
  context.fillRect(0, 0, metrics.width, metrics.height);
  drawTimelineRuler(context, metrics);

  const { left, right, videoY, videoH, captionY, captionH, audioY, audioH } = metrics;
  context.fillStyle = "#101619";
  context.fillRect(left, videoY, metrics.width - left - right, videoH);
  context.fillStyle = "#0c1114";
  context.fillRect(left, captionY, metrics.width - left - right, captionH);
  context.fillStyle = "#0b1314";
  context.fillRect(left, audioY, metrics.width - left - right, audioH);
  context.strokeStyle = "#1a2227";
  context.beginPath();
  context.moveTo(left, videoY - 4.5);
  context.lineTo(metrics.width - right, videoY - 4.5);
  context.stroke();

  metrics.layout.scenes.forEach((item) => drawClip(context, metrics, item));
  drawCaptionSegments(context, metrics);
  drawAudioTrack(context, metrics);
  drawTrackLabels(context, metrics);
}

function drawTimeline() {
  if (!state.timelineMetrics) return;
  const metrics = state.timelineMetrics;
  const context = timelineContext;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, elements.timelineCanvas.width, elements.timelineCanvas.height);
  context.drawImage(timelineBase, 0, 0);
  context.setTransform(metrics.dpr, 0, 0, metrics.dpr, 0, 0);
  const x = timelineX(state.currentTime, metrics);
  const y = metrics.rulerH;

  context.fillStyle = "rgba(244,182,67,0.09)";
  context.fillRect(x - 2, 0, 4, metrics.height);
  context.strokeStyle = "#f4b643";
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(x + 0.5, y);
  context.lineTo(x + 0.5, metrics.height);
  context.stroke();
  context.fillStyle = "#f4b643";
  context.beginPath();
  context.moveTo(x - 5, 0);
  context.lineTo(x + 5, 0);
  context.lineTo(x + 5, 8);
  context.lineTo(x, 12);
  context.lineTo(x - 5, 8);
  context.closePath();
  context.fill();

  if (state.timelineHover && !state.drag) {
    const clip = state.timelineHit.clips.find(
      (candidate) => state.timelineHover.sceneId === candidate.sceneId,
    );
    if (clip && state.timelineHover.kind !== "clip") {
      const handleX = state.timelineHover.kind === "in" ? clip.x1 : clip.x2;
      context.fillStyle = "rgba(244,182,67,0.15)";
      context.fillRect(handleX - 4, clip.y1, 8, clip.y2 - clip.y1);
    }
  }
}

function canvasPoint(event) {
  const metrics = state.timelineMetrics;
  const rect = elements.timelineCanvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * metrics.width,
    y: ((event.clientY - rect.top) / rect.height) * metrics.height,
  };
}

function hitTimeline(point) {
  const metrics = state.timelineMetrics;
  if (!metrics) return { kind: "seek", time: 0 };
  const time = clamp(
    (point.x - metrics.left) / metrics.pps,
    0,
    metrics.layout.total,
  );
  if (point.y <= metrics.rulerH) return { kind: "seek", time };
  for (const clip of state.timelineHit.clips) {
    if (point.x < clip.x1 - 4 || point.x > clip.x2 + 4) continue;
    if (point.y < clip.y1 || point.y > clip.y2) continue;
    const edge = clamp(7, 3, (clip.x2 - clip.x1) / 3);
    if (Math.abs(point.x - clip.x1) <= edge) {
      return { kind: "in", sceneId: clip.sceneId, clip, time };
    }
    if (Math.abs(point.x - clip.x2) <= edge) {
      return { kind: "out", sceneId: clip.sceneId, clip, time };
    }
    return { kind: "clip", sceneId: clip.sceneId, clip, time };
  }
  for (const caption of state.timelineHit.captions) {
    if (
      point.x >= caption.x1 &&
      point.x <= caption.x2 &&
      point.y >= caption.y1 &&
      point.y <= caption.y2
    ) {
      return { kind: "seek", time };
    }
  }
  return { kind: "seek", time };
}

function handleTimelinePointerDown(event) {
  if (event.button !== 0 || state.validating || state.exportInProgress) return;
  const point = canvasPoint(event);
  const hit = hitTimeline(point);
  elements.timelineHint.classList.add("hidden");
  event.preventDefault();
  elements.timelineCanvas.setPointerCapture?.(event.pointerId);

  if (hit.kind === "in" || hit.kind === "out") {
    pause();
    selectScene(hit.sceneId, { seek: false });
    const scene = state.project.scenes.find((item) => item.id === hit.sceneId);
    state.drag = {
      kind: "trim",
      mode: hit.kind,
      sceneId: hit.sceneId,
      startX: point.x,
      originIn: scene.sourceIn,
      originOut: scene.sourceOut,
      pps: state.timelineMetrics.pps,
      moved: false,
    };
    seekTo(hit.clip.item.start);
    return;
  }

  if (hit.kind === "clip") {
    pause();
    selectScene(hit.sceneId, { seek: false });
    const clip = hit.clip;
    const local = clamp(
      (point.x - clip.x1) / Math.max(1, clip.x2 - clip.x1),
      0,
      1,
    );
    seekTo(clip.item.start + local * clip.item.duration);
    return;
  }

  pause();
  seekTo(hit.time);
  state.drag = {
    kind: "scrub",
    startX: point.x,
    pps: state.timelineMetrics.pps,
  };
}

function handleTimelinePointerMove(event) {
  const point = canvasPoint(event);
  if (state.drag) {
    if (state.drag.kind === "scrub") {
      seekTo(clamp((point.x - state.timelineMetrics.left) / state.drag.pps, 0, computeLayout(state.project).total));
      return;
    }
    if (state.drag.kind === "trim") {
      const scene = state.project.scenes.find((item) => item.id === state.drag.sceneId);
      if (!scene) return;
      let delta = (point.x - state.drag.startX) / state.drag.pps;
      if (state.snap) {
        const beatStep = 60 / state.project.audio.bpm / 2;
        delta = Math.round(delta / beatStep) * beatStep;
      }
      if (state.drag.mode === "in") {
        scene.sourceIn = roundTime(
          clamp(
            state.drag.originIn + delta,
            0,
            scene.sourceOut - MIN_SHOT_DURATION,
          ),
        );
      } else {
        scene.sourceOut = roundTime(
          clamp(
            state.drag.originOut + delta,
            scene.sourceIn + MIN_SHOT_DURATION,
            SOURCE_LENGTH,
          ),
        );
      }
      state.drag.moved = true;
      const total = computeLayout(state.project).total;
      state.currentTime = clamp(state.currentTime, 0, total);
      markDirty();
      renderStatic();
      drawPreview();
      drawTimeline();
      return;
    }
  }

  const hit = hitTimeline(point);
  state.timelineHover =
    hit.kind === "in" || hit.kind === "out"
      ? { kind: hit.kind, sceneId: hit.sceneId }
      : null;
  elements.timelineCanvas.style.cursor =
    hit.kind === "in" || hit.kind === "out"
      ? "ew-resize"
      : hit.kind === "clip"
        ? "pointer"
        : "crosshair";
  drawTimeline();
}

function handleTimelinePointerUp() {
  if (state.drag?.kind === "trim" && state.drag.moved) {
    const layout = computeLayout(state.project);
    const item = layout.sceneById.get(state.drag.sceneId);
    if (item) {
      const laterCount = layout.scenes.length - item.index - 1;
      toast(
        `${item.scene.no} 时长 ${item.duration.toFixed(2)}s，后续 ${laterCount} 格已自动顺延`,
      );
    }
    persistDraft();
    renderStatic();
    drawTimeline();
  }
  state.drag = null;
  state.timelineHover = null;
  drawTimeline();
}

function afterProjectEdit(options = {}) {
  const layout = computeLayout(state.project);
  state.currentTime = roundFrame(clamp(state.currentTime, 0, layout.total), state.project.fps);
  markDirty();
  updateTimelineMeta(layout);
  if (options.shots !== false) renderShotList();
  syncInspector();
  renderTimelineBase();
  drawPreview();
  drawTimeline();
  updateTransportUI();
}

async function restartAudioIfPlaying() {
  if (!state.playing) return;
  const layout = computeLayout(state.project);
  const from = state.currentTime;
  const token = ++state.playToken;
  audioEngine.stop();
  state.clockAnchorTime = from;
  state.clockAnchorPerformance = performance.now();
  state.clockSource = "performance";
  try {
    await audioEngine.start(state.project, layout, from);
    if (token === state.playToken && state.playing) state.clockSource = "audio";
  } catch {
    state.clockSource = "performance";
  }
}

function updateSceneTrim(scene, field, rawValue) {
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return;
  if (field === "in") {
    scene.sourceIn = roundTime(
      clamp(value, 0, scene.sourceOut - MIN_SHOT_DURATION),
    );
  } else {
    scene.sourceOut = roundTime(
      clamp(value, scene.sourceIn + MIN_SHOT_DURATION, SOURCE_LENGTH),
    );
  }
  afterProjectEdit();
}

function updateSceneDuration(scene, rawDuration) {
  const requested = Number(rawDuration);
  if (!Number.isFinite(requested)) return;
  const duration = clamp(requested, MIN_SHOT_DURATION, SOURCE_LENGTH);
  scene.sourceOut = roundTime(
    clamp(scene.sourceIn + duration, scene.sourceIn + MIN_SHOT_DURATION, SOURCE_LENGTH),
  );
  afterProjectEdit();
}

function updateSubtitleTime(scene, field, rawValue) {
  const value = roundTime(clamp(Number(rawValue) || 0, 0, SOURCE_LENGTH));
  if (field === "in") {
    scene.subtitle.in = value;
    scene.subtitle.out = Math.max(scene.subtitle.out, value + 0.1);
  } else {
    scene.subtitle.out = Math.max(value, scene.subtitle.in + 0.1);
  }
  afterProjectEdit({ shots: false });
}

function addKeyframeAtPlayhead() {
  const layout = computeLayout(state.project);
  const scene = selectedScene();
  const item = selectedSceneItem(layout);
  const local = roundTime(
    clamp(state.currentTime - item.start, 0, item.duration || sceneDuration(scene)),
  );
  const existing = scene.keyframes.find(
    (keyframe) => Math.abs(keyframe.time - local) < 0.04,
  );
  if (existing) {
    existing.zoom = roundTime(clamp(existing.zoom + 0.03, 0.8, 1.7));
    toast(`已更新 ${formatClock(local, state.project.fps)} 的关键帧缩放`);
  } else {
    const previous = [...scene.keyframes]
      .reverse()
      .find((keyframe) => keyframe.time <= local);
    scene.keyframes.push({
      time: local,
      zoom: roundTime(clamp((previous?.zoom || 1.02) + 0.04, 0.85, 1.65)),
      x: previous?.x ?? 0.5,
      y: previous?.y ?? 0.5,
    });
    scene.keyframes.sort((a, b) => a.time - b.time);
    toast(`已在 +${local.toFixed(2)}s 记录关键帧`);
  }
  afterProjectEdit();
}

function togglePlayback() {
  if (state.playing) pause();
  else play();
}

function openModal({ eyebrow, title, body, actions = "", kind = "default" }) {
  state.modalKind = kind;
  elements.modalEyebrow.textContent = eyebrow;
  elements.modalTitle.textContent = title;
  elements.modalBody.innerHTML = body;
  elements.modalActions.innerHTML = actions;
  elements.modalBackdrop.hidden = false;
  window.setTimeout(() => {
    const focusTarget = elements.modalActions.querySelector("button") || elements.modalCloseBtn;
    focusTarget.focus();
  }, 20);
}

function closeModal() {
  if (state.validating || state.exportInProgress) return;
  elements.modalBackdrop.hidden = true;
  state.modalKind = null;
}

function handleProjectFile(file) {
  if (!file) return;
  file
    .text()
    .then((text) => {
      const parsed = JSON.parse(text);
      const project = normalizeProject(parsed);
      pause();
      setProject(project, { selectedId: project.scenes[0].id, time: 0, dirty: true });
      persistDraft();
      afterProjectEdit();
      toast(`已打开「${project.title}」，时间线、字幕和音频起点已恢复`);
    })
    .catch((error) => {
      toast(`无法打开工程：${error.message}`, "error");
    })
    .finally(() => {
      elements.projectFile.value = "";
    });
}

function reloadSavedProject() {
  const stored = loadStoredProject(STORAGE_KEY);
  if (!stored) {
    toast("还没有已保存的工程，请先点击“保存工程”", "warn");
    return;
  }
  pause();
  state.playToken += 1;
  audioEngine.stop();
  setProject(stored.project, {
    selectedId: stored.project.scenes[0].id,
    time: 0,
    savedAt: stored.savedAt,
  });
  toast("已从本地重新载入工程，音频已从头重新调度");
}

function setupInspectorEvents() {
  elements.inPointInput.addEventListener("change", () => {
    updateSceneTrim(selectedScene(), "in", elements.inPointInput.value);
  });
  elements.outPointInput.addEventListener("change", () => {
    updateSceneTrim(selectedScene(), "out", elements.outPointInput.value);
  });
  elements.durationInput.addEventListener("change", () => {
    updateSceneDuration(selectedScene(), elements.durationInput.value);
  });
  elements.durationMinus.addEventListener("click", () => {
    const scene = selectedScene();
    updateSceneDuration(scene, sceneDuration(scene) - 0.25);
  });
  elements.durationPlus.addEventListener("click", () => {
    const scene = selectedScene();
    updateSceneDuration(scene, sceneDuration(scene) + 0.25);
  });
  elements.subtitleInput.addEventListener("input", () => {
    selectedScene().subtitle.text = elements.subtitleInput.value.slice(0, 60);
    elements.captionState.textContent = elements.subtitleInput.value ? "可见" : "空白";
    afterProjectEdit({ shots: false });
  });
  elements.subtitleInInput.addEventListener("change", () => {
    updateSubtitleTime(selectedScene(), "in", elements.subtitleInInput.value);
  });
  elements.subtitleOutInput.addEventListener("change", () => {
    updateSubtitleTime(selectedScene(), "out", elements.subtitleOutInput.value);
  });
  elements.transitionSelect.addEventListener("change", () => {
    const scene = selectedScene();
    scene.transition.type = elements.transitionSelect.value;
    if (scene.transition.type !== "cut" && scene.transition.duration <= 0) {
      scene.transition.duration = 0.35;
    }
    if (scene.transition.type === "cut") scene.transition.duration = 0;
    afterProjectEdit();
  });
  elements.transitionDurationInput.addEventListener("change", () => {
    const scene = selectedScene();
    scene.transition.duration = roundTime(
      clamp(Number(elements.transitionDurationInput.value) || 0, 0, 2),
    );
    if (scene.transition.duration > 0 && scene.transition.type === "cut") {
      scene.transition.type = "dissolve";
    }
    afterProjectEdit();
  });
  elements.addKeyframeBtn.addEventListener("click", addKeyframeAtPlayhead);
  elements.bpmInput.addEventListener("change", () => {
    state.project.audio.bpm = clamp(
      Math.round(Number(elements.bpmInput.value) || 120),
      60,
      200,
    );
    afterProjectEdit();
    restartAudioIfPlaying();
  });
  elements.audioStartInput.addEventListener("change", () => {
    state.project.audio.start = roundTime(
      clamp(Number(elements.audioStartInput.value) || 0, 0, 20),
    );
    afterProjectEdit();
    restartAudioIfPlaying();
  });
}

function setupTransportEvents() {
  elements.playBtn.addEventListener("click", togglePlayback);
  elements.toStartBtn.addEventListener("click", () => {
    seekTo(0);
    selectScene(state.project.scenes[0].id, { seek: false });
  });
  elements.prevShotBtn.addEventListener("click", () => stepScene(-1));
  elements.nextShotBtn.addEventListener("click", () => stepScene(1));
  elements.loopBtn.addEventListener("click", () => {
    state.loop = !state.loop;
    elements.loopBtn.classList.toggle("active", state.loop);
    elements.loopBtn.setAttribute("aria-pressed", String(state.loop));
    toast(state.loop ? "循环播放已开启" : "循环播放已关闭");
  });
  elements.safeFrameBtn.addEventListener("click", () => {
    elements.safeFrameBtn.classList.toggle("active");
    elements.safeFrame.hidden = !elements.safeFrameBtn.classList.contains("active");
  });
  elements.validateBtn.addEventListener("click", runConsistencyCheck);
  elements.snapBtn.addEventListener("click", () => {
    state.snap = !state.snap;
    elements.snapBtn.classList.toggle("active", state.snap);
    elements.snapBtn.setAttribute("aria-pressed", String(state.snap));
    elements.snapBtn.textContent = state.snap ? "吸附 0.25s" : "自由拖动";
  });
  elements.fitBtn.addEventListener("click", () => {
    elements.timelineScroll.scrollLeft = 0;
    renderTimelineBase();
    drawTimeline();
    toast("时间线已回到起点");
  });
}

function projectFileStem() {
  return (
    state.project.title
      .replace(/[\\/:*?"<>|·\s]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 42) || "beatboard"
  );
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function setExportProgress(percent, status, detail) {
  const bar = document.querySelector("#exportProgressBar");
  const percentLabel = document.querySelector("#exportPercent");
  const statusLabel = document.querySelector("#exportStatus");
  const detailLabel = document.querySelector("#exportDetail");
  if (bar) bar.style.width = `${clamp(percent, 0, 100)}%`;
  if (percentLabel) percentLabel.textContent = `${Math.round(percent)}%`;
  if (statusLabel) statusLabel.textContent = status;
  if (detailLabel) detailLabel.textContent = detail || "";
}

function exportProgressBody() {
  return `
    <div class="modal-emblem">◎</div>
    <p id="exportDetail">正在准备导出快照，原工程保持不变。</p>
    <div class="export-progress"><i id="exportProgressBar"></i></div>
    <div class="export-status"><span id="exportStatus">准备中</span><span id="exportPercent">0%</span></div>
  `;
}

function exportTable(manifest) {
  return `
    <table class="export-table">
      <thead><tr><th>SHOT</th><th>IN</th><th>OUT</th><th>DUR</th><th>START</th></tr></thead>
      <tbody>
        ${manifest.scenes
          .map(
            (scene) => `<tr>
              <td>${escapeHtml(scene.no)} ${escapeHtml(scene.name)}</td>
              <td>${scene.inPoint.toFixed(2)}</td>
              <td>${scene.outPoint.toFixed(2)}</td>
              <td>${scene.duration.toFixed(2)}</td>
              <td>${scene.timelineStart.toFixed(2)}</td>
            </tr>`,
          )
          .join("")}
      </tbody>
      <tfoot><tr><td>TOTAL</td><td></td><td></td><td>${manifest.totalDuration.toFixed(2)}</td><td></td></tr></tfoot>
    </table>
  `;
}

function showExportComplete(manifest, filename, medium) {
  state.exportInProgress = false;
  elements.modalCloseBtn.disabled = false;
  const totalCheck = manifest.validation.checks.totalMatches && manifest.validation.checks.endMatches;
  const manifestJson = JSON.stringify(manifest, null, 2);
  openModal({
    eyebrow: "EXPORT COMPLETE",
    title: "导出完成 · 时间线已核验",
    kind: "export-complete",
    body: `
      <div class="modal-emblem">✓</div>
      <p>已生成 <b>${escapeHtml(filename)}</b>。入点、出点和总时长与工程快照一致；导出过程没有改动工程。</p>
      <div class="verify-grid">
        <div class="verify-card"><span>导出总时长</span><b>${manifest.totalDuration.toFixed(2)}s</b></div>
        <div class="verify-card"><span>镜头时长合计</span><b>${manifest.validation.durationSum.toFixed(2)}s</b></div>
        <div class="verify-card"><span>入 / 出点</span><b>${manifest.validation.checks.inOutValid ? "一致" : "异常"}</b></div>
        <div class="verify-card"><span>媒体</span><b>${escapeHtml(medium)}</b></div>
      </div>
      <div class="check-row"><span>总时长 = 六格时长之和</span><strong class="${totalCheck ? "" : "fail"}">${totalCheck ? "PASS" : "FAIL"}</strong></div>
      <div class="check-row"><span>工程指纹未变化</span><strong>PASS</strong></div>
      ${exportTable(manifest)}
    `,
    actions: `
      <button class="btn btn-secondary" id="downloadManifestBtn">下载导出清单</button>
      <button class="btn btn-primary" data-modal-close>完成</button>
    `,
  });
  const button = $("#downloadManifestBtn");
  button?.addEventListener("click", () => {
    downloadBlob(
      new Blob([manifestJson], { type: "application/json" }),
      `${projectFileStem()}-export-manifest.json`,
    );
  });
}

function restoreExportSnapshot(before) {
  state.project = normalizeProject(before.project);
  state.selectedId = before.selectedId;
  state.currentTime = before.currentTime;
  if (before.draft !== null) localStorage.setItem(DRAFT_KEY, before.draft);
  else localStorage.removeItem(DRAFT_KEY);
  if (before.storage !== null) localStorage.setItem(STORAGE_KEY, before.storage);
  else localStorage.removeItem(STORAGE_KEY);
  renderStatic();
  drawPreview();
  drawTimeline();
}

function takeExportSnapshot() {
  if (state.persistTimer !== null) {
    clearPendingAutosave();
    persistDraft();
  }
  return {
    project: cloneProject(state.project),
    selectedId: state.selectedId,
    currentTime: state.currentTime,
    draft: localStorage.getItem(DRAFT_KEY),
    storage: localStorage.getItem(STORAGE_KEY),
    fingerprint: snapshotHash(timelineSnapshot(state.project)),
  };
}

function showExportFailure(error, before, medium) {
  state.exportInProgress = false;
  elements.modalCloseBtn.disabled = false;
  restoreExportSnapshot(before);
  openModal({
    eyebrow: "EXPORT INTERRUPTED",
    title: "导出失败 · 原工程已保留",
    kind: "export-failed",
    body: `
      <div class="modal-emblem error">!</div>
      <p>${escapeHtml(medium)}没有生成。错误信息：<b>${escapeHtml(error.message || "未知错误")}</b></p>
      <div class="check-row"><span>工程时间线</span><strong>已回滚至导出前</strong></div>
      <div class="check-row"><span>入点 / 出点 / 字幕 / 关键帧</span><strong>完整保留</strong></div>
      <div class="check-row"><span>自动保存草稿</span><strong>未覆盖</strong></div>
      <p style="margin-top:12px;color:#667276">可以修正问题后重新导出；当前工程仍可继续编辑。</p>
    `,
    actions: `<button class="btn btn-primary" data-modal-close>返回工程</button>`,
  });
}

async function exportStoryboardSheet() {
  if (state.exportInProgress) return;
  const before = takeExportSnapshot();
  state.exportInProgress = true;
  elements.modalCloseBtn.disabled = true;
  openModal({
    eyebrow: "STORYBOARD SHEET",
    title: "正在绘制六格分镜表",
    body: exportProgressBody(),
    kind: "export-progress",
  });
  setExportProgress(22, "绘制缩略图", "从同一工程快照生成六格画面");
  try {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (state.forceExportFailure) throw new Error("测试注入：分镜表渲染失败");
    const { canvas, validation } = drawStoryboardSheet(state.project);
    if (!validation.ok) throw new Error("时间线完整性检查未通过");
    const afterFingerprint = snapshotHash(timelineSnapshot(state.project));
    if (afterFingerprint !== before.fingerprint) throw new Error("导出期间工程指纹发生变化");
    setExportProgress(78, "编码 PNG", "2400 × 1700 px");
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error("PNG 编码失败"));
      }, "image/png");
    });
    const filename = `${projectFileStem()}-storyboard.png`;
    downloadBlob(blob, filename);
    setExportProgress(100, "完成", `${(blob.size / 1024).toFixed(0)} KB`);
    const manifest = buildExportManifest(state.project, {
      medium: "PNG storyboard",
      filename,
      bytes: blob.size,
    });
    showExportComplete(manifest, filename, "PNG · 3×2 联系表");
  } catch (error) {
    showExportFailure(error, before, "分镜表");
  }
}

function exportCsv() {
  try {
    const validation = validateTimelineIntegrity(state.project);
    if (!validation.ok) throw new Error("时间线完整性检查未通过");
    const csv = buildStoryboardCsv(state.project);
    const filename = `${projectFileStem()}-timeline.csv`;
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), filename);
    toast(`分镜表已导出 · ${validation.total.toFixed(2)}s`);
  } catch (error) {
    toast(`分镜表导出失败：${error.message}`, "error");
  }
}

function exportJsonBackup() {
  try {
    const payload = projectForStorage(state.project);
    downloadBlob(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
      `${projectFileStem()}-project.json`,
    );
    toast("工程备份已下载，可通过“打开工程文件”恢复");
  } catch (error) {
    toast(`工程备份失败：${error.message}`, "error");
  }
}

function supportedVideoMime() {
  if (typeof MediaRecorder === "undefined") return "";
  return [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ].find((mime) => MediaRecorder.isTypeSupported(mime)) || "";
}

async function exportMovie() {
  if (state.exportInProgress) return;
  const before = takeExportSnapshot();
  pause();
  state.exportInProgress = true;
  elements.modalCloseBtn.disabled = true;
  openModal({
    eyebrow: "RENDER MOVIE",
    title: "正在合成影片",
    body: exportProgressBody(),
    kind: "export-progress",
  });
  setExportProgress(3, "冻结工程快照", "导出不会改动当前时间线");

  let exportContext = null;
  let sourceNode = null;
  let recorder = null;
  let stream = null;
  try {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (state.forceExportFailure) throw new Error("测试注入：合成器拒绝输出");
    const mimeType = supportedVideoMime();
    if (!mimeType) throw new Error("当前浏览器不支持 MediaRecorder / WebM 导出");
    const layout = computeLayout(state.project);
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    const context = canvas.getContext("2d", { alpha: false });
    const captureStream = canvas.captureStream?.bind(canvas);
    if (!captureStream) throw new Error("当前浏览器不支持 Canvas 捕获流");

    setExportProgress(8, "离线合成鼓点", `${layout.total.toFixed(1)} 秒 Web Audio`);
    const audioBuffer = await renderDrumBuffer(state.project, layout, 48000);
    setExportProgress(25, "建立媒体流", "1280 × 720 · 30 FPS");
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    exportContext = new AudioContextClass({ latencyHint: "playback" });
    await exportContext.resume();
    const destination = exportContext.createMediaStreamDestination();
    const exportGain = exportContext.createGain();
    exportGain.gain.value = 1;
    sourceNode = exportContext.createBufferSource();
    sourceNode.buffer = audioBuffer;
    sourceNode.connect(exportGain).connect(destination);
    stream = captureStream(30);
    const audioTrack = destination.stream.getAudioTracks()[0];
    if (!audioTrack) throw new Error("无法创建导出音轨");
    stream.addTrack(audioTrack);

    const chunks = [];
    recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 4_500_000,
      audioBitsPerSecond: 128_000,
    });
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });
    const recorderStopped = new Promise((resolve, reject) => {
      recorder.addEventListener("stop", resolve, { once: true });
      recorder.addEventListener("error", () => reject(new Error("MediaRecorder 中断")), {
        once: true,
      });
    });

    drawProgramFrame(context, 1280, 720, state.project, 0, layout);
    recorder.start(250);
    const origin = exportContext.currentTime + 0.03;
    sourceNode.start(origin);

    await new Promise((resolve, reject) => {
      const draw = () => {
        try {
          const elapsed = Math.max(0, exportContext.currentTime - origin);
          const time = Math.min(elapsed, layout.total);
          const rendered = drawProgramFrame(
            context,
            1280,
            720,
            state.project,
            time,
            layout,
          );
          drawCaption(
            context,
            1280,
            720,
            getActiveCaption(rendered.active, time),
          );
          const percent = 25 + (time / Math.max(0.01, layout.total)) * 68;
          setExportProgress(
            percent,
            "实时渲染与录音",
            `${formatClock(time, state.project.fps)} / ${formatClock(layout.total, state.project.fps)}`,
          );
          if (elapsed >= layout.total) resolve();
          else requestAnimationFrame(draw);
        } catch (error) {
          reject(error);
        }
      };
      requestAnimationFrame(draw);
    });

    await new Promise((resolve) => window.setTimeout(resolve, 120));
    try {
      sourceNode.stop();
    } catch {
      // The source reaches its natural end at the same instant.
    }
    if (recorder.state !== "inactive") recorder.stop();
    await recorderStopped;
    setExportProgress(96, "封装 WebM", "核对工程指纹与时长");
    const blob = new Blob(chunks, { type: mimeType });
    if (blob.size < 1000) throw new Error("录像文件为空");

    const afterFingerprint = snapshotHash(timelineSnapshot(state.project));
    if (afterFingerprint !== before.fingerprint) {
      throw new Error("导出期间工程指纹发生变化");
    }
    const validation = validateTimelineIntegrity(state.project);
    if (!validation.ok) throw new Error("时间线完整性检查未通过");

    const filename = `${projectFileStem()}-film.webm`;
    downloadBlob(blob, filename);
    setExportProgress(100, "导出完成", `${(blob.size / 1024 / 1024).toFixed(1)} MB`);
    const manifest = buildExportManifest(state.project, {
      medium: "WebM",
      filename,
      mimeType,
      bytes: blob.size,
      audioTrack: "Web Audio synthesized drums",
      actualRecordedDuration: Number((exportContext.currentTime - origin).toFixed(3)),
    });
    showExportComplete(manifest, filename, `WebM · ${mimeType.includes("vp9") ? "VP9" : "VP8"} + Opus`);
  } catch (error) {
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        // Recorder may already be stopped by the failure path.
      }
    }
    try {
      sourceNode?.stop();
    } catch {
      // Ignore already-ended sources.
    }
    showExportFailure(error, before, "影片");
  } finally {
    stream?.getTracks().forEach((track) => track.stop());
    if (exportContext && exportContext.state !== "closed") {
      try {
        await exportContext.close();
      } catch {
        // A closed audio context is harmless.
      }
    }
  }
}

function handleExportChoice(type) {
  elements.exportMenu.hidden = true;
  elements.exportBtn.setAttribute("aria-expanded", "false");
  if (type === "video") exportMovie();
  else if (type === "sheet") exportStoryboardSheet();
  else if (type === "csv") exportCsv();
  else if (type === "json") exportJsonBackup();
}

function setupExportEvents() {
  elements.exportBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    const next = elements.exportMenu.hidden;
    elements.exportMenu.hidden = !next;
    elements.exportBtn.setAttribute("aria-expanded", String(next));
  });
  elements.exportMenu.addEventListener("click", (event) => {
    const item = event.target.closest("[data-export]");
    if (item) handleExportChoice(item.dataset.export);
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".export-wrap")) {
      elements.exportMenu.hidden = true;
      elements.exportBtn.setAttribute("aria-expanded", "false");
    }
  });
  elements.modalCloseBtn.addEventListener("click", closeModal);
  elements.modalBackdrop.addEventListener("click", (event) => {
    if (event.target === elements.modalBackdrop) closeModal();
  });
  elements.modalActions.addEventListener("click", (event) => {
    if (event.target.closest("[data-modal-close]")) closeModal();
  });
  elements.saveProjectBtn.addEventListener("click", saveProject);
  elements.reloadProjectBtn.addEventListener("click", reloadSavedProject);
  elements.openProjectBtn.addEventListener("click", () => elements.projectFile.click());
  elements.projectFile.addEventListener("change", () => {
    handleProjectFile(elements.projectFile.files?.[0]);
  });
}

function validationCapture() {
  const layout = computeLayout(state.project);
  const active = getSceneAt(layout, state.currentTime);
  const event = getAudioEventAt(state.project, layout, state.currentTime);
  return {
    time: state.currentTime,
    hash: hashCanvas(elements.previewCanvas),
    sceneId: active?.scene.id || null,
    sceneNo: active?.scene.no || "--",
    sceneName: active?.scene.name || "--",
    sceneIndex: active?.index ?? -1,
    localTime: active ? roundTime(state.currentTime - active.start) : 0,
    caption: active ? getActiveCaption(active, state.currentTime) : null,
    event: event
      ? {
          id: event.id,
          type: event.type,
          time: event.time,
          beat: event.beat,
          sceneIndex: event.sceneIndex,
        }
      : null,
    keyframeSignature: JSON.stringify(
      state.project.scenes.map((scene) =>
        scene.keyframes.map((keyframe) => [
          keyframe.time,
          keyframe.zoom,
          keyframe.x,
          keyframe.y,
        ]),
      ),
    ),
    transitionSignature: JSON.stringify(
      state.project.scenes.map((scene) => [
        scene.id,
        scene.transition.type,
        scene.transition.duration,
        scene.subtitle.in,
        scene.subtitle.out,
      ]),
    ),
  };
}

function waitUntilPlayhead(target, timeoutMs, onProgress) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const check = () => {
      if (!state.playing) {
        resolve();
        return;
      }
      onProgress?.(Math.min(state.currentTime, target), target);
      if (state.currentTime >= target - 0.0005) {
        resolve();
        return;
      }
      if (performance.now() - started > timeoutMs) {
        reject(new Error("等待回放到达目标时刻超时"));
        return;
      }
      window.setTimeout(check, 35);
    };
    check();
  });
}

async function runConsistencyCheck() {
  if (state.validating || state.exportInProgress) return;
  const layout = computeLayout(state.project);
  pause();
  if (state.currentTime < 0.05 || state.currentTime >= layout.total - 0.05) {
    state.currentTime = roundFrame(layout.total * 0.42, state.project.fps);
    await seekTo(state.currentTime);
  }
  const target = roundFrame(state.currentTime, state.project.fps);
  const first = validationCapture();
  const projectSnapshot = cloneProject(state.project);
  state.validating = true;
  elements.modalCloseBtn.disabled = true;
  openModal({
    eyebrow: "DETERMINISM CHECK",
    title: "正在从零回放到目标帧",
    body: `
      <div class="modal-emblem">↻</div>
      <p>目标：<b>${formatTimecode(target, state.project.fps)}</b> · ${escapeHtml(first.sceneNo)} ${escapeHtml(first.sceneName)}</p>
      <div class="export-progress"><i id="verifyProgressBar"></i></div>
      <div class="export-status"><span id="verifyStatus">暂停帧已记录</span><span id="verifyPercent">0%</span></div>
      <p style="margin-top:12px;color:#596469">画面不会另起随机种子；声音从工程音频起点重新调度。</p>
    `,
    kind: "validation-progress",
  });

  try {
    await seekTo(0);
    await play();
    await waitUntilPlayhead(target, Math.max(8000, target * 1000 + 6000), (time) => {
      const progress = target > 0 ? (time / target) * 100 : 100;
      const bar = $("#verifyProgressBar");
      const percent = $("#verifyPercent");
      const status = $("#verifyStatus");
      if (bar) bar.style.width = `${clamp(progress, 0, 100)}%`;
      if (percent) percent.textContent = `${Math.round(progress)}%`;
      if (status) status.textContent = `${formatClock(time, state.project.fps)} / ${formatClock(target, state.project.fps)}`;
    });
    pause();
    await seekTo(target);
    const second = validationCapture();

    const visualMatch = first.hash === second.hash;
    const sceneMatch = first.sceneId === second.sceneId && first.localTime === second.localTime;
    const audioMatch =
      JSON.stringify(first.event) === JSON.stringify(second.event) &&
      Boolean(first.event) &&
      first.event.sceneIndex === second.event.sceneIndex;
    const captionMatch = first.caption === second.caption;
    const keyframeMatch = first.keyframeSignature === second.keyframeSignature;
    const transitionMatch = first.transitionSignature === second.transitionSignature;
    const projectUnchanged =
      snapshotHash(timelineSnapshot(projectSnapshot)) ===
      snapshotHash(timelineSnapshot(state.project));
    const timelineCheck = validateTimelineIntegrity(state.project);
    const allPassed =
      visualMatch &&
      sceneMatch &&
      audioMatch &&
      captionMatch &&
      keyframeMatch &&
      transitionMatch &&
      projectUnchanged &&
      timelineCheck.ok;

    state.validating = false;
    elements.modalCloseBtn.disabled = false;
    const eventText = second.event
      ? `${second.event.type.toUpperCase()} #${String(second.event.beat + 1).padStart(2, "0")} @ ${formatClock(second.event.time, state.project.fps)}`
      : "目标时刻之前没有鼓点";
    openModal({
      eyebrow: "DETERMINISM CHECK",
      title: allPassed ? "同一时刻 · 完全可复现" : "发现不一致",
      kind: "validation-result",
      body: `
        <div class="modal-emblem${allPassed ? "" : " error"}">${allPassed ? "✓" : "!"}</div>
        <p>从 <b>00:00</b> 回放到 <b>${formatTimecode(target, state.project.fps)}</b> 后，画面指纹与声音事件均重新核对。</p>
        <div class="verify-grid">
          <div class="verify-card"><span>暂停帧指纹</span><b>${first.hash}</b></div>
          <div class="verify-card"><span>回放帧指纹</span><b>${second.hash}</b></div>
          <div class="verify-card"><span>对应画面</span><b>${escapeHtml(second.sceneNo)} ${escapeHtml(second.sceneName)} +${second.localTime.toFixed(2)}s</b></div>
          <div class="verify-card"><span>对应鼓点</span><b>${escapeHtml(eventText)}</b></div>
        </div>
        <div class="check-row"><span>Canvas 像素一致</span><strong class="${visualMatch ? "" : "fail"}">${visualMatch ? "PASS" : "FAIL"}</strong></div>
        <div class="check-row"><span>场景 / 本格时间一致</span><strong class="${sceneMatch ? "" : "fail"}">${sceneMatch ? "PASS" : "FAIL"}</strong></div>
        <div class="check-row"><span>字幕显示一致</span><strong class="${captionMatch ? "" : "fail"}">${captionMatch ? "PASS" : "FAIL"}</strong></div>
        <div class="check-row"><span>音频事件一致</span><strong class="${audioMatch ? "" : "fail"}">${audioMatch ? "PASS" : "FAIL"}</strong></div>
        <div class="check-row"><span>关键帧 / 转场未变化</span><strong class="${keyframeMatch && transitionMatch ? "" : "fail"}">${keyframeMatch && transitionMatch ? "PASS" : "FAIL"}</strong></div>
        <div class="check-row"><span>六格总时长 = ${timelineCheck.durationSum.toFixed(2)}s</span><strong class="${timelineCheck.ok ? "" : "fail"}">${timelineCheck.ok ? "PASS" : "FAIL"}</strong></div>
        <p style="margin-top:12px;color:#667276">最终播放头停在目标帧，可直接导出截帧作为复核凭据。</p>
      `,
      actions: `
        <button class="btn btn-secondary" id="saveValidationFrameBtn">下载目标帧</button>
        <button class="btn btn-primary" data-modal-close>关闭</button>
      `,
    });
    $("#saveValidationFrameBtn")?.addEventListener("click", () => {
      elements.previewCanvas.toBlob((blob) => {
        if (!blob) return;
        downloadBlob(
          blob,
          `${projectFileStem()}-check-${second.hash}.png`,
        );
      }, "image/png");
    });
  } catch (error) {
    pause();
    state.validating = false;
    elements.modalCloseBtn.disabled = false;
    openModal({
      eyebrow: "DETERMINISM CHECK",
      title: "检查未完成",
      kind: "validation-error",
      body: `
        <div class="modal-emblem error">!</div>
        <p>${escapeHtml(error.message || "未知错误")}</p>
        <p>工程时间线未被修改，播放头已停在当前帧。</p>
      `,
      actions: `<button class="btn btn-primary" data-modal-close>返回</button>`,
    });
  }
}

function setupTimelineEvents() {
  elements.timelineCanvas.addEventListener("pointerdown", handleTimelinePointerDown);
  elements.timelineCanvas.addEventListener("pointermove", handleTimelinePointerMove);
  elements.timelineCanvas.addEventListener("pointerup", handleTimelinePointerUp);
  elements.timelineCanvas.addEventListener("pointercancel", handleTimelinePointerUp);
  elements.timelineCanvas.addEventListener("pointerleave", () => {
    if (!state.drag) {
      state.timelineHover = null;
      drawTimeline();
    }
  });
  window.addEventListener("pointerup", () => {
    if (state.drag) handleTimelinePointerUp();
  });
  elements.shotList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-scene-id]");
    if (button) selectScene(button.dataset.sceneId);
  });
}

function setupKeyboardEvents() {
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.modalBackdrop.hidden) {
      closeModal();
      return;
    }
    const tag = event.target.tagName;
    const interactive =
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      event.target.isContentEditable;
    if (interactive) return;
    if (!elements.modalBackdrop.hidden) return;
    if (event.code === "Space") {
      event.preventDefault();
      togglePlayback();
      return;
    }
    if (event.key === "l" || event.key === "L") {
      event.preventDefault();
      state.loop = !state.loop;
      elements.loopBtn.classList.toggle("active", state.loop);
      elements.loopBtn.setAttribute("aria-pressed", String(state.loop));
      toast(state.loop ? "循环播放已开启" : "循环播放已关闭");
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      seekTo(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      pause();
      seekTo(computeLayout(state.project).total);
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      pause();
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      const step = event.shiftKey ? 1 : 1 / state.project.fps;
      seekTo(state.currentTime + direction * step);
    }
  });
}

function setupResizeHandling() {
  let scheduled = false;
  const refresh = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      drawPreview();
      renderTimelineBase();
      drawTimeline();
    });
  };
  const observer = new ResizeObserver(refresh);
  observer.observe(elements.previewFrame);
  observer.observe(elements.timelineScroll);
  window.addEventListener("resize", refresh);
}

function exposeAutomationApi() {
  window.__beatboard = {
    getProject: () => cloneProject(state.project),
    getState: () => ({
      playing: state.playing,
      currentTime: state.currentTime,
      total: computeLayout(state.project).total,
      selectedId: state.selectedId,
      loop: state.loop,
      validating: state.validating,
      exporting: state.exportInProgress,
      dirty: state.dirty,
    }),
    getSnapshot: () => {
      const layout = computeLayout(state.project);
      const active = getSceneAt(layout, state.currentTime);
      return {
        ...validationCapture(),
        playing: state.playing,
        layout: timelineSnapshot(state.project),
      };
    },
    getCanvasHash: () => hashCanvas(elements.previewCanvas),
    getAudioState: () => ({
      running: audioEngine.running,
      contextState: audioEngine.context?.state || "closed",
      anchorTimelineTime: audioEngine.anchorTimelineTime,
      scheduledNodes: audioEngine.activeNodes.length,
      bpm: state.project.audio.bpm,
      start: state.project.audio.start,
    }),
    play,
    pause,
    seek: (time) => seekTo(time),
    selectScene,
    loadProject: async (project, options = {}) => {
      pause();
      state.playToken += 1;
      audioEngine.stop();
      setProject(project, {
        selectedId: options.selectedId,
        time: options.time || 0,
        dirty: Boolean(options.dirty),
      });
      if (options.persist) persistDraft();
      await seekTo(options.time || 0);
      return true;
    },
    save: saveProject,
    reload: reloadSavedProject,
    setLoop: (loop) => {
      state.loop = Boolean(loop);
      elements.loopBtn.classList.toggle("active", state.loop);
      elements.loopBtn.setAttribute("aria-pressed", String(state.loop));
    },
    setForceExportFailure: (value) => {
      state.forceExportFailure = Boolean(value);
    },
    exportStoryboard: exportStoryboardSheet,
    exportMovie,
    exportCsv,
    exportJsonBackup,
    validateConsistency: runConsistencyCheck,
    validateTimeline: () => validateTimelineIntegrity(state.project),
    getSavedProject: () => {
      const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(DRAFT_KEY);
      return raw ? JSON.parse(raw) : null;
    },
  };
}

function init() {
  const stored = loadStoredProject();
  if (stored) {
    state.project = stored.project;
    state.restored = true;
  } else {
    state.project = createDefaultProject();
  }
  state.selectedId = state.project.scenes[0].id;
  state.currentTime = 0;

  setupTimelineEvents();
  setupInspectorEvents();
  setupTransportEvents();
  setupExportEvents();
  setupKeyboardEvents();
  setupResizeHandling();

  setProject(state.project, {
    selectedId: state.project.scenes[0].id,
    time: 0,
    savedAt: stored?.savedAt || null,
  });
  if (!stored) {
    elements.saveState.classList.remove("unsaved");
    elements.saveStateText.textContent = "自动保存已开启";
  }
  requestAnimationFrame(() => {
    renderTimelineBase();
    drawPreview();
    drawTimeline();
    drawPreview();
  });
  exposeAutomationApi();
  window.addEventListener("beforeunload", () => {
    persistDraft();
    audioEngine.stop();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.playing) pause();
  });
}

init();
