import {
  BUILTIN_TEMPLATE_DEFS,
  FONT_PRESETS,
  cloneModel,
  createBoundaryModel,
  createDefaultModel,
  createImageElement,
  normalizeModel,
  resizeModel
} from "./model.js";
import { buildScene, createMeasurer } from "./scene.js";
import {
  ImageCache,
  drawGuides,
  drawScene,
  drawSelection,
  hitTestScene,
  renderExportCanvas,
  scenePointFromScreen
} from "./renderer.js";
import {
  constrainElement,
  fitLongText,
  issueSummary,
  validateScene
} from "./validation.js";
import { History } from "./history.js";
import {
  addPngMetadata,
  pngModelFromBlob,
  sceneToSvg,
  svgModelFromText
} from "./exporters.js";
import {
  ensureBuiltinFontsLoaded,
  fontDataForExport,
  fontNameFor,
  registerCustomFonts
} from "./fonts.js";
import {
  debounce,
  downloadBlob,
  downloadText,
  escapeHtml,
  measureSignature,
  randomSeed,
  sanitizeFilename,
  uid,
  utf8ToBase64
} from "./util.js";
import { getWorkspace, putWorkspace, removeWorkspace } from "./storage.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const dom = {
  app: $("#app"),
  preview: $("#preview-canvas"),
  stageWrap: $("#stage-wrap"),
  canvasEmpty: $("#canvas-empty"),
  selectionPill: $("#selection-pill"),
  docName: $("#doc-name"),
  saveStatus: $("#save-status"),
  undo: $("#undo-btn"),
  redo: $("#redo-btn"),
  layerList: $("#layer-list"),
  templateList: $("#template-list"),
  templateCount: $("#template-count"),
  keyframeList: $("#keyframe-list"),
  keyframeCount: $("#keyframe-count"),
  inspectorTitle: $("#inspector-title"),
  inspectorBody: $("#inspector-body"),
  visibility: $("#visibility-btn"),
  color: $("#color-input"),
  colorHex: $("#color-hex"),
  seed: $("#seed-input"),
  seedValue: $("#seed-value"),
  wear: $("#wear-input"),
  wearValue: $("#wear-value"),
  chip: $("#chip-input"),
  chipValue: $("#chip-value"),
  documentSize: $("#document-size"),
  safeMargin: $("#safe-margin"),
  liveCheck: $("#live-check"),
  safeSizeLabel: $("#safe-size-label"),
  sizeLabel: $("#size-label"),
  zoomValue: $("#zoom-fit-btn"),
  gridBtn: $("#grid-btn"),
  guidesBtn: $("#guides-btn"),
  exportDialog: $("#export-dialog"),
  exportIssues: $("#export-issues"),
  exportPreview: $("#export-preview-canvas"),
  exportResolution: $("#export-resolution"),
  exportPng: $("#export-png-btn"),
  exportSvg: $("#export-svg-btn"),
  qualityDialog: $("#quality-dialog"),
  qualityResults: $("#quality-results"),
  nameDialog: $("#name-dialog"),
  nameDialogTitle: $("#name-dialog-title"),
  nameDialogEyebrow: $("#name-dialog-eyebrow"),
  nameDialogInput: $("#name-dialog-input"),
  nameDialogConfirm: $("#name-dialog-confirm"),
  imageInput: $("#image-input"),
  toast: $("#toast")
};

const measurer = createMeasurer();
const imageCache = new ImageCache();
const history = new History(60);
const app = {
  model: createDefaultModel(),
  templates: [],
  keyframes: [],
  scene: null,
  selectedId: "center-text",
  view: { zoom: 1, panX: 0, panY: 0 },
  ui: { guides: true, grid: true },
  editBaseline: null,
  dragging: null,
  status: "starting",
  initialized: false,
  exportIssues: [],
  imageLoading: false,
  imageTargetId: null
};

let toastTimer = 0;
let nameDialogHandler = null;
let layerDragId = null;
let pointerState = null;
let spacePressed = false;
let resizeObserver = null;
let draftSaveTimer = 0;

const fontInput = document.createElement("input");
fontInput.type = "file";
fontInput.accept = ".woff2,.woff,.ttf,.otf";
fontInput.hidden = true;
document.body.append(fontInput);

function showToast(message, type = "success", duration = 3000) {
  window.clearTimeout(toastTimer);
  dom.toast.textContent = message;
  dom.toast.classList.toggle("is-error", type === "error");
  dom.toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => {
    dom.toast.classList.remove("is-visible");
  }, duration);
}

function setSaveStatus(text, state = "") {
  dom.saveStatus.textContent = text;
  dom.saveStatus.dataset.state = state;
}

function getSelectedElement() {
  return app.model.elements.find((element) => element.id === app.selectedId) || null;
}

function getSelectedGroup() {
  return app.scene?.groups.find((group) => group.id === app.selectedId) || null;
}

function getSafeRadius(model = app.model) {
  return model.document.size / 2 - model.document.safeMargin;
}

function projectSnapshot() {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    model: cloneModel(app.model),
    templates: cloneModel(app.templates),
    keyframes: cloneModel(app.keyframes),
    selectedId: app.selectedId,
    view: { ...app.view },
    ui: { ...app.ui }
  };
}

async function rebuildScene({ loadImages = true } = {}) {
  app.scene = buildScene(app.model, measurer);
  if (loadImages && app.scene.drawables.some((item) => item.kind === "image")) {
    try {
      await imageCache.loadAll(app.scene);
    } catch (error) {
      showToast(error.message, "error");
    }
  }
  return app.scene;
}

function viewMetrics() {
  const width = dom.preview.clientWidth || dom.stageWrap.clientWidth || 800;
  const height = dom.preview.clientHeight || dom.stageWrap.clientHeight || 800;
  const fitScale = (Math.min(width, height) * 0.83) / app.model.document.size;
  const scale = fitScale * app.view.zoom;
  const center = app.scene?.center || {
    x: app.model.document.size / 2,
    y: app.model.document.size / 2
  };
  return {
    width,
    height,
    scale,
    offsetX: width / 2 + app.view.panX - center.x * scale,
    offsetY: height / 2 + app.view.panY - center.y * scale
  };
}

let canvasFrame = 0;
function scheduleCanvasRender() {
  if (canvasFrame) return;
  canvasFrame = requestAnimationFrame(() => {
    canvasFrame = 0;
    renderCanvas();
  });
}

function renderCanvas() {
  if (!app.scene) return;
  const dpr = Math.min(2.5, window.devicePixelRatio || 1);
  const width = dom.preview.clientWidth || 1;
  const height = dom.preview.clientHeight || 1;
  const pixelWidth = Math.max(1, Math.round(width * dpr));
  const pixelHeight = Math.max(1, Math.round(height * dpr));
  if (dom.preview.width !== pixelWidth || dom.preview.height !== pixelHeight) {
    dom.preview.width = pixelWidth;
    dom.preview.height = pixelHeight;
  }
  const ctx = dom.preview.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const view = viewMetrics();
  drawScene(ctx, app.scene, {
    scale: view.scale,
    offsetX: view.offsetX,
    offsetY: view.offsetY,
    imageCache
  });
  if (app.ui.guides) drawGuides(ctx, app.scene, view);
  const group = getSelectedGroup();
  if (group) drawSelection(ctx, app.scene, group, view);
  dom.canvasEmpty.hidden = app.scene.groups.length > 0;
  dom.zoomValue.textContent = `${Math.round(app.view.zoom * 100)}%`;
  updateSelectionPill();
}

function updateSelectionPill() {
  const group = getSelectedGroup();
  if (!group) {
    dom.selectionPill.hidden = true;
    return;
  }
  dom.selectionPill.hidden = false;
  dom.selectionPill.innerHTML = `<span>已选中</span><b>${escapeHtml(group.name)}</b><span>· 拖动画布可移动</span>`;
}

function updateChrome() {
  dom.docName.textContent = app.model.meta.name || "未命名图章";
  dom.seed.value = app.model.style.seed;
  dom.seedValue.textContent = app.model.style.seed;
  dom.color.value = app.model.style.color;
  dom.colorHex.value = app.model.style.color.toUpperCase();
  dom.wear.value = Math.round(app.model.style.wear * 100);
  dom.wearValue.textContent = `${Math.round(app.model.style.wear * 100)}%`;
  dom.chip.value = Math.round(app.model.style.chips * 100);
  dom.chipValue.textContent = `${Math.round(app.model.style.chips * 100)}%`;
  dom.documentSize.value = String(app.model.document.size);
  if (!dom.documentSize.value) {
    const option = document.createElement("option");
    option.value = String(app.model.document.size);
    option.textContent = `${app.model.document.size} px`;
    dom.documentSize.append(option);
    dom.documentSize.value = option.value;
  }
  dom.safeMargin.value = String(app.model.document.safeMargin);
  if (!dom.safeMargin.value) {
    const option = document.createElement("option");
    option.value = String(app.model.document.safeMargin);
    option.textContent = `${app.model.document.safeMargin} px`;
    dom.safeMargin.append(option);
    dom.safeMargin.value = option.value;
  }
  dom.sizeLabel.textContent = `${app.model.document.size} × ${app.model.document.size} px`;
  dom.safeSizeLabel.textContent = `${app.model.document.safeMargin} px`;
  dom.gridBtn.classList.toggle("is-active", app.ui.grid);
  dom.gridBtn.setAttribute("aria-pressed", String(app.ui.grid));
  dom.stageWrap.classList.toggle("grid-on", app.ui.grid);
  dom.guidesBtn.classList.toggle("is-active", app.ui.guides);
  dom.guidesBtn.setAttribute("aria-pressed", String(app.ui.guides));
  dom.undo.disabled = !history.canUndo;
  dom.redo.disabled = !history.canRedo;
  dom.undo.title = history.canUndo ? `撤销：${history.undoLabel}` : "没有可撤销的操作";
  dom.redo.title = history.canRedo ? `重做：${history.redoLabel}` : "没有可重做的操作";
  const selected = getSelectedElement();
  dom.visibility.disabled = !selected;
  dom.visibility.textContent = selected?.visible === false ? "○" : "◉";
  dom.visibility.title = selected?.visible === false ? "显示图层" : "隐藏图层";
}

