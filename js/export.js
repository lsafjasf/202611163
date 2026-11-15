import { SCENE_HEIGHT, SCENE_WIDTH, cloneState, getFontStack } from "./model.js";
import { fontString, layoutText } from "./render.js";

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function textSvg(element, ctx) {
  const layout = layoutText(ctx, element);
  const anchor = element.textAlign === "center" ? "middle" : element.textAlign === "right" ? "end" : "start";
  let x = element.x;
  if (element.textAlign === "center") x += element.width / 2;
  if (element.textAlign === "right") x += element.width;
  const lines = layout.lines
    .map(
      (line, index) =>
        `<tspan x="${x}" y="${element.y + index * layout.lineHeight + layout.ascent}" data-line="${index + 1}">${escapeXml(line)}</tspan>`,
    )
    .join("");
  return [
    `<text id="${escapeXml(element.id)}" data-layer-id="${escapeXml(element.id)}" data-editable="text" data-font-id="${escapeXml(element.fontId)}"`,
    ` font-family="${escapeXml(getFontStack(element.fontId))}" font-size="${element.fontSize}" font-weight="${element.fontWeight}"`,
    ` letter-spacing="${element.letterSpacing || 0}" fill="${escapeXml(element.color)}" opacity="${element.opacity}"`,
    ` text-anchor="${anchor}" xml:space="preserve">`,
    `<title>${escapeXml(element.name)}</title>`,
    lines,
    `</text>`,
  ].join("");
}

function shapeSvg(element) {
  const common = `id="${escapeXml(element.id)}" data-layer-id="${escapeXml(element.id)}" data-editable="shape" opacity="${element.opacity}"`;
  if (element.shape === "rect") {
    return `<rect ${common} x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" fill="${escapeXml(element.fill)}" stroke="${escapeXml(element.stroke)}" stroke-width="${element.strokeWidth}"><title>${escapeXml(element.name)}</title></rect>`;
  }
  if (element.shape === "circle") {
    return `<ellipse ${common} cx="${element.x + element.width / 2}" cy="${element.y + element.height / 2}" rx="${element.width / 2}" ry="${element.height / 2}" fill="${escapeXml(element.fill)}" stroke="${escapeXml(element.stroke)}" stroke-width="${element.strokeWidth}"><title>${escapeXml(element.name)}</title></ellipse>`;
  }
  return `<line ${common} x1="${element.x}" y1="${element.y}" x2="${element.x + element.width}" y2="${element.y}" stroke="${escapeXml(element.stroke)}" stroke-width="${Math.max(1, element.strokeWidth)}"><title>${escapeXml(element.name)}</title></line>`;
}

export function createSvgMarkup(state, adjustedSource, measureCtx, embeddedFontCss = "") {
  const width = state.export.width;
  const height = state.export.height;
  const metadata = escapeXml(JSON.stringify(state));
  const imageData = adjustedSource.toDataURL("image/png");
  const layers = state.elements
    .filter((element) => element.visible)
    .map((element) => (element.type === "text" ? textSvg(element, measureCtx) : shapeSvg(element)))
    .join("");

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"`,
    ` width="${width}" height="${height}" viewBox="0 0 ${SCENE_WIDTH} ${SCENE_HEIGHT}"`,
    ` data-generator="Lumen Studio" data-editable="true">`,
    `<metadata id="lumen-project">${metadata}</metadata>`,
    embeddedFontCss ? `<style>${embeddedFontCss}</style>` : "",
    `<title>${escapeXml(state.projectName)}</title>`,
    `<desc>由 Canvas 逐像素调色生成。文字与图形为可编辑矢量图层；参数保存在 metadata 中。</desc>`,
    `<image id="generated-photo" data-generated="canvas" x="0" y="0" width="${SCENE_WIDTH}" height="${SCENE_HEIGHT}" preserveAspectRatio="none" href="${imageData}" xlink:href="${imageData}"/>`,
    `<g id="editable-layers" data-editable="true">${layers}</g>`,
    `</svg>`,
  ].join("");
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc ^= bytes[index];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function createPngTextChunk(keyword, text) {
  const encoder = new TextEncoder();
  const type = encoder.encode("tEXt");
  const data = encoder.encode(`${keyword}\u0000${text}`);
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(type, 4);
  chunk.set(data, 8);
  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(type, 0);
  crcInput.set(data, 4);
  view.setUint32(8 + data.length, crc32(crcInput));
  return chunk;
}

export async function addStateToPng(blob, state) {
  const original = new Uint8Array(await blob.arrayBuffer());
  const chunk = createPngTextChunk("lumen-state", JSON.stringify(cloneState(state)));
  const insertAt = 33;
  const output = new Uint8Array(original.length + chunk.length);
  output.set(original.subarray(0, insertAt), 0);
  output.set(chunk, insertAt);
  output.set(original.subarray(insertAt), insertAt + chunk.length);
  return new Blob([output], { type: "image/png" });
}

export function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("PNG 编码失败，请减小导出尺寸后重试。"));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function safeFilename(name, extension) {
  const base = String(name || "lumen-project")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return `${base || "lumen-project"}.${extension}`;
}

export function createExportCanvas(state, adjustedSource) {
  const canvas = document.createElement("canvas");
  canvas.width = state.export.width;
  canvas.height = state.export.height;
  return canvas;
}

export function describeTextMetrics(element, ctx) {
  const layout = layoutText(ctx, element);
  return {
    font: fontString(element),
    lines: layout.lines.length,
    lineHeight: layout.lineHeight,
    width: layout.maxWidth,
  };
}
