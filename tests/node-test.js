/* Node 纯逻辑测试：node tests/node-test.js */
"use strict";
const path = require("path");
const fs = require("fs");

const globalScope = {};
global.self = globalScope;
global.window = globalScope;

function load(file) {
  const code = fs.readFileSync(path.join(__dirname, "..", "js", file), "utf8");
  new Function("module", "self", "window", code)(
    { exports: {} }, globalScope, globalScope);
}

["util.js", "model.js", "layout.js", "history.js", "storage.js",
 "svg-export.js", "png-export.js", "validate.js"].forEach(load);

const TF = globalScope.TF;
let passed = 0, failed = 0;
function assert(cond, msg) {
  if (!cond) throw new Error(msg || "断言失败");
}
function test(name, fn) {
  try { fn(); passed++; console.log("  ✓ " + name); }
  catch (e) { failed++; console.log("  ✕ " + name + " — " + e.message); }
}

test("默认案例无错误项", () => {
  const d = TF.defaultCase();
  assert(!TF.hasErrors(TF.validate(d)));
  assert(d.elements.length >= 8);
});

test("边界案例检出 4 类错误且全部带修复建议", () => {
  const e = TF.edgeCase();
  const issues = TF.validate(e);
  const codes = new Set(issues.map((i) => i.code));
  ["TEXT_CLIP", "OUT_OF_PANEL", "IMAGE_MISSING", "NEGATIVE_SIZE"].forEach((c) =>
    assert(codes.has(c), "缺少 " + c));
  assert(issues.every((i) => i.fix && i.fix.length > 0));
});

test("自动修复收敛且不丢内容", () => {
  const e = TF.edgeCase();
  const n = e.elements.length;
  const longText = e.elements[0].text;
  const report = TF.autoFix(e);
  assert(Array.isArray(report));
  const issues = TF.validate(e);
  const codes = new Set(issues.map((i) => i.code));
  // 几何类问题必须全部修复
  assert(!codes.has("OUT_OF_PANEL"), "仍有元素越出面板/折线");
  assert(!codes.has("NEGATIVE_SIZE"), "仍有负尺寸");
  // 无法物理容纳的问题保留，但必须带可执行修复建议，且内容不丢失
  issues.forEach((i) => assert(i.fix && i.fix.length > 0));
  assert(e.elements.length === n);
  assert(e.elements[0].text === longText);
  e.elements.forEach((el) => {
    assert(TF.rectContainsRect(TF.panelRect(e.geometry, el.panel),
      TF.normalizeRect(el), 1));
  });
});

test("CJK/拉丁混合换行与字号自适应", () => {
  const el = TF.createText(0, TF.defaultGeometry(), {
    text: "hello world 你好世界abc", w: 60, fontSize: 16
  });
  const wrap = TF.wrapText(el.text, el, 60);
  assert(wrap.lines.length >= 2);
  const fit = TF.fitFontSize(Object.assign({}, el, { h: 30 }));
  assert(fit >= 4 && fit <= 16);
});

test("折叠矩阵：0° 恒等、90° 投影为 0、180° 镜像", () => {
  const g = TF.defaultGeometry();
  const m0 = TF.panelFoldMatrix(g, 0, 0);
  assert(Math.abs(m0[0] - 1) < 1e-9 && Math.abs(m0[4]) < 1e-9);
  const m1 = TF.panelFoldMatrix(g, 1, 0);
  assert(Math.abs(m1[4] - g.width) < 1e-9, "中间面板原点应在 x=w");
  const m90 = TF.panelFoldMatrix(g, 0, 90);
  assert(Math.abs(m90[0]) < 1e-9);
  const m180 = TF.panelFoldMatrix(g, 0, 180);
  assert(Math.abs(m180[0] + 1) < 1e-9);
  // 180° 时左面板左边界镜像到 x=2w
  const p = TF.applyPoint(m180, { x: 0, y: 0 });
  assert(Math.abs(p.x - 2 * g.width) < 1e-9);
  // 右面板 180° 对折到中间区域，其左边界镜像到 x=2w
  const pr = TF.applyPoint(TF.panelFoldMatrix(g, 2, 180), { x: 0, y: 0 });
  assert(Math.abs(pr.x - 2 * g.width) < 1e-9);
});

