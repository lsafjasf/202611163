// 主控：把时钟、渲染、音频、导出、持久化和 UI 接线起来。
import { MasterClock, formatTimecode } from "./clock.js";
import {
  makeDefaultProject, makeDefaultScene, getScene, sceneDuration,
  serializeProject, deserializeProject,
} from "./project.js";
import { renderFrame } from "./renderer.js";
import { AudioEngine } from "./audioEngine.js";
import { Exporter, downloadBlob, probeDuration } from "./exporter.js";
import { sampleKeys, setKey, removeKey } from "./keyframes.js";
import { runSelfTest } from "./selftest.js";

const STORAGE_KEY = "intro-studio-project-v1";
const TIMELINE_WIDTH = 960;

const LAYER_PROPS = {
  wave: {
    amplitude: { label: "振幅", min: 0, max: 80, step: 1 },
    frequency: { label: "频率", min: 0.4, max: 4, step: 0.1 },
    speed: { label: "速度", min: 0, max: 3, step: 0.05 },
    hue: { label: "色相", min: 0, max: 360, step: 1 },
  },
  title: {
    x: { label: "X", min: 0, max: 960, step: 1 },
    y: { label: "Y", min: 0, max: 540, step: 1 },
    opacity: { label: "不透明度", min: 0, max: 1, step: 0.01 },
    scale: { label: "缩放", min: 0.2, max: 3, step: 0.01 },
    tracking: { label: "字距", min: 0, max: 120, step: 1 },
  },
  lightband: {
    x: { label: "X", min: -400, max: 1400, step: 1 },
    opacity: { label: "不透明度", min: 0, max: 1, step: 0.01 },
    angle: { label: "角度", min: -45, max: 45, step: 0.5 },
    width: { label: "宽度", min: 20, max: 400, step: 1 },
  },
};

const $ = (id) => document.getElementById(id);
const canvas = $("preview");
const ctx = canvas.getContext("2d");
const ruler = $("ruler");
const rulerCtx = ruler.getContext("2d");

// ---------- 全局状态 ----------
let project = loadInitialProject();
const clock = new MasterClock(sceneDuration(getScene(project)));
const audio = new AudioEngine();
const exporter = new Exporter(audio);
let selectedLayer = "wave";
let selectedProp = "amplitude";

function loadInitialProject() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return deserializeProject(saved);
  } catch (err) {
    console.warn("本地工程损坏，使用默认工程：", err);
  }
  return makeDefaultProject();
}

function persist() {
  localStorage.setItem(STORAGE_KEY, serializeProject(project));
}

function scene() { return getScene(project); }
function duration() { return sceneDuration(scene()); }

// ---------- 传输控制 ----------
function play() {
  if (exporter.isExporting) return;
  clock.play();
  audio.play(scene(), clock.time); // 音画共用同一时钟起点
  $("btnPlay").textContent = "⏸";
}

function pause() {
  clock.pause();
  audio.stopAll();
  $("btnPlay").textContent = "▶";
}

function togglePlay() {
  if (clock.playing) pause(); else play();
}

function seek(t) {
  clock.seek(t);
  if (clock.playing) audio.play(scene(), clock.time); // 拖动后重排音频
  renderFrame(ctx, project, scene(), clock.time);
  updatePlayhead();
}

// ---------- 渲染主循环 ----------
function frameLoop() {
  if (!exporter.isExporting) {
    if (clock.playing) {
      renderFrame(ctx, project, scene(), clock.time);
      if (clock.checkEnded()) {
        audio.stopAll();
        $("btnPlay").textContent = "▶";
      }
    }
    updatePlayhead();
    updatePropValue();
  }
  requestAnimationFrame(frameLoop);
}

function updatePlayhead() {
  const t = clock.time;
  $("timecode").textContent =
    `${formatTimecode(t)} / ${formatTimecode(duration())}`;
  $("playhead").style.left = `${(t / duration()) * TIMELINE_WIDTH}px`;
}

// ---------- 时间线 ----------
function drawRuler() {
  const d = duration();
  rulerCtx.clearRect(0, 0, TIMELINE_WIDTH, 26);
  rulerCtx.fillStyle = "#1d2029";
  rulerCtx.fillRect(0, 0, TIMELINE_WIDTH, 26);
  rulerCtx.fillStyle = "#7c8499";
  rulerCtx.font = "10px sans-serif";
  for (let s = 0; s <= d; s += 0.5) {
    const x = (s / d) * TIMELINE_WIDTH;
    const major = Math.abs(s - Math.round(s)) < 1e-6;
    rulerCtx.fillRect(x, major ? 8 : 16, 1, major ? 18 : 10);
    if (major) rulerCtx.fillText(`${s}s`, x + 3, 10);
  }
}