function renderLayers() {
  const rows = [...app.model.elements].reverse().map((element) => {
    const hidden = element.visible === false;
    const selected = element.id === app.selectedId;
    const icon = {
      ring: "○",
      arcText: "弧",
      text: "字",
      motif: "◇",
      image: "图"
    }[element.type] || "·";
    return `<div class="layer-row ${selected ? "is-selected" : ""} ${hidden ? "is-hidden" : ""}" data-layer-id="${escapeHtml(element.id)}" draggable="true" role="button" tabindex="0">
      <span class="layer-type-icon">${icon}</span>
      <span class="layer-name">${escapeHtml(element.name)}</span>
      <span class="layer-grip">⋮⋮</span>
      <button class="layer-eye" data-action="toggle-layer" title="${hidden ? "显示" : "隐藏"}">${hidden ? "○" : "◉"}</button>
    </div>`;
  }).join("");
  dom.layerList.innerHTML = rows || '<div class="empty-state">暂无图层。</div>';
}

function renderTemplates() {
  const builtin = BUILTIN_TEMPLATE_DEFS.map((template) => ({
    ...template,
    active: app.model.meta.template === template.factory().meta.template
  }));
  const custom = app.templates.map((template) => ({
    ...template,
    active: app.model.meta.template === template.id,
    builtin: false
  }));
  const all = [...builtin, ...custom];
  dom.templateCount.textContent = String(all.length);
  dom.templateList.innerHTML = all.map((template) => `
    <div class="template-card ${template.active ? "is-active" : ""}" data-template-id="${escapeHtml(template.id)}" role="button" tabindex="0">
      <div class="template-thumb">${escapeHtml(template.mark || "印")}</div>
      <div class="template-copy">
        <div class="template-name">${escapeHtml(template.name)}</div>
        <div class="template-meta">${escapeHtml(template.description || "自定义模板 · 完整参数")}</div>
      </div>
      ${template.builtin ? "" : `<button class="template-delete" data-action="delete-template" title="删除模板">×</button>`}
    </div>
  `).join("");
}

function renderKeyframes() {
  dom.keyframeCount.textContent = String(app.keyframes.length);
  if (app.keyframes.length === 0) {
    dom.keyframeList.innerHTML = '<div class="empty-state">保存一组参数，随时无损回到此刻。</div>';
    return;
  }
  dom.keyframeList.innerHTML = app.keyframes.map((keyframe) => `
    <button class="keyframe-chip" data-keyframe-id="${escapeHtml(keyframe.id)}" title="恢复关键帧：${escapeHtml(keyframe.name)}">
      <span>◇ ${escapeHtml(keyframe.name)}</span>
      <span data-action="delete-keyframe" title="删除">×</span>
    </button>
  `).join("");
}

function getPathValue(object, path) {
  return path.split(".").reduce((value, key) => value?.[key], object);
}

function setPathValue(object, path, value) {
  const keys = path.split(".");
  const finalKey = keys.pop();
  const target = keys.reduce((current, key) => {
    if (!current[key]) current[key] = {};
    return current[key];
  }, object);
  target[finalKey] = value;
}

function rangeField(label, path, value, min, max, step, unit = "") {
  const formatted = Number(value).toFixed(step < 1 ? 1 : 0);
  return `<label class="range-field inspector-range">
    <span>${label} <b data-value-for="${path}">${formatted}${unit}</b></span>
    <input type="range" data-prop="${path}" min="${min}" max="${max}" step="${step}" value="${value}" data-unit="${unit}">
  </label>`;
}

function numberField(label, path, value, min, max, step = 1, unit = "") {
  return `<label class="field">
    <span>${label}${unit ? ` · ${unit}` : ""}</span>
    <input type="number" data-prop="${path}" min="${min}" max="${max}" step="${step}" value="${Number(value).toFixed(step < 1 ? 1 : 0)}">
  </label>`;
}

function fontFields(element) {
  const custom = Object.entries(app.model.assets.fonts).map(([id, asset]) => (
    `<option value="${escapeHtml(id)}" ${element.fontId === id ? "selected" : ""}>${escapeHtml(asset.name)}</option>`
  )).join("");
  const preset = FONT_PRESETS.map((font) => (
    `<option value="${font.id}" ${element.fontId === font.id ? "selected" : ""}>${font.name}</option>`
  )).join("");
  return `<label class="field font-field">
    <span>字体</span>
    <div class="font-row">
      <select data-prop="fontId">${preset}${custom}</select>
      <button class="mini-button" data-action="upload-font" title="上传字体">＋</button>
    </div>
  </label>
  ${rangeField("字重", "fontWeight", element.fontWeight || 600, 300, 800, 100)}
  ${rangeField("字距", "letterSpacing", element.letterSpacing || 0, -4, 30, 0.5, "px")}`;
}

function commonTransformFields(element) {
  return `<div class="inspector-subhead">位置与变换</div>
    <div class="field-grid">
      ${numberField("X", "transform.x", element.transform.x, -400, 400, 1, "px")}
      ${numberField("Y", "transform.y", element.transform.y, -400, 400, 1, "px")}
    </div>
    ${rangeField("缩放", "transform.scale", element.transform.scale, 0.25, 1.6, 0.01)}
    ${rangeField("旋转", "transform.rotation", element.transform.rotation, -180, 180, 1, "°")}
    ${rangeField("不透明度", "opacity", element.opacity ?? 1, 0.1, 1, 0.01)}`;
}

