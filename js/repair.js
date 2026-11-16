// Local repair strokes in tile space [0,1). Strokes near an edge are
// mirrored to the opposite edge(s) so the tile stays seamless.

// Expand a stroke into the set of wrapped positions that intersect the tile.
export function expandStroke(stroke) {
  const { x, y, r } = stroke;
  const out = [];
  for (const dx of [-1, 0, 1]) {
    for (const dy of [-1, 0, 1]) {
      const cx = x + dx, cy = y + dy;
      if (cx + r > 0 && cx - r < 1 && cy + r > 0 && cy - r < 1) {
        out.push({ x: cx, y: cy, r, strength: stroke.strength });
      }
    }
  }
  return out;
}

// Wrapped box blur (radius in px) so repairs heal toward the local average
// without breaking edge continuity.
export function wrapBlur(data, size, radius) {
  const out = new Uint8ClampedArray(data.length);
  const win = radius * 2 + 1;
  const area = win * win;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let r = 0, g = 0, b = 0;
      for (let oy = -radius; oy <= radius; oy++) {
        const y = (j + oy + size) % size;
        for (let ox = -radius; ox <= radius; ox++) {
          const x = (i + ox + size) % size;
          const o = (y * size + x) * 4;
          r += data[o]; g += data[o + 1]; b += data[o + 2];
        }
      }
      const o = (j * size + i) * 4;
      out[o] = r / area; out[o + 1] = g / area; out[o + 2] = b / area;
      out[o + 3] = 255;
    }
  }
  return out;
}

// Apply strokes (each {x,y,r,strength} in tile units) onto RGBA tile data.
export function applyRepairs(data, size, strokes) {
  if (!strokes.length) return data;
  const maxR = Math.max(...strokes.map(s => s.r));
  const healed = wrapBlur(data, size, Math.max(2, Math.round(maxR * size)));
  const out = new Uint8ClampedArray(data);
  for (const stroke of strokes) {
    for (const s of expandStroke(stroke)) {
      const cx = s.x * size, cy = s.y * size, rp = s.r * size;
      const x0 = Math.max(0, Math.floor(cx - rp)), x1 = Math.min(size - 1, Math.ceil(cx + rp));
      const y0 = Math.max(0, Math.floor(cy - rp)), y1 = Math.min(size - 1, Math.ceil(cy + rp));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / rp;
          if (d >= 1) continue;
          const w = (1 - d * d) * s.strength;
          const o = (y * size + x) * 4;
          for (let k = 0; k < 3; k++) {
            out[o + k] = out[o + k] * (1 - w) + healed[o + k] * w;
          }
        }
      }
    }
  }
  return out;
}
