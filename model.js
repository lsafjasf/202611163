// Pure project model: shared by the browser app and the Node test suite.
// No DOM / Web Audio dependencies live here.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SyncModel = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var PROJECT_VERSION = 1;
  var STORAGE_KEY = "sync-demo-project-v1";

  function round6(x) {
    return Math.round(x * 1e6) / 1e6;
  }

  // Ten flashes evenly spaced across the 18 s timeline.
  function defaultFlashes(duration, count) {
    var flashes = [];
    var step = duration / count;
    for (var i = 0; i < count; i++) flashes.push(round6(step * (i + 0.5)));
    return flashes;
  }

  function makeScene(id, name, inPoint, outPoint, hue) {
    var duration = outPoint - inPoint;
    return {
      id: id,
      name: name,
      in: inPoint,
      out: outPoint,
      hue: hue,
      flashes: defaultFlashes(duration, 10), // scene-local times
      subtitles: [],
      transitions: [],
      audioStart: 0, // extra per-scene audio lead/lag in seconds
      keyframes: [] // generic keyframe track, must survive scene switches
    };
  }

  function createDefaultProject() {
    var scenes = [
      makeScene("scene-1", "场景一", 0, 18, 210),
      makeScene("scene-2", "场景二", 0, 18, 130),
      makeScene("scene-3", "场景三", 0, 18, 20)
    ];
    scenes[0].subtitles.push({ start: 0.5, end: 3.5, text: "十次闪光 × 十次节拍" });
    scenes[0].subtitles.push({ start: 15.5, end: 17.8, text: "尾声" });
    scenes[0].transitions.push({ time: 0, type: "fade-in", duration: 0.6 });
    scenes[0].transitions.push({ time: 17.4, type: "fade-out", duration: 0.6 });
    scenes[0].keyframes.push({ time: 0, value: 0 }, { time: 9, value: 1 }, { time: 18, value: 0 });
    return {
      version: PROJECT_VERSION,
      duration: 18,
      fps: 30,
      loop: true,
      audioOffset: 0, // global audio shift in seconds, user adjustable
      currentSceneId: "scene-1",
      scenes: scenes
    };
  }

  function getScene(project, sceneId) {
    var id = sceneId || project.currentSceneId;
    for (var i = 0; i < project.scenes.length; i++) {
      if (project.scenes[i].id === id) return project.scenes[i];
    }
    return null;
  }

  // Absolute timeline time of flash i in a scene.
  function flashTime(scene, i) {
    return round6(scene.in + scene.flashes[i]);
  }

  // Absolute timeline time of beat i: flash grid + global offset + scene audio start.
  function beatTime(project, scene, i) {
    return round6(scene.in + scene.audioStart + project.audioOffset + scene.flashes[i]);
  }

  // Per-flash signed difference (beat - flash), in seconds.
  function flashBeatDiffs(project, scene) {
    var diffs = [];
    for (var i = 0; i < scene.flashes.length; i++) {
      diffs.push({
        index: i,
        flash: flashTime(scene, i),
        beat: beatTime(project, scene, i),
        diff: round6(beatTime(project, scene, i) - flashTime(scene, i))
      });
    }
    return diffs;
  }

  function validateProject(p) {
    var errors = [];
    if (!p || typeof p !== "object") errors.push("project is not an object");
    else {
      if (!(p.duration > 0)) errors.push("duration must be > 0");
      if (!(p.fps > 0)) errors.push("fps must be > 0");
      if (!Array.isArray(p.scenes) || p.scenes.length === 0) errors.push("no scenes");
      else {
        p.scenes.forEach(function (s, idx) {
          if (!(s.out > s.in)) errors.push("scene " + idx + ": out must be > in");
          if (s.out - s.in > p.duration + 1e-9)
            errors.push("scene " + idx + ": scene longer than project");
          if (!Array.isArray(s.flashes) || s.flashes.length !== 10)
            errors.push("scene " + idx + ": needs exactly 10 flashes");
          (s.flashes || []).forEach(function (f) {
            if (f < 0 || f > s.out - s.in) errors.push("scene " + idx + ": flash out of range");
          });
        });
        if (!getScene(p)) errors.push("currentSceneId not found");
      }
    }
    return errors;
  }

  function serialize(project) {
    return JSON.stringify(project);
  }

  // Parse + validate + normalize. Throws on hard failure so callers can
  // keep the previous project untouched (export/save failure safety).
  function deserialize(json) {
    var p = JSON.parse(json);
    var errors = validateProject(p);
    if (errors.length) throw new Error("invalid project: " + errors.join("; "));
    p.scenes.forEach(function (s) {
      s.subtitles = s.subtitles || [];
      s.transitions = s.transitions || [];
      s.keyframes = s.keyframes || [];
      s.audioStart = s.audioStart || 0;
    });
    p.audioOffset = p.audioOffset || 0;
    p.loop = p.loop !== false;
    return p;
  }

  // Deterministic visual state at time t (scene-local seconds).
  // Both the canvas renderer and the reproducibility test use this,
  // so "pause & screenshot" vs "replay to same t" cannot diverge.
  function visualStateAt(project, scene, t) {
    var flash = 0;
    for (var i = 0; i < scene.flashes.length; i++) {
      var dt = t - scene.flashes[i];
      if (dt >= 0 && dt < 0.35) flash = Math.max(flash, 1 - dt / 0.35);
    }
    var fade = 1;
    scene.transitions.forEach(function (tr) {
      if (tr.type === "fade-in" && t >= tr.time && t < tr.time + tr.duration) {
        fade = Math.min(fade, (t - tr.time) / tr.duration);
      } else if (tr.type === "fade-out" && t >= tr.time && t < tr.time + tr.duration) {
        fade = Math.min(fade, 1 - (t - tr.time) / tr.duration);
      }
    });
    var subtitle = null;
    scene.subtitles.forEach(function (s) {
      if (t >= s.start && t < s.end) subtitle = s.text;
    });
    var beatPulse = 0;
    for (var j = 0; j < scene.flashes.length; j++) {
      var bt = scene.audioStart + project.audioOffset + scene.flashes[j];
      var bd = t - bt;
      if (bd >= 0 && bd < 0.2) beatPulse = Math.max(beatPulse, 1 - bd / 0.2);
    }
    return { flash: flash, fade: fade, subtitle: subtitle, beatPulse: beatPulse };
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    createDefaultProject: createDefaultProject,
    getScene: getScene,
    flashTime: flashTime,
    beatTime: beatTime,
    flashBeatDiffs: flashBeatDiffs,
    validateProject: validateProject,
    serialize: serialize,
    deserialize: deserialize,
    visualStateAt: visualStateAt,
    round6: round6
  };
});