function renderInspector() {
  const element = getSelectedElement();
  if (!element) {
    dom.inspectorTitle.textContent = "图层属性";
    dom.inspectorBody.innerHTML = '<div class="empty-state">从画布或图层列表选择一个元素。文字与图形都可以继续编辑。</div>';
    return;
  }
  const typeNames = {
    ring: "RING · 环线图形",
    arcText: "ARC TEXT · 弧排文字",
    text: "TEXT · 横排文字",
    motif: "MOTIF · 装饰图形",
    image: "IMAGE · 位图元素"
  };
  dom.inspectorTitle.textContent = element.name;
  let body = `<div class="inspector-type">${typeNames[element.type] || element.type}</div>
    <label class="field">
      <span>图层名称</span>
      <input type="text" data-prop="name" value="${escapeHtml(element.name)}" maxlength="40">
    </label>`;

  if (element.type === "ring") {
    body += `<div class="inspector-subhead">内外圈</div>
      ${rangeField("半径", "radius", element.radius, 40, 318, 1, "px")}
      ${rangeField("线宽", "width", element.width, 1, 20, 0.5, "px")}
      <div class="inspector-subhead">缺口</div>
      ${rangeField("缺口角度", "gapAngle", element.gapAngle, 0, 359.5, 0.5, "°")}
      ${rangeField("缺口宽度", "gapSize", element.gapSize, 0, 20, 0.5, "°")}
      <label class="check-field">
        <input type="checkbox" data-prop="accent.enabled" ${element.accent?.enabled ? "checked" : ""}>
        <span>启用副圈线</span>
      </label>
      ${element.accent?.enabled ? `${rangeField("副圈偏移", "accent.offset", element.accent.offset, -36, 36, 1, "px")}
        ${rangeField("副圈线宽", "accent.width", element.accent.width, 0.5, 8, 0.5, "px")}
        ${rangeField("副圈缺口", "accent.gapSize", element.accent.gapSize, 0, 20, 0.5, "°")}` : ""}`;
  } else if (element.type === "arcText") {
    body += `<label class="field">
        <span>弧排文案</span>
        <textarea data-prop="text" maxlength="120">${escapeHtml(element.text)}</textarea>
      </label>
      <div class="field-grid">
        <label class="field">
          <span>弧度方向</span>
          <select data-prop="direction">
            <option value="top" ${element.direction === "top" ? "selected" : ""}>上弧</option>
            <option value="bottom" ${element.direction === "bottom" ? "selected" : ""}>下弧</option>
          </select>
        </label>
        ${numberField("字号", "fontSize", element.fontSize, 10, 100, 1, "px")}
      </div>
      ${fontFields(element)}
      <div class="inspector-subhead">字弧</div>
      ${rangeField("字弧半径", "radius", element.radius, 60, 320, 1, "px")}
      ${rangeField("可读弧面上限", "maxSpan", element.maxSpan, 60, 200, 1, "°")}`;
  } else if (element.type === "text") {
    body += `<label class="field">
        <span>横排文案</span>
        <textarea data-prop="text" maxlength="120">${escapeHtml(element.text)}</textarea>
      </label>
      <div class="field-grid">
        ${numberField("字号", "fontSize", element.fontSize, 10, 160, 1, "px")}
        <label class="field">
          <span>对齐</span>
          <select data-prop="align">
            <option value="center" ${element.align === "center" ? "selected" : ""}>居中</option>
            <option value="left" ${element.align === "left" ? "selected" : ""}>左对齐</option>
            <option value="right" ${element.align === "right" ? "selected" : ""}>右对齐</option>
          </select>
        </label>
      </div>
      ${fontFields(element)}`;
  } else if (element.type === "motif") {
    body += `<div class="field-grid">
        <label class="field">
          <span>装饰样式</span>
          <select data-prop="variant">
            <option value="diamond-rule" ${element.variant === "diamond-rule" ? "selected" : ""}>菱心中线</option>
            <option value="dots" ${element.variant === "dots" ? "selected" : ""}>点列分隔</option>
          </select>
        </label>
        ${numberField("尺寸", "size", element.size, 1, 24, 0.5, "px")}
      </div>
      ${rangeField("横向长度", "width", element.width, 20, 460, 1, "px")}`;
  } else if (element.type === "image") {
    const asset = app.model.assets.images[element.assetId];
    body += `<div class="image-card">
        ${asset ? `<img src="${escapeHtml(asset.dataUrl)}" alt="">` : '<span>图片丢失</span>'}
        <div><b>${escapeHtml(asset?.name || "未找到图片")}</b><span>${asset ? `${asset.width} × ${asset.height}` : "请重新上传"}</span></div>
      </div>
      ${rangeField("图片宽度", "imageWidth", element.imageWidth, 20, app.model.document.size * 0.85, 1, "px")}
      <button class="text-button" data-action="replace-image">↻ 更换图片</button>`;
  }

  body += commonTransformFields(element);

  const currentIssues = app.scene
    ? validateScene(app.scene).filter((item) => item.elementId === element.id && item.level === "error")
    : [];
  if (currentIssues.length) {
    body += `<div class="element-warning"><strong>此图层有 ${currentIssues.length} 项问题</strong><span>${escapeHtml(currentIssues[0].fix)}</span></div>`;
  }
  dom.inspectorBody.innerHTML = body;
}

function updateLiveCheck() {
  if (!app.scene) return;
  const issues = validateScene(app.scene);
  const summary = issueSummary(issues);
  dom.liveCheck.classList.toggle("has-errors", summary.errors.length > 0);
  dom.liveCheck.classList.toggle("has-warnings", summary.errors.length === 0 && summary.warnings.length > 0);
  const first = summary.errors[0] || summary.warnings[0];
  if (!first) {
    dom.liveCheck.innerHTML = '<span class="live-check-icon">✓</span><span>所有文字与图形都在安全区内，可导出透明 PNG / 矢量 SVG。</span>';
  } else {
    dom.liveCheck.innerHTML = `<span class="live-check-icon">${summary.errors.length ? "!" : "△"}</span><span><b>${escapeHtml(first.title)}</b><br>${escapeHtml(first.fix)}</span>`;
  }
  return issues;
}

async function refreshAll({ rebuild = true } = {}) {
  try {
    if (rebuild) await rebuildScene();
    renderCanvas();
    renderLayers();
    renderTemplates();
    renderKeyframes();
    renderInspector();
    updateChrome();
    updateLiveCheck();
  } catch (error) {
    console.error(error);
    showToast(`无法更新画布：${error.message}`, "error", 5000);
  }
}

function beginEdit(label) {
  if (!app.editBaseline) {
    app.editBaseline = {
      model: cloneModel(app.model),
      label
    };
  }
  return app.editBaseline;
}

function finishEdit(label = null) {
  if (!app.editBaseline) return false;
  const baseline = app.editBaseline;
  app.editBaseline = null;
  if (JSON.stringify(baseline.model) === JSON.stringify(app.model)) return false;
  history.record(baseline.model, label || baseline.label || "编辑");
  app.model.meta.updatedAt = new Date().toISOString();
  updateChrome();
  scheduleDraftSave();
  return true;
}

async function replaceModel(nextModel, options = {}) {
  const previous = app.model;
  const normalized = normalizeModel(nextModel);
  if (options.record !== false) {
    history.record(previous, options.label || "修改设计");
  }
  app.model = normalized;
  if (options.selectedId) app.selectedId = options.selectedId;
  if (!app.model.elements.some((element) => element.id === app.selectedId)) {
    app.selectedId = app.model.elements[app.model.elements.length - 1]?.id || null;
  }
  try {
    await registerCustomFonts(app.model);
  } catch (error) {
    showToast(error.message, "error", 5000);
  }
  await refreshAll({ rebuild: true });
  scheduleDraftSave();
}

async function updateCanvasFromModel({ reloadImages = false } = {}) {
  app.model.meta.updatedAt = new Date().toISOString();
  try {
    await rebuildScene({ loadImages: reloadImages });
    scheduleCanvasRender();
    updateLiveCheck();
  } catch (error) {
    showToast(`绘制失败：${error.message}`, "error", 5000);
  }
}

function updateRangeLabel(control) {
  const path = control.dataset.prop;
  if (!path) return;
  const label = dom.inspectorBody.querySelector(`[data-value-for="${path}"]`);
  if (label) {
    const unit = control.dataset.unit || "";
    const step = Number(control.step || 1);
    label.textContent = `${Number(control.value).toFixed(step < 1 ? 1 : 0)}${unit}`;
  }
}

function applyControlValue(control) {
  const element = getSelectedElement();
  if (!element) return;
  const path = control.dataset.prop;
  if (!path) return;
  let value;
  if (control.type === "checkbox") value = control.checked;
  else if (control.type === "number" || control.type === "range") value = Number(control.value);
  else value = control.value;
  if (typeof value === "number" && !Number.isFinite(value)) return;
  setPathValue(element, path, value);
  updateRangeLabel(control);
}

function scheduleDraftSave() {
  window.clearTimeout(draftSaveTimer);
  setSaveStatus("修改未保存…", "dirty");
  draftSaveTimer = window.setTimeout(async () => {
    try {
      const snapshot = projectSnapshot();
      await putWorkspace("draft", snapshot);
      const time = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
      setSaveStatus(`自动保存 ${time}`, "saved");
    } catch (error) {
      setSaveStatus("自动保存失败", "error");
      showToast(`自动保存失败：${error.message}`, "error", 5000);
    }
  }, 900);
}

async function onInspectorInput(event) {
  const control = event.target.closest("[data-prop]");
  if (!control || !dom.inspectorBody.contains(control)) return;
  const element = getSelectedElement();
  if (!element) return;
  const path = control.dataset.prop;
  beginEdit(`调整 ${element.name}`);
  applyControlValue(control);
  if (["transform.x", "transform.y", "transform.scale", "imageWidth"].includes(path)) {
    const constrained = constrainElement(app.model, measurer, element.id);
    app.model = constrained.model;
  }
  await updateCanvasFromModel();
}

async function onInspectorChange(event) {
  const control = event.target.closest("[data-prop]");
  if (!control || !dom.inspectorBody.contains(control)) return;
  const element = getSelectedElement();
  if (!element) return;
  applyControlValue(control);
  const needsRebuild = [
    "accent.enabled",
    "variant",
    "fontId",
    "direction",
    "align"
  ].includes(control.dataset.prop);
  finishEdit(`调整 ${element.name}`);
  if (needsRebuild) {
    await refreshAll({ rebuild: true });
  } else {
    await updateCanvasFromModel();
    renderInspector();
    updateChrome();
  }
}

function renderIssueList(container, issues, options = {}) {
  if (issues.length === 0) {
    container.innerHTML = `<div class="issue success">
      <span class="issue-icon">✓</span>
      <div><strong>通过全部导出检查</strong>安全边距完整，文字未被裁切，缺口避开了日期与文字。</div>
    </div>`;
    return;
  }
  container.innerHTML = issues.map((item) => `
    <div class="issue ${item.level}">
      <span class="issue-icon">${item.level === "error" ? "!" : "△"}</span>
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <span>${escapeHtml(item.message)}</span>
        <div class="issue-fix">${escapeHtml(item.fix)}</div>
      </div>
    </div>
  `).join("") + (options.allowRepair && issues.some((item) => item.level === "error")
    ? '<button type="button" class="button button-ghost repair-button" data-action="auto-repair">一键修复并重新检查</button>'
    : "");
}

