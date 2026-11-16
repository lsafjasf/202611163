// Software-rendered model preview (sphere / cube) sampling the tile with
// bilinear filtering and simple Lambert shading. Pure typed-array logic.

function sample(tile, size, u, v) {
  u = ((u % 1) + 1) % 1; v = ((v % 1) + 1) % 1;
  const x = u * size - 0.5, y = v * size - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const i0 = ((x0 % size) + size) % size, i1 = (i0 + 1) % size;
  const j0 = ((y0 % size) + size) % size, j1 = (j0 + 1) % size;
  const o00 = (j0 * size + i0) * 4, o10 = (j0 * size + i1) * 4;
  const o01 = (j1 * size + i0) * 4, o11 = (j1 * size + i1) * 4;
  const out = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const a = tile[o00 + k] + (tile[o10 + k] - tile[o00 + k]) * fx;
    const b = tile[o01 + k] + (tile[o11 + k] - tile[o01 + k]) * fx;
    out[k] = a + (b - a) * fy;
  }
  return out;
}

const LIGHT = norm([-0.5, -0.7, 0.6]);
function norm(v) { const l = Math.hypot(...v); return v.map(c => c / l); }

export function renderSphere(tile, tileSize, out, outSize, rotY = 0.6, rotX = 0.4) {
  const R = outSize * 0.42, cx = outSize / 2, cy = outSize / 2;
  const cy1 = Math.cos(rotY), sy1 = Math.sin(rotY);
  const cx1 = Math.cos(rotX), sx1 = Math.sin(rotX);
  for (let j = 0; j < outSize; j++) {
    for (let i = 0; i < outSize; i++) {
      const o = (j * outSize + i) * 4;
      const nx = (i - cx) / R, ny = (j - cy) / R;
      const d2 = nx * nx + ny * ny;
      if (d2 > 1) { out[o + 3] = 0; continue; }
      const nz = Math.sqrt(1 - d2);
      // rotate normal back to get texture-space direction
      let x = nx * cy1 + nz * sy1, z = -nx * sy1 + nz * cy1, y = ny;
      let y2 = y * cx1 - z * sx1, z2 = y * sx1 + z * cx1;
      const u = 0.5 + Math.atan2(x, z2) / (2 * Math.PI);
      const v = 0.5 - Math.asin(Math.max(-1, Math.min(1, y2))) / Math.PI;
      const c = sample(tile, tileSize, u * 2, v * 2);
      const diff = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
      const shade = 0.35 + 0.65 * diff;
      out[o] = c[0] * shade; out[o + 1] = c[1] * shade; out[o + 2] = c[2] * shade;
      out[o + 3] = 255;
    }
  }
}

export function renderCube(tile, tileSize, out, outSize, rotY = 0.7, rotX = 0.5) {
  // 3 visible faces of an axis-projected cube, affine texture mapping.
  const s = outSize * 0.30;
  const cx = outSize / 2, cy = outSize / 2;
  const verts = [];
  for (const [sx, sy, sz] of [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]]) {
    let x = sx * Math.cos(rotY) + sz * Math.sin(rotY);
    let z = -sx * Math.sin(rotY) + sz * Math.cos(rotY);
    let y = sy * Math.cos(rotX) - z * Math.sin(rotX);
    z = sy * Math.sin(rotX) + z * Math.cos(rotX);
    verts.push({ px: cx + x * s, py: cy + y * s, z });
  }
  const faces = [
    { idx: [4, 5, 6, 7], n: [0, 0, 1] },   // front-ish
    { idx: [1, 5, 6, 2], n: [1, 0, 0] },   // right
    { idx: [4, 0, 1, 5], n: [0, -1, 0] },  // top
  ];
  const order = faces
    .map(f => ({ f, z: f.idx.reduce((a, i) => a + verts[i].z, 0) / 4 }))
    .sort((a, b) => a.z - b.z);
  out.fill(0);
  for (const { f } of order) {
    const p = f.idx.map(i => verts[i]);
    const n = rotN(f.n, rotY, rotX);
    const shade = 0.35 + 0.65 * Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
    rasterQuad(p, tile, tileSize, out, outSize, shade);
  }
}

function rotN(n, rotY, rotX) {
  let x = n[0] * Math.cos(rotY) + n[2] * Math.sin(rotY);
  let z = -n[0] * Math.sin(rotY) + n[2] * Math.cos(rotY);
  let y = n[1] * Math.cos(rotX) - z * Math.sin(rotX);
  z = n[1] * Math.sin(rotX) + z * Math.cos(rotX);
  return [x, y, z];
}

function rasterQuad(p, tile, tileSize, out, outSize, shade) {
  const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const minY = Math.max(0, Math.floor(Math.min(...p.map(q => q.py))));
  const maxY = Math.min(outSize - 1, Math.ceil(Math.max(...p.map(q => q.py))));
  for (let y = minY; y <= maxY; y++) {
    const xs = [];
    for (let e = 0; e < 4; e++) {
      const a = p[e], b = p[(e + 1) % 4];
      if ((a.py <= y) !== (b.py <= y)) {
        const t = (y - a.py) / (b.py - a.py);
        xs.push({ x: a.px + (b.px - a.px) * t, u: uvs[e][0] + (uvs[(e + 1) % 4][0] - uvs[e][0]) * t, v: uvs[e][1] + (uvs[(e + 1) % 4][1] - uvs[e][1]) * t });
      }
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a.x - b.x);
    const L = xs[0], R = xs[xs.length - 1];
    const x0 = Math.max(0, Math.floor(L.x)), x1 = Math.min(outSize - 1, Math.ceil(R.x));
    for (let x = x0; x <= x1; x++) {
      const t = (x - L.x) / (R.x - L.x || 1);
      const c = sample(tile, tileSize, L.u + (R.u - L.u) * t, L.v + (R.v - L.v) * t);
      const o = (y * outSize + x) * 4;
      out[o] = c[0] * shade; out[o + 1] = c[1] * shade; out[o + 2] = c[2] * shade;
      out[o + 3] = 255;
    }
  }
}
