import {
  createScene,
  applyTemplate,
  resizeScene,
  validateScene,
  autoFixScene,
  deepClone,
  touch,
  clamp,
  round,
  entranceAt,
  setEntrancePreset,
  createTextElement,
  createShapeElement,
  duplicateElement,
  parseProjectJSON,
  exportProjectJSON,
  measureTextElement,
  getSafeRect,
  MIN_FONT_SIZE
} from "./core.js";
import {
  TEMPLATE_META,
  ENTRANCE_PRESETS,
  FONT_STACKS,
  EDGE_COPY,
  DEFAULT_COPY
} from "./templates.js";
import { History } from "./history.js";
import { BeatEngine } from "./audio.js";
import {
  StageRenderer,
  createCanvasMeasurer,
  hitTestScene,
  elementHandlePoints
} from "./renderer.js";
import {
  buildSVG,
  renderPNG,
  downloadBlob,
  safeFilename,
  createProbeMeasurer
} from "./exporter.js";

const STORAGE_KEY = "framework.subtitle.project.v3";
const DB_NAME = "framework-subtitle-projects";
const DB_STORE = "projects";
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const dom = {
  projectName: $("#projectName"),
  undoBtn: $("#undoBtn"),
  redoBtn: $("#redoBtn"),
  saveState: $("#saveState"),
  saveBtn: $("#saveBtn"),
  reloadBtn: $("#reloadBtn"),
  importBtn: $("#importBtn"),
  exportBtn: $("#exportBtn"),
  exportMenu: $("#exportMenu"),
  templateList: $("#templateList"),
  headlineInput: $("#headlineInput"),
  kickerInput: $("#kickerInput"),
  fontSizeInput: $("#fontSizeInput"),
  fontSizeValue: $("#fontSizeValue"),
  backgroundInput: $("#backgroundInput"),
  animationInput: $("#animationInput"),
  defaultCaseBtn: $("#defaultCaseBtn"),
  edgeCaseBtn: $("#edgeCaseBtn"),
  stage: $("#stage"),
  stageShell: $("#stageShell"),
  canvasSizeLabel: $("#canvasSizeLabel"),
  safeMarginInput: $("#safeMarginInput"),
  safeToggle: $("#safeToggle"),
  gridToggle: $("#gridToggle"),
  frameStatus: $("#frameStatus"),
  playBtn: $("#playBtn"),
  playIcon: $("#playIcon"),
  beatBtn: $("#beatBtn"),
  beatDot: $("#beatDot"),
  currentTime: $("#currentTime"),
  bpmInput: $("#bpmInput"),
  audioState: $("#audioState"),
  timelineInput: $("#timelineInput"),
  selectionTitle: $("#selectionTitle"),
  selectionType: $("#selectionType"),
  sceneInspector: $("#sceneInspector"),
  elementInspector: $("#elementInspector"),
  canvasWidth: $("#canvasWidth"),
  canvasHeight: $("#canvasHeight"),
  canvasColor: $("#canvasColor"),
  elementCount: $("#elementCount"),
  keyframeCount: $("#keyframeCount"),
  issueCount: $("#issueCount"),
  validationCard: $("#validationCard"),
  validationIcon: $("#validationIcon"),
  validationTitle: $("#validationTitle"),
  validationSummary: $("#validationSummary"),
  validationList: $("#validationList"),
  validateBtn: $("#validateBtn"),
  layerList: $("#layerList"),
  addTextBtn: $("#addTextBtn"),
  addShapeBtn: $("#addShapeBtn"),
  addImageBtn: $("#addImageBtn"),
  addFontBtn: $("#addFontBtn"),
  imageFileInput: $("#imageFileInput"),
  fontFileInput: $("#fontFileInput"),
  projectFileInput: $("#projectFileInput"),
  toastRegion: $("#toastRegion"),
  validationDialog: $("#validationDialog"),
  dialogSummary: $("#dialogSummary"),
  dialogIssues: $("#dialogIssues"),
  autoFixBtn: $("#autoFixBtn")
};

let scene = createScene();
let history = new History(scene);
let selectedId = null;
let validation = null;
let dirty = false;
let playing = false;
let animationFrame = null;
let lastPlaybackTime = 0;
let dragState = null;
let pendingExport = null;
let renderQueued = false;
let imageTargetId = null;

const renderer = new StageRenderer(dom.stage);
const measurer = createProbeMeasurer();
const imageMap = new Map();
const failedImages = new Set();
const beatEngine = new BeatEngine(pulseBeat);
let bundledFontPromise = null;

function openProjectDB() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error("当前浏览器不支持 IndexedDB。"));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DB_STORE)) database.createObjectStore(DB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB 打开失败。"));
  });
}

async function writeProjectRecord(payload) {
  const database = await openProjectDB();
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(DB_STORE, "readwrite");
      transaction.objectStore(DB_STORE).put(payload, STORAGE_KEY);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB 写入失败。"));
      transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB 写入被中止。"));
    });
  } finally {
    database.close();
  }
}

async function readProjectRecord() {
  const database = await openProjectDB();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(DB_STORE, "readonly");
      const request = transaction.objectStore(DB_STORE).get(STORAGE_KEY);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB 读取失败。"));
    });
  } finally {
    database.close();
  }
}

function toast(message, type = "info", duration = 3200) {
  const node = document.createElement("div");
  node.className = `toast${type === "error" ? " is-error" : type === "warn" ? " is-warn" : ""}`;
  node.textContent = message;
  dom.toastRegion.append(node);
  window.setTimeout(() => node.remove(), duration);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setDirty(value = true) {
  dirty = value;
  dom.saveState.className = `save-state ${value ? "is-dirty" : "is-saved"}`;
  dom.saveState.textContent = value ? "有未保存更改" : "已保存";
}

function primaryTextElement() {
  const selected = scene.elements.find((element) => element.id === selectedId);
  if (selected?.type === "text") return selected;
  return scene.elements.find((element) => element.id === "headline") ?? scene.elements.find((element) => element.type === "text");
}

function selectedElement() {
  return scene.elements.find((element) => element.id === selectedId) ?? null;
}

function selectElement(id) {
  selectedId = id;
  if (id) {
    scene.playheadMs = scene.timelineMs;
    pausePlayback(false);
  }
  syncSelectionPanel();
  syncLayerList();
  requestRender();
}

function touchAndCommit() {
  touch(scene);
  history.commit(scene);
  setDirty(true);
  syncUI();
}

function requestRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderStage();
  });
}

function renderStage() {
  renderer.render(scene, {
    timeMs: scene.playheadMs,
    selectedId,
    imageMap,
    showSafe: dom.safeToggle.checked,
    showGuides: dom.gridToggle.checked,
    showIssues: true
  });
}

