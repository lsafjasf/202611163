import {
  PRESETS,
  createDefaultState,
  cloneState,
  makeId,
  restoreState,
} from "./model.js";
import {
  buildDieline,
  clamp,
  elementBoxMm,
  normalizeArtwork,
  normalizeElement,
  safeRectForPanel,
  setElementCenterMm,
  resizeElementFromHandle,
  validateClosedGeometry,
} from "./geometry.js";
import { createScene, fallbackMeasure } from "./scene.js";
import { elementHandles, HANDLE_SIZE, renderScene } from "./canvas-renderer.js";
import { exportSvg } from "./svg.js";
import { autoFitState, validateForExport } from "./checks.js";

const AUTOSAVE_KEY = "crease-studio-autosave-v1";
const SAVE_KEY = "crease-studio-save-v1";
const MAX_HISTORY = 100;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const canvas = $("#editorCanvas");
const canvasWrap = $("#canvasWrap");
const measureCanvas = document.createElement("canvas");
const measureCtx = measureCanvas.getContext("2d");

let state = loadInitialState();
let selectedId = null;
let scene = null;
let renderFrame = 0;
let undoStack = [];
let redoStack = [];
let lastCommit = { key: null, time: 0 };
let drag = null;
let autosaveTimer = 0;
let zoom = 1;
let savedSnapshot = localStorage.getItem(SAVE_KEY);
let savedAt = readSavedAt(savedSnapshot);
const imageCache = new Map();

function loadInitialState() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (raw) {
      const parsed = restoreState(JSON.parse(raw));
      if (parsed) return parsed;
    }
  } catch (error) {
    console.warn("Could not restore autosave", error);
  }
  return createDefaultState();
}

function measureText(text, style) {
  const unit = 24;
  measureCtx.save();
  measureCtx.font = `${style.fontWeight || 500} ${style.fontSize * unit}px "${
    style.fontFamily || "DejaVu Sans"
  }", sans-serif`;
  if ("letterSpacing" in measureCtx) {
    measureCtx.letterSpacing = `${(style.letterSpacing || 0) * unit}px`;
  }
  const width = measureCtx.measureText(text).width / unit;
  measureCtx.restore();
  return width || fallbackMeasure(text, style);
}

function scheduleRender() {
  if (renderFrame) return;
  renderFrame = requestAnimationFrame(() => {
    renderFrame = 0;
    renderNow();
  });
}

function renderNow() {
  const width = Math.max(1, Math.floor(canvas.clientWidth));
  const height = Math.max(1, Math.floor(canvas.clientHeight));
  if (width < 20 || height < 20) return;
  scene = createScene(state, width, height, { measureText });
  renderScene(canvas, scene, {
    dpr: Math.min(window.devicePixelRatio || 1, 2),
    images: imageCache,
    selectedId,
  });
  syncChecks(scene);
  syncCanvasStatus(scene);
}

function pushHistory(before, selectedBefore) {
  undoStack.push({ state: before, selectedId: selectedBefore });
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack = [];
  lastCommit = { key: null, time: 0 };
  updateHistoryButtons();
}

function applyChange(mutator, options = {}) {
  const history = options.history !== false;
  const key = options.key || "change";
  const before = cloneState(state);
  const selectedBefore = selectedId;
  mutator(state);
  normalizeArtwork(state);
  state.updatedAt = new Date().toISOString();
  if (Object.hasOwn(options, "selectId")) selectedId = options.selectId;
  if (history) {
    const now = Date.now();
    const coalesce = key === lastCommit.key && now - lastCommit.time < 650;
    if (!coalesce) pushHistory(before, selectedBefore);
    lastCommit = { key, time: now };
  }
  if (options.sync !== false) syncAll();
  scheduleRender();
  scheduleAutosave();
  markDirty();
}

function replaceState(next, options = {}) {
  if (options.history !== false) {
    pushHistory(cloneState(state), selectedId);
  }
  state = restoreState(next) || createDefaultState();
  selectedId = options.selectedId || null;
  lastCommit = { key: null, time: 0 };
  normalizeArtwork(state);
  preloadImages();
  restoreCustomFont();
  syncAll();
  scheduleRender();
  scheduleAutosave();
  markDirty();
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push({ state: cloneState(state), selectedId });
  const item = undoStack.pop();
  state = restoreState(item.state) || createDefaultState();
  selectedId = item.selectedId;
  lastCommit = { key: null, time: 0 };
  syncAll();
  scheduleRender();
  scheduleAutosave();
  updateHistoryButtons();
  markDirty();
  toast("Undo applied");
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push({ state: cloneState(state), selectedId });
  const item = redoStack.pop();
  state = restoreState(item.state) || createDefaultState();
  selectedId = item.selectedId;
  lastCommit = { key: null, time: 0 };
  syncAll();
  scheduleRender();
  scheduleAutosave();
  updateHistoryButtons();
  markDirty();
  toast("Redo applied");
}

function updateHistoryButtons() {
  $("#undoBtn").disabled = undoStack.length === 0;
  $("#redoBtn").disabled = redoStack.length === 0;
}

function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(state));
    } catch (error) {
      console.warn("Autosave failed", error);
    }
  }, 450);
}

function markDirty() {
  if (!savedSnapshot) {
    $("#saveState").classList.remove("is-dirty");
    $("#saveStateText").textContent = "Autosaved locally";
    return;
  }
  let dirty = true;
  try {
    const payload = JSON.parse(savedSnapshot);
    const savedState = restoreState(payload.state || payload);
    dirty = JSON.stringify(state) !== JSON.stringify(savedState);
  } catch {
    dirty = true;
  }
  $("#saveState").classList.toggle("is-dirty", dirty);
  $("#saveStateText").textContent = dirty
    ? "Unsaved changes"
    : `Saved ${savedAt ? new Date(savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}`;
}

