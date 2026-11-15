import { LIMITS, PANEL_META } from "./model.js";

export const EPSILON = 0.001;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

export function round(value, places = 2) {
  const p = 10 ** places;
  return Math.round(value * p) / p;
}

export function mm(value) {
  return `${round(value, 1)} mm`;
}

export function panelRect(panel, dieline) {
  return dieline.panels.find((item) => item.id === panel) || dieline.panels[1];
}

export function safeRectForPanel(panel, dieline) {
  return panelRect(panel, dieline).safe;
}

export function buildDieline(state) {
  const length = Number(state.dimensions.length);
  const width = Number(state.dimensions.width);
  const height = Number(state.dimensions.height);
  const glueTab = clamp(
    Number(state.structure.glueTab) || 0,
    LIMITS.glueTab.min,
    LIMITS.glueTab.max,
  );
  const margin = clamp(
    Number(state.structure.safeMargin) || 0,
    LIMITS.safeMargin.min,
    LIMITS.safeMargin.max,
  );
  const foldWidth = clamp(
    Number(state.structure.foldLineWidth) || 0.35,
    LIMITS.foldLineWidth.min,
    LIMITS.foldLineWidth.max,
  );
  const flapHeight = width / 2;
  const bodyY = flapHeight;
  const netWidth = glueTab + width + length + width + length;
  const netHeight = height + flapHeight * 2;
  const tabNotch = Math.min(glueTab * 0.42, height * 0.16);

  const columns = [
    { id: "sideLeft", x: glueTab, width },
    { id: "front", x: glueTab + width, width: length },
    { id: "sideRight", x: glueTab + width + length, width },
    { id: "back", x: glueTab + width + length + width, width: length },
  ];

  const panels = columns.map((column) => {
    const inset = Math.min(
      margin,
      Math.max(0.8, (column.width - 1) / 2),
      Math.max(0.8, (height - 1) / 2),
    );
    const rect = {
      id: column.id,
      label: PANEL_META[column.id].label,
      x: column.x,
      y: bodyY,
      w: column.width,
      h: height,
    };
    return {
      ...rect,
      safe: {
        x: column.x + inset,
        y: bodyY + inset,
        w: Math.max(0.2, column.width - inset * 2),
        h: Math.max(0.2, height - inset * 2),
        inset,
      },
    };
  });

  const boundaryCuts = columns.slice(1).map((column) => column.x);
  const folds = [
    { x1: glueTab, y1: bodyY, x2: glueTab, y2: bodyY + height, axis: "v", kind: "glue" },
    ...boundaryCuts.map((x) => ({
      x1: x,
      y1: bodyY,
      x2: x,
      y2: bodyY + height,
      axis: "v",
      kind: "panel",
    })),
    { x1: glueTab, y1: bodyY, x2: netWidth, y2: bodyY, axis: "h", kind: "flap" },
    {
      x1: glueTab,
      y1: bodyY + height,
      x2: netWidth,
      y2: bodyY + height,
      axis: "h",
      kind: "flap",
    },
  ];

  const cuts = [
    ...boundaryCuts.flatMap((x) => [
      { x1: x, y1: 0, x2: x, y2: bodyY, axis: "v" },
      { x1: x, y1: bodyY + height, x2: x, y2: netHeight, axis: "v" },
    ]),
  ];

  const outline = [
    { x: 0, y: bodyY + tabNotch },
    { x: glueTab * 0.46, y: bodyY },
    { x: glueTab, y: bodyY },
    { x: glueTab, y: 0 },
    { x: netWidth, y: 0 },
    { x: netWidth, y: netHeight },
    { x: glueTab, y: netHeight },
    { x: glueTab, y: bodyY + height },
    { x: glueTab * 0.46, y: bodyY + height },
    { x: 0, y: bodyY + height - tabNotch },
  ];

  const topFlaps = columns.map((column) => ({
    panel: column.id,
    x: column.x,
    y: 0,
    w: column.width,
    h: flapHeight,
  }));
  const bottomFlaps = columns.map((column) => ({
    panel: column.id,
    x: column.x,
    y: bodyY + height,
    w: column.width,
    h: flapHeight,
  }));

  const closure = {
    seamOverlap: glueTab,
    topSeam: 0,
    bottomSeam: 0,
    verticalSeam: 0,
    flaps: topFlaps.length + bottomFlaps.length,
    perimeter: 2 * (length + width),
    isClosed: glueTab >= LIMITS.glueTab.min && length > 0 && width > 0,
  };

  return {
    length,
    width,
    height,
    glueTab,
    foldWidth,
    margin,
    flapHeight,
    bodyY,
    netWidth,
    netHeight,
    tabNotch,
    panels,
    topFlaps,
    bottomFlaps,
    folds,
    cuts,
    outline,
    closure,
    userUnits: "mm",
  };
}