function colorToHex(value, fallback = "#111a27") {
  const raw = String(value || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw;
  if (/^#[0-9a-f]{3}$/i.test(raw)) {
    return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`;
  }
  const match = raw.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (match) {
    return `#${[match[1], match[2], match[3]]
      .map((part) => clamp(Math.round(Number(part)), 0, 255).toString(16).padStart(2, "0"))
      .join("")}`;
  }
  return fallback;
}

function syncValidation() {
  validation = validateScene(scene, measurer);
  const errors = validation.errors;
  const warnings = validation.warnings;
  dom.issueCount.textContent = String(errors.length);
  dom.validationCard.classList.toggle("has-error", errors.length > 0);
  dom.validationIcon.textContent = errors.length ? "!" : "✓";
  dom.validationTitle.textContent = errors.length
    ? `${errors.length} 项问题阻止导出`
    : warnings.length
      ? "安全检查通过，有提示"
      : "安全检查通过";
  dom.validationSummary.textContent = errors.length
    ? "未生成文件；修复建议已列出"
    : warnings.length
      ? `${warnings.length} 条提醒，可继续导出`
      : "所有图层位于安全区内且文字未裁切";
  dom.validationList.innerHTML = errors
    .slice(0, 5)
    .map((item) => `<li><strong>${escapeHtml(item.elementName)}</strong>：${escapeHtml(item.message)}<br>${escapeHtml(item.fix)}</li>`)
    .join("");
  return validation;
}

function syncTemplateCards() {
  $$(".template-card").forEach((card) => {
    const active = card.dataset.template === scene.template;
    card.classList.toggle("is-active", active);
    card.setAttribute("aria-selected", String(active));
  });
}

function syncContentControls() {
  if (document.activeElement !== dom.projectName) dom.projectName.value = scene.name;
  if (document.activeElement !== dom.headlineInput) {
    dom.headlineInput.value = scene.elements.find((element) => element.id === "headline")?.text ?? "";
  }
  if (document.activeElement !== dom.kickerInput) {
    dom.kickerInput.value = scene.elements.find((element) => element.id === "kicker")?.text ?? "";
  }
  const target = primaryTextElement();
  const fontSize = target?.style?.fontSize ?? 16;
  dom.fontSizeInput.value = String(Math.round(clamp(fontSize, 14, 120)));
  dom.fontSizeValue.textContent = String(round(fontSize, 1));
  const percent = ((clamp(fontSize, 14, 120) - 14) / 106) * 100;
  dom.fontSizeInput.style.background = `linear-gradient(90deg, var(--accent) 0 ${percent}%, #2a3342 ${percent}% 100%)`;

  const selected = selectedElement();
  const backgroundTarget = selected?.type === "text" ? selected : selected?.type === "shape" ? selected : target;
  const color = selected?.type === "shape" ? selected.style.fill : backgroundTarget?.style?.background;
  dom.backgroundInput.value = colorToHex(color, selected?.type === "shape" ? "#ff5a45" : "#111a27");

  const animationTarget = selected ?? target;
  if (animationTarget?.entrance?.preset) dom.animationInput.value = animationTarget.entrance.preset;
}

function syncSceneControls() {
  if (document.activeElement !== dom.canvasWidth) dom.canvasWidth.value = String(scene.width);
  if (document.activeElement !== dom.canvasHeight) dom.canvasHeight.value = String(scene.height);
  if (document.activeElement !== dom.safeMarginInput) dom.safeMarginInput.value = String(round(scene.safeMargin, 1));
  dom.canvasColor.value = colorToHex(scene.background?.from, "#0b1220");
  dom.canvasSizeLabel.textContent = `${scene.width} × ${scene.height}`;
  dom.elementCount.textContent = String(scene.elements.length);
  dom.keyframeCount.textContent = String(
    scene.elements.reduce((sum, element) => sum + (element.entrance?.keyframes?.length ?? 0), 0)
  );
}

function syncTransport() {
  dom.timelineInput.max = String(scene.timelineMs);
  dom.timelineInput.value = String(round(scene.playheadMs, 0));
  dom.currentTime.textContent = (scene.playheadMs / 1000).toFixed(2);
  dom.bpmInput.value = String(scene.bpm);
  dom.playIcon.textContent = playing ? "Ⅱ" : "▶";
  dom.frameStatus.textContent = playing ? "播放中" : scene.playheadMs < scene.timelineMs ? "当前帧" : "编辑中";
  dom.frameStatus.classList.toggle("is-playing", playing);
  dom.playBtn.setAttribute("aria-label", playing ? "暂停入场动画" : "播放入场动画");
}

function syncLayerList() {
  const layers = [...scene.elements].reverse();
  dom.layerList.innerHTML = layers.map((element) => {
    const glyph = element.type === "text" ? "T" : element.type === "image" ? "▧" : element.shape === "ellipse" ? "◯" : "▭";
    return `
      <li class="layer-item${element.id === selectedId ? " is-selected" : ""}${element.visible ? "" : " is-hidden"}" data-layer-id="${escapeHtml(element.id)}">
        <span class="layer-glyph">${glyph}</span>
        <span class="layer-name" title="${escapeHtml(element.name)}">${escapeHtml(element.name)}</span>
        <span class="layer-order">
          <button type="button" data-layer-action="up" title="上移一层">↑</button>
          <button type="button" data-layer-action="down" title="下移一层">↓</button>
        </span>
        <button type="button" class="layer-eye" data-layer-action="visibility" title="${element.visible ? "隐藏" : "显示"}">${element.visible ? "◉" : "○"}</button>
      </li>`;
  }).join("");
}

function syncSelectionPanel() {
  const selected = selectedElement();
  dom.sceneInspector.hidden = Boolean(selected);
  dom.elementInspector.hidden = !selected;
  dom.selectionTitle.textContent = selected ? selected.name : "场景设置";
  dom.selectionType.textContent = selected ? selected.type.toUpperCase() : "SCENE";
  if (selected) renderElementInspector(selected);
}

function syncUI() {
  syncTemplateCards();
  syncContentControls();
  syncSceneControls();
  syncSelectionPanel();
  syncTransport();
  syncLayerList();
  syncValidation();
  dom.undoBtn.disabled = !history.canUndo();
  dom.redoBtn.disabled = !history.canRedo();
  requestRender();
}

function inspectorField(label, field, value, options = {}) {
  const type = options.type ?? "number";
  if (type === "select") {
    return `<label class="field-label">${label}<select data-field="${field}">${options.options}</select></label>`;
  }
  if (type === "color") {
    return `<label class="field-label">${label}<input type="color" data-field="${field}" value="${escapeHtml(colorToHex(value, options.fallback))}" /></label>`;
  }
  const attrs = [
    options.min !== undefined ? `min="${options.min}"` : "",
    options.max !== undefined ? `max="${options.max}"` : "",
    options.step !== undefined ? `step="${options.step}"` : "",
    options.placeholder ? `placeholder="${escapeHtml(options.placeholder)}"` : ""
  ].filter(Boolean).join(" ");
  return `<label class="field-label">${label}<input type="${type}" data-field="${field}" value="${escapeHtml(value ?? "")}" ${attrs} /></label>`;
}

function renderElementInspector(element) {
  const style = element.style ?? {};
  const fontOptions = [
    ...FONT_STACKS.map((font) => ({ label: font.label, value: font.value })),
    ...(scene.assets?.fonts ?? []).map((font) => ({
      label: `自定义 / ${font.name}`,
      value: `"${font.family}", "Noto Sans SC", sans-serif`
    }))
  ];
  if (!fontOptions.some((font) => font.value === style.fontFamily)) {
    fontOptions.unshift({ label: "当前字体（保留）", value: style.fontFamily });
  }
  const fontOptionsHtml = fontOptions
    .map((font) => `<option value="${escapeHtml(font.value)}"${font.value === style.fontFamily ? " selected" : ""}>${escapeHtml(font.label)}</option>`)
    .join("");
  const alignOptions = ["left", "center", "right"]
    .map((value) => `<option value="${value}"${style.align === value ? " selected" : ""}>${value === "left" ? "左对齐" : value === "center" ? "居中" : "右对齐"}</option>`)
    .join("");
  const valignOptions = ["top", "middle", "bottom"]
    .map((value) => `<option value="${value}"${style.valign === value ? " selected" : ""}>${value === "top" ? "顶部" : value === "middle" ? "垂直居中" : "底部"}</option>`)
    .join("");
  const entranceOptions = Object.entries(ENTRANCE_PRESETS)
    .map(([value, preset]) => `<option value="${value}"${element.entrance?.preset === value ? " selected" : ""}>${preset.label}</option>`)
    .join("");
  const keyframes = element.entrance?.keyframes ?? [];
  const keyframeMarkup = keyframes.map((frame) => {
    const x = round(Number(frame.x) || 0, 1);
    const y = round(Number(frame.y) || 0, 1);
    return `<li><span>${Math.round((Number(frame.at) || 0) * 100)}%</span><code>x ${x} / y ${y}</code><span>${round((Number(frame.scale) ?? 1) * 100, 0)}% · α ${round(Number(frame.opacity) ?? 1, 2)}</span></li>`;
  }).join("");

  const typeFields = element.type === "text"
    ? `
      <label class="field-label">文字内容<textarea rows="4" data-field="text" maxlength="1200">${escapeHtml(element.text)}</textarea></label>
      <div class="field-grid two">
        ${inspectorField("字号 px", "fontSize", round(style.fontSize, 1), { min: MIN_FONT_SIZE, max: 240, step: 0.5 })}
        ${inspectorField("字重", "fontWeight", style.fontWeight, { min: 100, max: 900, step: 50 })}
      </div>
      <label class="field-label">字体<select data-field="fontFamily">${fontOptionsHtml}</select></label>
      <div class="field-grid two">
        ${inspectorField("行高", "lineHeight", style.lineHeight, { min: 0.8, max: 3, step: 0.05 })}
        ${inspectorField("字间距", "letterSpacing", style.letterSpacing, { min: -10, max: 30, step: 0.1 })}
      </div>
      <div class="field-grid two">
        ${inspectorField("文字色", "color", style.color, { type: "color", fallback: "#ffffff" })}
        ${inspectorField("字幕背景", "background", style.background, { type: "color", fallback: "#111a27" })}
      </div>
      <div class="field-grid two">
        <label class="field-label">水平<select data-field="align">${alignOptions}</select></label>
        <label class="field-label">垂直<select data-field="valign">${valignOptions}</select></label>
      </div>
      <div class="field-grid two">
        ${inspectorField("内边距 X", "paddingX", style.paddingX, { min: 0, max: 200, step: 1 })}
        ${inspectorField("内边距 Y", "paddingY", style.paddingY, { min: 0, max: 200, step: 1 })}
      </div>
      <button class="text-action danger-ghost" type="button" data-action="clear-background">移除文字背景</button>`
    : element.type === "shape"
      ? `
      <div class="field-grid two">
        ${inspectorField("填充色", "fill", style.fill, { type: "color", fallback: "#ff5a45" })}
        ${inspectorField("描边色", "stroke", style.stroke, { type: "color", fallback: "#ffffff" })}
      </div>
      <div class="field-grid two">
        ${inspectorField("描边 px", "strokeWidth", style.strokeWidth, { min: 0, max: 30, step: 0.5 })}
        ${inspectorField("圆角 px", "radius", style.radius, { min: 0, max: 500, step: 1 })}
      </div>`
      : `
      <div class="field-grid two">
        <label class="field-label">裁切方式<select data-field="fit">
          <option value="cover"${style.fit !== "contain" ? " selected" : ""}>填满裁切</option>
          <option value="contain"${style.fit === "contain" ? " selected" : ""}>完整显示</option>
        </select></label>
        ${inspectorField("圆角 px", "radius", style.radius, { min: 0, max: 500, step: 1 })}
      </div>
      <button class="text-action" type="button" data-action="replace-image">替换图片数据</button>`;

  dom.elementInspector.innerHTML = `
    <div class="inspector-section identity-section">
      ${inspectorField("图层名称", "name", element.name, { type: "text" })}
      <label class="inline-check"><input type="checkbox" data-field="locked"${element.locked ? " checked" : ""} /> 锁定图层位置与属性</label>
    </div>
    <div class="inspector-section">
      <div class="section-label">内容与样式</div>
      ${typeFields}
    </div>
    <div class="inspector-section">
      <div class="section-label">几何参数</div>
      <div class="field-grid two">
        ${inspectorField("X", "x", round(element.x, 1), { step: 0.5 })}
        ${inspectorField("Y", "y", round(element.y, 1), { step: 0.5 })}
      </div>
      <div class="field-grid two">
        ${inspectorField("宽度", "w", round(element.w, 1), { min: 1, step: 0.5 })}
        ${inspectorField("高度", "h", round(element.h, 1), { min: 1, step: 0.5 })}
      </div>
      <div class="field-grid two">
        ${inspectorField("旋转 °", "rotation", round(element.rotation, 1), { min: -180, max: 180, step: 0.5 })}
        ${inspectorField("不透明度", "opacity", round(element.opacity, 2), { min: 0, max: 1, step: 0.01 })}
      </div>
    </div>
    <div class="inspector-section">
      <div class="section-label">入场动画</div>
      <label class="field-label">动画预设<select data-field="entrancePreset">${entranceOptions}</select></label>
      <div class="field-grid two">
        ${inspectorField("时长 ms", "entranceDuration", round(element.entrance?.duration, 0), { min: 0, max: 10000, step: 50 })}
        ${inspectorField("延迟 ms", "entranceDelay", round(element.entrance?.delay, 0), { min: 0, max: 10000, step: 50 })}
      </div>
      <ul class="keyframe-list">${keyframeMarkup}</ul>
    </div>
    <div class="inspector-actions">
      <button class="text-action" type="button" data-action="duplicate">复制图层</button>
      <button class="text-action danger-ghost" type="button" data-action="delete">删除图层</button>
    </div>
  `;
}

function numericValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function applyInspectorValue(element, field, rawValue, inputType = "number") {
  if (!element || element.locked) return false;
  const style = element.style;
  if (field === "name") {
    element.name = String(rawValue).slice(0, 80) || element.name;
  } else if (field === "locked") {
    element.locked = Boolean(rawValue);
  } else if (field === "text") {
    element.text = String(rawValue);
  } else if (["x", "y", "w", "h", "rotation"].includes(field)) {
    element[field] = numericValue(rawValue, element[field]);
    if ((field === "w" || field === "h") && element[field] < 1) element[field] = 1;
  } else if (field === "opacity") {
    element.opacity = clamp(numericValue(rawValue, 1), 0, 1);
  } else if (field === "fontSize") {
    style.fontSize = clamp(numericValue(rawValue, 16), MIN_FONT_SIZE, 240);
  } else if (field === "fontWeight") {
    style.fontWeight = clamp(numericValue(rawValue, 600), 100, 900);
  } else if (field === "lineHeight") {
    style.lineHeight = clamp(numericValue(rawValue, 1.35), 0.8, 3);
  } else if (field === "letterSpacing") {
    style.letterSpacing = clamp(numericValue(rawValue, 0), -10, 30);
  } else if (["paddingX", "paddingY"].includes(field)) {
    style[field] = clamp(numericValue(rawValue, 0), 0, 200);
  } else if (["strokeWidth"].includes(field)) {
    style[field] = clamp(numericValue(rawValue, 0), 0, 30);
  } else if (field === "radius") {
    style.radius = clamp(numericValue(rawValue, 0), 0, 500);
  } else if (["fontFamily", "color", "background", "align", "valign", "fill", "stroke", "fit"].includes(field)) {
    style[field] = String(rawValue);
  } else if (field === "entrancePreset") {
    setEntrancePreset(element, String(rawValue));
  } else if (field === "entranceDuration") {
    element.entrance.duration = clamp(numericValue(rawValue, 620), 0, 10000);
  } else if (field === "entranceDelay") {
    element.entrance.delay = clamp(numericValue(rawValue, 0), 0, 10000);
  } else {
    return false;
  }
  if (inputType === "input") touch(scene);
  return true;
}

function handleInspectorInput(event) {
  const fieldElement = event.target.closest("[data-field]");
  if (!fieldElement) return;
  if (fieldElement.type === "checkbox") return;
  const element = selectedElement();
  if (!element) return;
  if (element.locked && fieldElement.dataset.field !== "locked") {
    syncUI();
    return;
  }
  const value = fieldElement.type === "checkbox" ? fieldElement.checked : fieldElement.value;
  if (fieldElement.type === "number" && value === "") return;
  if (!applyInspectorValue(element, fieldElement.dataset.field, value, "input")) return;
  setDirty(true);
  if (fieldElement.dataset.field === "name") {
    dom.selectionTitle.textContent = element.name;
    syncLayerList();
  }
  syncValidation();
  requestRender();
}

function handleInspectorChange(event) {
  const fieldElement = event.target.closest("[data-field]");
  if (!fieldElement) return;
  const element = selectedElement();
  if (!element) return;
  const field = fieldElement.dataset.field;
  if (element.locked && field !== "locked") {
    syncUI();
    return;
  }
  if (field === "locked") {
    applyInspectorValue(element, field, fieldElement.checked, "change");
  } else if (fieldElement.type === "number" && fieldElement.value === "") {
    return;
  } else if (!fieldElement.dataset.applied) {
    applyInspectorValue(element, field, fieldElement.value, "change");
  }
  touchAndCommit();
}

function deleteSelectedElement() {
  const element = selectedElement();
  if (!element) return;
  scene.elements = scene.elements.filter((item) => item.id !== element.id);
  selectedId = null;
  touchAndCommit();
  toast(`已删除「${element.name}」。可使用 Ctrl+Z 撤销。`);
}

function handleInspectorClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const element = selectedElement();
  if (!element) return;
  const action = button.dataset.action;
  if (action === "delete") {
    deleteSelectedElement();
  } else if (action === "duplicate") {
    const copy = duplicateElement(scene, element.id);
    if (copy) {
      selectedId = copy.id;
      touchAndCommit();
      toast(`已复制「${element.name}」，副本保持可编辑。`);
    }
  } else if (action === "clear-background" && element.type === "text") {
    element.style.background = "transparent";
    touchAndCommit();
  } else if (action === "replace-image" && element.type === "image") {
    imageTargetId = element.id;
    dom.imageFileInput.click();
  }
}

function moveLayer(elementId, direction) {
  const index = scene.elements.findIndex((element) => element.id === elementId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= scene.elements.length) return;
  const [element] = scene.elements.splice(index, 1);
  scene.elements.splice(target, 0, element);
  touchAndCommit();
}

function handleLayerClick(event) {
  const item = event.target.closest("[data-layer-id]");
  if (!item) return;
  const id = item.dataset.layerId;
  const action = event.target.closest("[data-layer-action]")?.dataset.layerAction;
  if (!action) {
    selectElement(id);
    return;
  }
  const element = scene.elements.find((entry) => entry.id === id);
  if (!element) return;
  if (action === "visibility") {
    element.visible = !element.visible;
    touchAndCommit();
  } else if (action === "up") {
    moveLayer(id, 1);
  } else if (action === "down") {
    moveLayer(id, -1);
  }
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("文件读取失败，请检查文件是否可访问。"));
    reader.readAsDataURL(file);
  });
}