function readSavedAt(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw)?.savedAt || null;
  } catch {
    return null;
  }
}

function setValue(element, value) {
  if (document.activeElement !== element) element.value = value;
}

function syncAll() {
  syncHeader();
  syncDimensions();
  syncStructure();
  syncTemplateState();
  syncLayerList();
  syncSelection();
  syncKeyframes();
  syncFontMeta();
  updateHistoryButtons();
}

function syncHeader() {
  setValue($("#docTitle"), state.title || "Untitled carton");
}

function syncDimensions() {
  setValue($("#lengthInput"), state.dimensions.length);
  setValue($("#widthInput"), state.dimensions.width);
  setValue($("#heightInput"), state.dimensions.height);
  const closed = validateClosedGeometry(state);
  $("#closureText").textContent = closed.closed
    ? "4-panel closure verified"
    : "Closure needs attention";
  document.querySelector(".closure-dot").style.background = closed.closed ? "#47926f" : "#e4572e";
}

function syncStructure() {
  setValue($("#glueRange"), state.structure.glueTab);
  setValue($("#foldRange"), state.structure.foldLineWidth);
  setValue($("#safeRange"), state.structure.safeMargin);
  $("#glueValue").textContent = `${Number(state.structure.glueTab).toFixed(1)} mm`;
  $("#foldValue").textContent = `${Number(state.structure.foldLineWidth).toFixed(2)} mm`;
  $("#safeValue").textContent = `${Number(state.structure.safeMargin).toFixed(1)} mm`;
  $$("#foldStyleControl button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.style === state.structure.foldStyle);
  });
}

function syncTemplateState() {
  $$(".template-card").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.template === state.template);
  });
}

function typeBadge(element) {
  if (element.type === "text") return "T";
  if (element.type === "image") return "I";
  return "S";
}

function syncLayerList() {
  const list = $("#layerList");
  list.replaceChildren();
  const rows = state.artwork.map((element, index) => ({ element, index })).reverse();
  rows.forEach(({ element, index }) => {
    const row = document.createElement("div");
    row.className = `layer-row${element.id === selectedId ? " is-selected" : ""}`;
    row.dataset.id = element.id;
    row.tabIndex = 0;
    row.setAttribute("role", "button");

    const badge = document.createElement("span");
    badge.className = "layer-type";
    badge.textContent = typeBadge(element);
    const name = document.createElement("span");
    name.className = "layer-name";
    name.textContent = element.name || element.text || "Artwork";
    const panel = document.createElement("span");
    panel.className = "layer-panel-tag";
    panel.textContent = String(element.panel || "").slice(0, 1).toUpperCase();
    const order = document.createElement("span");
    order.className = "layer-order";
    const up = document.createElement("button");
    up.type = "button";
    up.textContent = "↑";
    up.title = "Move layer up";
    up.dataset.move = "up";
    const down = document.createElement("button");
    down.type = "button";
    down.textContent = "↓";
    down.title = "Move layer down";
    down.dataset.move = "down";
    order.append(up, down);
    row.append(badge, name, panel, order);
    row.addEventListener("click", (event) => {
      if (event.target.closest("[data-move]")) return;
      selectElement(element.id);
    });
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectElement(element.id);
      }
    });
    up.addEventListener("click", (event) => {
      event.stopPropagation();
      moveLayer(element.id, 1);
    });
    down.addEventListener("click", (event) => {
      event.stopPropagation();
      moveLayer(element.id, -1);
    });
    list.append(row);
    void index;
  });
  $("#layerCount").textContent = state.artwork.length;
}

function syncSelection() {
  const element = state.artwork.find((item) => item.id === selectedId);
  $("#selectionEmpty").hidden = Boolean(element);
  $("#selectionEditor").hidden = !element;
  if (!element) {
    $("#selectionKind").textContent = "NONE";
    return;
  }
  $("#selectionKind").textContent = element.type.toUpperCase();
  setValue($("#elementName"), element.name || "");
  setValue($("#textContent"), element.text || "");
  setValue($("#fontSize"), element.fontSize || 12);
  setValue($("#fontWeight"), String(element.fontWeight || 500));
  setValue($("#textColor"), element.color || "#173b32");
  setValue($("#shapeColor"), element.color || "#e4572e");
  $("#textColorValue").textContent = String(element.color || "#173b32").toUpperCase();
  $("#shapeColorValue").textContent = String(element.color || "#e4572e").toUpperCase();
  setValue($("#transformX"), Math.round(element.x * 100));
  setValue($("#transformY"), Math.round(element.y * 100));
  setValue($("#transformW"), Math.round(element.w * 100));
  setValue($("#transformH"), Math.round(element.h * 100));
  setValue($("#rotationRange"), element.rotation || 0);
  $("#rotationValue").textContent = `${Math.round(element.rotation || 0)}°`;
  $("#textControls").hidden = element.type !== "text";
  $("#shapeControls").hidden = !["rect", "circle", "diamond", "rule"].includes(element.type);
  syncFontOptions(element);
}

