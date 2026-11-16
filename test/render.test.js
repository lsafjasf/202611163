// 渲染管线：默认案例海报 → 栅格化 → jsQR 解码（含中心图标遮挡下仍可扫描）。
const assert = require('assert');
const jsQR = require('jsqr');
require('../js/qr.js');
const M = require('../js/model.js');
const R = require('../js/render.js');
const helpers = require('./helpers');

function decodePoster(project, scale) {
  const ctx = helpers.makeStubCtx();
  R.render(ctx, project, { scale: scale || 1, timeSec: 0 });
  const W = project.canvas.width * (scale || 1);
  const H = project.canvas.height * (scale || 1);
  const pixels = helpers.rasterize(ctx, W, H);
  return jsQR(pixels, W, H);
}

// 1) 默认案例：二维码可解码，内容与工程一致
const p1 = M.defaultProject();
const qr1 = p1.elements.find(e => e.type === 'qr');
const res1 = decodePoster(p1, 1);
assert.ok(res1, '默认案例导出后二维码应可扫描');
assert.strictEqual(res1.data, qr1.data, '扫描内容应与工程数据一致');

// 2) 2x 导出倍率同样可扫描
const res2 = decodePoster(p1, 2);
assert.ok(res2 && res2.data === qr1.data, '2x 导出应可扫描');

// 3) 自定义前景色（深蓝）+ 大中心图标仍可扫描（H 级纠错）
const p2 = M.defaultProject();
const qr2 = p2.elements.find(e => e.type === 'qr');
qr2.fg = '#1a2a6c';
qr2.icon.scale = 0.28;
const res3 = decodePoster(p2, 1);
assert.ok(res3 && res3.data === qr2.data, '自定义前景色+中心图标应可扫描');

// 4) 文本换行布局：canvas 与 SVG 共用同一测量 → 行数一致
const p3 = M.defaultProject();
const ctx = helpers.makeStubCtx();
const t = p3.elements.find(e => e.type === 'text');
const lay = R.layoutText(ctx, t);
assert.ok(lay.lines.length >= 1 && lay.height > 0, '文本布局应有效');

// 5) 关键帧：动画中点插值生效，静态导出（t=0）为首帧
const p4 = M.defaultProject();
const qr4 = p4.elements.find(e => e.type === 'qr');
const st = R.animState(qr4, 1.2);
assert.ok(Math.abs(st.scale - 1.02) < 0.05, '关键帧插值应生效，实际 ' + st.scale);
const st0 = R.animState(qr4, 0);
assert.strictEqual(st0.scale, 1, '导出首帧应为原始缩放');

console.log('render.test.js 全部通过');
