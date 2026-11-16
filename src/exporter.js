import {
  APP_VERSION,
  buildScene,
  getFont,
  round,
  shadeColor,
  validateScene
} from "./model.js";

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function svgNumber(value) {
  return round(value, 2);
}

function gradientId(index) {
  return `glass-${index}`;
}

function defsForScene(scene, options = {}) {
  const { state, light, center, radius } = scene;
  const font = getFont(state);
  const lightX = center.x + (light.x - 0.5) * radius * 1.45;
  const lightY = center.y + (light.y - 0.44) * radius * 1.45;
  const palette = scene.palette;
  const backdropX = scene.width * 0.5;
  const backdropY = scene.height * 0.36;
  const core = scene.central.core;
  const backing = scene.central.backing;
  const customFont = state.typography.fontId === "custom" && state.typography.customFont
    ? `@font-face { font-family: "${state.typography.customFont.family}"; src: url("${state.typography.customFont.dataUrl}"); font-weight: 400 700; font-style: normal; font-display: block; }`
    : options.fontDataUrl
      ? `@font-face { font-family: "${font.family.split(",")[0].replaceAll('"', "").trim()}"; src: url("${options.fontDataUrl}"); font-weight: 400 700; font-style: normal; font-display: block; }`
      : "";

  return `<defs>
    ${customFont ? `<style>${customFont}</style>` : ""}
    <linearGradient id="board" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1b1e26"/>
      <stop offset=".5" stop-color="#13161d"/>
      <stop offset="1" stop-color="#0f1117"/>
    </linearGradient>
    <radialGradient id="board-vignette" cx="${svgNumber(backdropX)}" cy="${svgNumber(backdropY)}" r="${svgNumber(scene.width * 0.85)}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#4e535f" stop-opacity=".22"/>
      <stop offset=".52" stop-color="#1f222b" stop-opacity=".08"/>
      <stop offset="1" stop-color="#000000" stop-opacity=".36"/>
    </radialGradient>
    <radialGradient id="backlight" cx="${svgNumber(lightX)}" cy="${svgNumber(lightY)}" r="${svgNumber(radius * 1.15)}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${light.color}" stop-opacity=".88"/>
      <stop offset=".38" stop-color="${light.color}" stop-opacity=".44"/>
      <stop offset=".78" stop-color="#273044" stop-opacity=".15"/>
      <stop offset="1" stop-color="#080b12" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="light-glow" cx="${svgNumber(lightX)}" cy="${svgNumber(lightY)}" r="${svgNumber(radius * 1.02)}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${light.color}" stop-opacity="${round(light.intensity * 0.94, 3)}"/>
      <stop offset=".45" stop-color="${light.color}" stop-opacity=".23"/>
      <stop offset="1" stop-color="${light.color}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="glass-sheen" x1="${svgNumber(center.x - radius * 0.8)}" y1="${svgNumber(center.y - radius)}" x2="${svgNumber(center.x + radius * 0.5)}" y2="${svgNumber(center.y + radius)}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#fff" stop-opacity=".16"/>
      <stop offset=".35" stop-color="#fff" stop-opacity=".03"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="window-edge" cx="${svgNumber(center.x)}" cy="${svgNumber(center.y)}" r="${svgNumber(radius)}" gradientUnits="userSpaceOnUse">
      <stop offset=".62" stop-color="#000" stop-opacity="0"/>
      <stop offset=".8" stop-color="#000" stop-opacity=".04"/>
      <stop offset=".96" stop-color="#000" stop-opacity=".34"/>
      <stop offset="1" stop-color="#000" stop-opacity=".52"/>
    </radialGradient>
    <radialGradient id="core-glass" cx="${svgNumber(core.bounds.left + core.bounds.width * 0.34)}" cy="${svgNumber(core.bounds.top + core.bounds.height * 0.28)}" r="${svgNumber(Math.max(3, core.bounds.width / 2))}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${shadeColor(core.color, 0.42)}"/>
      <stop offset=".56" stop-color="${core.color}"/>
      <stop offset="1" stop-color="${shadeColor(core.color, -0.34)}"/>
    </radialGradient>
    <radialGradient id="core-backing" cx="${svgNumber(backing.x - backing.radius * 0.22)}" cy="${svgNumber(backing.y - backing.radius * 0.28)}" r="${svgNumber(backing.radius)}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${shadeColor(backing.color, 0.2)}"/>
      <stop offset=".55" stop-color="${shadeColor(backing.color, -0.5)}"/>
      <stop offset="1" stop-color="#282a25"/>
    </radialGradient>
    ${palette.colors.map((color, index) => `<linearGradient id="${gradientId(index)}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${shadeColor(color.hex, 0.28)}"/>
      <stop offset=".44" stop-color="${color.hex}"/>
      <stop offset="1" stop-color="${shadeColor(color.hex, -0.24)}"/>
    </linearGradient>`).join("\n    ")}
    <pattern id="board-grain" width="37" height="29" patternUnits="userSpaceOnUse">
      <circle cx="3" cy="5" r=".65" fill="#ebddbc" opacity=".06"/>
      <circle cx="21" cy="13" r=".45" fill="#ebddbc" opacity=".045"/>
      <circle cx="31" cy="24" r=".7" fill="#ebddbc" opacity=".05"/>
      <circle cx="12" cy="25" r=".35" fill="#ebddbc" opacity=".04"/>
    </pattern>
    <clipPath id="window-clip">
      <circle cx="${svgNumber(center.x)}" cy="${svgNumber(center.y)}" r="${svgNumber(radius)}"/>
    </clipPath>
    <clipPath id="central-clip">
      <path d="${scene.central.clipPath}"/>
    </clipPath>
    <filter id="frame-shadow" x="-30%" y="-30%" width="160%" height="170%">
      <feDropShadow dx="0" dy="24" stdDeviation="27" flood-color="#000" flood-opacity=".82"/>
    </filter>
    <filter id="text-shadow" x="-20%" y="-30%" width="140%" height="160%">
      <feDropShadow dx="0" dy="2" stdDeviation="8" flood-color="#000" flood-opacity=".62"/>
    </filter>
  </defs>`;
}

