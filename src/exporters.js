import { escapeXml, base64ToUtf8, utf8ToBase64 } from "./util.js";

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function svgArcPath(item) {
  const delta = (item.end - item.start + Math.PI * 2) % (Math.PI * 2);
  const startX = item.cx + Math.cos(item.start) * item.radius;
  const startY = item.cy + Math.sin(item.start) * item.radius;
  const endX = item.cx + Math.cos(item.end) * item.radius;
  const endY = item.cy + Math.sin(item.end) * item.radius;
  const largeArc = delta > Math.PI ? 1 : 0;
  return `M ${startX.toFixed(3)} ${startY.toFixed(3)} A ${item.radius.toFixed(3)} ${item.radius.toFixed(3)} 0 ${largeArc} 1 ${endX.toFixed(3)} ${endY.toFixed(3)}`;
}

function svgDrawable(item, color, inkOpacity) {
  const opacity = (item.opacity ?? 1) * (inkOpacity ?? 1);
  const fill = item.color || color;
  if (item.kind === "arc") {
    if (Math.abs(item.end - item.start - Math.PI * 2) < 0.0001) {
      return `<circle cx="${item.cx}" cy="${item.cy}" r="${item.radius}" fill="none" stroke="${fill}" stroke-width="${item.width}" opacity="${opacity}"/>`;
    }
    return `<path d="${svgArcPath(item)}" fill="none" stroke="${fill}" stroke-width="${item.width}" stroke-linecap="${item.lineCap || "butt"}" opacity="${opacity}"/>`;
  }
  if (item.kind === "line") {
    return `<line x1="${item.x1}" y1="${item.y1}" x2="${item.x2}" y2="${item.y2}" stroke="${fill}" stroke-width="${item.width}" stroke-linecap="${item.lineCap || "round"}" opacity="${opacity}"/>`;
  }
  if (item.kind === "circle") {
    if (item.filled === false) {
      return `<circle cx="${item.x}" cy="${item.y}" r="${item.radius}" fill="none" stroke="${fill}" stroke-width="${item.width || 1}" opacity="${opacity}"/>`;
    }
    return `<circle cx="${item.x}" cy="${item.y}" r="${item.radius}" fill="${fill}" opacity="${opacity}"/>`;
  }
  if (item.kind === "polygon") {
    const points = item.points.map((point) => `${point.x},${point.y}`).join(" ");
    if (item.filled === false) {
      return `<polygon points="${points}" fill="none" stroke="${fill}" stroke-width="${item.width || 1}" opacity="${opacity}"/>`;
    }
    return `<polygon points="${points}" fill="${fill}" opacity="${opacity}"/>`;
  }
  if (item.kind === "glyph") {
    const degrees = (item.rotation || 0) * 180 / Math.PI;
    return `<text x="${item.x.toFixed(3)}" y="${item.y.toFixed(3)}" transform="rotate(${degrees.toFixed(4)} ${item.x.toFixed(3)} ${item.y.toFixed(3)})" font-family="${escapeXml(item.fontFamily)}" font-size="${item.fontSize}" font-weight="${item.fontWeight || 600}" text-anchor="middle" fill="${fill}" opacity="${opacity}">${escapeXml(item.text)}</text>`;
  }
  if (item.kind === "image") {
    const degrees = (item.rotation || 0) * 180 / Math.PI;
    return `<image x="${(-item.width / 2).toFixed(3)}" y="${(-item.height / 2).toFixed(3)}" width="${item.width.toFixed(3)}" height="${item.height.toFixed(3)}" transform="translate(${item.x.toFixed(3)} ${item.y.toFixed(3)}) rotate(${degrees.toFixed(4)})" preserveAspectRatio="none" href="${escapeXml(item.dataUrl)}" opacity="${opacity}"/>`;
  }
  return "";
}

function fontFaceCss(fontData, model) {
  const faces = [];
  const added = new Set();
  for (const element of model.elements) {
    if (!element.visible || !element.fontId) continue;
    const custom = model.assets.fonts[element.fontId];
    if (custom) {
      const key = `custom:${element.fontId}`;
      if (!added.has(key)) {
        added.add(key);
        faces.push(`@font-face{font-family:"${custom.family}";src:url("${custom.dataUrl}") format("${custom.format || "truetype"}");font-weight:100 900;font-style:normal;}`);
      }
    } else if (fontData?.[element.fontId] && !added.has(element.fontId)) {
      added.add(element.fontId);
      const font = fontData[element.fontId];
      faces.push(`@font-face{font-family:"${font.family}";src:url("${font.dataUrl}") format("woff2");font-weight:100 900;font-style:normal;}`);
    }
  }
  return faces.join("");
}

