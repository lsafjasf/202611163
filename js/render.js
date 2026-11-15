import { processImageData } from "./color.js";
import {
  FONT_OPTIONS,
  SAFE_MARGIN,
  SCENE_HEIGHT,
  SCENE_WIDTH,
  MIN_EXPORT_WIDTH,
  cloneState,
  getFontStack,
  normalizeState,
} from "./model.js";

export function fontString(element) {
  return `${element.fontWeight || 400} ${element.fontSize}px ${getFontStack(element.fontId)}`;
}

function measureWidth(ctx, text, element) {
  ctx.save();
  ctx.font = fontString(element);
  ctx.letterSpacing = `${element.letterSpacing || 0}px`;
  const width = ctx.measureText(text).width;
  ctx.restore();
  return width;
}

function tokenize(text) {
  return text.match(/\s+|[\u3400-\u9fff\u3000-\u303f]|[^\s\u3400-\u9fff\u3000-\u303f]+/g) || [];
}

function wrapParagraph(ctx, paragraph, maxWidth, element) {
  if (!paragraph) return [""];
  const tokens = tokenize(paragraph);
  const lines = [];
  let line = "";

  for (const token of tokens) {
    const candidate = line + token;
    if (line && measureWidth(ctx, candidate, element) > maxWidth) {
      lines.push(line.trimEnd());
      line = token.trimStart();
    } else {
      line = candidate;
    }
    if (measureWidth(ctx, line, element) > maxWidth && Array.from(line).length > 1) {
      const chars = Array.from(line);
      let chunk = "";
      for (const char of chars) {
        if (chunk && measureWidth(ctx, chunk + char, element) > maxWidth) {
          lines.push(chunk);
          chunk = char;
        } else {
          chunk += char;
        }
      }
      line = chunk;
    }
  }
  if (line || !lines.length) lines.push(line.trimEnd());
  return lines;
}

export function layoutText(ctx, element) {
  const maxWidth = Math.max(1, Number(element.width) || 1);
  const paragraphs = String(element.text ?? "").split(/\r?\n/);
  const lines = paragraphs.flatMap((paragraph) => wrapParagraph(ctx, paragraph, maxWidth, element));
  const widths = lines.map((line) => measureWidth(ctx, line, element));
  const lineHeight = element.fontSize * element.lineHeight;
  ctx.save();
  ctx.font = fontString(element);
  ctx.letterSpacing = `${element.letterSpacing || 0}px`;
  const metrics = ctx.measureText("国Ag");
  const ascent =
    metrics.fontBoundingBoxAscent ||
    metrics.actualBoundingBoxAscent ||
    element.fontSize * 0.8;
  ctx.restore();
  return {
    lines,
    widths,
    maxWidth: widths.length ? Math.max(...widths) : 0,
    lineHeight,
    ascent,
    totalHeight: Math.max(lineHeight, lineHeight * lines.length),
  };
}

export function getElementBounds(ctx, element) {
  if (!element) return null;
  if (element.type === "text") {
    const layout = layoutText(ctx, element);
    let x = element.x;
    if (element.textAlign === "center") x += element.width / 2 - layout.maxWidth / 2;
    if (element.textAlign === "right") x += element.width - layout.maxWidth;
    return {
      x,
      y: element.y,
      width: layout.maxWidth,
      height: layout.totalHeight,
      right: x + layout.maxWidth,
      bottom: element.y + layout.totalHeight,
      layout,
    };
  }

  if (element.shape === "line") {
    const stroke = Math.max(1, Number(element.strokeWidth) || 1);
    return {
      x: element.x - stroke / 2,
      y: element.y - stroke / 2,
      width: element.width + stroke,
      height: stroke,
      right: element.x + element.width + stroke / 2,
      bottom: element.y + stroke / 2,
    };
  }

  const stroke = Number(element.strokeWidth) || 0;
  return {
    x: element.x - stroke / 2,
    y: element.y - stroke / 2,
    width: element.width + stroke,
    height: element.height + stroke,
    right: element.x + element.width + stroke / 2,
    bottom: element.y + element.height + stroke / 2,
  };
}

function drawText(ctx, element) {
  const layout = layoutText(ctx, element);
  const startY = element.y;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, element.opacity ?? 1));
  ctx.fillStyle = element.color;
  ctx.font = fontString(element);
  ctx.letterSpacing = `${element.letterSpacing || 0}px`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  let x = element.x;
  if (element.textAlign === "center") x += element.width / 2 - layout.maxWidth / 2;
  if (element.textAlign === "right") x += element.width - layout.maxWidth;
  layout.lines.forEach((line, index) => {
    ctx.fillText(line, x, startY + index * layout.lineHeight + layout.ascent);
  });
  ctx.restore();
  return layout;
}