function backgroundMarkup(scene) {
  const { width, height } = scene;
  return `<g id="artboard-background" data-editable="true">
    <rect width="${width}" height="${height}" fill="url(#board)"/>
    <rect width="${width}" height="${height}" fill="url(#board-vignette)"/>
    <rect width="${width}" height="${height}" fill="url(#board-grain)"/>
    <rect x="18.5" y="18.5" width="${width - 37}" height="${height - 37}" fill="none" stroke="#cfb887" stroke-opacity=".09"/>
    <rect x="26.5" y="26.5" width="${width - 53}" height="${height - 53}" fill="none" stroke="#cfb887" stroke-opacity=".035"/>
    <circle cx="${svgNumber(scene.center.x)}" cy="${svgNumber(scene.center.y)}" r="${svgNumber(scene.radius)}" fill="url(#backlight)"/>
  </g>`;
}

function imageMarkup(scene) {
  if (!scene.state.image.dataUrl || !scene.state.layers.image) return "";
  const { center, radius } = scene;
  const image = scene.image;
  const transform = [
    `translate(${svgNumber(center.x + image.offsetX)} ${svgNumber(center.y + image.offsetY)})`,
    `scale(${svgNumber(image.scale)})`,
    `translate(${svgNumber(-center.x)} ${svgNumber(-center.y)})`
  ].join(" ");
  return `<g id="projection-image" class="editable-image" data-editable="true" clip-path="url(#window-clip)" style="mix-blend-mode:screen;filter:saturate(.58) contrast(1.08)">
    <image href="${escapeXml(image.dataUrl)}" x="${svgNumber(image.x)}" y="${svgNumber(image.y)}" width="${svgNumber(image.width)}" height="${svgNumber(image.height)}" preserveAspectRatio="xMidYMid slice" opacity="${image.opacity}" transform="${transform}"/>
  </g>`;
}

