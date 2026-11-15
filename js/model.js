import { DEFAULT_ADJUSTMENTS, normalizeAdjustments } from "./color.js";

export const SCENE_WIDTH = 1200;
export const SCENE_HEIGHT = 1500;
export const SAFE_MARGIN = 72;
export const MIN_EXPORT_WIDTH = 640;
export const SCHEMA_VERSION = 1;

export const FONT_OPTIONS = Object.freeze([
  {
    id: "serif-cn",
    name: "宋体衬线",
    stack: '"Noto Serif SC", "Songti SC", Georgia, serif',
  },
  {
    id: "sans-cn",
    name: "现代黑体",
    stack: 'Manrope, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
  },
  {
    id: "mono",
    name: "等宽记录",
    stack: '"DM Mono", "Noto Sans SC", "SFMono-Regular", Consolas, monospace',
  },
]);

export function getFontStack(fontId) {
  return FONT_OPTIONS.find((font) => font.id === fontId)?.stack || FONT_OPTIONS[0].stack;
}

export const BUILTIN_PRESETS = Object.freeze([
  {
    id: "builtin-dune",
    name: "暮色暖砂",
    builtin: true,
    params: {
      exposure: 0.18,
      temperature: 14,
      contrast: 8,
      shadowHue: 22,
      shadowStrength: 16,
      highlightHue: 42,
      highlightStrength: 22,
    },
  },
  {
    id: "builtin-mist",
    name: "冷雾青灰",
    builtin: true,
    params: {
      exposure: -0.06,
      temperature: -27,
      contrast: 13,
      shadowHue: 202,
      shadowStrength: 23,
      highlightHue: 47,
      highlightStrength: 9,
    },
  },
  {
    id: "builtin-copper",
    name: "落日铜金",
    builtin: true,
    params: {
      exposure: 0.3,
      temperature: 34,
      contrast: 19,
      shadowHue: 14,
      shadowStrength: 24,
      highlightHue: 45,
      highlightStrength: 31,
    },
  },
  {
    id: "builtin-silver",
    name: "银盐低饱和",
    builtin: true,
    params: {
      exposure: 0.02,
      temperature: -7,
      contrast: 25,
      shadowHue: 210,
      shadowStrength: 7,
      highlightHue: 35,
      highlightStrength: 4,
    },
  },
  {
    id: "builtin-soft",
    name: "柔光编辑",
    builtin: true,
    params: {
      exposure: 0.11,
      temperature: 8,
      contrast: -18,
      shadowHue: 29,
      shadowStrength: 11,
      highlightHue: 54,
      highlightStrength: 10,
    },
  },
  {
    id: "builtin-noir",
    name: "夜蓝胶片",
    builtin: true,
    params: {
      exposure: -0.16,
      temperature: -19,
      contrast: 31,
      shadowHue: 220,
      shadowStrength: 19,
      highlightHue: 198,
      highlightStrength: 15,
    },
  },
]);

let idCounter = 0;

export function createId(prefix = "element") {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

export function cloneState(value) {
  return JSON.parse(JSON.stringify(value));
}

function createText(overrides) {
  return {
    id: createId("text"),
    type: "text",
    name: "文字",
    text: "文字",
    x: 100,
    y: 100,
    width: 600,
    fontSize: 36,
    lineHeight: 1.35,
    letterSpacing: 0,
    fontId: "serif-cn",
    fontWeight: 400,
    color: "#f4eadb",
    textAlign: "left",
    opacity: 1,
    visible: true,
    ...overrides,
  };
}

function createShape(overrides) {
  return {
    id: createId("shape"),
    type: "shape",
    name: "图形",
    shape: "rect",
    x: 100,
    y: 100,
    width: 120,
    height: 120,
    fill: "transparent",
    stroke: "#f4eadb",
    strokeWidth: 2,
    opacity: 1,
    visible: true,
    ...overrides,
  };
}

function createDefaultElements() {
  return [
    createShape({
      id: "frame",
      name: "安全边框",
      shape: "rect",
      x: 76,
      y: 76,
      width: 1048,
      height: 1348,
      fill: "transparent",
      stroke: "#f2e5d1",
      strokeWidth: 2,
      opacity: 0.58,
    }),
    createText({
      id: "kicker",
      name: "顶部题注",
      text: "A STUDY IN LIGHT  /  01",
      x: 98,
      y: 108,
      width: 720,
      fontSize: 21,
      lineHeight: 1.3,
      letterSpacing: 6.5,
      fontId: "sans-cn",
      fontWeight: 500,
      color: "#f6ead8",
      opacity: 0.9,
    }),
    createText({
      id: "title",
      name: "主标题",
      text: "光的形状",
      x: 92,
      y: 865,
      width: 900,
      fontSize: 148,
      lineHeight: 1.12,
      letterSpacing: 2,
      fontId: "serif-cn",
      fontWeight: 500,
      color: "#f8eedc",
    }),
    createShape({
      id: "rule",
      name: "分隔线",
      shape: "line",
      x: 98,
      y: 1092,
      width: 318,
      height: 2,
      fill: "transparent",
      stroke: "#f2dfc3",
      strokeWidth: 2,
      opacity: 0.74,
    }),
    createText({
      id: "caption",
      name: "说明文字",
      text: "在沙丘与暮色之间，\n光留下了它的轮廓。",
      x: 98,
      y: 1135,
      width: 580,
      fontSize: 28,
      lineHeight: 1.65,
      letterSpacing: 1.5,
      fontId: "serif-cn",
      fontWeight: 400,
      color: "#f3e6d3",
      opacity: 0.94,
    }),
    createText({
      id: "meta",
      name: "地点标注",
      text: "36.27° N  ·  115.19° E",
      x: 98,
      y: 1342,
      width: 530,
      fontSize: 14,
      lineHeight: 1.5,
      letterSpacing: 4.2,
      fontId: "mono",
      fontWeight: 400,
      color: "#f1e3ce",
      opacity: 0.72,
    }),
  ];
}

export function createDefaultState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    projectName: "暮色沙丘",
    template: "dune-dusk",
    seed: 280419,
    params: normalizeAdjustments(DEFAULT_ADJUSTMENTS),
    elements: createDefaultElements(),
    export: {
      format: "png",
      width: 1200,
      height: 1500,
      safeMargin: SAFE_MARGIN,
    },
    view: {
      zoom: 1,
      showSafeGuides: true,
    },
    selectedId: "title",
    updatedAt: null,
  };
}

