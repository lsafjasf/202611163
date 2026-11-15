import {
  STORAGE_KEYS,
  clone,
  createScenario,
  sanitizeDocument,
  uid,
} from "./model.js";
import {
  getMeasurementContext,
  measureLayout,
  pointInShape,
  shapeBounds,
} from "./layout.js";
import {
  documentToSvg,
  loadImage,
  preloadDocumentImages,
  renderDocument,
  renderExportCanvas,
} from "./renderer.js";
import { validateLayout } from "./validation.js";
import { canvasToPngBlob, downloadBlob, safeFilename } from "./export.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  doc: null,
  layout: null,
  validation: null,
  selectedShapeId: null,
  selectedParagraphIndex: null,
  zoom: 1,
  zoomMode: "fit",
  dirty: false,
  undo: [],
  redo: [],
  drag: null,
  pendingExport: null,
  imageSignature: "",
};

const elements = {
  canvas: $("#editor-canvas"),
  scroll: $("#canvas-scroll"),
  canvasWrap: $("#canvas-wrap"),
  docName: $("#doc-name"),
  saveState: $("#save-state"),
  bodyText: $("#body-text"),
  paragraphList: $("#paragraph-list"),
  flowOrder: $("#flow-order"),
  layoutSummary: $("#layout-summary"),
  issueList: $("#issue-list"),
  issueCount: $("#issue-count"),
  healthCard: $("#health-card"),
  objectForm: $("#object-form"),
  noSelection: $("#no-selection"),
  undoBtn: $("#undo-btn"),
  redoBtn: $("#redo-btn"),
  exportDialog: $("#export-dialog"),
  exportDialogTitle: $("#export-dialog-title"),
  exportDialogBody: $("#export-dialog-body"),
  exportConfirm: $("#export-confirm-btn"),
  libraryDialog: $("#library-dialog"),
};

function readStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn("无法读取本地存储", error);
    return null;
  }
}

function writeStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function toast(message, kind = "info", duration = 3800) {
  const node = document.createElement("div");
  node.className = `toast ${kind}`;
  node.textContent = message;
  $("#toast-region").append(node);
  setTimeout(() => node.remove(), duration);
}

function markDirty() {
  state.dirty = true;
  elements.saveState.textContent = "未保存";
  elements.saveState.classList.add("dirty");
  updateHistoryButtons();
}

function markSaved() {
  state.dirty = false;
  elements.saveState.textContent = "已保存到本机";
  elements.saveState.classList.remove("dirty");
}

function updateHistoryButtons() {
  elements.undoBtn.disabled = state.undo.length === 0;
  elements.redoBtn.disabled = state.redo.length === 0;
}

function pushHistory(before) {
  if (!before) return;
  state.undo.push(before);
  if (state.undo.length > 80) state.undo.shift();
  state.redo = [];
  markDirty();
}

function undo() {
  if (!state.undo.length) return;
  const current = clone(state.doc);
  state.doc = sanitizeDocument(state.undo.pop());
  state.redo.push(current);
  state.selectedShapeId = null;
  state.selectedParagraphIndex = null;
  markDirty();
  recompute(true);
  updateHistoryButtons();
}

function redo() {
  if (!state.redo.length) return;
  const current = clone(state.doc);
  state.doc = sanitizeDocument(state.redo.pop());
  state.undo.push(current);
  state.selectedShapeId = null;
  state.selectedParagraphIndex = null;
  markDirty();
  recompute(true);
  updateHistoryButtons();
}

function loadDocument(documentValue, options = {}) {
  state.doc = sanitizeDocument(clone(documentValue));
  state.selectedShapeId = null;
  state.selectedParagraphIndex = null;
  if (options.view) {
    state.zoom = Math.min(2.5, Math.max(0.15, Number(options.view.zoom) || 1));
    state.zoomMode = options.view.zoomMode === "manual" ? "manual" : "fit";
  }
  recompute(true, { fit: state.zoomMode === "fit" });
  if (options.scroll) {
    requestAnimationFrame(() => {
      elements.scroll.scrollLeft = options.scroll.left || 0;
      elements.scroll.scrollTop = options.scroll.top || 0;
    });
  }
}

function scheduleImageLoads() {
  const signature = state.doc.shapes
    .filter((shape) => shape.type === "image")
    .map((shape) => `${shape.id}:${shape.src.length}:${shape.src.slice(-24)}`)
    .join("|");
  if (signature === state.imageSignature) return;
  state.imageSignature = signature;
  preloadDocumentImages(state.doc).then(() => renderCanvas());
}

function recompute(updatePanels = true, options = {}) {
  state.layout = measureLayout(state.doc);
  state.validation = validateLayout(state.doc, state.layout);
  if (options.fit || state.zoomMode === "fit") fitCanvas();
  renderCanvas();
  scheduleImageLoads();
  updateSummary();
  if (updatePanels) updateAllUI();
}

function fitCanvas() {
  const availableWidth = Math.max(240, elements.scroll.clientWidth - 76);
  const availableHeight = Math.max(180, elements.scroll.clientHeight - 76);
  const nextZoom = Math.min(
    1.15,
    availableWidth / state.doc.canvas.width,
    availableHeight / state.doc.canvas.height,
  );
  state.zoom = Math.max(0.12, Math.round(nextZoom * 100) / 100);
  state.zoomMode = "fit";
}

function renderCanvas() {
  if (!state.doc || !state.layout) return;
  renderDocument(elements.canvas, state.doc, state.layout, {
    zoom: state.zoom,
    selectedShapeId: state.selectedShapeId,
    selectedParagraphIndex: state.selectedParagraphIndex,
  });
  $("#zoom-fit-btn").textContent = `${Math.round(state.zoom * 100)}%`;
}

function updateSummary() {
  const stats = state.layout.stats;
  const counts = state.validation.counts;
  const zoom = `${Math.round(state.zoom * 100)}%`;
  elements.layoutSummary.textContent =
    `${stats.paragraphs} 段 · ${stats.lines} 行 · ${stats.placedCharacters}/${stats.characters} 字 · ` +
    `${stats.frames} 个绕排框 · ${zoom} · ${counts.error} 错误 / ${counts.warning} 提醒`;
}

function applyZoom(nextZoom) {
  state.zoom = Math.min(2.5, Math.max(0.12, nextZoom));
  state.zoomMode = "manual";
  renderCanvas();
  updateSummary();
}

function makeElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function shapeById(id) {
  return state.doc.shapes.find((shape) => shape.id === id) || null;
}

function setInputValue(input, value) {
  if (!input || document.activeElement === input) return;
  input.value = value;
}

function syncDocumentFields() {
  const doc = state.doc;
  setInputValue(elements.docName, doc.name);
  setInputValue(elements.bodyText, doc.content.text);
  setInputValue($("#kicker-input"), doc.content.kicker);
  setInputValue($("#title-input"), doc.content.title);
  setInputValue($("#subtitle-input"), doc.content.subtitle);
  setInputValue($("#footer-input"), doc.content.footer);
  setInputValue($("#canvas-w"), doc.canvas.width);
  setInputValue($("#canvas-h"), doc.canvas.height);
  setInputValue($("#canvas-margin"), doc.canvas.margin);
  setInputValue($("#canvas-bg"), doc.canvas.background);
  setInputValue($("#paragraph-spacing"), doc.paragraph.spacing);
  setInputValue($("#paragraph-indent"), doc.paragraph.indent);
  setInputValue($("#font-size"), doc.font.size);
  setInputValue($("#font-line-height"), doc.font.lineHeight);
  setInputValue($("#font-weight"), String(doc.font.weight));
  setInputValue($("#font-color"), doc.font.color);
  const familySelect = $("#font-family");
  if (![...familySelect.options].some((option) => option.value === doc.font.family)) {
    const option = document.createElement("option");
    option.value = doc.font.family;
    option.textContent = "导入项目字体（本机）";
    familySelect.append(option);
  }
  setInputValue(familySelect, doc.font.family);
  $("#case-select").value = doc.caseName || "default";
  $("#paragraph-count").textContent = `${state.layout?.stats.paragraphs || 0} 段`;
}

