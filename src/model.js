export const APP_VERSION = 1;
export const STORAGE_KEY = "aurelia.studio.projects.v1";
export const DRAFT_KEY = "aurelia.studio.draft.v1";

export const PALETTES = {
  cathedral: {
    name: "大教堂",
    swatch: ["#1a5c91", "#087668", "#ad2947", "#cf9327", "#60438f", "#173d69", "#8b315b", "#bd5b31", "#d8c79c"],
    colors: [
      { name: "青蓝", hex: "#1a5c91" },
      { name: "孔雀绿", hex: "#087668" },
      { name: "宝石红", hex: "#ad2947" },
      { name: "琥珀", hex: "#cf9327" },
      { name: "紫晶", hex: "#60438f" },
      { name: "深海", hex: "#173d69" },
      { name: "桑莓", hex: "#8b315b" },
      { name: "赤陶", hex: "#bd5b31" },
      { name: "珍珠", hex: "#d8c79c" }
    ]
  },
  dawn: {
    name: "晨雾",
    swatch: ["#648ca6", "#7ca68f", "#c98276", "#d7aa64", "#8a7d9d", "#496c82", "#a76c82", "#c88e65", "#e0d3b7"],
    colors: [
      { name: "雾蓝", hex: "#648ca6" },
      { name: "鼠尾草", hex: "#7ca68f" },
      { name: "珊瑚", hex: "#c98276" },
      { name: "蜂蜜", hex: "#d7aa64" },
      { name: "灰紫", hex: "#8a7d9d" },
      { name: "石板蓝", hex: "#496c82" },
      { name: "玫瑰灰", hex: "#a76c82" },
      { name: "杏色", hex: "#c88e65" },
      { name: "象牙", hex: "#e0d3b7" }
    ]
  },
  nocturne: {
    name: "夜祷",
    swatch: ["#24486b", "#27645e", "#722a49", "#b17b2c", "#4c3d70", "#18344f", "#5d294a", "#7d4932", "#b9b096"],
    colors: [
      { name: "午夜蓝", hex: "#24486b" },
      { name: "冷杉", hex: "#27645e" },
      { name: "勃艮第", hex: "#722a49" },
      { name: "旧金", hex: "#b17b2c" },
      { name: "鸢尾", hex: "#4c3d70" },
      { name: "墨蓝", hex: "#18344f" },
      { name: "酒红", hex: "#5d294a" },
      { name: "栗棕", hex: "#7d4932" },
      { name: "月白", hex: "#b9b096" }
    ]
  }
};

export const SHAPE_OPTIONS = [
  { id: "rose", label: "玫瑰" },
  { id: "circle", label: "正圆" },
  { id: "diamond", label: "菱形" },
  { id: "star", label: "星芒" },
  { id: "flower", label: "花冠" },
  { id: "heart", label: "心形" },
  { id: "sunburst", label: "日轮" }
];

export const FONT_OPTIONS = [
  {
    id: "classic",
    label: "古典衬线",
    family: '"Aurelia Serif SC", Georgia, "Times New Roman", serif',
    weight: "500"
  },
  {
    id: "display",
    label: "高对比展示",
    family: '"Aurelia Serif SC", "Bodoni 72", Didot, "Times New Roman", serif',
    weight: "600"
  },
  {
    id: "humanist",
    label: "人文无衬线",
    family: '"Aurelia Sans SC", "Avenir Next", "Segoe UI", Arial, sans-serif',
    weight: "500"
  },
  {
    id: "mono",
    label: "铭文等宽",
    family: '"Aurelia Sans SC", "Courier New", Courier, monospace',
    weight: "600"
  }
];

const DEFAULT_LIGHT_FRAMES = [
  { id: "dawn", label: "A", time: 0, x: 0.42, y: 0.32, intensity: 0.82, warmth: 0.72 },
  { id: "noon", label: "B", time: 0.5, x: 0.54, y: 0.27, intensity: 0.95, warmth: 0.5 },
  { id: "dusk", label: "C", time: 1, x: 0.62, y: 0.4, intensity: 0.68, warmth: 0.92 }
];

export function createDefaultState() {
  return {
    version: APP_VERSION,
    id: "dawn-rose",
    name: "晨光玫瑰",
    templateId: "dawn-rose",
    seed: 7362026,
    canvas: { width: 900, height: 1120, safeMargin: 52 },
    window: {
      x: 0,
      y: 0,
      scale: 1,
      shape: "rose",
      rings: 5,
      pieceSize: 0.62,
      border: 9,
      rotation: -8,
      palette: "cathedral",
      glassOpacity: 0.93
    },
    ornament: { scale: 1, offsetX: 0, offsetY: 0 },
    typography: {
      title: "晨光玫瑰",
      subtitle: "AURELIA · STUDY NO. 07",
      footer: "PROGRAMMATIC STAINED GLASS · MMXXVI",
      fontId: "classic",
      fontSize: 54,
      subtitleSize: 13,
      footerSize: 10,
      titleColor: "#f2e4bd",
      subtitleColor: "#c4b488",
      footerColor: "#857a61",
      letterSpacing: 0,
      offsetX: 0,
      offsetY: 0,
      layout: "balanced",
      maxLines: 3,
      showSubtitle: true,
      showFooter: true,
      customFont: null
    },
    image: { dataUrl: null, name: "", opacity: 0.24, scale: 1, offsetX: 0, offsetY: 0 },
    light: {
      x: 0.46,
      y: 0.31,
      intensity: 0.84,
      warmth: 0.7,
      animate: false,
      cycleMs: 9000,
      currentFrame: 0,
      keyframes: structuredClone(DEFAULT_LIGHT_FRAMES)
    },
    layers: {
      glow: true,
      rings: true,
      center: true,
      title: true,
      subtitle: true,
      footer: true,
      image: true
    },
    meta: { createdAt: null, updatedAt: null }
  };
}

