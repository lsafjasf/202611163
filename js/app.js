import {
  adjustmentsFingerprint,
  hueToHex,
  normalizeAdjustments,
} from "./color.js";
import {
  addStateToPng,
  canvasToPngBlob,
  createExportCanvas,
  createSvgMarkup,
  downloadBlob,
  safeFilename,
} from "./export.js";
import { createEmbeddedFontCss } from "./fonts.js";
import { createBaseImageCanvas, TEMPLATES } from "./generator.js";
import { HistoryStore } from "./history.js";
import {
  BUILTIN_PRESETS,
  CASES,
  FONT_OPTIONS,
  SAFE_MARGIN,
  SCENE_HEIGHT,
  SCENE_WIDTH,
  cloneState,
  createDefaultState,
  createId,
  normalizeState,
  snapshotProject,
} from "./model.js";
import {
  autoFitState,
  createAdjustedSource,
  fontString,
  getElementBounds,
  hitTest,
  renderArtwork,
  validateState,
} from "./render.js";
import {
  createWorkspacePayload,
  loadWorkspace,
  parseWorkspace,
  saveDraft,
  saveWorkspace,
} from "./storage.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const dom = {
  artCanvas: $("#artCanvas"),
  stageViewport: $("#stageViewport"),
  stageFrame: $("#stageFrame"),
  selectionBadge: $("#selectionBadge"),
  projectName: $("#projectName"),
  saveState: $("#saveState"),
  undoBtn: $("#undoBtn"),
  redoBtn: $("#redoBtn"),
  saveBtn: $("#saveBtn"),
  reloadBtn: $("#reloadBtn"),
  exportTopBtn: $("#exportTopBtn"),
  presetGrid: $("#presetGrid"),
  templateSelect: $("#templateSelect"),
  seedValue: $("#seedValue"),
  regenerateBtn: $("#regenerateBtn"),
  keyframeList: $("#keyframeList"),
  addKeyframeBtn: $("#addKeyframeBtn"),
  canvasSizeChip: $("#canvasSizeChip"),
  safeGuidesBtn: $("#safeGuidesBtn"),
  positionReadout: $("#positionReadout"),
  safeStatus: $("#safeStatus"),
  safeStatusText: $("#safeStatusText"),
  zoomOutBtn: $("#zoomOutBtn"),
  zoomInBtn: $("#zoomInBtn"),
  zoomFitBtn: $("#zoomFitBtn"),
  layerList: $("#layerList"),
  layerEditor: $("#layerEditor"),
  addTextBtn: $("#addTextBtn"),
  exportHealth: $("#exportHealth"),
  exportWidth: $("#exportWidth"),
  marginValue: $("#marginValue"),
  validationList: $("#validationList"),
  exportMainBtn: $("#exportMainBtn"),
  exportButtonLabel: $("#exportButtonLabel"),
  downloadProjectBtn: $("#downloadProjectBtn"),
  projectFileInput: $("#projectFileInput"),
  presetDialog: $("#presetDialog"),
  presetName: $("#presetName"),
  exportDialog: $("#exportDialog"),
  exportDialogTitle: $("#exportDialogTitle"),
  exportDialogDescription: $("#exportDialogDescription"),
  exportDialogEyebrow: $("#exportDialogEyebrow"),
  exportIssueList: $("#exportIssueList"),
  closeExportDialogBtn: $("#closeExportDialogBtn"),
  autoFixBtn: $("#autoFixBtn"),
  toastRegion: $("#toastRegion"),
};

const measureCanvas = document.createElement("canvas");
measureCanvas.width = 2;
measureCanvas.height = 2;
const measureCtx = measureCanvas.getContext("2d");

const savedWorkspace = loadWorkspace();
let customPresets = savedWorkspace?.customPresets || [];
let keyframes = savedWorkspace?.keyframes || [];
let dirty = false;
let activeCase = savedWorkspace ? "" : "default";
let adjustedCache = null;
let previewBaseCache = null;
let renderQueued = false;
let dirtyTimer = null;
let dragSession = null;
let currentTab = "adjust";
let editorSelectionId = null;
let layerLayoutSignature = "";
const fontRequests = new Map();

const initial = savedWorkspace?.state || createDefaultState();

const store = new HistoryStore(initial, onStateChange);

function adjustmentLabel(key, value) {
  if (key === "exposure") {
    const numeric = Number(value);
    return `${numeric >= 0 ? "+" : ""}${numeric.toFixed(2)} EV`;
  }
  if (key === "shadowHue" || key === "highlightHue") return `${Math.round(value)}°`;
  const numeric = Number(value);
  return `${numeric > 0 ? "+" : ""}${Math.round(numeric)}`;
}