function syncFontOptions(element) {
  const select = $("#fontFamily");
  const fonts = [
    ["DejaVu Sans", "DejaVu Sans"],
    ["DejaVu Serif", "DejaVu Serif"],
    ["DejaVu Sans Mono", "DejaVu Mono"],
    ["Ubuntu", "Ubuntu"],
  ];
  const custom = state.typography?.customFont;
  if (custom?.name && !fonts.some(([value]) => value === custom.name)) {
    fonts.push([custom.name, `${custom.name} (custom)`]);
  }
  const current = element?.fontFamily || state.typography.family || "DejaVu Sans";
  select.replaceChildren();
  fonts.forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.append(option);
  });
  if (!fonts.some(([value]) => value === current)) {
    const option = document.createElement("option");
    option.value = current;
    option.textContent = current;
    select.append(option);
  }
  setValue(select, current);
}

function syncKeyframes() {
  const track = $("#keyframeTrack");
  track.replaceChildren();
  const frames = [...state.foldKeyframes].sort((a, b) => a.progress - b.progress);
  frames.forEach((frame) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `keyframe${
      frame.id === state.preview.activeKeyframe ? " is-active" : ""
    }`;
    button.style.left = `${clamp(Number(frame.progress), 0, 100)}%`;
    button.title = `${frame.label} · ${Math.round(frame.progress)}%`;
    const label = document.createElement("span");
    label.textContent = frame.label;
    button.append(label);
    button.addEventListener("click", () => {
      applyChange(
        (next) => {
          next.preview.foldProgress = Number(frame.progress);
          next.preview.activeKeyframe = frame.id;
        },
        { key: "fold-progress" },
      );
    });
    track.append(button);
  });
  setValue($("#foldProgress"), state.preview.foldProgress);
  $("#foldProgressOut").textContent = `${Math.round(state.preview.foldProgress)}%`;
}

function syncFontMeta() {
  const custom = state.typography?.customFont;
  $("#fontMeta").textContent = custom
    ? `Font: ${custom.name} · embedded with project`
    : `Font: ${state.typography?.family || "DejaVu Sans"} · system`;
}

function syncCanvasStatus(validationScene) {
  const dieline = buildDieline(state);
  $("#netSize").textContent = `${dieline.netWidth.toFixed(0)} × ${dieline.netHeight.toFixed(0)} mm`;
  const validation = validateForExport(state, validationScene);
  const status = $("#safeStatus");
  const errors = validation.errors;
  const textErrors = errors.filter((issue) => issue.code === "text-overflow");
  status.classList.toggle("status-ok", errors.length === 0);
  status.classList.toggle("status-warn", errors.length > 0);
  if (textErrors.length) {
    status.querySelector("strong").textContent = `${textErrors.length} text issue${
      textErrors.length === 1 ? "" : "s"
    }`;
  } else if (errors.length) {
    status.querySelector("strong").textContent = `${errors.length} layout issue${
      errors.length === 1 ? "" : "s"
    }`;
  } else {
    status.querySelector("strong").textContent = "All artwork inside";
  }
}

function syncChecks(validationScene) {
  const validation = validateForExport(state, validationScene);
  const hasErrors = validation.errors.length > 0;
  const badge = $("#checkBadge");
  badge.textContent = hasErrors ? "REVIEW" : "READY";
  badge.classList.toggle("is-warn", hasErrors);
  const summary = $("#checkSummary");
  summary.classList.toggle("is-warn", hasErrors);
  summary.querySelector(".check-orb").textContent = hasErrors ? "!" : "✓";
  summary.querySelector("strong").textContent = hasErrors
    ? `${validation.errors.length} issue${validation.errors.length === 1 ? "" : "s"} to fix`
    : "Safe to export";
  summary.querySelector("p").textContent = hasErrors
    ? "Export will pause and show precise fixes."
    : "Margins, text frames and closed geometry verified.";
  const list = $("#issueList");
  list.replaceChildren();
  validation.issues.slice(0, 3).forEach((issue) => {
    const item = document.createElement("div");
    item.className = "issue-item";
    const title = document.createElement("strong");
    title.textContent = issue.title;
    const fix = document.createElement("span");
    fix.textContent = issue.fix;
    item.append(title, fix);
    list.append(item);
  });
  if (validation.issues.length > 3) {
    const more = document.createElement("div");
    more.className = "issue-item";
    more.textContent = `+ ${validation.issues.length - 3} more issue(s)`;
    list.append(more);
  }
}

function selectElement(id) {
  selectedId = id || null;
  syncLayerList();
  syncSelection();
  updateHistoryButtons();
  scheduleRender();
}

function moveLayer(id, direction) {
  const index = state.artwork.findIndex((element) => element.id === id);
  if (index < 0) return;
  const target = index + direction;
  if (target < 0 || target >= state.artwork.length) return;
  applyChange(
    (next) => {
      const [item] = next.artwork.splice(index, 1);
      next.artwork.splice(target, 0, item);
    },
    { key: `reorder-${id}` },
  );
  toast("Layer order changed · safety preserved");
}

function addTextElement() {
  const id = makeId("text");
  const next = {
    id,
    type: "text",
    name: "New label",
    panel: "front",
    x: 0.5,
    y: 0.52,
    w: 0.54,
    h: 0.14,
    text: "NEW LABEL",
    fontFamily: state.typography?.family || "DejaVu Sans",
    fontSize: 14,
    fontWeight: 700,
    color: "#173b32",
    letterSpacing: 0.2,
    rotation: 0,
    opacity: 1,
    visible: true,
  };
  applyChange((draft) => draft.artwork.push(next), {
    key: `add-text-${id}`,
    selectId: id,
  });
  toast("Text layer added · edit copy in Inspector");
}