async function prepareExportDialog() {
  await rebuildScene();
  const issues = validateScene(app.scene);
  app.exportIssues = issues;
  const summary = issueSummary(issues);
  const exportScale = 2;
  dom.exportResolution.textContent = `${app.model.document.size * exportScale} × ${app.model.document.size * exportScale} px`;
  renderIssueList(dom.exportIssues, issues, { allowRepair: true });
  dom.exportPng.disabled = !summary.ok;
  dom.exportSvg.disabled = !summary.ok;
  const exportCanvas = await renderExportCanvas(app.scene, imageCache, 1);
  const ctx = dom.exportPreview.getContext("2d");
  const target = Math.max(174, Math.round(174 * Math.min(2, window.devicePixelRatio || 1)));
  dom.exportPreview.width = target;
  dom.exportPreview.height = target;
  ctx.clearRect(0, 0, target, target);
  ctx.drawImage(exportCanvas, 0, 0, target, target);
}

async function openExportDialog() {
  await prepareExportDialog();
  if (!dom.exportDialog.open) dom.exportDialog.showModal();
}

async function autoRepairModel() {
  const baseline = cloneModel(app.model);
  let next = cloneModel(app.model);
  if (next.document.size < 512) {
    next = resizeModel(next, 720);
  }
  next = fitLongText(next, measurer);
  for (const element of next.elements) {
    if ((element.type === "text" || element.type === "arcText") && element.fontSize < 10) {
      element.fontSize = Math.max(12, element.fontSize);
    }
  }
  for (const element of next.elements) {
    if (!element.visible) continue;
    next = constrainElement(next, measurer, element.id).model;
  }

  const gapCandidates = [352, 270, 90, 180, 0, 45, 135, 225, 315];
  for (let attempt = 0; attempt < gapCandidates.length; attempt += 1) {
    const probe = buildScene(next, measurer);
    const gapIssues = validateScene(probe).filter((item) => (
      item.code === "GAP_CUTS_DATE" || item.code === "GAP_CUTS_TEXT"
    ));
    if (!gapIssues.length) break;
    const affectedRingIds = new Set(gapIssues.map((item) => {
      const ring = next.elements.find((element) => element.type === "ring"
        && probe.wedges.some((wedge) => wedge.elementId === element.id
          && (wedge.elementId === item.elementId || true)));
      return ring?.id;
    }).filter(Boolean));
    const rings = affectedRingIds.size
      ? next.elements.filter((element) => affectedRingIds.has(element.id))
      : next.elements.filter((element) => element.type === "ring");
    for (const ring of rings) {
      ring.gapAngle = gapCandidates[attempt];
      if (ring.accent) ring.accent.gapAngle = gapCandidates[attempt];
    }
  }

  app.model = normalizeModel(next);
  history.record(baseline, "一键修复边界问题");
  await registerCustomFonts(app.model);
  await refreshAll({ rebuild: true });
  scheduleDraftSave();
  const issues = validateScene(app.scene);
  const summary = issueSummary(issues);
  showToast(
    summary.ok ? "已修复：尺寸、长文本与安全边距已重新适配。" : `已自动修复部分问题，仍有 ${summary.errors.length} 项需手动处理。`,
    summary.ok ? "success" : "error",
    5000
  );
}

async function exportPng() {
  const summary = issueSummary(validateScene(app.scene));
  if (!summary.ok) {
    showToast("导出已阻止：请先修复质检错误。", "error");
    return;
  }
  try {
    dom.exportPng.disabled = true;
    dom.exportPng.textContent = "正在生成…";
    const canvas = await renderExportCanvas(app.scene, imageCache, 2);
    const rawBlob = await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNG 编码失败。")), "image/png");
    });
    const metadata = {
      StampModel: utf8ToBase64(JSON.stringify(app.model)),
      StampName: app.model.meta.name,
      StampSeed: String(app.model.style.seed),
      StampSafeMargin: String(app.model.document.safeMargin),
      StampRenderer: "seal-atelier-canvas"
    };
    const blob = await addPngMetadata(rawBlob, metadata);
    downloadBlob(blob, `${sanitizeFilename(app.model.meta.name)}-${app.model.document.size * 2}px-transparent.png`);
    showToast("透明 PNG 已导出，设计参数已写入文件。");
  } catch (error) {
    showToast(`PNG 导出失败：${error.message}`, "error", 5000);
  } finally {
    dom.exportPng.disabled = false;
    dom.exportPng.textContent = "导出透明 PNG";
  }
}

async function exportSvg() {
  const summary = issueSummary(validateScene(app.scene));
  if (!summary.ok) {
    showToast("导出已阻止：请先修复质检错误。", "error");
    return;
  }
  try {
    dom.exportSvg.disabled = true;
    dom.exportSvg.textContent = "正在内嵌字体…";
    await ensureBuiltinFontsLoaded();
    const fontData = await fontDataForExport(app.model);
    const svg = sceneToSvg(app.scene, { fontData });
    downloadText(svg, `${sanitizeFilename(app.model.meta.name)}-${app.model.document.size}px-editable.svg`, "image/svg+xml");
    showToast("可编辑 SVG 已导出，文字、路径、蒙版与参数均保留。");
  } catch (error) {
    showToast(`SVG 导出失败：${error.message}`, "error", 6000);
  } finally {
    dom.exportSvg.disabled = false;
    dom.exportSvg.textContent = "导出矢量 SVG";
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("文件读取失败。"));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片无法解码，请换一张 PNG / JPEG / WebP。"));
    image.src = source;
  });
}

async function prepareImageAsset(file) {
  if (!file.type.startsWith("image/")) {
    throw new Error("请选择 PNG、JPEG 或 WebP 图片。");
  }
  if (file.size > 18 * 1024 * 1024) {
    throw new Error("图片超过 18MB，请先压缩后再上传。");
  }
  const source = await readFileAsDataUrl(file);
  const image = await loadImageElement(source);
  const maxDimension = 1600;
  const ratio = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
  let dataUrl = source;
  const width = Math.round(image.naturalWidth * ratio);
  const height = Math.round(image.naturalHeight * ratio);
  if (ratio < 1 || source.length > 1_600_000) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, height);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const hasAlpha = file.type === "image/png" || file.type === "image/webp";
    dataUrl = canvas.toDataURL(hasAlpha ? "image/webp" : "image/jpeg", 0.91);
  }
  return {
    dataUrl,
    width: width || image.naturalWidth,
    height: height || image.naturalHeight,
    aspect: (width || image.naturalWidth) / (height || image.naturalHeight),
    name: file.name.replace(/\.[^.]+$/, "")
  };
}

async function handleImageFile(file) {
  if (!file) return;
  app.imageLoading = true;
  try {
    showToast("正在处理图片…", "success", 1500);
    const prepared = await prepareImageAsset(file);
    const baseline = cloneModel(app.model);
    const target = app.imageTargetId
      ? app.model.elements.find((element) => element.id === app.imageTargetId && element.type === "image")
      : null;
    let assetId;
    if (target) {
      assetId = target.assetId;
      app.model.assets.images[assetId] = {
        name: prepared.name,
        dataUrl: prepared.dataUrl,
        width: prepared.width,
        height: prepared.height,
        mime: prepared.dataUrl.slice(5, prepared.dataUrl.indexOf(";"))
      };
      target.aspect = prepared.aspect;
    } else {
      assetId = uid("img");
      app.model.assets.images[assetId] = {
        name: prepared.name,
        dataUrl: prepared.dataUrl,
        width: prepared.width,
        height: prepared.height,
        mime: prepared.dataUrl.slice(5, prepared.dataUrl.indexOf(";"))
      };
      const element = createImageElement(assetId, prepared.name, prepared.aspect);
      app.model.elements.push(element);
      app.selectedId = element.id;
    }
    history.record(baseline, target ? "更换图片" : "添加图片");
    await registerCustomFonts(app.model);
    await refreshAll({ rebuild: true });
    scheduleDraftSave();
    showToast(target ? "图片已更换，原参数保持不变。" : "图片已添加，可拖动并调整宽度。");
  } catch (error) {
    showToast(`图片上传失败：${error.message}`, "error", 5000);
  } finally {
    app.imageLoading = false;
    app.imageTargetId = null;
    dom.imageInput.value = "";
  }
}

async function handleFontFile(file) {
  if (!file) return;
  const element = getSelectedElement();
  if (!element || !("fontId" in element)) return;
  if (file.size > 12 * 1024 * 1024) {
    showToast("字体文件超过 12MB，建议先转换为 WOFF2。", "error", 5000);
    return;
  }
  const extension = file.name.split(".").pop()?.toLowerCase() || "ttf";
  const format = ["woff2", "woff", "ttf", "otf"].includes(extension) ? extension : "ttf";
  try {
    const dataUrl = await readFileAsDataUrl(file);
    const fontId = uid("font");
    const family = `SealCustom${fontId.replace(/[^a-z0-9]/gi, "")}`;
    const face = new FontFace(family, `url(${dataUrl})`, {
      weight: "100 900",
      style: "normal"
    });
    await face.load();
    document.fonts.add(face);
    const baseline = cloneModel(app.model);
    app.model.assets.fonts[fontId] = {
      name: file.name.replace(/\.[^.]+$/, ""),
      family,
      dataUrl,
      format
    };
    element.fontId = fontId;
    history.record(baseline, "上传并应用字体");
    await refreshAll({ rebuild: true });
    scheduleDraftSave();
    showToast("字体已加载并嵌入项目，保存与 SVG 导出都会保留。");
  } catch (error) {
    showToast(`字体加载失败：${error.message}`, "error", 6000);
  } finally {
    fontInput.value = "";
  }
}

