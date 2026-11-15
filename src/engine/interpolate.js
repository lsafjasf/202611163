// 纯函数关键帧插值：数字、颜色（hex/rgb）与缓动。

export const EASINGS = {
  linear: (x) => x,
  hold: () => 0,
  easeIn: (x) => x * x,
  easeOut: (x) => 1 - (1 - x) * (1 - x),
  easeInOut: (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2),
};

export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

export function parseColor(input) {
  if (Array.isArray(input)) return input.slice(0, 3).map(Number);
  let s = String(input).trim();
  if (s.startsWith('#')) {
    s = s.slice(1);
    if (s.length === 3) s = s.split('').map((c) => c + c).join('');
    const n = parseInt(s, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (m) return m[1].split(',').slice(0, 3).map((x) => parseFloat(x));
  return [0, 0, 0];
}

export function rgbToHex([r, g, b]) {
  const h = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpColor(a, b, t) {
  const ca = parseColor(a);
  const cb = parseColor(b);
  return rgbToHex([
    lerp(ca[0], cb[0], t),
    lerp(ca[1], cb[1], t),
    lerp(ca[2], cb[2], t),
  ]);
}

// keyframes: [{ t, value, easing? }]，已按 t 排序。type: 'number' | 'color'
export function valueAt(keyframes, t, type = 'number') {
  if (!keyframes || keyframes.length === 0) return undefined;
  if (keyframes.length === 1 || t <= keyframes[0].t) return keyframes[0].value;
  const last = keyframes[keyframes.length - 1];
  if (t >= last.t) return last.value;

  let i = 0;
  while (i < keyframes.length - 1 && keyframes[i + 1].t < t) i += 1;
  const a = keyframes[i];
  const b = keyframes[i + 1];
  const span = b.t - a.t;
  const raw = span <= 0 ? 0 : (t - a.t) / span;
  const ease = EASINGS[b.easing || a.easing || 'linear'] || EASINGS.linear;
  const k = ease(clamp(raw, 0, 1));
  if (type === 'color') return lerpColor(a.value, b.value, k);
  return lerp(a.value, b.value, k);
}

// 解析某条轨道在指定时刻的数值，缺省时回退到默认值。
export function trackValue(track, t, type, fallback) {
  const v = valueAt(track, t, type);
  return v === undefined ? fallback : v;
}
