import {
  SCHEMA_VERSION,
  BASE_WIDTH,
  BASE_HEIGHT,
  TEMPLATE_META,
  TEMPLATE_LAYOUTS,
  ENTRANCE_PRESETS,
  FONT_STACKS,
  DEFAULT_COPY,
  createBaseElements
} from "./templates.js";

export const MIN_CANVAS_WIDTH = 160;
export const MIN_CANVAS_HEIGHT = 90;
export const MIN_FONT_SIZE = 6;
export const DEFAULT_TIMELINE_MS = 2200;

export function deepClone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export function makeId(prefix = "layer") {
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 10);
  return `${prefix}-${random.replaceAll("-", "").slice(0, 10)}`;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

export function round(value, digits = 2) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function createScene(options = {}) {
  const template = TEMPLATE_LAYOUTS[options.template] ? options.template : "news";
  const copy = { ...DEFAULT_COPY, ...(options.copy ?? {}) };
  const width = clamp(Number(options.width) || BASE_WIDTH, MIN_CANVAS_WIDTH, 3840);
  const height = clamp(Number(options.height) || BASE_HEIGHT, MIN_CANVAS_HEIGHT, 2160);
  const scene = {
    schemaVersion: SCHEMA_VERSION,
    id: makeId("project"),
    name: options.name || "未命名字幕",
    template,
    width: BASE_WIDTH,
    height: BASE_HEIGHT,
    safeMargin: TEMPLATE_META[template].safeMargin,
    background: deepClone(TEMPLATE_META[template].background),
    timelineMs: DEFAULT_TIMELINE_MS,
    playheadMs: DEFAULT_TIMELINE_MS,
    bpm: 92,
    elements: createBaseElements(copy),
    assets: { fonts: [], images: [] },
    updatedAt: new Date().toISOString()
  };
  applyTemplate(scene, template);
  if (width !== BASE_WIDTH || height !== BASE_HEIGHT) resizeScene(scene, width, height);
  if (Number.isFinite(Number(options.safeMargin))) {
    scene.safeMargin = clamp(Number(options.safeMargin), 0, Math.min(width, height) / 3);
  }
  return scene;
}

export function applyTemplate(scene, templateId) {
  const layout = TEMPLATE_LAYOUTS[templateId];
  const meta = TEMPLATE_META[templateId];
  if (!layout || !meta) throw new Error(`未知模板：${templateId}`);

  const sx = scene.width / BASE_WIDTH;
  const sy = scene.height / BASE_HEIGHT;
  const fontScale = Math.min(sx, sy);
  scene.template = templateId;
  scene.background = deepClone(meta.background);

  for (const [id, source] of Object.entries(layout)) {
    const element = scene.elements.find((item) => item.id === id);
    if (!element) continue;
    element.x = round(source.x * sx);
    element.y = round(source.y * sy);
    element.w = round(source.w * sx);
    element.h = round(source.h * sy);
    element.style = {
      ...element.style,
      ...deepClone(source.style)
    };
    if ("fontSize" in source.style) {
      element.style.fontSize = round(source.style.fontSize * fontScale, 1);
      element.style.letterSpacing = round((source.style.letterSpacing ?? 0) * fontScale, 2);
    }
    if ("radius" in source.style) element.style.radius = round(source.style.radius * fontScale, 1);
    if ("strokeWidth" in source.style) element.style.strokeWidth = round(source.style.strokeWidth * fontScale, 2);
  }
  return scene;
}

