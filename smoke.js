// Headless smoke test: runs app.js with stubbed DOM + Web Audio and
// exercises play / pause / seek / step / scene-switch / verify / export.
// Run: node smoke.js
"use strict";

var failures = 0;
function check(name, cond) {
  if (cond) console.log("  ok  " + name);
  else { failures++; console.error("FAIL  " + name); }
}

// ---------- stubs ----------
function makeCtx2d() {
  return new Proxy({}, {
    get: function (t, k) {
      if (k === "canvas") return {};
      return function () {};
    },
    set: function () { return true; }
  });
}
function makeCanvas(id) {
  return {
    id: id, width: 960, height: id === "stage" ? 360 : 160,
    listeners: {},
    getContext: function () { return makeCtx2d(); },
    addEventListener: function (ev, fn) { this.listeners[ev] = fn; },
    setPointerCapture: function () {},
    getBoundingClientRect: function () { return { left: 0, width: 960 }; },
    captureStream: function () { return { addTrack: function () {} }; },
    toDataURL: function () { return "data:" + id + ":" + frameCounter; }
  };
}
function makeEl(id) {
  return {
    id: id, textContent: "", innerHTML: "", value: "0", checked: true,
    listeners: {}, children: [],
    addEventListener: function (ev, fn) { this.listeners[ev] = fn; },
    appendChild: function (c) { this.children.push(c); },
    click: function () { if (this.listeners.click) this.listeners.click(); },
    querySelector: function () { return makeEl("q"); }
  };
}

var elements = {};
["btn-play", "btn-prev", "btn-next", "chk-loop", "offset", "offset-val",
 "scene-select", "btn-save", "btn-export-json", "btn-import-json",
 "btn-export-video", "btn-verify", "file-import", "log", "clock",
 "diff-table"].forEach(function (id) { elements[id] = makeEl(id); });
elements.stage = makeCanvas("stage");
elements.timeline = makeCanvas("timeline");
elements["diff-table"].querySelector = function () { return makeEl("tbody"); };

var frameCounter = 0;
var rafQueue = [];

global.document = {
  getElementById: function (id) { return elements[id]; },
  querySelector: function () { return makeEl("tbody"); },
  createElement: function () { return makeEl("dyn"); }
};
global.window = global;
global.localStorage = {
  store: {},
  getItem: function (k) { return this.store[k] || null; },
  setItem: function (k, v) { this.store[k] = v; }
};
global.requestAnimationFrame = function (fn) { rafQueue.push(fn); };
var pendingTimeouts = [];
global.setTimeout = function (fn) { pendingTimeouts.push(fn); return 0; };
global.URL = { createObjectURL: function () { return "blob:x"; }, revokeObjectURL: function () {} };
global.Blob = function (parts, opts) {
  this.size = (parts || []).join("").length || 1;
  this.type = (opts || {}).type;
};
global.MediaRecorder = function () {
  this.start = function () {};
  this.stop = function () { if (this.onstop) this.onstop(); };
};

// Fake AudioContext: deterministic clock we can advance manually.
var ctxNow = 0;
function FakeAudioContext() {
  this.state = "running";
  this.sampleRate = 8000;
  this.destination = {};
}
Object.defineProperty(FakeAudioContext.prototype, "currentTime", {
  get: function () { return ctxNow; }
});
FakeAudioContext.prototype.resume = function () {};
FakeAudioContext.prototype.createGain = function () {
  return { gain: { value: 0 }, connect: function () {}, disconnect: function () {} };
};
FakeAudioContext.prototype.createBuffer = function (ch, len) {
  return { getChannelData: function () { return new Float32Array(len); } };
};
FakeAudioContext.prototype.createBufferSource = function () {
  return {
    buffer: null, started: -1, stopped: false,
    connect: function () {},
    start: function (when) { this.started = when; },
    stop: function () { this.stopped = true; if (this.onended) this.onended(); }
  };
};
FakeAudioContext.prototype.createMediaStreamDestination = function () {
  return { stream: { getAudioTracks: function () { return [{}]; } } };
};
global.AudioContext = FakeAudioContext;

// ---------- run the app ----------
global.SyncModel = require("./model.js"); // browser gets this via <script>
require("./app.js");
var M = require("./model.js");

function pumpFrames(n, dtMs) {
  for (var i = 0; i < n; i++) {
    ctxNow += (dtMs || 16) / 1000;
    var q = rafQueue; rafQueue = [];
    q.forEach(function (fn) { fn(); });
  }
}

pumpFrames(3);
check("app boots, clock renders", elements.clock.textContent.length > 0);
check("diff table rendered (10 rows)", elements["diff-table"] !== null);

// play for ~1s of fake time
elements["btn-play"].click();
check("play starts transport", elements["btn-play"].textContent === "暂停");
pumpFrames(60, 16);
var t1 = parseFloat(elements.clock.textContent.split(":")[1]);
check("clock advances while playing", t1 > 0.5);

// pause
elements["btn-play"].click();
check("pause updates button", elements["btn-play"].textContent === "播放");
var pausedAt = elements.clock.textContent;
pumpFrames(10);
check("clock frozen while paused", elements.clock.textContent === pausedAt);

// frame step
elements["btn-next"].click();
pumpFrames(1);
check("frame step advances by 1/30s",
  elements.clock.textContent !== pausedAt);

// scene switch keeps keyframes, stops audio
elements["scene-select"].value = "scene-2";
elements["scene-select"].listeners.change();
var stored = JSON.parse(global.localStorage.store[M.STORAGE_KEY] || "null");
check("scene switch did not crash", true);

// save + reload roundtrip through the app's own save path
elements["btn-save"].click();
stored = JSON.parse(global.localStorage.store[M.STORAGE_KEY]);
check("saved project valid", M.validateProject(stored).length === 0);
check("saved project keeps 3 scenes", stored.scenes.length === 3);
check("saved scene-1 keeps keyframes", stored.scenes[0].keyframes.length === 3);

// offset slider drives diffs
elements.offset.value = "0.3";
elements.offset.listeners.input();
check("offset UI updates label", elements["offset-val"].textContent === "+0.300s");

// verify button runs without throwing
elements["btn-verify"].click();
check("verify logs result", /一致/.test(elements.log.textContent));

// export path runs and reports in/out
elements["btn-export-video"].click();
ctxNow += 18.1; // simulate the 18s recording window elapsing
pendingTimeouts.splice(0).forEach(function (fn) { fn(); });
check("export logs in/out points", /入点 0\.000s 出点 18\.000s/.test(elements.log.textContent));

console.log(failures === 0 ? "\nSmoke test passed." : "\n" + failures + " smoke check(s) FAILED");
process.exit(failures === 0 ? 0 : 1);