function addShapeElement() {
  const id = makeId("shape");
  const next = {
    id,
    type: "rect",
    name: "Color block",
    panel: "front",
    x: 0.5,
    y: 0.74,
    w: 0.3,
    h: 0.08,
    color: "#e4572e",
    radius: 0.08,
    rotation: 0,
    opacity: 1,
    visible: true,
  };
  applyChange((draft) => draft.artwork.push(next), {
    key: `add-shape-${id}`,
    selectId: id,
  });
  toast("Shape layer added · fill and transform are editable");
}

async function handleImage(file) {
  try {
    const src = await prepareImage(file);
    const id = makeId("image");
    const asset = { id, name: file.name, src };
    const next = {
      id,
      type: "image",
      name: file.name.replace(/\.[^.]+$/, "") || "Image",
      panel: "front",
      x: 0.5,
      y: 0.52,
      w: 0.38,
      h: 0.2,
      src,
      rotation: 0,
      opacity: 1,
      visible: true,
    };
    applyChange(
      (draft) => {
        draft.images.push(asset);
        draft.artwork.push(next);
      },
      { key: `add-image-${id}`, selectId: id },
    );
    await loadImage(src);
    scheduleRender();
    toast("Image embedded and saved with the project");
  } catch (error) {
    showModal({
      kicker: "ASSET ERROR",
      title: "Image could not be loaded",
      body: [
        `The file was not added, so the current project was not changed.`,
        `Try a PNG, JPG, WebP or SVG smaller than 8 MB. ${error.message || ""}`,
      ],
      actions: [{ label: "Close", className: "cancel-btn" }],
    });
  }
}

function prepareImage(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Unsupported file type."));
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      reject(new Error("The source file is larger than 8 MB."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("Read failed."));
    reader.onload = () => {
      if (file.type === "image/svg+xml") {
        resolve(String(reader.result));
        return;
      }
      const image = new Image();
      image.onerror = () => reject(new Error("The image data is invalid."));
      image.onload = () => {
        const max = 900;
        const scale = Math.min(1, max / Math.max(image.width, image.height));
        const target = document.createElement("canvas");
        target.width = Math.max(1, Math.round(image.width * scale));
        target.height = Math.max(1, Math.round(image.height * scale));
        target.getContext("2d").drawImage(image, 0, 0, target.width, target.height);
        resolve(target.toDataURL("image/png"));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  if (imageCache.has(src)) return Promise.resolve(imageCache.get(src));
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      imageCache.set(src, image);
      resolve(image);
    };
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

function preloadImages() {
  (state.images || []).forEach((asset) => loadImage(asset.src).then(() => scheduleRender()));
  state.artwork
    .filter((element) => element.type === "image" && element.src)
    .forEach((element) => loadImage(element.src).then(() => scheduleRender()));
}

async function handleFont(file) {
  try {
    if (file.size > 5 * 1024 * 1024) {
      throw new Error("Font files must be 5 MB or smaller.");
    }
    const dataUrl = await readAsDataUrl(file);
    const name = file.name
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-zA-Z0-9_-]+/g, " ")
      .trim();
    if (!name) throw new Error("The font needs a usable family name.");
    const family = `Crease ${name}`;
    const face = new FontFace(family, `url(${dataUrl})`);
    await face.load();
    document.fonts.add(face);
    const selected = state.artwork.find((item) => item.id === selectedId);
    applyChange(
      (draft) => {
        draft.typography.customFont = { name: family, dataUrl };
        draft.typography.family = family;
        if (selected?.type === "text") selected.fontFamily = family;
      },
      { key: `font-${family}` },
    );
    await document.fonts.load(`16px "${family}"`);
    scheduleRender();
    toast("Custom font embedded · saved and reloadable");
  } catch (error) {
    showModal({
      kicker: "FONT ERROR",
      title: "Font could not be embedded",
      body: [
        "The font was not applied and no artwork was changed.",
        `Use a valid TTF, OTF, WOFF or WOFF2 file. ${error.message || ""}`,
      ],
      actions: [{ label: "Close", className: "cancel-btn" }],
    });
  }
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error("Read failed."));
    reader.readAsDataURL(file);
  });
}

function deleteSelected() {
  if (!selectedId) return;
  const element = state.artwork.find((item) => item.id === selectedId);
  if (!element) return;
  applyChange(
    (draft) => {
      draft.artwork = draft.artwork.filter((item) => item.id !== selectedId);
    },
    { key: `delete-${selectedId}`, selectId: null },
  );
  toast(`${element.name || "Element"} deleted · Ctrl+Z restores it`);
}

function toast(message, level = "info") {
  const item = document.createElement("div");
  item.className = `toast${level === "error" ? " is-error" : level === "warn" ? " is-warn" : ""}`;
  item.textContent = message;
  $("#toastStack").append(item);
  setTimeout(() => {
    item.style.opacity = "0";
    item.style.transform = "translateY(4px)";
    item.style.transition = "opacity 160ms ease, transform 160ms ease";
    setTimeout(() => item.remove(), 180);
  }, 2600);
}

function closeModal() {
  $("#modalBackdrop").hidden = true;
  $("#modalActions").replaceChildren();
}

function showModal({ kicker = "NOTICE", title, body = [], actions = [], extra = null }) {
  $("#modalKicker").textContent = kicker;
  $("#modalTitle").textContent = title;
  const bodyEl = $("#modalBody");
  bodyEl.replaceChildren();
  body.forEach((line) => {
    const p = document.createElement("p");
    p.textContent = line;
    bodyEl.append(p);
  });
  if (extra) bodyEl.append(extra);
  const actionEl = $("#modalActions");
  actionEl.replaceChildren();
  actions.forEach((action) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = action.className || "cancel-btn";
    button.textContent = action.label;
    button.addEventListener("click", async () => {
      if (action.keepOpen) {
        await action.onClick?.();
      } else {
        closeModal();
        await action.onClick?.();
      }
    });
    actionEl.append(button);
  });
  $("#modalBackdrop").hidden = false;
}

