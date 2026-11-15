const FONT_FAMILIES = {
  "serif-cn": [{ family: "Noto Serif SC", weights: [400, 500, 600] }],
  "sans-cn": [
    { family: "Manrope", weights: [400, 500, 600, 700] },
    { family: "Noto Sans SC", weights: [400, 500, 600, 700] },
  ],
  mono: [
    { family: "DM Mono", weights: [300, 400, 500] },
    { family: "Noto Sans SC", weights: [400, 500, 600, 700] },
  ],
};

const cssCache = new Map();
const dataUrlCache = new Map();

function closestWeight(weight, supported) {
  const numeric = Number(weight) || 400;
  return supported.reduce((best, candidate) =>
    Math.abs(candidate - numeric) < Math.abs(best - numeric) ? candidate : best,
  );
}

function parseBlocks(css) {
  return [...css.matchAll(/@font-face\s*\{([\s\S]*?)\}/g)].map((match) => {
    const body = match[1];
    return {
      family: body.match(/font-family:\s*['"]([^'"]+)['"]/)?.[1] || "",
      weight: Number(body.match(/font-weight:\s*(\d+)/)?.[1] || 400),
      style: body.match(/font-style:\s*([^;]+)/)?.[1]?.trim() || "normal",
      unicodeRange: body.match(/unicode-range:\s*([^;]+)/)?.[1]?.trim() || "U+0-10FFFF",
      url: body.match(/src:\s*url\((https:[^)]+)\)/)?.[1] || "",
      format: body.match(/format\(['"]([^'"]+)['"]\)/)?.[1] || "woff2",
    };
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("字体文件编码失败。"));
    reader.readAsDataURL(blob);
  });
}

async function fetchFontDataUrl(url) {
  if (dataUrlCache.has(url)) return dataUrlCache.get(url);
  const response = await fetch(url, { mode: "cors", cache: "force-cache" });
  if (!response.ok) throw new Error(`字体文件下载失败（${response.status}）。`);
  const blob = await response.blob();
  if (!blob.size) throw new Error("字体文件为空。");
  const dataUrl = await blobToDataUrl(blob);
  dataUrlCache.set(url, dataUrl);
  return dataUrl;
}

async function fetchSubsetCss(family, weight, characters) {
  const text = [...characters].sort().join("");
  const cacheKey = `${family}|${weight}|${text}`;
  if (cssCache.has(cacheKey)) return cssCache.get(cacheKey);
  const familyParam = family.replaceAll(" ", "+");
  const url =
    `https://fonts.googleapis.com/css2?family=${familyParam}:wght@${weight}` +
    `&text=${encodeURIComponent(text)}&display=block`;
  const response = await fetch(url, { mode: "cors", cache: "force-cache" });
  if (!response.ok) throw new Error(`字体子集请求失败（${family} ${response.status}）。`);
  const css = await response.text();
  const blocks = parseBlocks(css).filter((block) => block.url);
  if (!blocks.length) throw new Error(`字体子集不可用：${family} ${weight}。`);
  const embedded = [];
  for (const block of blocks) {
    const dataUrl = await fetchFontDataUrl(block.url);
    embedded.push(
      `@font-face{font-family:'${block.family || family}';font-style:${block.style};` +
        `font-weight:${block.weight};font-display:block;src:url(${dataUrl}) format('${block.format}');` +
        `unicode-range:${block.unicodeRange};}`,
    );
  }
  const result = embedded.join("");
  cssCache.set(cacheKey, result);
  return result;
}

export async function createEmbeddedFontCss(state) {
  const groups = new Map();
  for (const element of state.elements) {
    if (element.type !== "text" || !element.visible) continue;
    const families = FONT_FAMILIES[element.fontId] || FONT_FAMILIES["serif-cn"];
    const characters = [...new Set(Array.from(String(element.text || "")))]
      .filter((character) => character.charCodeAt(0) >= 32)
      .join("");
    for (const family of families) {
      const weight = closestWeight(element.fontWeight, family.weights);
      const key = `${family.family}|${weight}`;
      if (!groups.has(key)) groups.set(key, { family: family.family, weight, chars: new Set() });
      const group = groups.get(key);
      for (const character of characters) group.chars.add(character);
    }
  }

  const requests = [...groups.values()]
    .filter((group) => group.chars.size)
    .map((group) => fetchSubsetCss(group.family, group.weight, group.chars));
  const styles = await Promise.all(requests);
  return styles.join("");
}
