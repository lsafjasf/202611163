import {
  entranceAt,
  measureTextElement,
  textOrigin,
  baselineForLine,
  round
} from "./core.js";
import {
  gradientPoints,
  exportFrameToCanvas,
  createCanvasMeasurer
} from "./renderer.js";

export function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function paint(value, fallback = "none") {
  return value && value !== "transparent" ? escapeXml(value) : fallback;
}

function number(value) {
  return round(Number(value) || 0, 3);
}

function elementTransform(element, animation) {
  const cx = element.x + element.w / 2 + animation.x;
  const cy = element.y + element.h / 2 + animation.y;
  const scale = animation.scale;
  return [
    `translate(${number(cx)} ${number(cy)})`,
    `rotate(${number(element.rotation)})`,
    `scale(${number(scale)})`,
    `translate(${number(-element.w / 2)} ${number(-element.h / 2)})`
  ].join(" ");
}

function textMarkup(element, measurer, indent = "    ") {
  const style = element.style ?? {};
  const metrics = measureTextElement(element, measurer);
  const local = { ...element, x: 0, y: 0 };
  const origin = textOrigin(local, metrics);
  const anchor = origin.align === "center" ? "middle" : origin.align === "right" ? "end" : "start";
  const parts = [];
  if (style.background && style.background !== "transparent") {
    parts.push(`${indent}<rect width="${number(element.w)}" height="${number(element.h)}" rx="${number(style.radius)}" fill="${paint(style.background)}"/>`);
  }
  if (style.borderColor && style.borderColor !== "transparent" && Number(style.borderWidth) > 0) {
    parts.push(`${indent}<rect x="${number(Number(style.borderWidth) / 2)}" y="${number(Number(style.borderWidth) / 2)}" width="${number(element.w - Number(style.borderWidth))}" height="${number(element.h - Number(style.borderWidth))}" rx="${number(style.radius)}" fill="none" stroke="${paint(style.borderColor)}" stroke-width="${number(style.borderWidth)}"/>`);
  }
  parts.push(
    `${indent}<text x="${number(origin.x)}" y="${number(origin.top + baselineForLine(metrics, 0))}"`
    + ` font-family="${escapeXml(style.fontFamily)}" font-size="${number(style.fontSize)}"`
    + ` font-weight="${escapeXml(style.fontWeight ?? 600)}" fill="${paint(style.color, "#ffffff")}"`
    + ` letter-spacing="${number(style.letterSpacing)}" text-anchor="${anchor}" xml:space="preserve">`
  );
  metrics.lines.forEach((line, index) => {
    const y = origin.top + baselineForLine(metrics, index);
    parts.push(`${indent}  <tspan x="${number(origin.x)}" y="${number(y)}">${escapeXml(line) || " "}</tspan>`);
  });
  parts.push(`${indent}</text>`);
  if (metrics.overflow) {
    parts.push(`${indent}<desc>警告：该文字在元素边界内溢出；导出前已由编辑器校验并阻止静默裁切。</desc>`);
  }
  return parts.join("\n");
}

function shapeMarkup(element) {
  const style = element.style ?? {};
  const fill = paint(style.fill);
  const stroke = Number(style.strokeWidth) > 0 ? paint(style.stroke) : "none";
  const strokeAttr = stroke === "none" ? "" : ` stroke="${stroke}" stroke-width="${number(style.strokeWidth)}"`;
  if (element.shape === "ellipse") {
    return `<ellipse cx="${number(element.w / 2)}" cy="${number(element.h / 2)}" rx="${number(element.w / 2)}" ry="${number(element.h / 2)}" fill="${fill}"${strokeAttr}/>`;
  }
  return `<rect width="${number(element.w)}" height="${number(element.h)}" rx="${number(style.radius)}" fill="${fill}"${strokeAttr}/>`;
}

function imageMarkup(element, index) {
  const style = element.style ?? {};
  const clipId = `image-clip-${index}`;
  const aspect = style.fit === "contain" ? "xMidYMid meet" : "xMidYMid slice";
  return [
    `<defs><clipPath id="${clipId}"><rect width="${number(element.w)}" height="${number(element.h)}" rx="${number(style.radius)}"/></clipPath></defs>`,
    `<image href="${escapeXml(element.src)}" width="${number(element.w)}" height="${number(element.h)}" preserveAspectRatio="${aspect}" clip-path="url(#${clipId})"/>`
  ].join("\n");
}

