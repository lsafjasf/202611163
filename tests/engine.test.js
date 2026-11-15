import assert from 'node:assert/strict';
import { valueAt, parseColor, rgbToHex, EASINGS } from '../src/engine/interpolate.js';
import {
  createDefaultProject, locateScene, sceneDuration, validateProject, cloneProject,
} from '../src/engine/project.js';
import { AudioEngine } from '../src/engine/audio.js';

let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log('  ✓', name); };

test('数字关键帧边界与线性插值', () => {
  const track = [{ t: 0, value: 0 }, { t: 2, value: 10 }];
  assert.equal(valueAt(track, -1), 0);
  assert.equal(valueAt(track, 0), 0);
  assert.equal(valueAt(track, 1), 5);
  assert.equal(valueAt(track, 2), 10);
  assert.equal(valueAt(track, 9), 10);
});

test('缓动函数影响中间值', () => {
  const track = [{ t: 0, value: 0 }, { t: 1, value: 100, easing: 'easeIn' }];
  assert.ok(valueAt(track, 0.5) < 50);
  assert.equal(valueAt(track, 0), 0);
  assert.equal(valueAt(track, 1), 100);
});

test('颜色关键帧在 hex 间插值', () => {
  const track = [{ t: 0, value: '#000000' }, { t: 1, value: '#ffffff' }];
  assert.equal(valueAt(track, 0, 'color'), '#000000');
  assert.equal(valueAt(track, 1, 'color'), '#ffffff');
  assert.equal(valueAt(track, 0.5, 'color'), rgbToHex([127.5, 127.5, 127.5]));
});

test('parseColor 支持 hex 与 rgb()', () => {
  assert.deepEqual(parseColor('#ff8800'), [255, 136, 0]);
  assert.deepEqual(parseColor('rgb(10,20,30)'), [10, 20, 30]);
});

test('默认工程总时长 12s，两场景入出点连续', () => {
  const p = createDefaultProject();
  assert.equal(p.duration, 12);
  assert.equal(p.scenes[0].inPoint, 0);
  assert.equal(p.scenes[0].outPoint, 6);
  assert.equal(p.scenes[1].inPoint, 6);
  assert.equal(p.scenes[1].outPoint, 12);
  assert.equal(sceneDuration(p.scenes[0]), 6);
});

test('locateScene 按全局时间定位并给本地时间', () => {
  const p = createDefaultProject();
  assert.equal(locateScene(p, 2).scene.id, 'scene-a');
  assert.equal(locateScene(p, 2).local, 2);
  const b = locateScene(p, 7.5);
  assert.equal(b.scene.id, 'scene-b');
  assert.equal(b.local, 1.5);
});

test('三层关键帧在深拷贝后不丢失', () => {
  const p = createDefaultProject();
  const copy = cloneProject(p);
  for (const s of copy.scenes) {
    assert.ok(s.layers.background.tracks.opacity.length >= 2);
    assert.ok(s.layers.title.tracks.color.length >= 2);
    assert.ok(s.layers.labels.tracks.opacity.length >= 2);
  }
  copy.scenes[0].layers.title.tracks.opacity[0].value = 0.123;
  assert.notEqual(p.scenes[0].layers.title.tracks.opacity[0].value, 0.123);
});

test('validateProject 拒绝缺层工程', () => {
  const bad = { scenes: [{ inPoint: 0, outPoint: 1, layers: {} }] };
  assert.throws(() => validateProject(bad));
  assert.doesNotThrow(() => validateProject(createDefaultProject()));
});

test('音频事件按 120BPM 落在正确全局时间且含 kick/hat', () => {
  const p = createDefaultProject();
  const audio = new AudioEngine();
  const events = audio.allEvents(p);
  const beatLen = 60 / p.scenes[0].audio.bpm; // 120bpm -> 0.5s
  const kicks = events.filter((e) => e.kind === 'kick').map((e) => e.global);
  assert.ok(kicks.includes(0) && kicks.includes(beatLen) && kicks.includes(6));
  const hats = events.filter((e) => e.kind === 'hat').map((e) => e.global);
  assert.ok(hats.includes(0.5 * beatLen) && hats.includes(6 + 0.5 * beatLen));
  const ordered = events.every((e, i, arr) => i === 0 || arr[i - 1].global <= e.global);
  assert.ok(ordered);
});

test('eventsIn 窗口过滤支持循环回绕后的重新调度', () => {
  const p = createDefaultProject();
  const audio = new AudioEngine();
  const beatLen = 60 / p.scenes[0].audio.bpm;
  const window0 = audio.eventsIn(p, p.scenes[0], 0, beatLen * 0.6);
  assert.equal(window0.length, 2); // kick@0 + hat@0.5拍
  const wrap = audio.eventsIn(p, p.scenes[1], 6, 6 + beatLen * 0.6);
  assert.equal(wrap.length, 2);
});

console.log(`\n${passed} 项引擎单测通过`);