function glassMarkup(scene) {
  const { state } = scene;
  const opacity = state.window.glassOpacity;
  const border = state.window.border;
  const backing = scene.central.backing;
  const backingSpokes = Array.from({ length: 12 }, (_, index) => {
    const angle = (index / 12) * Math.PI * 2 + Math.PI / 24;
    return `<line x1="${svgNumber(backing.x)}" y1="${svgNumber(backing.y)}" x2="${svgNumber(backing.x + Math.cos(angle) * backing.radius)}" y2="${svgNumber(backing.y + Math.sin(angle) * backing.radius)}" stroke="#151613" stroke-width="${svgNumber(Math.max(0.8, border * 0.38))}"/>`;
  }).join("");
  const backingRings = [0.46, 0.74]
    .map((ratio) => `<circle cx="${svgNumber(backing.x)}" cy="${svgNumber(backing.y)}" r="${svgNumber(backing.radius * ratio)}" fill="none" stroke="#151613" stroke-width="${svgNumber(Math.max(0.8, border * 0.38))}"/>`)
    .join("");
  const ringFills = scene.rings
    .map(
      (cell) =>
        `<path class="glass-cell" data-ring="${cell.ring}" data-sector="${cell.sector}" d="${cell.path}" fill="url(#${gradientId(cell.paletteIndex)})"/>`
    )
    .join("");
  const ringLeads = scene.rings
    .map(
      (cell) =>
        `<path class="lead-line" d="${cell.path}" fill="none" stroke="#151613" stroke-width="${svgNumber(border)}" stroke-linejoin="round" stroke-linecap="round"/>`
    )
    .join("");

  return `<g id="window-glass" data-editable="true">
    ${state.layers.rings ? `<g id="ring-glass-cells" opacity="${opacity}">${ringFills}</g><g id="ring-lead-cames">${ringLeads}</g>` : ""}
    ${state.layers.center ? `<g id="center-backing" class="editable-center-backing"><circle class="glass-cell" cx="${svgNumber(backing.x)}" cy="${svgNumber(backing.y)}" r="${svgNumber(backing.radius)}" fill="url(#core-backing)" opacity="${opacity}" stroke="#151613" stroke-width="${svgNumber(Math.max(1.4, border * 0.88))}"/>${backingSpokes}${backingRings}</g>
    <g id="center-glass" clip-path="url(#central-clip)">
      <g opacity="${opacity}">${scene.central.cells.map((cell) => `<path class="glass-cell center-cell" data-band="${cell.band}" data-sector="${cell.sector}" d="${cell.path}" fill="url(#${gradientId(cell.paletteIndex)})"/>`).join("")}</g>
      <g>${scene.central.cells.map((cell) => `<path class="lead-line center-lead" d="${cell.path}" fill="none" stroke="#151613" stroke-width="${svgNumber(Math.max(1.1, border * 0.72))}" stroke-linejoin="round"/>`).join("")}</g>
    </g>
    <path id="center-core" class="glass-cell" d="${scene.central.core.path}" fill="url(#core-glass)" opacity="${opacity}" stroke="#151613" stroke-width="${svgNumber(Math.max(1.2, border * 0.9))}" stroke-linejoin="round"/>
    <path id="center-outline" d="${scene.central.clipPath}" fill="none" stroke="#171814" stroke-width="${svgNumber(Math.max(1.8, border * 0.92))}" stroke-linejoin="round"/>
    <path d="${scene.central.clipPath}" fill="none" stroke="#ecd8a6" stroke-opacity=".22" stroke-width=".7" stroke-linejoin="round"/>` : ""}
  </g>`;
}