export function createNarrowBoundaryState() {
  const state = createDefaultState();
  state.id = "narrow-choir";
  state.name = "窄窗合唱";
  state.templateId = "narrow-choir";
  state.seed = 42078011;
  state.canvas = { width: 360, height: 720, safeMargin: 24 };
  state.window = {
    ...state.window,
    scale: 0.96,
    shape: "flower",
    rings: 8,
    pieceSize: 0.32,
    border: 3.2,
    rotation: 12,
    palette: "dawn",
    glassOpacity: 0.9
  };
  state.typography = {
    ...state.typography,
    title: "窄窗合唱",
    subtitle: "EDGE STUDY · 360 × 720",
    footer: "MINIMUM FORMAT · 3.2 PX LEAD",
    fontId: "humanist",
    fontSize: 34,
    subtitleSize: 8,
    footerSize: 6,
    titleColor: "#eee0b9",
    layout: "compact",
    letterSpacing: 1.2
  };
  state.light = {
    ...state.light,
    x: 0.55,
    y: 0.3,
    intensity: 0.78,
    warmth: 0.56,
    keyframes: structuredClone(DEFAULT_LIGHT_FRAMES)
  };
  return state;
}

export function createLongTextBoundaryState() {
  const state = createNarrowBoundaryState();
  state.id = "overflow-check";
  state.name = "长题校验";
  state.templateId = "overflow-check";
  state.seed = 73642001;
  state.canvas = { width: 420, height: 780, safeMargin: 28 };
  state.window.rings = 6;
  state.window.pieceSize = 0.55;
  state.window.palette = "nocturne";
  state.window.rotation = -18;
  state.typography = {
    ...state.typography,
    title: "愿每一束穿越长夜的光都能被温柔地看见并在清晨抵达远方的窗前",
    subtitle: "STRESS TEST · INTENTIONALLY LONG INSCRIPTION",
    fontSize: 58,
    subtitleSize: 12,
    layout: "balanced",
    maxLines: 2,
    letterSpacing: 0.4
  };
  return state;
}

export const PRESETS = [
  {
    id: "dawn-rose",
    name: "晨光玫瑰",
    tag: "默认案例",
    description: "五重环带与玫瑰心，暖光从左上穿透。",
    create: createDefaultState
  },
  {
    id: "narrow-choir",
    name: "窄窗合唱",
    tag: "边界案例",
    description: "360 × 720 极小画幅，八重环带与 3.2px 铅条。",
    create: createNarrowBoundaryState
  },
  {
    id: "overflow-check",
    name: "长题校验",
    tag: "压力案例",
    description: "故意超限的长标题，用来验证导出拦截与修复提示。",
    create: createLongTextBoundaryState
  }
];

