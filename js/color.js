export const DEFAULT_ADJUSTMENTS = Object.freeze({
  exposure: 0.18,
  temperature: 14,
  contrast: 8,
  shadowHue: 22,
  shadowStrength: 16,
  highlightHue: 42,
  highlightStrength: 22,
});

const ADJUSTMENT_RANGES = {
  exposure: [-2, 2],
  temperature: [-100, 100],
  contrast: [-100, 100],
  shadowHue: [0, 360],
  shadowStrength: [0, 100],
  highlightHue: [0, 360],
  highlightStrength: [0, 100],
};

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeAdjustments(input = {}) {
  const result = {};
  for (const [key, [min, max]] of Object.entries(ADJUSTMENT_RANGES)) {
    const value = Number(input[key]);
    result[key] = Number.isFinite(value)
      ? clamp(value, min, max)
      : DEFAULT_ADJUSTMENTS[key];
  }
  return result;
}

export function hueToRgb(hue) {
  const h = ((Number(hue) || 0) % 360 + 360) % 360;
  const c = 1;
  const x = 1 - Math.abs((h / 60) % 2 - 1);
  const sector = Math.floor(h / 60) % 6;
  const rgb = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][sector];
  const m = 0;
  return rgb.map((channel) => Math.round((channel + m) * 255));
}

export function hueToHex(hue) {
  return `#${hueToRgb(hue).map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function buildChannelLuts(params) {
  const exposureFactor = 2 ** params.exposure;
  const warmth = params.temperature / 100;
  const contrastFactor = 1 + (params.contrast / 100) * 1.25;
  const gains = [1 + warmth * 0.19, 1 + warmth * 0.018, 1 - warmth * 0.19];
  const luts = [new Float32Array(256), new Float32Array(256), new Float32Array(256)];

  for (let channel = 0; channel < 3; channel += 1) {
    for (let value = 0; value < 256; value += 1) {
      let next = (value / 255) * exposureFactor * gains[channel];
      next = (next - 0.5) * contrastFactor + 0.5;
      luts[channel][value] = next * 255;
    }
  }
  return luts;
}

export function createGradeTables(input) {
  const params = normalizeAdjustments(input);
  const luts = buildChannelLuts(params);
  const shadowTint = hueToRgb(params.shadowHue);
  const highlightTint = hueToRgb(params.highlightHue);
  const shadowOffsets = shadowTint.map((value) => ((value - 128) / 127) * 48);
  const highlightOffsets = highlightTint.map((value) => ((value - 128) / 127) * 38);
  return {
    params,
    luts,
    shadowOffsets,
    highlightOffsets,
    shadowStrength: params.shadowStrength / 100,
    highlightStrength: params.highlightStrength / 100,
  };
}

export function gradeRgbaWithTables(red, green, blue, tables) {
  const r = tables.luts[0][red];
  const g = tables.luts[1][green];
  const b = tables.luts[2][blue];
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const shadowWeight =
    tables.shadowStrength * (1 - smoothstep(0.1, 0.7, luma)) * 0.78;
  const highlightWeight =
    tables.highlightStrength * smoothstep(0.45, 0.96, luma) * 0.66;

  return [
    clamp(
      r + tables.shadowOffsets[0] * shadowWeight + tables.highlightOffsets[0] * highlightWeight,
      0,
      255,
    ),
    clamp(
      g + tables.shadowOffsets[1] * shadowWeight + tables.highlightOffsets[1] * highlightWeight,
      0,
      255,
    ),
    clamp(
      b + tables.shadowOffsets[2] * shadowWeight + tables.highlightOffsets[2] * highlightWeight,
      0,
      255,
    ),
  ];
}

export function gradeRgba(red, green, blue, input) {
  return gradeRgbaWithTables(red, green, blue, createGradeTables(input));
}

export function processImageData(imageData, input) {
  const tables = createGradeTables(input);
  const data = imageData.data;
  for (let index = 0; index < data.length; index += 4) {
    const [r, g, b] = gradeRgbaWithTables(
      data[index],
      data[index + 1],
      data[index + 2],
      tables,
    );
    data[index] = r;
    data[index + 1] = g;
    data[index + 2] = b;
  }
  return imageData;
}

export function adjustmentsEqual(left, right) {
  return Object.keys(ADJUSTMENT_RANGES).every(
    (key) => Math.abs(Number(left[key]) - Number(right[key])) < 0.0001,
  );
}

export function adjustmentsFingerprint(input) {
  const params = normalizeAdjustments(input);
  return Object.values(params).map((value) => Number(value).toFixed(3)).join("|");
}
