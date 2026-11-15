import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDieline,
  artworkBoundsIssues,
  elementBoxMm,
  normalizeArtwork,
  resizeElementFromHandle,
  setElementCenterMm,
  validateClosedGeometry,
} from "../src/geometry.js";
import {
  createBoundaryState,
  createDefaultState,
  restoreState,
} from "../src/model.js";
import { createScene } from "../src/scene.js";
import { exportSvg } from "../src/svg.js";
import { autoFitState, validateForExport } from "../src/checks.js";

test("default net closes with four panels and a glue tongue", () => {
  const state = createDefaultState();
  const dieline = buildDieline(state);
  assert.equal(dieline.panels.length, 4);
  assert.equal(dieline.topFlaps.length, 4);
  assert.equal(dieline.bottomFlaps.length, 4);
  assert.equal(dieline.netWidth, state.structure.glueTab + 2 * 320 + 2 * 220);
  assert.equal(dieline.netHeight, state.dimensions.height + state.dimensions.width);
  assert.equal(dieline.closure.isClosed, true);
  assert.equal(validateClosedGeometry(state).closed, true);
});

test("all associated faces update when dimensions change", () => {
  const state = createDefaultState();
  const before = buildDieline(state);
  state.dimensions.length = 410;
  state.dimensions.width = 170;
  state.dimensions.height = 95;
  const after = buildDieline(state);
  assert.notEqual(before.panels.find((p) => p.id === "front").w, after.panels.find((p) => p.id === "front").w);
  assert.notEqual(before.panels.find((p) => p.id === "sideLeft").w, after.panels.find((p) => p.id === "sideLeft").w);
  assert.equal(after.topFlaps[0].h, 85);
  assert.equal(after.netHeight, 95 + 170);
  normalizeArtwork(state);
  assert.deepEqual(artworkBoundsIssues(state), []);
});

test("move, resize and reorder keep artwork inside safe areas", () => {
  const state = createDefaultState();
  const dieline = buildDieline(state);
  const target = state.artwork.find((element) => element.id === "art-wordmark");
  const moved = setElementCenterMm(target, dieline, 9999, -9999);
  const index = state.artwork.findIndex((element) => element.id === target.id);
  state.artwork[index] = moved;
  let box = elementBoxMm(moved, dieline);
  assert.ok(box.x >= box.safe.x - 0.01);
  assert.ok(box.y >= box.safe.y - 0.01);
  assert.ok(box.x + box.w <= box.safe.x + box.safe.w + 0.01);
  assert.ok(box.y + box.h <= box.safe.y + box.safe.h + 0.01);

  const resized = resizeElementFromHandle(moved, 4, 4, "se");
  state.artwork[index] = resized;
  box = elementBoxMm(resized, dieline);
  assert.ok(box.x + box.w <= box.safe.x + box.safe.w + 0.01);
  assert.ok(box.y + box.h <= box.safe.y + box.safe.h + 0.01);

  const beforeOrder = state.artwork.map((element) => element.id);
  state.artwork.push(state.artwork.shift());
  normalizeArtwork(state);
  assert.notDeepEqual(
    state.artwork.map((element) => element.id),
    beforeOrder,
  );
  assert.deepEqual(artworkBoundsIssues(state), []);
});

test("boundary case reports overflow with actionable fixes and auto-fit preserves all text", () => {
  const state = createBoundaryState();
  const scene = createScene(state, 1400, 900);
  const validation = validateForExport(state, scene);
  assert.equal(validation.ok, false);
  const textIssues = validation.issues.filter((issue) => issue.code === "text-overflow");
  assert.ok(textIssues.length >= 2);
  assert.match(textIssues[0].fix, /Auto-fit|font size|shorten/i);

  const result = autoFitState(state, 1400, 900);
  assert.equal(result.validation.ok, true);
  assert.ok(result.notes.length >= 1);
  assert.deepEqual(result.state.dimensions, { length: 46, width: 34, height: 24 });
  assert.equal(result.state.artwork.length, 2);
});

test("SVG export keeps editable text, editable shapes and box parameters", () => {
  const state = createDefaultState();
  const svg = exportSvg(state, { width: 1400, height: 900 });
  assert.match(svg, /<svg[^>]+data-box-length="320"/);
  assert.match(svg, /<text[^>]+data-element-id="art-wordmark"/);
  assert.match(svg, /<rect[^>]+data-type="rule"/);
  assert.match(svg, /<g id="fold-lines"/);
  assert.match(svg, /<metadata id="crease-parameters">/);
  assert.match(svg, /"foldKeyframes"/);
  assert.match(svg, /"safeMargin": 7/);
  assert.doesNotMatch(svg, /data:image\/png;base64,[A-Za-z0-9+/]{5000}/);
});

test("template, custom font and keyframes restore consistently", () => {
  const state = createDefaultState();
  state.template = "saved-font-template";
  state.typography.customFont = {
    name: "Crease Demo",
    dataUrl: "data:font/woff2;base64,ZGVtbw==",
  };
  state.typography.family = "Crease Demo";
  state.foldKeyframes = [
    { id: "flat", label: "Flat", progress: 0 },
    { id: "check", label: "Check", progress: 37 },
    { id: "closed", label: "Closed", progress: 100 },
  ];
  const restored = restoreState(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.template, "saved-font-template");
  assert.equal(restored.typography.customFont.name, "Crease Demo");
  assert.equal(restored.typography.customFont.dataUrl, state.typography.customFont.dataUrl);
  assert.deepEqual(restored.foldKeyframes, state.foldKeyframes);
});

test("embedded images survive save/restore and remain native SVG image nodes", () => {
  const state = createDefaultState();
  const src =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=";
  state.images.push({ id: "img-1", name: "swatch.png", src });
  state.artwork.push({
    id: "art-image",
    type: "image",
    name: "Swatch",
    panel: "front",
    x: 0.5,
    y: 0.5,
    w: 0.2,
    h: 0.2,
    src,
    rotation: 0,
    opacity: 1,
    visible: true,
  });
  const restored = restoreState(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.images[0].src, src);
  const svg = exportSvg(restored, { width: 1400, height: 900 });
  assert.match(svg, /<image[^>]+data-type="image"[^>]+href="data:image\/png;base64/);
});

test("tiny dimensions are rejected with a specific repair instruction", () => {
  const state = createDefaultState();
  state.dimensions = { length: 5, width: 5, height: 5 };
  state.structure.safeMargin = 20;
  const scene = createScene(state, 1000, 700);
  const validation = validateForExport(state, scene);
  assert.equal(validation.ok, false);
  assert.ok(validation.issues.some((issue) => issue.code === "dimension-length"));
  assert.ok(validation.issues.some((issue) => /at least 20 mm/i.test(issue.fix)));
});
