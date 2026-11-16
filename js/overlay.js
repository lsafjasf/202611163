// Editable overlay elements (text / rect / ellipse / image) in design
// coordinates (DESIGN_SIZE x DESIGN_SIZE), plus safe-area validation and
// keyframe interpolation. Pure logic — canvas measuring is injected.

export const DESIGN_SIZE = 512;
export const SAFE_MARGIN_PCT = 0.05;
export const MIN_FONT_SIZE = 6;
export const MAX_TEXT_CHARS = 500;

let nextId = 1;
export function createElement(type, props = {}) {
  const base = {
    id: 'el' + nextId++,
    type,
    x: 96, y: 96, w: 160, h: 80,
    color: '#ffffff',
    opacity: 1,
    keyframes: [], // [{t:0..1, x, y, opacity}]
  };
  if (type === 'text') {
    Object.assign(base, {
      text: '双击编辑文字',
      fontSize: 32,
      fontFamily: 'sans-serif',
      w: 0, h: 0, // 0 = auto (measured)
    });
  }
  if (type === 'image') {
    Object.assign(base, { src: '', name: '' });
  }
  return Object.assign(base, props);
}

// Fallback text metrics for Node tests; browser injects canvas measure.
export function approximateMeasure(el) {
  const text = el.text || '';
  return {
    w: Math.ceil(text.length * el.fontSize * 0.6),
    h: Math.ceil(el.fontSize * 1.2),
  };
}

export function elementBounds(el, measureFn = approximateMeasure) {
  if (el.type === 'text' && (!el.w || !el.h)) {
    const m = measureFn(el);
    return { x: el.x, y: el.y, w: m.w, h: m.h };
  }
  return { x: el.x, y: el.y, w: el.w, h: el.h };
}

// Validate elements against the safe area. Returns human-readable issues
// with fix instructions (never silently drop content).
export function validateElements(elements, size = DESIGN_SIZE, marginPct = SAFE_MARGIN_PCT, measureFn = approximateMeasure) {
  const m = size * marginPct;
  const issues = [];
  for (const el of elements) {
    const b = elementBounds(el, measureFn);
    if (el.type === 'text') {
      if ((el.text || '').length > MAX_TEXT_CHARS) {
        issues.push({
          id: el.id, kind: 'text-too-long',
          message: `文字「${(el.text || '').slice(0, 12)}…」共 ${el.text.length} 字，超过上限 ${MAX_TEXT_CHARS}。请缩短文字或拆分为多个文本框。`,
        });
      }
      if (el.fontSize < MIN_FONT_SIZE) {
        issues.push({
          id: el.id, kind: 'font-too-small',
          message: `文字字号 ${el.fontSize}px 小于最小值 ${MIN_FONT_SIZE}px，导出将不可读。请增大字号。`,
        });
      }
      if (b.w > size - 2 * m) {
        issues.push({
          id: el.id, kind: 'text-overflow',
          message: `文字宽度 ${Math.round(b.w)}px 超出安全区宽度 ${Math.round(size - 2 * m)}px。请缩短文字、减小字号或换行。`,
        });
      }
    }
    if (b.w <= 0 || b.h <= 0) {
      issues.push({
        id: el.id, kind: 'degenerate',
        message: `元素 ${el.id} 尺寸为 ${Math.round(b.w)}×${Math.round(b.h)}，无法渲染。请设置大于 0 的宽高。`,
      });
      continue;
    }
    if (b.x < m || b.y < m || b.x + b.w > size - m || b.y + b.h > size - m) {
      issues.push({
        id: el.id, kind: 'outside-safe-area',
        message: `元素 ${el.id} 超出安全边距(${Math.round(m)}px)。请将其移入虚线框内，或缩小尺寸。`,
      });
    }
    if (b.x + b.w < 0 || b.y + b.h < 0 || b.x > size || b.y > size) {
      issues.push({
        id: el.id, kind: 'fully-outside',
        message: `元素 ${el.id} 完全位于画布外，导出将丢失。请移回画布内。`,
      });
    }
  }
  return issues;
}

// Interpolate keyframed props at time t (0..1). Linear between neighbors.
export function sampleKeyframes(el, t) {
  const kf = el.keyframes;
  if (!kf || !kf.length) return { x: el.x, y: el.y, opacity: el.opacity };
  const sorted = [...kf].sort((a, b) => a.t - b.t);
  if (t <= sorted[0].t) return pick(sorted[0], el);
  if (t >= sorted[sorted.length - 1].t) return pick(sorted[sorted.length - 1], el);
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1];
    if (t >= a.t && t <= b.t) {
      const k = (t - a.t) / (b.t - a.t || 1);
      return {
        x: lerp(a.x ?? el.x, b.x ?? el.x, k),
        y: lerp(a.y ?? el.y, b.y ?? el.y, k),
        opacity: lerp(a.opacity ?? el.opacity, b.opacity ?? el.opacity, k),
      };
    }
  }
  return { x: el.x, y: el.y, opacity: el.opacity };
}
function pick(k, el) {
  return { x: k.x ?? el.x, y: k.y ?? el.y, opacity: k.opacity ?? el.opacity };
}
function lerp(a, b, k) { return a + (b - a) * k; }
