// Export: SVG (editable text/shapes + embedded raster tile + full params in
// metadata) and PNG preflight. SVG building is pure string logic so it is
// testable in Node.
import { validateElements, elementBounds, approximateMeasure, DESIGN_SIZE, SAFE_MARGIN_PCT } from './overlay.js';

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Preflight before ANY export: returns issues; caller must surface them
// with fix instructions instead of silently dropping content.
export function preflight(state, measureFn = approximateMeasure) {
  return validateElements(state.elements, DESIGN_SIZE, SAFE_MARGIN_PCT, measureFn);
}

export function buildSVG(state, tileDataURL, size, measureFn = approximateMeasure) {
  const k = size / DESIGN_SIZE;
  const meta = esc(JSON.stringify({
    app: 'tile-texture-studio',
    version: state.version,
    params: state.params,
    repairs: state.repairs,
    timeline: state.timeline,
  }));
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`);
  parts.push(`<metadata>${meta}</metadata>`);
  parts.push(`<image href="${tileDataURL}" x="0" y="0" width="${size}" height="${size}" preserveAspectRatio="none"/>`);
  for (const el of state.elements) {
    const op = `opacity="${el.opacity}"`;
    if (el.type === 'text') {
      const b = elementBounds(el, measureFn);
      const fs = el.fontSize * k;
      parts.push(
        `<text x="${(el.x * k).toFixed(2)}" y="${(el.y * k).toFixed(2)}" ` +
        `font-family="${esc(el.fontFamily)}" font-size="${fs.toFixed(2)}" ` +
        `fill="${esc(el.color)}" ${op} data-id="${el.id}" ` +
        `data-width="${b.w.toFixed(1)}">${esc(el.text)}</text>`
      );
    } else if (el.type === 'rect') {
      parts.push(`<rect x="${el.x * k}" y="${el.y * k}" width="${el.w * k}" height="${el.h * k}" fill="${esc(el.color)}" ${op} data-id="${el.id}"/>`);
    } else if (el.type === 'ellipse') {
      parts.push(`<ellipse cx="${(el.x + el.w / 2) * k}" cy="${(el.y + el.h / 2) * k}" rx="${(el.w / 2) * k}" ry="${(el.h / 2) * k}" fill="${esc(el.color)}" ${op} data-id="${el.id}"/>`);
    } else if (el.type === 'image' && el.src) {
      parts.push(`<image href="${el.src}" x="${el.x * k}" y="${el.y * k}" width="${el.w * k}" height="${el.h * k}" ${op} data-id="${el.id}"/>`);
    }
  }
  parts.push('</svg>');
  return parts.join('\n');
}

// Browser-only: render the full composition (tile + repairs + elements)
// onto a fresh canvas at the requested export size.
export async function renderExportCanvas(state, size, deps) {
  const { generateTile, applyRepairs, drawElements, measureFn, imageCache } = deps;
  const tile = applyRepairs(generateTile(state.params, size), size, state.repairs);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  img.data.set(tile);
  ctx.putImageData(img, 0, 0);
  drawElements(ctx, state.elements, size / DESIGN_SIZE, state.timeline, imageCache);
  return canvas;
}
