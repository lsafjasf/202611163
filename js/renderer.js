import { getFontString, shapeBounds } from "./layout.js";

const imageCache = new Map();

export function loadImage(src) {
  if (!src) return Promise.reject(new Error("图片地址为空"));
  if (imageCache.has(src)) return Promise.resolve(imageCache.get(src));
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      imageCache.set(src, image);
      resolve(image);
    };
    image.onerror = () => reject(new Error("图片无法解码"));
    image.src = src;
  });
}

export async function preloadDocumentImages(doc) {
  const sources = [...new Set(doc.shapes.filter((shape) => shape.type === "image" && shape.src).map((shape) => shape.src))];
  await Promise.allSettled(sources.map((src) => loadImage(src)));
}

function roundedPath(ctx, x, y, w, h, radius) {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function shapePath(ctx, shape, inset = 0) {
  const x = shape.x + inset;
  const y = shape.y + inset;
  const w = Math.max(0.1, shape.w - inset * 2);
  const h = Math.max(0.1, shape.h - inset * 2);
  if (shape.type === "ellipse") {
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  } else if (shape.type === "rounded") {
    roundedPath(ctx, x, y, w, h, shape.radius);
  } else {
    ctx.beginPath();
    ctx.rect(x, y, w, h);
  }
}

function clipShape(ctx, shape) {
  shapePath(ctx, shape);
  ctx.clip();
}

function drawImageCover(ctx, image, shape) {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) return;
  const scale =
    shape.fit === "contain"
      ? Math.min(shape.w / sourceWidth, shape.h / sourceHeight)
      : Math.max(shape.w / sourceWidth, shape.h / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  ctx.drawImage(
    image,
    shape.x + (shape.w - width) / 2,
    shape.y + (shape.h - height) / 2,
    width,
    height,
  );
}

function drawShape(ctx, shape, preview) {
  ctx.save();
  ctx.globalAlpha = shape.opacity ?? 1;
  if (shape.type === "image") {
    ctx.fillStyle = shape.fill || "#ffffff";
    shapePath(ctx, shape);
    ctx.fill();
    const image = imageCache.get(shape.src);
    if (image) {
      ctx.save();
      clipShape(ctx, shape);
      drawImageCover(ctx, image, shape);
      ctx.restore();
    } else if (preview) {
      ctx.save();
      ctx.strokeStyle = "#a43b36";
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.restore();
    }
  } else {
    shapePath(ctx, shape);
    if (shape.fill) {
      ctx.fillStyle = shape.fill;
      ctx.fill();
    }
    if (shape.strokeWidth > 0 && shape.stroke) {
      ctx.strokeStyle = shape.stroke;
      ctx.lineWidth = shape.strokeWidth;
      ctx.stroke();
    }
  }
  if (shape.type === "image" && shape.strokeWidth > 0 && shape.stroke) {
    shapePath(ctx, shape);
    ctx.strokeStyle = shape.stroke;
    ctx.lineWidth = shape.strokeWidth;
    ctx.stroke();
  }
  ctx.restore();
}

function drawHeader(ctx, doc) {
  const { margin } = doc.canvas;
  const { kicker, title, subtitle } = doc.content;
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = doc.theme.accent;
  ctx.font = `700 ${doc.header.kickerSize}px ${doc.font.family}`;
  if (kicker) ctx.fillText(kicker, margin, margin + doc.header.kickerSize + 2);

  const kickerHeight = kicker ? doc.header.kickerSize + 12 : 0;
  const titleBaseline = margin + kickerHeight + doc.header.titleSize * 0.82;
  ctx.fillStyle = doc.theme.ink;
  ctx.font = `400 ${doc.header.titleSize}px ${doc.font.family}`;
  if (title) ctx.fillText(title, margin, titleBaseline);

  const subtitleBaseline = titleBaseline + doc.header.subtitleSize + 14;
  ctx.fillStyle = doc.theme.muted;
  ctx.font = `400 ${doc.header.subtitleSize}px ${doc.font.family}`;
  if (subtitle) ctx.fillText(subtitle, margin, subtitleBaseline);
  ctx.restore();
}

function drawFooter(ctx, doc) {
  const { margin } = doc.canvas;
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = doc.theme.muted;
  ctx.font = `400 ${doc.header.footerSize || 9}px ${doc.font.family}`;
  if (doc.content.footer) {
    ctx.fillText(doc.content.footer, margin, doc.canvas.height - margin + 10);
  }
  ctx.restore();
}

function drawFlowText(ctx, doc, layout) {
  ctx.save();
  ctx.font = getFontString(doc.font);
  ctx.fillStyle = doc.font.color;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  for (const line of layout.lines) {
    if (!line.text) continue;
    ctx.fillText(line.text, line.x, line.baseline);
  }
  ctx.restore();
}

function drawPreviewGuides(ctx, doc, layout, options) {
  const { margin } = doc.canvas;
  ctx.save();
  ctx.strokeStyle = "rgba(185, 84, 47, 0.38)";
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 6]);
  ctx.strokeRect(
    margin + 0.5,
    margin + 0.5,
    doc.canvas.width - margin * 2 - 1,
    doc.canvas.height - margin * 2 - 1,
  );
  ctx.setLineDash([]);

  if (options.selectedParagraphIndex !== null && options.selectedParagraphIndex !== undefined) {
    const paragraph = layout.paragraphs[options.selectedParagraphIndex];
    if (paragraph?.bounds) {
      ctx.strokeStyle = "rgba(76, 111, 93, 0.62)";
      ctx.fillStyle = "rgba(110, 144, 122, 0.08)";
      ctx.lineWidth = 1;
      ctx.fillRect(paragraph.bounds.x - 4, paragraph.bounds.y - 4, paragraph.bounds.w + 8, paragraph.bounds.h + 8);
      ctx.strokeRect(paragraph.bounds.x - 4, paragraph.bounds.y - 4, paragraph.bounds.w + 8, paragraph.bounds.h + 8);
    }
  }

  for (const line of layout.lines) {
    if (!line.pinned) continue;
    ctx.fillStyle = "rgba(185, 84, 47, 0.9)";
    ctx.fillRect(line.x - 7, line.top + 2, 3, 3);
  }

  const selectedShape = doc.shapes.find((shape) => shape.id === options.selectedShapeId);
  if (selectedShape) {
    const b = shapeBounds(selectedShape);
    ctx.strokeStyle = "#4f7462";
    ctx.fillStyle = "rgba(79, 116, 98, 0.05)";
    ctx.lineWidth = 1.25;
    ctx.setLineDash([5, 3]);
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeRect(b.x - 0.5, b.y - 0.5, b.w + 1, b.h + 1);
    ctx.setLineDash([]);
    const handles = [
      [b.x, b.y],
      [b.x + b.w / 2, b.y],
      [b.x + b.w, b.y],
      [b.x + b.w, b.y + b.h / 2],
      [b.x + b.w, b.y + b.h],
      [b.x + b.w / 2, b.y + b.h],
      [b.x, b.y + b.h],
      [b.x, b.y + b.h / 2],
    ];
    ctx.fillStyle = "#fffdf7";
    ctx.strokeStyle = "#3d6553";
    ctx.lineWidth = 1;
    for (const [x, y] of handles) {
      ctx.fillRect(x - 4, y - 4, 8, 8);
      ctx.strokeRect(x - 4, y - 4, 8, 8);
    }
  }
  ctx.restore();
}

