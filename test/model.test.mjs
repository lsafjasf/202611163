import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createState, createHistory, pushHistory, undo, redo,
  reflowColumns, validate, serialize, deserialize, makeText, makeShape, PAGE,
} from '../js/model.js';
import { defaultCase, boundaryCase } from '../js/presets.js';

test('栏数切换重排不丢内容', () => {
  const state = defaultCase();
  const before = state.elements.map((e) => ({ id: e.id, text: e.text }));
  const r1 = reflowColumns(state, 4);
  assert.equal(r1.changed, true);
  assert.equal(state.elements.length, before.length);
  const r2 = reflowColumns(state, 3);
  assert.equal(state.elements.length, before.length);
  for (const el of state.elements) {
    assert.ok(el.x >= 0 && el.x + el.w <= PAGE.w, `元素 ${el.id} 在画布内`);
    assert.ok(el.w >= 24, `元素 ${el.id} 宽度未丢失`);
  }
  assert.deepEqual(state.elements.map((e) => e.text), before.map((b) => b.text));
});

test('撤销/重做恢复状态', () => {
  const state = createState(3);
  const hist = createHistory();
  pushHistory(hist, state);
  state.elements.push(makeText({ text: 'hello' }));
  pushHistory(hist, state);
  state.elements.push(makeShape());
  assert.equal(state.elements.length, 2);
  assert.ok(undo(hist, state));
  assert.equal(state.elements.length, 1);
  assert.ok(undo(hist, state));
  assert.equal(state.elements.length, 0);
  assert.ok(redo(hist, state));
  assert.equal(state.elements.length, 1);
  assert.equal(state.elements[0].text, 'hello');
});

test('边界案例触发安全区/裁切/过小提示且带修复建议', () => {
  const state = boundaryCase();
  const issues = validate(state);
  assert.ok(issues.length >= 3, '应有多条提示');
  assert.ok(issues.some((i) => i.level === 'error' && i.msg.includes('裁切')), '长文本裁切');
  assert.ok(issues.some((i) => i.msg.includes('安全边距')), '安全区提示');
  assert.ok(issues.some((i) => i.msg.includes('尺寸过小')), '极小元素提示');
  for (const i of issues) assert.ok(i.fix && i.fix.length > 4, '每条提示都有修复建议');
});

test('序列化往返保留字体/图片/关键帧', () => {
  const state = defaultCase();
  state.elements[0].fontFamily = "'PingFang SC', sans-serif";
  state.elements.push({ ...makeShape(), id: 'img1', type: 'image', src: 'data:image/png;base64,AAA' });
  const restored = deserialize(serialize(state));
  assert.equal(restored.cols, state.cols);
  assert.equal(restored.elements.length, state.elements.length);
  assert.equal(restored.elements[0].fontFamily, "'PingFang SC', sans-serif");
  assert.deepEqual(restored.elements[0].keyframes, state.elements[0].keyframes);
  assert.equal(restored.elements.at(-1).src, 'data:image/png;base64,AAA');
});

test('越界元素报错误并建议撤销', () => {
  const state = createState(3);
  state.elements.push(makeText({ x: PAGE.w - 20, y: 10, w: 200, h: 50 }));
  const issues = validate(state);
  assert.ok(issues.some((i) => i.level === 'error' && i.fix.includes('撤销')));
});

test('非法 JSON 反序列化抛出可读错误', () => {
  assert.throws(() => deserialize('{"cols":7,"elements":[]}'), /格式不正确/);
});

test('默认案例全部元素在安全区内且无裁切', () => {
  const issues = validate(defaultCase());
  assert.deepEqual(issues, [], `默认案例应干净:${JSON.stringify(issues)}`);
});