export function resizeScene(scene, nextWidth, nextHeight) {
  const width = clamp(Math.round(Number(nextWidth) || scene.width), MIN_CANVAS_WIDTH, 3840);
  const height = clamp(Math.round(Number(nextHeight) || scene.height), MIN_CANVAS_HEIGHT, 2160);
  const sx = width / scene.width;
  const sy = height / scene.height;
  const s = Math.min(sx, sy);

  for (const element of scene.elements) {
    element.x = round(element.x * sx);
    element.y = round(element.y * sy);
    element.w = round(element.w * sx);
    element.h = round(element.h * sy);
    if (element.type === "text") {
      element.style.fontSize = round(Math.max(MIN_FONT_SIZE, element.style.fontSize * s), 1);
      element.style.letterSpacing = round((element.style.letterSpacing ?? 0) * s, 2);
      element.style.paddingX = round((element.style.paddingX ?? 0) * sx, 1);
      element.style.paddingY = round((element.style.paddingY ?? 0) * sy, 1);
    }
    element.style.radius = round((element.style.radius ?? 0) * s, 1);
    element.style.strokeWidth = round((element.style.strokeWidth ?? 0) * s, 2);
  }
  scene.safeMargin = round(clamp(scene.safeMargin * s, 0, Math.min(width, height) / 3), 1);
  scene.width = width;
  scene.height = height;
  scene.playheadMs = clamp(scene.playheadMs, 0, scene.timelineMs);
  return scene;
}

export function getSafeRect(scene) {
  return {
    left: scene.safeMargin,
    top: scene.safeMargin,
    right: scene.width - scene.safeMargin,
    bottom: scene.height - scene.safeMargin
  };
}

export function touch(scene) {
  scene.updatedAt = new Date().toISOString();
  return scene;
}

export function setEntrancePreset(element, preset) {
  const source = ENTRANCE_PRESETS[preset] ?? ENTRANCE_PRESETS.rise;
  element.entrance = {
    ...(element.entrance ?? {}),
    preset,
    keyframes: source.keyframes.map((frame) => ({ ...frame }))
  };
  return element;
}

export function easingValue(name, t) {
  const x = clamp(t, 0, 1);
  if (name === "linear") return x;
  if (name === "easeInCubic") return x * x * x;
  if (name === "easeInOutCubic") {
    return x < 0.5 ? 4 * x * x * x : 1 - ((-2 * x + 2) ** 3) / 2;
  }
  if (name === "easeOutBack") {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * ((x - 1) ** 3) + c1 * ((x - 1) ** 2);
  }
  return 1 - ((1 - x) ** 3);
}

export function entranceAt(element, timeMs) {
  const entrance = element.entrance ?? {};
  const duration = Math.max(0, Number(entrance.duration) || 0);
  const delay = Math.max(0, Number(entrance.delay) || 0);
  const raw = duration === 0 ? 1 : clamp((timeMs - delay) / duration, 0, 1);
  const progress = easingValue(entrance.easing ?? "easeOutCubic", raw);
  const frames = (entrance.keyframes ?? ENTRANCE_PRESETS.rise.keyframes)
    .map((frame) => ({ ...frame, at: clamp(Number(frame.at) || 0, 0, 1) }))
    .sort((a, b) => a.at - b.at);
  if (!frames.length) return { x: 0, y: 0, scale: 1, opacity: 1, progress };

  let from = frames[0];
  let to = frames[frames.length - 1];
  for (let index = 0; index < frames.length - 1; index += 1) {
    if (progress >= frames[index].at && progress <= frames[index + 1].at) {
      from = frames[index];
      to = frames[index + 1];
      break;
    }
  }
  const span = to.at - from.at;
  const mix = span <= 0 ? 1 : clamp((progress - from.at) / span, 0, 1);
  const value = (key, fallback) => {
    const start = Number(from[key] ?? fallback);
    const end = Number(to[key] ?? start);
    return start + (end - start) * mix;
  };
  return {
    x: value("x", 0),
    y: value("y", 0),
    scale: value("scale", 1),
    opacity: value("opacity", 1),
    progress
  };
}

export function rotatedBounds(element) {
  const angle = ((Number(element.rotation) || 0) * Math.PI) / 180;
  const cx = element.x + element.w / 2;
  const cy = element.y + element.h / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const corners = [
    [-element.w / 2, -element.h / 2],
    [element.w / 2, -element.h / 2],
    [element.w / 2, element.h / 2],
    [-element.w / 2, element.h / 2]
  ].map(([x, y]) => [cx + x * cos - y * sin, cy + x * sin + y * cos]);
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys)
  };
}

