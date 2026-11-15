import test from "node:test";
import assert from "node:assert/strict";
import {
  createScene,
  applyTemplate,
  resizeScene,
  validateScene,
  autoFixScene,
  rotatedBounds,
  getSafeRect,
  exportProjectJSON,
  parseProjectJSON,
  measureTextElement,
  defaultMeasureText
} from "../js/core.js";
import { buildSVG } from "../js/exporter.js";
import { History } from "../js/history.js";

function insideSafe(scene) {
  const safe = getSafeRect(scene);
  return scene.elements.filter((element) => element.visible).every((element) => {
    const bounds = rotatedBounds(element);
    return bounds.left >= safe.left - 0.51
      && bounds.top >= safe.top - 0.51
      && bounds.right <= safe.right + 0.51
      && bounds.bottom <= safe.bottom + 0.51;
  });
}

test("three template presets pass the default safety check", () => {
  for (const template of ["news", "story", "prompt"]) {
    const scene = createScene({ template });
    const result = validateScene(scene);
    assert.equal(result.errors.length, 0, `${template}: ${result.errors.map((item) => item.message).join("; ")}`);
    assert.ok(insideSafe(scene));
  }
});

test("switching templates keeps every text, custom layer and keyframe", () => {
  const scene = createScene();
  const headline = scene.elements.find((element) => element.id === "headline");
  headline.text = "不会丢失的标题";
  headline.entrance.keyframes[0].y = 44;
  const custom = {
    ...scene.elements.find((element) => element.id === "accent"),
    id: "custom-rule",
    name: "自定义图形",
    x: 110,
    y: 110,
    w: 90,
    h: 8,
    style: { ...scene.elements.find((element) => element.id === "accent").style, fill: "#55d6d0" }
  };
  scene.elements.push(custom);

  applyTemplate(scene, "story");
  applyTemplate(scene, "prompt");
  applyTemplate(scene, "news");

  assert.equal(scene.elements.find((element) => element.id === "headline").text, "不会丢失的标题");
  assert.equal(scene.elements.find((element) => element.id === "headline").entrance.keyframes[0].y, 44);
  assert.equal(scene.elements.find((element) => element.id === "custom-rule").style.fill, "#55d6d0");
});

test("scaling, moving and reordering still use the current safe rectangle", () => {
  const scene = createScene();
  resizeScene(scene, 1920, 1080);
  assert.equal(validateScene(scene).ok, true);
  assert.ok(insideSafe(scene));

  const headline = scene.elements.find((element) => element.id === "headline");
  headline.x = -80;
  const moved = validateScene(scene);
  assert.equal(moved.ok, false);
  assert.ok(moved.errors.some((item) => item.code === "safe-bounds"));
  assert.match(moved.errors.find((item) => item.code === "safe-bounds").fix, /向右移动/);
  const fixed = autoFixScene(scene);
  assert.equal(fixed.validation.ok, true);
  assert.ok(insideSafe(scene));

  const first = scene.elements.shift();
  scene.elements.push(first);
  assert.equal(validateScene(scene).ok, true);
});

test("extreme long text on a tiny canvas reports clipping and auto-fit preserves text", () => {
  const scene = createScene({
    width: 320,
    height: 180,
    safeMargin: 24,
    copy: { headline: "极小尺寸边界文本".repeat(80) }
  });
  const headline = scene.elements.find((element) => element.id === "headline");
  const originalText = headline.text;
  const result = validateScene(scene);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.code === "text-clip-y"));
  const overflowIssue = result.errors.find((item) => item.code === "text-clip-y");
  assert.match(overflowIssue.fix, /增大|减小|换行/);

  const fixed = autoFixScene(scene);
  assert.equal(fixed.validation.ok, true, fixed.validation.errors.map((item) => item.message).join("; "));
  assert.equal(headline.text, originalText);
  assert.ok(insideSafe(scene));
  assert.ok(fixed.notes.some((note) => note.includes("字号")));
});

