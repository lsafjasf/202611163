// Shared element rendering used by BOTH the on-screen preview and the PNG
// exporter, so exported output matches the preview exactly.
import { sampleKeyframes, elementBounds } from './overlay.js';

export function drawElements(ctx, elements, scale, t, imageCache = {}) {
  for (const el of elements) {
    const kf = sampleKeyframes(el, t);
    ctx.save();
    ctx.globalAlpha = kf.opacity;
    ctx.fillStyle = el.color;
    const x = kf.x * scale, y = kf.y * scale;
    if (el.type === 'text') {
      ctx.font = `${el.fontSize * scale}px ${el.fontFamily}`;
      ctx.textBaseline = 'top';
      wrapText(ctx, el.text, x, y, (el.w ? el.w * scale : Infinity), el.fontSize * scale * 1.2);
    } else if (el.type === 'rect') {
      ctx.fillRect(x, y, el.w * scale, el.h * scale);
    } else if (el.type === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse(x + (el.w * scale) / 2, y + (el.h * scale) / 2,
        (el.w * scale) / 2, (el.h * scale) / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (el.type === 'image') {
      const img = imageCache[el.id];
      if (img) ctx.drawImage(img, x, y, el.w * scale, el.h * scale);
    }
    ctx.restore();
  }
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const chars = String(text).split('');
  let line = '';
  let cy = y;
  for (const ch of chars) {
    if (ch === '\n' || (isFinite(maxWidth) && ctx.measureText(line + ch).width > maxWidth && line)) {
      ctx.fillText(line, x, cy);
      line = ch === '\n' ? '' : ch;
      cy += lineHeight;
    } else {
      line += ch;
    }
  }
  if (line) ctx.fillText(line, x, cy);
}

export function drawSafeArea(ctx, size, marginPct) {
  const m = size * marginPct;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,80,80,0.85)';
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(m, m, size - 2 * m, size - 2 * m);
  ctx.restore();
}

export function drawSelection(ctx, el, scale, measureFn) {
  const b = elementBounds(el, measureFn);
  ctx.save();
  ctx.strokeStyle = '#4f7cff';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(b.x * scale - 2, b.y * scale - 2, b.w * scale + 4, b.h * scale + 4);
  ctx.restore();
}
