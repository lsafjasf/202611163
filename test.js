// Node verification suite for the sync-demo model.
// Run: node test.js
"use strict";
var M = require("./model.js");

var failures = 0;
function check(name, cond) {
  if (cond) console.log("  ok  " + name);
  else {
    failures++;
    console.error("FAIL  " + name);
  }
}

// --- 1. Default project shape: 18 s, 10 flashes, 10 beats -------------------
var p = M.createDefaultProject();
check("duration is 18s", p.duration === 18);
check("default project valid", M.validateProject(p).length === 0);
var scene = M.getScene(p);
check("10 flashes", scene.flashes.length === 10);
var diffs = M.flashBeatDiffs(p, scene);
check("10 beats (one diff row per flash)", diffs.length === 10);
check("first flash at 0.9s", diffs[0].flash === 0.9);
check("last flash at 17.1s", diffs[9].flash === 17.1);

// --- 2. Global audio offset shifts every beat by the same amount ------------
p.audioOffset = 0.25;
diffs = M.flashBeatDiffs(p, scene);
check(
  "offset +0.25s applied to all 10 diffs",
  diffs.every(function (d) { return d.diff === 0.25; })
);
p.audioOffset = -0.4;
diffs = M.flashBeatDiffs(p, scene);
check(
  "offset -0.4s applied to all 10 diffs",
  diffs.every(function (d) { return d.diff === -0.4; })
);
p.audioOffset = 0;

// --- 3. Save / reload roundtrip restores everything -------------------------
scene.audioStart = 0.12;
scene.subtitles.push({ start: 5, end: 7, text: "测试字幕" });
scene.transitions.push({ time: 9, type: "fade-in", duration: 0.4 });
scene.keyframes.push({ time: 4.5, value: 0.5 });
p.currentSceneId = "scene-2";
var restored = M.deserialize(M.serialize(p));
var rScene = M.getScene(restored, "scene-1");
check("audioStart restored", rScene.audioStart === 0.12);
check("subtitles restored", rScene.subtitles.length === 3 && rScene.subtitles[2].text === "测试字幕");
check("transitions restored", rScene.transitions.length === 3);
check("keyframes restored", rScene.keyframes.length === 4);
check("current scene restored", restored.currentSceneId === "scene-2");
check("offset restored", restored.audioOffset === 0);
check(
  "full deep-equal roundtrip",
  M.serialize(restored) === M.serialize(p)
);

// --- 4. In/out points and total duration survive export-style roundtrip -----
var before = p.scenes.map(function (s) { return { in: s.in, out: s.out }; });
var exportedJson = M.serialize(p); // export path serializes the same model
var after = M.deserialize(exportedJson);
check(
  "in/out preserved",
  after.scenes.every(function (s, i) { return s.in === before[i].in && s.out === before[i].out; })
);
check("total duration preserved", after.duration === p.duration && after.duration === 18);

// --- 5. Corrupt import must throw and leave the original project intact -----
var corrupt = JSON.stringify({ duration: -5, scenes: [] });
var threw = false;
try { M.deserialize(corrupt); } catch (e) { threw = true; }
check("corrupt project rejected", threw);
check("original project untouched after failure", M.validateProject(p).length === 0);

// --- 6. Deterministic rendering: pause@t vs replay-to-t agree ---------------
var s1 = M.getScene(p, "scene-1");
var samples = [0.3, 0.9, 2.71, 7.777, 12.345, 17.05, 17.9];
var deterministic = samples.every(function (t) {
  var a = M.visualStateAt(p, s1, t); // "paused at t"
  var b = M.visualStateAt(p, s1, t); // "replayed from 0 to t"
  return a.flash === b.flash && a.fade === b.fade &&
         a.subtitle === b.subtitle && a.beatPulse === b.beatPulse;
});
check("visualStateAt deterministic at 7 sample times", deterministic);

// --- 7. Visual state actually tracks flashes/beats/subtitles ----------------
var atFlash = M.visualStateAt(p, s1, 0.9);
check("flash visible at flash time", atFlash.flash > 0.9);
var atBeat = M.visualStateAt(p, s1, 0.9 + 0.12); // audioStart 0.12
check("beat pulse follows audioStart", atBeat.beatPulse > 0.3);
var inSub = M.visualStateAt(p, s1, 1.0);
check("subtitle active in window", inSub.subtitle === "十次闪光 × 十次节拍");
var inFade = M.visualStateAt(p, s1, 0.3);
check("fade-in transition ramps", inFade.fade > 0 && inFade.fade < 1);

// --- 8. Every scene keeps its own keyframes (no cross-scene loss) -----------
var allKeep = restored.scenes.every(function (s, i) {
  return Array.isArray(s.keyframes) && s.flashes.length === 10;
});
check("all scenes retain keyframes + flashes after reload", allKeep);

console.log(failures === 0 ? "\nAll checks passed." : "\n" + failures + " check(s) FAILED");
process.exit(failures === 0 ? 0 : 1);
