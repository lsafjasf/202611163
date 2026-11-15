import {
  buildDieline,
  elementBoxMm,
  normalizeElement,
  safeRectForPanel,
} from "./geometry.js";

export const COLORS = {
  canvas: "#eeeae0",
  paperCard: "#fbf8ef",
  cardLine: "#d9d3c5",
  ink: "#173b32",
  muted: "#6d7c74",
  faint: "#a6aea7",
  paper: "#d7b777",
  paperHi: "#e4c98f",
  fold: "#d75839",
  cut: "#20463b",
  safe: "#3a7d8c",
  accent: "#e4572e",
  yellow: "#f4c95d",
  dark: "#153b32",
  darkSoft: "#1d4a40",
  white: "#fffdf7",
};

export function fallbackMeasure(text, style) {
  const tracking = (style.letterSpacing || 0) * Math.max(0, text.length - 1);
  return text.length * style.fontSize * 0.58 + tracking;
}

export function wrapText(text, maxWidth, measureText, style) {
  const paragraphs = String(text ?? "").split(/\r?\n/);
  const lines = [];
  const fits = (value) => measureText(value, style) <= maxWidth + 0.01;

  paragraphs.forEach((paragraph, paragraphIndex) => {
    if (paragraph === "") {
      lines.push("");
      return;
    }
    const words = paragraph.split(/\s+/).filter(Boolean);
    let current = "";
    words.forEach((word) => {
      const candidate = current ? `${current} ${word}` : word;
      if (fits(candidate)) {
        current = candidate;
        return;
      }
      if (current) {
        lines.push(current);
        current = "";
      }
      if (fits(word)) {
        current = word;
        return;
      }
      let chunk = "";
      for (const char of word) {
        const next = chunk + char;
        if (chunk && !fits(next)) {
          lines.push(chunk);
          chunk = char;
        } else {
          chunk = next;
        }
      }
      if (chunk) current = chunk;
    });
    if (current) lines.push(current);
    if (paragraphIndex < paragraphs.length - 1 && current === "") {
      lines.push("");
    }
  });

  return lines.length ? lines : [""];
}

function mapRect(rect, transform) {
  return {
    x: transform.ox + rect.x * transform.scale,
    y: transform.oy + rect.y * transform.scale,
    w: rect.w * transform.scale,
    h: rect.h * transform.scale,
  };
}

function mapPoint(point, transform) {
  return {
    x: transform.ox + point.x * transform.scale,
    y: transform.oy + point.y * transform.scale,
  };
}

function makeTextElement(element, dieline, transform, safeScreen, measureText) {
  const raw = elementBoxMm(element, dieline);
  const box = mapRect(raw, transform);
  const safe = mapRect(safeScreen, transform);
  const style = {
    fontFamily: element.fontFamily || "DejaVu Sans",
    fontWeight: element.fontWeight || 500,
    fontSize: element.fontSize || 12,
    letterSpacing: element.letterSpacing || 0,
  };
  const lines = wrapText(element.text, raw.w, measureText, style);
  const widths = lines.map((line) => measureText(line, style));
  const lineHeight = style.fontSize * 1.22;
  const totalHeight = lines.length * lineHeight;
  const maxWidth = Math.max(0, ...widths);
  return {
    ...element,
    rawBox: raw,
    box,
    safe,
    textStyle: style,
    lines,
    lineWidths: widths,
    lineHeight: lineHeight * transform.scale,
    totalHeight: totalHeight * transform.scale,
    overflowX: maxWidth > raw.w + 0.2,
    overflowY: totalHeight > raw.h + 0.2,
    maxWidth,
  };
}

function makeElement(element, dieline, transform, measureText) {
  const normalized = normalizeElement(element);
  const safeScreen = safeRectForPanel(normalized.panel, dieline);
  const base = {
    ...normalized,
    safe: mapRect(safeScreen, transform),
  };
  if (normalized.type === "text") {
    return makeTextElement(normalized, dieline, transform, safeScreen, measureText);
  }
  const raw = elementBoxMm(normalized, dieline);
  return {
    ...base,
    box: mapRect(raw, transform),
    rawBox: raw,
    overflowX: false,
    overflowY: false,
  };
}

function buildFlatScene(state, width, height, measureText, exportMode) {
  const dieline = buildDieline(state);
  const padding = width < 720 ? 16 : 24;
  const gap = width < 720 ? 10 : 16;
  const top = 54;
  const bottom = 20;
  const foldMin = Math.max(176, Math.min(220, width * 0.29));
  const maxFlatWidth = Math.max(200, width - padding * 2 - gap - foldMin);
  const flatWidth = Math.min(maxFlatWidth, Math.max(200, width * 0.655));
  const flatFrame = {
    x: padding,
    y: top,
    w: flatWidth,
    h: height - top - bottom,
  };

  const scale = Math.min(
    (flatFrame.w - 52) / Math.max(1, dieline.netWidth),
    (flatFrame.h - 84) / Math.max(1, dieline.netHeight),
  );
  const printW = dieline.netWidth * scale;
  const printH = dieline.netHeight * scale;
  const transform = {
    scale,
    ox: flatFrame.x + (flatFrame.w - printW) / 2,
    oy: flatFrame.y + (flatFrame.h - printH) / 2 + 13,
  };

  const panels = dieline.panels.map((panel) => ({
    ...panel,
    screen: mapRect(panel, transform),
    safeScreen: mapRect(panel.safe, transform),
  }));
  const elements = state.artwork
    .map((element) => makeElement(element, dieline, transform, measureText));
  const safeIssues = elements.filter((element) => {
    const box = element.box;
    const safe = element.safe;
    return (
      box.x < safe.x - 1 ||
      box.y < safe.y - 1 ||
      box.x + box.w > safe.x + safe.w + 1 ||
      box.y + box.h > safe.y + safe.h + 1
    );
  });
  const textIssues = elements.filter(
    (element) => element.type === "text" && (element.overflowX || element.overflowY),
  );

  return {
    dieline,
    frame: flatFrame,
    transform,
    print: mapRect({ x: 0, y: 0, w: dieline.netWidth, h: dieline.netHeight }, transform),
    outline: dieline.outline.map((point) => mapPoint(point, transform)),
    folds: dieline.folds.map((line) => ({
      ...line,
      x1: transform.ox + line.x1 * scale,
      y1: transform.oy + line.y1 * scale,
      x2: transform.ox + line.x2 * scale,
      y2: transform.oy + line.y2 * scale,
    })),
    cuts: dieline.cuts.map((line) => ({
      ...line,
      x1: transform.ox + line.x1 * scale,
      y1: transform.oy + line.y1 * scale,
      x2: transform.ox + line.x2 * scale,
      y2: transform.oy + line.y2 * scale,
    })),
    topFlaps: dieline.topFlaps.map((flap) => mapRect(flap, transform)),
    bottomFlaps: dieline.bottomFlaps.map((flap) => mapRect(flap, transform)),
    panels,
    elements,
    safeIssues,
    textIssues,
    exportMode,
  };
}