function lightMarkup(scene) {
  if (!scene.state.layers.glow) return "";
  const { center, radius } = scene;
  return `<g id="glass-light" clip-path="url(#window-clip)" data-editable="true">
    <circle cx="${svgNumber(center.x)}" cy="${svgNumber(center.y)}" r="${svgNumber(radius)}" fill="url(#light-glow)" style="mix-blend-mode:screen"/>
    <circle cx="${svgNumber(center.x)}" cy="${svgNumber(center.y)}" r="${svgNumber(radius)}" fill="url(#glass-sheen)" style="mix-blend-mode:screen"/>
    <circle cx="${svgNumber(center.x)}" cy="${svgNumber(center.y)}" r="${svgNumber(radius)}" fill="url(#window-edge)"/>
  </g>`;
}

function frameMarkup(scene) {
  const { center, radius } = scene;
  const stroke = scene.window.frameStroke;
  return `<g id="lead-frame" data-editable="true">
    <circle cx="${svgNumber(center.x)}" cy="${svgNumber(center.y)}" r="${svgNumber(radius + stroke * 0.5)}" fill="none" stroke="#0d0e0c" stroke-width="${svgNumber(stroke)}" filter="url(#frame-shadow)"/>
    <circle cx="${svgNumber(center.x)}" cy="${svgNumber(center.y)}" r="${svgNumber(radius)}" fill="none" stroke="#11120f" stroke-width="${svgNumber(stroke * 0.95)}"/>
    <circle cx="${svgNumber(center.x)}" cy="${svgNumber(center.y)}" r="${svgNumber(radius + stroke * 0.33)}" fill="none" stroke="#5b5546" stroke-width="1.4"/>
    <circle cx="${svgNumber(center.x)}" cy="${svgNumber(center.y)}" r="${svgNumber(radius + stroke * 0.63)}" fill="none" stroke="#dabe7e" stroke-opacity=".4" stroke-width=".8"/>
    <circle cx="${svgNumber(center.x)}" cy="${svgNumber(center.y)}" r="${svgNumber(radius - stroke * 0.47)}" fill="none" stroke="#ecd7a4" stroke-opacity=".16" stroke-width=".8"/>
  </g>`;
}

function textNodeMarkup(node, extra = "") {
  return `<text class="editable-text ${node.role}" data-editable="true" ${extra} x="${svgNumber(node.x)}" y="${svgNumber(node.baseline)}" fill="${node.color}" font-family="${escapeXml(node.family)}" font-size="${svgNumber(node.size)}" font-weight="${node.weight}" letter-spacing="${svgNumber(node.letterSpacing)}" text-anchor="middle" xml:space="preserve">${escapeXml(node.text)}</text>`;
}

function typographyMarkup(scene) {
  const { state, typography } = scene;
  const title = state.layers.title
    ? typography.titleNodes.map((node) => textNodeMarkup(node)).join("")
    : "";
  const divider = state.layers.subtitle
    ? `<g id="text-divider" opacity=".62">
      <path d="M ${svgNumber(typography.divider.x - typography.divider.width)} ${svgNumber(typography.divider.y)} H ${svgNumber(typography.divider.x - 8)} M ${svgNumber(typography.divider.x + 8)} ${svgNumber(typography.divider.y)} H ${svgNumber(typography.divider.x + typography.divider.width)}" stroke="#d6be84" stroke-width=".8"/>
      <path d="M ${svgNumber(typography.divider.x)} ${svgNumber(typography.divider.y - 3.2)} L ${svgNumber(typography.divider.x + 3.2)} ${svgNumber(typography.divider.y)} L ${svgNumber(typography.divider.x)} ${svgNumber(typography.divider.y + 3.2)} L ${svgNumber(typography.divider.x - 3.2)} ${svgNumber(typography.divider.y)} Z" fill="#d6be84"/>
    </g>`
    : "";
  const subtitle = state.layers.subtitle && typography.subtitleNode
    ? textNodeMarkup(typography.subtitleNode)
    : "";
  const footer = state.layers.footer && typography.footerNode
    ? textNodeMarkup(typography.footerNode)
    : "";
  return `<g id="typography" filter="url(#text-shadow)">
    ${title}${divider}${subtitle}${footer}
  </g>`;
}