function rulerToTime(evt) {
  const rect = ruler.getBoundingClientRect();
  const ratio = (evt.clientX - rect.left) / rect.width;
  return Math.max(0, Math.min(1, ratio)) * duration();
}

let scrubbing = false;
ruler.addEventListener("pointerdown", (e) => {
  scrubbing = true;
  ruler.setPointerCapture(e.pointerId);
  seek(rulerToTime(e));
});
ruler.addEventListener("pointermove", (e) => {
  if (scrubbing) seek(rulerToTime(e));
});
ruler.addEventListener("pointerup", () => { scrubbing = false; });

function rebuildTracks() {
  const area = $("trackArea");
  area.innerHTML = "";
  const d = duration();
  const s = scene();
  const layerNames = { wave: "波浪", title: "标题", lightband: "光带" };

  for (const [layer, label] of Object.entries(layerNames)) {
    const track = document.createElement("div");
    track.className = "track";
    track.innerHTML = `<span class="label">${label}</span>`;
    const times = new Set();
    for (const keys of Object.values(s.layers[layer].keyframes)) {
      for (const k of keys) times.add(Math.round(k.t * 1000));
    }
    for (const ms of times) {
      const t = ms / 1000;
      const el = document.createElement("div");
      el.className = "kf";
      el.style.left = `${(t / d) * TIMELINE_WIDTH}px`;
      el.title = `${label} 关键帧 @ ${t.toFixed(2)}s`;
      el.addEventListener("click", () => seek(t));
      track.appendChild(el);
    }
    area.appendChild(track);
  }

  const subTrack = document.createElement("div");
  subTrack.className = "track";
  subTrack.innerHTML = `<span class="label">字幕</span>`;
  s.subtitles.forEach((sub) => {
    const el = document.createElement("div");
    el.className = "clip";
    el.style.left = `${(sub.start / d) * TIMELINE_WIDTH}px`;
    el.style.width = `${((sub.end - sub.start) / d) * TIMELINE_WIDTH}px`;
    el.textContent = sub.text;
    el.addEventListener("click", () => seek(sub.start));
    subTrack.appendChild(el);
  });
  area.appendChild(subTrack);

  const audioTrack = document.createElement("div");
  audioTrack.className = "track";
  audioTrack.innerHTML = `<span class="label">音频</span>`;
  s.audio.forEach((ev) => {
    const el = document.createElement("div");
    el.className = "clip audio";
    el.style.left = `${(ev.start / d) * TIMELINE_WIDTH}px`;
    el.style.width = `${(ev.duration / d) * TIMELINE_WIDTH}px`;
    el.textContent = `${ev.type} @${ev.start.toFixed(2)}s`;
    el.addEventListener("click", () => seek(ev.start));
    audioTrack.appendChild(el);
  });
  area.appendChild(audioTrack);
}

// ---------- 检查器：图层属性与关键帧 ----------
function refreshPropSelect() {
  const sel = $("propSelect");
  sel.innerHTML = "";
  for (const [prop, meta] of Object.entries(LAYER_PROPS[selectedLayer])) {
    const opt = document.createElement("option");
    opt.value = prop;
    opt.textContent = meta.label;
    sel.appendChild(opt);
  }
  if (!LAYER_PROPS[selectedLayer][selectedProp]) {
    selectedProp = Object.keys(LAYER_PROPS[selectedLayer])[0];
  }
  sel.value = selectedProp;
  const meta = LAYER_PROPS[selectedLayer][selectedProp];
  $("propValue").min = meta.min;
  $("propValue").max = meta.max;
  $("propValue").step = meta.step;
  refreshKeyList();
}

function currentKeys() {
  return scene().layers[selectedLayer].keyframes[selectedProp] || [];
}

function updatePropValue() {
  const input = $("propValue");
  if (document.activeElement === input) return;
  const v = sampleKeys(currentKeys(), clock.time);
  input.value = Number(v.toFixed(3));
}

function refreshKeyList() {
  const ul = $("keyList");
  ul.innerHTML = "";
  for (const k of currentKeys()) {
    const li = document.createElement("li");
    const jump = document.createElement("a");
    jump.textContent = `t=${k.t.toFixed(2)}s → ${Number(k.v.toFixed(3))}`;
    jump.addEventListener("click", () => seek(k.t));
    const del = document.createElement("span");
    del.className = "del";
    del.textContent = "删除";
    del.addEventListener("click", () => {
      const layer = scene().layers[selectedLayer];
      layer.keyframes[selectedProp] = removeKey(currentKeys(), k.t);
      afterMutation();
    });
    li.append(jump, del);
    ul.appendChild(li);
  }
}

