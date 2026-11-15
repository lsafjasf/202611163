import test from "node:test";
import assert from "node:assert/strict";
import {
  createBoundaryModel,
  createDefaultModel,
  resizeModel
} from "../src/model.js";
import { buildScene } from "../src/scene.js";
import { constrainElement, validateScene } from "../src/validation.js";
import { History } from "../src/history.js";
import {
  addPngMetadata,
  crc32,
  parsePngMetadata,
  sceneToSvg,
  svgModelFromText
} from "../src/exporters.js";
import { cloneModel } from "../src/model.js";
import { measureSignature, mulberry32, utf8ToBase64 } from "../src/util.js";

const measurer = {
  measureText(char) {
    return {
      width: char === " " ? 5 : 10,
      actualBoundingBoxAscent: 7,
      actualBoundingBoxDescent: 2
    };
  }
};

test("PRNG is deterministic and seed-dependent", () => {
  const a = Array.from({ length: 8 }, mulberry32(123));
  const b = Array.from({ length: 8 }, mulberry32(123));
  const c = Array.from({ length: 8 }, mulberry32(124));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test("default case passes validation and keeps arc glyphs complete", () => {
  const model = createDefaultModel();
  const scene = buildScene(model, measurer);
  assert.equal(scene.groups.length, 8);
  assert.equal(validateScene(scene).filter((issue) => issue.level === "error").length, 0);
  const arc = scene.groups.find((group) => group.id === "arc-top");
  const visibleChars = Array.from(arc.element.text).filter((char) => char.trim()).length;
  assert.equal(arc.drawables.length, visibleChars);
});

test("different seeds produce visibly different wear signatures", () => {
  const first = createDefaultModel();
  const second = createDefaultModel();
  first.style.seed = 101;
  second.style.seed = 202;
  const a = buildScene(first, measurer).wear.spots;
  const b = buildScene(second, measurer).wear.spots;
  assert.notEqual(measureSignature(a), measureSignature(b));
});

test("boundary case reports tiny canvas and arc overflow with repair hints", () => {
  const issues = validateScene(buildScene(createBoundaryModel(), measurer));
  for (const code of ["SMALL_DOCUMENT", "ARC_OVERFLOW", "TEXT_TOO_SMALL"]) {
    const item = issues.find((issue) => issue.code === code);
    assert.ok(item, `${code} should be present`);
    assert.ok(item.fix.length > 8);
  }
});

test("gap cutting the date is rejected", () => {
  const model = createDefaultModel();
  const inner = model.elements.find((element) => element.id === "inner-ring");
  inner.gapAngle = 0;
  inner.gapSize = 14;
  const date = model.elements.find((element) => element.id === "date-text");
  date.transform.x = 203;
  date.transform.y = 0;
  const issues = validateScene(buildScene(model, measurer));
  assert.ok(issues.some((issue) => issue.code === "GAP_CUTS_DATE"));
});

test("moving an element far outside clamps it back into the safe area", () => {
  const model = createDefaultModel();
  const date = model.elements.find((element) => element.id === "date-text");
  date.transform.x = 900;
  date.transform.y = 900;
  const constrained = constrainElement(model, measurer, date.id);
  const scene = buildScene(constrained.model, measurer);
  const safe = scene.width / 2 - scene.model.document.safeMargin;
  assert.ok(constrained.adjusted);
  assert.ok(scene.byElement["date-text"].maxRadius <= safe + 0.5);
});

test("resizing the document scales the design without losing elements", () => {
  const model = createDefaultModel();
  const resized = resizeModel(model, 360);
  assert.equal(resized.document.size, 360);
  assert.equal(resized.elements.length, model.elements.length);
  const originalRadius = model.elements.find((element) => element.id === "outer-ring").radius;
  const resizedRadius = resized.elements.find((element) => element.id === "outer-ring").radius;
  assert.equal(resizedRadius, originalRadius / 2);
});

test("history restores the exact previous model", () => {
  const model = createDefaultModel();
  const history = new History();
  const next = cloneModel(model);
  next.elements.find((element) => element.id === "center-text").text = "改变";
  history.record(model, "修改主字");
  const undone = history.undo(next);
  assert.equal(undone.model.elements.find((element) => element.id === "center-text").text, "臻品");
  const redone = history.redo(undone.model);
  assert.equal(redone.model.elements.find((element) => element.id === "center-text").text, "改变");
});

test("SVG keeps text, editable paths, embedded fonts and model metadata", () => {
  const model = createDefaultModel();
  const scene = buildScene(model, measurer);
  const svg = sceneToSvg(scene, {
    fontData: {
      serif: { family: "Stamp Serif", dataUrl: "data:font/woff2;base64,AA==" }
    }
  });
  assert.match(svg, /<text /);
  assert.match(svg, /@font-face/);
  assert.match(svg, /<mask id="wear-mask"/);
  const restored = svgModelFromText(svg);
  assert.equal(restored.style.seed, model.style.seed);
});

test("PNG metadata round-trips the complete model", async () => {
  const onePixelPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lYQ5SAAAAABJRU5ErkJggg==",
    "base64"
  );
  const model = createDefaultModel();
  const tagged = await addPngMetadata(new Blob([onePixelPng], { type: "image/png" }), {
    StampModel: utf8ToBase64(JSON.stringify(model))
  });
  const fields = parsePngMetadata(new Uint8Array(await tagged.arrayBuffer()));
  assert.equal(JSON.parse(atob(fields.StampModel)).style.seed, model.style.seed);
});

test("CRC32 matches the standard test vector", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});