function boardLabelMarkup(scene) {
  return `<g id="studio-mark" data-editable="true" fill="#e1cda6" fill-opacity=".33" font-family="'Courier New', monospace" font-size="8" font-weight="600" letter-spacing="1.5">
    <text x="32" y="42">AURELIA / LIGHT STUDY</text>
    <text x="${scene.width - 32}" y="42" text-anchor="end">${scene.width} × ${scene.height}</text>
    <path d="M 32 52 H ${scene.width - 32}" stroke="#e1cda6" stroke-opacity=".16" stroke-width=".7"/>
  </g>`;
}

export function projectMetadata(state, format) {
  return JSON.stringify({
    generator: "Aurelia Stained Glass Studio",
    version: APP_VERSION,
    exportedAt: new Date().toISOString(),
    format,
    state
  });
}

export function buildEditableSvg(stateInput, options = {}) {
  const scene = buildScene(stateInput, { measureText: options.measureText });
  const validation = validateScene(scene);
  if (!validation.ok && !options.allowInvalid) {
    const error = new Error("导出前检查未通过");
    error.validation = validation;
    error.scene = scene;
    throw error;
  }
  const title = escapeXml(scene.state.typography.title || "彩色玻璃窗");
  const metadata = escapeXml(projectMetadata(scene.state, "svg"));
  const parts = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}" role="img" aria-labelledby="glass-title glass-desc" data-aurelia-version="${APP_VERSION}">`,
    `<title id="glass-title">${title}</title>`,
    `<desc id="glass-desc">Aurelia 程序化彩色玻璃窗。色片、铅条、文字和图片均保留为可编辑矢量元素。</desc>`,
    `<metadata id="aurelia-project" data-format="json">${metadata}</metadata>`,
    defsForScene(scene, options),
    backgroundMarkup(scene),
    imageMarkup(scene),
    glassMarkup(scene),
    lightMarkup(scene),
    frameMarkup(scene),
    boardLabelMarkup(scene),
    typographyMarkup(scene),
    `</svg>`
  ];
  return { svg: parts.join("\n"), scene, validation };
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function uint32(value) {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff
  ]);
}

function concatBytes(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

export async function embedPngProjectMetadata(blob, key, value) {
  const original = new Uint8Array(await blob.arrayBuffer());
  if (original[0] !== 0x89 || original[1] !== 0x50) return blob;
  const encoder = new TextEncoder();
  const keyword = encoder.encode(key);
  const text = encoder.encode(value);
  const data = concatBytes([
    keyword,
    new Uint8Array([0, 0, 0, 0, 0]),
    text
  ]);
  const type = encoder.encode("iTXt");
  const crcInput = concatBytes([type, data]);
  const chunk = concatBytes([
    uint32(data.length),
    type,
    data,
    uint32(crc32(crcInput))
  ]);
  const iendOffset = original.length - 12;
  return new Blob([
    original.slice(0, iendOffset),
    chunk,
    original.slice(iendOffset)
  ], { type: "image/png" });
}

function loadSvgImage(svgText) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("无法栅格化 SVG 场景"));
    };
    image.src = url;
  });
}

export async function svgToPngBlob(svgText, width, height, options = {}) {
  const scale = options.scale || 2;
  const image = await loadSvgImage(svgText);
  await image.decode?.().catch(() => {});
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.fillStyle = "#14171e";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const png = await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNG 编码失败")), "image/png");
  });
  return embedPngProjectMetadata(
    png,
    "aurelia:project",
    projectMetadata(options.state, "png")
  );
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function safeFilename(name, extension) {
  const base = String(name || "aurelia-window")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 80);
  return `${base}.${extension}`;
}