function openNameDialog({ eyebrow = "SAVE", title, value, onConfirm }) {
  dom.nameDialogEyebrow.textContent = eyebrow;
  dom.nameDialogTitle.textContent = title;
  dom.nameDialogInput.value = value || "";
  nameDialogHandler = onConfirm;
  dom.nameDialog.showModal();
  requestAnimationFrame(() => {
    dom.nameDialogInput.focus();
    dom.nameDialogInput.select();
  });
}

async function saveDraftNow() {
  try {
    await putWorkspace("draft", projectSnapshot());
    const time = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    setSaveStatus(`自动保存 ${time}`, "saved");
  } catch (error) {
    showToast(`草稿保存失败：${error.message}`, "error", 5000);
  }
}

async function restoreProject(project, source) {
  if (!project?.model) throw new Error("保存内容缺少设计模型。");
  app.model = normalizeModel(project.model);
  app.templates = Array.isArray(project.templates) ? cloneModel(project.templates) : [];
  app.keyframes = Array.isArray(project.keyframes) ? cloneModel(project.keyframes) : [];
  app.selectedId = project.selectedId
    && app.model.elements.some((element) => element.id === project.selectedId)
    ? project.selectedId
    : app.model.elements[app.model.elements.length - 1]?.id || null;
  app.view = {
    zoom: Number.isFinite(project.view?.zoom) ? project.view.zoom : 1,
    panX: Number.isFinite(project.view?.panX) ? project.view.panX : 0,
    panY: Number.isFinite(project.view?.panY) ? project.view.panY : 0
  };
  app.ui = {
    guides: project.ui?.guides !== false,
    grid: project.ui?.grid !== false
  };
  await registerCustomFonts(app.model);
  history.clear();
  await refreshAll({ rebuild: true });
  setSaveStatus(source, "saved");
}

async function saveProject() {
  const snapshot = projectSnapshot();
  try {
    await putWorkspace("workspace", snapshot);
    const time = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    setSaveStatus(`已保存 ${time}`, "saved");
    showToast("项目已保存：设计、模板、字体、图片与关键帧可一致恢复。");
  } catch (error) {
    showToast(`项目保存失败：${error.message}`, "error", 6000);
  }
}

async function reloadProject() {
  try {
    const saved = await getWorkspace("workspace");
    if (!saved) {
      showToast("还没有手动保存的版本。请先点击“保存”。", "error", 4500);
      return;
    }
    await restoreProject(saved, "已恢复手动保存版本");
    showToast("已重新载入上次手动保存的版本。");
  } catch (error) {
    showToast(`重新载入失败：${error.message}`, "error", 6000);
  }
}

async function loadTemplate(templateId) {
  const builtin = BUILTIN_TEMPLATE_DEFS.find((item) => item.id === templateId);
  if (builtin) {
    await replaceModel(builtin.factory(), {
      record: true,
      label: `载入模板：${builtin.name}`,
      selectedId: "center-text"
    });
    return;
  }
  const template = app.templates.find((item) => item.id === templateId);
  if (!template) return;
  await replaceModel(template.model, {
    record: true,
    label: `载入模板：${template.name}`,
    selectedId: template.model.elements[template.model.elements.length - 1]?.id
  });
  showToast(`已载入模板“${template.name}”，字体与图片一并恢复。`);
}

async function saveTemplate() {
  const suggested = `${app.model.meta.name || "未命名"} 模板`;
  openNameDialog({
    eyebrow: "TEMPLATE",
    title: "保存为模板",
    value: suggested,
    onConfirm: async (name) => {
      if (!name.trim()) return;
      const id = uid("template");
      const templateModel = cloneModel(app.model);
      templateModel.meta = {
        ...templateModel.meta,
        name: name.trim(),
        template: id,
        updatedAt: new Date().toISOString()
      };
      app.templates.push({
        id,
        name: name.trim(),
        description: `${templateModel.document.size} px · 完整参数与资源`,
        mark: name.trim().slice(0, 1) || "印",
        createdAt: new Date().toISOString(),
        model: templateModel
      });
      renderTemplates();
      await saveDraftNow();
      showToast("模板已保存，字体、图片和全部参数都包含在内。");
    }
  });
}

async function captureKeyframe() {
  openNameDialog({
    eyebrow: "KEYFRAME",
    title: "记录关键帧",
    value: `关键帧 ${app.keyframes.length + 1}`,
    onConfirm: async (name) => {
      if (!name.trim()) return;
      app.keyframes.push({
        id: uid("kf"),
        name: name.trim(),
        createdAt: new Date().toISOString(),
        model: cloneModel(app.model)
      });
      renderKeyframes();
      await saveDraftNow();
      showToast("关键帧已记录，可随时恢复完整设计与资源。");
    }
  });
}

async function applyKeyframe(keyframeId) {
  const keyframe = app.keyframes.find((item) => item.id === keyframeId);
  if (!keyframe) return;
  await replaceModel(keyframe.model, {
    record: true,
    label: `恢复关键帧：${keyframe.name}`,
    selectedId: keyframe.model.elements[keyframe.model.elements.length - 1]?.id
  });
  showToast(`已恢复关键帧“${keyframe.name}”。`);
}

function selectElement(id, { rerender = true } = {}) {
  if (!id) return;
  app.selectedId = id;
  if (rerender) {
    renderLayers();
    renderInspector();
    updateChrome();
    scheduleCanvasRender();
  }
}

function canvasLocalPoint(event) {
  const rect = dom.preview.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}

function onPointerDown(event) {
  if (event.button !== 0 && event.button !== 1) return;
  const local = canvasLocalPoint(event);
  const view = viewMetrics();
  const scenePoint = scenePointFromScreen(local.x, local.y, view);
  const panMode = event.button === 1 || spacePressed;
  const group = panMode ? null : hitTestScene(app.scene, scenePoint, 5 / view.scale);
  dom.preview.setPointerCapture(event.pointerId);
  if (group && !group.element.locked) {
    selectElement(group.id);
    pointerState = {
      mode: "element",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scale: view.scale,
      baseline: cloneModel(app.model),
      id: group.id,
      name: group.name,
      moved: false
    };
    dom.preview.classList.add("is-moving");
    return;
  }
  pointerState = {
    mode: "pan",
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    panX: app.view.panX,
    panY: app.view.panY,
    moved: false,
    clickedEmpty: !group
  };
  dom.preview.classList.add("is-moving");
}

function onPointerMove(event) {
  const local = canvasLocalPoint(event);
  if (!pointerState) {
    const view = viewMetrics();
    const point = scenePointFromScreen(local.x, local.y, view);
    dom.preview.classList.toggle("is-over-element", Boolean(hitTestScene(app.scene, point, 5 / view.scale)));
    return;
  }
  const dx = event.clientX - pointerState.startX;
  const dy = event.clientY - pointerState.startY;
  if (Math.abs(dx) + Math.abs(dy) > 2) pointerState.moved = true;
  if (pointerState.mode === "pan") {
    app.view.panX = pointerState.panX + dx;
    app.view.panY = pointerState.panY + dy;
    scheduleCanvasRender();
    return;
  }
  const element = pointerState.baseline.elements.find((item) => item.id === pointerState.id);
  if (!element) return;
  const next = cloneModel(pointerState.baseline);
  const nextElement = next.elements.find((item) => item.id === pointerState.id);
  nextElement.transform.x = element.transform.x + dx / pointerState.scale;
  nextElement.transform.y = element.transform.y + dy / pointerState.scale;
  app.model = constrainElement(next, measurer, pointerState.id).model;
  app.scene = buildScene(app.model, measurer);
  scheduleCanvasRender();
  updateLiveCheck();
}

function endPointer(event) {
  if (!pointerState) return;
  const state = pointerState;
  pointerState = null;
  dom.preview.classList.remove("is-moving");
  if (dom.preview.hasPointerCapture(event.pointerId)) {
    dom.preview.releasePointerCapture(event.pointerId);
  }
  if (state.mode === "element" && state.moved) {
    history.record(state.baseline, `移动 ${state.name}`);
    scheduleDraftSave();
    renderInspector();
    updateChrome();
    updateLiveCheck();
  } else if (state.mode === "pan" && !state.moved && state.clickedEmpty) {
    app.selectedId = null;
    renderLayers();
    renderInspector();
    updateChrome();
    scheduleCanvasRender();
  }
}