function charWidth(char, fontSize) {
  if (/\s/.test(char)) return fontSize * 0.3;
  if (/[\u2e80-\u9fff\u3000-\u303f\uff00-\uffef]/.test(char)) return fontSize;
  return fontSize * 0.58;
}

export function defaultMeasureText(text, fontSize) {
  let width = 0;
  for (const char of text) width += charWidth(char, fontSize);
  return width;
}

export function wrapText(text, maxWidth, measure, letterSpacing = 0) {
  const safeText = String(text ?? "");
  const paragraphs = safeText.split("\n");
  const lines = [];
  const widthOf = (value) => {
    const base = measure(value);
    return base + Math.max(0, [...value].length - 1) * letterSpacing;
  };

  for (const paragraph of paragraphs) {
    if (paragraph === "") {
      lines.push("");
      continue;
    }
    let line = "";
    for (const char of paragraph) {
      const candidate = line + char;
      if (!line || widthOf(candidate) <= maxWidth + 0.01) {
        line = candidate;
        continue;
      }
      let breakAt = -1;
      for (let index = line.length - 1; index >= Math.floor(line.length * 0.42); index -= 1) {
        if (/\s/.test(line[index])) {
          breakAt = index;
          break;
        }
      }
      if (breakAt > 0 && breakAt < line.length - 1) {
        const carry = line.slice(breakAt + 1);
        lines.push(line.slice(0, breakAt).trimEnd());
        line = carry + char;
      } else {
        lines.push(line.trimEnd());
        line = /\s/.test(char) ? "" : char;
      }
    }
    if (line !== "" || paragraph === "") lines.push(line.trimEnd());
  }
  return { lines, widthOf };
}

export function measureTextElement(element, measureText = defaultMeasureText) {
  const style = element.style ?? {};
  const fontSize = Math.max(1, Number(style.fontSize) || 1);
  const paddingX = Math.max(0, Number(style.paddingX) || 0);
  const paddingY = Math.max(0, Number(style.paddingY) || 0);
  const border = Math.max(0, Number(style.borderWidth) || 0);
  const availableWidth = Math.max(1, element.w - paddingX * 2 - border * 2);
  const availableHeight = Math.max(1, element.h - paddingY * 2 - border * 2);
  const measure = (value) => measureText(value, fontSize, style);
  const wrapped = wrapText(element.text, availableWidth, measure, Number(style.letterSpacing) || 0);
  const lineWidths = wrapped.lines.map((line) => wrapped.widthOf(line));
  const lineHeightPx = fontSize * Math.max(0.8, Number(style.lineHeight) || 1.2);
  const textHeight = Math.max(lineHeightPx, wrapped.lines.length * lineHeightPx);
  const textWidth = lineWidths.length ? Math.max(...lineWidths) : 0;
  const perLineOverflow = lineWidths.some((width) => width > availableWidth + 0.5);
  const overflowY = textHeight > availableHeight + 0.5;
  return {
    lines: wrapped.lines,
    lineWidths,
    availableWidth,
    availableHeight,
    lineHeightPx,
    textWidth,
    textHeight,
    requiredWidth: textWidth + paddingX * 2 + border * 2,
    requiredHeight: textHeight + paddingY * 2 + border * 2,
    overflowX: perLineOverflow,
    overflowY,
    overflow: perLineOverflow || overflowY,
    fontSize,
    paddingX,
    paddingY,
    border
  };
}

export function textOrigin(element, metrics) {
  const style = element.style ?? {};
  const innerWidth = metrics.availableWidth;
  const align = style.align ?? "left";
  const valign = style.valign ?? "middle";
  const x = element.x + metrics.paddingX + metrics.border
    + (align === "center" ? innerWidth / 2 : align === "right" ? innerWidth : 0);
  const verticalRoom = Math.max(0, metrics.availableHeight - metrics.textHeight);
  const blockTop = element.y + metrics.paddingY + metrics.border
    + (valign === "middle" ? verticalRoom / 2 : valign === "bottom" ? verticalRoom : 0);
  return { x, top: blockTop, align };
}