export function renderDocument(canvas, doc, layout, options = {}) {
  const zoom = options.zoom || 1;
  const dpr = options.dpr || (typeof devicePixelRatio === "number" ? devicePixelRatio : 1);
  const ratio = options.pixelRatio || dpr * zoom;
  canvas.width = Math.max(1, Math.round(doc.canvas.width * ratio));
  canvas.height = Math.max(1, Math.round(doc.canvas.height * ratio));
  if (!options.exporting) {
    canvas.style.width = `${Math.round(doc.canvas.width * zoom)}px`;
    canvas.style.height = `${Math.round(doc.canvas.height * zoom)}px`;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, doc.canvas.width, doc.canvas.height);
  ctx.fillStyle = doc.canvas.background;
  ctx.fillRect(0, 0, doc.canvas.width, doc.canvas.height);
  for (const shape of doc.shapes) drawShape(ctx, shape, !options.exporting);
  drawHeader(ctx, doc);
  drawFooter(ctx, doc);
  drawFlowText(ctx, doc, layout);
  if (!options.exporting) drawPreviewGuides(ctx, doc, layout, options);
  return canvas;
}

export function renderExportCanvas(doc, layout, scale = 2) {
  const canvas = document.createElement("canvas");
  renderDocument(canvas, doc, layout, {
    exporting: true,
    pixelRatio: scale,
    zoom: 1,
  });
  return canvas;
}

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function attr(value) {
  return escapeXml(value);
}

function svgNumber(value) {
  return Number.isFinite(value) ? Number(value.toFixed(3)) : 0;
}

