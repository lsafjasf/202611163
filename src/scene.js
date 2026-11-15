import { FONT_PRESETS, normalizeModel } from "./model.js";
import {
  TAU,
  clamp,
  degToRad,
  mulberry32,
  normalizeAngle,
  radToDeg
} from "./util.js";

const FULL_CIRCLE = TAU;

export function fontFamilyFor(model, fontId) {
  if (model.assets?.fonts?.[fontId]) {
    return `"${model.assets.fonts[fontId].family}", sans-serif`;
  }
  return FONT_PRESETS.find((font) => font.id === fontId)?.family || FONT_PRESETS[0].family;
}

function fontString(size, weight, family) {
  return `${weight || 600} ${Math.max(1, size)}px ${family}`;
}

function rotatePoint(x, y, radians) {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: x * cos - y * sin,
    y: x * sin + y * cos
  };
}

function transformPoint(cx, cy, scale, rotation, x, y) {
  const scaled = rotatePoint(x * scale, y * scale, rotation);
  return { x: cx + scaled.x, y: cy + scaled.y };
}

function emptyBounds() {
  return {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    maxRadius: 0,
    width: 0,
    height: 0
  };
}

function includePoint(bounds, x, y, centerX, centerY) {
  bounds.minX = Math.min(bounds.minX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.maxY = Math.max(bounds.maxY, y);
  bounds.maxRadius = Math.max(bounds.maxRadius, Math.hypot(x - centerX, y - centerY));
}

function finalizeBounds(bounds, centerX, centerY) {
  if (!Number.isFinite(bounds.minX)) return null;
  bounds.width = bounds.maxX - bounds.minX;
  bounds.height = bounds.maxY - bounds.minY;
  return bounds;
}

function unionBounds(target, source) {
  if (!source) return target;
  target.minX = Math.min(target.minX, source.minX);
  target.minY = Math.min(target.minY, source.minY);
  target.maxX = Math.max(target.maxX, source.maxX);
  target.maxY = Math.max(target.maxY, source.maxY);
  target.maxRadius = Math.max(target.maxRadius, source.maxRadius);
  return target;
}

function drawableMaxRadius(item, center) {
  const distance = (x, y) => Math.hypot(x - center.x, y - center.y);
  if (item.kind === "arc") {
    return distance(item.cx, item.cy) + Math.abs(item.radius) + item.width / 2;
  }
  if (item.kind === "line") {
    return Math.max(distance(item.x1, item.y1), distance(item.x2, item.y2)) + item.width / 2;
  }
  if (item.kind === "circle") {
    return distance(item.x, item.y) + item.radius + (item.width || 0) / 2;
  }
  if (item.kind === "polygon") {
    return Math.max(...item.points.map((point) => distance(point.x, point.y)));
  }
  if (item.kind === "image") {
    const half = Math.hypot(item.width / 2, item.height / 2);
    return distance(item.x, item.y) + half;
  }
  return 0;
}

function groupMaxRadius(group, center) {
  let maxRadius = 0;
  for (const glyph of group.glyphs || []) {
    for (const corner of glyphBounds(glyph)) {
      maxRadius = Math.max(maxRadius, Math.hypot(corner.x - center.x, corner.y - center.y));
    }
  }
  for (const item of group.drawables) {
    maxRadius = Math.max(maxRadius, drawableMaxRadius(item, center));
  }
  return maxRadius;
}

function glyphMetrics(ctx, char, size, weight, family) {
  ctx.font = fontString(size, weight, family);
  const metrics = ctx.measureText(char);
  const ascent = Math.max(1, metrics.actualBoundingBoxAscent || size * 0.72);
  const descent = Math.max(0, metrics.actualBoundingBoxDescent || size * 0.2);
  return {
    width: metrics.width,
    advance: metrics.width,
    ascent,
    descent
  };
}

function buildLineText(element, center, fontFamily, ctx) {
  const glyphs = [];
  const drawables = [];
  const measured = [];
  const scale = element.transform.scale;
  const rotation = degToRad(element.transform.rotation);
  const size = element.fontSize;
  const chars = Array.from(element.text || "");

  for (const char of chars) {
    const metrics = glyphMetrics(ctx, char, size, element.fontWeight, fontFamily);
    measured.push({ char, ...metrics });
  }
  const spacing = (element.letterSpacing || 0) * scale;
  const totalWidth = measured.reduce((sum, item) => sum + item.advance * scale, 0)
    + Math.max(0, measured.length - 1) * spacing;
  const maxAscent = Math.max(1, ...measured.map((item) => item.ascent));
  const maxDescent = Math.max(0, ...measured.map((item) => item.descent));
  const baseline = ((maxAscent - maxDescent) / 2) * scale;
  let cursor = element.align === "left" ? 0 : -totalWidth / 2;
  if (element.align === "right") cursor = -totalWidth;

  const bounds = emptyBounds();
  measured.forEach((item, index) => {
    const localCenterX = cursor + (item.advance * scale) / 2;
    const anchor = transformPoint(center.x, center.y, 1, rotation, localCenterX, baseline);
    const halfW = (item.advance * scale) / 2;
    const top = -maxAscent * scale;
    const bottom = maxDescent * scale;
    for (const [x, y] of [[-halfW, top], [halfW, top], [halfW, bottom], [-halfW, bottom]]) {
      const rotated = rotatePoint(x, y, rotation);
      const point = { x: anchor.x + rotated.x, y: anchor.y + rotated.y };
      includePoint(bounds, point.x, point.y, center.x, center.y);
    }
    if (item.char.trim()) {
      drawables.push({
        kind: "glyph",
        text: item.char,
        x: anchor.x,
        y: anchor.y,
        fontSize: size * scale,
        fontFamily,
        fontWeight: element.fontWeight,
        rotation,
        opacity: element.opacity
      });
    }
    glyphs.push({
      char: item.char,
      x: anchor.x,
      y: anchor.y,
      width: item.advance * scale,
      ascent: maxAscent * scale,
      descent: maxDescent * scale,
      rotation,
      index
    });
    cursor += item.advance * scale + spacing;
  });

  return {
    drawables,
    glyphs,
    bounds: finalizeBounds(bounds, center.x, center.y),
    layout: {
      totalWidth,
      fontSize: size * scale,
      lineHeight: (maxAscent + maxDescent) * scale
    }
  };
}

function buildArcText(element, center, fontFamily, ctx) {
  const glyphs = [];
  const drawables = [];
  const measured = [];
  const scale = element.transform.scale;
  const rotation = degToRad(element.transform.rotation);
  const size = element.fontSize;
  const chars = Array.from(element.text || "");

  for (const char of chars) {
    const metrics = glyphMetrics(ctx, char, size, element.fontWeight, fontFamily);
    measured.push({ char, ...metrics });
  }
  const radius = element.radius * scale;
  const spacing = (element.letterSpacing || 0) * scale;
  const totalArc = measured.reduce((sum, item) => sum + item.advance * scale, 0)
    + Math.max(0, measured.length - 1) * spacing;
  const span = radius > 0 ? totalArc / radius : Math.PI * 2;
  const directionSign = element.direction === "bottom" ? -1 : 1;
  const baseAngle = (element.direction === "bottom" ? Math.PI / 2 : -Math.PI / 2) + rotation;
  const halfSpan = span / 2;
  let cursor = 0;
  const bounds = emptyBounds();

  measured.forEach((item, index) => {
    const distance = cursor + (item.advance * scale) / 2;
    const angle = baseAngle - directionSign * halfSpan + directionSign * (distance / Math.max(radius, 0.001));
    const x = center.x + Math.cos(angle) * radius;
    const y = center.y + Math.sin(angle) * radius;
    const glyphRotation = angle + (element.direction === "bottom" ? -Math.PI / 2 : Math.PI / 2);
    const halfW = (item.advance * scale) / 2;
    const ascent = item.ascent * scale;
    const descent = item.descent * scale;
    for (const [localX, localY] of [
      [-halfW, -ascent],
      [halfW, -ascent],
      [halfW, descent],
      [-halfW, descent]
    ]) {
      const point = transformPoint(x, y, 1, glyphRotation, localX, localY);
      includePoint(bounds, point.x, point.y, center.x, center.y);
    }
    if (item.char.trim()) {
      drawables.push({
        kind: "glyph",
        text: item.char,
        x,
        y,
        fontSize: size * scale,
        fontFamily,
        fontWeight: element.fontWeight,
        rotation: glyphRotation,
        opacity: element.opacity
      });
    }
    glyphs.push({
      char: item.char,
      x,
      y,
      width: item.advance * scale,
      ascent,
      descent,
      rotation: glyphRotation,
      angle,
      index
    });
    cursor += item.advance * scale + spacing;
  });

  return {
    drawables,
    glyphs,
    bounds: finalizeBounds(bounds, center.x, center.y),
    layout: {
      radius,
      requiredSpan: span,
      requiredSpanDeg: radToDeg(span),
      maxSpan: element.maxSpan,
      totalArc,
      direction: element.direction
    }
  };
}

function arcForGap(gapAngle, gapSize) {
  if (!gapSize || gapSize <= 0.001) {
    return { start: 0, end: FULL_CIRCLE };
  }
  const center = degToRad(gapAngle);
  const half = degToRad(gapSize) / 2;
  return {
    start: normalizeAngle(center + half),
    end: normalizeAngle(center - half) || FULL_CIRCLE
  };
}

function buildRing(element, center, inkColor) {
  const scale = element.transform.scale;
  const cx = center.x;
  const cy = center.y;
  const radius = element.radius * scale;
  const width = element.width * scale;
  const rotation = element.transform.rotation;
  const gapAngle = element.gapAngle + rotation;
  const gap = arcForGap(gapAngle, element.gapSize);
  const drawables = [{
    kind: "arc",
    cx,
    cy,
    radius,
    start: gap.start,
    end: gap.end,
    width,
    lineCap: "butt",
    opacity: element.opacity,
    color: inkColor
  }];
  const wedges = [];
  if (element.gapSize > 0.001) {
    wedges.push({
      elementId: element.id,
      cx,
      cy,
      innerRadius: radius - width / 2 - 2,
      outerRadius: radius + width / 2 + 2,
      angle: degToRad(gapAngle),
      halfAngle: degToRad(element.gapSize) / 2,
      source: "main"
    });
  }
  let outerExtent = radius + width / 2;
  if (element.accent?.enabled) {
    const accentRadius = radius + element.accent.offset * scale;
    const accentWidth = element.accent.width * scale;
    const accentGap = arcForGap(gapAngle + (element.accent.gapAngle - element.gapAngle), element.accent.gapSize);
    drawables.push({
      kind: "arc",
      cx,
      cy,
      radius: accentRadius,
      start: accentGap.start,
      end: accentGap.end,
      width: accentWidth,
      lineCap: "butt",
      opacity: element.opacity,
      color: inkColor
    });
    outerExtent = Math.max(outerExtent, Math.abs(accentRadius) + accentWidth / 2);
    if (element.accent.gapSize > 0.001) {
      wedges.push({
        elementId: element.id,
        cx,
        cy,
        innerRadius: accentRadius - accentWidth / 2 - 2,
        outerRadius: accentRadius + accentWidth / 2 + 2,
        angle: degToRad(gapAngle + (element.accent.gapAngle - element.gapAngle)),
        halfAngle: degToRad(element.accent.gapSize) / 2,
        source: "accent"
      });
    }
  }
  const bounds = emptyBounds();
  for (const angle of [0, Math.PI / 4, Math.PI / 2, (Math.PI * 3) / 4]) {
    includePoint(bounds, cx + Math.cos(angle) * outerExtent, cy + Math.sin(angle) * outerExtent, cx, cy);
    includePoint(bounds, cx - Math.cos(angle) * outerExtent, cy - Math.sin(angle) * outerExtent, cx, cy);
  }
  return {
    drawables,
    bounds: finalizeBounds(bounds, center.x, center.y),
    wedges,
    layout: { radius, width, gapAngle, outerExtent }
  };
}

function buildMotif(element, center, inkColor) {
  const scale = element.transform.scale;
  const rotation = degToRad(element.transform.rotation);
  const width = element.width * scale;
  const size = element.size * scale;
  const half = width / 2;
  const drawables = [];
  const bounds = emptyBounds();

  const addLine = (x1, y1, x2, y2, lineWidth = size * 0.65) => {
    const a = transformPoint(center.x, center.y, 1, rotation, x1, y1);
    const b = transformPoint(center.x, center.y, 1, rotation, x2, y2);
    drawables.push({
      kind: "line",
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      width: lineWidth,
      lineCap: "round",
      opacity: element.opacity,
      color: inkColor
    });
    includePoint(bounds, a.x, a.y, center.x, center.y);
    includePoint(bounds, b.x, b.y, center.x, center.y);
  };

  const addDot = (x, y, radius) => {
    const point = transformPoint(center.x, center.y, 1, rotation, x, y);
    drawables.push({
      kind: "circle",
      x: point.x,
      y: point.y,
      radius,
      filled: true,
      opacity: element.opacity,
      color: inkColor
    });
    includePoint(bounds, point.x - radius, point.y - radius, center.x, center.y);
    includePoint(bounds, point.x + radius, point.y + radius, center.x, center.y);
  };

  const addDiamond = (x, y, halfSize) => {
    const points = [
      [x, y - halfSize],
      [x + halfSize, y],
      [x, y + halfSize],
      [x - halfSize, y]
    ].map(([px, py]) => transformPoint(center.x, center.y, 1, rotation, px, py));
    drawables.push({
      kind: "polygon",
      points,
      filled: true,
      opacity: element.opacity,
      color: inkColor
    });
    for (const point of points) {
      includePoint(bounds, point.x, point.y, center.x, center.y);
    }
  };

  if (element.variant === "dots") {
    const count = 7;
    for (let index = 0; index < count; index += 1) {
      const x = -half + (width / (count - 1)) * index;
      const distanceFromCenter = Math.abs(index - (count - 1) / 2);
      const radius = size * (1 - distanceFromCenter * 0.13);
      addDot(x, 0, Math.max(1, radius));
    }
  } else {
    const centerGap = size * 2.2;
    addLine(-half, 0, -centerGap, 0);
    addLine(centerGap, 0, half, 0);
    addDiamond(0, 0, size * 1.15);
    addDot(-half - size, 0, size * 0.5);
    addDot(half + size, 0, size * 0.5);
    addDot(-half * 0.58, 0, size * 0.28);
    addDot(half * 0.58, 0, size * 0.28);
  }
  return {
    drawables,
    bounds: finalizeBounds(bounds, center.x, center.y),
    layout: { width, size }
  };
}

function buildImage(element, center, model) {
  const asset = model.assets.images[element.assetId];
  if (!asset) {
    return { drawables: [], bounds: null, missing: true };
  }
  const scale = element.transform.scale;
  const width = element.imageWidth * scale;
  const height = (element.imageWidth / Math.max(0.01, element.aspect || 1)) * scale;
  const rotation = degToRad(element.transform.rotation);
  const bounds = emptyBounds();
  for (const [x, y] of [[-width / 2, -height / 2], [width / 2, -height / 2], [width / 2, height / 2], [-width / 2, height / 2]]) {
    const point = transformPoint(center.x, center.y, 1, rotation, x, y);
    includePoint(bounds, point.x, point.y, center.x, center.y);
  }
  return {
    drawables: [{
      kind: "image",
      x: center.x,
      y: center.y,
      width,
      height,
      rotation,
      assetId: element.assetId,
      dataUrl: asset.dataUrl,
      opacity: element.opacity
    }],
    bounds: finalizeBounds(bounds, center.x, center.y),
    layout: { width, height }
  };
}

function buildWear(model, inkBounds, seedOffset = 0) {
  const wear = clamp(model.style.wear ?? 0.45, 0, 1);
  const chips = clamp(model.style.chips ?? 0.3, 0, 1);
  const radius = model.document.size / 2;
  const scale = model.document.size / 720;
  const random = mulberry32((Number(model.style.seed) || 1) + seedOffset);
  const spots = [];
  const scratches = [];
  const outerRing = model.elements.find((element) => element.type === "ring" && element.visible);
  const ringRadius = (outerRing?.radius || radius * 0.87) * (outerRing?.transform.scale || 1);
  const ringWidth = (outerRing?.width || 8) * (outerRing?.transform.scale || 1);

  const spotCount = Math.round(wear * 210);
  for (let index = 0; index < spotCount; index += 1) {
    const mode = random();
    let distance;
    if (mode < 0.5) {
      distance = ringRadius + (random() - 0.5) * ringWidth * 1.4;
    } else if (mode < 0.72) {
      const inner = model.elements.find((element) => element.type === "ring" && element.id !== outerRing?.id);
      distance = (inner?.radius || radius * 0.58) * (inner?.transform.scale || 1) + (random() - 0.5) * 5 * scale;
    } else {
      distance = radius * Math.sqrt(random()) * 0.94;
    }
    const angle = random() * FULL_CIRCLE;
    const grain = 0.35 + random() ** 2.7 * 2.7;
    spots.push({
      x: radius + Math.cos(angle) * distance,
      y: radius + Math.sin(angle) * distance,
      r: Math.max(0.28, grain * scale),
      alpha: 0.28 + random() * 0.72
    });
  }

  const chipCount = Math.round(chips * 90);
  for (let index = 0; index < chipCount; index += 1) {
    const angle = random() * FULL_CIRCLE;
    spots.push({
      x: radius + Math.cos(angle) * ringRadius,
      y: radius + Math.sin(angle) * ringRadius,
      r: (1 + random() ** 1.7 * 5.2) * scale,
      alpha: 0.5 + random() * 0.5
    });
  }

  const scratchCount = Math.round(wear * 26);
  for (let index = 0; index < scratchCount; index += 1) {
    const angle = random() * FULL_CIRCLE;
    const distance = radius * (0.32 + random() * 0.63);
    const x = radius + Math.cos(angle) * distance;
    const y = radius + Math.sin(angle) * distance;
    const tangent = angle + Math.PI / 2;
    const length = (4 + random() * 34) * scale;
    scratches.push({
      x1: x - Math.cos(tangent) * length / 2,
      y1: y - Math.sin(tangent) * length / 2,
      x2: x + Math.cos(tangent) * length / 2,
      y2: y + Math.sin(tangent) * length / 2,
      width: (0.3 + random() * 1.1) * scale,
      alpha: 0.22 + random() * 0.55
    });
  }
  return { spots, scratches, ringRadius, ringWidth, seed: model.style.seed };
}

export function createMeasurer() {
  const canvas = document.createElement("canvas");
  canvas.width = 8;
  canvas.height = 8;
  const ctx = canvas.getContext("2d");
  return {
    ctx,
    fontFamilyFor: null
  };
}

export function buildScene(inputModel, measurer, options = {}) {
  const model = normalizeModel(inputModel);
  const ctx = measurer?.ctx || measurer;
  if (!ctx || typeof ctx.measureText !== "function") {
    throw new Error("场景生成器需要可用的 Canvas 2D 上下文。");
  }
  const size = model.document.size;
  const center = { x: size / 2 + (options.offsetX || 0), y: size / 2 + (options.offsetY || 0) };
  const groups = [];
  const arcs = [];
  const wedges = [];
  const missingImages = [];
  const byElement = {};
  const allInk = emptyBounds();
  let order = 0;

  for (const element of model.elements) {
    if (!element.visible) continue;
    if (options.onlyElementId && element.id !== options.onlyElementId) continue;
    const fontFamily = element.fontFamily || fontFamilyFor(model, element.fontId);
    const elementCenter = {
      x: center.x + (element.transform.x || 0),
      y: center.y + (element.transform.y || 0)
    };
    let built;
    if (element.type === "ring") {
      built = buildRing(element, elementCenter, model.style.color);
      wedges.push(...(built.wedges || []).map((wedge) => ({ ...wedge, elementName: element.name })));
    } else if (element.type === "arcText") {
      built = buildArcText(element, elementCenter, fontFamily, ctx);
      arcs.push({
        elementId: element.id,
        elementName: element.name,
        ...built.layout
      });
    } else if (element.type === "text") {
      built = buildLineText(element, elementCenter, fontFamily, ctx);
    } else if (element.type === "motif") {
      built = buildMotif(element, elementCenter, model.style.color);
    } else if (element.type === "image") {
      built = buildImage(element, elementCenter, model);
      if (built.missing) missingImages.push(element);
    } else {
      continue;
    }
    if (!built.bounds) continue;
    built.bounds.maxRadius = Math.max(
      built.bounds.maxRadius,
      groupMaxRadius({
        glyphs: built.glyphs || [],
        drawables: built.drawables
      }, center)
    );
    const group = {
      id: element.id,
      index: order,
      name: element.name,
      type: element.type,
      bounds: built.bounds,
      drawables: built.drawables,
      glyphs: built.glyphs || [],
      layout: built.layout,
      element
    };
    groups.push(group);
    byElement[element.id] = built.bounds;
    unionBounds(allInk, built.bounds);
    order += 1;
  }

  const inkBounds = finalizeBounds(allInk, center.x, center.y);
  const wear = buildWear(model, inkBounds);

  return {
    version: model.version,
    width: size,
    height: size,
    center,
    color: model.style.color,
    inkOpacity: model.style.inkOpacity,
    model,
    groups,
    drawables: groups.flatMap((group) => group.drawables),
    arcs,
    wedges,
    missingImages,
    bounds: inkBounds,
    byElement,
    wear,
    options
  };
}

export function glyphBounds(glyph) {
  const points = [
    [-glyph.width / 2, -glyph.ascent],
    [glyph.width / 2, -glyph.ascent],
    [glyph.width / 2, glyph.descent],
    [-glyph.width / 2, glyph.descent]
  ];
  return points.map(([x, y]) => {
    const rotated = rotatePoint(x, y, glyph.rotation);
    return { x: glyph.x + rotated.x, y: glyph.y + rotated.y };
  });
}