export function cloneState(state) {
  return structuredClone(state);
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function hashString(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createRng(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

export function shadeColor(hex, amount) {
  const value = hex.replace("#", "");
  const source = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
  const target = amount < 0 ? 0 : 255;
  const ratio = Math.abs(amount);
  const channels = source.map((channel) => Math.round(channel + (target - channel) * ratio));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

export function getFont(state) {
  if (state.typography.fontId === "custom" && state.typography.customFont?.family) {
    return {
      id: "custom",
      label: state.typography.customFont.name || "自定义字体",
      family: `"${state.typography.customFont.family}", Georgia, serif`,
      weight: "500"
    };
  }
  return FONT_OPTIONS.find((font) => font.id === state.typography.fontId) || FONT_OPTIONS[0];
}

export function getPalette(state) {
  return PALETTES[state.window.palette] || PALETTES.cathedral;
}

function sanitizeNumber(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? clamp(number, min, max) : fallback;
}

function sanitizeText(value, fallback, limit = 2000) {
  return typeof value === "string" ? value.slice(0, limit) : fallback;
}

function sanitizeColor(value, fallback) {
  return typeof value === "string" && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value)
    ? value
    : fallback;
}

function sanitizeImageDataUrl(value) {
  return typeof value === "string" &&
    /^data:image\/(?:png|jpeg|webp|gif|avif);base64,[a-z0-9+/=]+$/i.test(value)
    ? value
    : null;
}

function sanitizeFontDataUrl(value) {
  return typeof value === "string" &&
    /^data:(?:font|application)\/(?:woff2|woff|ttf|otf|x-font-[a-z0-9.+-]+|octet-stream);base64,[a-z0-9+/=]+$/i.test(value)
    ? value
    : null;
}

export function normalizeState(raw) {
  const base = createDefaultState();
  if (!raw || typeof raw !== "object") return base;
  const canvas = raw.canvas || {};
  const windowState = raw.window || {};
  const typography = raw.typography || {};
  const image = raw.image || {};
  const light = raw.light || {};
  const layers = raw.layers || {};

  const width = sanitizeNumber(canvas.width, base.canvas.width, 240, 2000);
  const height = sanitizeNumber(canvas.height, base.canvas.height, 360, 2400);
  const safeMargin = sanitizeNumber(
    canvas.safeMargin,
    base.canvas.safeMargin,
    10,
    Math.min(width, height) * 0.2
  );

  const frames = Array.isArray(light.keyframes) && light.keyframes.length >= 2
    ? light.keyframes.slice(0, 6).map((frame, index) => ({
        id: sanitizeText(frame?.id, `frame-${index}`, 40),
        label: sanitizeText(frame?.label, String.fromCharCode(65 + index), 4),
        time: sanitizeNumber(frame?.time, index / 2, 0, 1),
        x: sanitizeNumber(frame?.x, 0.5, -0.2, 1.2),
        y: sanitizeNumber(frame?.y, 0.35, -0.2, 1.2),
        intensity: sanitizeNumber(frame?.intensity, 0.8, 0, 1),
        warmth: sanitizeNumber(frame?.warmth, 0.6, 0, 1)
      }))
    : structuredClone(base.light.keyframes);
  frames.sort((a, b) => a.time - b.time);

  const customFont = typography.customFont;
  const fontDataUrl = sanitizeFontDataUrl(customFont?.dataUrl);
  const validCustomFont = fontDataUrl
    ? {
        name: sanitizeText(customFont.name, "自定义字体", 80),
        family: /^[a-z][a-z0-9_-]{0,79}$/i.test(customFont.family)
          ? customFont.family
          : "AureliaCustom",
        dataUrl: fontDataUrl
      }
    : null;

  return {
    ...base,
    version: APP_VERSION,
    id: sanitizeText(raw.id, base.id, 80),
    name: sanitizeText(raw.name, base.name, 120),
    templateId: sanitizeText(raw.templateId, "custom", 80),
    seed: Number.isFinite(Number(raw.seed)) ? Number(raw.seed) >>> 0 : base.seed,
    canvas: { width, height, safeMargin },
    window: {
      x: sanitizeNumber(windowState.x, 0, -400, 400),
      y: sanitizeNumber(windowState.y, 0, -400, 400),
      scale: sanitizeNumber(windowState.scale, 1, 0.55, 1.12),
      shape: SHAPE_OPTIONS.some((item) => item.id === windowState.shape)
        ? windowState.shape
        : base.window.shape,
      rings: Math.round(sanitizeNumber(windowState.rings, base.window.rings, 2, 14)),
      pieceSize: sanitizeNumber(windowState.pieceSize, base.window.pieceSize, 0.18, 1),
      border: sanitizeNumber(windowState.border, base.window.border, 1.5, 22),
      rotation: sanitizeNumber(windowState.rotation, base.window.rotation, -180, 180),
      palette: PALETTES[windowState.palette] ? windowState.palette : base.window.palette,
      glassOpacity: sanitizeNumber(windowState.glassOpacity, base.window.glassOpacity, 0.5, 1)
    },
    ornament: {
      scale: sanitizeNumber(raw.ornament?.scale, base.ornament.scale, 0.55, 1.12),
      offsetX: sanitizeNumber(raw.ornament?.offsetX, 0, -300, 300),
      offsetY: sanitizeNumber(raw.ornament?.offsetY, 0, -300, 300)
    },
    typography: {
      title: sanitizeText(typography.title, base.typography.title),
      subtitle: sanitizeText(typography.subtitle, base.typography.subtitle, 500),
      footer: sanitizeText(typography.footer, base.typography.footer, 500),
      fontId: typography.fontId === "custom" && validCustomFont
        ? "custom"
        : FONT_OPTIONS.some((font) => font.id === typography.fontId)
          ? typography.fontId
          : base.typography.fontId,
      fontSize: sanitizeNumber(typography.fontSize, base.typography.fontSize, 8, 180),
      subtitleSize: sanitizeNumber(typography.subtitleSize, base.typography.subtitleSize, 5, 48),
      footerSize: sanitizeNumber(typography.footerSize, base.typography.footerSize, 5, 40),
      titleColor: sanitizeColor(typography.titleColor, base.typography.titleColor),
      subtitleColor: sanitizeColor(typography.subtitleColor, base.typography.subtitleColor),
      footerColor: sanitizeColor(typography.footerColor, base.typography.footerColor),
      letterSpacing: sanitizeNumber(typography.letterSpacing, 0, -3, 24),
      offsetX: sanitizeNumber(typography.offsetX, 0, -500, 500),
      offsetY: sanitizeNumber(typography.offsetY, 0, -500, 500),
      layout: ["balanced", "airy", "compact"].includes(typography.layout)
        ? typography.layout
        : "balanced",
      maxLines: Math.round(sanitizeNumber(typography.maxLines, 3, 1, 6)),
      showSubtitle: typography.showSubtitle !== false,
      showFooter: typography.showFooter !== false,
      customFont: validCustomFont
    },
    image: {
      dataUrl: sanitizeImageDataUrl(image.dataUrl),
      name: sanitizeText(image.name, "", 160),
      opacity: sanitizeNumber(image.opacity, base.image.opacity, 0, 1),
      scale: sanitizeNumber(image.scale, 1, 0.5, 2),
      offsetX: sanitizeNumber(image.offsetX, 0, -300, 300),
      offsetY: sanitizeNumber(image.offsetY, 0, -300, 300)
    },
    light: {
      x: sanitizeNumber(light.x, base.light.x, 0, 1),
      y: sanitizeNumber(light.y, base.light.y, 0, 1),
      intensity: sanitizeNumber(light.intensity, base.light.intensity, 0, 1),
      warmth: sanitizeNumber(light.warmth, base.light.warmth, 0, 1),
      animate: Boolean(light.animate),
      cycleMs: sanitizeNumber(light.cycleMs, base.light.cycleMs, 1500, 30000),
      currentFrame: Math.round(sanitizeNumber(light.currentFrame, 0, 0, frames.length - 1)),
      keyframes: frames
    },
    layers: {
      glow: layers.glow !== false,
      rings: layers.rings !== false,
      center: layers.center !== false,
      title: layers.title !== false,
      subtitle: layers.subtitle !== false,
      footer: layers.footer !== false,
      image: layers.image !== false
    },
    meta: {
      createdAt: raw.meta?.createdAt || null,
      updatedAt: raw.meta?.updatedAt || null
    }
  };
}

function polar(cx, cy, radius, angle) {
  return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
}

function rotatePoint(point, cx, cy, degrees) {
  if (!degrees) return point;
  const angle = (degrees * Math.PI) / 180;
  const dx = point.x - cx;
  const dy = point.y - cy;
  return {
    x: cx + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: cy + dx * Math.sin(angle) + dy * Math.cos(angle)
  };
}

function sampleArc(cx, cy, fromAngle, fromRadius, toAngle, toRadius, steps) {
  const points = [];
  for (let step = 0; step < steps; step += 1) {
    const t = steps === 1 ? 0 : step / (steps - 1);
    const angle = fromAngle + (toAngle - fromAngle) * t;
    const radius = fromRadius + (toRadius - fromRadius) * t;
    points.push(polar(cx, cy, radius, angle));
  }
  return points;
}

export function pointsToPath(points, close = true) {
  if (!points?.length) return "";
  const [first, ...rest] = points;
  const body = rest.map((point) => `L ${round(point.x, 2)} ${round(point.y, 2)}`).join(" ");
  return `M ${round(first.x, 2)} ${round(first.y, 2)} ${body}${close ? " Z" : ""}`;
}

export function boundsOfPoints(points) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys)
  };
}