function showIssueModal(validation, format) {
  const issues = document.createElement("div");
  issues.className = "modal-issues";
  validation.issues.forEach((issue) => {
    const item = document.createElement("div");
    item.className = "modal-issue";
    const title = document.createElement("strong");
    title.textContent = issue.title;
    const detail = document.createElement("p");
    detail.textContent = issue.detail;
    const fix = document.createElement("p");
    fix.className = "fix";
    fix.textContent = `How to fix: ${issue.fix}`;
    item.append(title, detail, fix);
    issues.append(item);
  });
  const actions = [{ label: "Cancel", className: "cancel-btn" }];
  if (validation.errors.length) {
    actions.push({
      label: "Auto-fit & export",
      className: "confirm-btn",
      onClick: () => runAutoFit(() => performExport(format)),
    });
  } else {
    actions.push({
      label: `Export ${format.toUpperCase()} anyway`,
      className: "danger-confirm",
      onClick: () => performExport(format),
    });
    actions.unshift({
      label: "Auto-fit first",
      className: "confirm-btn",
      onClick: () => runAutoFit(() => performExport(format)),
    });
  }
  showModal({
    kicker: "OUTPUT CHECK",
    title: validation.errors.length
      ? "Export paused to protect your artwork"
      : "Review output warning",
    body: [
      validation.errors.length
        ? "Nothing has been downloaded. Text or geometry would be clipped in the current state."
        : "The geometry closes, but one or more checks need your attention before print.",
      "Auto-fit preserves every glyph and keeps all layers inside their panel safe areas.",
    ],
    extra: issues,
    actions,
  });
}

function runAutoFit(after) {
  const before = cloneState(state);
  const width = Math.max(640, Math.floor(canvas.clientWidth));
  const height = Math.max(520, Math.floor(canvas.clientHeight));
  const working = cloneState(state);
  const result = autoFitState(working, width, height, measureText);
  state = result.state;
  state.updatedAt = new Date().toISOString();
  pushHistory(before, selectedId);
  normalizeArtwork(state);
  syncAll();
  scheduleRender();
  scheduleAutosave();
  markDirty();
  preloadImages();
  if (!result.validation.ok) {
    showIssueModal(result.validation, currentFormat || "svg");
    return;
  }
  toast(
    result.notes.length
      ? `Auto-fit applied · ${result.notes[0]}`
      : "Auto-fit applied · all elements are inside safe areas",
  );
  if (after) setTimeout(after, 160);
}

let currentFormat = "svg";

function openExportFlow(format) {
  currentFormat = format;
  $("#exportMenu").hidden = true;
  const width = Math.max(640, Math.floor(canvas.clientWidth));
  const height = Math.max(520, Math.floor(canvas.clientHeight));
  const validationScene = createScene(state, width, height, { measureText });
  const validation = validateForExport(state, validationScene);
  if (!validation.ok || validation.warnings.length) {
    showIssueModal(validation, format);
    return;
  }
  performExport(format);
}