function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast ${type === "error" ? "is-error" : type === "info" ? "is-info" : ""}`;
  toast.textContent = message;
  dom.toastRegion.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(5px)";
    setTimeout(() => toast.remove(), 180);
  }, type === "error" ? 5200 : 2900);
}

function markDirty(nextDirty = true) {
  dirty = nextDirty;
  dom.saveState.textContent = dirty ? "有未保存修改" : "已保存";
  dom.saveState.classList.toggle("is-saved", !dirty);
}

function scheduleDraft() {
  clearTimeout(dirtyTimer);
  dirtyTimer = setTimeout(() => {
    saveDraft(store.state, customPresets, keyframes);
  }, 900);
}

function onStateChange() {
  markDirty(true);
  scheduleDraft();
  scheduleRender();
}

function getPreviewSource(state) {
  const fingerprint = adjustmentsFingerprint(state.params);
  const cacheKey = `${state.template}|${state.seed}|${fingerprint}|${SCENE_WIDTH}x${SCENE_HEIGHT}`;
  if (adjustedCache?.key === cacheKey) return adjustedCache.canvas;
  if (previewBaseCache?.key !== `${state.template}|${state.seed}`) {
    previewBaseCache = {
      key: `${state.template}|${state.seed}`,
      canvas: createBaseImageCanvas(state.template, state.seed, SCENE_WIDTH, SCENE_HEIGHT),
    };
  }
  const canvas = createAdjustedSource(previewBaseCache.canvas, state.params);
  adjustedCache = { key: cacheKey, canvas };
  return canvas;
}

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

async function ensureCanvasFonts(state, waitForAll = false) {
  if (!document.fonts?.load) return;
  const requests = [];
  for (const element of state.elements) {
    if (element.type !== "text" || !element.visible) continue;
    const font = fontString(element);
    const text = String(element.text || "");
    const key = `${font}|${text}`;
    if (fontRequests.has(key)) {
      requests.push(fontRequests.get(key));
      continue;
    }
    const request = document.fonts
      .load(font, text)
      .catch(() => [])
      .then((faces) => {
        if (faces.length) scheduleRender();
        return faces;
      });
    fontRequests.set(key, request);
    requests.push(request);
  }
  if (waitForAll) await Promise.all(requests);
}

function render() {
  const state = store.state;
  ensureCanvasFonts(state);
  const adjusted = getPreviewSource(state);
  renderArtwork(dom.artCanvas, state, adjusted, {
    showGuides: state.view.showSafeGuides,
    showSelection: Boolean(state.selectedId),
    zoom: state.view.zoom,
  });
  syncAdjustmentUI(state);
  syncCanvasChrome(state);
  syncHistoryButtons();
  syncPresetSelection(state);
  syncLayerPanel(state);
  syncOutputPanel(state);
  syncKeyframes();
  syncTemplates(state);
}

function syncHistoryButtons() {
  dom.undoBtn.disabled = !store.canUndo;
  dom.redoBtn.disabled = !store.canRedo;
}

function syncCanvasChrome(state) {
  const selected = state.elements.find((element) => element.id === state.selectedId);
  dom.selectionBadge.hidden = !selected;
  if (selected) {
    dom.selectionBadge.textContent = `${selected.name} · 可编辑${selected.type === "text" ? "文字" : "图形"}`;
  }
  dom.stageFrame.style.setProperty("--stage-zoom", state.view.zoom);
  dom.zoomFitBtn.textContent = `${Math.round(state.view.zoom * 100)}%`;
  dom.safeGuidesBtn.classList.toggle("is-active", state.view.showSafeGuides);
  dom.safeGuidesBtn.setAttribute("aria-pressed", String(state.view.showSafeGuides));
  dom.projectName.value = state.projectName;
  dom.seedValue.textContent = String(state.seed);
  dom.canvasSizeChip.textContent = `导出 ${state.export.width} × ${state.export.height}`;
  if (selected) {
    dom.positionReadout.textContent = `X ${Math.round(selected.x)} · Y ${Math.round(selected.y)}`;
  } else {
    dom.positionReadout.textContent = "未选择图层";
  }
  const issues = validateState(state, measureCtx);
  dom.safeStatus.classList.toggle("is-ok", issues.length === 0);
  dom.safeStatus.classList.toggle("is-error", issues.length > 0);
  $(".status-icon", dom.safeStatus).textContent = issues.length ? "!" : "✓";
  dom.safeStatusText.textContent = issues.length
    ? `${issues.length} 项超出安全区域或导出限制`
    : "安全区域检查通过";
}

function syncAdjustmentUI(state) {
  const controls = {
    exposure: state.params.exposure,
    temperature: state.params.temperature,
    contrast: state.params.contrast,
    shadowHue: state.params.shadowHue,
    shadowStrength: state.params.shadowStrength,
    highlightHue: state.params.highlightHue,
    highlightStrength: state.params.highlightStrength,
  };
  for (const [key, value] of Object.entries(controls)) {
    const input = $(`#${key}`);
    if (input && document.activeElement !== input) input.value = value;
    const output = $(`#${key}Value`);
    if (output) output.textContent = adjustmentLabel(key, value);
  }
  $("#shadowSwatch").style.background = hueToHex(state.params.shadowHue);
  $("#highlightSwatch").style.background = hueToHex(state.params.highlightHue);
}

function syncTemplates(state) {
  dom.templateSelect.value = state.template;
  $$(".case-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.case === activeCase);
  });
}

function applyParam(key, value, record = false) {
  const state = cloneState(store.state);
  state.params = normalizeAdjustments({ ...state.params, [key]: Number(value) });
  store.update(state, { record });
}

function bindRange(id, key) {
  const input = $(`#${id}`);
  input.addEventListener("pointerdown", () => store.beginBatch());
  input.addEventListener("focus", () => store.beginBatch());
  input.addEventListener("input", () => applyParam(key, input.value, false));
  input.addEventListener("change", () => store.endBatch());
  input.addEventListener("blur", () => store.endBatch());
}

function setupAdjustmentControls() {
  [
    ["exposure", "exposure"],
    ["temperature", "temperature"],
    ["contrast", "contrast"],
    ["shadowHue", "shadowHue"],
    ["shadowStrength", "shadowStrength"],
    ["highlightHue", "highlightHue"],
    ["highlightStrength", "highlightStrength"],
  ].forEach(([id, key]) => bindRange(id, key));

  $("#resetAdjustBtn").addEventListener("click", () => {
    const state = cloneState(store.state);
    state.params = normalizeAdjustments({
      exposure: 0,
      temperature: 0,
      contrast: 0,
      shadowHue: 22,
      shadowStrength: 0,
      highlightHue: 42,
      highlightStrength: 0,
    });
    store.update(state);
    showToast("调色参数已回到中性值");
  });
}