function renderParagraphList() {
  elements.paragraphList.replaceChildren();
  for (const paragraph of state.layout.paragraphs) {
    const card = makeElement(
      "div",
      `paragraph-card${paragraph.pinned ? " is-pinned" : ""}${
        paragraph.index === state.selectedParagraphIndex ? " is-selected" : ""
      }`,
    );
    card.dataset.paragraphIndex = paragraph.index;
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `第 ${paragraph.index + 1} 段`);
    const index = makeElement("span", "paragraph-index", String(paragraph.index + 1).padStart(2, "0"));
    const text = makeElement("p", "", paragraph.text);
    const pin = makeElement("button", "pin-btn", paragraph.pinned ? "解除固定" : "固定");
    pin.type = "button";
    pin.dataset.pinParagraph = paragraph.index;
    card.append(index, text, pin);
    elements.paragraphList.append(card);
  }
  if (!state.layout.paragraphs.length) {
    elements.paragraphList.append(makeElement("p", "empty-state", "正文为空。输入文字后将自动分栏。"));
  }
}

function renderFlowOrder() {
  elements.flowOrder.replaceChildren();
  const frames = state.layout.frames;
  if (!frames.length) {
    elements.flowOrder.append(makeElement("p", "empty-state", "没有启用的文字绕排框。"));
    return;
  }
  frames.forEach((shape, index) => {
    const row = makeElement("div", `flow-row${shape.id === state.selectedShapeId ? " is-selected" : ""}`);
    row.dataset.flowShape = shape.id;
    const number = makeElement("span", "paragraph-index", String(index + 1));
    const name = makeElement("span", "", `${shape.name} · ${Math.round(shape.w)}×${Math.round(shape.h)}`);
    const buttons = makeElement("div", "flow-order-buttons");
    const up = makeElement("button", "", "↑");
    up.type = "button";
    up.title = "提前绕排";
    up.dataset.flowMove = "-1";
    up.dataset.shapeId = shape.id;
    const down = makeElement("button", "", "↓");
    down.type = "button";
    down.title = "延后绕排";
    down.dataset.flowMove = "1";
    down.dataset.shapeId = shape.id;
    buttons.append(up, down);
    row.append(number, name, buttons);
    elements.flowOrder.append(row);
  });
}

function setObjectValue(selector, value) {
  const input = $(selector);
  if (input) setInputValue(input, value);
}

function updateObjectForm() {
  const shape = shapeById(state.selectedShapeId);
  elements.noSelection.hidden = Boolean(shape);
  elements.objectForm.hidden = !shape;
  $("#object-heading").textContent = shape ? shape.name : "对象";
  $("#object-kind").textContent = shape
    ? { rect: "矩形", rounded: "圆角矩形", ellipse: "椭圆", image: "图片" }[shape.type]
    : "未选择";
  if (!shape) return;
  setObjectValue("#shape-name", shape.name);
  const typeSelect = $("#shape-type");
  typeSelect.disabled = shape.type === "image";
  if (shape.type !== "image") setObjectValue("#shape-type", shape.type);
  setObjectValue("#shape-flow", String(shape.textFlow));
  setObjectValue("#shape-x", Math.round(shape.x * 10) / 10);
  setObjectValue("#shape-y", Math.round(shape.y * 10) / 10);
  setObjectValue("#shape-w", Math.round(shape.w * 10) / 10);
  setObjectValue("#shape-h", Math.round(shape.h * 10) / 10);
  setObjectValue("#shape-padding", shape.padding);
  setObjectValue("#shape-radius", shape.radius);
  setObjectValue("#shape-fill", shape.fill);
  setObjectValue("#shape-stroke", shape.stroke);
  setObjectValue("#shape-opacity", shape.opacity);
  $("#shape-locked").checked = shape.locked;
  $("#shape-opacity-value").textContent = `${Math.round(shape.opacity * 100)}%`;
  $("#image-controls").hidden = shape.type !== "image";
  if (shape.type === "image") $("#image-thumb").src = shape.src || "";
}

function renderIssues() {
  const { issues, counts, summary } = state.validation;
  elements.issueList.replaceChildren();
  const health = elements.healthCard;
  health.replaceChildren();
  const top = makeElement("div", "health-top");
  const dot = makeElement(
    "span",
    `health-dot${counts.error ? " has-errors" : counts.warning ? " has-warnings" : ""}`,
  );
  const textWrap = document.createElement("div");
  const label = makeElement(
    "strong",
    "",
    counts.error ? "导出被锁定" : counts.warning ? "可以导出，建议复查" : "检查通过",
  );
  const sub = makeElement("small", "", summary);
  textWrap.append(label, sub);
  top.append(dot, textWrap);
  health.append(top);
  const stats = makeElement("div", "health-stats");
  for (const [value, labelText] of [
    [counts.error, "错误"],
    [counts.warning, "提醒"],
    [state.layout.stats.overflowCharacters, "溢出字"],
  ]) {
    const item = makeElement("div", "health-stat");
    item.append(makeElement("b", "", String(value)), makeElement("span", "", labelText));
    stats.append(item);
  }
  health.append(stats);

  for (const item of issues) {
    const card = makeElement("article", `issue ${item.severity}`);
    card.dataset.issueShape = item.shapeId || "";
    card.dataset.issueParagraph = item.paragraphIndex ?? "";
    const head = makeElement("div", "issue-head");
    const severity = item.severity === "error" ? "错误" : item.severity === "warning" ? "提醒" : "信息";
    head.append(makeElement("strong", "", item.title), makeElement("span", "issue-tag", severity));
    card.append(head, makeElement("p", "", item.detail), makeElement("p", "issue-fix", item.fix));
    elements.issueList.append(card);
  }
  if (!issues.length) {
    elements.issueList.append(makeElement("p", "all-clear", "未发现孤字、重叠、越界或裁切。可以安全导出。"));
  }
  const total = counts.error + counts.warning;
  elements.issueCount.textContent = String(total);
  elements.issueCount.classList.toggle("has-errors", counts.error > 0);
}

function updateAllUI() {
  syncDocumentFields();
  renderParagraphList();
  renderFlowOrder();
  updateObjectForm();
  renderIssues();
  updateHistoryButtons();
  elements.saveState.classList.toggle("dirty", state.dirty);
}

function setTab(name) {
  const panels = {
    text: $("#panel-text"),
    object: $("#panel-object"),
    check: $("#panel-check"),
  };
  for (const [key, panel] of Object.entries(panels)) {
    panel.hidden = key !== name;
    panel.classList.toggle("is-active", key === name);
    const tab = $(`#tab-${key}`);
    tab.classList.toggle("is-active", key === name);
    tab.setAttribute("aria-selected", String(key === name));
  }
}

function commitMutation(mutator, options = {}) {
  const before = clone(state.doc);
  mutator(state.doc);
  state.doc.updatedAt = new Date().toISOString();
  pushHistory(before);
  recompute(options.updatePanels !== false);
}

function selectShape(shapeId, options = {}) {
  state.selectedShapeId = shapeId;
  state.selectedParagraphIndex = null;
  if (options.switchTab !== false) setTab("object");
  renderCanvas();
  updateObjectForm();
  renderFlowOrder();
  renderParagraphList();
}

function selectParagraph(paragraphIndex, options = {}) {
  state.selectedParagraphIndex = paragraphIndex;
  state.selectedShapeId = null;
  if (options.switchTab !== false) setTab("text");
  renderCanvas();
  updateObjectForm();
  renderParagraphList();
}