function afterMutation() {
  persist();
  rebuildTracks();
  refreshKeyList();
  refreshSubList();
  refreshAudioList();
  renderFrame(ctx, project, scene(), clock.time);
}

// ---------- 字幕与音频事件列表 ----------
function refreshSubList() {
  const ul = $("subList");
  ul.innerHTML = "";
  scene().subtitles.forEach((sub, i) => {
    const li = document.createElement("li");
    const jump = document.createElement("a");
    jump.textContent = `[${sub.start.toFixed(2)}–${sub.end.toFixed(2)}] ${sub.text}`;
    jump.addEventListener("click", () => seek(sub.start));
    const del = document.createElement("span");
    del.className = "del";
    del.textContent = "删除";
    del.addEventListener("click", () => {
      scene().subtitles.splice(i, 1);
      afterMutation();
    });
    li.append(jump, del);
    ul.appendChild(li);
  });
}

function refreshAudioList() {
  const ul = $("audioList");
  ul.innerHTML = "";
  scene().audio.forEach((ev, i) => {
    const li = document.createElement("li");
    const jump = document.createElement("a");
    jump.textContent = `${ev.type} @${ev.start.toFixed(2)}s 时长${ev.duration.toFixed(2)}s`;
    jump.addEventListener("click", () => seek(ev.start));
    const del = document.createElement("span");
    del.className = "del";
    del.textContent = "删除";
    del.addEventListener("click", () => {
      scene().audio.splice(i, 1);
      afterMutation();
    });
    li.append(jump, del);
    ul.appendChild(li);
  });
}

// ---------- 场景管理：切换/新增时先停声音，绝不泄漏上一场景 ----------
function switchScene(index) {
  audio.stopAll();
  pause();
  project.activeScene = index;
  clock.setDuration(duration());
  clock.seek(0);
  persist();
  drawRuler();
  afterMutation();
  $("inout").textContent =
    `入点 ${scene().in.toFixed(2)}s · 出点 ${scene().out.toFixed(2)}s`;
}

function refreshSceneSelect() {
  const sel = $("sceneSelect");
  sel.innerHTML = "";
  project.scenes.forEach((s, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = `${i + 1}. ${s.name}`;
    sel.appendChild(opt);
  });
  sel.value = project.activeScene;
}

// ---------- 工程保存 / 载入 ----------
function saveProjectFile() {
  const blob = new Blob([serializeProject(project)], { type: "application/json" });
  downloadBlob(blob, `${project.name || "intro-project"}.json`);
}

async function openProjectFile(file) {
  try {
    const text = await file.text();
    const loaded = deserializeProject(text); // 校验失败会抛错，原工程不动
    audio.stopAll();
    pause();
    project = loaded;
    clock.setDuration(duration());
    clock.seek(0);
    persist();
    refreshSceneSelect();
    drawRuler();
    afterMutation();
    setStatus(`已载入工程「${project.name}」，共 ${project.scenes.length} 个场景`);
  } catch (err) {
    setStatus(`载入失败：${err.message}（原工程未受影响）`);
  }
}

// ---------- 导出 ----------
function setStatus(msg) { $("exportStatus").textContent = msg; }

function setExportUi(exporting) {
  $("btnExport").disabled = exporting;
  $("btnCancelExport").disabled = !exporting;
  $("btnPlay").disabled = exporting;
  $("btnStop").disabled = exporting;
  $("sceneSelect").disabled = exporting;
}

async function startExport() {
  pause();
  setExportUi(true);
  $("exportProgress").value = 0;
  setStatus("导出中：画面与音轨同步写入同一 WebM…");
  try {
    exporter.export(project, project.activeScene, canvas, {
      onProgress: (p) => { $("exportProgress").value = p; },
      onDone: async (blob, expected) => {
        $("exportProgress").value = 1;
        setExportUi(false);
        try {
          const measured = await probeDuration(blob);
          const drift = Math.abs(measured - expected);
          const ok = drift < 0.35;
          setStatus(
            `导出完成：入点 ${scene().in.toFixed(2)}s，出点 ${scene().out.toFixed(2)}s\n` +
            `期望时长 ${expected.toFixed(3)}s，实测 ${measured.toFixed(3)}s，` +
            `偏差 ${drift.toFixed(3)}s → ${ok ? "校验通过 ✓" : "校验失败 ✗"}`
          );
          if (ok) downloadBlob(blob, `${project.name || "intro"}-${scene().name}.webm`);
        } catch (err) {
          setStatus(`导出后校验失败：${err.message}（工程未受影响）`);
        }
      },
      onError: (err) => {
        setExportUi(false);
        setStatus(`导出失败：${err.message}（工程已完整保留）`);
      },
      onCancel: () => {
        setExportUi(false);
        $("exportProgress").value = 0;
        setStatus("导出已取消：未写入任何文件，无残片。");
      },
    });
  } catch (err) {
    setExportUi(false);
    setStatus(`导出失败：${err.message}（工程已完整保留）`);
  }
}