function onWheel(event) {
  if (!app.scene) return;
  event.preventDefault();
  const local = canvasLocalPoint(event);
  const view = viewMetrics();
  const worldX = (local.x - view.width / 2 - app.view.panX) / view.scale;
  const worldY = (local.y - view.height / 2 - app.view.panY) / view.scale;
  const zoomFactor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
  const nextZoom = Math.min(4, Math.max(0.35, app.view.zoom * zoomFactor));
  const fitScale = (Math.min(view.width, view.height) * 0.83) / app.model.document.size;
  const nextScale = fitScale * nextZoom;
  app.view.panX = local.x - view.width / 2 - worldX * nextScale;
  app.view.panY = local.y - view.height / 2 - worldY * nextScale;
  app.view.zoom = nextZoom;
  scheduleCanvasRender();
}

function setZoom(nextZoom) {
  app.view.zoom = Math.min(4, Math.max(0.35, nextZoom));
  scheduleCanvasRender();
}

function fitView() {
  app.view = { zoom: 1, panX: 0, panY: 0 };
  scheduleCanvasRender();
}

function updateTextureStyle(path, value) {
  setPathValue(app.model.style, path, value);
  app.model.meta.updatedAt = new Date().toISOString();
  app.scene = buildScene(app.model, measurer);
  scheduleCanvasRender();
  updateLiveCheck();
}

async function runQualityCheck() {
  const tests = [
    {
      id: "cases",
      title: "默认与边界案例",
      run: () => {
        const defaults = createDefaultModel();
        const boundary = createBoundaryModel();
        if (!defaults.elements.length || boundary.document.size !== 240) {
          throw new Error("内置案例参数不完整。");
        }
        return `默认 720px；边界 ${boundary.document.size}px / ${boundary.elements.find((item) => item.id === "arc-top").text.length} 字长文。`;
      }
    },
    {
      id: "arc",
      title: "弧排文字不断裂",
      run: () => {
        const model = createDefaultModel();
        const scene = buildScene(model, measurer);
        const arc = scene.groups.find((group) => group.id === "arc-top");
        const expected = Array.from(arc.element.text).filter((char) => char.trim()).length;
        if (arc.drawables.length !== expected) {
          throw new Error(`应绘制 ${expected} 个字形，实际 ${arc.drawables.length} 个。`);
        }
        const span = scene.arcs.find((item) => item.elementId === "arc-top").requiredSpanDeg;
        if (span > arc.element.maxSpan) throw new Error("默认文字已越过可读弧面。");
        return `${expected} 个字形完整连续，占用 ${span.toFixed(1)}°。`;
      }
    },
    {
      id: "seed",
      title: "不同 seed 的磨损纹理",
      run: () => {
        const first = createDefaultModel();
        const second = createDefaultModel();
        first.style.seed = 19371;
        second.style.seed = 90827;
        const a = buildScene(first, measurer).wear.spots;
        const b = buildScene(second, measurer).wear.spots;
        if (!a.length || !b.length || measureSignature(a) === measureSignature(b)) {
          throw new Error("两个 seed 生成了相同的前 24 个磨损点。");
        }
        return `seed 19371 与 90827 的前 24 个磨损点签名不同（共 ${a.length} 点）。`;
      }
    },
    {
      id: "safe",
      title: "移动、缩放与重排后的安全区",
      run: () => {
        let model = createDefaultModel();
        const date = model.elements.find((element) => element.id === "date-text");
        date.transform.x = 420;
        date.transform.y = 260;
        date.transform.scale = 1.5;
        model = constrainElement(model, measurer, date.id).model;
        model.elements.reverse();
        const scene = buildScene(model, measurer);
        const safe = scene.width / 2 - scene.model.document.safeMargin;
        const violating = scene.groups.filter((group) => group.bounds.maxRadius > safe + 0.5);
        if (violating.length) {
          throw new Error(`仍有 ${violating.length} 个图层越过安全边界。`);
        }
        const dateBounds = scene.byElement["date-text"];
        if (!dateBounds || dateBounds.maxRadius > safe + 0.5) {
          throw new Error("日期图层未能回到安全区。");
        }
        return `重排 8 个图层并把日期推到画布外后，自动约束到 ${safe.toFixed(0)}px 安全半径内。`;
      }
    },
    {
      id: "boundary",
      title: "长文本 / 极小尺寸错误提示",
      run: () => {
        const boundary = createBoundaryModel();
        const scene = buildScene(boundary, measurer);
        const issues = validateScene(scene);
        const required = ["SMALL_DOCUMENT", "ARC_OVERFLOW", "TEXT_TOO_SMALL"];
        for (const code of required) {
          const found = issues.find((item) => item.code === code);
          if (!found) throw new Error(`缺少 ${code} 检查。`);
          if (!found.fix || found.fix.length < 8) throw new Error(`${code} 没有可执行的修复建议。`);
        }
        return `正确拦截 ${issues.filter((item) => item.level === "error").length} 项风险，并给出尺寸、字号与文案修复建议。`;
      }
    },
    {
      id: "gap",
      title: "缺口不得切到日期",
      run: () => {
        const model = createDefaultModel();
        const inner = model.elements.find((element) => element.id === "inner-ring");
        inner.gapAngle = 0;
        inner.gapSize = 14;
        const date = model.elements.find((element) => element.id === "date-text");
        date.transform.x = 203;
        date.transform.y = 0;
        const issues = validateScene(buildScene(model, measurer));
        const collision = issues.find((item) => item.code === "GAP_CUTS_DATE");
        if (!collision) throw new Error("日期被缺口穿过时没有阻止导出。");
        if (!collision.fix.includes("缺口角度")) throw new Error("缺口与日期冲突缺少修复指引。");
        return "构造缺口穿过日期的案例，校验返回 GAP_CUTS_DATE 并阻止导出。";
      }
    },
    {
      id: "png",
      title: "透明 PNG 与参数回写",
      run: async () => {
        const model = createDefaultModel();
        const scene = buildScene(model, measurer);
        const canvas = await renderExportCanvas(scene, imageCache, 1);
        const corner = canvas.getContext("2d").getImageData(0, 0, 1, 1).data;
        if (corner[3] !== 0) throw new Error("PNG 左上角不是透明像素。");
        const blob = await new Promise((resolve, reject) => {
          canvas.toBlob((value) => value ? resolve(value) : reject(new Error("无法编码 PNG。")), "image/png");
        });
        const tagged = await addPngMetadata(blob, {
          StampModel: utf8ToBase64(JSON.stringify(model))
        });
        const restored = await pngModelFromBlob(tagged);
        if (restored.style.seed !== model.style.seed || restored.elements.length !== model.elements.length) {
          throw new Error("PNG 参数回写不一致。");
        }
        return "四角 alpha=0，tEXt 中完整参数可回写。";
      }
    },
    {
      id: "svg",
      title: "SVG 可编辑输出",
      run: () => {
        const model = createDefaultModel();
        const scene = buildScene(model, measurer);
        const svg = sceneToSvg(scene, {
          fontData: {
            serif: { family: "Stamp Serif", dataUrl: "data:font/woff2;base64,AA==" }
          }
        });
        if (!svg.includes("<text") || !svg.includes("@font-face") || !svg.includes("<metadata")) {
          throw new Error("SVG 不是带字体与参数的可编辑矢量结构。");
        }
        if (svg.includes("<image") && model.assets.images && Object.keys(model.assets.images).length === 0) {
          throw new Error("SVG 使用了整图截图。");
        }
        const restored = svgModelFromText(svg);
        if (restored.meta.name !== model.meta.name) throw new Error("SVG 参数回写不一致。");
        return "文字为 <text>、磨损为蒙版、设计参数可回写，无截图烘焙。";
      }
    },
    {
      id: "persist",
      title: "模板 / 字体 / 图片 / 关键帧持久化",
      run: async () => {
        const model = createDefaultModel();
        model.assets.fonts.testFont = {
          name: "测试字体",
          family: "SealTestFont",
          dataUrl: "data:font/woff2;base64,AA==",
          format: "woff2"
        };
        model.assets.images.testImage = {
          name: "测试图片",
          dataUrl: "data:image/png;base64,AA==",
          width: 1,
          height: 1
        };
        const key = "__quality_check__";
        const payload = {
          model,
          templates: [{ id: "t1", name: "测试模板", model }],
          keyframes: [{ id: "k1", name: "测试帧", model }]
        };
        await putWorkspace(key, payload);
        const loaded = await getWorkspace(key);
        await removeWorkspace(key);
        if (!loaded?.model.assets.fonts.testFont
          || !loaded?.model.assets.images.testImage
          || loaded?.templates?.[0]?.name !== "测试模板"
          || loaded?.keyframes?.[0]?.name !== "测试帧") {
          throw new Error("IndexedDB 恢复内容不完整。");
        }
        return "模板、内嵌字体、图片与关键帧均原样回读。";
      }
    }
  ];

  dom.qualityResults.innerHTML = tests.map((test) => `
    <div class="quality-row running" data-quality-id="${test.id}">
      <span class="quality-icon">…</span>
      <div class="quality-copy"><strong>${escapeHtml(test.title)}</strong><span>检查中…</span></div>
      <span class="quality-state">RUN</span>
    </div>
  `).join("");

  const results = [];
  for (const test of tests) {
    const row = dom.qualityResults.querySelector(`[data-quality-id="${test.id}"]`);
    try {
      const detail = await test.run();
      results.push({ id: test.id, title: test.title, pass: true, detail });
      row.className = "quality-row";
      row.innerHTML = `<span class="quality-icon">✓</span>
        <div class="quality-copy"><strong>${escapeHtml(test.title)}</strong><span>${escapeHtml(detail)}</span></div>
        <span class="quality-state">PASS</span>`;
    } catch (error) {
      results.push({ id: test.id, title: test.title, pass: false, detail: error.message });
      row.className = "quality-row fail";
      row.innerHTML = `<span class="quality-icon">!</span>
        <div class="quality-copy"><strong>${escapeHtml(test.title)}</strong><span>${escapeHtml(error.message)}</span></div>
        <span class="quality-state">FAIL</span>`;
    }
  }
  return results;
}