export function baselineForLine(metrics, lineIndex) {
  return metrics.lineHeightPx * lineIndex + metrics.fontSize * 0.82;
}

function paddedBounds(element) {
  const stroke = Math.max(0, Number(element.style?.strokeWidth) || 0) / 2;
  const bounds = rotatedBounds(element);
  return {
    left: bounds.left - stroke,
    top: bounds.top - stroke,
    right: bounds.right + stroke,
    bottom: bounds.bottom + stroke
  };
}

function issue(severity, code, element, message, fix = "") {
  return {
    severity,
    code,
    elementId: element?.id ?? null,
    elementName: element?.name ?? "场景",
    message,
    fix
  };
}

export function validateScene(scene, measureText = defaultMeasureText) {
  const errors = [];
  const warnings = [];
  const safe = getSafeRect(scene);
  const safeWidth = safe.right - safe.left;
  const safeHeight = safe.bottom - safe.top;

  if (!(scene.width >= MIN_CANVAS_WIDTH && scene.height >= MIN_CANVAS_HEIGHT)) {
    errors.push(issue("error", "canvas-size", null,
      `画布仅 ${scene.width} × ${scene.height}px，低于最小可编辑尺寸。`,
      `将画布放大到至少 ${MIN_CANVAS_WIDTH} × ${MIN_CANVAS_HEIGHT}px。`));
  }
  if (safeWidth < 24 || safeHeight < 16) {
    errors.push(issue("error", "safe-area", null,
      `安全区仅剩 ${round(safeWidth)} × ${round(safeHeight)}px，无法可靠容纳字幕。`,
      "减小安全边距，或增大画布尺寸。当前文本不会被删除。"));
  }

  const seenIds = new Set();
  for (const element of scene.elements) {
    if (seenIds.has(element.id)) {
      errors.push(issue("error", "duplicate-id", element,
        `图层「${element.name}」存在重复 ID，载入时可能丢失选中关系。`,
        "删除重复图层，或重新导入项目生成新 ID。"));
    }
    seenIds.add(element.id);
    if (!element.visible) continue;
    if (!(element.w > 0 && element.h > 0)) {
      errors.push(issue("error", "zero-size", element,
        `图层「${element.name}」宽高必须大于 0。`,
        "在属性面板中恢复宽度和高度。"));
      continue;
    }

    const bounds = paddedBounds(element);
    const outside = [];
    if (bounds.left < safe.left - 0.5) outside.push(`左 ${round(safe.left - bounds.left)}px`);
    if (bounds.top < safe.top - 0.5) outside.push(`上 ${round(safe.top - bounds.top)}px`);
    if (bounds.right > safe.right + 0.5) outside.push(`右 ${round(bounds.right - safe.right)}px`);
    if (bounds.bottom > safe.bottom + 0.5) outside.push(`下 ${round(bounds.bottom - safe.bottom)}px`);
    if (outside.length) {
      const moves = [];
      if (bounds.left < safe.left) moves.push(`向右移动 ${round(safe.left - bounds.left)}px`);
      if (bounds.right > safe.right) moves.push(`向左移动 ${round(bounds.right - safe.right)}px`);
      if (bounds.top < safe.top) moves.push(`向下移动 ${round(safe.top - bounds.top)}px`);
      if (bounds.bottom > safe.bottom) moves.push(`向上移动 ${round(bounds.bottom - safe.bottom)}px`);
      errors.push(issue("error", "safe-bounds", element,
        `图层「${element.name}」越过安全区：${outside.join("、")}。`,
        `${moves.join("，")}；若仍越界，请缩小宽高。`));
    } else {
      const near = Math.min(bounds.left - safe.left, bounds.top - safe.top, safe.right - bounds.right, safe.bottom - bounds.bottom);
      if (near >= 0 && near < 2) {
        warnings.push(issue("warning", "safe-near", element,
          `图层「${element.name}」距离安全区边缘不足 2px。`,
          "留出更多内边距，避免编码或缩放时被裁切。"));
      }
    }

    if (element.type === "text") {
      const metrics = measureTextElement(element, measureText);
      if (metrics.overflowX) {
        errors.push(issue("error", "text-clip-x", element,
          `文字「${element.name}」横向溢出 ${round(metrics.textWidth - metrics.availableWidth)}px。`,
          "增大该文字图层宽度、减小字号，或在文本中手动换行。"));
      }
      if (metrics.overflowY) {
        errors.push(issue("error", "text-clip-y", element,
          `文字「${element.name}」纵向溢出 ${round(metrics.textHeight - metrics.availableHeight)}px。`,
          "增大文字图层高度或安全边距内的可用空间，或减小字号。"));
      }
      if (!String(element.text ?? "").trim()) {
        warnings.push(issue("warning", "empty-text", element,
          `文字图层「${element.name}」内容为空。`,
          "输入文字，或隐藏/删除该图层。"));
      }
    }
    if (element.type === "image" && !element.src) {
      errors.push(issue("error", "missing-image", element,
        `图片图层「${element.name}」缺少图片数据。`,
        "重新导入图片；项目 JSON 中的原有参数不会被清除。"));
    }
  }

  const visibleCount = scene.elements.filter((element) => element.visible).length;
  if (!visibleCount) warnings.push(issue("warning", "empty-scene", null, "当前没有可见图层。", "添加文字或图形后再导出。"));

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    issues: [...errors, ...warnings],
    safe,
    checkedAt: new Date().toISOString()
  };
}