function project3d(point, transform) {
  return {
    x: transform.ox + (point.x + point.z * 0.57) * transform.scale,
    y: transform.oy + (point.y - point.z * 0.37) * transform.scale,
  };
}

function makeQuad(points, fill, stroke, opacity = 1) {
  return { points, fill, stroke, opacity };
}

function buildFoldScene(state, width, height, flatFrame) {
  const d = state.dimensions;
  const gap = 16;
  const rightPadding = flatFrame.x;
  const frame = {
    x: flatFrame.x + flatFrame.w + gap,
    y: flatFrame.y,
    w: Math.max(150, width - (flatFrame.x + flatFrame.w + gap) - rightPadding),
    h: flatFrame.h,
  };
  const inner = {
    x: frame.x + 18,
    y: frame.y + 58,
    w: frame.w - 36,
    h: frame.h - 94,
  };
  const p = Math.max(0, Math.min(1, Number(state.preview.foldProgress) / 100));
  const projectedWidth = d.length + d.width * 0.57;
  const projectedHeight = d.height + d.width * 0.37;
  const scale = Math.min(
    inner.w / Math.max(1, projectedWidth),
    inner.h / Math.max(1, projectedHeight),
  );
  const transform = {
    scale: scale * 0.82,
    ox: inner.x + (inner.w - projectedWidth * scale * 0.82) / 2,
    oy: inner.y + (inner.h - projectedHeight * scale * 0.82) / 2 + d.width * 0.18 * scale,
  };
  const L = d.length;
  const W = d.width;
  const H = d.height;
  const p3 = (x, y, z) => project3d({ x, y, z }, transform);
  const top = {
    front: [p3(0, 0, 0), p3(L, 0, 0), p3(L, 0, W), p3(0, 0, W)],
    right: [p3(L, 0, 0), p3(L, H, 0), p3(L, H, W), p3(L, 0, W)],
    frontFace: [p3(0, 0, 0), p3(L, 0, 0), p3(L, H, 0), p3(0, H, 0)],
    bottomShadow: [p3(0, H, 0), p3(L, H, 0), p3(L, H, W), p3(0, H, W)],
  };
  const quads = [
    makeQuad(top.right, "#316958", "#8ab3a3", 0.98),
    makeQuad(top.frontFace, "#3f7d68", "#9bc2b0", 1),
  ];

  const angle = (p * Math.PI) / 2;
  const reach = W / 2;
  const flaps = [];
  if (p < 0.995) {
    const lift = reach * Math.cos(angle);
    const inward = reach * Math.sin(angle);
    flaps.push(
      makeQuad(
        [p3(0, 0, 0), p3(L, 0, 0), p3(L, -lift, inward), p3(0, -lift, inward)],
        COLORS.yellow,
        COLORS.accent,
        0.82,
      ),
      makeQuad(
        [p3(L, 0, 0), p3(L, 0, W), p3(L - inward, -lift, W), p3(L - inward, -lift, 0)],
        "#f0b94d",
        COLORS.accent,
        0.72,
      ),
      makeQuad(
        [p3(0, 0, W), p3(L, 0, W), p3(L, -lift, W - inward), p3(0, -lift, W - inward)],
        "#ebc66c",
        COLORS.accent,
        0.55,
      ),
    );
  }

  const seamLine = {
    x1: p3(0, 0, W / 2).x,
    y1: p3(0, 0, W / 2).y,
    x2: p3(L, 0, W / 2).x,
    y2: p3(L, 0, W / 2).y,
  };
  const glueLine = {
    x1: p3(L, 0, 0).x,
    y1: p3(L, 0, 0).y,
    x2: p3(L, H, 0).x,
    y2: p3(L, H, 0).y,
  };

  return {
    frame,
    inner,
    progress: Number(state.preview.foldProgress),
    angle,
    transform,
    quads,
    flaps,
    top,
    seamLine,
    glueLine,
    dimensions: d,
  };
}

export function createScene(state, width, height, options = {}) {
  const measureText = options.measureText || fallbackMeasure;
  const exportMode = Boolean(options.exportMode);
  const flat = buildFlatScene(state, width, height, measureText, exportMode);
  const fold = buildFoldScene(state, width, height, flat.frame);
  return {
    width,
    height,
    state,
    colors: COLORS,
    flat,
    fold,
    measureText,
    exportMode,
  };
}