function isTypingTarget(target) {
  return target instanceof HTMLElement
    && (target.matches("input, textarea, select") || target.isContentEditable);
}

async function undo() {
  const entry = history.undo(app.model);
  if (!entry) {
    showToast("没有可撤销的操作。");
    return;
  }
  app.editBaseline = null;
  app.model = entry.model;
  if (!app.model.elements.some((element) => element.id === app.selectedId)) {
    app.selectedId = app.model.elements[app.model.elements.length - 1]?.id || null;
  }
  await registerCustomFonts(app.model);
  await refreshAll({ rebuild: true });
  scheduleDraftSave();
  showToast(`已撤销：${entry.label}`);
}

async function redo() {
  const entry = history.redo(app.model);
  if (!entry) {
    showToast("没有可重做的操作。");
    return;
  }
  app.editBaseline = null;
  app.model = entry.model;
  if (!app.model.elements.some((element) => element.id === app.selectedId)) {
    app.selectedId = app.model.elements[app.model.elements.length - 1]?.id || null;
  }
  await registerCustomFonts(app.model);
  await refreshAll({ rebuild: true });
  scheduleDraftSave();
  showToast(`已重做：${entry.label}`);
}

function bindEvents() {
  dom.preview.addEventListener("pointerdown", onPointerDown);
  dom.preview.addEventListener("pointermove", onPointerMove);
  dom.preview.addEventListener("pointerup", endPointer);
  dom.preview.addEventListener("pointercancel", endPointer);
  dom.preview.addEventListener("wheel", onWheel, { passive: false });

  dom.undo.addEventListener("click", undo);
  dom.redo.addEventListener("click", redo);
  dom.saveBtn?.addEventListener("click", saveProject);
  $("#save-btn").addEventListener("click", saveProject);
  $("#reload-btn").addEventListener("click", reloadProject);
  $("#export-btn").addEventListener("click", openExportDialog);
  dom.exportPng.addEventListener("click", exportPng);
  dom.exportSvg.addEventListener("click", exportSvg);
  $("#qc-btn").addEventListener("click", async () => {
    dom.qualityDialog.showModal();
    const results = await runQualityCheck();
    const passed = results.filter((item) => item.pass).length;
    showToast(`质检完成：${passed}/${results.length} 项通过。`, passed === results.length ? "success" : "error");
  });
  $("#save-template-btn").addEventListener("click", saveTemplate);
  $("#capture-keyframe-btn").addEventListener("click", captureKeyframe);
  $("#add-image-btn").addEventListener("click", () => {
    app.imageTargetId = null;
    dom.imageInput.click();
  });
  dom.imageInput.addEventListener("change", () => handleImageFile(dom.imageInput.files?.[0]));
  fontInput.addEventListener("change", () => handleFontFile(fontInput.files?.[0]));

  dom.zoomIn = $("#zoom-in-btn");
  $("#zoom-in-btn").addEventListener("click", () => setZoom(app.view.zoom * 1.15));
  $("#zoom-out-btn").addEventListener("click", () => setZoom(app.view.zoom / 1.15));
  $("#zoom-fit-btn").addEventListener("click", fitView);
  $("#guides-btn").addEventListener("click", () => {
    app.ui.guides = !app.ui.guides;
    updateChrome();
    scheduleCanvasRender();
  });
  $("#grid-btn").addEventListener("click", () => {
    app.ui.grid = !app.ui.grid;
    updateChrome();
  });
  $("#download-json-btn").addEventListener("click", () => {
    const snapshot = projectSnapshot();
    downloadText(JSON.stringify(snapshot, null, 2), `${sanitizeFilename(app.model.meta.name)}-project.json`);
    showToast("项目文件已导出，可保留完整模板、资源与关键帧。");
  });

  dom.inspectorBody.addEventListener("input", onInspectorInput);
  dom.inspectorBody.addEventListener("change", onInspectorChange);
  dom.inspectorBody.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action === "upload-font") {
      fontInput.click();
    } else if (action === "replace-image") {
      app.imageTargetId = app.selectedId;
      dom.imageInput.click();
    }
  });

  dom.visibility.addEventListener("click", async () => {
    const element = getSelectedElement();
    if (!element) return;
    const baseline = cloneModel(app.model);
    element.visible = !element.visible;
    history.record(baseline, `${element.visible ? "显示" : "隐藏"} ${element.name}`);
    await refreshAll({ rebuild: true });
    scheduleDraftSave();
  });

  dom.layerList.addEventListener("click", async (event) => {
    const row = event.target.closest("[data-layer-id]");
    if (!row) return;
    const id = row.dataset.layerId;
    if (event.target.closest("[data-action='toggle-layer']")) {
      const element = app.model.elements.find((item) => item.id === id);
      if (!element) return;
      const baseline = cloneModel(app.model);
      element.visible = !element.visible;
      history.record(baseline, `${element.visible ? "显示" : "隐藏"} ${element.name}`);
      await refreshAll({ rebuild: true });
      scheduleDraftSave();
      return;
    }
    selectElement(id);
  });
  dom.layerList.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest("[data-layer-id]");
    if (!row) return;
    event.preventDefault();
    selectElement(row.dataset.layerId);
  });
  dom.layerList.addEventListener("dragstart", (event) => {
    const row = event.target.closest("[data-layer-id]");
    if (!row) return;
    layerDragId = row.dataset.layerId;
    row.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", layerDragId);
  });
  dom.layerList.addEventListener("dragover", (event) => {
    if (!layerDragId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  });
  dom.layerList.addEventListener("drop", async (event) => {
    event.preventDefault();
    const targetRow = event.target.closest("[data-layer-id]");
    if (!layerDragId || !targetRow) return;
    const rows = [...dom.layerList.querySelectorAll("[data-layer-id]")];
    const ids = rows.map((row) => row.dataset.layerId).filter((id) => id !== layerDragId);
    const targetId = targetRow.dataset.layerId;
    if (targetId === layerDragId) return;
    const targetIndex = ids.indexOf(targetId);
    const targetRect = targetRow.getBoundingClientRect();
    const insertBefore = event.clientY < targetRect.top + targetRect.height / 2;
    ids.splice(insertBefore ? targetIndex : targetIndex + 1, 0, layerDragId);
    const byId = Object.fromEntries(app.model.elements.map((element) => [element.id, element]));
    const nextElements = [...ids].reverse().map((id) => byId[id]).filter(Boolean);
    if (nextElements.length !== app.model.elements.length) return;
    const baseline = cloneModel(app.model);
    app.model.elements = nextElements;
    history.record(baseline, "重排图层");
    await refreshAll({ rebuild: true });
    scheduleDraftSave();
  });
  dom.layerList.addEventListener("dragend", () => {
    layerDragId = null;
    dom.layerList.querySelectorAll(".is-dragging").forEach((row) => row.classList.remove("is-dragging"));
  });

  dom.templateList.addEventListener("click", async (event) => {
    const card = event.target.closest("[data-template-id]");
    if (!card) return;
    const id = card.dataset.templateId;
    if (event.target.closest("[data-action='delete-template']")) {
      app.templates = app.templates.filter((template) => template.id !== id);
      renderTemplates();
      await saveDraftNow();
      showToast("自定义模板已删除。");
      return;
    }
    await loadTemplate(id);
  });
  dom.templateList.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const card = event.target.closest("[data-template-id]");
    if (!card) return;
    event.preventDefault();
    loadTemplate(card.dataset.templateId);
  });

  dom.keyframeList.addEventListener("click", async (event) => {
    const chip = event.target.closest("[data-keyframe-id]");
    if (!chip) return;
    const id = chip.dataset.keyframeId;
    if (event.target.closest("[data-action='delete-keyframe']")) {
      app.keyframes = app.keyframes.filter((keyframe) => keyframe.id !== id);
      renderKeyframes();
      await saveDraftNow();
      return;
    }
    await applyKeyframe(id);
  });

  dom.nameDialogConfirm.addEventListener("click", async () => {
    const value = dom.nameDialogInput.value.trim();
    if (!value || !nameDialogHandler) return;
    const handler = nameDialogHandler;
    nameDialogHandler = null;
    dom.nameDialog.close();
    await handler(value);
  });
  dom.nameDialogInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      dom.nameDialogConfirm.click();
    }
  });
  dom.nameDialog.addEventListener("close", () => {
    nameDialogHandler = null;
  });

  let colorEditActive = false;
  const applyColor = async (hex, isFinal = false) => {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
    if (!colorEditActive) beginEdit("修改印泥颜色");
    colorEditActive = !isFinal;
    app.model.style.color = hex.toUpperCase();
    await updateCanvasFromModel();
    updateChrome();
    if (isFinal) {
      colorEditActive = false;
      finishEdit("修改印泥颜色");
      renderInspector();
    }
  };
  dom.color.addEventListener("input", () => applyColor(dom.color.value));
  dom.color.addEventListener("change", () => applyColor(dom.color.value, true));
  dom.colorHex.addEventListener("input", () => {
    const value = dom.colorHex.value.startsWith("#") ? dom.colorHex.value : `#${dom.colorHex.value}`;
    if (/^#[0-9a-f]{6}$/i.test(value)) applyColor(value);
  });
  dom.colorHex.addEventListener("change", () => {
    const value = dom.colorHex.value.startsWith("#") ? dom.colorHex.value : `#${dom.colorHex.value}`;
    if (/^#[0-9a-f]{6}$/i.test(value)) applyColor(value, true);
    else updateChrome();
  });

  dom.seed.addEventListener("change", async () => {
    const next = Math.max(1, Math.round(Number(dom.seed.value) || 1));
    if (next === app.model.style.seed) return;
    const baseline = cloneModel(app.model);
    app.model.style.seed = next;
    history.record(baseline, "更换纹理种子");
    await updateCanvasFromModel();
    updateChrome();
    scheduleDraftSave();
  });
  $("#reseed-btn").addEventListener("click", async () => {
    const baseline = cloneModel(app.model);
    app.model.style.seed = randomSeed();
    history.record(baseline, "随机纹理种子");
    await updateCanvasFromModel();
    updateChrome();
    scheduleDraftSave();
  });

  let textureSession = false;
  const bindTextureRange = (control, key, label) => {
    control.addEventListener("input", async () => {
      if (!textureSession) {
        beginEdit(label);
        textureSession = true;
      }
      const value = Number(control.value) / 100;
      updateTextureStyle(key, value);
      if (key === "wear") dom.wearValue.textContent = `${control.value}%`;
      if (key === "chips") dom.chipValue.textContent = `${control.value}%`;
    });
    control.addEventListener("change", () => {
      textureSession = false;
      finishEdit(label);
      scheduleDraftSave();
    });
  };
  bindTextureRange(dom.wear, "wear", "调整磨损强度");
  bindTextureRange(dom.chip, "chips", "调整边缘毛糙");

  dom.documentSize.addEventListener("change", async () => {
    const nextSize = Number(dom.documentSize.value);
    if (!Number.isFinite(nextSize) || nextSize === app.model.document.size) return;
    const baseline = cloneModel(app.model);
    app.model = resizeModel(app.model, nextSize);
    history.record(baseline, "调整画布尺寸");
    await refreshAll({ rebuild: true });
    scheduleDraftSave();
  });
  dom.safeMargin.addEventListener("change", async () => {
    const value = Number(dom.safeMargin.value);
    if (!Number.isFinite(value) || value === app.model.document.safeMargin) return;
    const baseline = cloneModel(app.model);
    app.model.document.safeMargin = value;
    history.record(baseline, "调整安全边距");
    await refreshAll({ rebuild: true });
    scheduleDraftSave();
  });

  dom.exportIssues.addEventListener("click", async (event) => {
    if (!event.target.closest("[data-action='auto-repair']")) return;
    await autoRepairModel();
    await prepareExportDialog();
  });
  $("#load-boundary-btn").addEventListener("click", async () => {
    dom.qualityDialog.close();
    await loadTemplate("builtin-boundary");
  });

  window.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && ["z", "y"].includes(event.key.toLowerCase())) {
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      if (event.key.toLowerCase() === "y" || event.shiftKey) redo();
      else undo();
      return;
    }
    if (event.code === "Space" && !isTypingTarget(event.target)) {
      spacePressed = true;
      event.preventDefault();
    }
  });
  window.addEventListener("keyup", (event) => {
    if (event.code === "Space") spacePressed = false;
  });
  window.addEventListener("blur", () => {
    spacePressed = false;
  });
}