function clearSelection() {
  state.selectedShapeId = null;
  state.selectedParagraphIndex = null;
  renderCanvas();
  updateObjectForm();
  renderParagraphList();
  renderFlowOrder();
}

function shiftPinsForShape(shapeId, dx, dy) {
  if (!dx && !dy) return;
  for (const pin of state.doc.pinned) {
    if (pin.shapeId !== shapeId) continue;
    pin.x += dx;
    pin.y += dy;
  }
}

function pinParagraph(paragraphIndex) {
  const paragraph = state.layout.paragraphs[paragraphIndex];
  if (!paragraph) return;
  const existing = state.doc.pinned.find((pin) => pin.paragraphIndex === paragraphIndex);
  if (existing) {
    commitMutation((doc) => {
      doc.pinned = doc.pinned.filter((pin) => pin.paragraphIndex !== paragraphIndex);
    });
    toast("已解除段落固定，正文重新绕排。", "success");
    return;
  }
  const frameIds = [...new Set(paragraph.lines.map((line) => line.frameId))];
  if (!paragraph.lines.length || frameIds.length !== 1) {
    toast("该段落没有落点或跨多个图形，暂不能固定。请先缩短段落或调整图形。", "error", 5200);
    return;
  }
  const first = paragraph.lines[0];
  const frame = state.layout.frames.find((item) => item.id === first.frameId);
  const width = frame ? frame.x + frame.w - frame.padding - first.x : paragraph.bounds.w;
  commitMutation((doc) => {
    doc.pinned = doc.pinned.filter((pin) => pin.paragraphIndex !== paragraphIndex);
    doc.pinned.push({
      paragraphIndex,
      shapeId: first.frameId,
      x: first.x,
      y: first.lineTop,
      width: Math.max(first.width, width),
    });
  });
  state.selectedParagraphIndex = paragraphIndex;
  toast("段落已固定；移动其它图形时，只有其余内容会重新绕排。", "success", 4500);
}

function moveFlowFrame(shapeId, direction) {
  const frames = state.layout.frames.slice();
  const index = frames.findIndex((frame) => frame.id === shapeId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= frames.length) return;
  commitMutation((doc) => {
    const sorted = doc.shapes
      .filter((shape) => shape.textFlow)
      .sort((a, b) => a.flowOrder - b.flowOrder);
    const reference = frames[target].id;
    const a = sorted.find((shape) => shape.id === shapeId);
    const b = sorted.find((shape) => shape.id === reference);
    if (!a || !b) return;
    const order = a.flowOrder;
    a.flowOrder = b.flowOrder;
    b.flowOrder = order;
  });
}

function addShape(type) {
  if (type === "image") {
    $("#add-image-file").click();
    return;
  }
  const safe = {
    x: state.doc.canvas.margin,
    y: state.doc.canvas.margin,
    w: state.doc.canvas.width - state.doc.canvas.margin * 2,
    h: state.doc.canvas.height - state.doc.canvas.margin * 2,
  };
  const offset = (state.doc.shapes.length % 7) * 12;
  const width = Math.min(280, Math.max(80, safe.w - 20));
  const height = Math.min(230, Math.max(80, safe.h - 20));
  const x = Math.min(safe.x + safe.w - width, safe.x + 28 + offset);
  const y = Math.min(safe.y + safe.h - height, safe.y + 150 + offset);
  const id = uid("shape");
  commitMutation((doc) => {
    const flowOrder = Math.max(-1, ...doc.shapes.map((shape) => shape.flowOrder)) + 1;
    doc.shapes.push({
      id,
      name: type === "ellipse" ? "新椭圆框" : type === "rounded" ? "新圆角框" : "新矩形框",
      type,
      x,
      y,
      w: width,
      h: height,
      padding: 18,
      radius: type === "rounded" ? 16 : 0,
      textFlow: true,
      flowOrder,
      fill: "#fbf7ee",
      stroke: "#d5cbbc",
      strokeWidth: 1,
      opacity: 1,
      locked: false,
    });
  });
  selectShape(id);
}

function addImageFromDataUrl(src, name = "新图片") {
  const safe = {
    x: state.doc.canvas.margin,
    y: state.doc.canvas.margin,
    w: state.doc.canvas.width - state.doc.canvas.margin * 2,
    h: state.doc.canvas.height - state.doc.canvas.margin * 2,
  };
  const width = Math.min(220, Math.max(80, safe.w - 20));
  const height = Math.min(170, Math.max(70, safe.h - 20));
  const x = Math.max(safe.x, safe.x + safe.w - width - 20);
  const y = Math.max(safe.y, safe.y + 20);
  const id = uid("image");
  const before = clone(state.doc);
  state.doc.shapes.push({
    id,
    name,
    type: "image",
    x,
    y,
    w: width,
    h: height,
    padding: 0,
    radius: 0,
    textFlow: false,
    flowOrder: Math.max(-1, ...state.doc.shapes.map((shape) => shape.flowOrder)) + 1,
    fill: "#ffffff",
    stroke: "#d5cbbc",
    strokeWidth: 1,
    opacity: 1,
    locked: false,
    src,
    fit: "cover",
  });
  pushHistory(before);
  recompute(true);
  selectShape(id);
}

function handleImageFile(file, mode = "replace") {
  if (!file) return;
  if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) {
    toast("请选择 PNG、JPEG、WebP 或 SVG 图片。", "error");
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    toast("图片超过 8MB。请先压缩图片，以免本机保存空间不足。", "error", 5200);
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const src = String(reader.result || "");
    if (mode === "add") {
      addImageFromDataUrl(src, file.name.replace(/\.[^.]+$/, "") || "图片");
      return;
    }
    const shape = shapeById(state.selectedShapeId);
    if (!shape || shape.type !== "image") {
      toast("请先选择一个图片对象，再替换图片。", "error");
      return;
    }
    commitMutation((doc) => {
      const target = doc.shapes.find((item) => item.id === shape.id);
      target.src = src;
      target.name = file.name.replace(/\.[^.]+$/, "") || target.name;
    });
    loadImage(src).then(() => renderCanvas());
    toast("图片已内嵌到项目，保存和重新载入时无需源文件。", "success");
  };
  reader.onerror = () => toast("读取图片失败，请重新选择文件。", "error");
  reader.readAsDataURL(file);
}

function deleteSelectedShape() {
  if (!state.selectedShapeId) return;
  const id = state.selectedShapeId;
  commitMutation((doc) => {
    doc.shapes = doc.shapes.filter((shape) => shape.id !== id);
    doc.pinned = doc.pinned.filter((pin) => pin.shapeId !== id);
  });
  clearSelection();
}

function moveShapeLayer(direction) {
  if (!state.selectedShapeId) return;
  commitMutation((doc) => {
    const index = doc.shapes.findIndex((shape) => shape.id === state.selectedShapeId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= doc.shapes.length) return;
    const [shape] = doc.shapes.splice(index, 1);
    doc.shapes.splice(target, 0, shape);
  });
}

function canvasPoint(event) {
  const rect = elements.canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * state.doc.canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * state.doc.canvas.height,
  };
}

function shapeHandles(shape) {
  const b = shapeBounds(shape);
  return [
    [b.x, b.y],
    [b.x + b.w / 2, b.y],
    [b.x + b.w, b.y],
    [b.x + b.w, b.y + b.h / 2],
    [b.x + b.w, b.y + b.h],
    [b.x + b.w / 2, b.y + b.h],
    [b.x, b.y + b.h],
    [b.x, b.y + b.h / 2],
  ];
}

function handleAtPoint(shape, point) {
  if (!shape) return -1;
  const tolerance = Math.max(5, 10 / state.zoom);
  const handles = shapeHandles(shape);
  return handles.findIndex(
    ([x, y]) => Math.abs(point.x - x) <= tolerance && Math.abs(point.y - y) <= tolerance,
  );
}

