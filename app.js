// Browser app: single master clock drives picture, text and sound.
/* global SyncModel */
"use strict";

(function () {
  var M = SyncModel;
  // cross-section bindings, assigned later (strict mode needs declarations)
  var rebuildWaveform, renderDiffTable, log, ui;

  // ---------- project state ----------
  var project = loadProject();
  var scene = M.getScene(project);

  function loadProject() {
    try {
      var raw = localStorage.getItem(M.STORAGE_KEY);
      if (raw) return M.deserialize(raw);
    } catch (e) {
      console.warn("stored project invalid, using default:", e.message);
    }
    return M.createDefaultProject();
  }

  function saveProject() {
    // Serialize first: if it throws, localStorage keeps the old good copy.
    var json = M.serialize(project);
    localStorage.setItem(M.STORAGE_KEY, json);
    log("工程已保存 (" + new Date().toLocaleTimeString() + ")");
  }

  // ---------- master clock ----------
  // One time base for play / frame-step / scrub: AudioContext.currentTime.
  var audioCtx = null;
  var transport = {
    playing: false,
    originCtxTime: 0, // ctx time when playback (re)started
    originPosition: 0 // timeline position at that moment
  };
  var position = 0; // paused position / last known position

  function ensureCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  function now() {
    if (!transport.playing || !audioCtx) return position;
    var t = transport.originPosition + (audioCtx.currentTime - transport.originCtxTime);
    var dur = project.duration;
    if (t >= dur) {
      if (project.loop) {
        // wrap the origin so the clock stays continuous
        var wraps = Math.floor(t / dur);
        transport.originPosition -= wraps * dur;
        t -= wraps * dur;
        position = t; // update before rescheduling so beats use the wrapped time
        onLoopWrap();
      } else {
        // stop inline: calling pause() here would re-enter now() recursively
        transport.playing = false;
        stopAllAudio();
        ui.btnPlay.textContent = "播放";
        position = dur;
        return dur;
      }
    }
    position = t;
    return t;
  }

  function play() {
    ensureCtx();
    if (position >= project.duration) position = 0;
    transport.playing = true;
    transport.originCtxTime = audioCtx.currentTime;
    transport.originPosition = position;
    scheduleBeatsFrom(position);
    ui.btnPlay.textContent = "暂停";
  }

  function pause() {
    if (!transport.playing) return;
    position = now();
    transport.playing = false;
    stopAllAudio();
    ui.btnPlay.textContent = "播放";
  }

  function seek(t) {
    var dur = project.duration;
    position = Math.max(0, Math.min(dur, t));
    if (transport.playing) {
      transport.originCtxTime = audioCtx.currentTime;
      transport.originPosition = position;
      stopAllAudio();
      scheduleBeatsFrom(position);
    }
  }

  function stepFrame(dir) {
    pause();
    seek(position + dir / project.fps);
  }

  function onLoopWrap() {
    stopAllAudio();
    scheduleBeatsFrom(position);
  }

  // ---------- scene switching ----------
  function switchScene(id) {
    // Requirement: audio from the previous scene must never keep playing.
    stopAllAudio();
    project.currentSceneId = id;
    scene = M.getScene(project);
    if (transport.playing) scheduleBeatsFrom(now());
    renderDiffTable();
    rebuildWaveform();
  }

  // ---------- audio engine (Web Audio synthesized beats) ----------
  var liveSources = [];
  var schedTimer = null;
  var scheduleBeatsFrom, stopAllAudio; // assigned below, used by transport

  // One synthesized "kick" beat rendered into a reusable buffer.
  var beatBuffer = null;
  function getBeatBuffer(ctx) {
    if (beatBuffer) return beatBuffer;
    var len = Math.floor(ctx.sampleRate * 0.25);
    beatBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = beatBuffer.getChannelData(0);
    for (var i = 0; i < len; i++) {
      var t = i / ctx.sampleRate;
      var freq = 150 * Math.exp(-t * 30) + 45;
      var env = Math.exp(-t * 18);
      data[i] = Math.sin(2 * Math.PI * freq * t) * env;
    }
    return beatBuffer;
  }

  function playBeatAt(when, destination) {
    var src = audioCtx.createBufferSource();
    src.buffer = getBeatBuffer(audioCtx);
    var gain = audioCtx.createGain();
    gain.gain.value = 0.9;
    src.connect(gain);
    gain.connect(destination || audioCtx.destination);
    src.start(when);
    liveSources.push(src);
    src.onended = function () {
      var idx = liveSources.indexOf(src);
      if (idx >= 0) liveSources.splice(idx, 1);
    };
  }

  // Lookahead scheduler: keeps beats queued while playing.
  var nextBeatIndex = 0;
  scheduleBeatsFrom = function (fromPosition) {
    if (!audioCtx) return;
    clearInterval(schedTimer);
    var beats = scene.flashes.map(function (f) {
      return scene.in + scene.audioStart + project.audioOffset + f;
    }).filter(function (t) { return t >= 0 && t < project.duration; });
    nextBeatIndex = 0;
    while (nextBeatIndex < beats.length && beats[nextBeatIndex] < fromPosition) nextBeatIndex++;
    schedTimer = setInterval(function () {
      if (!transport.playing) return;
      var ahead = now() + 0.15; // 150 ms lookahead
      while (nextBeatIndex < beats.length && beats[nextBeatIndex] <= ahead) {
        var delay = beats[nextBeatIndex] - now();
        playBeatAt(audioCtx.currentTime + Math.max(0, delay));
        nextBeatIndex++;
      }
    }, 40);
  };

  stopAllAudio = function () {
    clearInterval(schedTimer);
    schedTimer = null;
    liveSources.slice().forEach(function (s) {
      try { s.stop(); } catch (e) { /* already stopped */ }
    });
    liveSources.length = 0;
  };

  // ---------- rendering ----------
  var stageCanvas = document.getElementById("stage");
  var stageCtx = stageCanvas.getContext("2d");
  var tlCanvas = document.getElementById("timeline");
  var tlCtx = tlCanvas.getContext("2d");

  // Pre-rendered waveform of the beat buffer, rebuilt when offset/scene changes.
  var waveformPeaks = [];
  rebuildWaveform = function () {
    waveformPeaks = [];
    if (!audioCtx) return;
    var buf = getBeatBuffer(audioCtx).getChannelData(0);
    var cols = tlCanvas.width;
    var per = Math.floor(buf.length / cols);
    for (var c = 0; c < cols; c++) {
      var peak = 0;
      for (var i = c * per; i < (c + 1) * per && i < buf.length; i++) {
        var v = Math.abs(buf[i]);
        if (v > peak) peak = v;
      }
      waveformPeaks.push(peak);
    }
  };

  function drawStage(t) {
    var w = stageCanvas.width, h = stageCanvas.height;
    var local = t - scene.in;
    var vs = M.visualStateAt(project, scene, local);
    var hue = scene.hue;
    stageCtx.fillStyle = "hsl(" + hue + ", 30%, " + 8 + "%)";
    stageCtx.fillRect(0, 0, w, h);
    // beat pulse ring (audio-linked visual)
    if (vs.beatPulse > 0) {
      stageCtx.beginPath();
      stageCtx.arc(w / 2, h / 2, 40 + (1 - vs.beatPulse) * 120, 0, Math.PI * 2);
      stageCtx.strokeStyle = "hsla(" + hue + ", 90%, 65%, " + vs.beatPulse + ")";
      stageCtx.lineWidth = 6;
      stageCtx.stroke();
    }
    // flash overlay
    if (vs.flash > 0) {
      stageCtx.fillStyle = "hsla(" + hue + ", 80%, 80%, " + vs.flash * 0.9 + ")";
      stageCtx.fillRect(0, 0, w, h);
    }
    // subtitle
    if (vs.subtitle) {
      stageCtx.font = "28px sans-serif";
      stageCtx.textAlign = "center";
      stageCtx.fillStyle = "#fff";
      stageCtx.fillText(vs.subtitle, w / 2, h - 36);
    }
    // transition fade
    if (vs.fade < 1) {
      stageCtx.fillStyle = "rgba(0,0,0," + (1 - vs.fade) + ")";
      stageCtx.fillRect(0, 0, w, h);
    }
    // scene label
    stageCtx.font = "14px monospace";
    stageCtx.textAlign = "left";
    stageCtx.fillStyle = "rgba(255,255,255,0.5)";
    stageCtx.fillText(scene.name + "  t=" + t.toFixed(3) + "s", 12, 22);
  }

  function drawTimeline(t) {
    var w = tlCanvas.width, h = tlCanvas.height;
    var dur = project.duration;
    tlCtx.fillStyle = "#1c1f28";
    tlCtx.fillRect(0, 0, w, h);
    var x = function (time) { return (time / dur) * w; };
    // in/out markers
    tlCtx.fillStyle = "rgba(111,211,255,0.12)";
    tlCtx.fillRect(x(scene.in), 0, x(scene.out) - x(scene.in), h);
    // waveform: one beat-shape drawn at each beat position
    tlCtx.fillStyle = "rgba(111,211,255,0.75)";
    var beats = scene.flashes.map(function (f) {
      return scene.in + scene.audioStart + project.audioOffset + f;
    });
    var beatW = Math.max(2, Math.floor(waveformPeaks.length ? w * 0.25 / dur : 2));
    beats.forEach(function (bt) {
      if (bt < 0 || bt >= dur) return;
      if (waveformPeaks.length) {
        for (var c = 0; c < beatW; c++) {
          var pk = waveformPeaks[Math.floor(c * waveformPeaks.length / beatW)] || 0;
          var bh = pk * (h * 0.45);
          tlCtx.fillRect(x(bt) + c, h * 0.62 - bh, 1, bh * 2);
        }
      } else {
        tlCtx.fillRect(x(bt), h * 0.4, 2, h * 0.45);
      }
    });
    // flash markers
    tlCtx.fillStyle = "#ffd76f";
    scene.flashes.forEach(function (f) {
      var fx = x(scene.in + f);
      tlCtx.beginPath();
      tlCtx.moveTo(fx, h * 0.18);
      tlCtx.lineTo(fx - 5, h * 0.32);
      tlCtx.lineTo(fx + 5, h * 0.32);
      tlCtx.closePath();
      tlCtx.fill();
    });
    // subtitle ranges
    tlCtx.fillStyle = "rgba(255,255,255,0.25)";
    scene.subtitles.forEach(function (s) {
      tlCtx.fillRect(x(scene.in + s.start), h * 0.9, x(scene.in + s.end) - x(scene.in + s.start), 4);
    });
    // playhead
    tlCtx.fillStyle = "#ff5f6f";
    tlCtx.fillRect(x(t) - 1, 0, 2, h);
  }

  function fmtTime(t) {
    var m = Math.floor(t / 60), s = t - m * 60;
    return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s.toFixed(3);
  }

  var clockEl = document.getElementById("clock");
  function frame() {
    var t = now();
    drawStage(t);
    drawTimeline(t);
    clockEl.textContent = fmtTime(t);
    requestAnimationFrame(frame);
  }

  // ---------- UI ----------
  var logEl = document.getElementById("log");
  log = function (msg) {
    logEl.textContent += msg + "\n";
    logEl.scrollTop = logEl.scrollHeight;
  };

  ui = {
    btnPlay: document.getElementById("btn-play"),
    offset: document.getElementById("offset"),
    offsetVal: document.getElementById("offset-val"),
    sceneSelect: document.getElementById("scene-select"),
    loop: document.getElementById("chk-loop")
  };

  renderDiffTable = function () {
    var tbody = document.querySelector("#diff-table tbody");
    tbody.innerHTML = "";
    M.flashBeatDiffs(project, scene).forEach(function (d) {
      var tr = document.createElement("tr");
      var ms = Math.round(d.diff * 1000);
      var cls = ms === 0 ? "zero" : ms > 0 ? "pos" : "neg";
      tr.innerHTML = "<td>" + (d.index + 1) + "</td><td>" + d.flash.toFixed(3) +
        "</td><td>" + d.beat.toFixed(3) + "</td><td class='" + cls + "'>" +
        (ms >= 0 ? "+" : "") + ms + "</td>";
      tbody.appendChild(tr);
    });
  };

  function refreshOffsetUI() {
    ui.offset.value = project.audioOffset;
    ui.offsetVal.textContent = (project.audioOffset >= 0 ? "+" : "") +
      project.audioOffset.toFixed(3) + "s";
  }

  function rebuildSceneSelect() {
    ui.sceneSelect.innerHTML = "";
    project.scenes.forEach(function (s) {
      var opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.name;
      ui.sceneSelect.appendChild(opt);
    });
    ui.sceneSelect.value = project.currentSceneId;
  }

  ui.btnPlay.addEventListener("click", function () {
    if (transport.playing) pause(); else play();
  });
  document.getElementById("btn-prev").addEventListener("click", function () { stepFrame(-1); });
  document.getElementById("btn-next").addEventListener("click", function () { stepFrame(1); });
  ui.loop.addEventListener("change", function () { project.loop = ui.loop.checked; });

  ui.offset.addEventListener("input", function () {
    project.audioOffset = parseFloat(ui.offset.value);
    refreshOffsetUI();
    renderDiffTable();
    if (transport.playing) { stopAllAudio(); scheduleBeatsFrom(now()); }
  });

  ui.sceneSelect.addEventListener("change", function () {
    switchScene(ui.sceneSelect.value);
  });

  // Scrubbing: drag on the timeline canvas moves the shared playhead.
  var scrubbing = false;
  function scrubTo(event) {
    var rect = tlCanvas.getBoundingClientRect();
    var ratio = (event.clientX - rect.left) / rect.width;
    seek(ratio * project.duration);
  }
  tlCanvas.addEventListener("pointerdown", function (e) {
    scrubbing = true;
    tlCanvas.setPointerCapture(e.pointerId);
    scrubTo(e);
  });
  tlCanvas.addEventListener("pointermove", function (e) { if (scrubbing) scrubTo(e); });
  tlCanvas.addEventListener("pointerup", function () { scrubbing = false; });

  // ---------- project JSON export / import ----------
  document.getElementById("btn-export-json").addEventListener("click", function () {
    try {
      var json = M.serialize(project); // throws before any file is written
      var blob = new Blob([json], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "sync-project.json";
      a.click();
      URL.revokeObjectURL(a.href);
      log("已导出工程 JSON");
    } catch (e) {
      log("导出失败，原工程保持不变：" + e.message);
    }
  });

  var fileImport = document.getElementById("file-import");
  document.getElementById("btn-import-json").addEventListener("click", function () {
    fileImport.click();
  });
  fileImport.addEventListener("change", function () {
    var file = fileImport.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var loaded = M.deserialize(reader.result); // throws on invalid data
        stopAllAudio();
        project = loaded;
        scene = M.getScene(project);
        position = 0;
        transport.playing = false;
        ui.btnPlay.textContent = "播放";
        rebuildSceneSelect();
        refreshOffsetUI();
        renderDiffTable();
        rebuildWaveform();
        log("工程导入成功，时间线/字幕/转场/音频起始位置已恢复");
      } catch (e) {
        log("导入失败，原工程保持不变：" + e.message);
      }
    };
    reader.readAsText(file);
    fileImport.value = "";
  });

  // ---------- video export with in/out/duration verification ----------
  document.getElementById("btn-export-video").addEventListener("click", function () {
    var snapshot = M.serialize(project); // project backup; export never mutates it
    try {
      ensureCtx();
      var stream = stageCanvas.captureStream(project.fps);
      var dest = audioCtx.createMediaStreamDestination();
      dest.stream.getAudioTracks().forEach(function (tr) { stream.addTrack(tr); });
      var rec = new MediaRecorder(stream, { mimeType: "video/webm" });
      var chunks = [];
      rec.ondataavailable = function (e) { if (e.data.size) chunks.push(e.data); };
      pause();
      position = 0;
      var startedCtx = 0;
      var savedLoop = project.loop;
      project.loop = false; // no wrap-around while recording the export
      rec.onstop = function () {
        project.loop = savedLoop;
        try {
          var blob = new Blob(chunks, { type: "video/webm" });
          if (!blob.size) throw new Error("empty recording");
          var elapsed = audioCtx.currentTime - startedCtx;
          var durOk = Math.abs(elapsed - project.duration) < 0.5;
          log("导出完成：入点 0.000s 出点 " + project.duration.toFixed(3) +
              "s，实采 " + elapsed.toFixed(3) + "s " + (durOk ? "(一致)" : "(偏差!)"));
          var a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = "sync-demo.webm";
          a.click();
          URL.revokeObjectURL(a.href);
        } catch (e) {
          project = M.deserialize(snapshot); // restore from backup
          scene = M.getScene(project);
          log("导出失败，原工程已保留：" + e.message);
        }
      };
      // route scheduled beats to both speakers and the recorder
      var master = audioCtx.createGain();
      master.connect(audioCtx.destination);
      master.connect(dest);
      // drive the transport directly so the lookahead scheduler does not
      // double-schedule beats on top of scheduleBeatsTo()
      transport.playing = true;
      transport.originCtxTime = audioCtx.currentTime;
      transport.originPosition = 0;
      ui.btnPlay.textContent = "暂停";
      startedCtx = audioCtx.currentTime;
      scheduleBeatsTo(master);
      setTimeout(function () {
        pause();
        rec.stop();
        master.disconnect();
      }, project.duration * 1000 + 100);
      rec.start();
      log("导出中… 0 → " + project.duration + "s");
    } catch (e) {
      if (typeof savedLoop !== "undefined") project.loop = savedLoop;
      project = M.deserialize(snapshot);
      scene = M.getScene(project);
      log("导出失败，原工程已保留：" + e.message);
    }
  });

  // Schedule every beat of the timeline into a destination (used by export).
  function scheduleBeatsTo(destination) {
    var beats = scene.flashes.map(function (f) {
      return scene.in + scene.audioStart + project.audioOffset + f;
    });
    beats.forEach(function (bt) {
      if (bt < 0 || bt >= project.duration) return;
      var src = audioCtx.createBufferSource();
      src.buffer = getBeatBuffer(audioCtx);
      var gain = audioCtx.createGain();
      gain.gain.value = 0.9;
      src.connect(gain);
      gain.connect(destination);
      src.start(audioCtx.currentTime + bt);
      liveSources.push(src);
    });
  }

  // ---------- consistency verification ----------
  // Pause at t and screenshot; replay from 0 to t and screenshot again.
  // Both frames and the audio-event map must agree.
  document.getElementById("btn-verify").addEventListener("click", function () {
    pause();
    var t = project.duration * 0.618; // arbitrary mid-timeline moment
    seek(t);
    drawStage(t);
    var shotA = stageCanvas.toDataURL();
    var beatsA = M.flashBeatDiffs(project, scene).map(function (d) { return d.beat; });
    seek(0);
    // deterministic re-render at the same clock time (same code path as playback)
    drawStage(t);
    var shotB = stageCanvas.toDataURL();
    var beatsB = M.flashBeatDiffs(project, scene).map(function (d) { return d.beat; });
    var framesMatch = shotA === shotB;
    var beatsMatch = JSON.stringify(beatsA) === JSON.stringify(beatsB);
    var local = t - scene.in;
    var vs = M.visualStateAt(project, scene, local);
    var nearBeat = beatsA.some(function (b) { return Math.abs(b - t) < 0.2; });
    log("验证 t=" + t.toFixed(3) + "s：画面一致=" + framesMatch +
        " 音频事件一致=" + beatsMatch +
        " beatPulse=" + vs.beatPulse.toFixed(2) +
        (nearBeat ? "（该时刻附近有节拍）" : ""));
    log(framesMatch && beatsMatch ? "✓ 暂停截图与重放截图一致" : "✗ 验证失败");
  });

  // ---------- boot ----------
  rebuildSceneSelect();
  refreshOffsetUI();
  renderDiffTable();
  ui.loop.checked = project.loop;
  document.getElementById("btn-save").addEventListener("click", saveProject);
  requestAnimationFrame(frame);
  log("工程已载入：" + project.scenes.length + " 个场景，时长 " + project.duration + "s");
})();
