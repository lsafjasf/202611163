// Canvas 渲染器:预览与 PNG 导出共用同一绘制函数,保证所见即所得。
import { PAGE, gridFor } from './model.js';

export function sampleProps(el, t) {
  const kfs = (el.keyframes || []).slice().sort((a, b) => a.t - b.t);
  if (!kfs.length || t == null) return el;
  let prev = null, next = null;
  for (const kf of kfs) {
    if (kf.t <= t) prev = kf;
    if (kf.t >= t && !next) next = kf;
  }
  if (!prev && !next) return el;
  if (!prev) return { ...el, ...pick(next.props) };
  if (!next || next.t === prev.t) return { ...el, ...pick(prev.props) };
  const r = (t - prev.t) / (next.t - prev.t);
  const out = { ...el };
  for (const k of ['x', 'y', 'opacity']) {
    const a = prev.props[k] ?? el[k];
    const b = next.props[k] ?? a;
    out[k] = a + (b - a) * r;
  }
  return out;
}

function pick(props) {
  const out = {};
  for (const k of ['x', 'y', 'opacity']) if (props[k] != null) out[k] = props[k];
  return out;
}

export function wrapLines(ctx, el) {
  const maxW = el.w;
  const lines = [];
  for (const para of String(el.text || '').split('\n')) {
    let cur = '';
    for (const ch of para) {
      if (ctx.measureText(cur + ch).width > maxW && cur) {
        lines.push(cur);
        cur = ch;
      } else cur += ch;
    }
    lines.push(cur);
  }
  return lines;
}

export function fontOf(el) {
  return `${el.bold ? 'bold ' : ''}${el.fontSize}px ${el.fontFamily || 'sans-serif'}`;
}

export function drawPage(ctx, state, opts = {}) {
  const { scale = 1, showGuides = true, selectedId = null, images = {}, time = null } = opts;
  ctx.save();
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, PAGE.w, PAGE.h);
  const grid = gridFor(state.cols);

  if (showGuides) {
    ctx.fillStyle = '#f4f5fb';
    for (let i = 0; i < state.cols; i++) {
      ctx.fillRect(PAGE.margin + i * (grid.colW + PAGE.gutter), PAGE.margin, grid.colW, PAGE.h - PAGE.margin * 2);
    }
  }

  for (const raw of state.elements) {
    const el = sampleProps(raw, time);
    ctx.save();
    ctx.globalAlpha = el.opacity ?? 1;
    if (el.type === 'shape') drawShape(ctx, el);
    else if (el.type === 'image') drawImage(ctx, el, images[el.id]);
    else if (el.type === 'text') drawText(ctx, el);
    ctx.restore();
    if (showGuides && raw.id === selectedId) drawSelection(ctx, raw);
  }

  if (showGuides) drawGuides(ctx, grid);
  ctx.restore();
}

function drawShape(ctx, el) {
  ctx.beginPath();
  if (el.shape === 'ellipse') {
    ctx.ellipse(el.x + el.w / 2, el.y + el.h / 2, el.w / 2, el.h / 2, 0, 0, Math.PI * 2);
  } else {
    ctx.rect(el.x, el.y, el.w, el.h);
  }
  ctx.fillStyle = el.fill || '#4f6df5';
  ctx.fill();
  if (el.stroke) { ctx.strokeStyle = el.stroke; ctx.lineWidth = 2; ctx.stroke(); }
}

function drawImage(ctx, el, img) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(el.x, el.y, el.w, el.h);
  ctx.clip();
  if (img && img.complete && img.naturalWidth) {
    const s = Math.max(el.w / img.naturalWidth, el.h / img.naturalHeight);
    const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
    ctx.drawImage(img, el.x + (el.w - dw) / 2, el.y + (el.h - dh) / 2, dw, dh);
  } else {
    const g = ctx.createLinearGradient(el.x, el.y, el.x + el.w, el.y + el.h);
    g.addColorStop(0, '#c7d2fe');
    g.addColorStop(1, '#94a3b8');
    ctx.fillStyle = g;
    ctx.fillRect(el.x, el.y, el.w, el.h);
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(el.src ? '加载中…' : '图片占位(可上传替换)', el.x + el.w / 2, el.y + el.h / 2);
  }
  ctx.restore();
}

function drawText(ctx, el) {
  ctx.font = fontOf(el);
  ctx.fillStyle = el.color || '#1a1a2e';
  ctx.textBaseline = 'top';
  const lines = wrapLines(ctx, el);
  const lineH = el.fontSize * 1.25;
  ctx.save();
  ctx.beginPath();
  ctx.rect(el.x - 2, el.y - 2, el.w + 4, el.h + 4);
  ctx.clip();
  lines.forEach((line, i) => {
    let tx = el.x;
    ctx.textAlign = el.align || 'left';
    if (el.align === 'center') tx = el.x + el.w / 2;
    if (el.align === 'right') tx = el.x + el.w;
    ctx.fillText(line, tx, el.y + i * lineH);
  });
  ctx.restore();
}

function drawSelection(ctx, el) {
  ctx.strokeStyle = '#4f6df5';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(el.x - 2, el.y - 2, el.w + 4, el.h + 4);
  ctx.setLineDash([]);
  ctx.fillStyle = '#4f6df5';
  ctx.fillRect(el.x + el.w - 5, el.y + el.h - 5, 10, 10);
}

function drawGuides(ctx, grid) {
  ctx.strokeStyle = 'rgba(79,109,245,.35)';
  ctx.lineWidth = 1;
  for (const x of grid.vGuides) {
    ctx.beginPath(); ctx.moveTo(x, PAGE.margin); ctx.lineTo(x, PAGE.h - PAGE.margin); ctx.stroke();
  }
  for (const y of grid.hGuides) {
    ctx.beginPath(); ctx.moveTo(PAGE.margin, y); ctx.lineTo(PAGE.w - PAGE.margin, y); ctx.stroke();
  }
  const s = grid.safe;
  ctx.strokeStyle = 'rgba(220,38,38,.55)';
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(s.x, s.y, s.w, s.h);
  ctx.setLineDash([]);
}