function fontFaceCSS(scene, bundledFontData) {
  const fonts = Array.isArray(scene.assets?.fonts) ? scene.assets.fonts : [];
  const embedded = fonts
    .filter((font) => font?.family && font?.data)
    .map((font) => {
      const format = font.type === "woff2" ? "woff2" : font.type === "woff" ? "woff" : font.type === "otf" ? "opentype" : "truetype";
      return `      @font-face { font-family: "${String(font.family).replaceAll('"', "")}"; src: url("${String(font.data)}") format("${format}"); font-display: swap; }`;
    })
    .join("\n");
  const usesBundled = scene.elements.some((element) => String(element.style?.fontFamily).includes("Noto Sans SC Bundled"));
  const bundled = usesBundled && bundledFontData
    ? `      @font-face { font-family: "Noto Sans SC Bundled"; src: url("${bundledFontData}") format("woff2"); font-weight: 100 900; font-display: swap; }`
    : "";
  return [bundled, embedded].filter(Boolean).join("\n");
}

export function buildSVG(scene, options = {}) {
  const measurer = options.measurer ?? createProbeMeasurer();
  const timeMs = Number(options.timeMs ?? scene.playheadMs ?? scene.timelineMs);
  const points = gradientPoints(scene.width, scene.height, scene.background?.angle);
  const background = scene.background ?? {};
  const css = fontFaceCSS(scene, options.bundledFontData);
  const body = [];

  for (let index = 0; index < scene.elements.length; index += 1) {
    const element = scene.elements[index];
    if (!element.visible) continue;
    const animation = entranceAt(element, timeMs);
    const opacity = round(Math.max(0, Number(element.opacity ?? 1) * animation.opacity), 4);
    let content = "";
    if (element.type === "text") content = textMarkup(element, measurer);
    else if (element.type === "shape") content = shapeMarkup(element);
    else if (element.type === "image") content = imageMarkup(element, index);
    body.push(`  <g data-layer-id="${escapeXml(element.id)}" data-layer-type="${escapeXml(element.type)}" opacity="${opacity}" transform="${elementTransform(element, animation)}">`);
    body.push(content);
    body.push("  </g>");
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}" role="img" aria-label="${escapeXml(scene.name)}">`,
    `  <metadata>${escapeXml(JSON.stringify({
      generator: "帧字 FRAMEWORK",
      template: scene.template,
      frameMs: timeMs,
      editable: "文字为 text/tspan，图形为 rect/ellipse，无截图烧录",
      sceneId: scene.id
    }))}</metadata>`,
    css ? `  <style>\n${css}\n  </style>` : "",
    "  <defs>",
    `    <linearGradient id="scene-bg" gradientUnits="userSpaceOnUse" x1="${number(points.x0)}" y1="${number(points.y0)}" x2="${number(points.x1)}" y2="${number(points.y1)}">`,
    `      <stop offset="0" stop-color="${paint(background.from, "#101a27")}"/>`,
    `      <stop offset="1" stop-color="${paint(background.to, "#070b11")}"/>`,
    "    </linearGradient>",
    "  </defs>",
    `  <rect width="${scene.width}" height="${scene.height}" fill="url(#scene-bg)"/>`,
    ...body,
    "</svg>",
    ""
  ].filter((line) => line !== "").join("\n");
}

export function createProbeMeasurer() {
  const canvas = document.createElement("canvas");
  canvas.width = 8;
  canvas.height = 8;
  return createCanvasMeasurer(canvas.getContext("2d"));
}

export async function renderPNG(scene, imageMap, timeMs) {
  const canvas = document.createElement("canvas");
  exportFrameToCanvas(canvas, scene, { imageMap, timeMs });
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error("PNG 编码失败，请降低画布尺寸后重试。当前项目参数仍已保留。"));
    }, "image/png");
  });
  return blob;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 3000);
}

export function safeFilename(name, extension) {
  const base = String(name || "subtitle")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return `${base || "subtitle"}.${extension}`;
}