function shiftInside(element, safe) {
  const bounds = paddedBounds(element);
  let dx = 0;
  let dy = 0;
  if (bounds.left < safe.left) dx = safe.left - bounds.left;
  else if (bounds.right > safe.right) dx = safe.right - bounds.right;
  if (bounds.top < safe.top) dy = safe.top - bounds.top;
  else if (bounds.bottom > safe.bottom) dy = safe.bottom - bounds.bottom;
  element.x = round(element.x + dx);
  element.y = round(element.y + dy);
}

export function autoFixScene(scene, measureText = defaultMeasureText) {
  const safe = getSafeRect(scene);
  const safeWidth = Math.max(1, safe.right - safe.left);
  const safeHeight = Math.max(1, safe.bottom - safe.top);
  const notes = [];

  for (const element of scene.elements) {
    if (!element.visible) continue;
    if (element.w > safeWidth) element.w = safeWidth;
    if (element.h > safeHeight) element.h = safeHeight;
    shiftInside(element, safe);

    if (element.type !== "text") {
      shiftInside(element, safe);
      continue;
    }

    const originalFontSize = Number(element.style.fontSize) || 12;
    let guard = 0;
    while (guard < 90) {
      guard += 1;
      shiftInside(element, safe);
      const metrics = measureTextElement(element, measureText);
      if (!metrics.overflow) break;

      if (element.style.fontSize > MIN_FONT_SIZE + 0.01) {
        element.style.fontSize = round(Math.max(MIN_FONT_SIZE, element.style.fontSize * 0.9), 1);
        continue;
      }

      let changed = false;
      if (metrics.overflowX && element.w < safeWidth - 0.5) {
        const nextWidth = Math.min(safeWidth, Math.max(metrics.requiredWidth + 2, element.w + 4));
        if (nextWidth > element.w + 0.2) {
          element.w = round(nextWidth);
          changed = true;
        }
      }
      if (metrics.overflowY && element.h < safeHeight - 0.5) {
        const nextHeight = Math.min(safeHeight, Math.max(metrics.requiredHeight + 2, element.h + 4));
        if (nextHeight > element.h + 0.2) {
          element.h = round(nextHeight);
          changed = true;
        }
      }
      if (changed) continue;
      break;
    }
    shiftInside(element, safe);
    if (element.style.fontSize < originalFontSize - 0.1) {
      notes.push(`「${element.name}」字号从 ${round(originalFontSize, 1)}px 自动调整为 ${round(element.style.fontSize, 1)}px。`);
    }
  }

  touch(scene);
  return {
    scene,
    changed: true,
    notes,
    validation: validateScene(scene, measureText)
  };
}

