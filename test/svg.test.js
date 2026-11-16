// SVG 导出：文字保持 <text> 可编辑、二维码为矢量路径、无截图烧录、换行与预览一致。
const assert = require('assert');
require('../js/qr.js');
const M = require('../js/model.js');
const R = require('../js/render.js');
const S = require('../js/svg.js');
const helpers = require('./helpers');

const ctx = helpers.makeStubCtx();
const p = M.defaultProject();
p.fonts.push({ name: 'TestFont', dataUrl: 'data:font/woff2;base64,AAAA' });
const svg = S.toSvg(p, ctx);

// 1) 基本结构
assert.ok(svg.startsWith('<?xml'), '应为合法 XML 声明');
assert.ok(svg.includes('viewBox="0 0 1080 1440"'), 'viewBox 应与画布一致');

// 2) 文字可编辑：每个文字元素对应 <text>，且 tspan 行与布局一致
const textCount = p.elements.filter(e => e.type === 'text').length;
const textTags = (svg.match(/<text[ >]/g) || []).length;
assert.ok(textTags >= textCount, '文字应导出为 <text> 元素');
const t = p.elements.find(e => e.type === 'text');
const lay = R.layoutText(ctx, t);
const tspanCount = (svg.match(/<tspan/g) || []).length;
const totalLines = p.elements.filter(e => e.type === 'text')
  .reduce((n, e) => n + R.layoutText(ctx, e).lines.length, 0);
assert.strictEqual(tspanCount, totalLines, 'tspan 行数应与预览换行一致');
assert.ok(svg.includes('夏日音乐节'), '文本内容应原样保留');

// 3) 二维码为矢量 path，而非位图
assert.ok(svg.includes('data-element-type="qr"'), '二维码分组应存在');
const qrGroup = svg.slice(svg.indexOf('data-element-type="qr"'));
assert.ok(qrGroup.includes('<path'), '二维码应为矢量路径');
assert.ok(!qrGroup.includes('base64'), '二维码不应使用位图烧录');

// 4) 无整幅截图烧录：SVG 中不应出现整张海报的 dataURL 图片
assert.ok(!/image[^>]*poster/i.test(svg), '不应包含整幅烧录图片');

// 5) 自定义字体以 @font-face 内嵌，保存后可一致恢复
assert.ok(svg.includes('@font-face') && svg.includes('TestFont'), '自定义字体应内嵌');

// 6) 背景纹理以 pattern 导出
assert.ok(svg.includes('<pattern'), '背景纹理应导出为 pattern');

// 7) 中心 emoji 图标保留为文本
assert.ok(svg.includes('🎵'), '中心图标字符应保留');

console.log('svg.test.js 全部通过');