function allPresets() {
  return [...BUILTIN_PRESETS, ...customPresets];
}

function renderPresetThumbnail(canvas, params) {
  const width = 140;
  const height = 175;
  canvas.width = width;
  canvas.height = height;
  const state = store.state;
  const base = createBaseImageCanvas(state.template, state.seed, width, height);
  const adjusted = createAdjustedSource(base, params);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(adjusted, 0, 0);
}

function renderPresetGrid() {
  dom.presetGrid.replaceChildren();
  for (const preset of allPresets()) {
    const card = document.createElement("button");
    card.className = "preset-card";
    card.dataset.presetId = preset.id;
    card.title = preset.builtin ? `${preset.name}（内置预设）` : `${preset.name}（自定义预设）`;

    const thumbWrap = document.createElement("span");
    thumbWrap.className = "preset-thumb-wrap";
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    thumbWrap.appendChild(canvas);
    card.appendChild(thumbWrap);

    const name = document.createElement("span");
    name.className = "preset-card-name";
    name.textContent = preset.name;
    card.appendChild(name);

    if (!preset.builtin) {
      const remove = document.createElement("span");
      remove.className = "preset-delete";
      remove.setAttribute("role", "button");
      remove.setAttribute("aria-label", `删除预设 ${preset.name}`);
      remove.textContent = "×";
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        customPresets = customPresets.filter((item) => item.id !== preset.id);
        renderPresetGrid();
        showToast(`已删除预设「${preset.name}」`);
      });
      card.appendChild(remove);
    }

    card.addEventListener("click", () => {
      const state = cloneState(store.state);
      state.params = normalizeAdjustments(preset.params);
      store.update(state);
      showToast(`已应用预设「${preset.name}」`);
    });
    dom.presetGrid.appendChild(card);
    renderPresetThumbnail(canvas, preset.params);
  }
  syncPresetSelection(store.state);
}

function syncPresetSelection(state) {
  const current = adjustmentsFingerprint(state.params);
  $$(".preset-card", dom.presetGrid).forEach((card) => {
    const preset = allPresets().find((item) => item.id === card.dataset.presetId);
    card.classList.toggle(
      "is-active",
      Boolean(preset) && adjustmentsFingerprint(preset.params) === current,
    );
  });
}

function setupPresetActions() {
  $("#newPresetBtn").addEventListener("click", () => {
    dom.presetName.value = "";
    dom.presetDialog.showModal();
    requestAnimationFrame(() => dom.presetName.focus());
  });
  dom.presetDialog.addEventListener("close", () => {
    if (dom.presetDialog.returnValue !== "default") return;
    const name = dom.presetName.value.trim();
    dom.presetDialog.returnValue = "";
    if (!name) return;
    customPresets.push({
      id: createId("preset"),
      name: name.slice(0, 24),
      builtin: false,
      params: cloneState(store.state.params),
      createdAt: new Date().toISOString(),
    });
    renderPresetGrid();
    showToast(`预设「${name}」已保存`);
  });
}

function setupTemplateActions() {
  dom.templateSelect.addEventListener("change", () => {
    const state = cloneState(store.state);
    const oldName = TEMPLATES[state.template]?.name;
    state.template = dom.templateSelect.value;
    if (state.projectName === oldName) {
      state.projectName = TEMPLATES[state.template]?.name || state.projectName;
    }
    store.update(state);
    renderPresetGrid();
    showToast(`已切换模板「${TEMPLATES[state.template]?.name}」`);
  });

  dom.regenerateBtn.addEventListener("click", () => {
    const state = cloneState(store.state);
    const random = new Uint32Array(1);
    crypto.getRandomValues(random);
    state.seed = random[0];
    store.update(state);
    renderPresetGrid();
    showToast("已生成新的画面，当前种子已写入项目");
  });
}

function syncKeyframes() {
  dom.keyframeList.replaceChildren();
  if (!keyframes.length) {
    const empty = document.createElement("div");
    empty.className = "keyframe-empty";
    empty.textContent = "还没有关键帧。保存后可在任意时间恢复模板、图像、调色和所有图层。";
    dom.keyframeList.appendChild(empty);
    return;
  }
  keyframes.forEach((frame, index) => {
    const item = document.createElement("div");
    item.className = "keyframe-item";
    const swatch = document.createElement("span");
    swatch.className = "keyframe-swatch";
    swatch.style.background = hueToHex(frame.state.params.highlightHue);
    item.appendChild(swatch);

    const meta = document.createElement("div");
    meta.className = "keyframe-meta";
    const name = document.createElement("span");
    name.className = "keyframe-name";
    name.textContent = frame.name;
    const time = document.createElement("span");
    time.className = "keyframe-time";
    time.textContent = new Date(frame.createdAt).toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    });
    meta.append(name, time);
    item.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "keyframe-actions";
    const restore = document.createElement("button");
    restore.title = "恢复此关键帧";
    restore.textContent = "↺";
    restore.addEventListener("click", () => {
      store.replace(normalizeState(cloneState(frame.state)), { record: true });
      activeCase = "";
      showToast(`已恢复关键帧「${frame.name}」`);
    });
    const remove = document.createElement("button");
    remove.title = "删除关键帧";
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      keyframes.splice(index, 1);
      syncKeyframes();
      scheduleDraft();
    });
    actions.append(restore, remove);
    item.appendChild(actions);
    dom.keyframeList.appendChild(item);
  });
}

function setupKeyframeActions() {
  dom.addKeyframeBtn.addEventListener("click", () => {
    const nextNumber = keyframes.length + 1;
    keyframes.push({
      id: createId("frame"),
      name: `关键帧 ${nextNumber}`,
      createdAt: new Date().toISOString(),
      state: snapshotProject(store.state),
    });
    syncKeyframes();
    scheduleDraft();
    showToast(`关键帧 ${nextNumber} 已保存，可随时恢复完整状态`);
  });
}

