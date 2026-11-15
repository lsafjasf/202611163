import {
  artworkBoundsIssues,
  geometryIssues,
  normalizeElement,
} from "./geometry.js";
import { createScene } from "./scene.js";

function textIssuesFromScene(scene) {
  return scene.flat.textIssues.map((element) => {
    const dimensions = [
      element.overflowX ? "width" : null,
      element.overflowY ? "height" : null,
    ]
      .filter(Boolean)
      .join(" and ");
    return {
      level: "error",
      code: "text-overflow",
      elementId: element.id,
      title: `“${element.name || "Text"}” needs ${dimensions || "more space"}`,
      detail:
        "The wrapped text exceeds its editable frame. Export is paused so glyphs cannot be clipped silently.",
      fix: "Use Auto-fit, reduce the font size, enlarge the text frame, or shorten the copy.",
    };
  });
}

export function validateForExport(state, scene) {
  const geometry = geometryIssues(state);
  const bounds = artworkBoundsIssues(state);
  const text = textIssuesFromScene(scene);
  const issues = [...geometry, ...bounds, ...text];
  const errors = issues.filter((issue) => issue.level === "error");
  return {
    ok: errors.length === 0,
    issues,
    errors,
    warnings: issues.filter((issue) => issue.level === "warning"),
  };
}

function estimateScene(state, width, height, measureText) {
  return createScene(state, width, height, { measureText, exportMode: true });
}

export function autoFitState(state, width, height, measureText) {
  let changed = 0;
  let notes = [];

  state.dimensions.length = Math.max(20, Number(state.dimensions.length) || 20);
  state.dimensions.width = Math.max(20, Number(state.dimensions.width) || 20);
  state.dimensions.height = Math.max(20, Number(state.dimensions.height) || 20);
  state.structure.glueTab = Math.max(8, Number(state.structure.glueTab) || 8);
  state.structure.safeMargin = Math.min(
    Number(state.structure.safeMargin) || 3,
    Math.min(state.dimensions.length, state.dimensions.width, state.dimensions.height) / 5,
  );

  state.artwork = state.artwork.map((element) => {
    const next = normalizeElement(element);
    if (next.type !== "text") return next;
    next.w = 0.92;
    next.h = 0.82;
    return normalizeElement(next);
  });

  let scene = estimateScene(state, width, height, measureText);
  let overflowIds = new Set(scene.flat.textIssues.map((element) => element.id));
  const originalSizes = new Map(
    state.artwork
      .filter((element) => element.type === "text")
      .map((element) => [element.id, Number(element.fontSize)]),
  );

  for (let iteration = 0; iteration < 90 && overflowIds.size; iteration += 1) {
    let changedThisRound = false;
    state.artwork = state.artwork.map((element) => {
      if (!overflowIds.has(element.id) || element.type !== "text") return element;
      const next = { ...element, fontSize: Math.max(2.4, (Number(element.fontSize) || 10) * 0.9) };
      if (next.fontSize !== element.fontSize) changedThisRound = true;
      next.letterSpacing = Math.min(Number(next.letterSpacing) || 0, next.fontSize * 0.045);
      return next;
    });
    scene = estimateScene(state, width, height, measureText);
    overflowIds = new Set(scene.flat.textIssues.map((element) => element.id));
    if (!changedThisRound) break;
  }

  state.artwork.forEach((element) => {
    if (element.type !== "text") return;
    const before = originalSizes.get(element.id);
    if (before && Math.abs(before - element.fontSize) > 0.05) {
      changed += 1;
      notes.push(
        `${element.name || "Text"} reduced from ${before.toFixed(1)} mm to ${element.fontSize.toFixed(
          1,
        )} mm to preserve every glyph.`,
      );
    }
  });
  const finalScene = estimateScene(state, width, height, measureText);
  const validation = validateForExport(state, finalScene);
  return { state, scene: finalScene, validation, changed, notes, unresolved: !validation.ok };
}