function getBundledFontData() {
  if (!bundledFontPromise) {
    bundledFontPromise = fetch(new URL("../assets/fonts/NotoSansSC-subset.woff2", import.meta.url))
      .then((response) => {
        if (!response.ok) throw new Error(`内置字体读取失败（HTTP ${response.status}）。`);
        return response.blob();
      })
      .then((blob) => readFileAsDataURL(blob))
      .catch((error) => {
        bundledFontPromise = null;
        throw new Error(`无法为 SVG 嵌入内置字体：${error.message} 请通过本地服务器运行，而不是直接打开 file:// 页面。`);
      });
  }
  return bundledFontPromise;
}

function loadBrowserImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片解码失败；元素数据未被删除，可替换图片后继续。"));
    image.src = src;
  });
}

async function ensureImagesLoaded(targetScene = scene) {
  const successful = new Map();
  for (const element of targetScene.elements.filter((entry) => entry.type === "image" && entry.src)) {
    const cached = imageMap.get(element.id) || imageMap.get(element.src);
    if (cached) {
      successful.set(element.id, cached);
      imageMap.set(element.id, cached);
      continue;
    }
    try {
      const image = await loadBrowserImage(element.src);
      imageMap.set(element.id, image);
      imageMap.set(element.src, image);
      failedImages.delete(element.id);
      successful.set(element.id, image);
    } catch (error) {
      failedImages.add(element.id);
      toast(`「${element.name}」${error.message}`, "error", 5000);
    }
  }
  return successful;
}