function topShapeAt(point) {
  for (let index = state.doc.shapes.length - 1; index >= 0; index -= 1) {
    const shape = state.doc.shapes[index];
    if (pointInShape(shape, point.x, point.y)) return shape;
  }
  return null;
}

function paragraphAt(point) {
  for (let index = state.layout.lines.length - 1; index >= 0; index -= 1) {
    const line = state.layout.lines[index];
    if (
      point.x >= line.x - 2 &&
      point.x <= line.x + line.width + 2 &&
      point.y >= line.top - 1 &&
      point.y <= line.top + line.height + 1
    ) {
      return line.paragraphIndex;
    }
  }
  return null;
}

function resizeFromHandle(original, handle, dx, dy) {
  let x = original.x;
  let y = original.y;
  let w = original.w;
  let h = original.h;
  const right = original.x + original.w;
  const bottom = original.y + original.h;
  if ([0, 6, 7].includes(handle)) {
    x = Math.min(original.x + dx, right - 12);
    w = right - x;
  } else if ([2, 3, 4].includes(handle)) {
    w = Math.max(12, original.w + dx);
  }
  if ([0, 1, 2].includes(handle)) {
    y = Math.min(original.y + dy, bottom - 12);
    h = bottom - y;
  } else if ([4, 5, 6].includes(handle)) {
    h = Math.max(12, original.h + dy);
  }
  return { x, y, w, h };
}

function startDrag(event, mode, data) {
  state.drag = {
    mode,
    ...data,
    start: canvasPoint(event),
    before: clone(state.doc),
    changed: false,
  };
  elements.canvas.setPointerCapture?.(event.pointerId);
  elements.canvas.style.cursor = mode === "move" ? "grabbing" : "nwse-resize";
}

function onPointerDown(event) {
  if (event.button !== 0) return;
  const point = canvasPoint(event);
  const selectedShape = shapeById(state.selectedShapeId);
  const handle = handleAtPoint(selectedShape, point);
  if (handle >= 0 && !selectedShape.locked) {
    startDrag(event, "resize", {
      shapeId: selectedShape.id,
      handle,
      original: { x: selectedShape.x, y: selectedShape.y, w: selectedShape.w, h: selectedShape.h },
    });
    event.preventDefault();
    return;
  }

  const paragraphIndex = paragraphAt(point);
  if (paragraphIndex !== null) {
    selectParagraph(paragraphIndex, { switchTab: true });
    const pin = state.doc.pinned.find((item) => item.paragraphIndex === paragraphIndex);
    if (pin) {
      startDrag(event, "pin", {
        paragraphIndex,
        original: { x: pin.x, y: pin.y },
      });
    }
    event.preventDefault();
    return;
  }

  const shape = topShapeAt(point);
  if (shape) {
    selectShape(shape.id, { switchTab: true });
    if (!shape.locked) {
      startDrag(event, "move", {
        shapeId: shape.id,
        original: { x: shape.x, y: shape.y },
      });
    }
  } else {
    clearSelection();
  }
}

function onPointerMove(event) {
  const point = canvasPoint(event);
  if (!state.drag) {
    const selectedShape = shapeById(state.selectedShapeId);
    const handle = handleAtPoint(selectedShape, point);
    if (handle >= 0) {
      const cursors = ["nwse-resize", "ns-resize", "nesw-resize", "ew-resize", "nwse-resize", "ns-resize", "nesw-resize", "ew-resize"];
      elements.canvas.style.cursor = cursors[handle];
    } else if (paragraphAt(point) !== null) {
      elements.canvas.style.cursor = "text";
    } else {
      elements.canvas.style.cursor = "default";
    }
    return;
  }

  const drag = state.drag;
  const dx = point.x - drag.start.x;
  const dy = point.y - drag.start.y;
  if (Math.abs(dx) > 0.4 || Math.abs(dy) > 0.4) drag.changed = true;

  if (drag.mode === "move") {
    const shape = shapeById(drag.shapeId);
    if (!shape) return;
    const newX = drag.original.x + dx;
    const newY = drag.original.y + dy;
    shiftPinsForShape(shape.id, newX - shape.x, newY - shape.y);
    shape.x = newX;
    shape.y = newY;
  } else if (drag.mode === "resize") {
    const shape = shapeById(drag.shapeId);
    if (!shape) return;
    const next = resizeFromHandle(drag.original, drag.handle, dx, dy);
    shiftPinsForShape(shape.id, next.x - shape.x, next.y - shape.y);
    shape.x = next.x;
    shape.y = next.y;
    shape.w = next.w;
    shape.h = next.h;
  } else if (drag.mode === "pin") {
    const pin = state.doc.pinned.find((item) => item.paragraphIndex === drag.paragraphIndex);
    if (!pin) return;
    pin.x = drag.original.x + dx;
    pin.y = drag.original.y + dy;
  }
  state.doc.updatedAt = new Date().toISOString();
  state.dirty = true;
  recompute(false);
  updateObjectForm();
}

function endDrag(event) {
  if (!state.drag) return;
  const drag = state.drag;
  state.drag = null;
  elements.canvas.style.cursor = "default";
  if (elements.canvas.hasPointerCapture?.(event.pointerId)) {
    elements.canvas.releasePointerCapture(event.pointerId);
  }
  if (drag.changed) {
    pushHistory(drag.before);
    recompute(true);
  }
}

function bindLiveField(input, apply, options = {}) {
  if (!input) return;
  let baseline = null;
  input.addEventListener("focus", () => {
    baseline = clone(state.doc);
    input.dataset.historyStarted = "false";
  });
  input.addEventListener("input", () => {
    if (!baseline) baseline = clone(state.doc);
    if (input.dataset.historyStarted !== "true") {
      pushHistory(baseline);
      input.dataset.historyStarted = "true";
    }
    apply(state.doc, input.value);
    state.doc.updatedAt = new Date().toISOString();
    markDirty();
    if (options.layout === false) {
      renderCanvas();
      updateObjectForm();
      renderParagraphList();
    } else {
      recompute(options.panels !== false);
    }
  });
  input.addEventListener("blur", () => {
    baseline = null;
    input.dataset.historyStarted = "false";
  });
}

function bindChangeField(input, apply, options = {}) {
  if (!input) return;
  input.addEventListener("change", () => {
    const before = clone(state.doc);
    apply(state.doc, input.value);
    state.doc.updatedAt = new Date().toISOString();
    pushHistory(before);
    if (options.layout === false) {
      renderCanvas();
      updateObjectForm();
      renderParagraphList();
    } else {
      recompute(options.panels !== false);
    }
  });
}

function updateShapeGeometry(shape, values) {
  const oldX = shape.x;
  const oldY = shape.y;
  if (values.x !== undefined) shape.x = values.x;
  if (values.y !== undefined) shape.y = values.y;
  if (values.w !== undefined) shape.w = Math.max(12, values.w);
  if (values.h !== undefined) shape.h = Math.max(12, values.h);
  shiftPinsForShape(shape.id, shape.x - oldX, shape.y - oldY);
  if (shape.textFlow) {
    const maxOrder = Math.max(0, ...state.doc.shapes.map((item) => item.flowOrder));
    shape.flowOrder = Number.isFinite(shape.flowOrder) ? shape.flowOrder : maxOrder + 1;
  }
}

function bindShapeChange(input, apply) {
  if (!input) return;
  input.addEventListener("change", () => {
    const shape = shapeById(state.selectedShapeId);
    if (!shape) return;
    const before = clone(state.doc);
    const value = input.type === "checkbox" ? input.checked : input.value;
    apply(shape, state.doc, value);
    state.doc.updatedAt = new Date().toISOString();
    pushHistory(before);
    recompute(true);
  });
}

