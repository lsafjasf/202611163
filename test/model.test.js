// 模型：序列化/载入往返一致性（模板、字体、图片、关键帧），非法文件的报错提示。
const assert = require('assert');
require('../js/qr.js');
const M = require('../js/model.js');

// 默认案例往返
const p1 = M.defaultProject();
p1.fonts.push({ name: 'TestFont', dataUrl: 'data:font/woff2;base64,AAAA' });
p1.elements.push(M.imageElement({ src: 'data:image/png;base64,BBBB' }));
const restored = M.deserialize(M.serialize(p1));
assert.strictEqual(restored.elements.length, p1.elements.length, '元素数量应一致');
assert.strictEqual(restored.fonts[0].name, 'TestFont', '字体应恢复');
const lastEl = restored.elements[restored.elements.length - 1];
assert.strictEqual(lastEl.src, 'data:image/png;base64,BBBB', '图片 dataURL 应恢复');
const qr = restored.elements.find(e => e.type === 'qr');
assert.ok(qr.anim && qr.anim.keyframes.length === 3, '关键帧应恢复');
assert.strictEqual(qr.anim.keyframes[1].scale, 1.04, '关键帧数值应一致');
assert.strictEqual(restored.templateName, p1.templateName, '模板名应恢复');
assert.deepStrictEqual(restored.exportParams, p1.exportParams, '导出参数应恢复');

// 边界案例往返
const p2 = M.edgeProject();
const r2 = M.deserialize(M.serialize(p2));
assert.strictEqual(r2.elements.length, p2.elements.length);
assert.ok(r2.elements[0].text.length > 200, '超长文本不应被静默截断');

// 非法输入：报错信息应包含修复指引
assert.throws(() => M.deserialize('{broken'), /不是合法的 JSON/);
assert.throws(() => M.deserialize('{"foo":1}'), /不是本工具的工程文件/);
assert.throws(() => M.deserialize(JSON.stringify({ app: 'qr-poster-studio', schemaVersion: 99 })), /版本过新/);

// 载入时剔除未知元素类型但不崩溃
const mixed = M.deserialize(JSON.stringify({
  app: 'qr-poster-studio', schemaVersion: 1,
  elements: [{ type: 'text', text: 'ok' }, { type: 'hacker' }, null]
}));
assert.strictEqual(mixed.elements.length, 1);

console.log('model.test.js 全部通过');