export function createTextElement(scene, options = {}) {
  const safe = getSafeRect(scene);
  const width = Math.min(560, safe.right - safe.left);
  const height = Math.min(100, safe.bottom - safe.top);
  return {
    id: makeId("text"),
    type: "text",
    name: options.name ?? "新文字",
    text: options.text ?? "双击图层或在右侧输入文字",
    x: round(safe.left + 24),
    y: round(safe.top + 24),
    w: round(width),
    h: round(height),
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    entrance: {
      preset: "rise",
      duration: 620,
      delay: 0,
      easing: "easeOutCubic",
      keyframes: ENTRANCE_PRESETS.rise.keyframes.map((frame) => ({ ...frame }))
    },
    style: {
      fontFamily: FONT_STACKS[0].value,
      fontSize: Math.min(42, Math.max(12, scene.width * 0.04)),
      fontWeight: 600,
      lineHeight: 1.35,
      letterSpacing: 0,
      color: "#ffffff",
      align: "left",
      valign: "middle",
      background: "rgba(8, 13, 20, 0.78)",
      borderColor: "transparent",
      borderWidth: 0,
      radius: 8,
      paddingX: 14,
      paddingY: 10
    }
  };
}

export function createShapeElement(scene, shape = "rect") {
  const safe = getSafeRect(scene);
  return {
    id: makeId("shape"),
    type: "shape",
    shape,
    name: shape === "ellipse" ? "新椭圆" : shape === "line" ? "新线条" : "新矩形",
    x: round(safe.left + 24),
    y: round(safe.top + Math.min(150, (safe.bottom - safe.top) / 4)),
    w: round(Math.min(320, (safe.right - safe.left) / 2)),
    h: round(shape === "line" ? 5 : Math.min(160, (safe.bottom - safe.top) / 3)),
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    entrance: {
      preset: "fade",
      duration: 520,
      delay: 0,
      easing: "easeOutCubic",
      keyframes: ENTRANCE_PRESETS.fade.keyframes.map((frame) => ({ ...frame }))
    },
    style: {
      fill: "rgba(255, 90, 69, 0.2)",
      stroke: "#ff7462",
      strokeWidth: 1,
      radius: shape === "ellipse" ? 999 : 10
    }
  };
}

export function duplicateElement(scene, elementId) {
  const index = scene.elements.findIndex((element) => element.id === elementId);
  if (index < 0) return null;
  const source = scene.elements[index];
  const duplicate = deepClone(source);
  duplicate.id = makeId(source.type);
  duplicate.name = `${source.name} 副本`;
  duplicate.x += Math.min(18, Math.max(0, scene.width - source.x - source.w));
  duplicate.y += Math.min(18, Math.max(0, scene.height - source.y - source.h));
  duplicate.locked = false;
  scene.elements.splice(index + 1, 0, duplicate);
  touch(scene);
  return duplicate;
}

export function parseProjectJSON(json) {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("JSON 无法解析。请确认文件是编辑器导出的模板 JSON，而不是图片或文本文件。");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSON 根节点必须是对象。请导入包含 scene 或 elements 的项目文件。");
  }
  const source = parsed.scene && typeof parsed.scene === "object" ? parsed.scene : parsed;
  return normalizeScene(source);
}

export function exportProjectJSON(scene) {
  return JSON.stringify({
    kind: "framework-subtitle-template",
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    scene
  }, null, 2);
}