function bindShapeLive(input, apply) {
  if (!input) return;
  let baseline = null;
  input.addEventListener("focus", () => {
    baseline = clone(state.doc);
    input.dataset.historyStarted = "false";
  });
  input.addEventListener("input", () => {
    const shape = shapeById(state.selectedShapeId);
    if (!shape) return;
    if (!baseline) baseline = clone(state.doc);
    if (input.dataset.historyStarted !== "true") {
      pushHistory(baseline);
      input.dataset.historyStarted = "true";
    }
    apply(shape, input.value);
    state.doc.updatedAt = new Date().toISOString();
    recompute(false);
    updateObjectForm();
    renderFlowOrder();
  });
  input.addEventListener("blur", () => {
    baseline = null;
    input.dataset.historyStarted = "false";
  });
}

function bindEvents() {
  $("#undo-btn").addEventListener("click", undo);
  $("#redo-btn").addEventListener("click", redo);
  $("#save-btn").addEventListener("click", saveCurrent);
  $("#reload-btn").addEventListener("click", reloadSaved);
  $("#library-btn").addEventListener("click", openLibrary);
  $("#import-btn").addEventListener("click", () => $("#import-file").click());
  $("#import-file").addEventListener("change", importProjectFile);
  $("#export-svg-btn").addEventListener("click", () => requestExport("svg"));
  $("#export-png-btn").addEventListener("click", () => requestExport("png"));
  $("#zoom-out-btn").addEventListener("click", () => applyZoom(state.zoom / 1.15));
  $("#zoom-in-btn").addEventListener("click", () => applyZoom(state.zoom * 1.15));
  $("#zoom-fit-btn").addEventListener("click", () => {
    fitCanvas();
    renderCanvas();
    updateSummary();
  });
  $("#reflow-btn").addEventListener("click", () => {
    recompute(true, { fit: state.zoomMode === "fit" });
    toast(
      state.layout.overflowSegments.length
        ? "已重新绕排，仍有溢出内容；请查看检查面板的修复建议。"
        : "已重新绕排，固定段落保持原位。",
      state.layout.overflowSegments.length ? "error" : "success",
    );
  });
  $("#check-btn").addEventListener("click", () => {
    recompute(true);
    toast(state.validation.summary, state.validation.counts.error ? "error" : "success");
  });
  $("#auto-repair-btn").addEventListener("click", autoRepair);

  for (const tab of $$(".tab")) {
    tab.addEventListener("click", () => setTab(tab.id.replace("tab-", "")));
  }

  $("#case-select").addEventListener("change", (event) => {
    const scenario = createScenario(event.target.value);
    state.doc = scenario;
    state.undo = [];
    state.redo = [];
    state.dirty = false;
    state.zoomMode = "fit";
    clearSelection();
    recompute(true, { fit: true });
    markDirty();
    toast(
      event.target.value === "boundary"
        ? "已载入边界案例：超长文本会给出溢出报告，不会静默丢弃。"
        : "已载入默认案例。",
      "info",
      5000,
    );
  });
  $("#restore-case-btn").addEventListener("click", () => {
    const name = $("#case-select").value;
    state.doc = createScenario(name);
    state.undo = [];
    state.redo = [];
    state.dirty = false;
    state.zoomMode = "fit";
    clearSelection();
    recompute(true, { fit: true });
    markDirty();
    toast("案例已恢复到初始状态。", "success");
  });

  bindLiveField(elements.docName, (doc, value) => {
    doc.name = value.slice(0, 160);
  }, { layout: false });
  bindLiveField(elements.bodyText, (doc, value) => {
    doc.content.text = value;
  });
  bindLiveField($("#kicker-input"), (doc, value) => {
    doc.content.kicker = value;
  });
  bindLiveField($("#title-input"), (doc, value) => {
    doc.content.title = value;
  });
  bindLiveField($("#subtitle-input"), (doc, value) => {
    doc.content.subtitle = value;
  });
  bindLiveField($("#footer-input"), (doc, value) => {
    doc.content.footer = value;
  });

  bindChangeField($("#canvas-w"), (doc, value) => {
    doc.canvas.width = Math.max(180, Number(value) || 180);
  });
  bindChangeField($("#canvas-h"), (doc, value) => {
    doc.canvas.height = Math.max(140, Number(value) || 140);
  });
  bindChangeField($("#canvas-margin"), (doc, value) => {
    doc.canvas.margin = Math.max(0, Number(value) || 0);
  });
  bindChangeField($("#canvas-bg"), (doc, value) => {
    doc.canvas.background = value;
  });
  bindChangeField($("#paragraph-spacing"), (doc, value) => {
    doc.paragraph.spacing = Math.max(0, Number(value) || 0);
  });
  bindChangeField($("#paragraph-indent"), (doc, value) => {
    doc.paragraph.indent = Math.max(0, Number(value) || 0);
  });
  bindChangeField($("#font-size"), (doc, value) => {
    doc.font.size = Math.min(120, Math.max(5, Number(value) || 12));
  });
  bindChangeField($("#font-line-height"), (doc, value) => {
    doc.font.lineHeight = Math.min(3, Math.max(1, Number(value) || 1.5));
  });
  bindChangeField($("#font-weight"), (doc, value) => {
    doc.font.weight = Number(value);
  });
  bindChangeField($("#font-color"), (doc, value) => {
    doc.font.color = value;
  });
  bindChangeField($("#font-family"), (doc, value) => {
    if (!/url\s*\(|@import|<script/i.test(value)) doc.font.family = value;
  });
}

function bindObjectEvents() {
  elements.canvas.addEventListener("pointerdown", onPointerDown);
  elements.canvas.addEventListener("pointermove", onPointerMove);
  elements.canvas.addEventListener("pointerup", endDrag);
  elements.canvas.addEventListener("pointercancel", endDrag);
  elements.canvas.addEventListener("pointerleave", (event) => {
    if (!state.drag) elements.canvas.style.cursor = "default";
    else endDrag(event);
  });

  bindShapeLive($("#shape-name"), (shape, value) => {
    shape.name = value.slice(0, 120);
  });
  for (const [id, prop] of [
    ["#shape-x", "x"],
    ["#shape-y", "y"],
    ["#shape-w", "w"],
    ["#shape-h", "h"],
  ]) {
    bindShapeChange($(id), (shape, doc, value) => {
      const number = Number(value);
      if (!Number.isFinite(number)) return;
      updateShapeGeometry(shape, { [prop]: number });
    });
  }
  bindShapeChange($("#shape-padding"), (shape, doc, value) => {
    shape.padding = Math.max(0, Number(value) || 0);
  });
  bindShapeChange($("#shape-radius"), (shape, doc, value) => {
    shape.radius = Math.max(0, Number(value) || 0);
  });
  bindShapeChange($("#shape-fill"), (shape, doc, value) => {
    shape.fill = value;
  });
  bindShapeChange($("#shape-stroke"), (shape, doc, value) => {
    shape.stroke = value;
  });
  bindShapeChange($("#shape-opacity"), (shape, doc, value) => {
    shape.opacity = Number(value);
  });
  bindShapeChange($("#shape-locked"), (shape, doc, value) => {
    shape.locked = value === true;
  });
  bindShapeChange($("#shape-type"), (shape, doc, value) => {
    if (shape.type === "image") return;
    shape.type = ["rect", "rounded", "ellipse"].includes(value) ? value : shape.type;
  });
  bindShapeChange($("#shape-flow"), (shape, doc, value) => {
    const next = value === "true";
    shape.textFlow = next;
    if (next) {
      shape.flowOrder = Math.max(-1, ...doc.shapes.map((item) => item.flowOrder)) + 1;
    } else {
      doc.pinned = doc.pinned.filter((pin) => pin.shapeId !== shape.id);
    }
  });
  $("#shape-backward-btn").addEventListener("click", () => moveShapeLayer(-1));
  $("#shape-forward-btn").addEventListener("click", () => moveShapeLayer(1));
  $("#shape-delete-btn").addEventListener("click", deleteSelectedShape);
  $("#image-file").addEventListener("change", (event) => {
    handleImageFile(event.target.files?.[0], "replace");
    event.target.value = "";
  });
  $("#add-image-file").addEventListener("change", (event) => {
    handleImageFile(event.target.files?.[0], "add");
    event.target.value = "";
  });
  for (const button of $$("[data-add-shape]")) {
    button.addEventListener("click", () => addShape(button.dataset.addShape));
  }

  elements.paragraphList.addEventListener("click", (event) => {
    const pinButton = event.target.closest("[data-pin-paragraph]");
    if (pinButton) {
      event.stopPropagation();
      pinParagraph(Number(pinButton.dataset.pinParagraph));
      return;
    }
    const card = event.target.closest("[data-paragraph-index]");
    if (card) selectParagraph(Number(card.dataset.paragraphIndex));
  });
  elements.paragraphList.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const card = event.target.closest("[data-paragraph-index]");
    if (!card) return;
    event.preventDefault();
    selectParagraph(Number(card.dataset.paragraphIndex));
  });

  elements.flowOrder.addEventListener("click", (event) => {
    const move = event.target.closest("[data-flow-move]");
    if (move) {
      event.stopPropagation();
      moveFlowFrame(move.dataset.shapeId, Number(move.dataset.flowMove));
      return;
    }
    const row = event.target.closest("[data-flow-shape]");
    if (row) selectShape(row.dataset.flowShape);
  });

  elements.issueList.addEventListener("click", (event) => {
    const issue = event.target.closest("[data-issue-shape], [data-issue-paragraph]");
    if (!issue) return;
    if (issue.dataset.issueShape) selectShape(issue.dataset.issueShape);
    else if (issue.dataset.issueParagraph !== "") {
      selectParagraph(Number(issue.dataset.issueParagraph));
    }
  });

  document.addEventListener("keydown", handleKeyboard);
  window.addEventListener("beforeunload", (event) => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });

  const resizeObserver = new ResizeObserver(() => {
    if (!state.doc) return;
    if (state.zoomMode === "fit") fitCanvas();
    renderCanvas();
    updateSummary();
  });
  resizeObserver.observe(elements.scroll);
}

