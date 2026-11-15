import { FONT_PRESETS } from "./model.js";
import { bytesToBase64 } from "./util.js";

const BUILTIN_FILES = {
  serif: {
    family: "Stamp Serif",
    url: "./assets/fonts/stamp-serif.woff2",
    format: "woff2"
  },
  sans: {
    family: "Stamp Sans",
    url: "./assets/fonts/stamp-sans.woff2",
    format: "woff2"
  },
  kai: {
    family: "Stamp Serif",
    url: "./assets/fonts/stamp-serif.woff2",
    format: "woff2"
  }
};

const fontDataCache = new Map();
const registeredCustom = new Set();

export async function ensureBuiltinFontsLoaded() {
  await Promise.all([
    document.fonts.load('600 32px "Stamp Serif"'),
    document.fonts.load('600 32px "Stamp Sans"'),
    document.fonts.load('700 32px "Stamp Serif"')
  ]);
  await document.fonts.ready;
}

export async function registerCustomFonts(model) {
  const fonts = model.assets?.fonts || {};
  for (const [id, asset] of Object.entries(fonts)) {
    if (registeredCustom.has(id)) continue;
    try {
      const face = new FontFace(asset.family, `url(${asset.dataUrl})`, {
        weight: "100 900",
        style: "normal"
      });
      await face.load();
      document.fonts.add(face);
      registeredCustom.add(id);
    } catch (error) {
      throw new Error(`字体“${asset.name || id}”无法加载：${error.message}`);
    }
  }
}

export async function fontDataForExport(model) {
  const used = new Set(
    model.elements
      .filter((element) => element.visible && element.fontId)
      .map((element) => element.fontId)
  );
  const result = {};
  for (const fontId of used) {
    if (model.assets.fonts[fontId]) {
      const asset = model.assets.fonts[fontId];
      result[fontId] = {
        family: asset.family,
        dataUrl: asset.dataUrl
      };
      continue;
    }
    const definition = BUILTIN_FILES[fontId];
    if (!definition) continue;
    if (fontDataCache.has(definition.url)) {
      result[fontId] = {
        family: definition.family,
        dataUrl: fontDataCache.get(definition.url)
      };
      continue;
    }
    const response = await fetch(definition.url);
    if (!response.ok) {
      throw new Error(`内置字体 ${fontId} 读取失败，SVG 无法内嵌字体。`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const mime = definition.format === "woff2" ? "font/woff2" : "font/ttf";
    const dataUrl = `data:${mime};base64,${bytesToBase64(bytes)}`;
    fontDataCache.set(definition.url, dataUrl);
    result[fontId] = { family: definition.family, dataUrl };
  }
  return result;
}

export function fontNameFor(fontId, model) {
  if (model.assets?.fonts?.[fontId]) return model.assets.fonts[fontId].name;
  return FONT_PRESETS.find((font) => font.id === fontId)?.name || "系统字体";
}