function setupHistoryActions() {
  dom.undoBtn.addEventListener("click", () => {
    if (store.undo()) showToast("已撤销上一步");
  });
  dom.redoBtn.addEventListener("click", () => {
    if (store.redo()) showToast("已重做");
  });
  window.addEventListener("keydown", (event) => {
    if (!(event.metaKey || event.ctrlKey)) return;
    const key = event.key.toLowerCase();
    if (key === "z") {
      event.preventDefault();
      if (event.shiftKey) store.redo();
      else store.undo();
    } else if (key === "y") {
      event.preventDefault();
      store.redo();
    } else if (key === "s") {
      event.preventDefault();
      persistWorkspace();
    }
  });
}

function persistWorkspace() {
  try {
    const state = cloneState(store.state);
    state.updatedAt = new Date().toISOString();
    store.update(state, { record: false });
    saveWorkspace(store.state, customPresets, keyframes);
    markDirty(false);
    const time = new Date().toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    });
    dom.saveState.textContent = `已保存 ${time}`;
    dom.saveState.classList.add("is-saved");
    showToast("项目、预设与关键帧已保存到浏览器");
  } catch (error) {
    showToast(error.message, "error");
  }
}

function setupProjectActions() {
  dom.projectName.addEventListener("focus", () => store.beginBatch());
  dom.projectName.addEventListener("input", () => {
    const state = cloneState(store.state);
    state.projectName = dom.projectName.value.slice(0, 80);
    store.update(state, { record: false });
  });
  dom.projectName.addEventListener("blur", () => {
    const state = cloneState(store.state);
    state.projectName = dom.projectName.value.trim() || "未命名项目";
    store.update(state, { record: false });
    store.endBatch();
  });

  dom.saveBtn.addEventListener("click", persistWorkspace);
  dom.reloadBtn.addEventListener("click", () => {
    if (dirty && !window.confirm("重新载入会丢弃尚未保存的修改，继续吗？")) return;
    const workspace = loadWorkspace();
    if (!workspace) {
      showToast("还没有已保存的项目，请先点击保存", "error");
      return;
    }
    customPresets = workspace.customPresets;
    keyframes = workspace.keyframes;
    store.replace(workspace.state, { record: true });
    activeCase = "";
    adjustedCache = null;
    previewBaseCache = null;
    renderPresetGrid();
    markDirty(false);
    showToast("已重新载入上次保存的项目");
  });

  dom.downloadProjectBtn.addEventListener("click", () => {
    const payload = createWorkspacePayload(store.state, customPresets, keyframes);
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    downloadBlob(blob, safeFilename(store.state.projectName, "json"));
    showToast("项目 JSON 已下载，包含模板、图像种子、字体、图层和关键帧");
  });

  dom.projectFileInput.addEventListener("change", async () => {
    const file = dom.projectFileInput.files?.[0];
    if (!file) return;
    try {
      const parsed = parseWorkspace(JSON.parse(await file.text()));
      if (!parsed) throw new Error("项目文件格式不可识别。");
      customPresets = parsed.customPresets;
      keyframes = parsed.keyframes;
      store.replace(parsed.state, { record: true });
      activeCase = "";
      adjustedCache = null;
      previewBaseCache = null;
      renderPresetGrid();
      showToast(`已载入「${file.name}」`);
    } catch (error) {
      showToast(`载入失败：${error.message}`, "error");
    } finally {
      dom.projectFileInput.value = "";
    }
  });
}

function setupCases() {
  $$(".case-button").forEach((button) => {
    button.addEventListener("click", () => {
      const caseId = button.dataset.case;
      const caseDef = CASES[caseId];
      if (!caseDef) return;
      activeCase = caseId;
      adjustedCache = null;
      previewBaseCache = null;
      store.replace(caseDef.create(), { record: true });
      renderPresetGrid();
      if (caseId === "boundary") {
        showToast("边界案例：长文本与 48px 导出会触发检查。导出面板中可查看修复建议。", "info");
      } else {
        showToast("已载入默认案例");
      }
    });
  });
}

function selectedElement(state = store.state) {
  return state.elements.find((element) => element.id === state.selectedId) || null;
}

function updateSelected(mutator, record = false) {
  const state = cloneState(store.state);
  const element = state.elements.find((item) => item.id === state.selectedId);
  if (!element) return;
  mutator(element, state);
  store.update(state, { record });
}

function selectElement(id) {
  if (!id || store.state.selectedId === id) return;
  const state = cloneState(store.state);
  state.selectedId = id;
  store.update(state, { record: false });
}

function createLayerField(labelText, input) {
  const wrap = document.createElement("div");
  wrap.className = "compact-field";
  const label = document.createElement("label");
  label.textContent = labelText;
  if (input.id) label.htmlFor = input.id;
  wrap.append(label, input);
  return wrap;
}

function makeNumberInput(field, value, step = 1, min = -9999) {
  const input = document.createElement("input");
  input.type = "number";
  input.dataset.field = field;
  input.value = value;
  input.step = step;
  input.min = min;
  input.addEventListener("focus", () => store.beginBatch());
  input.addEventListener("input", () => {
    const numeric = Number(input.value);
    if (!Number.isFinite(numeric)) return;
    updateSelected((element) => {
      element[field] = Math.max(min, numeric);
      if ((field === "fontSize" || field === "width") && element[field] < 1) element[field] = 1;
    });
  });
  input.addEventListener("blur", () => store.endBatch());
  input.addEventListener("change", () => store.endBatch());
  return input;
}

