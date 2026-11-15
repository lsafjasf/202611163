/* app.js — UI / 渲染 / 音频 / 导出 / 持久化。画面、文字、声音共用 AnimCore.Timeline 时钟。 */
(function () {
  "use strict";
  var C = window.AnimCore;
  var STORE_KEY = "animdiff.project.v1";

  /* ---------- DOM ---------- */
  var $ = function (id) { return document.getElementById(id); };
  var viewA = $("viewA"), viewB = $("viewB"), viewMix = $("viewMix"), viewDiff = $("viewDiff");
  var playBtn = $("playBtn"), loopBtn = $("loopBtn"), scrub = $("scrub");
  var timeLbl = $("timeLbl"), diffStat = $("diffStat"), statusEl = $("status");
  var sceneSel = $("sceneSel"), inPt = $("inPt"), outPt = $("outPt"), durLbl = $("durLbl");

  /* ---------- 状态 ---------- */
  var project = C.makeProject();
  var timeline = new C.Timeline({ duration: scene().duration });
  function scene() { return project.scenes[project.activeScene]; }
  function setStatus(msg) { statusEl.textContent = msg; }

  /* ---------- 音频：与画面共用同一时间轴 ----------
   * 每次 tick 返回本帧跨越的音频事件，立即用 WebAudio 发声。
   * 切场景 / 暂停 / 拖动时 stopAll()，保证上一场景声音不残留。 */
  var Audio = {
    ctx: null, master: null, live: [],
    ensure: function () {
      if (!this.ctx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.25;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === "suspended") this.ctx.resume();
    },
    beep: function (ev) {
      this.ensure();
      var t0 = this.ctx.currentTime;
      var osc = this.ctx.createOscillator();
      var g = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = ev.freq;
      g.gain.setValueAtTime(0.9, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + ev.dur);
      osc.connect(g); g.connect(this.master);
      osc.start(t0); osc.stop(t0 + ev.dur + 0.02);
      this.live.push(osc);
    },
    stopAll: function () {
      for (var i = 0; i < this.live.length; i++) {
        try { this.live[i].stop(); } catch (e) { /* 已停止 */ }
      }
      this.live.length = 0;
    }
  };

  /* ---------- 场景绘制（纯 Canvas，确定性） ---------- */
  function drawScene(ctx, sc, keys, t) {
    var W = sc.width, H = sc.height;
    var v = C.sampleKeys(keys, t);
    var st = C.animState(sc, v, t);
    // 背景
    var grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "hsl(" + ((sc.hueBase + 230) % 360) + ",30%,10%)");
    grad.addColorStop(1, "hsl(" + ((sc.hueBase + 260) % 360) + ",35%,18%)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    // 网格地面
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.beginPath();
    for (var gx = 0; gx <= W; gx += 40) { ctx.moveTo(gx, 0); ctx.lineTo(gx, H); }
    ctx.moveTo(0, H - 30); ctx.lineTo(W, H - 30);
    ctx.stroke();
    // 拖尾
    ctx.save();
    ctx.globalAlpha = 0.35;
    for (var k = 1; k <= 6; k++) {
      var pts = C.animState(sc, v, Math.max(0, t - k * 0.05 * st.trail * 3));
      ctx.fillStyle = "hsl(" + pts.hue + ",70%,55%)";
      ctx.beginPath();
      ctx.arc(pts.x, pts.y, pts.radius * (1 - k * 0.12), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    // 主体球（带旋转标记，便于差分观察）
    ctx.save();
    ctx.translate(st.x, st.y);
    ctx.scale(1, st.squash);
    ctx.rotate(st.rot);
    ctx.fillStyle = "hsl(" + st.hue + ",75%,58%)";
    ctx.beginPath(); ctx.arc(0, 0, st.radius, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(st.radius, 0); ctx.stroke();
    ctx.restore();
    // 字幕（与时间轴同一时钟）
    for (var s = 0; s < sc.subtitles.length; s++) {
      var sub = sc.subtitles[s];
      if (t >= sub.start && t <= sub.end) {
        ctx.font = "16px sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        var tw = ctx.measureText(sub.text).width + 20;
        ctx.fillRect(W / 2 - tw / 2, H - 26, tw, 22);
        ctx.fillStyle = "#fff";
        ctx.fillText(sub.text, W / 2, H - 10);
      }
    }
    // 转场：开头淡入
    var tr = sc.transition;
    if (tr && tr.type === "fade" && t < tr.duration) {
      ctx.fillStyle = "rgba(0,0,0," + (1 - t / tr.duration).toFixed(3) + ")";
      ctx.fillRect(0, 0, W, H);
    }
    // 时间码水印
    ctx.font = "10px monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillText("t=" + t.toFixed(3) + "s", 6, 12);
  }

  /* ---------- 三视图合成 + 差分 ---------- */
  var offA = document.createElement("canvas"), offB = document.createElement("canvas");
  function renderAll(t) {
    var sc = scene();
    offA.width = sc.width; offA.height = sc.height;
    offB.width = sc.width; offB.height = sc.height;
    var ca = offA.getContext("2d"), cb = offB.getContext("2d");
    drawScene(ca, sc, sc.keysA, t);
    drawScene(cb, sc, sc.keysB, t);
    // 原始视图
    viewA.getContext("2d").drawImage(offA, 0, 0);
    viewB.getContext("2d").drawImage(offB, 0, 0);
    // 叠加视图
    var cm = viewMix.getContext("2d");
    cm.globalAlpha = 1; cm.drawImage(offA, 0, 0);
    cm.globalAlpha = 0.5; cm.drawImage(offB, 0, 0);
    cm.globalAlpha = 1;
    // 差分视图
    var da = ca.getImageData(0, 0, sc.width, sc.height);
    var db = cb.getImageData(0, 0, sc.width, sc.height);
    C.computeDiff.width = sc.width;
    var diff = C.computeDiff(da.data, db.data);
    var cd = viewDiff.getContext("2d");
    var out = cd.createImageData(sc.width, sc.height);
    for (var i = 0; i < da.data.length; i += 4) {
      var d0 = Math.abs(da.data[i] - db.data[i]);
      var d1 = Math.abs(da.data[i + 1] - db.data[i + 1]);
      var d2 = Math.abs(da.data[i + 2] - db.data[i + 2]);
      var hot = d0 + d1 + d2 > 36;
      out.data[i] = hot ? 255 : d0;
      out.data[i + 1] = hot ? 40 : d1;
      out.data[i + 2] = hot ? 40 : d2;
      out.data[i + 3] = 255;
    }
    cd.putImageData(out, 0, 0);
    if (diff.bbox) {
      cd.strokeStyle = "#ff4040";
      cd.lineWidth = 1;
      cd.strokeRect(diff.bbox.x - 0.5, diff.bbox.y - 0.5, diff.bbox.w + 1, diff.bbox.h + 1);
    }
    // 差分统计：比例 + 坐标
    var pct = (diff.ratio * 100).toFixed(2) + "%";
    var coordTxt = diff.bbox
      ? " 区域(" + diff.bbox.x + "," + diff.bbox.y + " " + diff.bbox.w + "×" + diff.bbox.h + ")"
        + " 样本" + diff.sampleCoords.slice(0, 3).map(function (c) { return "(" + c[0] + "," + c[1] + ")"; }).join("")
      : "";
    diffStat.textContent = pct + coordTxt;
    // 参数读数
    var va = C.sampleKeys(sc.keysA, t), vb = C.sampleKeys(sc.keysB, t);
    $("paramsA").textContent = "g=" + va[0].toFixed(0) + " r=" + va[1].toFixed(0);
    $("paramsB").textContent = "g=" + vb[0].toFixed(0) + " r=" + vb[1].toFixed(0);
    return diff;
  }

  /* ---------- 主循环：唯一时钟驱动画面 + 声音 ---------- */
  var lastTs = 0;
  function frame(ts) {
    var dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.1) : 0;
    lastTs = ts;
    if (timeline.playing) {
      var r = timeline.tick(dt, scene().audioEvents);
      for (var i = 0; i < r.events.length; i++) Audio.beep(r.events[i]);
      if (!timeline.playing) onPause();
    }
    renderAll(timeline.playhead);
    syncTransport();
    requestAnimationFrame(frame);
  }
  function syncTransport() {
    var sc = scene();
    scrub.max = sc.duration;
    if (document.activeElement !== scrub) scrub.value = timeline.playhead;
    timeLbl.textContent = timeline.playhead.toFixed(3) + " / " + sc.duration.toFixed(3)
      + "  区间[" + timeline.inPoint.toFixed(1) + "," + timeline.outPoint.toFixed(1) + "]";
  }
  function onPlay() {
    Audio.ensure();
    timeline.playing = true;
    playBtn.textContent = "⏸ 暂停";
  }
  function onPause() {
    timeline.playing = false;
    Audio.stopAll();
    playBtn.textContent = "▶ 播放";
  }
  playBtn.addEventListener("click", function () {
    if (timeline.playing) onPause(); else onPlay();
  });
  loopBtn.addEventListener("click", function () {
    timeline.loop = !timeline.loop;
    loopBtn.classList.toggle("active", timeline.loop);
  });
  scrub.addEventListener("input", function () {
    Audio.stopAll();                       // 拖动时不让残响继续
    timeline.seek(parseFloat(scrub.value));
    renderAll(timeline.playhead);
    syncTransport();
  });
  function applyInOut() {
    timeline.setInOut(parseFloat(inPt.value) || 0, parseFloat(outPt.value) || scene().duration);
    renderAll(timeline.playhead);
    syncTransport();
  }
  inPt.addEventListener("change", applyInOut);
  outPt.addEventListener("change", applyInOut);

  /* ---------- 场景切换：停旧声音、不丢关键帧 ---------- */
  function refreshSceneUI() {
    var sc = scene();
    timeline.duration = sc.duration;
    timeline.setInOut(sc.inPoint, sc.outPoint);
    timeline.seek(C.clamp(timeline.playhead, sc.inPoint, sc.outPoint));
    inPt.value = sc.inPoint; outPt.value = sc.outPoint;
    durLbl.textContent = sc.duration.toFixed(1) + "s";
    renderAll(timeline.playhead);
    syncTransport();
  }
  function rebuildSceneSel() {
    sceneSel.innerHTML = "";
    for (var i = 0; i < project.scenes.length; i++) {
      var opt = document.createElement("option");
      opt.value = i; opt.textContent = project.scenes[i].name;
      sceneSel.appendChild(opt);
    }
    sceneSel.value = project.activeScene;
  }
  sceneSel.addEventListener("change", function () {
    onPause();                             // 停止上一场景音频
    project.activeScene = parseInt(sceneSel.value, 10);
    timeline.playhead = scene().inPoint;   // 新场景从入点开始
    refreshSceneUI();
    setStatus("已切换到场景「" + scene().name + "」，关键帧 "
      + scene().keysA.length + "/" + scene().keysB.length + " 个已保留。");
  });

  /* ---------- 保存 / 载入 ---------- */
  $("saveBtn").addEventListener("click", function () {
    try {
      localStorage.setItem(STORE_KEY, C.serialize(project, timeline));
      setStatus("工程已保存：" + new Date().toLocaleTimeString()
        + "（时间线/字幕/转场/音频位置均已写入）");
    } catch (e) {
      setStatus("保存失败：" + e.message + "（原工程未受影响）");
    }
  });
  $("loadBtn").addEventListener("click", function () {
    loadFromStore(true);
  });
  function loadFromStore(announce) {
    var raw = localStorage.getItem(STORE_KEY);
    if (!raw) { if (announce) setStatus("没有找到已保存的工程。"); return false; }
    try {
      var p = C.deserialize(raw);          // 解析失败会抛错，绝不覆盖内存工程
      onPause();                           // 停止可能残留的上一场景音频
      project = p;
      var sc = scene();
      timeline = new C.Timeline({
        duration: sc.duration, inPoint: sc.inPoint, outPoint: sc.outPoint,
        playhead: C.clamp(p.playhead || sc.inPoint, sc.inPoint, sc.outPoint),
        loop: p.loop !== false
      });
      loopBtn.classList.toggle("active", timeline.loop);
      rebuildSceneSel();
      refreshSceneUI();
      if (announce) setStatus("工程已恢复：播放头 " + timeline.playhead.toFixed(2)
        + "s，字幕 " + sc.subtitles.length + " 条，音频事件 " + sc.audioEvents.length + " 个。");
      return true;
    } catch (e) {
      setStatus("载入失败：" + e.message + "（已保留当前工程）");
      return false;
    }
  }

  /* ---------- 导出当前对比图 ----------
   * 把 A / B / 叠加 / 差分四联图画到一张离屏画布并下载 PNG。
   * 任何一步失败都只提示，绝不清空已保存的工程。 */
  $("exportBtn").addEventListener("click", function () {
    try {
      var sc = scene();
      var t = timeline.playhead;
      var W = sc.width, H = sc.height, pad = 24, labelH = 22;
      var ex = document.createElement("canvas");
      ex.width = W * 2 + pad * 3;
      ex.height = (H + labelH) * 2 + pad * 3 + 40;
      var cx = ex.getContext("2d");
      if (!cx) throw new Error("无法创建导出画布");
      cx.fillStyle = "#14161a";
      cx.fillRect(0, 0, ex.width, ex.height);
      // 重绘四个视图（用当前精确时间 t，保证与暂停画面一致）
      var diff = renderAll(t);
      var titles = ["原始 A", "原始 B", "叠加", "差分"];
      var srcs = [viewA, viewB, viewMix, viewDiff];
      cx.font = "13px sans-serif";
      for (var i = 0; i < 4; i++) {
        var x = pad + (i % 2) * (W + pad);
        var y = pad + ((i / 2) | 0) * (H + labelH + pad);
        cx.fillStyle = "#e6e9ee";
        cx.fillText(titles[i], x, y + 13);
        cx.drawImage(srcs[i], x, y + labelH);
      }
      // 元数据：入点 / 出点 / 总时长（导出后可核对一致性）
      cx.fillStyle = "#4da3ff";
      cx.fillText("场景=" + sc.name
        + "  t=" + t.toFixed(3) + "s"
        + "  入点=" + timeline.inPoint.toFixed(2)
        + "  出点=" + timeline.outPoint.toFixed(2)
        + "  总时长=" + timeline.duration.toFixed(2)
        + "  变化像素=" + (diff.ratio * 100).toFixed(2) + "%",
        pad, ex.height - pad + 8);
      var fname = "compare_" + sc.name + "_t" + t.toFixed(2)
        + "_in" + timeline.inPoint.toFixed(1) + "-out" + timeline.outPoint.toFixed(1) + ".png";
      ex.toBlob(function (blob) {
        if (!blob) { setStatus("导出失败：无法生成 PNG（原工程已保留）"); return; }
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = fname;
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
        setStatus("已导出 " + fname + "（入点/出点/总时长与工程一致）");
      }, "image/png");
    } catch (e) {
      setStatus("导出失败：" + e.message + "（原工程已保留）");
    }
  });

  /* ---------- 初始化 ---------- */
  rebuildSceneSel();
  if (!loadFromStore(false)) refreshSceneUI();
  requestAnimationFrame(frame);
})();