function svgShapeBase(shape) {
  return [
    `id="shape-${attr(shape.id)}"`,
    `data-shape-id="${attr(shape.id)}"`,
    `data-shape-name="${attr(shape.name)}"`,
    `fill="${attr(shape.fill || "none")}"`,
    `stroke="${attr(shape.stroke || "none")}"`,
    `stroke-width="${svgNumber(shape.strokeWidth || 0)}"`,
    `opacity="${svgNumber(shape.opacity ?? 1)}"`,
  ].join(" ");
}

function svgShapeGeometry(shape) {
  if (shape.type === "ellipse") {
    return {
      markup:
        `<ellipse cx="${svgNumber(shape.x + shape.w / 2)}" cy="${svgNumber(shape.y + shape.h / 2)}" ` +
        `rx="${svgNumber(shape.w / 2)}" ry="${svgNumber(shape.h / 2)}" ${svgShapeBase(shape)} />`,
      clip: `<ellipse cx="${svgNumber(shape.x + shape.w / 2)}" cy="${svgNumber(shape.y + shape.h / 2)}" rx="${svgNumber(shape.w / 2)}" ry="${svgNumber(shape.h / 2)}" />`,
    };
  }
  const radius = shape.type === "rounded" ? svgNumber(Math.min(shape.radius, shape.w / 2, shape.h / 2)) : 0;
  return {
    markup:
      `<rect x="${svgNumber(shape.x)}" y="${svgNumber(shape.y)}" width="${svgNumber(shape.w)}" ` +
      `height="${svgNumber(shape.h)}" rx="${radius}" ${svgShapeBase(shape)} />`,
    clip: `<rect x="${svgNumber(shape.x)}" y="${svgNumber(shape.y)}" width="${svgNumber(shape.w)}" height="${svgNumber(shape.h)}" rx="${radius}" />`,
  };
}

function svgImageShape(shape) {
  const clipId = `clip-${shape.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const preserveAspectRatio = shape.fit === "contain" ? "xMidYMid meet" : "xMidYMid slice";
  const radius = svgNumber(Math.min(shape.radius || 0, shape.w / 2, shape.h / 2));
  const geometry =
    shape.type === "ellipse"
      ? `cx="${svgNumber(shape.x + shape.w / 2)}" cy="${svgNumber(shape.y + shape.h / 2)}" rx="${svgNumber(shape.w / 2)}" ry="${svgNumber(shape.h / 2)}"`
      : `x="${svgNumber(shape.x)}" y="${svgNumber(shape.y)}" width="${svgNumber(shape.w)}" height="${svgNumber(shape.h)}" rx="${radius}"`;
  const placeholder =
    shape.type === "ellipse"
      ? `<ellipse ${geometry} fill="${attr(shape.fill || "#ffffff")}" stroke="${attr(shape.stroke || "none")}" stroke-width="${svgNumber(shape.strokeWidth || 0)}" />`
      : `<rect ${geometry} fill="${attr(shape.fill || "#ffffff")}" stroke="${attr(shape.stroke || "none")}" stroke-width="${svgNumber(shape.strokeWidth || 0)}" />`;
  const clipMarkup =
    shape.type === "ellipse"
      ? `<ellipse ${geometry} />`
      : `<rect ${geometry} />`;
  return (
    `<clipPath id="${attr(clipId)}">${clipMarkup}</clipPath>\n` +
    `<g id="shape-${attr(shape.id)}" data-shape-id="${attr(shape.id)}" data-shape-name="${attr(shape.name)}" opacity="${svgNumber(shape.opacity ?? 1)}">\n` +
    `${placeholder}\n` +
    `<image href="${attr(shape.src)}" x="${svgNumber(shape.x)}" y="${svgNumber(shape.y)}" ` +
    `width="${svgNumber(shape.w)}" height="${svgNumber(shape.h)}" preserveAspectRatio="${preserveAspectRatio}" ` +
    `clip-path="url(#${attr(clipId)})" />\n` +
    `</g>`
  );
}

function svgTextBlock(text, x, y, options = {}) {
  if (!text) return "";
  const attrs = [
    options.id ? `id="${attr(options.id)}"` : "",
    `x="${svgNumber(x)}"`,
    `y="${svgNumber(y)}"`,
    `font-family="${attr(options.family)}"`,
    `font-size="${svgNumber(options.size)}"`,
    `font-weight="${options.weight || 400}"`,
    `fill="${attr(options.fill)}"`,
    options.dataAttrs || "",
  ]
    .filter(Boolean)
    .join(" ");
  return `<text ${attrs}>${escapeXml(text)}</text>`;
}