function makeTextInput(field, value) {
  const input = document.createElement("input");
  input.className = "layer-input";
  input.dataset.field = field;
  input.value = value;
  input.addEventListener("focus", () => store.beginBatch());
  input.addEventListener("input", () => updateSelected((element) => (element[field] = input.value)));
  input.addEventListener("blur", () => store.endBatch());
  input.addEventListener("change", () => store.endBatch());
  return input;
}

function makeSelect(field, value, options) {
  const select = document.createElement("select");
  select.dataset.field = field;
  for (const option of options) {
    const node = document.createElement("option");
    node.value = option.value;
    node.textContent = option.label;
    select.appendChild(node);
  }
  select.value = value;
  select.addEventListener("change", () => {
    updateSelected((element) => (element[field] = select.value), true);
  });
  return select;
}

function makeColorField(field, value) {
  const wrap = document.createElement("div");
  wrap.className = "color-field";
  const picker = document.createElement("input");
  picker.type = "color";
  picker.dataset.field = field;
  picker.dataset.picker = "true";
  picker.value = /^#[0-9a-f]{6}$/i.test(value) ? value : "#f4eadb";
  picker.addEventListener("focus", () => store.beginBatch());
  picker.addEventListener("input", () =>
    updateSelected((element) => {
      element[field] = picker.value;
      const text = wrap.querySelector(".layer-input");
      if (text) text.value = picker.value;
    }),
  );
  picker.addEventListener("change", () => store.endBatch());
  picker.addEventListener("blur", () => store.endBatch());
  const text = makeTextInput(field, value);
  text.addEventListener("input", () => {
    if (/^#[0-9a-f]{6}$/i.test(text.value)) picker.value = text.value;
  });
  wrap.append(picker, text);
  return wrap;
}

function addEditorSection(title, content) {
  const section = document.createElement("section");
  section.className = "editor-section";
  const heading = document.createElement("span");
  heading.className = "editor-section-title";
  heading.textContent = title;
  section.append(heading, content);
  return section;
}

function renderLayerEditor(state) {
  dom.layerEditor.replaceChildren();
  const element = selectedElement(state);
  editorSelectionId = element?.id || null;
  if (!element) {
    const empty = document.createElement("div");
    empty.className = "empty-editor";
    empty.textContent = "点击画布中的文字或图形开始编辑。";
    dom.layerEditor.appendChild(empty);
    return;
  }

  const head = document.createElement("div");
  head.className = "layer-editor-head";
  const title = document.createElement("strong");
  title.textContent = element.name;
  const orders = document.createElement("div");
  orders.className = "layer-order-actions";
  const up = document.createElement("button");
  up.title = "上移一层";
  up.innerHTML = '<svg viewBox="0 0 24 24"><path d="m7 14 5-5 5 5"/></svg>';
  up.addEventListener("click", () => {
    const next = cloneState(store.state);
    const index = next.elements.findIndex((item) => item.id === next.selectedId);
    if (index >= 0 && index < next.elements.length - 1) {
      [next.elements[index], next.elements[index + 1]] = [next.elements[index + 1], next.elements[index]];
      store.update(next);
      showToast("图层已上移，安全区域已重新检查");
    }
  });
  const down = document.createElement("button");
  down.title = "下移一层";
  down.innerHTML = '<svg viewBox="0 0 24 24"><path d="m7 10 5 5 5-5"/></svg>';
  down.addEventListener("click", () => {
    const next = cloneState(store.state);
    const index = next.elements.findIndex((item) => item.id === next.selectedId);
    if (index > 0) {
      [next.elements[index], next.elements[index - 1]] = [next.elements[index - 1], next.elements[index]];
      store.update(next);
      showToast("图层已下移，安全区域已重新检查");
    }
  });
  const remove = document.createElement("button");
  remove.className = "danger-icon";
  remove.title = "删除图层";
  remove.disabled = state.elements.length <= 1;
  remove.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v5m4-5v5"/></svg>';
  remove.addEventListener("click", () => {
    if (state.elements.length <= 1) return;
    const next = cloneState(store.state);
    next.elements = next.elements.filter((item) => item.id !== next.selectedId);
    next.selectedId = next.elements.at(-1)?.id || null;
    store.update(next);
    showToast("图层已删除，可用撤销恢复");
  });
  orders.append(up, down, remove);
  head.append(title, orders);
  dom.layerEditor.appendChild(head);

  if (element.type === "text") {
    const textarea = document.createElement("textarea");
    textarea.className = "layer-textarea";
    textarea.dataset.field = "text";
    textarea.value = element.text;
    textarea.addEventListener("focus", () => store.beginBatch());
    textarea.addEventListener("input", () => updateSelected((item) => (item.text = textarea.value)));
    textarea.addEventListener("blur", () => store.endBatch());
    dom.layerEditor.appendChild(addEditorSection("文字内容", textarea));

    const fontSelect = makeSelect(
      "fontId",
      element.fontId,
      FONT_OPTIONS.map((font) => ({ value: font.id, label: font.name })),
    );
    const typography = document.createElement("div");
    typography.className = "field-grid";
    typography.appendChild(createLayerField("字号", makeNumberInput("fontSize", element.fontSize, 1, 1)));
    typography.appendChild(
      createLayerField(
        "字重",
        makeSelect("fontWeight", String(element.fontWeight), [
          { value: "400", label: "常规" },
          { value: "500", label: "中等" },
          { value: "600", label: "半粗" },
          { value: "700", label: "粗体" },
        ]),
      ),
    );
    typography.appendChild(
      createLayerField("行高", makeNumberInput("lineHeight", element.lineHeight, 0.05, 0.6)),
    );
    typography.appendChild(
      createLayerField(
        "字距",
        makeNumberInput("letterSpacing", element.letterSpacing, 0.5, -20),
      ),
    );
    const fontWrap = document.createElement("div");
    fontWrap.className = "compact-field";
    const fontLabel = document.createElement("label");
    fontLabel.textContent = "字体";
    fontWrap.append(fontLabel, fontSelect);
    const typeContent = document.createElement("div");
    typeContent.append(fontWrap, typography);
    dom.layerEditor.appendChild(addEditorSection("字体与排版", typeContent));

    const alignWrap = document.createElement("div");
    alignWrap.className = "alignment-row";
    for (const [value, label] of [
      ["left", "左对齐"],
      ["center", "居中"],
      ["right", "右对齐"],
    ]) {
      const button = document.createElement("button");
      button.textContent = label;
      button.dataset.align = value;
      button.classList.toggle("is-active", element.textAlign === value);
      button.addEventListener("click", () =>
        updateSelected((item) => (item.textAlign = value), true),
      );
      alignWrap.appendChild(button);
    }
    dom.layerEditor.appendChild(addEditorSection("对齐", alignWrap));
  }

  const transform = document.createElement("div");
  transform.className = "field-grid";
  transform.appendChild(createLayerField("X", makeNumberInput("x", Math.round(element.x))));
  transform.appendChild(createLayerField("Y", makeNumberInput("y", Math.round(element.y))));
  transform.appendChild(
    createLayerField("宽度", makeNumberInput("width", Math.round(element.width), 1, 1)),
  );
  if (element.type === "shape" && element.shape !== "line") {
    transform.appendChild(
      createLayerField("高度", makeNumberInput("height", Math.round(element.height), 1, 1)),
    );
  }
  dom.layerEditor.appendChild(addEditorSection("位置与尺寸", transform));

  if (element.type === "text") {
    const colorContent = document.createElement("div");
    colorContent.appendChild(makeColorField("color", element.color));
    dom.layerEditor.appendChild(addEditorSection("文字颜色", colorContent));
  } else {
    const shapeFields = document.createElement("div");
    shapeFields.className = "field-grid";
    shapeFields.appendChild(
      createLayerField(
        "图形",
        makeSelect("shape", element.shape, [
          { value: "rect", label: "矩形" },
          { value: "line", label: "直线" },
          { value: "circle", label: "圆形" },
        ]),
      ),
    );
    shapeFields.appendChild(
      createLayerField(
        "描边宽度",
        makeNumberInput("strokeWidth", element.strokeWidth, 0.5, 0),
      ),
    );
    dom.layerEditor.appendChild(addEditorSection("图形", shapeFields));
    const colors = document.createElement("div");
    colors.className = "field-grid";
    colors.appendChild(createLayerField("填充", makeColorField("fill", element.fill)));
    colors.appendChild(createLayerField("描边", makeColorField("stroke", element.stroke)));
    dom.layerEditor.appendChild(addEditorSection("颜色", colors));
  }
}

function buildLayerList(state) {
  dom.layerList.replaceChildren();
  [...state.elements].reverse().forEach((element) => {
    const button = document.createElement("button");
    button.className = "layer-item";
    button.dataset.layerId = element.id;
    button.classList.toggle("is-active", element.id === state.selectedId);
    const icon = document.createElement("span");
    icon.className = "layer-icon";
    icon.textContent = element.type === "text" ? "T" : element.shape === "circle" ? "○" : element.shape === "line" ? "—" : "□";
    const name = document.createElement("span");
    name.className = "layer-name";
    name.textContent = element.name;
    const kind = document.createElement("span");
    kind.className = "layer-kind";
    kind.textContent = element.type === "text" ? "TEXT" : "SHAPE";
    button.append(icon, name, kind);
    button.addEventListener("click", () => selectElement(element.id));
    dom.layerList.appendChild(button);
  });
}

function syncLayerPanel(state) {
  const selected = selectedElement(state);
  const signature =
    `${state.selectedId}|${selected?.type || ""}|${selected?.shape || ""}|` +
    state.elements.map((element) => element.id).join(",");
  if (signature !== layerLayoutSignature || state.selectedId !== editorSelectionId) {
    layerLayoutSignature = signature;
    buildLayerList(state);
    renderLayerEditor(state);
  } else {
    $$(".layer-item", dom.layerList).forEach((item) => {
      item.classList.toggle("is-active", item.dataset.layerId === state.selectedId);
    });
    const element = selectedElement(state);
    if (!element) return;
    $$(".alignment-row button", dom.layerEditor).forEach((button) => {
      button.classList.toggle("is-active", button.dataset.align === element.textAlign);
    });
    for (const field of ["x", "y", "width", "height"]) {
      const input = $(`[data-field="${field}"]`, dom.layerEditor);
      if (input && document.activeElement !== input) input.value = Math.round(element[field] ?? 0);
    }
  }
}

function setupLayerActions() {
  dom.addTextBtn.addEventListener("click", () => {
    const state = cloneState(store.state);
    const source = state.elements.find((element) => element.type === "text") || {};
    const id = createId("text");
    state.elements.push({
      id,
      type: "text",
      name: "新文字",
      text: "双击编辑文字",
      x: 140,
      y: 140,
      width: 560,
      fontSize: 42,
      lineHeight: 1.3,
      letterSpacing: 1,
      fontId: source.fontId || "serif-cn",
      fontWeight: 400,
      color: "#f4eadb",
      textAlign: "left",
      opacity: 1,
      visible: true,
    });
    state.selectedId = id;
    store.update(state);
    switchTab("layers");
    showToast("已添加文字图层，可直接在属性面板编辑");
  });
}

function setupInspectorTabs() {
  $$(".inspector-tab").forEach((tab) => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  });
}