async function performExport(format) {
  try {
    const width = Math.max(640, Math.floor(canvas.clientWidth));
    const height = Math.max(520, Math.floor(canvas.clientHeight));
    await Promise.all((state.images || []).map((asset) => loadImage(asset.src)));
    await document.fonts.ready;
    const safeName = (state.title || "carton")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    if (format === "svg") {
      const svg = exportSvg(state, { width, height, measureText });
      downloadBlob(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), `${safeName}-dieline.svg`);
      toast("Editable SVG exported · text, shapes and font metadata retained");
    } else {
      const exportCanvas = document.createElement("canvas");
      const exportScene = createScene(state, width, height, { measureText, exportMode: true });
      renderScene(exportCanvas, exportScene, {
        dpr: 2,
        images: imageCache,
        selectedId: null,
      });
      const blob = await new Promise((resolve) => exportCanvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Canvas could not produce PNG data.");
      downloadBlob(blob, `${safeName}-dieline@2x.png`);
      toast("PNG exported at 2× · current dimensions and artwork preserved");
    }
  } catch (error) {
    showModal({
      kicker: "EXPORT ERROR",
      title: "Export could not be completed",
      body: [
        "The project is still open and no parameters were changed.",
        `${error.message || "Unknown error"}. Try exporting SVG, or reload the last saved project.`,
      ],
      actions: [{ label: "Close", className: "cancel-btn" }],
    });
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function pointerPosition(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * scene.width,
    y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * scene.height,
  };
}

function hitTest(point) {
  if (!scene) return null;
  const selectedScene = scene.flat.elements.find((element) => element.id === selectedId);
  if (selectedScene) {
    const handles = elementHandles(selectedScene);
    for (const [handle, handlePoint] of Object.entries(handles)) {
      if (
        Math.abs(point.x - handlePoint.x) <= HANDLE_SIZE &&
        Math.abs(point.y - handlePoint.y) <= HANDLE_SIZE
      ) {
        return { kind: "handle", handle, element: selectedScene };
      }
    }
  }
  for (const element of [...scene.flat.elements].reverse()) {
    if (element.visible === false) continue;
    const box = element.box;
    const pad = 3;
    if (
      point.x >= box.x - pad &&
      point.y >= box.y - pad &&
      point.x <= box.x + box.w + pad &&
      point.y <= box.y + box.h + pad
    ) {
      return { kind: "element", element };
    }
  }
  return null;
}

function beginPointer(event) {
  if (event.button !== 0 || !scene) return;
  const point = pointerPosition(event);
  const hit = hitTest(point);
  if (!hit) {
    if (selectedId) selectElement(null);
    return;
  }
  if (hit.element.id !== selectedId) selectElement(hit.element.id);
  const source = state.artwork.find((item) => item.id === hit.element.id);
  if (!source) return;
  const dieline = buildDieline(state);
  const box = elementBoxMm(source, dieline);
  drag = {
    kind: hit.kind,
    handle: hit.handle || null,
    elementId: source.id,
    startPoint: point,
    startElement: cloneState(source),
    startCenter: { x: box.x + box.w / 2, y: box.y + box.h / 2 },
    before: cloneState(state),
    beforeSelected: selectedId,
    moved: false,
  };
  canvas.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}

function movePointer(event) {
  if (!scene) return;
  const point = pointerPosition(event);
  if (!drag) {
    const hit = hitTest(point);
    if (hit?.kind === "handle") {
      const cursorMap = {
        nw: "nwse-resize",
        se: "nwse-resize",
        ne: "nesw-resize",
        sw: "nesw-resize",
        n: "ns-resize",
        s: "ns-resize",
        e: "ew-resize",
        w: "ew-resize",
      };
      canvas.style.cursor = cursorMap[hit.handle] || "pointer";
    } else {
      canvas.style.cursor = hit ? "move" : "crosshair";
    }
    return;
  }
  const dieline = buildDieline(state);
  const transform = scene.flat.transform;
  const dxMm = (point.x - drag.startPoint.x) / transform.scale;
  const dyMm = (point.y - drag.startPoint.y) / transform.scale;
  const index = state.artwork.findIndex((item) => item.id === drag.elementId);
  if (index < 0) return;
  let next;
  if (drag.kind === "element") {
    next = setElementCenterMm(
      drag.startElement,
      dieline,
      drag.startCenter.x + dxMm,
      drag.startCenter.y + dyMm,
    );
  } else {
    const safe = safeRectForPanel(drag.startElement.panel, dieline);
    const mmX = (point.x - transform.ox) / transform.scale;
    const mmY = (point.y - transform.oy) / transform.scale;
    const nx = (mmX - safe.x) / safe.w;
    const ny = (mmY - safe.y) / safe.h;
    next = resizeElementFromHandle(drag.startElement, nx, ny, drag.handle);
  }
  state.artwork[index] = normalizeElement(next);
  drag.moved = true;
  syncSelection();
  syncLayerList();
  scheduleRender();
  event.preventDefault();
}

function endPointer(event) {
  if (!drag) return;
  const changed = JSON.stringify(state.artwork) !== JSON.stringify(drag.before.artwork);
  canvas.releasePointerCapture?.(event.pointerId);
  if (changed) {
    pushHistory(drag.before, drag.beforeSelected);
    state.updatedAt = new Date().toISOString();
    markDirty();
    scheduleAutosave();
  }
  drag = null;
  scheduleRender();
}

function openTextEditor() {
  if (!selectedId) return;
  const element = state.artwork.find((item) => item.id === selectedId);
  if (!element || element.type !== "text") return;
  const textarea = $("#textContent");
  textarea.focus();
  textarea.select();
  toast("Text content is ready to edit in the Inspector");
}

function setZoom(next) {
  zoom = clamp(Math.round(next * 100) / 100, 0.75, 1.75);
  canvas.style.transformOrigin = "50% 50%";
  canvas.style.transform = `scale(${zoom})`;
  $("#zoomLabel").textContent = `${Math.round(zoom * 100)}%`;
}

function saveProject() {
  try {
    state.updatedAt = new Date().toISOString();
    const payload = { savedAt: new Date().toISOString(), state: cloneState(state) };
    const serialized = JSON.stringify(payload);
    localStorage.setItem(SAVE_KEY, serialized);
    savedSnapshot = serialized;
    savedAt = payload.savedAt;
    markDirty();
    toast("Project saved · dimensions, fonts, images and keyframes stored");
  } catch (error) {
    showModal({
      kicker: "SAVE ERROR",
      title: "Project is too large for local storage",
      body: [
        "Your canvas is unchanged, but the browser storage quota was exceeded.",
        "Use smaller images, remove unused media, or export editable SVG as a project backup.",
        error.message || "",
      ],
      actions: [{ label: "Close", className: "cancel-btn" }],
    });
  }
}

function restoreSavedProject() {
  if (!savedSnapshot) {
    showModal({
      kicker: "RELOAD",
      title: "No explicit save yet",
      body: [
        "Click Save before using Reload. Autosave only protects the current browser session.",
        "Reload restores the last saved dimensions, template, typography, images and fold keyframes together.",
      ],
      actions: [{ label: "Save now", className: "confirm-btn", onClick: saveProject }],
    });
    return;
  }
  try {
    const payload = JSON.parse(savedSnapshot);
    const raw = payload.state || payload;
    pushHistory(cloneState(state), selectedId);
    state = restoreState(raw) || createDefaultState();
    selectedId = null;
    normalizeArtwork(state);
    preloadImages();
    restoreCustomFont();
    syncAll();
    scheduleRender();
    scheduleAutosave();
    markDirty();
    toast("Last saved project reloaded");
  } catch (error) {
    showModal({
      kicker: "RELOAD ERROR",
      title: "Saved project could not be read",
      body: ["The current canvas is still open.", error.message || ""],
      actions: [{ label: "Close", className: "cancel-btn" }],
    });
  }
}

function keepSelectedInside() {
  const element = state.artwork.find((item) => item.id === selectedId);
  if (!element) return;
  const before = cloneState(state);
  const width = Math.max(640, Math.floor(canvas.clientWidth));
  const height = Math.max(520, Math.floor(canvas.clientHeight));
  let current = normalizeElement(element);
  for (let attempt = 0; attempt < 80 && current.type === "text"; attempt += 1) {
    const test = cloneState(state);
    test.artwork = test.artwork.map((item) => (item.id === current.id ? current : item));
    const testScene = createScene(test, width, height, { measureText });
    if (!testScene.flat.textIssues.some((item) => item.id === current.id)) break;
    current = {
      ...current,
      fontSize: Math.max(2.4, (current.fontSize || 10) * 0.9),
      w: Math.min(0.92, Math.max(current.w, 0.62)),
      h: Math.min(0.82, Math.max(current.h, 0.4)),
    };
  }
  const index = state.artwork.findIndex((item) => item.id === current.id);
  state.artwork[index] = normalizeElement(current);
  pushHistory(before, selectedId);
  syncAll();
  scheduleRender();
  scheduleAutosave();
  markDirty();
  toast("Selected layer kept inside its panel safe area");
}

function bindInputs() {
  const dimensionIds = [
    ["lengthInput", "length"],
    ["widthInput", "width"],
    ["heightInput", "height"],
  ];
  dimensionIds.forEach(([id, key]) => {
    $(`#${id}`).addEventListener("input", (event) => {
      const value = Number(event.target.value);
      if (!Number.isFinite(value) || value <= 0) return;
      applyChange((draft) => {
        draft.dimensions[key] = value;
        draft.template = "custom";
      }, { key: `dimension-${key}` });
    });
  });

  $("#glueRange").addEventListener("input", (event) => {
    applyChange((draft) => {
      draft.structure.glueTab = Number(event.target.value);
    }, { key: "glue" });
  });
  $("#foldRange").addEventListener("input", (event) => {
    applyChange((draft) => {
      draft.structure.foldLineWidth = Number(event.target.value);
    }, { key: "fold-line" });
  });
  $("#safeRange").addEventListener("input", (event) => {
    applyChange((draft) => {
      draft.structure.safeMargin = Number(event.target.value);
    }, { key: "safe-margin" });
  });
  $$("#foldStyleControl button").forEach((button) => {
    button.addEventListener("click", () => {
      applyChange((draft) => {
        draft.structure.foldStyle = button.dataset.style;
      }, { key: "fold-style" });
    });
  });
  $("#foldProgress").addEventListener("input", (event) => {
    applyChange((draft) => {
      draft.preview.foldProgress = Number(event.target.value);
      draft.preview.activeKeyframe = null;
    }, { key: "fold-progress" });
  });
  $("#docTitle").addEventListener("input", (event) => {
    applyChange((draft) => {
      draft.title = event.target.value;
    }, { key: "title" });
  });

  $$(".template-card").forEach((button) => {
    button.addEventListener("click", () => {
      const preset = PRESETS[button.dataset.template];
      if (!preset) return;
      replaceState(preset.create());
      toast(`${preset.label} loaded · ${preset.detail}`);
      if (button.dataset.template === "boundary") {
        setTimeout(() => {
          const width = Math.max(640, Math.floor(canvas.clientWidth));
          const height = Math.max(520, Math.floor(canvas.clientHeight));
          const validationScene = createScene(state, width, height, { measureText });
          const validation = validateForExport(state, validationScene);
          if (validation.issues.length) showIssueModal(validation, "svg");
        }, 220);
      }
    });
  });

  $("#addTextBtn").addEventListener("click", addTextElement);
  $("#addShapeBtn").addEventListener("click", addShapeElement);
  $("#imageFile").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (file) await handleImage(file);
    event.target.value = "";
  });
  $("#fontFile").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (file) await handleFont(file);
    event.target.value = "";
  });
  $("#keepAllSafeBtn").addEventListener("click", () => runAutoFit());
  $("#keepInsideBtn").addEventListener("click", keepSelectedInside);
  $("#deleteElementBtn").addEventListener("click", deleteSelected);

  $("#elementName").addEventListener("input", (event) => {
    updateSelected((element) => {
      element.name = event.target.value;
    }, "element-name");
  });
  $("#textContent").addEventListener("input", (event) => {
    updateSelected((element) => {
      element.text = event.target.value;
    }, `text-${selectedId}`);
  });
  $("#fontFamily").addEventListener("change", (event) => {
    updateSelected((element) => {
      element.fontFamily = event.target.value;
    }, "font-family");
  });
  $("#fontWeight").addEventListener("change", (event) => {
    updateSelected((element) => {
      element.fontWeight = Number(event.target.value);
    }, "font-weight");
  });
  $("#fontSize").addEventListener("input", (event) => {
    const value = Number(event.target.value);
    if (value < 2) return;
    updateSelected((element) => {
      element.fontSize = value;
    }, "font-size");
  });
  $("#textColor").addEventListener("input", (event) => {
    updateSelected((element) => {
      element.color = event.target.value;
    }, "text-color");
  });
  $("#shapeColor").addEventListener("input", (event) => {
    updateSelected((element) => {
      element.color = event.target.value;
    }, "shape-color");
  });
  ["transformX", "transformY", "transformW", "transformH"].forEach((id) => {
    $(`#${id}`).addEventListener("input", (event) => {
      const value = Number(event.target.value);
      if (!Number.isFinite(value) || value <= 0) return;
      updateSelected((element) => {
        const key = id.replace("transform", "").toLowerCase();
        element[key] = clamp(value / 100, 0.02, 1);
      }, `transform-${id}`);
    });
  });
  $("#rotationRange").addEventListener("input", (event) => {
    updateSelected((element) => {
      element.rotation = Number(event.target.value);
    }, "rotation");
  });
  $("#resetTransformBtn").addEventListener("click", () => {
    updateSelected((element) => {
      element.x = 0.5;
      element.y = 0.5;
      element.w = element.type === "text" ? 0.56 : 0.34;
      element.h = element.type === "text" ? 0.16 : 0.12;
      element.rotation = 0;
    }, "reset-transform");
  });

  $("#addKeyframeBtn").addEventListener("click", () => {
    const progress = Math.round(state.preview.foldProgress);
    if (state.foldKeyframes.some((frame) => Math.abs(frame.progress - progress) < 0.5)) {
      toast("A keyframe already exists at this fold position", "warn");
      return;
    }
    const id = makeId("kf");
    applyChange((draft) => {
      draft.foldKeyframes.push({ id, label: `${progress}%`, progress });
      draft.foldKeyframes.sort((a, b) => a.progress - b.progress);
      draft.preview.activeKeyframe = id;
    }, { key: `keyframe-${id}` });
    toast(`Fold keyframe saved at ${progress}%`);
  });

  $("#undoBtn").addEventListener("click", undo);
  $("#redoBtn").addEventListener("click", redo);
  $("#saveBtn").addEventListener("click", saveProject);
  $("#reloadBtn").addEventListener("click", restoreSavedProject);
  $("#resetDemoBtn").addEventListener("click", () => {
    replaceState(createDefaultState());
    toast("Default retail mailer restored");
  });
  $("#zoomOutBtn").addEventListener("click", () => setZoom(zoom - 0.1));
  $("#zoomInBtn").addEventListener("click", () => setZoom(zoom + 0.1));

  $("#exportButton").addEventListener("click", (event) => {
    event.stopPropagation();
    $("#exportMenu").hidden = !$("#exportMenu").hidden;
  });
  $("#exportSvgBtn").addEventListener("click", () => openExportFlow("svg"));
  $("#exportPngBtn").addEventListener("click", () => openExportFlow("png"));
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".export-wrap")) $("#exportMenu").hidden = true;
  });

  $("#modalBackdrop").addEventListener("click", (event) => {
    if (event.target === $("#modalBackdrop")) closeModal();
  });

  canvas.addEventListener("pointerdown", beginPointer);
  canvas.addEventListener("pointermove", movePointer);
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("dblclick", () => {
    if (selectedId) openTextEditor();
  });
}