export function sceneToSvg(scene, options = {}) {
  const { width, height, center, model } = scene;
  const fontCss = fontFaceCss(options.fontData || {}, model);
  const modelJson = JSON.stringify(model);
  const metadata = utf8ToBase64(modelJson);
  const maskShapes = [];
  for (const spot of scene.wear.spots) {
    maskShapes.push(`<circle cx="${spot.x.toFixed(3)}" cy="${spot.y.toFixed(3)}" r="${spot.r.toFixed(3)}" fill="#000" opacity="${spot.alpha.toFixed(3)}"/>`);
  }
  for (const scratch of scene.wear.scratches) {
    maskShapes.push(`<line x1="${scratch.x1.toFixed(3)}" y1="${scratch.y1.toFixed(3)}" x2="${scratch.x2.toFixed(3)}" y2="${scratch.y2.toFixed(3)}" stroke="#000" stroke-width="${scratch.width.toFixed(3)}" stroke-linecap="round" opacity="${scratch.alpha.toFixed(3)}"/>`);
  }

  const groups = scene.groups.map((group) => {
    const content = group.drawables.map((item) => `      ${svgDrawable(item, scene.color, scene.inkOpacity)}`).join("\n");
    return `    <g id="${escapeXml(group.id)}" data-element-id="${escapeXml(group.id)}" data-element-name="${escapeXml(group.name)}" data-element-type="${escapeXml(group.type)}">\n${content}\n    </g>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="seal-title seal-desc">
  <title id="seal-title">${escapeXml(model.meta.name || "印章")}</title>
  <desc id="seal-desc">由印刻工作室生成的可编辑矢量图章。文字、图形与磨损蒙版均可编辑。</desc>
  <metadata id="stamp-model" data-format="seal-atelier-model+base64">${metadata}</metadata>
  <defs>
    <style><![CDATA[${fontCss}]]></style>
    <mask id="wear-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}">
      <rect width="${width}" height="${height}" fill="#fff"/>
      <g>
        ${maskShapes.join("\n        ")}
      </g>
    </mask>
  </defs>
  <g id="seal-artwork" mask="url(#wear-mask)" data-color="${escapeXml(scene.color)}" data-seed="${escapeXml(String(model.style.seed))}">
${groups}
  </g>
</svg>`;
}

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc ^= bytes[index];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = new TextEncoder().encode(type);
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, 4);
  view.setUint32(8 + data.length, crc32(crcInput));
  return chunk;
}

export async function addPngMetadata(blob, fields) {
  const source = new Uint8Array(await blob.arrayBuffer());
  const chunks = [];
  let offset = 8;
  const dv = new DataView(source.buffer, source.byteOffset, source.byteLength);
  while (offset < source.length) {
    const length = dv.getUint32(offset);
    const end = offset + 12 + length;
    const type = new TextDecoder("ascii").decode(source.subarray(offset + 4, offset + 8));
    if (type === "IEND") {
      for (const [keyword, value] of Object.entries(fields)) {
        const data = new TextEncoder().encode(`${keyword}\0${value}`);
        chunks.push(pngChunk("tEXt", data));
      }
    }
    chunks.push(source.subarray(offset, end));
    offset = end;
  }
  return new Blob([new Uint8Array(PNG_SIGNATURE), ...chunks], { type: "image/png" });
}

export function parsePngMetadata(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (PNG_SIGNATURE.some((value, index) => bytes[index] !== value)) {
    throw new Error("不是有效的 PNG 文件。");
  }
  const fields = {};
  let offset = 8;
  while (offset < bytes.length) {
    const length = dv.getUint32(offset);
    const type = new TextDecoder("ascii").decode(bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "tEXt") {
      const split = data.indexOf(0);
      if (split >= 0) {
        const key = new TextDecoder("latin1").decode(data.subarray(0, split));
        const value = new TextDecoder("latin1").decode(data.subarray(split + 1));
        fields[key] = value;
      }
    }
    offset += 12 + length;
  }
  return fields;
}

export function svgModelFromText(text) {
  const match = text.match(/<metadata[^>]*id="stamp-model"[^>]*>([^<]+)<\/metadata>/);
  if (!match) throw new Error("SVG 中没有找到设计参数。");
  return JSON.parse(base64ToUtf8(match[1].trim()));
}

export async function pngModelFromBlob(blob) {
  const fields = parsePngMetadata(new Uint8Array(await blob.arrayBuffer()));
  if (!fields.StampModel) throw new Error("PNG 中没有找到设计参数。");
  return JSON.parse(base64ToUtf8(fields.StampModel));
}