function switchTab(name) {
  currentTab = name;
  $$(".inspector-tab").forEach((tab) => {
    const active = tab.dataset.tab === name;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  $$(".tab-panel").forEach((panel) =>
    panel.classList.toggle("is-active", panel.id === `${name}Panel`),
  );
}

function pointerToScene(event) {
  const rect = dom.artCanvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * SCENE_WIDTH,
    y: ((event.clientY - rect.top) / rect.height) * SCENE_HEIGHT,
    scale: rect.width / SCENE_WIDTH,
  };
}

function setupCanvasInteractions() {
  dom.artCanvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const point = pointerToScene(event);
    const hit = hitTest(store.state, measureCtx, point.x, point.y, 1 / point.scale);
    if (!hit) {
      const state = cloneState(store.state);
      state.selectedId = null;
      store.update(state, { record: false });
      return;
    }
    selectElement(hit.id);
    store.beginBatch();
    dragSession = {
      pointerId: event.pointerId,
      id: hit.id,
      startX: event.clientX,
      startY: event.clientY,
      originalX: hit.x,
      originalY: hit.y,
      scale: point.scale,
      moved: false,
    };
    dom.artCanvas.setPointerCapture(event.pointerId);
    dom.artCanvas.classList.add("is-dragging");
  });

  dom.artCanvas.addEventListener("pointermove", (event) => {
    if (!dragSession || event.pointerId !== dragSession.pointerId) return;
    const dx = (event.clientX - dragSession.startX) / dragSession.scale;
    const dy = (event.clientY - dragSession.startY) / dragSession.scale;
    if (Math.abs(dx) + Math.abs(dy) > 1) dragSession.moved = true;
    updateSelected((element) => {
      element.x = Math.round(dragSession.originalX + dx);
      element.y = Math.round(dragSession.originalY + dy);
    });
  });

  const finishDrag = (event) => {
    if (!dragSession || (event.pointerId !== undefined && event.pointerId !== dragSession.pointerId)) {
      return;
    }
    const moved = dragSession.moved;
    dragSession = null;
    dom.artCanvas.classList.remove("is-dragging");
    store.endBatch();
    if (moved) showToast("元素已移动，安全区域已重新检查");
  };
  dom.artCanvas.addEventListener("pointerup", finishDrag);
  dom.artCanvas.addEventListener("pointercancel", finishDrag);

  dom.artCanvas.addEventListener("dblclick", (event) => {
    const point = pointerToScene(event);
    const hit = hitTest(store.state, measureCtx, point.x, point.y, 1 / point.scale);
    if (!hit || hit.type !== "text") return;
    selectElement(hit.id);
    switchTab("layers");
    requestAnimationFrame(() => {
      const textarea = $('.layer-textarea', dom.layerEditor);
      textarea?.focus();
      textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
    });
  });
}

