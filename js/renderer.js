import {
  entranceAt,
  measureTextElement,
  textOrigin,
  baselineForLine,
  getSafeRect,
  rotatedBounds
} from "./core.js";

const FALLBACK_FONT = '"Noto Sans SC Bundled", "Noto Sans SC", "Microsoft YaHei", sans-serif';

function fontString(style) {
  return `${style.fontWeight ?? 600} ${style.fontSize ?? 16}px ${style.fontFamily || FALLBACK_FONT}`;
}

export function createCanvasMeasurer(ctx) {
  return (text, fontSize, style = {}) => {
    ctx.font = fontString({ ...style, fontSize });
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
    return ctx.measureText(String(text)).width;
  };
}

export function gradientPoints(width, height, angle = 135) {
  const radians = ((Number(angle) || 0) * Math.PI) / 180;
  const dx = Math.sin(radians);
  const dy = -Math.cos(radians);
  const length = Math.abs(width * dx) + Math.abs(height * dy);
  const cx = width / 2;
  const cy = height / 2;
  return {
    x0: cx - (dx * length) / 2,
    y0: cy - (dy * length) / 2,
    x1: cx + (dx * length) / 2,
    y1: cy + (dy * length) / 2
  };
}

export function roundedRectPath(ctx, x, y, width, height, radius = 0) {
  const r = Math.max(0, Math.min(Number(radius) || 0, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function hasPaint(value) {
  return Boolean(value && value !== "transparent" && value !== "none");
}

function drawBackground(ctx, scene) {
  const background = scene.background ?? {};
  if (background.type === "linear") {
    const points = gradientPoints(scene.width, scene.height, background.angle);
    const gradient = ctx.createLinearGradient(points.x0, points.y0, points.x1, points.y1);
    gradient.addColorStop(0, background.from || "#101a27");
    gradient.addColorStop(1, background.to || "#070b11");
    ctx.fillStyle = gradient;
  } else {
    ctx.fillStyle = background.from || "#0b1220";
  }
  ctx.fillRect(0, 0, scene.width, scene.height);
}

function applyEntrance(ctx, element, timeMs) {
  const animation = entranceAt(element, timeMs);
  const cx = element.x + element.w / 2 + animation.x;
  const cy = element.y + element.h / 2 + animation.y;
  ctx.translate(cx, cy);
  ctx.rotate(((Number(element.rotation) || 0) * Math.PI) / 180);
  ctx.scale(animation.scale, animation.scale);
  ctx.translate(-element.w / 2, -element.h / 2);
  ctx.globalAlpha *= Math.max(0, Number(element.opacity ?? 1) * animation.opacity);
  return animation;
}

function drawShape(ctx, element) {
  const style = element.style ?? {};
  const radius = Number(style.radius) || 0;
  if (element.shape === "ellipse") {
    ctx.beginPath();
    ctx.ellipse(element.w / 2, element.h / 2, Math.abs(element.w / 2), Math.abs(element.h / 2), 0, 0, Math.PI * 2);
  } else {
    roundedRectPath(ctx, 0, 0, element.w, element.h, radius);
  }
  if (hasPaint(style.fill)) {
    ctx.fillStyle = style.fill;
    ctx.fill();
  }
  if (hasPaint(style.stroke) && Number(style.strokeWidth) > 0) {
    ctx.lineWidth = Number(style.strokeWidth);
    ctx.strokeStyle = style.stroke;
    ctx.stroke();
  }
}

function drawText(ctx, element, measurer) {
  const style = element.style ?? {};
  const metrics = measureTextElement(element, measurer);
  const radius = Number(style.radius) || 0;

  if (hasPaint(style.background)) {
    roundedRectPath(ctx, 0, 0, element.w, element.h, radius);
    ctx.fillStyle = style.background;
    ctx.fill();
  }
  if (hasPaint(style.borderColor) && Number(style.borderWidth) > 0) {
    roundedRectPath(ctx, 0, 0, element.w, element.h, radius);
    ctx.lineWidth = Number(style.borderWidth);
    ctx.strokeStyle = style.borderColor;
    ctx.stroke();
  }

  const local = { ...element, x: 0, y: 0 };
  const origin = textOrigin(local, metrics);
  ctx.font = fontString(style);
  ctx.fillStyle = style.color || "#ffffff";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${Number(style.letterSpacing) || 0}px`;
  for (let index = 0; index < metrics.lines.length; index += 1) {
    ctx.fillText(metrics.lines[index], origin.x, origin.top + baselineForLine(metrics, index));
  }
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  return metrics;
}

function imageSource(element, imageMap) {
  if (!imageMap) return null;
  return imageMap.get(element.id) || imageMap.get(element.src) || null;
}

function drawImageElement(ctx, element, imageMap) {
  const style = element.style ?? {};
  const image = imageSource(element, imageMap);
  roundedRectPath(ctx, 0, 0, element.w, element.h, Number(style.radius) || 0);
  ctx.save();
  ctx.clip();
  if (!image) {
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(0, 0, element.w, element.h);
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = `600 ${Math.max(9, element.w * 0.04)}px ${FALLBACK_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("图片载入中…", element.w / 2, element.h / 2);
  } else {
    const scale = style.fit === "contain"
      ? Math.min(element.w / image.width, element.h / image.height)
      : Math.max(element.w / image.width, element.h / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    ctx.drawImage(image, (element.w - width) / 2, (element.h - height) / 2, width, height);
  }
  ctx.restore();
}

export function drawScene(ctx, scene, options = {}) {
  const timeMs = Number(options.timeMs ?? scene.playheadMs ?? scene.timelineMs);
  const imageMap = options.imageMap;
  ctx.save();
  ctx.clearRect(0, 0, scene.width, scene.height);
  drawBackground(ctx, scene);
  for (const element of scene.elements) {
    if (!element.visible) continue;
    ctx.save();
    applyEntrance(ctx, element, timeMs);
    if (element.type === "text") drawText(ctx, element, options.measurer ?? createCanvasMeasurer(ctx));
    else if (element.type === "shape") drawShape(ctx, element);
    else if (element.type === "image") drawImageElement(ctx, element, imageMap);
    ctx.restore();
  }
  ctx.restore();
}

export function exportFrameToCanvas(canvas, scene, options = {}) {
  canvas.width = Math.max(1, Math.round(scene.width));
  canvas.height = Math.max(1, Math.round(scene.height));
  const ctx = canvas.getContext("2d");
  drawScene(ctx, scene, {
    ...options,
    timeMs: options.timeMs ?? scene.playheadMs
  });
  return canvas;
}

export function elementHandlePoints(element) {
  const angle = ((Number(element.rotation) || 0) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const cx = element.x + element.w / 2;
  const cy = element.y + element.h / 2;
  const transform = (x, y) => ({
    x: cx + (x - element.w / 2) * cos - (y - element.h / 2) * sin,
    y: cy + (x - element.w / 2) * sin + (y - element.h / 2) * cos
  });
  return {
    nw: transform(0, 0),
    ne: transform(element.w, 0),
    se: transform(element.w, element.h),
    sw: transform(0, element.h)
  };
}

export function hitTestScene(scene, point) {
  for (let index = scene.elements.length - 1; index >= 0; index -= 1) {
    const element = scene.elements[index];
    if (!element.visible) continue;
    const angle = (-(Number(element.rotation) || 0) * Math.PI) / 180;
    const cx = element.x + element.w / 2;
    const cy = element.y + element.h / 2;
    const dx = point.x - cx;
    const dy = point.y - cy;
    const localX = dx * Math.cos(angle) - dy * Math.sin(angle) + element.w / 2;
    const localY = dx * Math.sin(angle) + dy * Math.cos(angle) + element.h / 2;
    if (localX >= 0 && localX <= element.w && localY >= 0 && localY <= element.h) return element;
  }
  return null;
}

function drawSafeOverlay(ctx, scene, scale, showGuides) {
  const safe = getSafeRect(scene);
  const px = 1 / scale;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, scene.width, scene.height);
  ctx.rect(safe.left, safe.top, safe.right - safe.left, safe.bottom - safe.top);
  ctx.fillStyle = "rgba(2, 5, 9, 0.2)";
  ctx.fill("evenodd");
  ctx.lineWidth = Math.max(0.7, 1.2 * px);
  ctx.setLineDash([8 * px, 6 * px]);
  ctx.strokeStyle = "rgba(137, 210, 224, 0.75)";
  ctx.strokeRect(safe.left, safe.top, safe.right - safe.left, safe.bottom - safe.top);
  ctx.setLineDash([]);

  const arm = 13 * px;
  ctx.strokeStyle = "rgba(185, 240, 244, 0.95)";
  ctx.lineWidth = 1.6 * px;
  for (const [x, y, sx, sy] of [
    [safe.left, safe.top, 1, 1],
    [safe.right, safe.top, -1, 1],
    [safe.right, safe.bottom, -1, -1],
    [safe.left, safe.bottom, 1, -1]
  ]) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + arm * sx, y);
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + arm * sy);
    ctx.stroke();
  }

  const label = `SAFE ${Math.round(scene.safeMargin)}px`;
  ctx.font = `600 ${10 * px}px ${FALLBACK_FONT}`;
  const labelWidth = ctx.measureText(label).width + 10 * px;
  ctx.fillStyle = "rgba(7, 15, 21, 0.82)";
  roundedRectPath(ctx, safe.left, safe.top - 20 * px, labelWidth, 15 * px, 3 * px);
  ctx.fill();
  ctx.fillStyle = "rgba(190, 237, 240, 0.92)";
  ctx.textBaseline = "middle";
  ctx.fillText(label, safe.left + 5 * px, safe.top - 12.5 * px);

  if (showGuides) {
    ctx.setLineDash([3 * px, 6 * px]);
    ctx.lineWidth = 0.7 * px;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
    ctx.beginPath();
    ctx.moveTo(scene.width / 3, safe.top);
    ctx.lineTo(scene.width / 3, safe.bottom);
    ctx.moveTo((scene.width * 2) / 3, safe.top);
    ctx.lineTo((scene.width * 2) / 3, safe.bottom);
    ctx.moveTo(safe.left, scene.height / 3);
    ctx.lineTo(safe.right, scene.height / 3);
    ctx.moveTo(safe.left, (scene.height * 2) / 3);
    ctx.lineTo(safe.right, (scene.height * 2) / 3);
    ctx.stroke();
  }
  ctx.restore();
}

function drawRotatedOutline(ctx, element, color, scale, dashed = false) {
  const px = 1 / scale;
  ctx.save();
  ctx.translate(element.x + element.w / 2, element.y + element.h / 2);
  ctx.rotate(((Number(element.rotation) || 0) * Math.PI) / 180);
  ctx.translate(-element.w / 2, -element.h / 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5 * px;
  if (dashed) ctx.setLineDash([5 * px, 4 * px]);
  ctx.strokeRect(0, 0, element.w, element.h);
  ctx.restore();
}

function drawSelection(ctx, scene, element, scale) {
  const px = 1 / scale;
  const handles = elementHandlePoints(element);
  drawRotatedOutline(ctx, element, "#ff6f5d", scale);
  const size = Math.max(6 * px, Math.min(10 * px, 8 * px));
  ctx.save();
  for (const point of Object.values(handles)) {
    ctx.fillStyle = "#fff4ef";
    ctx.strokeStyle = "#ff5a45";
    ctx.lineWidth = 1.4 * px;
    ctx.fillRect(point.x - size / 2, point.y - size / 2, size, size);
    ctx.strokeRect(point.x - size / 2, point.y - size / 2, size, size);
  }
  const label = `${element.name} · ${Math.round(element.w)}×${Math.round(element.h)}`;
  ctx.font = `600 ${9 * px}px ${FALLBACK_FONT}`;
  const width = ctx.measureText(label).width + 9 * px;
  const top = Math.min(...Object.values(handles).map((point) => point.y)) - 17 * px;
  ctx.fillStyle = "#ff5a45";
  roundedRectPath(ctx, element.x, top, width, 13 * px, 3 * px);
  ctx.fill();
  ctx.fillStyle = "#1b0d09";
  ctx.textBaseline = "middle";
  ctx.fillText(label, element.x + 4.5 * px, top + 6.5 * px);
  ctx.restore();
}

function drawIssueOutlines(ctx, scene, selectedId, scale, measurer) {
  for (const element of scene.elements) {
    if (!element.visible || element.id === selectedId) continue;
    let overflow = false;
    if (element.type === "text") overflow = measureTextElement(element, measurer).overflow;
    const safe = getSafeRect(scene);
    const bounds = rotatedBounds(element);
    const outside = bounds.left < safe.left - 0.5
      || bounds.top < safe.top - 0.5
      || bounds.right > safe.right + 0.5
      || bounds.bottom > safe.bottom + 0.5;
    if (overflow || outside) drawRotatedOutline(ctx, element, "rgba(255, 90, 69, 0.58)", scale, true);
  }
}

export class StageRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.displayScale = 1;
    this.dpr = 1;
    this.cssWidth = 0;
    this.cssHeight = 0;
  }

  fit(scene, shell) {
    const bounds = shell.getBoundingClientRect();
    const availableWidth = Math.max(120, bounds.width - 22);
    const availableHeight = Math.max(90, bounds.height - 22);
    const aspect = scene.width / scene.height;
    let width = availableWidth;
    let height = width / aspect;
    if (height > availableHeight) {
      height = availableHeight;
      width = height * aspect;
    }
    this.cssWidth = Math.round(width);
    this.cssHeight = Math.round(height);
    this.dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    this.canvas.style.width = `${this.cssWidth}px`;
    this.canvas.style.height = `${this.cssHeight}px`;
    this.canvas.width = Math.max(1, Math.round(this.cssWidth * this.dpr));
    this.canvas.height = Math.max(1, Math.round(this.cssHeight * this.dpr));
    this.displayScale = this.cssWidth / scene.width;
  }

  render(scene, options = {}) {
    const { ctx } = this;
    const scale = this.displayScale;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
    ctx.save();
    ctx.scale(scale, scale);
    drawScene(ctx, scene, {
      timeMs: options.timeMs ?? scene.playheadMs,
      imageMap: options.imageMap
    });
    if (options.showSafe) drawSafeOverlay(ctx, scene, scale, options.showGuides);
    if (options.showIssues) {
      const measurer = createCanvasMeasurer(ctx);
      drawIssueOutlines(ctx, scene, options.selectedId, scale, measurer);
    }
    const selected = scene.elements.find((element) => element.id === options.selectedId);
    if (selected && options.showSelection !== false) drawSelection(ctx, scene, selected, scale);
    ctx.restore();
  }

  scenePointFromEvent(event, scene) {
    const bounds = this.canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * scene.width,
      y: ((event.clientY - bounds.top) / bounds.height) * scene.height
    };
  }
}