function expandBounds(bounds, amount) {
  return {
    left: bounds.left - amount,
    top: bounds.top - amount,
    right: bounds.right + amount,
    bottom: bounds.bottom + amount,
    width: bounds.width + amount * 2,
    height: bounds.height + amount * 2
  };
}

function unionBounds(items) {
  const filtered = items.filter(Boolean);
  if (!filtered.length) return null;
  const left = Math.min(...filtered.map((bounds) => bounds.left));
  const top = Math.min(...filtered.map((bounds) => bounds.top));
  const right = Math.max(...filtered.map((bounds) => bounds.right));
  const bottom = Math.max(...filtered.map((bounds) => bounds.bottom));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export function makeShapePoints(shape, radius, rotation = 0) {
  const points = [];
  if (shape === "diamond") {
    points.push({ x: 0, y: -radius }, { x: radius, y: 0 }, { x: 0, y: radius }, { x: -radius, y: 0 });
  } else if (shape === "star") {
    const count = 5;
    for (let index = 0; index < count * 2; index += 1) {
      const angle = -Math.PI / 2 + (index * Math.PI) / count;
      const pointRadius = index % 2 === 0 ? radius : radius * 0.46;
      points.push(polar(0, 0, pointRadius, angle));
    }
  } else if (shape === "flower") {
    const count = 96;
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2;
      const pointRadius = radius * (0.84 + 0.16 * Math.cos(angle * 6));
      points.push(polar(0, 0, pointRadius, angle));
    }
  } else if (shape === "heart") {
    const count = 96;
    for (let index = 0; index < count; index += 1) {
      const t = (index / count) * Math.PI * 2;
      const rawX = 16 * Math.sin(t) ** 3;
      const rawY = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
      points.push({ x: (rawX / 18) * radius, y: (rawY / 18) * radius });
    }
  } else if (shape === "sunburst") {
    const count = 12;
    for (let index = 0; index < count * 2; index += 1) {
      const angle = -Math.PI / 2 + (index * Math.PI) / count;
      points.push(polar(0, 0, index % 2 === 0 ? radius : radius * 0.7, angle));
    }
  } else {
    const count = 96;
    for (let index = 0; index < count; index += 1) {
      points.push(polar(0, 0, radius, (index / count) * Math.PI * 2));
    }
  }
  return points.map((point) => rotatePoint(point, 0, 0, rotation));
}

function defaultMeasureText(text, size, family, weight, letterSpacing) {
  let width = 0;
  for (const character of Array.from(text)) {
    if (/[\u2e80-\u9fff\uff00-\uffef]/u.test(character)) width += size;
    else if (/\s/.test(character)) width += size * 0.3;
    else if (/[A-Z0-9]/.test(character)) width += size * 0.63;
    else width += size * 0.52;
  }
  return width + Math.max(0, Array.from(text).length - 1) * letterSpacing;
}