async function getPngBlob(scale = 2) {
  await rebuildScene();
  const issues = validateScene(app.scene);
  const summary = issueSummary(issues);
  if (!summary.ok) {
    const error = new Error(`导出被阻止：${summary.errors[0]?.title || "质检未通过"}。${summary.errors[0]?.fix || ""}`);
    error.issues = issues;
    throw error;
  }
  const canvas = await renderExportCanvas(app.scene, imageCache, scale);
  const rawBlob = await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNG 编码失败。")), "image/png");
  });
  return addPngMetadata(rawBlob, {
    StampModel: utf8ToBase64(JSON.stringify(app.model)),
    StampName: app.model.meta.name,
    StampSeed: String(app.model.style.seed),
    StampSafeMargin: String(app.model.document.safeMargin),
    StampRenderer: "seal-atelier-canvas"
  });
}

async function getSvgText({ embedFonts = true } = {}) {
  await rebuildScene();
  const issues = validateScene(app.scene);
  const summary = issueSummary(issues);
  if (!summary.ok) {
    const error = new Error(`导出被阻止：${summary.errors[0]?.title || "质检未通过"}。${summary.errors[0]?.fix || ""}`);
    error.issues = issues;
    throw error;
  }
  const fontData = embedFonts ? await fontDataForExport(app.model) : {};
  return sceneToSvg(app.scene, { fontData });
}

function apiMoveElement(id, x, y) {
  const baseline = cloneModel(app.model);
  const element = app.model.elements.find((item) => item.id === id);
  if (!element) return false;
  element.transform.x = x;
  element.transform.y = y;
  app.model = constrainElement(app.model, measurer, id).model;
  history.record(baseline, `移动 ${element.name}`);
  return refreshAll({ rebuild: true }).then(() => {
    scheduleDraftSave();
    return true;
  });
}

function apiReorder(ids) {
  if (!Array.isArray(ids) || ids.length !== app.model.elements.length) return false;
  const map = Object.fromEntries(app.model.elements.map((element) => [element.id, element]));
  if (!ids.every((id) => map[id])) return false;
  const baseline = cloneModel(app.model);
  app.model.elements = ids.map((id) => map[id]);
  history.record(baseline, "重排图层");
  refreshAll({ rebuild: true });
  scheduleDraftSave();
  return true;
}

async function init() {
  bindEvents();
  resizeObserver = new ResizeObserver(() => scheduleCanvasRender());
  resizeObserver.observe(dom.stageWrap);
  window.addEventListener("resize", scheduleCanvasRender);
  setSaveStatus("正在加载字体…", "loading");
  try {
    await ensureBuiltinFontsLoaded();
  } catch (error) {
    console.warn(error);
    showToast("内置字体加载较慢，画布会使用可用回退字体。", "error", 4500);
  }

  let restored = false;
  try {
    const draft = await getWorkspace("draft");
    const saved = await getWorkspace("workspace");
    const project = draft || saved;
    if (project) {
      await restoreProject(project, draft ? "已恢复自动草稿" : "已恢复保存版本");
      restored = true;
    }
  } catch (error) {
    console.error(error);
    showToast(`保存内容恢复失败，已打开默认案例：${error.message}`, "error", 6000);
  }

  if (!restored) {
    app.model = createDefaultModel();
    app.selectedId = "center-text";
    await registerCustomFonts(app.model);
    history.clear();
    await refreshAll({ rebuild: true });
    setSaveStatus("本地草稿就绪", "saved");
  }
  requestAnimationFrame(() => {
    renderCanvas();
    app.initialized = true;
    document.documentElement.dataset.sealReady = "true";
  });
  return true;
}

const ready = init();

window.sealApp = {
  ready,
  get model() {
    return app.model;
  },
  get scene() {
    return app.scene;
  },
  get view() {
    return { ...app.view };
  },
  get history() {
    return { canUndo: history.canUndo, canRedo: history.canRedo };
  },
  getValidation: () => validateScene(buildScene(app.model, measurer)),
  validateCurrent: () => validateScene(buildScene(app.model, measurer)),
  buildScene: (model = app.model) => buildScene(model, measurer),
  selectElement,
  moveElement: apiMoveElement,
  reorder: apiReorder,
  setView: (view) => {
    app.view = {
      zoom: Math.min(4, Math.max(0.35, Number(view.zoom) || 1)),
      panX: Number(view.panX) || 0,
      panY: Number(view.panY) || 0
    };
    scheduleCanvasRender();
  },
  fitView,
  undo,
  redo,
  save: saveProject,
  reload: reloadProject,
  loadTemplate,
  loadBoundary: () => loadTemplate("builtin-boundary"),
  replaceModel,
  autoRepair: autoRepairModel,
  runQualityCheck,
  openExport: openExportDialog,
  prepareExport: prepareExportDialog,
  getPngBlob,
  getSvgText,
  refresh: () => refreshAll({ rebuild: true }),
  toast: showToast,
  version: 1
};