function handleKeyboard(event) {
  const editing =
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement ||
    event.target instanceof HTMLSelectElement;
  const command = event.ctrlKey || event.metaKey;
  if (command && event.key.toLowerCase() === "z") {
    event.preventDefault();
    event.shiftKey ? redo() : undo();
    return;
  }
  if (command && event.key.toLowerCase() === "y") {
    event.preventDefault();
    redo();
    return;
  }
  if (command && event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveCurrent();
    return;
  }
  if (editing) return;
  if (event.key === "Escape") {
    clearSelection();
    return;
  }
  if ((event.key === "Delete" || event.key === "Backspace") && state.selectedShapeId) {
    event.preventDefault();
    deleteSelectedShape();
    return;
  }
  if (state.selectedShapeId && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
    event.preventDefault();
    const shape = shapeById(state.selectedShapeId);
    if (!shape || shape.locked) return;
    const step = event.shiftKey ? 10 : 1;
    const before = clone(state.doc);
    const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    shiftPinsForShape(shape.id, dx, dy);
    shape.x += dx;
    shape.y += dy;
    pushHistory(before);
    recompute(true);
  }
}

function currentViewSnapshot() {
  return {
    zoom: state.zoom,
    zoomMode: state.zoomMode,
    scrollLeft: elements.scroll.scrollLeft,
    scrollTop: elements.scroll.scrollTop,
  };
}

function saveCurrent() {
  if (!state.doc) return;
  try {
    const envelope = {
      schemaVersion: 1,
      savedAt: new Date().toISOString(),
      document: clone(state.doc),
      view: currentViewSnapshot(),
    };
    writeStorage(STORAGE_KEYS.current, envelope);
    markSaved();
    toast("项目、字体、图片与当前参数已保存到本机。", "success");
  } catch (error) {
    console.error(error);
    toast(
      "保存失败：本机存储空间可能不足。请压缩或删除较大的图片，或先导出项目 JSON 备份。",
      "error",
      7000,
    );
  }
}

function reloadSaved() {
  const envelope = readStorage(STORAGE_KEYS.current);
  if (!envelope) {
    toast("尚未找到已保存的项目。请先点击“保存”。", "error");
    return;
  }
  try {
    const documentValue = envelope.document || envelope;
    state.undo = [];
    state.redo = [];
    loadDocument(documentValue, { view: envelope.view, scroll: envelope.view });
    markSaved();
    updateHistoryButtons();
    toast("已从本机重新载入保存的项目与视图参数。", "success");
  } catch (error) {
    console.error(error);
    toast(`重新载入失败：${error.message}`, "error", 6000);
  }
}

function importProjectFile(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  if (file.size > 25 * 1024 * 1024) {
    toast("项目文件超过 25MB。请移除大图或导出较小的版本后再导入。", "error", 6000);
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result || ""));
      const documentValue = parsed.document || parsed;
      const imported = sanitizeDocument(documentValue);
      state.doc = imported;
      state.undo = [];
      state.redo = [];
      state.zoomMode = "fit";
      clearSelection();
      recompute(true, { fit: true });
      markDirty();
      toast("项目已导入。图形、文字、图片与字体参数均已恢复，请重新保存。", "success");
    } catch (error) {
      console.error(error);
      toast(`导入失败：${error.message}。请检查 JSON 是否完整。`, "error", 6500);
    }
  };
  reader.onerror = () => toast("读取项目文件失败，请检查文件权限。", "error");
  reader.readAsText(file);
}

function archiveItems(key) {
  const value = readStorage(key);
  return value && Array.isArray(value.items) ? value.items : [];
}

function saveArchive(key, items) {
  writeStorage(key, { schemaVersion: 1, items });
}

function formatDate(value) {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return "未知时间";
  }
}

function archiveLabel() {
  const stamp = new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(new Date())
    .replaceAll("/", "-");
  return `${state.doc.name} · ${stamp}`;
}

function saveTemplate() {
  try {
    const items = archiveItems(STORAGE_KEYS.templates);
    items.unshift({
      id: uid("template"),
      name: archiveLabel(),
      createdAt: new Date().toISOString(),
      document: clone(state.doc),
      view: currentViewSnapshot(),
    });
    saveArchive(STORAGE_KEYS.templates, items.slice(0, 30));
    renderArchiveLists();
    toast("模板已保存：包含模板、字体、图片与全部排版参数。", "success");
  } catch (error) {
    toast("模板保存失败：请压缩图片或导出项目 JSON 备份。", "error", 6000);
  }
}

function saveKeyframe() {
  try {
    const items = archiveItems(STORAGE_KEYS.keyframes);
    items.unshift({
      id: uid("keyframe"),
      name: archiveLabel(),
      createdAt: new Date().toISOString(),
      document: clone(state.doc),
      view: currentViewSnapshot(),
    });
    saveArchive(STORAGE_KEYS.keyframes, items.slice(0, 30));
    renderArchiveLists();
    toast("关键帧已捕捉：恢复时将还原文字、图形、图片、字体和缩放位置。", "success");
  } catch (error) {
    toast("关键帧保存失败：请压缩图片或导出项目 JSON 备份。", "error", 6000);
  }
}

function archiveButton(text, action, id, danger = false) {
  const button = makeElement("button", danger ? "danger" : "", text);
  button.type = "button";
  button.dataset.archiveAction = action;
  button.dataset.archiveId = id;
  return button;
}