export function geometryIssues(state) {
  const issues = [];
  const d = state.dimensions;
  const structure = state.structure;
  [
    ["length", "Length"],
    ["width", "Width"],
    ["height", "Height"],
  ].forEach(([key, label]) => {
    const value = Number(d[key]);
    const limit = LIMITS[key];
    if (!Number.isFinite(value) || value < limit.min) {
      issues.push({
        level: "error",
        code: `dimension-${key}`,
        title: `${label} is too small`,
        detail: `${label} must be at least ${limit.min} mm. Increase it in Box dimensions.`,
        fix: `Set ${label.toLowerCase()} to at least ${limit.min} mm.`,
      });
    } else if (value > limit.max) {
      issues.push({
        level: "error",
        code: `dimension-${key}`,
        title: `${label} is too large`,
        detail: `${label} must stay below ${limit.max} mm for this production profile.`,
        fix: `Lower ${label.toLowerCase()} to ${limit.max} mm or choose a larger profile.`,
      });
    }
  });

  const minFace = Math.min(Number(d.length), Number(d.width), Number(d.height));
  if (Number(structure.safeMargin) * 2.4 > minFace) {
    issues.push({
      level: "warning",
      code: "safe-margin",
      title: "Safe margin is unusually large",
      detail: "Artwork has very little printable area on the narrowest face.",
      fix: "Reduce the safe margin or increase the smallest box dimension.",
    });
  }
  if (Number(structure.glueTab) < LIMITS.glueTab.min) {
    issues.push({
      level: "error",
      code: "glue-tab",
      title: "Glue tongue is too narrow",
      detail: "A tongue under 8 mm cannot form a reliable closed seam.",
      fix: "Increase the glue tongue to at least 8 mm.",
    });
  }
  return issues;
}

export function normalizeElement(element) {
  const next = { ...element };
  next.w = clamp(Number(next.w) || 0.1, 0.035, 1);
  next.h = clamp(Number(next.h) || 0.1, 0.02, 1);
  next.x = clamp(Number(next.x) || 0.5, next.w / 2, 1 - next.w / 2);
  next.y = clamp(Number(next.y) || 0.5, next.h / 2, 1 - next.h / 2);
  return next;
}

export function normalizeArtwork(state) {
  state.artwork = state.artwork.map(normalizeElement);
  return state;
}

export function elementBoxMm(element, dieline) {
  const safe = safeRectForPanel(element.panel, dieline);
  const bounds = normalizeElement(element);
  return {
    x: safe.x + (bounds.x - bounds.w / 2) * safe.w,
    y: safe.y + (bounds.y - bounds.h / 2) * safe.h,
    w: bounds.w * safe.w,
    h: bounds.h * safe.h,
    safe,
    panel: panelRect(element.panel, dieline),
  };
}

function outside(rect, safe, tolerance = EPSILON) {
  return (
    rect.x < safe.x - tolerance ||
    rect.y < safe.y - tolerance ||
    rect.x + rect.w > safe.x + safe.w + tolerance ||
    rect.y + rect.h > safe.y + safe.h + tolerance
  );
}

export function artworkBoundsIssues(state) {
  const dieline = buildDieline(state);
  const issues = [];
  state.artwork.forEach((element) => {
    if (element.visible === false) return;
    const bounds = elementBoxMm(element, dieline);
    if (outside(bounds, bounds.safe, 0.01)) {
      issues.push({
        level: "error",
        code: "artwork-outside",
        elementId: element.id,
        title: `${element.name || "Artwork"} left its safe area`,
        detail: "An element is partially outside the printable area of its panel.",
        fix: "Select the layer and use Keep inside, or reduce its size.",
      });
    }
  });
  return issues;
}

export function pointInRect(x, y, rect) {
  return x >= rect.x && y >= rect.y && x <= rect.x + rect.w && y <= rect.y + rect.h;
}

export function setElementCenterMm(element, dieline, centerX, centerY) {
  const safe = safeRectForPanel(element.panel, dieline);
  const next = normalizeElement(element);
  next.x = clamp((centerX - safe.x) / safe.w, next.w / 2, 1 - next.w / 2);
  next.y = clamp((centerY - safe.y) / safe.h, next.h / 2, 1 - next.h / 2);
  return next;
}

export function resizeElementFromHandle(element, nx, ny, handle) {
  const next = { ...element };
  const centerX = next.x;
  const centerY = next.y;
  const left = centerX - next.w / 2;
  const right = centerX + next.w / 2;
  const top = centerY - next.h / 2;
  const bottom = centerY + next.h / 2;
  const west = handle.includes("w");
  const north = handle.includes("n");
  let newLeft = west ? clamp(nx, 0, right - 0.035) : left;
  let newRight = west ? right : clamp(nx, left + 0.035, 1);
  let newTop = north ? clamp(ny, 0, bottom - 0.02) : top;
  let newBottom = north ? bottom : clamp(ny, top + 0.02, 1);

  if (handle === "e" || handle === "w") {
    newTop = top;
    newBottom = bottom;
  }
  if (handle === "n" || handle === "s") {
    newLeft = left;
    newRight = right;
  }

  next.x = (newLeft + newRight) / 2;
  next.y = (newTop + newBottom) / 2;
  next.w = Math.max(0.035, newRight - newLeft);
  next.h = Math.max(0.02, newBottom - newTop);
  return normalizeElement(next);
}

export function validateClosedGeometry(state) {
  const dieline = buildDieline(state);
  const bodyColumns = dieline.panels.reduce((sum, panel) => sum + panel.w, 0);
  const expected = 2 * (dieline.length + dieline.width);
  const errors = [];
  if (Math.abs(bodyColumns - expected) > EPSILON) {
    errors.push("Panel widths do not equal the folded body perimeter.");
  }
  if (Math.abs(dieline.closure.seamOverlap - dieline.glueTab) > EPSILON) {
    errors.push("Glue seam overlap does not match the tongue width.");
  }
  return {
    closed: errors.length === 0 && dieline.closure.isClosed,
    bodyColumns,
    expected,
    errors,
  };
}

export function scaleStateForPreset(state, key) {
  const value = Number(state[key]);
  return clamp(value, LIMITS[key].min, LIMITS[key].max);
}
