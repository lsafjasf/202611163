/* core.js — 纯逻辑层：时间轴时钟、工程模型、关键帧插值、像素差分。
 * 不依赖 DOM / Canvas，可在 Node 中直接测试。 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AnimCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var EPS = 1e-9;

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /* ---------- 时间轴时钟：画面 / 文字 / 声音共用 ---------- */
  function Timeline(opts) {
    opts = opts || {};
    this.duration = opts.duration || 8;
    this.inPoint = opts.inPoint != null ? opts.inPoint : 0;
    this.outPoint = opts.outPoint != null ? opts.outPoint : this.duration;
    this.playhead = clamp(opts.playhead != null ? opts.playhead : this.inPoint, this.inPoint, this.outPoint);
    this.playing = false;
    this.loop = opts.loop !== false;
  }
  Timeline.prototype.range = function () { return Math.max(0, this.outPoint - this.inPoint); };
  Timeline.prototype.setInOut = function (i, o) {
    i = clamp(i, 0, this.duration);
    o = clamp(o, 0, this.duration);
    if (o < i) { var t = i; i = o; o = t; }
    this.inPoint = i; this.outPoint = o;
    this.playhead = clamp(this.playhead, i, o);
  };
  Timeline.prototype.seek = function (t) {
    this.playhead = clamp(t, this.inPoint, this.outPoint);
    return this.playhead;
  };
  /* dt 秒推进；返回本帧跨越的音频事件（含循环回卷） */
  Timeline.prototype.tick = function (dt, audioEvents) {
    if (!this.playing) return { wrapped: false, events: [] };
    var from = this.playhead;
    var to = from + dt;
    var wrapped = false;
    if (to >= this.outPoint - EPS) {
      if (this.loop) {
        to = this.inPoint + ((to - this.inPoint) % Math.max(this.range(), EPS));
        wrapped = true;
      } else {
        to = this.outPoint;
        this.playing = false;
      }
    }
    this.playhead = clamp(to, this.inPoint, this.outPoint);
    var events = collectEvents(audioEvents || [], from, this.playhead, wrapped, this.inPoint, this.outPoint);
    return { wrapped: wrapped, events: events };
  };
  function collectEvents(events, from, to, wrapped, inP, outP) {
    var hit = [];
    for (var k = 0; k < events.length; k++) {
      var e = events[k];
      if (e.time < inP - EPS || e.time > outP + EPS) continue;
      if (wrapped) {
        if (e.time > from + EPS || e.time <= to + EPS) hit.push(e);
      } else if (e.time > from + EPS && e.time <= to + EPS) {
        hit.push(e);
      }
    }
    return hit;
  }

  /* ---------- 关键帧插值 ---------- */
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(t) { return t * t * (3 - 2 * t); }
  function sampleKeys(keys, t) {
    if (!keys.length) return [];
    if (t <= keys[0].t) return keys[0].v.slice();
    var last = keys[keys.length - 1];
    if (t >= last.t) return last.v.slice();
    for (var i = 0; i < keys.length - 1; i++) {
      var a = keys[i], b = keys[i + 1];
      if (t >= a.t && t <= b.t) {
        var f = smooth((t - a.t) / Math.max(b.t - a.t, EPS));
        var out = [];
        for (var j = 0; j < a.v.length; j++) out.push(lerp(a.v[j], b.v[j], f));
        return out;
      }
    }
    return last.v.slice();
  }

  /* ---------- 动画状态：纯函数 f(scene, params, t) ----------
   * 同一 t 任意次求值结果一致（暂停截图 == 从头重放到同一时刻）。 */
  function animState(scene, v, t) {
    var W = scene.width, H = scene.height;
    var g = v[0], radius = v[1], hue = v[2], speed = v[3], trail = v[4];
    var period = Math.max(0.4, 2.2 - speed * 0.18);
    var phase = (t / period) % 1;
    var x = W * 0.12 + (W * 0.76) * phase;
    var floorY = H - 30 - radius;
    var bounceT = (t * (1.2 + speed * 0.35)) % 2;
    var up = bounceT < 1 ? bounceT : 2 - bounceT;
    var y = floorY - (H * 0.55) * (1 - Math.pow(1 - up, 2)) * (g / 120);
    var rot = t * speed * 2.4;
    return {
      x: x, y: y, radius: radius, hue: (hue + t * 12) % 360,
      rot: rot, trail: trail, speed: speed,
      squash: 1 - 0.25 * Math.max(0, 1 - Math.abs(up - 0.02) * 8)
    };
  }

  /* ---------- 像素差分 ---------- */
  function computeDiff(a, b, threshold) {
    threshold = threshold == null ? 12 : threshold;
    var n = Math.min(a.length, b.length);
    var changed = 0;
    var minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
    var width = computeDiff.width, coords = [];
    for (var i = 0; i < n; i += 4) {
      var dr = a[i] - b[i], dg = a[i + 1] - b[i + 1], db = a[i + 2] - b[i + 2];
      if (dr < 0) dr = -dr; if (dg < 0) dg = -dg; if (db < 0) db = -db;
      if (dr + dg + db > threshold * 3) {
        changed++;
        var p = i >> 2, x = p % width, y = (p / width) | 0;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (coords.length < 64) coords.push([x, y]);
      }
    }
    var total = n >> 2;
    return {
      changed: changed, total: total,
      ratio: total ? changed / total : 0,
      bbox: changed ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null,
      sampleCoords: coords
    };
  }

  /* ---------- 工程模型 ---------- */
  var PARAM_NAMES = ["gravity", "radius", "hue", "speed", "trail"];
  function defaultKeys(offset) {
    offset = offset || 0;
    return [
      { t: 0, v: [90 + offset, 22, 200 + offset * 2, 3, 0.5] },
      { t: 2, v: [120, 30, 260 + offset * 2, 5, 0.7] },
      { t: 5, v: [70, 18, 320, 2.5 + offset * 0.05, 0.4] },
      { t: 8, v: [100 + offset, 26, 180 + offset * 3, 4, 0.6] }
    ];
  }
  function makeScene(name, hueBase) {
    return {
      name: name, width: 480, height: 270, duration: 8,
      inPoint: 0, outPoint: 8,
      keysA: defaultKeys(0),
      keysB: defaultKeys(25),
      subtitles: [
        { start: 0.5, end: 2.5, text: "场景：" + name },
        { start: 3.0, end: 5.0, text: "参数组 A / B 同步渲染" },
        { start: 5.5, end: 7.5, text: "差分视图标出变化像素" }
      ],
      transition: { type: "fade", duration: 0.6 },
      audioEvents: [
        { time: 0.0, freq: 440, dur: 0.18, kind: "beep" },
        { time: 2.0, freq: 554, dur: 0.18, kind: "beep" },
        { time: 4.0, freq: 659, dur: 0.18, kind: "beep" },
        { time: 6.0, freq: 880, dur: 0.25, kind: "beep" }
      ],
      hueBase: hueBase || 0
    };
  }
  function makeProject() {
    return {
      version: 1,
      savedAt: 0,
      scenes: [makeScene("弹跳球", 0), makeScene("弹跳球·夜景", 120)],
      activeScene: 0,
      playhead: 0,
      loop: true
    };
  }

  /* ---------- 序列化 / 反序列化（存档不丢关键帧） ---------- */
  function serialize(project, timeline) {
    var p = JSON.parse(JSON.stringify(project));
    p.savedAt = Date.now();
    if (timeline) {
      var s = p.scenes[p.activeScene];
      s.inPoint = timeline.inPoint;
      s.outPoint = timeline.outPoint;
      s.duration = timeline.duration;
      p.playhead = timeline.playhead;
      p.loop = timeline.loop;
    }
    return JSON.stringify(p);
  }
  function deserialize(json) {
    var p = JSON.parse(json);
    if (!p || !Array.isArray(p.scenes) || !p.scenes.length) throw new Error("invalid project");
    for (var i = 0; i < p.scenes.length; i++) {
      var s = p.scenes[i];
      if (!Array.isArray(s.keysA) || !Array.isArray(s.keysB)) throw new Error("missing keyframes");
      if (typeof s.inPoint !== "number") s.inPoint = 0;
      if (typeof s.outPoint !== "number") s.outPoint = s.duration;
      if (!Array.isArray(s.subtitles)) s.subtitles = [];
      if (!Array.isArray(s.audioEvents)) s.audioEvents = [];
      if (!s.transition) s.transition = { type: "fade", duration: 0.6 };
    }
    if (typeof p.activeScene !== "number" || !p.scenes[p.activeScene]) p.activeScene = 0;
    return p;
  }

  return {
    Timeline: Timeline,
    sampleKeys: sampleKeys,
    animState: animState,
    computeDiff: computeDiff,
    makeProject: makeProject,
    makeScene: makeScene,
    serialize: serialize,
    deserialize: deserialize,
    PARAM_NAMES: PARAM_NAMES,
    clamp: clamp
  };
});
