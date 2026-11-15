import assert from "node:assert/strict";
import test from "node:test";
import { createGradeTables, gradeRgba, processImageData } from "../js/color.js";
import { createSvgMarkup, createPngTextChunk } from "../js/export.js";
import { HistoryStore } from "../js/history.js";
import {
  BUILTIN_PRESETS,
  FONT_OPTIONS,
  createBoundaryState,
  createDefaultState,
  normalizeState,
  snapshotProject,
} from "../js/model.js";
import { autoFitState, validateState } from "../js/render.js";
import {
  createWorkspacePayload,
  loadWorkspace,
  parseWorkspace,
  saveWorkspace,
} from "../js/storage.js";

function fakeMeasureContext() {
  let font = "16px sans-serif";
  let letterSpacing = 0;
  return {
    get font() {
      return font;
    },
    set font(value) {
      font = value;
    },
    get letterSpacing() {
      return String(letterSpacing);
    },
    set letterSpacing(value) {
      letterSpacing = Number.parseFloat(value) || 0;
    },
    save() {},
    restore() {},
    measureText(text) {
      const size = Number.parseFloat(font.match(/(\d+(?:\.\d+)?)px/)?.[1] || "16");
      const width = Array.from(text).reduce((sum, character) => {
        if (/[\u3400-\u9fff]/.test(character)) return sum + size;
        if (character === " ") return sum + size * 0.25;
        return sum + size * 0.56;
      }, 0);
      return { width: width + Math.max(0, Array.from(text).length - 1) * letterSpacing };
    },
  };
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

test("逐像素调色从原始像素重建，重复套用不会累积色差", () => {
  const source = new Uint8ClampedArray([
    24, 31, 44, 255,
    83, 92, 70, 255,
    157, 132, 98, 255,
    231, 210, 179, 255,
  ]);
  const presetA = BUILTIN_PRESETS[0].params;
  const presetB = BUILTIN_PRESETS[2].params;
  const baseA = { data: new Uint8ClampedArray(source), width: 2, height: 2 };
  processImageData(baseA, presetA);
  const first = new Uint8ClampedArray(baseA.data);

  const fromOriginalB = { data: new Uint8ClampedArray(source), width: 2, height: 2 };
  processImageData(fromOriginalB, presetB);
  const expected = new Uint8ClampedArray(fromOriginalB.data);

  assert.notDeepEqual(first, expected);

  const rerenderedB = { data: new Uint8ClampedArray(source), width: 2, height: 2 };
  processImageData(rerenderedB, presetB);
  assert.deepEqual(new Uint8ClampedArray(rerenderedB.data), expected);
});

test("曝光、色温与分离色调产生稳定且受控的颜色结果", () => {
  const neutral = gradeRgba(128, 128, 128, {
    exposure: 0,
    temperature: 0,
    contrast: 0,
    shadowHue: 0,
    shadowStrength: 0,
    highlightHue: 0,
    highlightStrength: 0,
  });
  assert.deepEqual(neutral.map(Math.round), [128, 128, 128]);

  const warm = gradeRgba(100, 100, 100, {
    exposure: 0.5,
    temperature: 60,
    contrast: 10,
    shadowHue: 20,
    shadowStrength: 25,
    highlightHue: 45,
    highlightStrength: 12,
  });
  assert.ok(warm[0] > warm[2], "暖色温应提升红通道相对蓝通道");
  assert.ok(Math.max(...warm) <= 255 && Math.min(...warm) >= 0);
  assert.deepEqual(
    gradeRgba(100, 100, 100, {
      exposure: 0.5,
      temperature: 60,
      contrast: 10,
      shadowHue: 20,
      shadowStrength: 25,
      highlightHue: 45,
      highlightStrength: 12,
    }),
    warm,
  );
});

test("默认案例通过安全区检查", () => {
  const state = createDefaultState();
  const issues = validateState(state, fakeMeasureContext());
  assert.deepEqual(issues, []);
});

test("边界案例报告极小导出与超长文字，而非静默裁切", () => {
  const state = createBoundaryState();
  const issues = validateState(state, fakeMeasureContext());
  assert.ok(issues.some((issue) => issue.code === "export-too-small"));
  assert.ok(
    issues.some(
      (issue) =>
        issue.elementId === "title" &&
        (issue.code === "outside-canvas" || issue.code === "safe-margin"),
    ),
  );
  assert.match(
    issues.map((issue) => `${issue.title} ${issue.fix}`).join(" "),
    /导出宽度|裁切|字号/,
  );
});

test("自动适配保留完整长文本并恢复可导出状态", () => {
  const boundary = createBoundaryState();
  const originalText = boundary.elements.find((element) => element.id === "title").text;
  const fixed = autoFitState(boundary, fakeMeasureContext());
  const fixedTitle = fixed.elements.find((element) => element.id === "title");
  assert.equal(fixedTitle.text, originalText);
  assert.ok(fixed.export.width >= 640);
  assert.equal(validateState(fixed, fakeMeasureContext()).length, 0);
});

test("移动元素后安全区检查立即失败，撤销恢复原布局", () => {
  const initial = createDefaultState();
  const store = new HistoryStore(initial, () => {});
  const moved = structuredClone(initial);
  moved.elements.find((element) => element.id === "title").x = 12;
  store.update(moved);
  assert.ok(validateState(store.state, fakeMeasureContext()).length > 0);
  assert.equal(store.undo(), true);
  assert.equal(store.state.elements.find((element) => element.id === "title").x, 92);
  assert.equal(store.redo(), true);
  assert.equal(store.state.elements.find((element) => element.id === "title").x, 12);
  assert.deepEqual(validateState(store.state, fakeMeasureContext()), validateState(moved, fakeMeasureContext()));
});

test("历史批处理只产生一个撤销点", () => {
  const initial = createDefaultState();
  const store = new HistoryStore(initial, () => {});
  store.beginBatch();
  for (let step = 1; step <= 5; step += 1) {
    const next = structuredClone(store.state);
    next.params.exposure = step / 10;
    store.update(next, { record: false });
  }
  store.endBatch();
  assert.equal(store.canUndo, true);
  store.undo();
  assert.equal(store.state.params.exposure, initial.params.exposure);
  assert.equal(store.canUndo, false);
});

test("保存并重新载入时模板、图像、字体、图层与关键帧一致", () => {
  const storage = memoryStorage();
  const state = createDefaultState();
  state.template = "tidal-blue";
  state.seed = 991827;
  state.elements.find((element) => element.id === "title").fontId = FONT_OPTIONS[2].id;
  state.elements.find((element) => element.id === "caption").text = "需要一致恢复的文字";
  const frame = {
    id: "frame-a",
    name: "关键帧 A",
    createdAt: new Date().toISOString(),
    state: snapshotProject(state),
  };
  saveWorkspace(state, [], [frame], storage);
  const loaded = loadWorkspace(storage);
  assert.equal(loaded.state.template, "tidal-blue");
  assert.equal(loaded.state.seed, 991827);
  assert.equal(
    loaded.state.elements.find((element) => element.id === "title").fontId,
    FONT_OPTIONS[2].id,
  );
  assert.equal(
    loaded.state.elements.find((element) => element.id === "caption").text,
    "需要一致恢复的文字",
  );
  assert.equal(loaded.keyframes[0].state.seed, 991827);
  assert.equal(loaded.keyframes[0].state.template, "tidal-blue");
});

test("项目文件可迁移且拒绝不可识别的结构", () => {
  const payload = createWorkspacePayload(createBoundaryState(), [], []);
  const roundTrip = parseWorkspace(JSON.parse(JSON.stringify(payload)));
  assert.equal(roundTrip.state.template, "tidal-blue");
  assert.equal(roundTrip.state.export.width, 48);
  assert.equal(parseWorkspace(null), null);
  assert.equal(normalizeState({}).template, "dune-dusk");
});

test("SVG 导出保留可编辑文字、图形和完整参数元数据", () => {
  const state = createDefaultState();
  const adjusted = { toDataURL: () => "data:image/png;base64,AAAA" };
  const svg = createSvgMarkup(state, adjusted, fakeMeasureContext());
  assert.match(svg, /<metadata id="lumen-project">/);
  assert.match(svg, /<text id="title" data-layer-id="title" data-editable="text"/);
  assert.match(svg, /<rect id="frame" data-layer-id="frame" data-editable="shape"/);
  assert.match(svg, /data-font-id="serif-cn"/);
  assert.match(svg, /data-generated="canvas"/);
  assert.doesNotMatch(svg, /foreignObject|html2canvas|screenshot/i);
  assert.match(svg, /光的形状/);
});

test("PNG 元数据块使用合法的 tEXt 结构与参数文本", () => {
  const chunk = createPngTextChunk("lumen-state", '{"exposure":0.18}');
  const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  assert.equal(new TextDecoder().decode(chunk.subarray(4, 8)), "tEXt");
  assert.equal(view.getUint32(0), chunk.byteLength - 12);
  const data = new TextDecoder().decode(chunk.subarray(8, chunk.byteLength - 4));
  assert.match(data, /^lumen-state\0/);
  assert.match(data, /"exposure":0\.18/);
});