function encodeMetadata(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

export function documentToSvg(doc, layout, exportOptions = {}) {
  const width = doc.canvas.width;
  const height = doc.canvas.height;
  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
      `viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="doc-title">`,
  );
  parts.push(`<title id="doc-title">${escapeXml(doc.content.title || doc.name)}</title>`);
  parts.push(
    `<desc>可编辑矢量排版。正文保留为 SVG text 与 tspan；图形和图片均由独立元素构成。</desc>`,
  );
  const metadata = {
    generator: "Fieldnote Multi-shape Typesetter",
    format: "svg",
    exportedAt: new Date().toISOString(),
    exportOptions,
    viewport: {
      width,
      height,
      safeMargin: doc.canvas.margin,
      zoom: exportOptions.zoom || 1,
    },
    document: doc,
  };
  parts.push(`<metadata id="fieldnote-project">${encodeMetadata(metadata)}</metadata>`);
  parts.push(
    `<rect id="canvas-background" x="0" y="0" width="${width}" height="${height}" fill="${attr(doc.canvas.background)}" />`,
  );
  parts.push(`<g id="shapes">`);
  for (const shape of doc.shapes) {
    if (shape.type === "image") {
      parts.push(svgImageShape(shape));
    } else {
      parts.push(svgShapeGeometry(shape).markup);
    }
  }
  parts.push(`</g>`);

  const { margin } = doc.canvas;
  const kickerHeight = doc.content.kicker ? doc.header.kickerSize + 12 : 0;
  const titleBaseline = margin + kickerHeight + doc.header.titleSize * 0.82;
  const subtitleBaseline = titleBaseline + doc.header.subtitleSize + 14;
  parts.push(`<g id="header" data-editable="text">`);
  parts.push(
    svgTextBlock(doc.content.kicker, margin, margin + doc.header.kickerSize + 2, {
      id: "header-kicker",
      family: doc.font.family,
      size: doc.header.kickerSize,
      weight: 700,
      fill: doc.theme.accent,
      dataAttrs: 'data-field="kicker"',
    }),
  );
  parts.push(
    svgTextBlock(doc.content.title, margin, titleBaseline, {
      id: "header-title",
      family: doc.font.family,
      size: doc.header.titleSize,
      weight: 400,
      fill: doc.theme.ink,
      dataAttrs: 'data-field="title"',
    }),
  );
  parts.push(
    svgTextBlock(doc.content.subtitle, margin, subtitleBaseline, {
      id: "header-subtitle",
      family: doc.font.family,
      size: doc.header.subtitleSize,
      weight: 400,
      fill: doc.theme.muted,
      dataAttrs: 'data-field="subtitle"',
    }),
  );
  parts.push(`</g>`);

  parts.push(`<g id="text-flow" data-editable="text">`);
  for (const paragraph of layout.paragraphs) {
    if (!paragraph.lines.length) continue;
    parts.push(
      `<g id="paragraph-${paragraph.index + 1}" data-paragraph-index="${paragraph.index}" ` +
        `data-pinned="${paragraph.pinned}" data-frame-ids="${attr(paragraph.frameIds.join(" "))}">`,
    );
    parts.push(
      `<text font-family="${attr(doc.font.family)}" font-size="${svgNumber(doc.font.size)}" ` +
        `font-weight="${doc.font.weight}" fill="${attr(doc.font.color)}" xml:space="preserve">`,
    );
    for (const line of paragraph.lines) {
      parts.push(
        `<tspan x="${svgNumber(line.x)}" y="${svgNumber(line.baseline)}" ` +
          `data-line-id="${attr(line.id)}">${escapeXml(line.text)}</tspan>`,
      );
    }
    parts.push(`</text>`);
    parts.push(`</g>`);
  }
  parts.push(`</g>`);

  parts.push(`<g id="footer" data-editable="text">`);
  parts.push(
    svgTextBlock(doc.content.footer, margin, height - margin + 10, {
      id: "footer-text",
      family: doc.font.family,
      size: doc.header.footerSize || 9,
      weight: 400,
      fill: doc.theme.muted,
      dataAttrs: 'data-field="footer"',
    }),
  );
  parts.push(`</g>`);
  parts.push(
    `<g id="export-provenance" data-format="editable-svg" data-safe-margin="${doc.canvas.margin}" data-zoom="${exportOptions.zoom || 1}" />`,
  );
  parts.push(`</svg>`);
  return parts.filter(Boolean).join("\n");
}