function renderArchiveList(container, items, kind) {
  container.replaceChildren();
  if (!items.length) {
    container.append(makeElement("p", "archive-empty", kind === "template" ? "尚无模板" : "尚无关键帧"));
    return;
  }
  for (const item of items) {
    const row = makeElement("div", "archive-item");
    const text = document.createElement("div");
    const title = makeElement("strong", "", item.name || "未命名");
    const meta = makeElement(
      "small",
      "",
      `${formatDate(item.createdAt)} · ${item.document?.canvas?.width || "?"}×${item.document?.canvas?.height || "?"}`,
    );
    text.append(title, meta);
    const actions = document.createElement("div");
    actions.append(
      archiveButton("恢复", "restore", item.id),
      archiveButton("删除", "delete", item.id, true),
    );
    row.append(text, actions);
    container.append(row);
  }
}

function renderArchiveLists() {
  const templates = archiveItems(STORAGE_KEYS.templates);
  const keyframes = archiveItems(STORAGE_KEYS.keyframes);
  renderArchiveList($("#template-list"), templates, "template");
  renderArchiveList($("#keyframe-list"), keyframes, "keyframe");
}

function openLibrary() {
  renderArchiveLists();
  elements.libraryDialog.showModal();
}

function restoreArchive(kind, id) {
  const key = kind === "template" ? STORAGE_KEYS.templates : STORAGE_KEYS.keyframes;
  const item = archiveItems(key).find((entry) => entry.id === id);
  if (!item?.document) {
    toast("这条记录缺少可恢复的项目数据。", "error");
    return;
  }
  state.undo = [];
  state.redo = [];
  loadDocument(item.document, { view: item.view, scroll: item.view });
  markDirty();
  updateHistoryButtons();
  if (elements.libraryDialog.open) elements.libraryDialog.close();
  toast(
    kind === "template"
      ? "模板已恢复；文字、图形、字体和图片均可继续编辑。"
      : "关键帧已恢复，包括缩放位置和当前排版参数。",
    "success",
  );
}

function deleteArchive(kind, id) {
  const key = kind === "template" ? STORAGE_KEYS.templates : STORAGE_KEYS.keyframes;
  if (!window.confirm("删除这条本机记录？此操作不影响当前画布。")) return;
  try {
    const items = archiveItems(key).filter((entry) => entry.id !== id);
    saveArchive(key, items);
    renderArchiveLists();
    toast("记录已删除。", "success");
  } catch {
    toast("删除失败：本机存储不可写。", "error");
  }
}

function exportProjectJson() {
  const envelope = {
    type: "fieldnote-project",
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    document: state.doc,
    view: currentViewSnapshot(),
  };
  const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" });
  downloadBlob(blob, safeFilename(state.doc.name, "fieldnote.json"));
  toast("项目 JSON 已导出，包含可恢复的字体、图片与关键参数。", "success");
}

function bindArchiveEvents() {
  $("#save-template-btn").addEventListener("click", saveTemplate);
  $("#save-keyframe-btn").addEventListener("click", saveKeyframe);
  $("#export-project-btn").addEventListener("click", exportProjectJson);
  for (const [selector, kind] of [
    ["#template-list", "template"],
    ["#keyframe-list", "keyframe"],
  ]) {
    $(selector).addEventListener("click", (event) => {
      const button = event.target.closest("[data-archive-action]");
      if (!button) return;
      if (button.dataset.archiveAction === "restore") {
        restoreArchive(kind, button.dataset.archiveId);
      } else {
        deleteArchive(kind, button.dataset.archiveId);
      }
    });
  }
}

function measureTextSize(text, size, weight) {
  if (!text) return 0;
  const ctx = getMeasurementContext();
  ctx.save();
  ctx.font = `${weight}  ${size}px ${state.doc.font.family}`;
  const width = ctx.measureText(text).width;
  ctx.restore();
  return width;
}

function shrinkHeaderToSafeWidth(doc) {
  const safeWidth = doc.canvas.width - doc.canvas.margin * 2;
  const targets = [
    ["kicker", "kickerSize", 700],
    ["title", "titleSize", 400],
    ["subtitle", "subtitleSize", 400],
    ["footer", "footerSize", 400],
  ];
  for (const [field, sizeField, weight] of targets) {
    const text = doc.content[field];
    let size = doc.header[sizeField];
    while (text && measureTextSize(text, size, weight) > safeWidth && size > 5) {
      size = Math.max(5, size - 0.5);
    }
    doc.header[sizeField] = size;
  }
}