// ---------- 自检 ----------
async function selfTest() {
  const out = $("selfTestOut");
  out.className = "";
  out.textContent = "自检运行中…\n";
  const result = await runSelfTest({
    project, scene: scene(), clock, canvas, audio,
    onLog: (line) => { out.textContent += line + "\n"; },
  });
  out.textContent += result.pass ? "\n全部通过 ✓" : "\n存在失败项 ✗";
  out.className = result.pass ? "ok" : "fail";
}

// ---------- 事件绑定与初始化 ----------
function bindEvents() {
  $("btnPlay").addEventListener("click", togglePlay);
  $("btnStop").addEventListener("click", () => { pause(); seek(0); });
  $("chkLoop").addEventListener("change", (e) => { clock.loop = e.target.checked; });
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && e.target.tagName !== "INPUT") {
      e.preventDefault();
      togglePlay();
    }
  });

  $("layerSelect").addEventListener("change", (e) => {
    selectedLayer = e.target.value;
    refreshPropSelect();
  });
  $("propSelect").addEventListener("change", (e) => {
    selectedProp = e.target.value;
    refreshPropSelect();
  });
  $("btnSetKey").addEventListener("click", () => {
    const layer = scene().layers[selectedLayer];
    const value = parseFloat($("propValue").value);
    if (isNaN(value)) return;
    const t = Number(clock.time.toFixed(3));
    layer.keyframes[selectedProp] = setKey(currentKeys(), t, value);
    afterMutation();
  });

  $("btnAddSub").addEventListener("click", () => {
    const text = $("subText").value.trim();
    if (!text) return;
    const t = Number(clock.time.toFixed(2));
    scene().subtitles.push({ start: t, end: Math.min(t + 2, duration()), text });
    scene().subtitles.sort((a, b) => a.start - b.start);
    $("subText").value = "";
    afterMutation();
  });

  $("btnAddAudio").addEventListener("click", () => {
    const type = $("audioType").value;
    const t = Number(clock.time.toFixed(2));
    const presets = {
      whoosh: { duration: 1.4, freq: 300, gain: 0.5 },
      chime: { duration: 1.2, freq: 660, gain: 0.45 },
      pulse: { duration: 1.4, freq: 110, gain: 0.5 },
    };
    scene().audio.push({
      id: `a${Date.now()}`, type, start: t, ...presets[type],
    });
    scene().audio.sort((a, b) => a.start - b.start);
    afterMutation();
  });

  $("sceneSelect").addEventListener("change", (e) => switchScene(Number(e.target.value)));
  $("btnAddScene").addEventListener("click", () => {
    const id = `scene-${Date.now()}`;
    project.scenes.push(makeDefaultScene(id, `场景 ${project.scenes.length + 1}`));
    refreshSceneSelect();
    switchScene(project.scenes.length - 1);
  });

  $("btnSaveJson").addEventListener("click", saveProjectFile);
  $("btnLoadJson").addEventListener("click", () => $("fileInput").click());
  $("fileInput").addEventListener("change", (e) => {
    if (e.target.files[0]) openProjectFile(e.target.files[0]);
    e.target.value = "";
  });

  $("btnExport").addEventListener("click", startExport);
  $("btnCancelExport").addEventListener("click", () => exporter.cancel());
  $("btnSelfTest").addEventListener("click", selfTest);
}

function init() {
  canvas.width = project.width;
  canvas.height = project.height;
  bindEvents();
  refreshSceneSelect();
  refreshPropSelect();
  drawRuler();
  afterMutation();
  $("inout").textContent =
    `入点 ${scene().in.toFixed(2)}s · 出点 ${scene().out.toFixed(2)}s`;
  renderFrame(ctx, project, scene(), 0);
  requestAnimationFrame(frameLoop);
}

init();