async function registerFontAsset(asset) {
  if (!asset?.family || !asset?.data) throw new Error("字体记录缺少 family 或 data，无法恢复。");
  if ([...document.fonts].some((font) => font.family.replaceAll('"', "") === asset.family)) return;
  const face = new FontFace(asset.family, `url("${asset.data}")`);
  await face.load();
  document.fonts.add(face);
}

async function registerSceneAssets(targetScene) {
  for (const font of targetScene.assets?.fonts ?? []) {
    try {
      await registerFontAsset(font);
    } catch (error) {
      toast(`字体「${font.name || font.family}」恢复失败：${error.message}`, "warn", 5000);
    }
  }
  await ensureImagesLoaded(targetScene);
}

function addTextLayer(text = "新字幕后，双击左侧主字幕可继续编辑") {
  const element = createTextElement(scene, { text });
  scene.elements.push(element);
  selectedId = element.id;
  touchAndCommit();
  toast("已添加文字图层，可在右侧修改内容和动效。");
}

function addRectLayer() {
  const element = createShapeElement(scene, "rect");
  scene.elements.push(element);
  selectedId = element.id;
  touchAndCommit();
  toast("已添加矩形图层，可编辑填充、描边和圆角。");
}

async function handleImageFile(file) {
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) {
    toast("图片超过 8MB。请压缩后重试；当前项目与其他素材不会被清除。", "error", 5000);
    return;
  }
  try {
    const data = await readFileAsDataURL(file);
    const image = await loadBrowserImage(data);
    const replacing = imageTargetId
      ? scene.elements.find((element) => element.id === imageTargetId && element.type === "image")
      : null;
    if (replacing) {
      replacing.src = data;
      replacing.name = file.name.replace(/\.[^.]+$/, "") || replacing.name;
      imageMap.set(replacing.id, image);
      imageMap.set(data, image);
      const validationAfter = validateScene(scene, measurer);
      selectedId = replacing.id;
      touchAndCommit();
      if (!validationAfter.ok) {
        toast("图片已替换，但当前图层越过安全区。请按检查提示缩放或移动。", "warn", 5000);
      } else {
        toast("图片已替换，编辑参数已保留。");
      }
      imageTargetId = null;
      return;
    }

    const safe = getSafeRect(scene);
    const safeWidth = safe.right - safe.left;
    const safeHeight = safe.bottom - safe.top;
    let width = Math.min(safeWidth * 0.48, 560);
    let height = width * (image.height / image.width);
    if (height > safeHeight * 0.55) {
      height = safeHeight * 0.55;
      width = height * (image.width / image.height);
    }
    const element = {
      id: crypto.randomUUID?.() ?? `image-${Date.now()}`,
      type: "image",
      name: file.name.replace(/\.[^.]+$/, "").slice(0, 60) || "导入图片",
      src: data,
      x: round(safe.left + (safeWidth - width) / 2),
      y: round(safe.top + (safeHeight - height) / 2),
      w: round(width),
      h: round(height),
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      entrance: {
        preset: "fade",
        duration: 620,
        delay: 0,
        easing: "easeOutCubic",
        keyframes: ENTRANCE_PRESETS.fade.keyframes.map((frame) => ({ ...frame }))
      },
      style: { fit: "cover", radius: 10 }
    };
    scene.assets.images.push({ id: element.id, name: element.name, type: file.type, size: file.size });
    scene.elements.push(element);
    selectedId = element.id;
    imageMap.set(element.id, image);
    imageMap.set(data, image);
    touchAndCommit();
    toast("图片已嵌入项目，可移动、缩放，并会随模板 JSON 恢复。");
  } catch (error) {
    toast(error.message, "error", 5000);
  }
}