test("project JSON round-trip restores text, font, image and keyframes", () => {
  const scene = createScene({ template: "story" });
  const headline = scene.elements.find((element) => element.id === "headline");
  headline.text = "保存后仍能完整恢复";
  headline.entrance.preset = "slide";
  headline.entrance.keyframes = [
    { at: 0, x: -90, y: 0, scale: 0.95, opacity: 0 },
    { at: 0.7, x: 4, y: 0, scale: 1.01, opacity: 1 },
    { at: 1, x: 0, y: 0, scale: 1, opacity: 1 }
  ];
  scene.assets.fonts.push({
    name: "测试字体",
    family: "Test Font 1",
    type: "woff2",
    data: "data:font/woff2;base64,d09GMgABAAAAAA=="
  });
  scene.elements.push({
    id: "image-test",
    type: "image",
    name: "测试图片",
    src: "data:image/png;base64,iVBORw0KGgo=",
    x: 100,
    y: 100,
    w: 80,
    h: 60,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    style: { fit: "cover", radius: 8 },
    entrance: {
      preset: "fade",
      duration: 500,
      delay: 0,
      easing: "easeOutCubic",
      keyframes: [{ at: 0, x: 0, y: 0, scale: 1, opacity: 0 }, { at: 1, x: 0, y: 0, scale: 1, opacity: 1 }]
    }
  });
  scene.playheadMs = 1370;
  scene.bpm = 118;
  const restored = parseProjectJSON(exportProjectJSON(scene));
  const restoredHeadline = restored.elements.find((element) => element.id === "headline");
  assert.equal(restoredHeadline.text, "保存后仍能完整恢复");
  assert.deepEqual(restoredHeadline.entrance.keyframes, headline.entrance.keyframes);
  assert.equal(restored.assets.fonts[0].family, "Test Font 1");
  assert.equal(
    restored.elements.find((element) => element.id === "image-test").src,
    scene.elements.find((element) => element.id === "image-test").src
  );
  assert.equal(restored.playheadMs, 1370);
  assert.equal(restored.bpm, 118);
});

test("history supports undo and redo across text and geometry edits", () => {
  const scene = createScene();
  const history = new History(scene);
  const headline = scene.elements.find((element) => element.id === "headline");
  headline.text = "第一步";
  history.commit(scene);
  headline.x += 30;
  headline.text = "第二步";
  history.commit(scene);

  const undone = history.undo();
  assert.equal(undone.elements.find((element) => element.id === "headline").text, "第一步");
  const redone = history.redo();
  assert.equal(redone.elements.find((element) => element.id === "headline").text, "第二步");
});

test("SVG export uses editable text and shape nodes rather than a screenshot", () => {
  const scene = createScene();
  scene.elements.find((element) => element.id === "headline").text = "可编辑 <SVG> & 文本";
  const svg = buildSVG(scene, { measurer: defaultMeasureText, timeMs: scene.playheadMs });
  assert.match(svg, /<svg[^>]+viewBox="0 0 1280 720"/);
  assert.match(svg, /<text /);
  assert.match(svg, /<tspan /);
  assert.match(svg, /<rect /);
  assert.doesNotMatch(svg, /<image[^>]+data:image\/png[^>]+preserveAspectRatio.*(?:full|screen)/i);
  assert.match(svg, /可编辑 &lt;SVG&gt; &amp; 文本/);
  assert.match(svg, /metadata/);
  assert.match(svg, /editable/);
});

test("text metrics report each overflow instead of dropping characters", () => {
  const element = createScene().elements.find((item) => item.id === "headline");
  element.h = 10;
  const metrics = measureTextElement(element, defaultMeasureText);
  assert.equal(metrics.overflowY, true);
  assert.ok(metrics.lines.join("").length >= element.text.replaceAll("\n", "").length - 2);
});