export function normalizeScene(raw) {
  if (!raw || !Array.isArray(raw.elements)) {
    throw new Error("项目缺少 elements 图层数组，无法安全恢复。请使用编辑器导出的模板 JSON。");
  }
  const template = TEMPLATE_META[raw.template] ? raw.template : "news";
  const width = clamp(Number(raw.width) || BASE_WIDTH, MIN_CANVAS_WIDTH, 3840);
  const height = clamp(Number(raw.height) || BASE_HEIGHT, MIN_CANVAS_HEIGHT, 2160);
  const fallback = createScene({ template, width: BASE_WIDTH, height: BASE_HEIGHT });
  const defaultStyles = Object.fromEntries(fallback.elements.map((element) => [element.id, element.style]));
  const seen = new Set();
  const elements = raw.elements.map((element, index) => {
    const type = ["text", "shape", "image"].includes(element?.type) ? element.type : "shape";
    let id = String(element?.id || makeId(type));
    if (seen.has(id)) id = makeId(type);
    seen.add(id);
    const baseStyle = defaultStyles[element?.id] ?? (type === "text"
      ? createTextElement(fallback).style
      : createShapeElement(fallback).style);
    const normalized = {
      id,
      type,
      name: String(element?.name || (type === "text" ? `文字 ${index + 1}` : `图形 ${index + 1}`)),
      x: Number.isFinite(Number(element?.x)) ? Number(element.x) : 0,
      y: Number.isFinite(Number(element?.y)) ? Number(element.y) : 0,
      w: Math.max(1, Number(element?.w) || 100),
      h: Math.max(1, Number(element?.h) || 60),
      rotation: Number(element?.rotation) || 0,
      opacity: clamp(Number(element?.opacity ?? 1), 0, 1),
      visible: element?.visible !== false,
      locked: Boolean(element?.locked),
      style: { ...deepClone(baseStyle), ...(element?.style ?? {}) },
      entrance: {
        preset: ENTRANCE_PRESETS[element?.entrance?.preset] ? element.entrance.preset : "rise",
        duration: clamp(Number(element?.entrance?.duration) || 620, 0, 10000),
        delay: clamp(Number(element?.entrance?.delay) || 0, 0, 10000),
        easing: String(element?.entrance?.easing || "easeOutCubic"),
        keyframes: deepClone(
          Array.isArray(element?.entrance?.keyframes) && element.entrance.keyframes.length
            ? element.entrance.keyframes
            : ENTRANCE_PRESETS.rise.keyframes
        )
      }
    };
    if (type === "text") normalized.text = String(element?.text ?? "");
    if (type === "shape") normalized.shape = ["rect", "ellipse", "line"].includes(element?.shape) ? element.shape : "rect";
    if (type === "image") {
      normalized.src = String(element?.src ?? "");
      normalized.name = String(element?.name || `图片 ${index + 1}`);
      normalized.style.fit = element?.style?.fit === "contain" ? "contain" : "cover";
    }
    return normalized;
  });

  const maxDuration = elements.reduce((max, element) => {
    const end = (Number(element.entrance?.delay) || 0) + (Number(element.entrance?.duration) || 0);
    return Math.max(max, end);
  }, 1300);
  const timelineMs = clamp(Number(raw.timelineMs) || Math.max(DEFAULT_TIMELINE_MS, maxDuration), 200, 30000);
  const scene = {
    schemaVersion: SCHEMA_VERSION,
    id: String(raw.id || makeId("project")),
    name: String(raw.name || "重新载入的字幕"),
    template,
    width,
    height,
    safeMargin: clamp(Number(raw.safeMargin ?? TEMPLATE_META[template].safeMargin), 0, Math.min(width, height) / 3),
    background: {
      type: "linear",
      from: String(raw.background?.from || TEMPLATE_META[template].background.from),
      to: String(raw.background?.to || TEMPLATE_META[template].background.to),
      angle: Number(raw.background?.angle ?? TEMPLATE_META[template].background.angle)
    },
    timelineMs,
    playheadMs: clamp(Number(raw.playheadMs ?? timelineMs), 0, timelineMs),
    bpm: clamp(Number(raw.bpm) || 92, 40, 220),
    elements,
    assets: {
      fonts: Array.isArray(raw.assets?.fonts) ? deepClone(raw.assets.fonts) : [],
      images: Array.isArray(raw.assets?.images) ? deepClone(raw.assets.images) : []
    },
    updatedAt: String(raw.updatedAt || new Date().toISOString())
  };
  if (!scene.elements.length) throw new Error("项目中没有任何图层。文本不会被自动删除，请导入包含 elements 的完整文件。");
  return scene;
}