async function handleFontFile(file) {
  if (!file) return;
  if (file.size > 24 * 1024 * 1024) {
    toast("字体文件超过 24MB。请使用 WOFF2 压缩版本；原有字体设置不会丢失。", "error", 5000);
    return;
  }
  try {
    const data = await readFileAsDataURL(file);
    const baseName = file.name.replace(/\.[^.]+$/, "").replace(/[^\p{L}\p{N}_-]+/gu, " ").trim() || "Custom Font";
    const family = `${baseName} ${scene.assets.fonts.length + 1}`;
    const extension = file.name.split(".").pop().toLowerCase();
    const asset = { name: baseName, family, data, type: extension };
    await registerFontAsset(asset);
    scene.assets.fonts.push(asset);
    const target = primaryTextElement();
    if (target) target.style.fontFamily = `"${family}", "Noto Sans SC", sans-serif`;
    touchAndCommit();
    toast(`字体「${baseName}」已嵌入并应用到当前文字，重新载入后会恢复。`);
  } catch (error) {
    toast(`字体导入失败：${error.message}。可尝试 WOFF2 或 TTF 格式。`, "error", 5000);
  }
}

function handleNearSelected(point) {
  const element = selectedElement();
  if (!element || element.locked || Math.abs(Number(element.rotation) || 0) > 0.01) return null;
  const handles = elementHandlePoints(element);
  const threshold = 10 / Math.max(0.01, renderer.displayScale);
  for (const [name, handle] of Object.entries(handles)) {
    if (Math.hypot(point.x - handle.x, point.y - handle.y) <= threshold) return name;
  }
  return null;
}

function updateLiveGeometryFields() {
  const element = selectedElement();
  if (!element) return;
  for (const field of ["x", "y", "w", "h", "rotation"]) {
    const input = dom.elementInspector.querySelector(`[data-field="${field}"]`);
    if (input && document.activeElement !== input) input.value = String(round(element[field], 1));
  }
}

function handlePointerDown(event) {
  if (event.button !== 0) return;
  const point = renderer.scenePointFromEvent(event, scene);
  pausePlayback(false);
  scene.playheadMs = scene.timelineMs;
  syncTransport();
  const handle = handleNearSelected(point);
  const selected = selectedElement();

  if (handle && selected) {
    dragState = {
      mode: "resize",
      handle,
      startPoint: point,
      startElement: deepClone(selected),
      moved: false
    };
    dom.stage.setPointerCapture(event.pointerId);
    return;
  }

  const hit = hitTestScene(scene, point);
  if (!hit) {
    selectedId = null;
    syncSelectionPanel();
    syncLayerList();
    requestRender();
    return;
  }
  selectElement(hit.id);
  if (hit.locked) {
    toast(`「${hit.name}」已锁定。请在右侧取消锁定后再移动。`, "warn");
    return;
  }
  dragState = {
    mode: "move",
    startPoint: point,
    startElement: deepClone(hit),
    moved: false
  };
  dom.stage.classList.add("is-editing");
  dom.stage.setPointerCapture(event.pointerId);
}

function resizeFromDrag(element, start, point, handle) {
  const minSize = Math.max(8, scene.width * 0.012);
  const dx = point.x - dragState.startPoint.x;
  const dy = point.y - dragState.startPoint.y;
  const right = start.x + start.w;
  const bottom = start.y + start.h;

  if (handle.includes("e")) {
    element.w = Math.max(minSize, start.w + dx);
  }
  if (handle.includes("s")) {
    element.h = Math.max(minSize, start.h + dy);
  }
  if (handle.includes("w")) {
    const x = Math.min(start.x + dx, right - minSize);
    element.x = x;
    element.w = right - x;
  }
  if (handle.includes("n")) {
    const y = Math.min(start.y + dy, bottom - minSize);
    element.y = y;
    element.h = bottom - y;
  }
  element.x = round(element.x, 1);
  element.y = round(element.y, 1);
  element.w = round(element.w, 1);
  element.h = round(element.h, 1);
}

function handlePointerMove(event) {
  if (!dragState) return;
  const point = renderer.scenePointFromEvent(event, scene);
  const element = selectedElement();
  if (!element) return;
  const dx = point.x - dragState.startPoint.x;
  const dy = point.y - dragState.startPoint.y;
  if (!dragState.moved && Math.hypot(dx, dy) < 1.5) return;
  dragState.moved = true;
  if (dragState.mode === "move") {
    element.x = round(dragState.startElement.x + dx, 1);
    element.y = round(dragState.startElement.y + dy, 1);
  } else {
    resizeFromDrag(element, dragState.startElement, point, dragState.handle);
  }
  setDirty(true);
  updateLiveGeometryFields();
  syncValidation();
  requestRender();
}

function endPointerDrag(event) {
  if (!dragState) return;
  const moved = dragState.moved;
  dragState = null;
  dom.stage.classList.remove("is-editing");
  if (dom.stage.hasPointerCapture?.(event.pointerId)) dom.stage.releasePointerCapture(event.pointerId);
  if (moved) {
    touchAndCommit();
    const selected = selectedElement();
    if (selected) {
      const result = validateScene(scene, measurer);
      toast(
        result.ok
          ? `「${selected.name}」仍在安全区内。`
          : `「${selected.name}」越界或文字溢出，已标红并阻止导出。请按右侧建议修复。`,
        result.ok ? "info" : "warn",
        result.ok ? 2000 : 5000
      );
    }
  } else {
    requestRender();
  }
}

function handleCanvasDoubleClick(event) {
  const point = renderer.scenePointFromEvent(event, scene);
  const hit = hitTestScene(scene, point);
  if (!hit || hit.type !== "text") return;
  selectElement(hit.id);
  requestAnimationFrame(() => {
    const textarea = dom.elementInspector.querySelector('[data-field="text"]');
    if (textarea) {
      textarea.focus();
      textarea.select();
    }
  });
}

