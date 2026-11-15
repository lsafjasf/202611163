export const LIMITS = {
  length: { min: 20, max: 900 },
  width: { min: 20, max: 700 },
  height: { min: 20, max: 600 },
  glueTab: { min: 8, max: 60 },
  foldLineWidth: { min: 0.15, max: 1.2 },
  safeMargin: { min: 2, max: 24 },
};

export const PANEL_META = {
  sideLeft: { label: "LEFT SIDE", short: "L" },
  front: { label: "FRONT", short: "F" },
  sideRight: { label: "RIGHT SIDE", short: "R" },
  back: { label: "BACK", short: "B" },
};

export const FONT_OPTIONS = [
  { value: "DejaVu Sans", label: "DejaVu Sans" },
  { value: "DejaVu Serif", label: "DejaVu Serif" },
  { value: "DejaVu Sans Mono", label: "DejaVu Mono" },
  { value: "Ubuntu", label: "Ubuntu" },
];

export const SHAPE_OPTIONS = [
  { value: "rect", label: "Block" },
  { value: "circle", label: "Circle" },
  { value: "diamond", label: "Diamond" },
  { value: "rule", label: "Rule" },
];

const baseText = {
  type: "text",
  rotation: 0,
  opacity: 1,
  letterSpacing: 0,
  align: "center",
  visible: true,
};

export function createDefaultArtwork() {
  return [
    {
      ...baseText,
      id: "art-wordmark",
      name: "Wordmark",
      panel: "front",
      x: 0.5,
      y: 0.2,
      w: 0.74,
      h: 0.28,
      text: "FIELD NOTES",
      fontFamily: "DejaVu Sans",
      fontSize: 29,
      fontWeight: 800,
      color: "#173b32",
      letterSpacing: 0.5,
    },
    {
      id: "art-rule",
      type: "rule",
      name: "Accent rule",
      panel: "front",
      x: 0.5,
      y: 0.36,
      w: 0.5,
      h: 0.018,
      color: "#e4572e",
      rotation: 0,
      opacity: 1,
      visible: true,
    },
    {
      ...baseText,
      id: "art-tagline",
      name: "Front copy",
      panel: "front",
      x: 0.5,
      y: 0.56,
      w: 0.7,
      h: 0.2,
      text: "PACKED WITH CARE\nAND GOOD IDEAS",
      fontFamily: "DejaVu Sans Mono",
      fontSize: 10,
      fontWeight: 600,
      color: "#35574e",
      letterSpacing: 0.35,
    },
    {
      id: "art-disc",
      type: "circle",
      name: "Edition disc",
      panel: "front",
      x: 0.81,
      y: 0.77,
      w: 0.22,
      h: 0.22,
      color: "#f4c95d",
      rotation: -8,
      opacity: 1,
      visible: true,
    },
    {
      ...baseText,
      id: "art-edition",
      name: "Edition number",
      panel: "front",
      x: 0.81,
      y: 0.77,
      w: 0.16,
      h: 0.2,
      text: "01",
      fontFamily: "DejaVu Sans",
      fontSize: 17,
      fontWeight: 800,
      color: "#173b32",
      letterSpacing: 0,
      rotation: -8,
    },
    {
      ...baseText,
      id: "art-side",
      name: "Side label",
      panel: "sideRight",
      x: 0.5,
      y: 0.5,
      w: 0.74,
      h: 0.24,
      text: "AURORA / 01",
      fontFamily: "DejaVu Sans",
      fontSize: 19,
      fontWeight: 800,
      color: "#173b32",
      letterSpacing: 0.8,
      rotation: -90,
    },
    {
      ...baseText,
      id: "art-back-title",
      name: "Back title",
      panel: "back",
      x: 0.5,
      y: 0.43,
      w: 0.62,
      h: 0.58,
      text: "HANDLE\nWITH CARE",
      fontFamily: "DejaVu Sans",
      fontSize: 27,
      fontWeight: 800,
      color: "#173b32",
      letterSpacing: 0,
      rotation: 0,
    },
    {
      ...baseText,
      id: "art-back-note",
      name: "Back note",
      panel: "back",
      x: 0.5,
      y: 0.73,
      w: 0.54,
      h: 0.12,
      text: "MADE TO MOVE · RECYCLE ME",
      fontFamily: "DejaVu Sans Mono",
      fontSize: 7.5,
      fontWeight: 600,
      color: "#35574e",
      letterSpacing: 0.3,
      rotation: 0,
    },
    {
      ...baseText,
      id: "art-left-stamp",
      name: "Left stamp",
      panel: "sideLeft",
      x: 0.5,
      y: 0.67,
      w: 0.5,
      h: 0.12,
      text: "FRAGILE",
      fontFamily: "DejaVu Sans Mono",
      fontSize: 9,
      fontWeight: 700,
      color: "#e4572e",
      letterSpacing: 0.5,
      rotation: -90,
    },
  ];
}

