import { paragraphTexts } from "./model.js";

let measurementCanvas = null;

export function getMeasurementContext() {
  if (!measurementCanvas) {
    measurementCanvas = document.createElement("canvas");
    measurementCanvas.width = 16;
    measurementCanvas.height = 16;
  }
  return measurementCanvas.getContext("2d");
}

export function getFontString(font) {
  return `${font.weight || 400} ${font.size}px ${font.family}`;
}

export function shapeBounds(shape) {
  return {
    x: shape.x,
    y: shape.y,
    w: shape.w,
    h: shape.h,
    right: shape.x + shape.w,
    bottom: shape.y + shape.h,
  };
}

export function pointInShape(shape, x, y) {
  if (!shape) return false;
  if (shape.type === "ellipse") {
    const rx = shape.w / 2;
    const ry = shape.h / 2;
    if (rx <= 0 || ry <= 0) return false;
    const nx = (x - (shape.x + rx)) / rx;
    const ny = (y - (shape.y + ry)) / ry;
    return nx * nx + ny * ny <= 1;
  }
  return x >= shape.x && x <= shape.x + shape.w && y >= shape.y && y <= shape.y + shape.h;
}

function roundedInset(shape, sampleY) {
  const radius = Math.max(0, Math.min(shape.radius || 0, shape.w / 2, shape.h / 2));
  if (radius === 0) return 0;
  const relativeY = sampleY - shape.y;
  if (relativeY >= radius && relativeY <= shape.h - radius) return 0;
  const centerY = relativeY < radius ? radius : shape.h - radius;
  const dy = Math.abs(relativeY - centerY);
  if (dy > radius) return radius;
  return radius - Math.sqrt(Math.max(0, radius * radius - dy * dy));
}

function rawIntervalsAtY(shape, sampleY) {
  const left = shape.x + shape.padding;
  const right = shape.x + shape.w - shape.padding;
  const top = shape.y + shape.padding;
  const bottom = shape.y + shape.h - shape.padding;
  if (sampleY < top || sampleY > bottom || right <= left) return [];

  if (shape.type === "ellipse") {
    const cx = shape.x + shape.w / 2;
    const cy = shape.y + shape.h / 2;
    const rx = Math.max(0, shape.w / 2 - shape.padding);
    const ry = Math.max(0, shape.h / 2 - shape.padding);
    if (rx <= 0 || ry <= 0) return [];
    const normalized = (sampleY - cy) / ry;
    if (Math.abs(normalized) >= 1) return [];
    const halfWidth = rx * Math.sqrt(Math.max(0, 1 - normalized * normalized));
    return [{ x0: cx - halfWidth, x1: cx + halfWidth }];
  }

  const inset = shape.type === "rounded" ? roundedInset(shape, sampleY) : 0;
  const x0 = left + inset;
  const x1 = right - inset;
  return x1 > x0 ? [{ x0, x1 }] : [];
}

export function getFrameIntervals(shape, bandTop, bandHeight) {
  if (!shape || bandHeight <= 0) return [];
  const samples = [bandTop, bandTop + bandHeight / 2, bandTop + bandHeight];
  const ranges = samples.map((sample) => rawIntervalsAtY(shape, sample));
  if (ranges.some((rangesAtSample) => rangesAtSample.length === 0)) return [];

  let x0 = -Infinity;
  let x1 = Infinity;
  for (const sampleRanges of ranges) {
    x0 = Math.max(x0, Math.max(...sampleRanges.map((range) => range.x0)));
    x1 = Math.min(x1, Math.min(...sampleRanges.map((range) => range.x1)));
  }
  return x1 > x0 ? [{ x0, x1 }] : [];
}

function subtractRange(intervals, obstacle) {
  const result = [];
  for (const interval of intervals) {
    if (obstacle.x1 <= interval.x0 || obstacle.x0 >= interval.x1) {
      result.push(interval);
      continue;
    }
    if (obstacle.x0 > interval.x0) {
      result.push({ x0: interval.x0, x1: Math.min(interval.x1, obstacle.x0) });
    }
    if (obstacle.x1 < interval.x1) {
      result.push({ x0: Math.max(interval.x0, obstacle.x1), x1: interval.x1 });
    }
  }
  return result.filter((interval) => interval.x1 - interval.x0 > 0.5);
}

function subtractObstacles(intervals, top, height, obstacles) {
  let result = intervals;
  for (const obstacle of obstacles) {
    if (obstacle.y + obstacle.h <= top || obstacle.y >= top + height) continue;
    result = subtractRange(result, {
      x0: obstacle.x,
      x1: obstacle.x + obstacle.w,
    });
    if (result.length === 0) break;
  }
  return result;
}

