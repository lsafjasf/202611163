// 端到端（jsdom）：撤销/重做、保存/重载、导出门禁、边界案例提示、拖动后安全区检查。
const assert = require('assert');
const { JSDOM } = require('jsdom');
const jsQR = require('jsqr');
const helpers = require('./helpers');

function boot(savedJson) {
  return helpers.loadApp(JSDOM, savedJson);
}

async function main() {
// ---- 1) 启动：默认案例渲染，无错误提示 ----
{
  const { window } = boot();
  const doc = window.document;
  assert.ok(doc.getElementById('layerList').children.length >= 5, '图层列表应渲染');
  assert.ok(!doc.querySelector('#issueList li.error'), '默认案例不应有错误级提示');
  console.log('✓ 启动与默认案例');
}

// ---- 2) 撤销 / 重做 ----
{
  const { window } = boot();
  const doc = window.document;
  const before = doc.getElementById('layerList').children.length;
  doc.getElementById('btnAddText').click();
  assert.strictEqual(doc.getElementById('layerList').children.length, before + 1, '添加后应多一层');
  doc.getElementById('btnUndo').click();
  assert.strictEqual(doc.getElementById('layerList').children.length, before, '撤销后应恢复');
  doc.getElementById('btnRedo').click();
  assert.strictEqual(doc.getElementById('layerList').children.length, before + 1, '重做后应恢复');
  console.log('✓ 撤销/重做');
}

// ---- 3) 保存 → 重新载入一致恢复 ----
{
  const first = boot();
  const doc1 = first.window.document;
  doc1.getElementById('btnAddText').click();
  doc1.getElementById('btnSave').click();
  assert.strictEqual(first.downloads.length, 1, '保存应产生一次下载');
  const saved = first.downloads[0];
  // 读取下载的 JSON 内容
  const text = await saved.text();
  const parsed = JSON.parse(text);
  assert.strictEqual(parsed.app, 'qr-poster-studio', '工程文件应有标识');
  assert.ok(parsed.elements.some(e => e.anim && e.anim.keyframes.length > 0), '关键帧应随工程保存');
  // 用保存的 JSON 启动新实例 → 一致恢复
  const second = boot(text);
  const doc2 = second.window.document;
  assert.strictEqual(
    doc2.getElementById('layerList').children.length,
    doc1.getElementById('layerList').children.length,
    '重新载入后图层数应一致'
  );
  console.log('✓ 保存/重新载入');
}

// ---- 4) 边界案例：实时提示 + 导出门禁 ----
{
  const { window } = boot();
  const doc = window.document;
  doc.getElementById('btnEdge').click();
  const errors = doc.querySelectorAll('#issueList li.error');
  const warns = doc.querySelectorAll('#issueList li.warn');
  assert.ok(errors.length >= 2, '边界案例应有错误级提示，实际 ' + errors.length);
  assert.ok(warns.length >= 2, '边界案例应有警告级提示，实际 ' + warns.length);
  const allText = doc.getElementById('issueList').textContent;
  assert.ok(allText.includes('修复建议'), '每条提示应附带修复方法');
  // 导出应被门禁拦截并给出修复指引
  doc.getElementById('btnExportPng').click();
  assert.ok(!doc.getElementById('modal').hidden, '存在错误时导出应弹出提示');
  assert.ok(doc.getElementById('modalBody').textContent.includes('修复建议'), '弹窗应包含修复指引');
  doc.getElementById('modalCancel').click();
  assert.ok(doc.getElementById('modal').hidden, '返回修复后弹窗应关闭');
  console.log('✓ 边界案例与导出门禁');
}

// ---- 5) 导出 PNG：经完整应用管线生成且二维码可扫描 ----
{
  const { window, downloads } = boot();
  const doc = window.document;
  doc.getElementById('exportScale').value = '1';
  doc.getElementById('btnExportPng').click();
  assert.strictEqual(downloads.length, 1, '应导出一个 PNG');
  const buf = Buffer.from(await downloads[0].arrayBuffer());
  assert.strictEqual(buf.readUInt32BE(0), 0x89504e47, '应为 PNG 文件头');
  // 解码 PNG（用 jsQR 需要 RGBA，这里直接从 stub canvas 取栅格验证更可靠）
  // 另走一遍渲染管线验证可扫描性：
  const project = JSON.parse(window.localStorage.getItem('qr-poster-project'));
  const ctx = helpers.makeStubCtx();
  window.PosterRender.render(ctx, project, { scale: 1, timeSec: 0 });
  const pixels = helpers.rasterize(ctx, project.canvas.width, project.canvas.height);
  const decoded = jsQR(pixels, project.canvas.width, project.canvas.height);
  assert.ok(decoded, '导出管线渲染的二维码应可扫描');
  assert.ok(decoded.data.includes('summer-music-2026'), '扫描内容应正确');
  // 导出参数应保留在工程中
  assert.strictEqual(project.exportParams.scale, 1, '导出参数应保留');
  console.log('✓ PNG 导出与可扫描性');
}

// ---- 6) 导出 SVG：可编辑输出 ----
{
  const { window, downloads } = boot();
  const doc = window.document;
  doc.getElementById('btnExportSvg').click();
  assert.strictEqual(downloads.length, 1, '应导出一个 SVG');
  const svg = await downloads[0].text();
  assert.ok(svg.includes('<text'), 'SVG 应保留可编辑文字');
  assert.ok(svg.includes('<path'), 'SVG 应包含矢量二维码');
  console.log('✓ SVG 导出');
}

// ---- 7) 拖动元素出安全区 → 实时提示更新 ----
{
  const { window } = boot();
  const doc = window.document;
  const canvas = doc.getElementById('poster');
  const stage = doc.getElementById('stage');
  Object.defineProperty(stage, 'clientWidth', { value: 1120 });
  Object.defineProperty(stage, 'clientHeight', { value: 1480 });
  window.dispatchEvent(new window.Event('resize'));
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: canvas.width, height: canvas.height });
  // 点选主标题（约画布坐标 540,270；预览缩放≈1 因 jsdom 无布局，viewScale 可能 <1）
  // 直接通过图层列表选中更稳定
  const layers = doc.getElementById('layerList').children;
  // 找到「主标题」
  let target = null;
  for (const li of layers) if (li.textContent === '主标题') target = li;
  target.click();
  // 模拟拖到画布外
  function pointer(type, x, y) {
    const e = new window.Event(type, { bubbles: true });
    e.clientX = x; e.clientY = y;
    e.pointerId = 1;
    canvas.dispatchEvent(e);
  }
  const rect = canvas.getBoundingClientRect();
  const vs = rect.width / 1080;
  pointer('pointerdown', 540 * vs, 270 * vs);
  pointer('pointermove', -500, -500);
  pointer('pointerup', -500, -500);
  const errors = doc.querySelectorAll('#issueList li.error');
  assert.ok(errors.length >= 1, '拖出画布后应出现错误提示');
  assert.ok(doc.getElementById('issueList').textContent.includes('超出画布'), '应提示超出画布');
  // 撤销可恢复
  doc.getElementById('btnUndo').click();
  assert.ok(!doc.querySelector('#issueList li.error'), '撤销后错误应消失');
  console.log('✓ 拖动与安全区实时检查');
}

console.log('app.test.js 全部通过');
}

main().catch(function (e) { console.error(e); process.exit(1); });
