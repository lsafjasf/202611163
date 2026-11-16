// Per-pixel tileable texture generators (stone / wood / fabric).
// Pure functions over typed arrays — no DOM, so they are testable in Node.
import { fbm, ridge } from './noise.js';

export const TEXTURE_TYPES = ['stone', 'wood', 'fabric'];

// Wrap-blend: sample pattern fn at 4 wrapped offsets so ANY pattern
// (including rotated ones) becomes seamlessly tileable.
function tileableSample(fn, u, v) {
  const su = u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u);
  const sv = v < 0.5 ? 2 * v * v : 1 - 2 * (1 - v) * (1 - v);
  const c00 = fn(u, v), c10 = fn(u - 1, v), c01 = fn(u, v - 1), c11 = fn(u - 1, v - 1);
  const out = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const a = c00[k] + (c10[k] - c00[k]) * su;
    const b = c01[k] + (c11[k] - c01[k]) * su;
    out[k] = a + (b - a) * sv;
  }
  return out;
}

function rotate(u, v, angleRad) {
  const c = Math.cos(angleRad), s = Math.sin(angleRad);
  return [u * c - v * s, u * s + v * c];
}

function clamp255(x) { return x < 0 ? 0 : x > 255 ? 255 : x; }

function applyContrast(v, contrast) {
  // v in [0,1]
  let r = 0.5 + (v - 0.5) * contrast;
  return r < 0 ? 0 : r > 1 ? 1 : r;
}

function stoneFn(scale, angleRad, seed) {
  const p = Math.max(1, Math.round(3 * scale));
  return (u, v) => {
    const [x, y] = rotate(u * scale, v * scale, angleRad);
    const base = fbm(x, y, p, 4, seed);
    const veins = ridge(x * 1.0 + 7.3, y * 1.0 - 2.1, p, seed + 31);
    const speck = fbm(x * 2.7 + 3.1, y * 2.7 + 9.4, p * 2, 2, seed + 77);
    let t = 0.55 * base + 0.25 * Math.pow(veins, 6) + 0.2 * speck;
    const warm = 0.5 + 0.5 * fbm(x * 0.8 + 11, y * 0.8 - 5, p, 2, seed + 5);
    const g = applyContrast(t, 1);
    return [
      255 * (0.62 + 0.30 * g + 0.06 * warm),
      255 * (0.60 + 0.30 * g + 0.03 * warm),
      255 * (0.58 + 0.30 * g - 0.02 * warm),
    ];
  };
}

function woodFn(scale, angleRad, seed) {
  const p = Math.max(1, Math.round(2 * scale));
  return (u, v) => {
    const [x, y] = rotate(u * scale, v * scale, angleRad);
    const distort = fbm(x * 1.2 + 4.2, y * 1.2 - 1.7, p, 3, seed + 13);
    const rings = 0.5 + 0.5 * Math.sin(2 * Math.PI * (y * 3.5 * scale + distort * 3.2));
    const streak = fbm(x * 0.5 - 8.8, y * 4.0 + 0.5, p, 3, seed + 41);
    const pore = fbm(x * 6.0 + 2.2, y * 6.0 - 3.3, p * 4, 2, seed + 91);
    const t = 0.55 * rings + 0.30 * streak + 0.15 * pore;
    const g = applyContrast(t, 1);
    return [
      255 * (0.42 + 0.38 * g),
      255 * (0.26 + 0.28 * g),
      255 * (0.12 + 0.18 * g),
    ];
  };
}

function fabricFn(scale, angleRad, seed) {
  const p = Math.max(1, Math.round(4 * scale));
  return (u, v) => {
    const [x, y] = rotate(u * scale, v * scale, angleRad);
    const threads = 24 * scale;
    const weave = Math.sin(2 * Math.PI * x * threads) * Math.sin(2 * Math.PI * y * threads);
    const over = 0.5 + 0.5 * Math.sin(2 * Math.PI * (x * threads + 0.25));
    const n = fbm(x * 2 + 1.3, y * 2 + 6.6, p, 3, seed + 3);
    const t = 0.5 + 0.22 * weave * (0.6 + 0.4 * over) + 0.28 * (n - 0.5);
    const g = applyContrast(t, 1);
    return [
      255 * (0.30 + 0.34 * g),
      255 * (0.36 + 0.34 * g),
      255 * (0.50 + 0.32 * g),
    ];
  };
}

const GENERATORS = { stone: stoneFn, wood: woodFn, fabric: fabricFn };

// Generate RGBA pixels (Uint8ClampedArray, size*size*4) for a tile.
// params: { type, scale, angle(deg), contrast, seed }
export function generateTile(params, size) {
  const gen = GENERATORS[params.type] || stoneFn;
  const angleRad = (params.angle * Math.PI) / 180;
  const fn = gen(params.scale, angleRad, params.seed);
  const data = new Uint8ClampedArray(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = (i + 0.5) / size, v = (j + 0.5) / size;
      const rgb = tileableSample(fn, u, v);
      const o = (j * size + i) * 4;
      data[o] = clamp255(127.5 + (rgb[0] - 127.5) * params.contrast);
      data[o + 1] = clamp255(127.5 + (rgb[1] - 127.5) * params.contrast);
      data[o + 2] = clamp255(127.5 + (rgb[2] - 127.5) * params.contrast);
      data[o + 3] = 255;
    }
  }
  return data;
}