function setZoom(nextZoom) {
  const state = cloneState(store.state);
  state.view.zoom = Math.max(0.6, Math.min(1.5, Math.round(nextZoom * 10) / 10));
  store.update(state, { record: false });
  showToast(`预览缩放 ${Math.round(state.view.zoom * 100)}%，安全区域已复查`);
}

function setupZoom() {
  dom.zoomOutBtn.addEventListener("click", () => setZoom(store.state.view.zoom - 0.1));
  dom.zoomInBtn.addEventListener("click", () => setZoom(store.state.view.zoom + 0.1));
  dom.zoomFitBtn.addEventListener("click", () => setZoom(1));
  dom.safeGuidesBtn.addEventListener("click", () => {
    const state = cloneState(store.state);
    state.view.showSafeGuides = !state.view.showSafeGuides;
    store.update(state, { record: false });
  });
  dom.stageViewport.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom(store.state.view.zoom + (event.deltaY > 0 ? -0.1 : 0.1));
    },
    { passive: false },
  );
}

function syncOutputPanel(state) {
  const issues = validateState(state, measureCtx);
  const isSvg = state.export.format === "svg";
  $$(".segment-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.format === state.export.format);
  });
  if (document.activeElement !== dom.exportWidth) dom.exportWidth.value = state.export.width;
  dom.marginValue.textContent = `${state.export.safeMargin || SAFE_MARGIN} px`;
  $("#vectorStat").textContent = isSvg ? "文字 / 图形矢量" : "可编辑项目已保存";
  dom.exportButtonLabel.textContent = `导出 ${isSvg ? "SVG" : "PNG"}`;
  dom.exportHealth.textContent = issues.length ? `${issues.length} 项待修复` : "可导出";
  dom.exportHealth.classList.toggle("is-ok", issues.length === 0);
  dom.exportHealth.classList.toggle("is-error", issues.length > 0);
  dom.validationList.replaceChildren();
  if (!issues.length) {
    const ok = document.createElement("div");
    ok.className = "validation-ok";
    ok.textContent = "安全边距、画布边界与文字裁切检查均通过。导出会从同一像素管线重新渲染。";
    dom.validationList.appendChild(ok);
  } else {
    issues.slice(0, 4).forEach((issue) => {
      const item = document.createElement("div");
      item.className = "validation-item";
      const title = document.createElement("strong");
      title.textContent = issue.title;
      item.append(title, document.createTextNode(issue.fix));
      dom.validationList.appendChild(item);
    });
  }
}

function setupOutputControls() {
  $$(".segment-button").forEach((button) => {
    button.addEventListener("click", () => {
      const state = cloneState(store.state);
      state.export.format = button.dataset.format;
      store.update(state);
    });
  });
  dom.exportWidth.addEventListener("focus", () => store.beginBatch());
  dom.exportWidth.addEventListener("input", () => {
    const width = Number(dom.exportWidth.value);
    if (!Number.isFinite(width) || width < 1) return;
    const state = cloneState(store.state);
    state.export.width = Math.round(width);
    state.export.height = Math.round(width * 1.25);
    store.update(state, { record: false });
  });
  dom.exportWidth.addEventListener("change", () => store.endBatch());
  dom.exportWidth.addEventListener("blur", () => store.endBatch());

  dom.exportTopBtn.addEventListener("click", () => {
    switchTab("output");
    attemptExport();
  });
  dom.exportMainBtn.addEventListener("click", () => attemptExport());
  dom.closeExportDialogBtn.addEventListener("click", () => dom.exportDialog.close());
  dom.autoFixBtn.addEventListener("click", () => {
    const fixed = autoFitState(store.state);
    store.replace(fixed, { record: true });
    dom.exportDialog.close();
    switchTab("output");
    showToast("已自动适配安全区与可读导出尺寸，请确认后再次导出");
  });
}