function handleKeyDown(event) {
  const tag = event.target.tagName;
  const editing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || event.target.isContentEditable;
  const meta = event.metaKey || event.ctrlKey;
  if (meta && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) redo(); else undo();
    return;
  }
  if (meta && event.key.toLowerCase() === "y") {
    event.preventDefault();
    redo();
    return;
  }
  if (meta && event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveProject();
    return;
  }
  if (editing) return;
  const element = selectedElement();
  if ((event.key === "Delete" || event.key === "Backspace") && element) {
    event.preventDefault();
    deleteSelectedElement();
    return;
  }
  if (event.key === " ") {
    event.preventDefault();
    togglePlayback();
    return;
  }
  if (event.key === "Escape") {
    selectedId = null;
    syncUI();
    closeExportMenu();
    return;
  }
  if (element && !element.locked && event.key.startsWith("Arrow")) {
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    if (event.key === "ArrowLeft") element.x -= step;
    if (event.key === "ArrowRight") element.x += step;
    if (event.key === "ArrowUp") element.y -= step;
    if (event.key === "ArrowDown") element.y += step;
    touchAndCommit();
  }
}

function pulseBeat() {
  dom.beatDot.classList.remove("is-pulsing");
  void dom.beatDot.offsetWidth;
  dom.beatDot.classList.add("is-pulsing");
}

function pausePlayback(sync = true) {
  playing = false;
  if (animationFrame) cancelAnimationFrame(animationFrame);
  animationFrame = null;
  if (sync) {
    syncTransport();
    requestRender();
  }
}

function playbackTick(now) {
  if (!playing) return;
  const delta = Math.min(80, now - lastPlaybackTime);
  lastPlaybackTime = now;
  scene.playheadMs = clamp(scene.playheadMs + delta, 0, scene.timelineMs);
  if (scene.playheadMs >= scene.timelineMs) {
    scene.playheadMs = scene.timelineMs;
    playing = false;
    animationFrame = null;
  } else {
    animationFrame = requestAnimationFrame(playbackTick);
  }
  syncTransport();
  renderStage();
}

function togglePlayback() {
  if (playing) {
    pausePlayback();
    return;
  }
  if (scene.playheadMs >= scene.timelineMs - 1) scene.playheadMs = 0;
  playing = true;
  lastPlaybackTime = performance.now();
  animationFrame = requestAnimationFrame(playbackTick);
  syncTransport();
  requestRender();
}

async function toggleBeat() {
  if (beatEngine.running) {
    beatEngine.stop();
    dom.beatBtn.classList.remove("is-on");
    dom.audioState.textContent = "音频已暂停";
    return;
  }
  try {
    await beatEngine.start(scene.bpm);
    dom.beatBtn.classList.add("is-on");
    dom.audioState.textContent = `Web Audio · ${scene.bpm} BPM`;
    toast("Web Audio 节拍已启动。再次点击可暂停。", "info", 2000);
  } catch (error) {
    dom.audioState.textContent = "音频不可用";
    toast(`${error.message} 请使用支持 Web Audio 的现代浏览器。`, "error", 5000);
  }
}

function handleTimelineInput() {
  pausePlayback(false);
  scene.playheadMs = clamp(Number(dom.timelineInput.value), 0, scene.timelineMs);
  syncTransport();
  requestRender();
}

function handleTimelineChange() {
  handleTimelineInput();
  touch(scene);
  history.commit(scene);
  setDirty(true);
  dom.undoBtn.disabled = !history.canUndo();
  dom.redoBtn.disabled = !history.canRedo();
}

function moveExportMenu(open) {
  dom.exportMenu.hidden = !open;
  dom.exportBtn.setAttribute("aria-expanded", String(open));
}

function closeExportMenu() {
  moveExportMenu(false);
}

function issueListMarkup(issues) {
  return issues.map((item) => `<li><strong>${escapeHtml(item.elementName)}</strong>：${escapeHtml(item.message)} ${escapeHtml(item.fix)}</li>`).join("");
}

function showValidationDialog(kind, issues, summary) {
  pendingExport = kind;
  dom.validationDialog.querySelector("h2").textContent = kind ? "导出前需要修复" : "边界案例需要处理";
  dom.dialogSummary.textContent = summary || "当前参数存在安全区或裁切问题。未生成文件，文本与素材均保留。";
  dom.dialogIssues.innerHTML = issueListMarkup(issues.slice(0, 8));
  dom.autoFixBtn.textContent = kind ? "自动适配并导出" : "尝试自动适配";
  if (!dom.validationDialog.open) dom.validationDialog.showModal();
}

function sanityCheckExport(kind) {
  const result = validateScene(scene, measurer);
  const missingImages = scene.elements
    .filter((element) => element.visible && element.type === "image" && failedImages.has(element.id))
    .map((element) => ({
      severity: "error",
      elementName: element.name,
      message: `图片「${element.name}」无法解码，无法生成一致的当前帧。`,
      fix: "重新导入图片或替换该图层；文字与其他参数不会丢失。"
    }));
  return {
    ...result,
    ok: result.ok && missingImages.length === 0,
    errors: [...result.errors, ...missingImages]
  };
}

function verifySvgOutput(svg) {
  const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (parsed.querySelector("parsererror")) throw new Error("SVG 结构校验失败，未下载文件。请反馈当前模板参数。");
  const groups = parsed.querySelectorAll("g[data-layer-id]");
  const visibleCount = scene.elements.filter((element) => element.visible).length;
  if (groups.length !== visibleCount) {
    throw new Error(`SVG 图层数量不一致（${groups.length}/${visibleCount}），已停止导出以避免静默丢失。`);
  }
  return true;
}

async function performExport(kind) {
  closeExportMenu();
  if (kind === "json") {
    const json = exportProjectJSON(scene);
    downloadBlob(new Blob([json], { type: "application/json;charset=utf-8" }), safeFilename(scene.name, "json"));
    toast("模板 JSON 已导出，包含字体、图片、关键帧和当前帧参数。");
    return;
  }

  await document.fonts.ready;
  await ensureImagesLoaded();
  const result = sanityCheckExport(kind);
  if (!result.ok) {
    showValidationDialog(kind, result.errors, "检测到文字裁切、安全区越界或图片缺失。未生成文件，完整文本与素材仍在项目中。");
    return;
  }
  try {
    if (kind === "png") {
      const blob = await renderPNG(scene, imageMap, scene.playheadMs);
      downloadBlob(blob, safeFilename(`${scene.name}-${Math.round(scene.playheadMs)}ms`, "png"));
      toast("当前帧 PNG 已从场景模型直接绘制，预览参数与时间点均已保留。");
    } else if (kind === "svg") {
      const bundledFontData = await getBundledFontData();
      const svg = buildSVG(scene, { measurer, timeMs: scene.playheadMs, bundledFontData });
      verifySvgOutput(svg);
      downloadBlob(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), safeFilename(`${scene.name}-${Math.round(scene.playheadMs)}ms`, "svg"));
      toast("当前帧 SVG 已导出；文字与图形是原生可编辑节点，不是截图烧录。");
    }
  } catch (error) {
    toast(error.message, "error", 6000);
  }
}

async function autoFixAndContinue() {
  const fixed = autoFixScene(scene, measurer);
  history.commit(scene);
  setDirty(true);
  await ensureImagesLoaded();
  const result = sanityCheckExport(pendingExport);
  syncUI();
  if (result.ok) {
    const kind = pendingExport;
    pendingExport = null;
    dom.validationDialog.close();
    if (fixed.notes.length) toast(fixed.notes.join(" "), "warn", 6000);
    else toast("已将所有可见图层移入安全区。");
    if (kind) await performExport(kind);
  } else {
    showValidationDialog(pendingExport, result.errors, "自动适配后仍存在无法消除的问题。未导出文件，文字未被删除；请增大画布、减少文字或拆分图层。");
  }
}