function updateSelected(mutator, key) {
  const element = state.artwork.find((item) => item.id === selectedId);
  if (!element) return;
  applyChange((draft) => {
    const target = draft.artwork.find((item) => item.id === selectedId);
    if (target) mutator(target);
  }, { key });
}

function nudgeSelected(dx, dy) {
  if (!selectedId) return;
  const element = state.artwork.find((item) => item.id === selectedId);
  if (!element) return;
  applyChange(
    (draft) => {
      const target = draft.artwork.find((item) => item.id === selectedId);
      target.x += dx;
      target.y += dy;
      Object.assign(target, normalizeElement(target));
    },
    { key: "nudge" },
  );
}

function handleKeyboard(event) {
  const command = event.ctrlKey || event.metaKey;
  const tag = event.target.tagName;
  const editing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  if (event.key === "Escape") {
    if (!$("#modalBackdrop").hidden) closeModal();
    else if (!editing) selectElement(null);
    return;
  }
  if (command && event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveProject();
    return;
  }
  if (command && event.key.toLowerCase() === "o") {
    event.preventDefault();
    restoreSavedProject();
    return;
  }
  if (command && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
    return;
  }
  if (command && event.key.toLowerCase() === "y") {
    event.preventDefault();
    redo();
    return;
  }
  if (editing) return;
  if ((event.key === "Delete" || event.key === "Backspace") && selectedId) {
    event.preventDefault();
    deleteSelected();
    return;
  }
  const step = event.shiftKey ? 0.02 : 0.005;
  const directions = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  };
  if (directions[event.key] && selectedId) {
    event.preventDefault();
    nudgeSelected(...directions[event.key]);
  }
}

async function restoreCustomFont() {
  const custom = state.typography?.customFont;
  if (!custom?.name || !custom?.dataUrl) return;
  try {
    const face = new FontFace(custom.name, `url(${custom.dataUrl})`);
    await face.load();
    document.fonts.add(face);
    await document.fonts.load(`16px "${custom.name}"`);
    scheduleRender();
  } catch (error) {
    toast("Saved custom font could not be restored; system fallback is used", "warn");
    console.warn("Custom font restore failed", error);
  }
}

function initialize() {
  bindInputs();
  restoreCustomFont();
  preloadImages();
  syncAll();
  updateHistoryButtons();
  markDirty();
  requestAnimationFrame(renderNow);
  const observer = new ResizeObserver(() => scheduleRender());
  observer.observe(canvasWrap);
  window.addEventListener("resize", scheduleRender);
  document.addEventListener("keydown", handleKeyboard);
  setTimeout(() => {
    $("#canvasHint").style.opacity = "0.68";
  }, 4500);
}

initialize();
