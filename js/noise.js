// Tileable value noise: lattice indices wrap with an integer period,
// so sampling over [0,1) tiles seamlessly on all four edges.

export function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function hash2(ix, iy, seed) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t) { return t * t * (3 - 2 * t); }

// Periodic value noise. u,v in [0,1); period = integer cells per tile.
export function pnoise(u, v, period, seed) {
  const x = u * period, y = v * period;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = smooth(x - x0), fy = smooth(y - y0);
  const p = period;
  const i0 = ((x0 % p) + p) % p, i1 = (i0 + 1) % p;
  const j0 = ((y0 % p) + p) % p, j1 = (j0 + 1) % p;
  const a = hash2(i0, j0, seed), b = hash2(i1, j0, seed);
  const c = hash2(i0, j1, seed), d = hash2(i1, j1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

// Tileable fbm: each octave uses an integer multiple of the base period.
export function fbm(u, v, basePeriod, octaves, seed) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * pnoise(u, v, basePeriod << o, seed + o * 101);
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

// Periodic ridged noise for stone veins.
export function ridge(u, v, period, seed) {
  const n = pnoise(u, v, period, seed);
  return 1 - Math.abs(2 * n - 1);
}