async function saveProject() {
  const revision = scene.updatedAt;
  const payload = {
    kind: "framework-subtitle-project",
    savedAt: new Date().toISOString(),
    selectedId,
    ui: {
      showSafe: dom.safeToggle.checked,
      showGuides: dom.gridToggle.checked
    },
    scene
  };
  try {
    await writeProjectRecord(payload);
    if (scene.updatedAt === revision) setDirty(false);
    toast(scene.updatedAt === revision
      ? "项目已保存到本机浏览器（IndexedDB）。文字、字体、图片和关键帧均可重新载入。"
      : "保存完成，但保存期间产生了新编辑；仍有未保存更改。", scene.updatedAt === revision ? "info" : "warn");
  } catch (error) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      if (scene.updatedAt === revision) setDirty(false);
      toast("IndexedDB 不可用，已回退保存到 localStorage。大字体/图片可能受浏览器配额限制。", "warn", 5000);
      return;
    } catch (fallbackError) {
      setDirty(true);
      const quota = fallbackError?.name === "QuotaExceededError";
      toast(
        quota
          ? "保存空间不足。请先导出模板 JSON 到文件，再精简内嵌图片/字体。当前编辑内容仍在页面中。"
          : `保存失败：${error.message}。请改用“导出 → 模板 JSON”保存到文件。`,
        "error",
        6500
      );
      return;
    }
  }
}

async function applyProject(nextScene, options = {}) {
  pausePlayback(false);
  scene = nextScene;
  selectedId = options.selectedId && scene.elements.some((element) => element.id === options.selectedId)
    ? options.selectedId
    : null;
  imageMap.clear();
  failedImages.clear();
  if (options.mode === "commit") history.commit(scene);
  else if (options.mode !== "history") history = new History(scene);
  if (options.ui) {
    dom.safeToggle.checked = options.ui.showSafe !== false;
    dom.gridToggle.checked = Boolean(options.ui.showGuides);
  }
  setDirty(options.dirty !== false);
  await registerSceneAssets(scene);
  await document.fonts.ready;
  requestAnimationFrame(() => {
    renderer.fit(scene, dom.stageShell);
    syncUI();
  });
}

async function reloadSavedProject(announce = true) {
  let payload = null;
  try {
    payload = await readProjectRecord();
  } catch {
    payload = null;
  }
  if (!payload) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) payload = JSON.parse(raw);
    } catch {
      payload = null;
    }
  }
  if (!payload) {
    if (announce) toast("没有找到已保存项目。请先点击“保存”，或导入模板 JSON。", "warn");
    return false;
  }
  try {
    const next = parseProjectJSON(JSON.stringify(payload));
    await applyProject(next, {
      mode: "reset",
      selectedId: payload.selectedId,
      ui: payload.ui,
      dirty: false
    });
    if (announce) toast("已重新载入上次保存版本，字体、图片与关键帧已恢复。");
    return true;
  } catch (error) {
    toast(`重新载入失败：${error.message}`, "error", 6000);
    return false;
  }
}

async function importProjectFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const next = parseProjectJSON(text);
    await applyProject(next, { mode: "reset", dirty: true });
    toast("模板 JSON 已导入。所有文本、图形、字体、图片与关键帧均已恢复。");
  } catch (error) {
    toast(`导入失败：${error.message}`, "error", 7000);
  }
}

async function undo() {
  if (dirty) history.commit(scene);
  const previous = history.undo();
  if (!previous) {
    toast("没有可撤销的操作。", "info", 1800);
    return;
  }
  await applyProject(previous, {
    mode: "history",
    selectedId,
    dirty: true
  });
  toast("已撤销上一步。", "info", 1500);
}

async function redo() {
  const next = history.redo();
  if (!next) {
    toast("没有可重做的操作。", "info", 1800);
    return;
  }
  await applyProject(next, {
    mode: "history",
    selectedId,
    dirty: true
  });
  toast("已重做。", "info", 1500);
}

async function loadDefaultCase() {
  const next = createScene({ copy: DEFAULT_COPY, name: "默认案例 · 新闻字幕" });
  await applyProject(next, { mode: "commit", dirty: true });
  toast("已载入默认案例：1280×720，文字与图层均在安全区内。");
}

async function loadEdgeCase() {
  const next = createScene({
    copy: EDGE_COPY,
    width: 320,
    height: 180,
    safeMargin: 24,
    name: "边界案例 · 超长文本与极小画布"
  });
  await applyProject(next, { mode: "commit", dirty: true });
  const result = syncValidation();
  toast("边界案例已载入。文字未被删除，红色描边与问题列表指出裁切原因。", "warn", 6000);
  if (!result.ok) {
    showValidationDialog(null, result.errors, "这是故意构造的边界案例：320×180 画布装不下超长文本。未生成文件，文本仍完整保留。可尝试自动适配，或按建议增大画布/拆分图层。");
  }
}

function switchTemplate(templateId) {
  if (templateId === scene.template || !TEMPLATE_META[templateId]) return;
  const contentBefore = Object.fromEntries(
    scene.elements.filter((element) => element.type === "text").map((element) => [element.id, element.text])
  );
  applyTemplate(scene, templateId);
  scene.playheadMs = scene.timelineMs;
  const textIntact = Object.entries(contentBefore).every(([id, text]) => {
    const element = scene.elements.find((entry) => entry.id === id);
    return !element || element.text === text;
  });
  if (!textIntact) {
    toast("模板切换检测到文本变化，已停止操作。请导出 JSON 反馈该问题。", "error", 6000);
    return;
  }
  touchAndCommit();
  toast(`已切换为「${TEMPLATE_META[templateId].label}」模板，正文和上标完整保留。`);
}

function setCanvasSize(width, height) {
  resizeScene(scene, width, height);
  renderer.fit(scene, dom.stageShell);
  touchAndCommit();
}

function handleHeadlineInput() {
  const headline = scene.elements.find((element) => element.id === "headline");
  if (!headline) return;
  headline.text = dom.headlineInput.value;
  touch(scene);
  setDirty(true);
  syncValidation();
  requestRender();
}

function handleKickerInput() {
  const kicker = scene.elements.find((element) => element.id === "kicker");
  if (!kicker) return;
  kicker.text = dom.kickerInput.value;
  touch(scene);
  setDirty(true);
  syncValidation();
  requestRender();
}

function handleFontSizeInput() {
  const target = primaryTextElement();
  if (!target) return;
  target.style.fontSize = clamp(Number(dom.fontSizeInput.value), MIN_FONT_SIZE, 240);
  dom.fontSizeValue.textContent = String(round(target.style.fontSize, 1));
  const percent = ((clamp(Number(dom.fontSizeInput.value), 14, 120) - 14) / 106) * 100;
  dom.fontSizeInput.style.background = `linear-gradient(90deg, var(--accent) 0 ${percent}%, #2a3342 ${percent}% 100%)`;
  touch(scene);
  setDirty(true);
  syncValidation();
  requestRender();
}

function handleBackgroundInput() {
  const selected = selectedElement();
  const target = selected?.type === "shape"
    ? selected
    : selected?.type === "text"
      ? selected
      : primaryTextElement();
  if (!target) return;
  if (target.type === "shape") target.style.fill = dom.backgroundInput.value;
  else target.style.background = dom.backgroundInput.value;
  touch(scene);
  setDirty(true);
  syncValidation();
  requestRender();
}

