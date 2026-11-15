export const MODEL_VERSION = 2;

export const FONT_PRESETS = [
  { id: "serif", name: "文楷印章", family: '"Stamp Serif", "Songti SC", "STSong", serif' },
  { id: "sans", name: "思源黑体", family: '"Stamp Sans", "PingFang SC", "Microsoft YaHei", sans-serif' }
];

export const COLOR_PRESETS = ["#A9232D", "#8C1F27", "#B73A2E", "#243B53", "#194D3A", "#302A2A"];

const transform = (x = 0, y = 0) => ({
  x,
  y,
  scale: 1,
  rotation: 0
});

const ring = (id, name, values) => ({
  id,
  type: "ring",
  name,
  visible: true,
  locked: false,
  opacity: 1,
  transform: transform(),
  ...values
});

const text = (id, name, values) => ({
  id,
  type: "text",
  name,
  visible: true,
  locked: false,
  opacity: 1,
  transform: transform(),
  fontId: "serif",
  fontWeight: 600,
  letterSpacing: 0,
  align: "center",
  ...values
});

const arcText = (id, name, values) => ({
  id,
  type: "arcText",
  name,
  visible: true,
  locked: false,
  opacity: 1,
  transform: transform(),
  fontId: "serif",
  fontWeight: 600,
  letterSpacing: 2,
  direction: "top",
  maxSpan: 172,
  ...values
});

const motif = (id, name, values) => ({
  id,
  type: "motif",
  name,
  visible: true,
  locked: false,
  opacity: 1,
  transform: transform(),
  variant: "diamond-rule",
  width: 160,
  size: 7,
  ...values
});

export const DEFAULT_ELEMENTS = () => [
  ring("outer-ring", "外圈与缺口", {
    radius: 305,
    width: 9.5,
    gapAngle: 352,
    gapSize: 4.5,
    accent: {
      enabled: true,
      offset: -16,
      width: 1.8,
      gapAngle: 352,
      gapSize: 3.2
    }
  }),
  arcText("arc-top", "上弧文字", {
    text: "匠心传承 · 品质永续",
    radius: 257,
    fontSize: 37,
    fontWeight: 600,
    letterSpacing: 4,
    direction: "top",
    maxSpan: 172
  }),
  arcText("arc-bottom", "下弧文字", {
    text: "SINCE 1987 · HANDCRAFTED",
    radius: 254,
    fontSize: 18,
    fontWeight: 500,
    letterSpacing: 2.8,
    direction: "bottom",
    fontId: "sans",
    maxSpan: 154
  }),
  ring("inner-ring", "内圈细线", {
    radius: 211,
    width: 2.2,
    gapAngle: 352,
    gapSize: 0,
    accent: {
      enabled: false,
      offset: 10,
      width: 1,
      gapAngle: 352,
      gapSize: 0
    }
  }),
  motif("motif-top", "上饰线", {
    variant: "diamond-rule",
    width: 158,
    size: 6,
    transform: transform(0, -57)
  }),
  text("center-text", "主字", {
    text: "臻品",
    fontSize: 68,
    fontWeight: 700,
    letterSpacing: 12,
    transform: transform(0, -4)
  }),
  motif("motif-bottom", "下饰线", {
    variant: "dots",
    width: 128,
    size: 3,
    transform: transform(0, 46)
  }),
  text("date-text", "日期", {
    text: "2026.11.16",
    fontSize: 23,
    fontWeight: 500,
    letterSpacing: 2.5,
    fontId: "sans",
    transform: transform(0, 88)
  })
];

export function createDefaultModel() {
  return {
    version: MODEL_VERSION,
    meta: {
      name: "匠心传承",
      template: "default",
      updatedAt: new Date().toISOString()
    },
    document: {
      size: 720,
      safeMargin: 36
    },
    style: {
      color: "#A9232D",
      seed: 81031,
      inkOpacity: 0.98,
      wear: 0.47,
      chips: 0.34
    },
    assets: {
      fonts: {},
      images: {}
    },
    elements: DEFAULT_ELEMENTS()
  };
}

