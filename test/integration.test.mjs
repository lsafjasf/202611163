// 集成测试:jsdom + node-canvas 真实驱动 main.js,验证渲染/告警/撤销/导出。
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { createCanvas } from '@napi-rs/canvas';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });

globalThis.document = dom.window.document;
globalThis.window = dom.window;
globalThis.localStorage = dom.window.localStorage;
globalThis.Image = dom.window.Image;
globalThis.FileReader = dom.window.FileReader;
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame;
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame;
globalThis.alert = () => {};
globalThis.confirm = () => true;
URL.createObjectURL = () => 'blob:mock';
URL.revokeObjectURL = () => {};

const $ = (id) => document.getElementById(id);
const SAVE_KEY = 'poster-grid-editor-save';
const savedState = () => JSON.parse(localStorage.getItem(SAVE_KEY));

before(async () => {
  await import('../js/main.js');
});

test('初始化渲染默认案例并自动保存', () => {
  const s = savedState();
  assert.equal(s.cols, 3);
  assert.ok(s.elements.length >= 10);
  assert.ok($('alerts').hidden, '默认案例无告警');
});

test('画布真实绘制且非空白', () => {
  const canvas = $('stage');
  const ctx = canvas.getContext('2d');
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let nonWhite = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) nonWhite++;
  }
  assert.ok(nonWhite > 10000, `非空白像素 ${nonWhite}`);
});

test('切换四栏重排不丢内容', () => {
  const before = savedState().elements.length;
  $('colsSelect').value = '4';
  $('colsSelect').dispatchEvent(new dom.window.Event('change'));
  const after = savedState();
  assert.equal(after.cols, 4);
  assert.equal(after.elements.length, before);
});

test('撤销恢复三栏,重做回到四栏', () => {
  $('undoBtn').click();
  assert.equal(savedState().cols, 3);
  $('redoBtn').click();
  assert.equal(savedState().cols, 4);
});

test('边界案例触发告警且含修复建议', () => {
  $('presetBoundary').click();
  const alerts = $('alerts');
  assert.equal(alerts.hidden, false);
  assert.ok(alerts.textContent.includes('裁切'));
  assert.ok(alerts.textContent.includes('修复建议'));
  assert.ok(alerts.textContent.includes('安全边距') || alerts.textContent.includes('尺寸过小'));
});

test('SVG 导出为可编辑矢量而非截图', async () => {
  const { exportSVG } = await import('../js/exporter.js');
  const { boundaryCase } = await import('../js/presets.js');
  const measureCanvas = createCanvas(10, 10);
  const svg = exportSVG(boundaryCase(), measureCanvas.getContext('2d'));
  assert.ok(svg.includes('<text'), '包含可编辑文本');
  assert.ok(svg.includes('<rect') || svg.includes('<ellipse'), '包含矢量图形');
  assert.ok(!svg.includes('data:image/png;base64,iVBOR'), '不含整页截图烧录');
  assert.ok(svg.includes('deliberately'), '长文本内容保留');
});

test('PNG 导出与预览共用渲染器', async () => {
  const { exportPNG } = await import('../js/exporter.js');
  const { defaultCase } = await import('../js/presets.js');
  const blob = await exportPNG(defaultCase(), {}, 1);
  assert.ok(blob.size > 5000, 'PNG 非空');
  assert.equal(blob.type, 'image/png');
});