function rectsOverlap(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

function resolveFlowFrameOverlaps(doc) {
  const placed = [];
  const frames = doc.shapes
    .filter((shape) => shape.textFlow)
    .sort((a, b) => a.flowOrder - b.flowOrder);
  for (const shape of frames) {
    let bounds = shapeBounds(shape);
    if (placed.some((other) => rectsOverlap(bounds, shapeBounds(other)))) {
      const bottom = Math.max(...placed.map((other) => other.y + other.h));
      const oldY = shape.y;
      shape.y = bottom + 20;
      shiftPinsForShape(shape.id, 0, shape.y - oldY);
      bounds = shapeBounds(shape);
      doc.canvas.height = Math.max(
        doc.canvas.height,
        Math.ceil(bounds.bottom + doc.canvas.margin + 32),
      );
    }
    placed.push(shape);
  }
}

function autoRepair() {
  const before = clone(state.doc);
  const doc = state.doc;
  doc.canvas.width = Math.max(360, doc.canvas.width);
  doc.canvas.height = Math.max(260, doc.canvas.height);
  if (doc.canvas.margin * 2 >= doc.canvas.width - 40) {
    doc.canvas.margin = Math.max(8, Math.floor((doc.canvas.width - 120) / 2));
  }
  const safe = {
    x: doc.canvas.margin,
    y: doc.canvas.margin,
    w: doc.canvas.width - doc.canvas.margin * 2,
    h: doc.canvas.height - doc.canvas.margin * 2,
  };

  for (const shape of doc.shapes) {
    const oldX = shape.x;
    const oldY = shape.y;
    if (shape.w > safe.w) shape.w = safe.w;
    if (shape.h > safe.h) shape.h = safe.h;
    shape.x = Math.min(safe.x + safe.w - shape.w, Math.max(safe.x, shape.x));
    shape.y = Math.min(safe.y + safe.h - shape.h, Math.max(safe.y, shape.y));
    shiftPinsForShape(shape.id, shape.x - oldX, shape.y - oldY);
    if ((shape.textFlow || shape.type === "image") && (shape.w < 8 || shape.h < 8)) {
      shape.w = Math.max(60, shape.w);
      shape.h = Math.max(60, shape.h);
    }
  }

  resolveFlowFrameOverlaps(doc);
  doc.pinned = doc.pinned.filter((pin) =>
    doc.shapes.some((shape) => shape.id === pin.shapeId && shape.textFlow),
  );
  shrinkHeaderToSafeWidth(doc);

  let attempts = 0;
  let layout = measureLayout(doc);
  while (layout.overflowSegments.length && attempts < 10 && doc.canvas.height < 8000) {
    const overflowChars = Math.max(1, layout.stats.overflowCharacters);
    const width = doc.canvas.width - doc.canvas.margin * 2;
    const charsPerLine = Math.max(
      1,
      Math.floor(width / Math.max(5, doc.font.size * 1.02)),
    );
    const neededLines = Math.ceil(overflowChars / charsPerLine);
    const frameHeight = Math.min(
      1600,
      Math.max(180, neededLines * doc.font.size * doc.font.lineHeight + 72),
    );
    const frameY = doc.canvas.height - doc.canvas.margin + 28;
    doc.canvas.height = Math.min(8000, frameY + frameHeight + doc.canvas.margin + 32);
    doc.shapes.push({
      id: uid("repair-frame"),
      name: `修复绕排框 ${attempts + 1}`,
      type: attempts % 2 === 0 ? "rounded" : "rect",
      x: doc.canvas.margin,
      y: frameY,
      w: width,
      h: frameHeight,
      padding: 24,
      radius: attempts % 2 === 0 ? 18 : 0,
      textFlow: true,
      flowOrder: Math.max(-1, ...doc.shapes.map((shape) => shape.flowOrder)) + 1,
      fill: "#fbf7ee",
      stroke: "#d5cbbc",
      strokeWidth: 1,
      opacity: 1,
      locked: false,
    });
    attempts += 1;
    layout = measureLayout(doc);
  }

  doc.updatedAt = new Date().toISOString();
  pushHistory(before);
  recompute(true, { fit: true });
  if (state.validation.counts.error === 0) {
    toast(
      attempts
        ? `自动修复完成：已移回安全区并新增 ${attempts} 个绕排框，正文全部有落点。`
        : "自动修复完成：对象已移回安全区，页眉页脚已适配。",
      "success",
      5200,
    );
  } else {
    toast(
      `仍有 ${state.validation.counts.error} 个错误无法自动修复。请查看检查清单中的逐项建议。`,
      "error",
      6500,
    );
  }
}

function exportIssueCard(item) {
  const card = makeElement("article", `issue ${item.severity}`);
  const head = makeElement("div", "issue-head");
  head.append(
    makeElement("strong", "", item.title),
    makeElement("span", "issue-tag", item.severity === "error" ? "错误" : "提醒"),
  );
  card.append(head, makeElement("p", "", item.detail), makeElement("p", "issue-fix", item.fix));
  return card;
}

function requestExport(format) {
  recompute(true);
  state.pendingExport = format;
  const { counts, issues, summary } = state.validation;
  elements.exportDialogTitle.textContent = `导出 ${format.toUpperCase()} · 安全检查`;
  elements.exportDialogBody.replaceChildren();
  const summaryCard = makeElement("div", "preflight-summary");
  const dot = makeElement(
    "span",
    `health-dot${counts.error ? " has-errors" : counts.warning ? " has-warnings" : ""}`,
  );
  const summaryText = document.createElement("div");
  summaryText.append(
    makeElement("strong", "", counts.error ? "发现阻止导出的问题" : summary),
    makeElement(
      "small",
      "",
      `${counts.error} 错误 · ${counts.warning} 提醒 · 安全边距 ${state.doc.canvas.margin}px · 文本 ${state.layout.stats.placedCharacters}/${state.layout.stats.characters} 字有落点`,
    ),
  );
  summaryCard.append(dot, summaryText);
  elements.exportDialogBody.append(summaryCard);

  const list = makeElement("div", "preflight-list");
  for (const item of issues) list.append(exportIssueCard(item));
  if (!issues.length) {
    list.append(makeElement("p", "all-clear", "安全边距、文字裁切、孤字和重叠检查全部通过。"));
  }
  elements.exportDialogBody.append(list);
  elements.exportDialogBody.append(
    makeElement(
      "p",
      "preflight-note",
      format === "svg"
        ? "SVG 将使用独立的图形元素与可编辑的 text/tspan 输出，不会把预览烧录成截图；项目参数与字体信息写入 metadata。"
        : "PNG 由与预览相同的坐标和渲染器生成，不会截取界面；文档参数写入 PNG 的 iTXt 元数据。",
    ),
  );

  if (counts.error) {
    const repair = makeElement("button", "button button-accent full", "自动修复可修复问题");
    repair.type = "button";
    repair.id = "preflight-repair";
    repair.addEventListener("click", () => {
      elements.exportDialog.close();
      autoRepair();
    });
    elements.exportDialogBody.append(repair);
  }
  elements.exportConfirm.disabled = counts.error > 0;
  elements.exportConfirm.textContent = counts.error
    ? "请先修复错误"
    : counts.warning
      ? `复查后导出 ${format.toUpperCase()}`
      : `导出 ${format.toUpperCase()}`;
  elements.exportDialog.showModal();
}

async function executeExport(format) {
  if (!state.pendingExport) return;
  const problems = [];
  for (const shape of state.doc.shapes) {
    if (shape.type !== "image" || !shape.src) continue;
    try {
      await loadImage(shape.src);
    } catch {
      problems.push(shape.name);
    }
  }
  if (problems.length) {
    toast(
      `图片无法解码：${problems.join("、")}。请在对象面板替换图片后再导出，避免图片静默缺失。`,
      "error",
      7000,
    );
    return;
  }
  recompute(true);
  if (state.validation.counts.error > 0) {
    requestExport(format);
    return;
  }
  const view = currentViewSnapshot();
  const exportOptions = {
    ...view,
    safeMargin: state.doc.canvas.margin,
    pixelRatio: format === "png" ? 2 : 1,
    editable: format === "svg",
  };
  try {
    if (format === "svg") {
      const svg = documentToSvg(state.doc, state.layout, exportOptions);
      const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
      downloadBlob(blob, safeFilename(state.doc.name, "svg"));
      toast("SVG 已导出：正文仍是可编辑文字，图形仍是独立矢量对象。", "success", 5200);
    } else {
      const canvas = renderExportCanvas(state.doc, state.layout, 2);
      const metadata = {
        generator: "Fieldnote Multi-shape Typesetter",
        format: "png",
        exportedAt: new Date().toISOString(),
        exportOptions,
        viewport: {
          width: state.doc.canvas.width,
          height: state.doc.canvas.height,
          safeMargin: state.doc.canvas.margin,
          pixelRatio: 2,
        },
        document: state.doc,
      };
      const blob = await canvasToPngBlob(canvas, metadata);
      downloadBlob(blob, safeFilename(state.doc.name, "png"));
      toast("PNG 已导出：使用与预览相同的排版结果，参数已写入元数据。", "success", 5200);
    }
    elements.exportDialog.close();
    state.pendingExport = null;
  } catch (error) {
    console.error(error);
    toast(`导出失败：${error.message}。请检查图片数据与浏览器下载权限。`, "error", 6500);
  }
}

function bindExportEvents() {
  elements.exportConfirm.addEventListener("click", () => {
    const format = state.pendingExport;
    if (format) executeExport(format);
  });
  $("#export-cancel-btn").addEventListener("click", () => {
    elements.exportDialog.close();
    state.pendingExport = null;
  });
  $("#export-cancel-x").addEventListener("click", () => {
    elements.exportDialog.close();
    state.pendingExport = null;
  });
  elements.exportDialog.addEventListener("close", () => {
    state.pendingExport = null;
  });
}

function initialize() {
  const envelope = readStorage(STORAGE_KEYS.current);
  let savedLoaded = false;
  if (envelope?.document) {
    try {
      state.doc = sanitizeDocument(envelope.document);
      state.zoom = Math.min(2.5, Math.max(0.12, Number(envelope.view?.zoom) || 1));
      state.zoomMode = envelope.view?.zoomMode === "manual" ? "manual" : "fit";
      savedLoaded = true;
    } catch {
      state.doc = createScenario("default");
    }
  } else {
    state.doc = createScenario("default");
  }
  bindEvents();
  bindObjectEvents();
  bindArchiveEvents();
  bindExportEvents();
  setTab("text");
  recompute(true, { fit: state.zoomMode === "fit" });
  requestAnimationFrame(() => {
    if (state.zoomMode === "fit") {
      fitCanvas();
      renderCanvas();
      updateSummary();
    }
  });
  if (savedLoaded) {
    markSaved();
    toast("已恢复上次保存的项目。", "info", 3000);
  } else {
    markDirty();
  }
  updateHistoryButtons();
}

initialize();

window.fieldnote = {
  getDocument: () => clone(state.doc),
  getLayout: () => state.layout,
  getValidation: () => state.validation,
  getSelection: () => ({
    shapeId: state.selectedShapeId,
    paragraphIndex: state.selectedParagraphIndex,
  }),
  exportSvg: () => documentToSvg(state.doc, state.layout, currentViewSnapshot()),
};
