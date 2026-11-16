import test from "node:test";
import assert from "node:assert/strict";
import {
  PRESETS,
  SHAPE_OPTIONS,
  buildScene,
  createDefaultState,
  createNarrowBoundaryState,
  getFont,
  normalizeState,
  validateScene
} from "../src/model.js";
import {
  buildEditableSvg,
  embedPngProjectMetadata
} from "../src/exporter.js";

test("default case passes safety, closure and adjacent-color checks", () => {
  const state = createDefaultState();
  const scene = buildScene(state);
  const result = validateScene(scene);
  assert.equal(result.ok, true);
  assert.equal(scene.stats.adjacentRepeats, 0);
  assert.equal(scene.stats.outerRingClosed, true);
  assert.ok(scene.stats.totalCells > 100);
  assert.ok(scene.typography.bounds.left >= scene.safeRect.left);
  assert.ok(scene.typography.bounds.right <= scene.safeRect.right);
  assert.ok(scene.typography.bounds.bottom <= scene.safeRect.bottom);
});

test("narrow boundary case keeps a closed outer ring at 360 x 720", () => {
  const state = createNarrowBoundaryState();
  const scene = buildScene(state);
  const result = validateScene(scene);
  assert.equal(result.ok, true);
  assert.equal(state.canvas.width, 360);
  assert.equal(scene.stats.outerRingClosed, true);
  assert.equal(scene.stats.adjacentRepeats, 0);
  assert.ok(scene.stats.totalCells > 150);
});

test("extreme small canvas remains valid without dropping geometry", () => {
  const state = createDefaultState();
  state.canvas = { width: 240, height: 360, safeMargin: 12 };
  state.window = {
    ...state.window,
    rings: 14,
    pieceSize: 0.18,
    border: 1.5,
    scale: 0.9,
    shape: "sunburst"
  };
  state.typography = {
    ...state.typography,
    title: "微",
    subtitle: "MINI",
    footer: "",
    fontSize: 10,
    subtitleSize: 5,
    footerSize: 5
  };
  const scene = buildScene(state);
  const result = validateScene(scene);
  assert.equal(result.ok, true);
  assert.equal(scene.stats.outerRingClosed, true);
  assert.ok(scene.stats.totalCells > 300);
  assert.equal(scene.stats.adjacentRepeats, 0);
});

test("long text is reported with an actionable font-size repair", () => {
  const state = PRESETS.find((preset) => preset.id === "overflow-check").create();
  const scene = buildScene(state);
  const result = validateScene(scene);
  assert.equal(result.ok, false);
  const overflow = result.errors.find((error) => error.code === "TEXT_OVERFLOW");
  assert.ok(overflow);
  assert.match(overflow.fix, /字号/);
  assert.ok(result.errors.some((error) => error.code === "TEXT_OUTSIDE_SAFE_SUBTITLE"));
  assert.throws(
    () => buildEditableSvg(state),
    (error) => error.validation?.ok === false
  );
});

test("all shapes and ring extremes keep the outer ring closed", () => {
  for (const shape of SHAPE_OPTIONS) {
    for (const rings of [2, 14]) {
      const state = createDefaultState();
      state.window.shape = shape.id;
      state.window.rings = rings;
      state.window.pieceSize = 0.18;
      state.window.border = 1.5;
      const scene = buildScene(state);
      assert.equal(scene.stats.outerRingClosed, true, `${shape.id}/${rings}`);
      assert.equal(scene.stats.adjacentRepeats, 0, `${shape.id}/${rings}`);
    }
  }
});

test("movement, scaling and rearrangement are checked against the safe area", () => {
  const moved = createDefaultState();
  moved.typography.offsetY = 360;
  const movedResult = validateScene(buildScene(moved));
  assert.equal(movedResult.ok, false);
  assert.ok(movedResult.errors.some((error) => error.code.startsWith("TEXT_OUTSIDE_SAFE")));

  const scaled = createDefaultState();
  scaled.window.scale = 1.12;
  const scaledResult = validateScene(buildScene(scaled));
  assert.equal(scaledResult.ok, false);
  assert.ok(scaledResult.errors.some((error) => error.code === "WINDOW_OUTSIDE_SAFE"));

  const rearranged = createDefaultState();
  rearranged.typography.layout = "compact";
  const rearrangedScene = buildScene(rearranged);
  const rearrangedResult = validateScene(rearrangedScene);
  assert.equal(rearrangedResult.ok, true);
  assert.ok(rearrangedScene.typography.bounds.bottom <= rearrangedScene.safeRect.bottom);
});

test("editable SVG keeps vector paths, text, image and complete metadata", () => {
  const state = createDefaultState();
  state.image = {
    ...state.image,
    dataUrl: "data:image/png;base64,iVBORw0KGgo=",
    name: "test.png"
  };
  const result = buildEditableSvg(state);
  assert.match(result.svg, /<path class="glass-cell"/);
  assert.match(result.svg, /<text class="editable-text/);
  assert.match(result.svg, /<image href="data:image\/png/);
  assert.doesNotMatch(result.svg, /<canvas/);
  assert.match(result.svg, /<metadata id="aurelia-project"/);
  const metadataXml = result.svg.match(/<metadata id="aurelia-project"[^>]*>(.*?)<\/metadata>/s)?.[1];
  const metadata = JSON.parse(
    metadataXml
      .replaceAll("&quot;", '"')
      .replaceAll("&apos;", "'")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&amp;", "&")
  );
  assert.equal(metadata.state.templateId, "dawn-rose");
  assert.equal(metadata.state.light.keyframes.length, 3);
  assert.equal((result.svg.match(/<text class="editable-text/g) || []).length, 3);
});

test("templates, custom fonts, images and keyframes survive a JSON round trip", () => {
  const state = createDefaultState();
  state.templateId = "narrow-choir";
  state.typography = {
    ...state.typography,
    fontId: "custom",
    customFont: {
      name: "Studio Font",
      family: "AureliaCustom_42",
      dataUrl: "data:font/woff2;base64,AAAA"
    }
  };
  state.image = {
    ...state.image,
    dataUrl: "data:image/png;base64,AAAA",
    name: "projection.png"
  };
  state.light.keyframes[0] = {
    ...state.light.keyframes[0],
    x: 0.88,
    intensity: 0.41
  };
  const restored = normalizeState(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.templateId, "narrow-choir");
  assert.equal(restored.typography.customFont.name, "Studio Font");
  assert.equal(restored.typography.fontId, "custom");
  assert.equal(restored.image.name, "projection.png");
  assert.equal(restored.light.keyframes[0].x, 0.88);
  assert.equal(restored.light.keyframes[0].intensity, 0.41);
  assert.equal(restored.light.keyframes.length, 3);
  assert.match(getFont(restored).family, /AureliaCustom_42/);
});

test("PNG metadata writer preserves image bytes and embeds project JSON", async () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lM2nWQAAAABJRU5ErkJggg==",
    "base64"
  );
  const output = await embedPngProjectMetadata(
    new Blob([png], { type: "image/png" }),
    "aurelia:project",
    JSON.stringify({ title: "晨光玫瑰", keyframes: 3 })
  );
  const bytes = Buffer.from(await output.arrayBuffer());
  assert.equal(bytes.subarray(1, 4).toString(), "PNG");
  assert.ok(bytes.includes(Buffer.from("iTXt")));
  assert.ok(bytes.includes(Buffer.from("aurelia:project")));
  assert.ok(bytes.includes(Buffer.from('"title":"晨光玫瑰"')));
  assert.ok(bytes.includes(Buffer.from("IEND")));
});