export function createBoundaryState() {
  const state = createDefaultState();
  const repeated =
    "当潮汐退去，礁石上的盐霜记录着每一次月升与回落，而我们仍试图把整片海装进一行文字。";
  state.projectName = "边界案例 · 长文本与极小导出";
  state.template = "tidal-blue";
  state.seed = 810237;
  state.params = normalizeAdjustments({
    exposure: -0.12,
    temperature: -24,
    contrast: 18,
    shadowHue: 207,
    shadowStrength: 24,
    highlightHue: 39,
    highlightStrength: 12,
  });
  state.elements = state.elements.map((element) => {
    if (element.id === "title") {
      return {
        ...element,
        name: "极端长文本",
        text: `${repeated}${repeated}${repeated}`,
        x: 76,
        y: 690,
        width: 920,
        fontSize: 168,
        lineHeight: 1.1,
        letterSpacing: 1,
      };
    }
    if (element.id === "caption") {
      return {
        ...element,
        text: "这段说明用于验证安全边距。\n长文本不应被静默裁切。",
        color: "#e9dfce",
      };
    }
    return { ...element, color: "#f2e9db" };
  });
  state.export = {
    format: "png",
    width: 48,
    height: 60,
    safeMargin: SAFE_MARGIN,
  };
  state.selectedId = "title";
  return state;
}

export const CASES = Object.freeze({
  default: {
    name: "默认案例",
    create: createDefaultState,
  },
  boundary: {
    name: "边界案例",
    create: createBoundaryState,
  },
});

function normalizeElement(element, index) {
  if (!element || (element.type !== "text" && element.type !== "shape")) {
    return null;
  }
  const base = {
    id: String(element.id || createId(element.type)),
    type: element.type,
    name: String(element.name || (element.type === "text" ? "文字" : "图形")),
    x: Number(element.x) || 0,
    y: Number(element.y) || 0,
    width: Math.max(1, Number(element.width) || 100),
    height: Math.max(1, Number(element.height) || 100),
    opacity: Number.isFinite(Number(element.opacity)) ? Number(element.opacity) : 1,
    visible: element.visible !== false,
  };
  if (element.type === "text") {
    return {
      ...base,
      text: String(element.text ?? "文字"),
      fontSize: Math.max(1, Number(element.fontSize) || 36),
      lineHeight: Math.max(0.5, Number(element.lineHeight) || 1.35),
      letterSpacing: Number(element.letterSpacing) || 0,
      fontId: FONT_OPTIONS.some((font) => font.id === element.fontId)
        ? element.fontId
        : FONT_OPTIONS[0].id,
      fontWeight: Number(element.fontWeight) || 400,
      color: String(element.color || "#f4eadb"),
      textAlign: ["left", "center", "right"].includes(element.textAlign)
        ? element.textAlign
        : "left",
    };
  }
  return {
    ...base,
    shape: ["rect", "line", "circle"].includes(element.shape) ? element.shape : "rect",
    fill: String(element.fill || "transparent"),
    stroke: String(element.stroke || "#f4eadb"),
    strokeWidth: Math.max(0, Number(element.strokeWidth) || 0),
  };
}

export function normalizeState(raw) {
  const fallback = createDefaultState();
  if (!raw || typeof raw !== "object") {
    return fallback;
  }
  const elements = Array.isArray(raw.elements)
    ? raw.elements.map(normalizeElement).filter(Boolean)
    : fallback.elements;
  const width = Math.max(16, Math.min(4800, Number(raw.export?.width) || 1200));
  return {
    schemaVersion: SCHEMA_VERSION,
    projectName: String(raw.projectName || fallback.projectName).slice(0, 80),
    template: raw.template === "tidal-blue" ? "tidal-blue" : "dune-dusk",
    seed: Number.isFinite(Number(raw.seed)) ? Math.abs(Number(raw.seed)) : 280419,
    params: normalizeAdjustments(raw.params),
    elements: elements.length ? elements : fallback.elements,
    export: {
      format: raw.export?.format === "svg" ? "svg" : "png",
      width,
      height: Math.round(width * 1.25),
      safeMargin: Math.max(24, Math.min(180, Number(raw.export?.safeMargin) || SAFE_MARGIN)),
    },
    view: {
      zoom: Math.max(0.4, Math.min(2, Number(raw.view?.zoom) || 1)),
      showSafeGuides: raw.view?.showSafeGuides !== false,
    },
    selectedId: elements.some((element) => element.id === raw.selectedId)
      ? raw.selectedId
      : elements[0]?.id || null,
    updatedAt: raw.updatedAt || null,
  };
}

export function snapshotProject(state) {
  const copy = cloneState(state);
  copy.selectedId = null;
  copy.view = { ...copy.view, zoom: 1, showSafeGuides: state.view?.showSafeGuides !== false };
  copy.updatedAt = null;
  return copy;
}