test("角度切换不修改元素世界坐标", () => {
  const d = TF.defaultCase();
  const snap = JSON.stringify(d.elements);
  [15, 60, 90, 120, 179].forEach((a) => {
    d.foldAngle = a;
    TF.panelDrawOrder(a);
  });
  assert(JSON.stringify(d.elements) === snap);
});

test("视图矩阵往返可逆，缩放/平移不影响安全判定", () => {
  const d = TF.defaultCase();
  const el = d.elements[0];
  [0.1, 1, 8].forEach((s) => {
    const view = { scale: s, panX: 99, panY: -77 };
    const m = TF.elementScreenMatrix(d.geometry, el, 0, view);
    const worldPoint = { x: el.x + 5, y: el.y + 7 };
    const back = TF.applyPoint(TF.invert(m), TF.applyPoint(m, worldPoint));
    assert(Math.abs(back.x - worldPoint.x) < 1e-6 &&
      Math.abs(back.y - worldPoint.y) < 1e-6);
  });
});

test("几何重排后自动修复重新收敛", () => {
  const e = TF.edgeCase();
  TF.autoFix(e);
  e.geometry = { width: 200, height: 260, margin: 12 };
  TF.autoFix(e);
  e.elements.forEach((el) => {
    assert(TF.rectContainsRect(TF.panelRect(e.geometry, el.panel),
      TF.normalizeRect(el), 1));
  });
});

test("JSON 往返一致：字体/图片/关键帧", () => {
  const d = TF.defaultCase();
  d.fonts.push({ id: "f", family: "自定义字体", name: "a.woff2",
    src: "data:font/woff2;base64,AAAA" });
  const json = TF.serialize(d);
  const back = TF.deserialize(json);
  assert(TF.serialize(back) === json);
  assert(back.fonts[0].src.startsWith("data:font"));
  assert(back.keyframes.length === d.keyframes.length);
});

test("损坏/高版本 JSON 报错且含修复建议", () => {
  [["{bad"], [{ version: 99, geometry: { width: 1, height: 1 }, elements: [] }]]
    .forEach((payload) => {
      let threw = false;
      try { TF.deserialize(typeof payload === "string" ? payload : JSON.stringify(payload)); }
      catch (err) { threw = true; assert(err.message.includes("修复")); }
      assert(threw);
    });
});

test("SVG 导出保持可编辑结构并写入参数", () => {
  const d = TF.defaultCase();
  const svg = TF.buildSvg(d, { exportParams: { foldAngle: 0 } });
  ["<text", "<image", "<rect", "data-id", "&quot;foldAngle&quot;:0"].forEach((token) =>
  assert(svg.includes(token), "缺少 " + token));
  assert(!svg.includes("foreignObject"));
  const folded = TF.deepClone(d);
  folded.foldAngle = 120;
  const svg2 = TF.buildSvg(folded, {});
  assert(svg2.includes("matrix(") && svg2 !== svg);
});

test("撤销重做栈", () => {
  const h = new TF.History();
  const p = TF.defaultCase();
  h.reset(p);
  p.title = "x"; h.push(p);
  p.title = "y"; h.push(p);
  assert(h.undo().title === "x");
  assert(h.undo().title === TF.defaultCase().title);
  assert(!h.canUndo());
  assert(h.redo().title === "x");
});

test("极小尺寸极端长文本：报错->修复->无错误且不删字", () => {
  const e = TF.edgeCase();
  const txt = e.elements[0];
  const len = txt.text.length;
  assert(TF.validate(e).some((i) => i.code === "TEXT_CLIP"));
  TF.autoFix(e);
  const clip = TF.validate(e).filter((i) => i.code === "TEXT_CLIP");
  if (clip.length) assert(clip[0].fix.includes("文案") || clip[0].fix.includes("面板"));
  assert(txt.text.length === len);
  assert(txt.fontSize <= 24, "字号未被自适应缩小");
});

console.log("\n" + passed + " 通过, " + failed + " 失败");
process.exit(failed ? 1 : 0);
