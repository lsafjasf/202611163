// 校验：边界案例应触发预期告警/错误；定位块遮挡、对比度、安全区、极小尺寸。
const assert = require('assert');
require('../js/qr.js');
const M = require('../js/model.js');
const R = require('../js/render.js');
const V = require('../js/validate.js');
const helpers = require('./helpers');

const ctx = helpers.makeStubCtx();

function issuesOf(project, exportScale) {
  const boxes = R.layoutAll(ctx, project);
  return V.validate(project, boxes, { exportScale: exportScale || 1 });
}

// 1) 默认案例：不应有 error
const defIssues = issuesOf(M.defaultProject());
assert.ok(!defIssues.some(i => i.level === 'error'),
  '默认案例不应有错误: ' + JSON.stringify(defIssues));

// 2) 边界案例：应触发多类问题，且每条都带修复建议
const edgeIssues = issuesOf(M.edgeProject());
assert.ok(edgeIssues.length >= 4, '边界案例应有多条提示，实际 ' + edgeIssues.length);
edgeIssues.forEach(i => assert.ok(i.fix && i.fix.length > 4, '每条问题都应有修复建议'));
const msgs = edgeIssues.map(i => i.message).join('\n');
assert.ok(/超出画布/.test(msgs), '应检测出画布外元素');
assert.ok(/安全边距/.test(msgs), '应检测出安全区外元素');
assert.ok(/对比度/.test(msgs), '应检测出二维码对比度风险');
assert.ok(/图标/.test(msgs), '应检测出中心图标过大');
assert.ok(/模块仅/.test(msgs), '应检测出二维码模块过小');

// 3) 定位块遮挡：在二维码上层放置遮挡元素 → error
const p3 = M.defaultProject();
const qr = p3.elements.find(e => e.type === 'qr');
p3.elements.push(M.shapeElement('rect', {
  name: '遮挡物', x: qr.x - qr.size / 2, y: qr.y - qr.size / 2, w: 120, h: 120
}));
const occ = issuesOf(p3);
assert.ok(occ.some(i => i.level === 'error' && /定位块/.test(i.message)), '应检测出定位块遮挡');

// 4) 下层元素不视为遮挡（二维码自带不透明静区底）
const p4 = M.defaultProject();
const qr4 = p4.elements.find(e => e.type === 'qr');
p4.elements.unshift(M.shapeElement('rect', {
  name: '底层装饰', x: qr4.x, y: qr4.y, w: 600, h: 600
}));
const below = issuesOf(p4);
assert.ok(!below.some(i => /定位块/.test(i.message)), '底层元素不应误报遮挡');

// 5) 极小二维码在 1x 导出 → error（模块 < 2px），并提示如何修复
const p5 = M.defaultProject();
const qr5 = p5.elements.find(e => e.type === 'qr');
qr5.size = 40;
const tiny = issuesOf(p5, 1);
const tinyErr = tiny.find(i => i.level === 'error' && /无法可靠扫描/.test(i.message));
assert.ok(tinyErr, '极小二维码应报错');
assert.ok(/调大|倍率/.test(tinyErr.fix), '报错应附带修复方法');

// 6) 极端长文本：超出画布 → error 且提示缩短/缩小，不静默截断
const p6 = M.defaultProject();
p6.elements.push(M.textElement({
  name: '极端长文', x: 540, y: 720, fontSize: 60, maxWidth: 900,
  text: '长'.repeat(500)
}));
const longIssues = issuesOf(p6);
assert.ok(longIssues.some(i => i.level === 'error' && /超出画布/.test(i.message)),
  '极端长文本超界应报错');

console.log('validate.test.js 全部通过');