function wrapTitle(text, maxWidth, measureLine) {
  const paragraphs = String(text || "").split(/\n/);
  const lines = [];
  for (const paragraph of paragraphs) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    const characters = Array.from(paragraph);
    let line = "";
    for (const character of characters) {
      const candidate = line + character;
      if (line && measureLine(candidate) > maxWidth) {
        lines.push(line.trimEnd());
        line = character.trimStart();
      } else {
        line = candidate;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines.length ? lines : [""];
}

function makeTextNode({ text, x, baseline, size, family, weight, letterSpacing, color, align, role, measure }) {
  const width = Math.max(1, measure(text, size, letterSpacing));
  return {
    role,
    text,
    x,
    baseline,
    size,
    family,
    weight,
    letterSpacing,
    color,
    align,
    width,
    bounds: {
      left: x - width / 2,
      top: baseline - size * 0.9,
      right: x + width / 2,
      bottom: baseline + size * 0.24,
      width,
      height: size * 1.14
    }
  };
}

function layoutTypography(state, safeRect, measureText) {
  const font = getFont(state);
  const typography = state.typography;
  const measure = (text, size, letterSpacing = typography.letterSpacing) =>
    measureText(text, size, font.family, font.weight, letterSpacing);

  const maxTitleWidth = safeRect.width - Math.max(28, safeRect.width * 0.075);
  const rawLines = wrapTitle(typography.title, maxTitleWidth, (line) =>
    measure(line, typography.fontSize)
  );
  const lineHeight = typography.fontSize * 1.13;
  const layoutSpacing = {
    balanced: { bottom: 28, footer: 34, title: 46 },
    airy: { bottom: 36, footer: 44, title: 66 },
    compact: { bottom: 20, footer: 28, title: 30 }
  }[typography.layout];

  const footerBaseline = safeRect.bottom - layoutSpacing.bottom;
  let subtitleBaseline;
  let lastTitleBaseline;
  if (typography.showFooter && typography.footer) {
    subtitleBaseline = footerBaseline - layoutSpacing.footer;
    lastTitleBaseline = subtitleBaseline - layoutSpacing.title;
  } else if (typography.showSubtitle && typography.subtitle) {
    subtitleBaseline = footerBaseline;
    lastTitleBaseline = subtitleBaseline - layoutSpacing.title;
  } else {
    subtitleBaseline = null;
    lastTitleBaseline = footerBaseline - 18;
  }

  const centerX = safeRect.left + safeRect.width / 2 + typography.offsetX;
  const offsetY = typography.offsetY;
  const titleNodes = rawLines.map((line, index) =>
    makeTextNode({
      text: line,
      x: centerX,
      baseline: lastTitleBaseline - (rawLines.length - 1 - index) * lineHeight + offsetY,
      size: typography.fontSize,
      family: font.family,
      weight: font.weight,
      letterSpacing: typography.letterSpacing,
      color: typography.titleColor,
      align: "center",
      role: "title",
      measure
    })
  );
  const subtitleNode = typography.subtitle
    ? makeTextNode({
        text: typography.subtitle,
        x: centerX,
        baseline: (subtitleBaseline ?? footerBaseline) + offsetY,
        size: typography.subtitleSize,
        family: font.family,
        weight: font.weight,
        letterSpacing: Math.max(typography.letterSpacing, typography.subtitleSize * 0.12),
        color: typography.subtitleColor,
        align: "center",
        role: "subtitle",
        measure
      })
    : null;
  const footerNode = typography.footer
    ? makeTextNode({
        text: typography.footer,
        x: centerX,
        baseline: footerBaseline + offsetY,
        size: typography.footerSize,
        family: font.family,
        weight: font.weight,
        letterSpacing: Math.max(typography.letterSpacing, typography.footerSize * 0.16),
        color: typography.footerColor,
        align: "center",
        role: "footer",
        measure
      })
    : null;

  const visibleNodes = [
    ...(state.layers.title ? titleNodes : []),
    ...(state.layers.subtitle ? [subtitleNode] : []),
    ...(state.layers.footer ? [footerNode] : [])
  ].filter(Boolean);

  return {
    font,
    titleLines: rawLines,
    titleNodes,
    subtitleNode,
    footerNode,
    maxTitleWidth,
    lineHeight,
    overflow: rawLines.length > typography.maxLines,
    maxLines: typography.maxLines,
    bounds: unionBounds(visibleNodes.map((node) => node.bounds)),
    divider: {
      y: (lastTitleBaseline + (subtitleBaseline ?? lastTitleBaseline + 28)) / 2 + offsetY,
      x: centerX,
      width: Math.min(92, safeRect.width * 0.16)
    }
  };
}

function angularOverlap(first, second) {
  return Math.max(0, Math.min(first[1], second[1]) - Math.max(first[0], second[0]));
}

function chooseGlassColor({ candidates, neighborColors, counts, rng }) {
  const allowed = candidates.filter((index) => !neighborColors.has(index));
  const pool = allowed.length ? allowed : candidates;
  const minimum = Math.min(...pool.map((index) => counts[index] || 0));
  const balanced = pool.filter((index) => (counts[index] || 0) <= minimum + 1);
  return balanced[Math.floor(rng() * balanced.length)];
}

function buildOuterCells(state, cx, cy, coreRadius, radius, rng, palette) {
  const rings = state.window.rings;
  const ringSpan = radius - coreRadius;
  const allCells = [];
  const coverageByRing = [];

  for (let ring = 0; ring < rings; ring += 1) {
    const r0 = coreRadius + ringSpan * (ring / rings);
    const r1 = coreRadius + ringSpan * ((ring + 1) / rings);
    const middleRadius = (r0 + r1) / 2;
    const targetWidth = radius * (0.12 + state.window.pieceSize * 0.18);
    const count = Math.round(clamp((Math.PI * 2 * middleRadius) / targetWidth, 5, 50));
    const step = (Math.PI * 2) / count;
    const phase = ((state.seed + ring * 73) % 360) * (Math.PI / 180) * 0.03 + step * 0.12;
    const radialJitter = Math.min(ringSpan * 0.12, targetWidth * 0.1);
    const boundaries = [];

    for (let boundary = 0; boundary <= count; boundary += 1) {
      const isEnd = boundary === count;
      const isStart = boundary === 0;
      const jitter = isEnd || isStart ? 0 : (rng() - 0.5) * step * 0.24;
      const innerWobble = ring === 0 ? 0 : (rng() - 0.5) * radialJitter;
      const outerWobble = ring === rings - 1 ? 0 : (rng() - 0.5) * radialJitter;
      boundaries.push({
        angle: isEnd ? phase + Math.PI * 2 : phase + boundary * step + jitter,
        innerRadius: r0 + innerWobble,
        outerRadius: r1 + outerWobble
      });
    }

    let coveredAngle = 0;
    for (let sector = 0; sector < count; sector += 1) {
      const start = boundaries[sector];
      const end = boundaries[sector + 1];
      const outerArc = sampleArc(
        cx,
        cy,
        start.angle,
        start.outerRadius,
        end.angle,
        end.outerRadius,
        radius > 420 ? 10 : 8
      );
      const innerArc = sampleArc(
        cx,
        cy,
        end.angle,
        end.innerRadius,
        start.angle,
        start.innerRadius,
        6
      ).reverse();
      const points = [...outerArc, ...innerArc];
      coveredAngle += end.angle - start.angle;
      allCells.push({
        id: `ring-${ring}-sector-${sector}`,
        ring,
        sector,
        angles: [start.angle, end.angle],
        points,
        path: pointsToPath(points),
        bounds: boundsOfPoints(points),
        paletteIndex: null
      });
    }
    coverageByRing.push(coveredAngle);
  }

  const counts = new Array(palette.colors.length).fill(0);
  const allCandidates = palette.colors.map((_, index) => index);
  let adjacentRepeats = 0;
  for (const cell of allCells) {
    const neighbors = [];
    const sameRing = allCells.filter((item) => item.ring === cell.ring);
    for (const item of sameRing) {
      if (Math.abs(item.sector - cell.sector) === 1) neighbors.push(item);
    }
    if (cell.ring > 0) {
      const innerCells = allCells.filter((item) => item.ring === cell.ring - 1);
      const span = cell.angles[1] - cell.angles[0];
      for (const item of innerCells) {
        const overlap = angularOverlap(cell.angles, item.angles);
        const itemSpan = item.angles[1] - item.angles[0];
        if (overlap > Math.min(span, itemSpan) * 0.08) neighbors.push(item);
      }
    }
    const neighborColors = new Set(
      neighbors.filter((item) => item.paletteIndex !== null).map((item) => item.paletteIndex)
    );
    cell.neighborIds = neighbors.map((item) => item.id);
    cell.paletteIndex = chooseGlassColor({
      candidates: allCandidates,
      neighborColors,
      counts,
      rng
    });
    cell.color = palette.colors[cell.paletteIndex].hex;
    counts[cell.paletteIndex] += 1;
    for (const neighbor of neighbors) {
      if (neighbor.paletteIndex === cell.paletteIndex) adjacentRepeats += 1;
    }
  }

  return {
    cells: allCells,
    counts,
    adjacentRepeats,
    coverage: coverageByRing,
    closed: coverageByRing.every((coverage) => Math.abs(coverage - Math.PI * 2) < 0.0001)
  };
}

function buildCentralDesign(state, cx, cy, shapeRadius, palette, rng) {
  const shapePoints = makeShapePoints(
    state.window.shape,
    shapeRadius,
    state.window.rotation + (state.window.shape === "diamond" ? 45 : 0)
  ).map((point) => ({ x: cx + point.x, y: cy + point.y }));
  const clipPath = pointsToPath(shapePoints);
  const count = Math.round(clamp(8 + state.window.pieceSize * 14, 8, 22));
  const cells = [];
  const bands = [
    { inner: 0.24, outer: 0.61, offset: 0 },
    { inner: 0.58, outer: 1.18, offset: 0.5 }
  ];

  for (let bandIndex = 0; bandIndex < bands.length; bandIndex += 1) {
    const band = bands[bandIndex];
    const step = (Math.PI * 2) / count;
    const phase = -Math.PI / 2 + step * band.offset;
    for (let sector = 0; sector < count; sector += 1) {
      const a0 = phase + sector * step;
      const a1 = a0 + step;
      const outerArc = sampleArc(
        cx,
        cy,
        a0,
        shapeRadius * band.outer,
        a1,
        shapeRadius * band.outer,
        6
      );
      const innerArc = sampleArc(
        cx,
        cy,
        a1,
        shapeRadius * band.inner,
        a0,
        shapeRadius * band.inner,
        4
      ).reverse();
      const points = [...outerArc, ...innerArc];
      cells.push({
        id: `center-${bandIndex}-${sector}`,
        band: bandIndex,
        sector,
        points,
        path: pointsToPath(points),
        bounds: boundsOfPoints(points),
        paletteIndex: null
      });
    }
  }

  const counts = new Array(palette.colors.length).fill(0);
  const candidates = palette.colors.map((_, index) => index);
  for (const cell of cells) {
    const neighbors = cells.filter(
      (item) =>
        (item.band === cell.band && Math.abs(item.sector - cell.sector) === 1) ||
        (item.band !== cell.band && item.sector === cell.sector)
    );
    const neighborColors = new Set(
      neighbors.filter((item) => item.paletteIndex !== null).map((item) => item.paletteIndex)
    );
    cell.paletteIndex = chooseGlassColor({ candidates, neighborColors, counts, rng });
    cell.color = palette.colors[cell.paletteIndex].hex;
    counts[cell.paletteIndex] += 1;
  }

  const corePoints = makeShapePoints("circle", shapeRadius * 0.22, state.window.rotation)
    .map((point) => ({ x: cx + point.x, y: cy + point.y }));
  const coreColor = palette.colors[Math.floor(rng() * palette.colors.length)].hex;

  return {
    shapePoints,
    clipPath,
    cells,
    counts,
    core: {
      points: corePoints,
      path: pointsToPath(corePoints),
      color: coreColor,
      bounds: boundsOfPoints(corePoints)
    },
    bounds: boundsOfPoints(shapePoints)
  };
}

export function mixColor(from, to, amount) {
  const parse = (hex) => [0, 2, 4].map((offset) => Number.parseInt(hex.slice(1 + offset, 3 + offset), 16));
  const a = parse(from);
  const b = parse(to);
  const channels = a.map((channel, index) => Math.round(channel + (b[index] - channel) * amount));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

export function interpolateLight(frames, progress) {
  const sorted = [...frames].sort((a, b) => a.time - b.time);
  const wrapped = ((progress % 1) + 1) % 1;
  let before = sorted[0];
  let after = sorted[sorted.length - 1];
  for (let index = 0; index < sorted.length - 1; index += 1) {
    if (wrapped >= sorted[index].time && wrapped <= sorted[index + 1].time) {
      before = sorted[index];
      after = sorted[index + 1];
      break;
    }
  }
  if (wrapped < sorted[0].time) {
    before = { ...sorted[sorted.length - 1], time: sorted[sorted.length - 1].time - 1 };
    after = sorted[0];
  }
  if (wrapped > sorted[sorted.length - 1].time) {
    before = sorted[sorted.length - 1];
    after = { ...sorted[0], time: sorted[0].time + 1 };
  }
  const span = Math.max(0.0001, after.time - before.time);
  const amount = clamp((wrapped - before.time) / span, 0, 1);
  return {
    x: before.x + (after.x - before.x) * amount,
    y: before.y + (after.y - before.y) * amount,
    intensity: before.intensity + (after.intensity - before.intensity) * amount,
    warmth: before.warmth + (after.warmth - before.warmth) * amount
  };
}

export function buildScene(stateInput, options = {}) {
  const state = normalizeState(stateInput);
  const measureText = options.measureText || defaultMeasureText;
  const width = state.canvas.width;
  const height = state.canvas.height;
  const margin = state.canvas.safeMargin;
  const safeRect = {
    left: margin,
    top: margin,
    right: width - margin,
    bottom: height - margin,
    width: width - margin * 2,
    height: height - margin * 2
  };
  const baseRadius = Math.min(safeRect.width * 0.435, safeRect.height * 0.335);
  const radius = baseRadius * state.window.scale;
  const cx = safeRect.left + safeRect.width / 2 + state.window.x;
  const cy = safeRect.top + safeRect.height * 0.365 + state.window.y;
  const coreRadius = radius * 0.265;
  const palette = getPalette(state);
  const rng = createRng(state.seed ^ hashString(JSON.stringify({
    shape: state.window.shape,
    rings: state.window.rings,
    pieceSize: state.window.pieceSize
  })));
  const ringData = buildOuterCells(state, cx, cy, coreRadius, radius, rng, palette);
  const centralCx = cx + state.ornament.offsetX;
  const centralCy = cy + state.ornament.offsetY;
  const central = buildCentralDesign(
    state,
    centralCx,
    centralCy,
    coreRadius * 1.02 * state.ornament.scale,
    palette,
    rng
  );
  central.backing = {
    x: cx,
    y: cy,
    radius: coreRadius * 1.035,
    color: palette.colors[palette.colors.length - 1].hex
  };
  const typography = layoutTypography(state, safeRect, measureText);
  const providedLight = options.light || state.light;
  const light = {
    x: clamp(providedLight.x, 0, 1),
    y: clamp(providedLight.y, 0, 1),
    intensity: clamp(providedLight.intensity, 0, 1),
    warmth: clamp(providedLight.warmth, 0, 1),
    color: mixColor("#d8eeff", "#ffd38a", providedLight.warmth)
  };
  const frameStroke = Math.max(3, state.window.border * 2.1);
  const visualRadius = radius + frameStroke;
  const windowBounds = {
    left: cx - radius,
    top: cy - radius,
    right: cx + radius,
    bottom: cy + radius,
    width: radius * 2,
    height: radius * 2
  };
  const visualBounds = {
    left: cx - visualRadius,
    top: cy - visualRadius,
    right: cx + visualRadius,
    bottom: cy + visualRadius,
    width: visualRadius * 2,
    height: visualRadius * 2
  };
  const totalCells = ringData.cells.length + central.cells.length;
  const colorCounts = palette.colors.map((_, index) =>
    ringData.cells.filter((cell) => cell.paletteIndex === index).length +
    central.cells.filter((cell) => cell.paletteIndex === index).length
  );
  const maxColorShare = Math.max(...colorCounts) / Math.max(1, totalCells);
  const textBounds = typography.bounds;
  const overlapsTitle = textBounds
    ? !(
        textBounds.bottom < visualBounds.top ||
        textBounds.top > visualBounds.bottom ||
        textBounds.right < visualBounds.left ||
        textBounds.left > visualBounds.right
      )
    : false;

  return {
    state,
    width,
    height,
    safeRect,
    radius,
    coreRadius,
    center: { x: cx, y: cy },
    centralCenter: { x: centralCx, y: centralCy },
    window: {
      bounds: windowBounds,
      visualBounds,
      frameStroke,
      outerRingClosed: ringData.closed,
      coverage: ringData.coverage
    },
    rings: ringData.cells,
    central,
    typography,
    palette,
    light,
    image: {
      dataUrl: state.image.dataUrl,
      name: state.image.name,
      opacity: state.image.opacity,
      scale: state.image.scale,
      offsetX: state.image.offsetX,
      offsetY: state.image.offsetY,
      x: cx - radius,
      y: cy - radius,
      width: radius * 2,
      height: radius * 2
    },
    stats: {
      totalCells,
      outerRingPieces: ringData.cells.filter((cell) => cell.ring === state.window.rings - 1).length,
      outerRingClosed: ringData.closed,
      adjacentRepeats: ringData.adjacentRepeats,
      maxColorShare,
      colorCounts,
      overlapsTitle
    },
    board: {
      background: "#14171e",
      rule: "#2a2d34",
      ink: "#f2e7ce"
    }
  };
}

function outsideBy(bounds, rect, tolerance = 0.5) {
  if (!bounds) return { outside: false, sides: [] };
  const sides = [];
  if (bounds.left < rect.left - tolerance) sides.push("左");
  if (bounds.top < rect.top - tolerance) sides.push("上");
  if (bounds.right > rect.right + tolerance) sides.push("右");
  if (bounds.bottom > rect.bottom + tolerance) sides.push("下");
  return { outside: sides.length > 0, sides };
}

function nodeBox(node) {
  return node ? { left: node.bounds.left, top: node.bounds.top, right: node.bounds.right, bottom: node.bounds.bottom } : null;
}

export function validateScene(scene) {
  const errors = [];
  const warnings = [];
  const checks = [];
  const visibleTextNodes = [
    ...(scene.state.layers.title ? scene.typography.titleNodes : []),
    ...(scene.state.layers.subtitle ? [scene.typography.subtitleNode] : []),
    ...(scene.state.layers.footer ? [scene.typography.footerNode] : [])
  ].filter(Boolean);

  const windowCheck = outsideBy(scene.window.visualBounds, scene.safeRect);
  checks.push({
    id: "window-safe",
    label: "窗框安全边距",
    ok: !windowCheck.outside,
    detail: windowCheck.outside
      ? `窗框越出安全区（${windowCheck.sides.join("、")}）`
      : "窗框完整位于安全区内"
  });
  if (windowCheck.outside) {
    errors.push({
      code: "WINDOW_OUTSIDE_SAFE",
      title: "窗框超出安全区",
      message: `窗框的${windowCheck.sides.join("、")}侧越过安全边距。`,
      fix: "把“中心缩放”调低到 100% 以下，或清除中心位置的横向/纵向偏移后重试。"
    });
  }

  const centralCheck = outsideBy(scene.central.bounds, scene.safeRect, 2);
  checks.push({
    id: "center-safe",
    label: "中心图形安全区",
    ok: !centralCheck.outside,
    detail: centralCheck.outside
      ? `中心图形越出安全区（${centralCheck.sides.join("、")}）`
      : "中心图形完整位于安全区内"
  });
  if (centralCheck.outside) {
    errors.push({
      code: "CENTER_OUTSIDE_SAFE",
      title: "中心图形超出安全区",
      message: `中心形状的${centralCheck.sides.join("、")}侧越过安全边距。`,
      fix: "降低“中心缩放”，或使用“归位”按钮将中心图形移回画幅中央。"
    });
  }

  const textBoxes = visibleTextNodes.map((node) => ({ node, box: nodeBox(node) }));
  for (const node of visibleTextNodes) {
    const check = outsideBy(node.bounds, scene.safeRect, 0.5);
    if (check.outside) {
      const label = { title: "标题", subtitle: "副标题", footer: "页脚" }[node.role] || "文字";
      checks.push({
        id: `text-safe-${node.role}`,
        label: `${label}安全区`,
        ok: false,
        detail: `${label}从${check.sides.join("、")}侧越出安全区`
      });
      errors.push({
        code: `TEXT_OUTSIDE_SAFE_${node.role.toUpperCase()}`,
        title: `${label}超出安全区`,
        message: `“${node.text.slice(0, 42)}${node.text.length > 42 ? "…" : ""}”的${check.sides.join("、")}侧被画幅安全边距截断。`,
        fix: node.role === "title"
          ? "减小标题字号、缩短内容或把“文字位置”向上/向内移动；也可以换用更紧凑的排布。"
          : "减小这段文字的字号或缩短文案；副标题与页脚不参与自动换行。"
      });
    }
  }
  if (visibleTextNodes.every((node) => !outsideBy(node.bounds, scene.safeRect, 0.5).outside)) {
    checks.push({
      id: "text-safe",
      label: "文字安全区",
      ok: true,
      detail: `全部 ${visibleTextNodes.length} 段文字均未裁切`
    });
  }

  const titleVisible = scene.state.layers.title;
  const overflow = titleVisible && scene.typography.overflow;
  checks.push({
    id: "text-lines",
    label: "标题行数",
    ok: !overflow,
    detail: overflow
      ? `${scene.typography.titleLines.length} 行超过上限 ${scene.typography.maxLines} 行`
      : `${scene.typography.titleLines.length} 行，在自动换行上限内`
  });
  if (overflow) {
    errors.push({
      code: "TEXT_OVERFLOW",
      title: "标题超过自动换行上限",
      message: `当前标题需要 ${scene.typography.titleLines.length} 行，但上限是 ${scene.typography.maxLines} 行。继续导出会丢失内容。`,
      fix: `把字号从 ${round(scene.state.typography.fontSize, 1)} 降到约 ${Math.max(8, Math.floor(scene.state.typography.fontSize * 0.72))}，或缩短标题；也可以提高最大行数，但请确认底部文字仍在安全区内。`
    });
  }

  checks.push({
    id: "single-source",
    label: "可编辑输出",
    ok: true,
    detail: "SVG 使用 path / text / image 元素；PNG 由同一 SVG 场景渲染"
  });

  const outerCheck = scene.window.outerRingClosed;
  checks.push({
    id: "outer-closed",
    label: "外圈闭合",
    ok: outerCheck,
    detail: outerCheck
      ? `${scene.stats.outerRingPieces} 枚外圈色片覆盖 360°`
      : "外圈角度覆盖存在缺口"
  });
  if (!outerCheck) {
    errors.push({
      code: "OUTER_RING_OPEN",
      title: "外圈未闭合",
      message: "外圈色片没有覆盖完整圆周，导出会出现缺口。",
      fix: "调整“色片大小”或“环带数量”以重新生成几何；如果仍失败，请恢复默认案例。"
    });
  }

  const colorCheck = scene.stats.adjacentRepeats === 0;
  checks.push({
    id: "adjacent-colors",
    label: "相邻色片变化",
    ok: colorCheck,
    detail: colorCheck
      ? `0 处同色接壤 · 最大单色占比 ${round(scene.stats.maxColorShare * 100, 1)}%`
      : `${scene.stats.adjacentRepeats} 处同色接壤`
  });
  if (!colorCheck) {
    errors.push({
      code: "ADJACENT_COLOR_REPEAT",
      title: "相邻色片重复",
      message: `检测到 ${scene.stats.adjacentRepeats} 处相邻同色，会造成大面积色块。`,
      fix: "换一组调色板或调整色片大小以重新着色；系统会优先避开已占用的邻色。"
    });
  } else if (scene.stats.maxColorShare > 0.32) {
    warnings.push({
      code: "COLOR_DOMINANCE",
      title: "单一颜色偏多",
      message: `单色占比 ${round(scene.stats.maxColorShare * 100, 1)}%，视觉层次可能偏平。`,
      fix: "尝试“晨雾”或“夜祷”调色板，或把色片大小调小一档。"
    });
  }

  if (!visibleTextNodes.length) {
    warnings.push({
      code: "NO_TEXT",
      title: "文字图层全部隐藏",
      message: "导出将只包含窗面与背景。",
      fix: "在右侧图层面板打开标题、副标题或页脚。"
    });
  }
  if (scene.stats.overlapsTitle) {
    warnings.push({
      code: "TEXT_OVERLAP",
      title: "文字与窗框重叠",
      message: "文字虽然在安全区内，但与窗框视觉区域相交。",
      fix: "将文字位置下移，或把中心缩放调小以留出更多留白。"
    });
  }

  if (scene.state.typography.title.trim() === "" && scene.state.layers.title) {
    warnings.push({
      code: "EMPTY_TITLE",
      title: "标题为空",
      message: "导出的 SVG 仍会保留一个可编辑的空文本元素。",
      fix: "输入标题，或关闭标题图层。"
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    checks,
    safeRect: scene.safeRect,
    textBoxes,
    textBounds: scene.typography.bounds,
    windowBounds: scene.window.bounds,
    stats: scene.stats
  };
}

export function validateState(stateInput, options = {}) {
  const scene = buildScene(stateInput, options);
  return { scene, validation: validateScene(scene) };
}
