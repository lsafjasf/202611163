// 导出:SVG(可编辑矢量,非截图烧录)、PNG(同一渲染器重绘)、版式 JSON。
import { PAGE, gridFor, serialize } from './model.js';
import { drawPage, wrapLines, fontOf } from './render.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

export function exportSVG(state, measureCtx) {
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE.w}" height="${PAGE.h}" viewBox="0 0 ${PAGE.w} ${PAGE.h}">`);
  parts.push(`<rect width="${PAGE.w}" height="${PAGE.h}" fill="#ffffff"/>`);
  for (const el of state.elements) {
    const op = el.opacity ?? 1;
    if (el.type === 'shape') {
      const fill = esc(el.fill || '#4f6df5');
      if (el.shape === 'ellipse') {
        parts.push(`<ellipse cx="${el.x + el.w / 2}" cy="${el.y + el.h / 2}" rx="${el.w / 2}" ry="${el.h / 2}" fill="${fill}" opacity="${op}"/>`);
      } else {
        parts.push(`<rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" fill="${fill}" opacity="${op}"/>`);
      }
    } else if (el.type === 'image') {
      if (el.src) {
        parts.push(`<image x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" href="${el.src}" preserveAspectRatio="xMidYMid slice" opacity="${op}"/>`);
      } else {
        parts.push(`<rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" fill="#c7d2fe" opacity="${op}"/>`);
      }
    } else if (el.type === 'text') {
      const lines = measureCtx ? wrapLines(measureCtx, el) : [String(el.text || '')];
      const lineH = el.fontSize * 1.25;
      const anchor = el.align === 'center' ? 'middle' : el.align === 'right' ? 'end' : 'start';
      const tx = el.align === 'center' ? el.x + el.w / 2 : el.align === 'right' ? el.x + el.w : el.x;
      const weight = el.bold ? 'bold' : 'normal';
      parts.push(`<text x="${tx}" y="${el.y}" font-family="${esc(el.fontFamily || 'sans-serif')}" font-size="${el.fontSize}" font-weight="${weight}" fill="${esc(el.color || '#1a1a2e')}" text-anchor="${anchor}" opacity="${op}">`);
      lines.forEach((line, i) => {
        parts.push(`<tspan x="${tx}" dy="${i === 0 ? el.fontSize : lineH}">${esc(line)}</tspan>`);
      });
      parts.push('</text>');
    }
  }
  parts.push('</svg>');
  return parts.join('\n');
}

export function exportPNG(state, images, scale = 2) {
  const canvas = document.createElement('canvas');
  canvas.width = PAGE.w * scale;
  canvas.height = PAGE.h * scale;
  const ctx = canvas.getContext('2d');
  drawPage(ctx, state, { scale, showGuides: false, images });
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

export function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function downloadJSON(state) {
  const blob = new Blob([serialize(state)], { type: 'application/json' });
  downloadBlob(blob, `${state.name || 'poster'}.json`);
}

export function makeMeasureCtx(state) {
  const ctx = document.createElement('canvas').getContext('2d');
  return ctx;
}

export { gridFor };