function showExportIssues(issues) {
  dom.autoFixBtn.hidden = false;
  dom.exportDialogEyebrow.textContent = "EXPORT CHECK";
  dom.exportDialogTitle.textContent = "发现需要修复的问题";
  dom.exportDialogDescription.textContent =
    "为避免文字被裁切或安全边距失效，本次没有生成文件。完整内容仍保留在画布中，可按建议修复。";
  dom.exportIssueList.replaceChildren();
  issues.forEach((issue) => {
    const item = document.createElement("div");
    item.className = "export-issue";
    const title = document.createElement("strong");
    title.textContent = issue.title;
    const detail = document.createElement("span");
    detail.textContent = `${issue.message} ${issue.fix}`;
    item.append(title, detail);
    dom.exportIssueList.appendChild(item);
  });
  dom.exportDialog.showModal();
}

function showExportFailure(error, state) {
  dom.autoFixBtn.hidden = true;
  dom.exportDialogEyebrow.textContent = "EXPORT FAILED";
  dom.exportDialogTitle.textContent = "导出未完成，项目内容没有丢失";
  dom.exportDialogDescription.textContent =
    "当前参数和所有可编辑图层仍保留在画布中。请按下面的建议处理后重试。";
  dom.exportIssueList.replaceChildren();
  const item = document.createElement("div");
  item.className = "export-issue";
  const title = document.createElement("strong");
  const detail = document.createElement("span");
  if (state.export.format === "svg") {
    title.textContent = "SVG 字体嵌入失败";
    detail.textContent = `${error.message} 请检查网络后重试，或切换到 PNG（PNG 不需要网络即可导出）。`;
  } else {
    title.textContent = "画布编码失败";
    detail.textContent = `${error.message} 请降低导出宽度、关闭占用内存较高的页面后重试。`;
  }
  item.append(title, detail);
  dom.exportIssueList.appendChild(item);
  dom.exportDialog.showModal();
}

async function renderExportSource(state) {
  if (state.export.width === SCENE_WIDTH && state.export.height === SCENE_HEIGHT) {
    return getPreviewSource(state);
  }
  const base = createBaseImageCanvas(
    state.template,
    state.seed,
    state.export.width,
    state.export.height,
  );
  return createAdjustedSource(base, state.params);
}

async function performExport() {
  const state = cloneState(store.state);
  let adjusted;
  if (state.export.format === "svg") {
    adjusted = getPreviewSource(state);
  } else {
    adjusted = await renderExportSource(state);
  }
  const exportState = snapshotProject(state);
  exportState.export = cloneState(state.export);
  exportState.exportedAt = new Date().toISOString();
  const filename = safeFilename(state.projectName, state.export.format);

  if (state.export.format === "svg") {
    const fontCss = await createEmbeddedFontCss(exportState);
    const markup = createSvgMarkup(exportState, adjusted, measureCtx, fontCss);
    const blob = new Blob([markup], { type: "image/svg+xml;charset=utf-8" });
    downloadBlob(blob, filename);
  } else {
    const canvas = createExportCanvas(state, adjusted);
    renderArtwork(canvas, state, adjusted, { showGuides: false, showSelection: false });
    const rawBlob = await canvasToPngBlob(canvas);
    const blob = await addStateToPng(rawBlob, exportState);
    downloadBlob(blob, filename);
  }
  showToast(
    `${state.export.format.toUpperCase()} 已导出 · ${state.export.width} × ${state.export.height} · 参数已写入文件`,
  );
}

async function attemptExport(autoRetry = false) {
  await ensureCanvasFonts(store.state, true);
  const issues = validateState(store.state, measureCtx);
  if (issues.length) {
    showExportIssues(issues);
    return;
  }
  if (document.fonts?.ready) await document.fonts.ready;
  const label = dom.exportButtonLabel.textContent;
  try {
    dom.exportMainBtn.classList.add("is-busy");
    dom.exportButtonLabel.textContent = "正在渲染…";
    await performExport();
  } catch (error) {
    showToast(`导出失败：${error.message}`, "error");
    showExportFailure(error, store.state);
  } finally {
    dom.exportMainBtn.classList.remove("is-busy");
    dom.exportButtonLabel.textContent = label;
  }
}

function bindGenericSetup() {
  setupAdjustmentControls();
  setupPresetActions();
  setupTemplateActions();
  setupKeyframeActions();
  setupHistoryActions();
  setupProjectActions();
  setupCases();
  setupLayerActions();
  setupInspectorTabs();
  setupCanvasInteractions();
  setupZoom();
  setupOutputControls();
  dom.canvasSizeChip.addEventListener("click", () => switchTab("output"));
  dom.safeStatus.addEventListener("click", () => switchTab("output"));
  dom.safeStatus.style.cursor = "pointer";
}

function initialize() {
  bindGenericSetup();
  renderPresetGrid();
  syncKeyframes();
  markDirty(!savedWorkspace || JSON.stringify(savedWorkspace.state) !== JSON.stringify(initial));
  if (savedWorkspace) {
    dom.saveState.textContent = "已载入保存项目";
    dom.saveState.classList.add("is-saved");
  }
  render();
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => scheduleRender());
  }
}

initialize();