export function createDefaultState() {
  return {
    version: 1,
    template: "default",
    title: "Aurora mailer / 01",
    dimensions: { length: 320, width: 220, height: 140 },
    structure: {
      glueTab: 22,
      foldLineWidth: 0.35,
      safeMargin: 7,
      foldStyle: "dash",
      bleed: 3,
    },
    artwork: createDefaultArtwork(),
    typography: {
      family: "DejaVu Sans",
      customFont: null,
    },
    images: [],
    foldKeyframes: [
      { id: "kf-flat", label: "Flat", progress: 0 },
      { id: "kf-half", label: "Half fold", progress: 55 },
      { id: "kf-closed", label: "Closed", progress: 100 },
    ],
    preview: {
      foldProgress: 100,
      activeKeyframe: "kf-closed",
    },
    view: {
      theme: "paper",
      showSafeAreas: true,
      showDimensions: true,
    },
    updatedAt: new Date().toISOString(),
  };
}

export function createBoundaryState() {
  const state = createDefaultState();
  state.template = "boundary";
  state.title = "Boundary / pocket-size stress test";
  state.dimensions = { length: 46, width: 34, height: 24 };
  state.structure = {
    glueTab: 11,
    foldLineWidth: 0.7,
    safeMargin: 3,
    foldStyle: "dash",
    bleed: 2,
  };
  state.preview.foldProgress = 100;
  state.artwork = [
    {
      ...baseText,
      id: "edge-long-title",
      name: "Long stress copy",
      panel: "front",
      x: 0.5,
      y: 0.5,
      w: 0.72,
      h: 0.45,
      text: "EXTREMELY LONG MICRO PACKAGE WORDMARK THAT WILL NOT FIT",
      fontFamily: "DejaVu Sans",
      fontSize: 18,
      fontWeight: 800,
      color: "#173b32",
      letterSpacing: 0.4,
    },
    {
      ...baseText,
      id: "edge-side",
      name: "Narrow side",
      panel: "sideRight",
      x: 0.5,
      y: 0.5,
      w: 0.8,
      h: 0.25,
      text: "MICRO EDITION · DO NOT CRUSH",
      fontFamily: "DejaVu Sans Mono",
      fontSize: 12,
      fontWeight: 700,
      color: "#e4572e",
      letterSpacing: 0.2,
      rotation: -90,
    },
  ];
  state.foldKeyframes = [
    { id: "kf-flat", label: "Flat", progress: 0 },
    { id: "kf-closed", label: "Closed", progress: 100 },
  ];
  state.preview.activeKeyframe = "kf-closed";
  return state;
}

export const PRESETS = {
  default: {
    label: "Retail mailer",
    detail: "320 × 220 × 140 mm",
    create: createDefaultState,
  },
  boundary: {
    label: "Boundary test",
    detail: "46 × 34 × 24 mm",
    create: createBoundaryState,
  },
};

export function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

export function makeId(prefix = "art") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function restoreState(raw) {
  if (!raw || typeof raw !== "object") return null;
  const base = createDefaultState();
  const merged = {
    ...base,
    ...raw,
    dimensions: { ...base.dimensions, ...(raw.dimensions || {}) },
    structure: { ...base.structure, ...(raw.structure || {}) },
    typography: { ...base.typography, ...(raw.typography || {}) },
    preview: { ...base.preview, ...(raw.preview || {}) },
    view: { ...base.view, ...(raw.view || {}) },
    artwork: Array.isArray(raw.artwork) ? raw.artwork : base.artwork,
    foldKeyframes: Array.isArray(raw.foldKeyframes)
      ? raw.foldKeyframes
      : base.foldKeyframes,
    images: Array.isArray(raw.images) ? raw.images : [],
  };
  return merged;
}
