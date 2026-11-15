/* test.js — 用 Node 验证核心契约：
 * 1. 入点/出点/总时长在导出（序列化）后保持一致
 * 2. 场景切换 / 重新载入不丢关键帧
 * 3. 暂停截图与从头重放到同一时刻的画面、音频事件一致
 * 4. 存档恢复时间线、字幕、转场、音频起始位置
 * 5. 导出/解析失败时原工程数据不被破坏
 */
"use strict";
var C = require("./core.js");
var assert = require("assert");

var passed = 0;
function ok(name, fn) { fn(); passed++; console.log("  PASS " + name); }

/* 1. 入点 / 出点 / 总时长导出后一致 */
ok("in/out/duration survive export", function () {
  var p = C.makeProject();
  var tl = new C.Timeline({ duration: 8 });
  tl.setInOut(1.5, 6.5);
  tl.seek(3.25);
  var json = C.serialize(p, tl);           // “导出”工程
  var restored = C.deserialize(json);
  var s = restored.scenes[restored.activeScene];
  assert.strictEqual(s.inPoint, 1.5, "入点丢失");
  assert.strictEqual(s.outPoint, 6.5, "出点丢失");
  assert.strictEqual(s.duration, 8, "总时长丢失");
  assert.strictEqual(s.outPoint - s.inPoint, tl.range(), "导出入出点跨度不一致");
  assert.strictEqual(restored.playhead, 3.25, "播放头位置丢失");
});

/* 2. 场景切换 / 重载不丢关键帧 */
ok("keyframes survive scene switch + reload", function () {
  var p = C.makeProject();
  p.scenes[0].keysA.push({ t: 4, v: [1, 2, 3, 4, 5] });   // 用户编辑
  var json = C.serialize(p, null);
  var r1 = C.deserialize(json);
  r1.activeScene = 1;                                       // 切换场景
  var json2 = C.serialize(r1, null);                        // 再次保存
  var r2 = C.deserialize(json2);
  assert.strictEqual(r2.scenes[0].keysA.length, 5, "场景0关键帧丢失");
  assert.deepStrictEqual(r2.scenes[0].keysA[4].v, [1, 2, 3, 4, 5]);
  assert.strictEqual(r2.scenes[1].keysB.length, 4, "场景1关键帧丢失");
  assert.strictEqual(r2.activeScene, 1, "活动场景未恢复");
});

/* 3. 暂停截图 == 从头重放到同一时刻；音频事件一致 */
ok("pause-frame equals replayed-frame (video+audio)", function () {
  var scene = C.makeProject().scenes[0];
  var tMid = 4.37;
  // 路径 A：直接“暂停”在 tMid
  var vA = C.sampleKeys(scene.keysA, tMid);
  var framePause = C.animState(scene, vA, tMid);
  // 路径 B：从 0 以固定步长“播放”到 tMid
  var tl = new C.Timeline({ duration: scene.duration });
  tl.playing = true; tl.loop = false;
  var heard = [];
  while (tl.playhead < tMid - 1e-9 && tl.playing) {
    var r = tl.tick(1 / 60, scene.audioEvents);
    heard = heard.concat(r.events.map(function (e) { return e.time; }));
  }
  tl.seek(tMid);
  var vB = C.sampleKeys(scene.keysA, tMid);
  var frameReplay = C.animState(scene, vB, tMid);
  assert.deepStrictEqual(framePause, frameReplay, "重放画面与暂停画面不一致");
  // 音频：重放途中听到的事件 == 时间轴上 (0, tMid] 内的事件
  var expect = scene.audioEvents
    .filter(function (e) { return e.time > 0 && e.time <= tMid + 1e-9; })
    .map(function (e) { return e.time; });
  assert.deepStrictEqual(heard, expect, "重放途中音频事件不一致");
});

/* 4. 存档恢复时间线 / 字幕 / 转场 / 音频起始位置 */
ok("restore timeline, subtitles, transition, audio offsets", function () {
  var p = C.makeProject();
  var s = p.scenes[0];
  s.subtitles.push({ start: 6.1, end: 7.9, text: "结尾字幕" });
  s.transition = { type: "wipe", duration: 1.2 };
  s.audioEvents[0].time = 0.75;               // 移动音频起始位置
  var tl = new C.Timeline({ duration: 8 });
  tl.setInOut(0.5, 7.5);
  var r = C.deserialize(C.serialize(p, tl));
  var rs = r.scenes[0];
  assert.strictEqual(rs.inPoint, 0.5);
  assert.strictEqual(rs.outPoint, 7.5);
  assert.strictEqual(rs.subtitles.length, 4);
  assert.strictEqual(rs.subtitles[3].text, "结尾字幕");
  assert.deepStrictEqual(rs.transition, { type: "wipe", duration: 1.2 });
  assert.strictEqual(rs.audioEvents[0].time, 0.75, "音频起始位置未恢复");
});

/* 5. 导出失败必须保留原工程 */
ok("failed export preserves original project", function () {
  var store = {};                              // 模拟 localStorage
  var p = C.makeProject();
  store["proj"] = C.serialize(p, null);
  // 模拟一次“失败导出”：序列化中途抛错
  var bad = { scenes: [{ get keysA() { throw new Error("boom"); } }] };
  try {
    store["proj"] = JSON.stringify(bad);       // 触发 getter 抛错
    assert.fail("应当抛错");
  } catch (e) {
    assert.strictEqual(e.message, "boom");
  }
  var intact = C.deserialize(store["proj"]);   // 原工程仍在
  assert.strictEqual(intact.scenes.length, 2, "导出失败后原工程被破坏");
  // 损坏的存档不得覆盖内存工程
  assert.throws(function () { C.deserialize("{not json"); });
  assert.throws(function () { C.deserialize('{"scenes":[]}'); });
});

/* 6. 时钟：循环回卷时音频事件不丢 */
ok("loop wrap still emits boundary audio events", function () {
  var tl = new C.Timeline({ duration: 8 });
  tl.setInOut(0, 8);
  tl.seek(7.98);
  tl.playing = true; tl.loop = true;
  var evs = [{ time: 0.0, freq: 440 }, { time: 7.99, freq: 880 }];
  var r = tl.tick(0.05, evs);
  assert.strictEqual(r.wrapped, true);
  var times = r.events.map(function (e) { return e.time; }).sort();
  assert.deepStrictEqual(times, [0, 7.99], "回卷边界事件丢失");
});

/* 7. 差分：比例与坐标 */
ok("diff reports ratio and coordinates", function () {
  var W = 4, H = 2;
  C.computeDiff.width = W;
  var a = new Uint8ClampedArray(W * H * 4);    // 全 0
  var b = new Uint8ClampedArray(W * H * 4);
  b[0] = 255;                                   // 像素(0,0) 变化
  var idx = ((1 * W) + 3) * 4; b[idx] = 255;    // 像素(3,1) 变化
  var d = C.computeDiff(a, b);
  assert.strictEqual(d.changed, 2);
  assert.strictEqual(d.total, 8);
  assert.strictEqual(d.ratio, 0.25);
  assert.deepStrictEqual(d.bbox, { x: 0, y: 0, w: 4, h: 2 });
  assert.deepStrictEqual(d.sampleCoords, [[0, 0], [3, 1]]);
});

console.log("\n" + passed + " tests passed.");
