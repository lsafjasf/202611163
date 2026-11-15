// 纯逻辑模块的 Node 测试：关键帧、工程序列化、音频计划、时钟。
import assert from "node:assert/strict";
import { sampleKeys, setKey, removeKey, sampleLayer } from "../js/keyframes.js";
import {
  makeDefaultProject, serializeProject, deserializeProject,
  getScene, sceneDuration, cloneProject,
} from "../js/project.js";
import { planEvents, activeEventsAt } from "../js/audioEngine.js";
import { MasterClock, formatTimecode } from "../js/clock.js";

let passed = 0;
const tests = [];
function test(name, fn) { tests.push([name, fn]); }
async function run() {
  for (const [name, fn] of tests) {
    await fn();
  passed++;
  console.log(`ok - ${name}`);
  }
  console.log(`\n${passed} 项逻辑测试全部通过`);
}

test("关键帧线性插值与首尾钳制", () => {
  const keys = [{ t: 2, v: 10 }, { t: 0, v: 0 }, { t: 4, v: 20 }];
  assert.equal(sampleKeys(keys, -1), 0);
  assert.equal(sampleKeys(keys, 0), 0);
  assert.equal(sampleKeys(keys, 1), 5);
  assert.equal(sampleKeys(keys, 3), 15);
  assert.equal(sampleKeys(keys, 99), 20);
});

test("setKey 替换同时刻关键帧，removeKey 精确删除", () => {
  let keys = [{ t: 1, v: 5 }];
  keys = setKey(keys, 2, 9);
  keys = setKey(keys, 1, 7);
  assert.deepEqual(keys, [{ t: 1, v: 7 }, { t: 2, v: 9 }]);
  keys = removeKey(keys, 1);
  assert.deepEqual(keys, [{ t: 2, v: 9 }]);
});

test("sampleLayer 对整层采样", () => {
  const layer = { keyframes: { a: [{ t: 0, v: 0 }, { t: 1, v: 2 }], b: [{ t: 0, v: 4 }] } };
  assert.deepEqual(sampleLayer(layer, 0.5), { a: 1, b: 4 });
});

test("默认工程：10 秒、三层、字幕、音频、转场齐全", () => {
  const p = makeDefaultProject();
  const s = getScene(p);
  assert.equal(sceneDuration(s), 10);
  for (const l of ["wave", "title", "lightband"]) {
    assert.ok(Object.keys(s.layers[l].keyframes).length >= 4, l);
  }
  assert.ok(s.subtitles.length >= 2);
  assert.ok(s.audio.length >= 3);
  assert.equal(s.transition.type, "fade");
});

test("工程 JSON 往返：时间线/字幕/转场/音频起始位置全部保留", () => {
  const p = makeDefaultProject();
  const restored = deserializeProject(serializeProject(p));
  assert.deepEqual(restored, p);
});

test("反序列化拒绝坏数据且不产生半成品", () => {
  assert.throws(() => deserializeProject("{}"));
  assert.throws(() => deserializeProject('{"scenes":[{"in":5,"out":1,"layers":{}}]}'));
  const p = makeDefaultProject();
  const bad = JSON.parse(serializeProject(p));
  delete bad.scenes[0].layers.wave;
  assert.throws(() => deserializeProject(JSON.stringify(bad)));
});

test("音频计划：从中间播放只调度未结束事件且偏移正确", () => {
  const p = makeDefaultProject();
  const s = getScene(p);
  const plan = planEvents(s, 2.0);
  assert.ok(!plan.some((e) => e.id === "a1"));
  const a2 = plan.find((e) => e.id === "a2");
  assert.ok(Math.abs(a2.offset - 0.6) < 1e-9);
  const plan2 = planEvents(s, 3.0);
  const a2b = plan2.find((e) => e.id === "a2");
  assert.equal(a2b.offset, 0);
  assert.ok(Math.abs(a2b.skip - 0.4) < 1e-9);
});

test("activeEventsAt 与 planEvents 互相印证", () => {
  const p = makeDefaultProject();
  const s = getScene(p);
  for (const t of [0.5, 2.7, 5.5, 8.3, 9.9]) {
    const active = activeEventsAt(s, t);
    const planned = planEvents(s, 0)
      .filter((e) => e.offset <= t && t < e.offset + e.duration)
      .map((e) => e.id).sort();
    assert.deepEqual(planned, active, `t=${t}`);
  }
});

test("主时钟：seek/播放推进/循环回绕", async () => {
  const c = new MasterClock(10);
  c.seek(3.21);
  assert.ok(Math.abs(c.time - 3.21) < 1e-9);
  c.play();
  await new Promise((r) => setTimeout(r, 120));
  assert.ok(c.time > 3.21 && c.time < 4.5, `time=${c.time}`);
  c.pause();
  const frozen = c.time;
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(c.time, frozen);
  c.loop = true;
  c.seek(9.95);
  c.play();
  await new Promise((r) => setTimeout(r, 150));
  assert.ok(c.time < 9.95, `应回绕, time=${c.time}`);
});

test("时间码格式化", () => {
  assert.equal(formatTimecode(0), "00:00.000");
  assert.equal(formatTimecode(10), "00:10.000");
  assert.equal(formatTimecode(65.25), "01:05.250");
});

test("克隆工程互不影响（导出快照语义）", () => {
  const p = makeDefaultProject();
  const snap = cloneProject(p);
  snap.scenes[0].audio.length = 0;
  assert.ok(p.scenes[0].audio.length > 0);
});

run();