function drawShape(ctx, element) {
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, element.opacity ?? 1));
  ctx.fillStyle = element.fill;
  ctx.strokeStyle = element.stroke;
  ctx.lineWidth = element.strokeWidth;
  if (element.shape === "rect") {
    ctx.beginPath();
    ctx.rect(element.x, element.y, element.width, element.height);
    if (element.fill !== "transparent") ctx.fill();
    if (element.strokeWidth > 0) ctx.stroke();
  } else if (element.shape === "circle") {
    ctx.beginPath();
    ctx.ellipse(
      element.x + element.width / 2,
      element.y + element.height / 2,
      element.width / 2,
      element.height / 2,
      0,
      0,
      Math.PI * 2,
    );
    if (element.fill !== "transparent") ctx.fill();
    if (element.strokeWidth > 0) ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(element.x, element.y);
    ctx.lineTo(element.x + element.width, element.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSelection(ctx, element, zoom = 1) {
  const bounds = getElementBounds(ctx, element);
  if (!bounds) return;
  const pad = 7 / zoom;
  const x = bounds.x - pad;
  const y = bounds.y - pad;
  const width = Math.max(12 / zoom, bounds.width + pad * 2);
  const height = Math.max(12 / zoom, bounds.height + pad * 2);
  const unit = 1 / zoom;
  ctx.save();
  ctx.strokeStyle = "rgba(244, 202, 130, 0.96)";
  ctx.lineWidth = 1.5 * unit;
  ctx.setLineDash([5 * unit, 4 * unit]);
  ctx.strokeRect(x, y, width, height);
  ctx.setLineDash([]);
  const handle = 5 * unit;
  for (const [hx, hy] of [
    [x, y],
    [x + width, y],
    [x, y + height],
    [x + width, y + height],
  ]) {
    ctx.fillStyle = "#f0c77e";
    ctx.fillRect(hx - handle / 2, hy - handle / 2, handle, handle);
  }
  ctx.restore();
}

function drawSafeGuides(ctx, safeMargin, zoom = 1) {
  const unit = 1 / zoom;
  ctx.save();
  ctx.strokeStyle = "rgba(240, 205, 143, 0.48)";
  ctx.lineWidth = unit;
  ctx.setLineDash([7 * unit, 7 * unit]);
  ctx.strokeRect(
    safeMargin,
    safeMargin,
    SCENE_WIDTH - safeMargin * 2,
    SCENE_HEIGHT - safeMargin * 2,
  );
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(240, 205, 143, 0.55)";
  const corner = 13 * unit;
  for (const [x, y, dx, dy] of [
    [safeMargin, safeMargin, 1, 1],
    [SCENE_WIDTH - safeMargin, safeMargin, -1, 1],
    [safeMargin, SCENE_HEIGHT - safeMargin, 1, -1],
    [SCENE_WIDTH - safeMargin, SCENE_HEIGHT - safeMargin, -1, -1],
  ]) {
    ctx.fillRect(x, y, corner * dx, unit);
    ctx.fillRect(x, y, unit, corner * dy);
  }
  ctx.restore();
}

export function renderArtwork(canvas, state, adjustedSource, options = {}) {
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(adjustedSource, 0, 0, width, height);
  const scaleX = width / SCENE_WIDTH;
  const scaleY = height / SCENE_HEIGHT;
  ctx.save();
  ctx.scale(scaleX, scaleY);
  for (const element of state.elements) {
    if (!element.visible) continue;
    if (element.type === "text") drawText(ctx, element);
    else drawShape(ctx, element);
  }

  if (options.showGuides) {
    drawSafeGuides(ctx, state.export.safeMargin || SAFE_MARGIN, options.zoom || 1);
  }
  if (options.showSelection) {
    const selected = state.elements.find((element) => element.id === state.selectedId);
    if (selected?.visible) drawSelection(ctx, selected, options.zoom || 1);
  }
  ctx.restore();
  return ctx;
}

export function createAdjustedSource(baseCanvas, params) {
  const canvas = document.createElement("canvas");
  canvas.width = baseCanvas.width;
  canvas.height = baseCanvas.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(baseCanvas, 0, 0);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  processImageData(image, params);
  ctx.putImageData(image, 0, 0);
  return canvas;
}

export function hitTest(state, ctx, x, y, zoom = 1) {
  const tolerance = 5 / zoom;
  for (let index = state.elements.length - 1; index >= 0; index -= 1) {
    const element = state.elements[index];
    if (!element.visible) continue;
    const bounds = getElementBounds(ctx, element);
    if (!bounds) continue;
    if (
      x >= bounds.x - tolerance &&
      x <= bounds.x + bounds.width + tolerance &&
      y >= bounds.y - tolerance &&
      y <= bounds.y + bounds.height + tolerance
    ) {
      if (
        element.type === "shape" &&
        element.fill === "transparent" &&
        (element.shape === "rect" || element.shape === "circle")
      ) {
        const nearEdge =
          Math.abs(x - bounds.x) <= tolerance ||
          Math.abs(x - bounds.right) <= tolerance ||
          Math.abs(y - bounds.y) <= tolerance ||
          Math.abs(y - bounds.bottom) <= tolerance;
        if (!nearEdge) continue;
      }
      return element;
    }
  }
  return null;
}

function createIssue(element, code, title, message, fix) {
  return {
    code,
    elementId: element?.id || null,
    elementName: element?.name || "",
    title,
    message,
    fix,
  };
}

export function validateState(state, measureCtx) {
  const issues = [];
  const exportWidth = Number(state.export.width) || 0;
  if (exportWidth < MIN_EXPORT_WIDTH) {
    issues.push(
      createIssue(
        null,
        "export-too-small",
        "导出尺寸过小",
        `当前宽度为 ${exportWidth}px，低于可读下限 ${MIN_EXPORT_WIDTH}px。`,
        `将导出宽度提高到 ${MIN_EXPORT_WIDTH}px 以上，或使用自动适配。`,
      ),
    );
  }

  const margin = Number(state.export.safeMargin) || SAFE_MARGIN;
  for (const element of state.elements) {
    if (!element.visible) continue;
    const bounds = getElementBounds(measureCtx, element);
    if (!bounds) continue;
    const outsideCanvas =
      bounds.x < -0.5 ||
      bounds.y < -0.5 ||
      bounds.right > SCENE_WIDTH + 0.5 ||
      bounds.bottom > SCENE_HEIGHT + 0.5;
    const outsideMargin =
      bounds.x < margin - 0.5 ||
      bounds.y < margin - 0.5 ||
      bounds.right > SCENE_WIDTH - margin + 0.5 ||
      bounds.bottom > SCENE_HEIGHT - margin + 0.5;

    if (outsideCanvas) {
      const clipped = element.type === "text" ? "，文字会被裁切" : "";
      issues.push(
        createIssue(
          element,
          "outside-canvas",
          `${element.name}超出画布${clipped}`,
          `元素边界为 X ${Math.round(bounds.x)}–${Math.round(bounds.right)}、Y ${Math.round(bounds.y)}–${Math.round(bounds.bottom)}。`,
          "减小字号或尺寸，移动元素回到画布内，或点击自动适配。",
        ),
      );
      continue;
    }

    if (outsideMargin) {
      const textHint = element.type === "text" ? "文字可能贴近裁切线。" : "图形会破坏安全边距。";
      issues.push(
        createIssue(
          element,
          "safe-margin",
          `${element.name}未处于安全区域`,
          `${textHint} 当前元素与 ${margin}px 安全边距冲突。`,
          "向画布中心移动、减小字号/宽度，或切换图层后重新排版。",
        ),
      );
    }
  }
  return issues;
}

export function autoFitState(input, providedContext) {
  const state = normalizeState(cloneState(input));
  const measureCanvas = providedContext ? null : document.createElement("canvas");
  const ctx = providedContext || measureCanvas.getContext("2d");
  const margin = Math.max(24, Math.min(180, state.export.safeMargin || SAFE_MARGIN));
  if (state.export.width < MIN_EXPORT_WIDTH) {
    state.export.width = 1200;
    state.export.height = 1500;
  }
  const safeWidth = SCENE_WIDTH - margin * 2;
  const safeHeight = SCENE_HEIGHT - margin * 2;

  for (const element of state.elements) {
    if (!element.visible) continue;
    if (element.type === "shape") {
      const stroke = element.strokeWidth || 0;
      const width = Math.min(element.width, safeWidth - stroke);
      const height = element.shape === "line" ? stroke : Math.min(element.height, safeHeight - stroke);
      element.width = Math.max(1, width);
      element.height = Math.max(stroke || 1, height);
      element.x = Math.max(margin + stroke / 2, Math.min(element.x, SCENE_WIDTH - margin - element.width - stroke / 2));
      element.y = Math.max(margin + stroke / 2, Math.min(element.y, SCENE_HEIGHT - margin - element.height - stroke / 2));
      continue;
    }

    element.width = Math.max(40, Math.min(element.width, safeWidth));
    element.x = Math.max(margin, Math.min(element.x, SCENE_WIDTH - margin - element.width));
    element.y = Math.max(margin, Math.min(element.y, SCENE_HEIGHT - margin));
    let guard = 0;
    let bounds = getElementBounds(ctx, element);
    while ((bounds.bottom > SCENE_HEIGHT - margin || bounds.right > SCENE_WIDTH - margin) && guard < 80) {
      if (bounds.bottom > SCENE_HEIGHT - margin) {
        const room = SCENE_HEIGHT - margin - element.y;
        const ratio = room / bounds.height;
        if (ratio > 0.2 && ratio < 1) {
          element.fontSize = Math.max(10, Math.floor(element.fontSize * ratio * 0.96));
        } else if (element.y > margin) {
          element.y = margin;
        } else {
          element.fontSize = Math.max(10, Math.floor(element.fontSize * 0.88));
        }
      }
      if (bounds.right > SCENE_WIDTH - margin) {
        element.width = Math.max(40, element.width - 32);
      }
      if (element.fontSize <= 10 && bounds.bottom > SCENE_HEIGHT - margin && element.y <= margin) {
        element.lineHeight = Math.max(0.8, element.lineHeight * 0.92);
      }
      bounds = getElementBounds(ctx, element);
      guard += 1;
    }
  }
  return state;
}

export function describeFont(fontId) {
  return FONT_OPTIONS.find((font) => font.id === fontId)?.name || FONT_OPTIONS[0].name;
}