function handleAnimationInput() {
  const selected = selectedElement();
  const targets = selected ? [selected] : scene.elements;
  targets.forEach((element) => setEntrancePreset(element, dom.animationInput.value));
  scene.playheadMs = Math.min(scene.playheadMs, scene.timelineMs);
  touch(scene);
  setDirty(true);
  syncValidation();
  requestRender();
}

function bindEvents() {
  dom.undoBtn.addEventListener("click", () => undo());
  dom.redoBtn.addEventListener("click", () => redo());
  dom.saveBtn.addEventListener("click", saveProject);
  dom.reloadBtn.addEventListener("click", () => {
    if (dirty && !window.confirm("当前有未保存更改。仍然重新载入上次保存版本吗？")) return;
    reloadSavedProject(true);
  });
  dom.importBtn.addEventListener("click", () => dom.projectFileInput.click());
  dom.projectFileInput.addEventListener("change", async () => {
    await importProjectFile(dom.projectFileInput.files?.[0]);
    dom.projectFileInput.value = "";
  });
  dom.exportBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    moveExportMenu(dom.exportMenu.hidden);
  });
  dom.exportMenu.addEventListener("click", (event) => {
    const button = event.target.closest("[data-export]");
    if (button) performExport(button.dataset.export);
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".export-wrap")) closeExportMenu();
  });

  dom.templateList.addEventListener("click", (event) => {
    const card = event.target.closest("[data-template]");
    if (card) switchTemplate(card.dataset.template);
  });
  dom.projectName.addEventListener("input", () => {
    scene.name = dom.projectName.value.slice(0, 60);
    touch(scene);
    setDirty(true);
  });
  dom.projectName.addEventListener("change", () => touchAndCommit());
  dom.headlineInput.addEventListener("input", handleHeadlineInput);
  dom.headlineInput.addEventListener("change", handleHeadlineInput);
  dom.headlineInput.addEventListener("change", touchAndCommit);
  dom.kickerInput.addEventListener("input", handleKickerInput);
  dom.kickerInput.addEventListener("change", handleKickerInput);
  dom.kickerInput.addEventListener("change", touchAndCommit);
  dom.fontSizeInput.addEventListener("input", handleFontSizeInput);
  dom.fontSizeInput.addEventListener("change", handleFontSizeInput);
  dom.fontSizeInput.addEventListener("change", touchAndCommit);
  dom.backgroundInput.addEventListener("input", handleBackgroundInput);
  dom.backgroundInput.addEventListener("change", handleBackgroundInput);
  dom.backgroundInput.addEventListener("change", touchAndCommit);
  dom.animationInput.addEventListener("change", () => {
    handleAnimationInput();
    touchAndCommit();
  });
  dom.defaultCaseBtn.addEventListener("click", () => {
    if (dom.validationDialog.open) dom.validationDialog.close();
    loadDefaultCase();
  });
  dom.edgeCaseBtn.addEventListener("click", () => {
    if (dom.validationDialog.open) dom.validationDialog.close();
    loadEdgeCase();
  });

  dom.elementInspector.addEventListener("input", handleInspectorInput);
  dom.elementInspector.addEventListener("change", handleInspectorChange);
  dom.elementInspector.addEventListener("click", handleInspectorClick);
  dom.layerList.addEventListener("click", handleLayerClick);
  dom.addTextBtn.addEventListener("click", () => addTextLayer());
  dom.addShapeBtn.addEventListener("click", addRectLayer);
  dom.addImageBtn.addEventListener("click", () => {
    imageTargetId = null;
    dom.imageFileInput.click();
  });
  dom.addFontBtn.addEventListener("click", () => dom.fontFileInput.click());
  dom.imageFileInput.addEventListener("change", async () => {
    await handleImageFile(dom.imageFileInput.files?.[0]);
    dom.imageFileInput.value = "";
  });
  dom.fontFileInput.addEventListener("change", async () => {
    await handleFontFile(dom.fontFileInput.files?.[0]);
    dom.fontFileInput.value = "";
  });

  dom.stage.addEventListener("pointerdown", handlePointerDown);
  dom.stage.addEventListener("pointermove", handlePointerMove);
  dom.stage.addEventListener("pointerup", endPointerDrag);
  dom.stage.addEventListener("pointercancel", endPointerDrag);
  dom.stage.addEventListener("dblclick", handleCanvasDoubleClick);
  dom.safeToggle.addEventListener("change", requestRender);
  dom.gridToggle.addEventListener("change", requestRender);
  dom.playBtn.addEventListener("click", togglePlayback);
  dom.beatBtn.addEventListener("click", toggleBeat);
  dom.timelineInput.addEventListener("input", handleTimelineInput);
  dom.timelineInput.addEventListener("change", handleTimelineChange);
  dom.bpmInput.addEventListener("input", () => {
    scene.bpm = clamp(Number(dom.bpmInput.value), 40, 220);
    beatEngine.setBpm(scene.bpm);
    if (beatEngine.running) dom.audioState.textContent = `Web Audio · ${scene.bpm} BPM`;
    touch(scene);
    setDirty(true);
  });
  dom.bpmInput.addEventListener("change", () => touchAndCommit());

  dom.canvasWidth.addEventListener("change", () => {
    setCanvasSize(dom.canvasWidth.value, scene.height);
  });
  dom.canvasHeight.addEventListener("change", () => {
    setCanvasSize(scene.width, dom.canvasHeight.value);
  });
  dom.canvasColor.addEventListener("input", () => {
    scene.background.from = dom.canvasColor.value;
    touch(scene);
    setDirty(true);
    requestRender();
  });
  dom.canvasColor.addEventListener("change", () => touchAndCommit());
  dom.safeMarginInput.addEventListener("input", () => {
    scene.safeMargin = clamp(Number(dom.safeMarginInput.value), 0, Math.min(scene.width, scene.height) / 3);
    touch(scene);
    setDirty(true);
    syncValidation();
    requestRender();
  });
  dom.safeMarginInput.addEventListener("change", () => touchAndCommit());
  $$("[data-size]").forEach((button) => {
    button.addEventListener("click", () => {
      const [width, height] = button.dataset.size.split("x").map(Number);
      setCanvasSize(width, height);
    });
  });
  dom.validateBtn.addEventListener("click", () => {
    const result = syncValidation();
    toast(result.ok ? "复核完成：安全区与文字裁切检查通过。" : `复核完成：发现 ${result.errors.length} 项问题，详见检查列表。`, result.ok ? "info" : "warn");
  });
  dom.autoFixBtn.addEventListener("click", autoFixAndContinue);
  dom.validationDialog.addEventListener("close", () => {
    pendingExport = null;
  });
  window.addEventListener("keydown", handleKeyDown);

  const resizeObserver = new ResizeObserver(() => {
    if (!scene) return;
    renderer.fit(scene, dom.stageShell);
    requestRender();
  });
  resizeObserver.observe(dom.stageShell);
}

async function boot() {
  bindEvents();
  let restored = false;
  try {
    restored = await reloadSavedProject(false);
  } catch (error) {
    toast(`上次保存版本无法恢复：${error.message}`, "warn", 5000);
  }
  if (!restored) {
    scene = createScene();
    history = new History(scene);
    selectedId = null;
    setDirty(true);
    await registerSceneAssets(scene);
    requestAnimationFrame(() => {
      renderer.fit(scene, dom.stageShell);
      syncUI();
    });
  }
  document.fonts.ready.then(() => requestRender());
}

window.__FRAMEWORK__ = {
  getScene: () => deepClone(scene),
  validate: () => validateScene(scene, measurer),
  getHistoryState: () => ({ canUndo: history.canUndo(), canRedo: history.canRedo() })
};

boot();