const TOKEN_PATTERN =
  /([A-Za-z0-9]+(?:[’'\-][A-Za-z0-9]+)*)|(\s+)|([\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]|[\s\S])/gu;

function tokenize(text) {
  const tokens = [];
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    tokens.push(match[0]);
  }
  return tokens;
}

function measure(ctx, text) {
  return ctx.measureText(text).width;
}

function consumeLine(ctx, tokens, startIndex, maxWidth) {
  let index = startIndex;
  while (index < tokens.length && /^\s+$/.test(tokens[index])) index += 1;
  if (index >= tokens.length) {
    return { text: "", width: 0, nextIndex: index };
  }

  let text = "";
  let width = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    const candidate = text + token;
    const candidateWidth = measure(ctx, candidate);
    if (candidateWidth <= maxWidth + 0.1) {
      text = candidate;
      width = candidateWidth;
      index += 1;
      continue;
    }

    if (!text.trim()) {
      let partial = "";
      for (const char of token) {
        const partialCandidate = partial + char;
        if (measure(ctx, partialCandidate) > maxWidth && partial) break;
        partial = partialCandidate;
      }
      if (!partial) partial = Array.from(token)[0] || "";
      text = partial;
      width = measure(ctx, partial);
      const tokenChars = Array.from(token);
      if (partial === token) {
        index += 1;
      } else {
        tokens[index] = token.slice(partial.length);
      }
    }
    break;
  }

  const trimmed = text.replace(/\s+$/u, "");
  return {
    text: trimmed,
    width: trimmed === text ? width : measure(ctx, trimmed),
    nextIndex: index,
  };
}

function compactParagraph(text) {
  return String(text || "").replace(/\s+/gu, " ").trim();
}

function allObstacles(doc, pinnedLines) {
  const pinnedGroups = new Map();
  for (const line of pinnedLines) {
    if (!pinnedGroups.has(line.paragraphIndex)) {
      pinnedGroups.set(line.paragraphIndex, []);
    }
    pinnedGroups.get(line.paragraphIndex).push(line);
  }
  const result = [];
  for (const lines of pinnedGroups.values()) {
    const left = Math.min(...lines.map((line) => line.x));
    const top = Math.min(...lines.map((line) => line.top));
    const right = Math.max(...lines.map((line) => line.x + line.width));
    const bottom = Math.max(...lines.map((line) => line.top + line.height));
    result.push({
      x: left - 6,
      y: top - 4,
      w: right - left + 12,
      h: bottom - top + 8 + (doc.paragraph?.spacing || 0),
    });
  }
  for (const shape of doc.shapes) {
    if (shape.textFlow || (shape.type === "rect" && shape.h <= 4)) continue;
    result.push({
      x: shape.x - 7,
      y: shape.y - 7,
      w: shape.w + 14,
      h: shape.h + 14,
    });
  }
  return result;
}

function sortedFlowFrames(doc) {
  return doc.shapes
    .filter((shape) => shape.textFlow)
    .slice()
    .sort((a, b) => a.flowOrder - b.flowOrder || a.y - b.y || a.x - b.x);
}

function lineBandTop(font, lineTop) {
  return lineTop + Math.max(0, (font.size * font.lineHeight - font.size) / 2);
}

function frameStartY(frame, font) {
  return frame.y + frame.padding + Math.max(0, (font.size * font.lineHeight - font.size) / 2);
}

function frameHasRoom(frame, font, lineTop) {
  const glyphHeight = font.size * 1.02;
  return lineTop + (font.size * font.lineHeight - font.size) / 2 + glyphHeight <=
    frame.y + frame.h - frame.padding + 0.5;
}

function makeLine({
  text,
  x,
  lineTop,
  width,
  font,
  frameId,
  paragraphIndex,
  lineIndex,
  pinned,
}) {
  const glyphHeight = font.size * 1.02;
  const top = lineBandTop(font, lineTop);
  return {
    id: `p${paragraphIndex}-l${lineIndex}`,
    text,
    x,
    top,
    baseline: top + font.size * 0.82,
    width,
    height: glyphHeight,
    lineTop,
    frameId,
    paragraphIndex,
    lineIndex,
    pinned,
  };
}

function pickInterval(intervals, preferredX) {
  if (intervals.length === 0) return null;
  return (
    intervals.find(
      (interval) => preferredX >= interval.x0 - 0.5 && preferredX < interval.x1 - 0.5,
    ) || intervals.reduce((best, interval) => {
      const width = interval.x1 - interval.x0;
      return !best || width > best.x1 - best.x0 ? interval : best;
    }, null)
  );
}

function paragraphBounds(lines) {
  if (lines.length === 0) return null;
  const x = Math.min(...lines.map((line) => line.x));
  const y = Math.min(...lines.map((line) => line.top));
  const right = Math.max(...lines.map((line) => line.x + line.width));
  const bottom = Math.max(...lines.map((line) => line.top + line.height));
  return { x, y, w: right - x, h: bottom - y, right, bottom };
}

function remainingText(tokens, startIndex) {
  return tokens.slice(startIndex).join("");
}

function layoutPinned({
  ctx,
  doc,
  frame,
  paragraphIndex,
  text,
  pin,
  priorPinnedLines,
}) {
  const font = doc.font;
  const lineHeight = font.size * font.lineHeight;
  const glyphHeight = font.size * 1.02;
  const tokens = tokenize(compactParagraph(text));
  const lines = [];
  const obstacles = allObstacles(doc, priorPinnedLines);
  let index = 0;
  let lineTop = Number.isFinite(pin.y) ? pin.y : frameStartY(frame, font);
  let lineIndex = 0;
  let overflow = null;
  const maxRight = pin.width > 1 ? pin.x + pin.width : frame.x + frame.w - frame.padding;

  while (index < tokens.length) {
    if (!frameHasRoom(frame, font, lineTop)) {
      overflow = remainingText(tokens, index);
      break;
    }
    const bandTop = lineBandTop(font, lineTop);
    const base = getFrameIntervals(frame, bandTop, glyphHeight);
    const available = subtractObstacles(base, bandTop, glyphHeight, obstacles);
    const interval = available.find(
      (item) => item.x0 <= pin.x + 1 && item.x1 > pin.x + 2,
    );
    if (!interval) {
      lineTop += lineHeight;
      continue;
    }
    const right = Math.min(interval.x1, maxRight);
    const maxWidth = right - pin.x;
    if (maxWidth < Math.max(3, font.size * 0.36)) {
      lineTop += lineHeight;
      continue;
    }
    const result = consumeLine(ctx, tokens, index, maxWidth);
    if (!result.text) {
      overflow = remainingText(tokens, result.nextIndex);
      break;
    }
    lines.push(
      makeLine({
        text: result.text,
        x: pin.x,
        lineTop,
        width: result.width,
        font,
        frameId: frame.id,
        paragraphIndex,
        lineIndex,
        pinned: true,
      }),
    );
    index = result.nextIndex;
    lineIndex += 1;
    lineTop += lineHeight;
  }

  return { lines, overflow };
}

export function measureLayout(doc, options = {}) {
  const ctx = options.ctx || getMeasurementContext();
  const font = doc.font;
  ctx.save();
  ctx.font = getFontString(font);
  ctx.textBaseline = "alphabetic";
  ctx.direction = "ltr";

  const texts = paragraphTexts(doc.content.text);
  const frames = sortedFlowFrames(doc);
  const frameMap = new Map(frames.map((frame) => [frame.id, frame]));
  const pinMap = new Map();
  for (const pin of doc.pinned || []) {
    if (!pinMap.has(pin.paragraphIndex)) pinMap.set(pin.paragraphIndex, pin);
  }

  const paragraphs = texts.map((text, index) => ({
    index,
    text,
    pinned: pinMap.has(index),
    lines: [],
    frameIds: [],
    bounds: null,
    overflowText: "",
  }));
  const allLines = [];
  const pinnedLines = [];
  const overflowSegments = [];

  for (const paragraph of paragraphs) {
    if (!paragraph.pinned) continue;
    const pin = pinMap.get(paragraph.index);
    const frame = frameMap.get(pin.shapeId);
    if (!frame) {
      paragraph.overflowText = paragraph.text;
      overflowSegments.push({
        paragraphIndex: paragraph.index,
        text: paragraph.text,
        chars: Array.from(paragraph.text.replace(/\s/gu, "")).length,
        reason: "固定段落所属图形已不存在",
      });
      continue;
    }
    const result = layoutPinned({
      ctx,
      doc,
      frame,
      paragraphIndex: paragraph.index,
      text: paragraph.text,
      pin,
      priorPinnedLines: pinnedLines,
    });
    paragraph.lines = result.lines;
    paragraph.frameIds = [...new Set(result.lines.map((line) => line.frameId))];
    paragraph.bounds = paragraphBounds(result.lines);
    paragraph.overflowText = result.overflow || "";
    pinnedLines.push(...result.lines);
    allLines.push(...result.lines);
    if (result.overflow) {
      overflowSegments.push({
        paragraphIndex: paragraph.index,
        text: result.overflow,
        chars: Array.from(result.overflow.replace(/\s/gu, "")).length,
        reason: "固定段落超出图形或画布",
      });
    }
  }

  const obstacles = allObstacles(doc, pinnedLines);
  const lineHeight = font.size * font.lineHeight;
  const glyphHeight = font.size * 1.02;
  const minLineWidth = Math.max(24, font.size * 2.6);
  let frameIndex = 0;
  let lineTop = frames.length ? frameStartY(frames[0], font) : 0;
  let overflowed = false;

  function advanceFrame() {
    frameIndex += 1;
    if (frameIndex < frames.length) {
      lineTop = frameStartY(frames[frameIndex], font);
      return true;
    }
    frameIndex = frames.length;
    return false;
  }

  for (const paragraph of paragraphs) {
    if (paragraph.pinned) continue;
    if (overflowed) {
      paragraph.overflowText = paragraph.text;
      overflowSegments.push({
        paragraphIndex: paragraph.index,
        text: paragraph.text,
        chars: Array.from(paragraph.text.replace(/\s/gu, "")).length,
        reason: "前置内容已填满全部绕排图形",
      });
      continue;
    }

    const tokens = tokenize(compactParagraph(paragraph.text));
    let tokenIndex = 0;
    let lineIndex = 0;
    while (tokenIndex < tokens.length) {
      if (frames.length === 0) {
        overflowed = true;
        const text = remainingText(tokens, tokenIndex);
        paragraph.overflowText = text;
        overflowSegments.push({
          paragraphIndex: paragraph.index,
          text,
          chars: Array.from(text.replace(/\s/gu, "")).length,
          reason: "画布中没有可用的文字绕排框",
        });
        break;
      }

      const frame = frames[Math.min(frameIndex, frames.length - 1)];
      if (!frameHasRoom(frame, font, lineTop)) {
        if (!advanceFrame()) {
          overflowed = true;
          const text = remainingText(tokens, tokenIndex);
          paragraph.overflowText = text;
          overflowSegments.push({
            paragraphIndex: paragraph.index,
            text,
            chars: Array.from(text.replace(/\s/gu, "")).length,
            reason: "全部绕排图形已用尽",
          });
          break;
        }
        continue;
      }

      const bandTop = lineBandTop(font, lineTop);
      const base = getFrameIntervals(frame, bandTop, glyphHeight);
      let intervals = subtractObstacles(base, bandTop, glyphHeight, obstacles);
      intervals = intervals.filter((interval) => interval.x1 - interval.x0 >= minLineWidth);
      if (intervals.length === 0) {
        lineTop += lineHeight;
        continue;
      }

      const interval = pickInterval(intervals, intervals[0].x0);
      const indent =
        lineIndex === 0 && paragraph.lines.length === 0
          ? Math.min(font.size * doc.paragraph.indent, (interval.x1 - interval.x0) * 0.32)
          : 0;
      const left = interval.x0 + indent;
      const maxWidth = interval.x1 - left;
      if (maxWidth < minLineWidth) {
        lineTop += lineHeight;
        continue;
      }

      const result = consumeLine(ctx, tokens, tokenIndex, maxWidth);
      if (!result.text) {
        lineTop += lineHeight;
        continue;
      }
      paragraph.lines.push(
        makeLine({
          text: result.text,
          x: left,
          lineTop,
          width: result.width,
          font,
          frameId: frame.id,
          paragraphIndex: paragraph.index,
          lineIndex,
          pinned: false,
        }),
      );
      tokenIndex = result.nextIndex;
      lineIndex += 1;
      lineTop += lineHeight;
    }

    paragraph.frameIds = [...new Set(paragraph.lines.map((line) => line.frameId))];
    paragraph.bounds = paragraphBounds(paragraph.lines);
    allLines.push(...paragraph.lines);
    if (!overflowed) lineTop += doc.paragraph.spacing;
  }

  for (const line of allLines) line.paragraphIndex = line.paragraphIndex;
  ctx.restore();

  const characters = paragraphs.reduce(
    (total, paragraph) => total + Array.from(paragraph.text.replace(/\s/gu, "")).length,
    0,
  );
  const placedCharacters = allLines.reduce(
    (total, line) => total + Array.from(line.text.replace(/\s/gu, "")).length,
    0,
  );
  return {
    paragraphs,
    lines: allLines.sort((a, b) => a.top - b.top || a.x - b.x),
    frames,
    overflowSegments,
    stats: {
      characters,
      placedCharacters,
      overflowCharacters: Math.max(0, characters - placedCharacters),
      paragraphs: paragraphs.length,
      lines: allLines.length,
      frames: frames.length,
      pinnedParagraphs: paragraphs.filter((paragraph) => paragraph.pinned).length,
    },
  };
}