export function createBoundaryModel() {
  const model = createDefaultModel();
  model.meta = {
    name: "边界 · 长文小尺寸",
    template: "boundary",
    updatedAt: new Date().toISOString()
  };
  model.document.size = 240;
  model.document.safeMargin = 18;
  model.style.seed = 271828;
  model.style.wear = 0.72;
  model.style.chips = 0.63;

  const byId = Object.fromEntries(model.elements.map((element) => [element.id, element]));
  byId["arc-top"].text = "国家级非物质文化遗产传统技艺传承创新示范单位";
  byId["arc-top"].fontSize = 36;
  byId["arc-top"].letterSpacing = 2;
  byId["arc-bottom"].text = "EXTREME-LONG-SAMPLE · STRESS-TEST · KEEP-EVERYTHING";
  byId["arc-bottom"].fontSize = 24;
  byId["arc-bottom"].letterSpacing = 4;
  byId["center-text"].text = "传承创新";
  byId["center-text"].fontSize = 23;
  byId["date-text"].text = "2026.11.16";
  byId["date-text"].fontSize = 8;

  for (const element of model.elements) {
    scaleElement(element, 1 / 3);
  }
  return model;
}

const LENGTH_KEYS = [
  "radius",
  "width",
  "fontSize",
  "letterSpacing",
  "size",
  "imageWidth"
];

export function scaleElement(element, ratio) {
  for (const key of LENGTH_KEYS) {
    if (typeof element[key] === "number") {
      element[key] *= ratio;
    }
  }
  for (const key of ["x", "y"]) {
    if (element.transform) element.transform[key] *= ratio;
  }
  if (element.accent) {
    element.accent.offset *= ratio;
    element.accent.width *= ratio;
  }
}

export function resizeModel(model, nextSize) {
  const next = cloneModel(model);
  const currentSize = next.document.size;
  const ratio = nextSize / currentSize;
  if (!Number.isFinite(ratio) || ratio <= 0) return next;
  for (const element of next.elements) {
    scaleElement(element, ratio);
  }
  next.document.size = nextSize;
  next.document.safeMargin = Math.max(12, Math.round(next.document.safeMargin * ratio));
  next.meta.updatedAt = new Date().toISOString();
  return next;
}

export function cloneModel(model) {
  return JSON.parse(JSON.stringify(model));
}

export function createImageElement(assetId, name, aspect = 1) {
  return {
    id: `image-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: "image",
    name: name || "装饰图片",
    visible: true,
    locked: false,
    opacity: 1,
    assetId,
    imageWidth: 150,
    aspect,
    transform: transform(0, -18)
  };
}

export function normalizeModel(input) {
  if (!input || typeof input !== "object") {
    throw new Error("设计文件为空或格式不正确。");
  }
  const fallback = createDefaultModel();
  const model = cloneModel(input);
  model.version = MODEL_VERSION;
  model.meta = { ...fallback.meta, ...(model.meta || {}) };
  model.document = { ...fallback.document, ...(model.document || {}) };
  model.style = { ...fallback.style, ...(model.style || {}) };
  model.assets = {
    fonts: { ...(model.assets?.fonts || {}) },
    images: { ...(model.assets?.images || {}) }
  };
  if (!Array.isArray(model.elements) || model.elements.length === 0) {
    model.elements = fallback.elements;
  }
  for (const element of model.elements) {
    element.transform = { ...transform(), ...(element.transform || {}) };
    element.visible = element.visible !== false;
    element.opacity = Number.isFinite(element.opacity) ? element.opacity : 1;
    if (element.type === "ring" && element.accent) {
      element.accent = { ...ring("x", "", {}).accent, ...element.accent };
    }
  }
  return model;
}

export const BUILTIN_TEMPLATE_DEFS = [
  {
    id: "builtin-default",
    name: "匠心传承",
    description: "默认双弧 · 720 px",
    mark: "印",
    builtin: true,
    factory: createDefaultModel
  },
  {
    id: "builtin-boundary",
    name: "边界案例",
    description: "长文 · 240 px · 磨损",
    mark: "界",
    builtin: true,
    factory: createBoundaryModel
  }
];
