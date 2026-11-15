import { createDefaultProject, cloneProject, locateScene } from '../engine/project.js';
import { renderFrame } from '../engine/renderer.js';
import { Transport } from '../engine/transport.js';
import { AudioEngine } from '../engine/audio.js';
import { exportWebM, exportProjectJSON, downloadBlob } from '../engine/exporter.js';
import { saveProject, loadProject, parseProjectJSON } from '../engine/storage.js';
import { formatClock, buildTimeline, renderKeyframeEditor, $ } from './ui.js';

const canvas = $('#canvas');
const ctx2d = canvas.getContext('2d');
const audio = new AudioEngine();

let project = createDefaultProject();
let activeSceneIndex = 0;
let activeLayer = 'title';

const transport = new Transport(project, renderFrame, ctx2d, audio, {
  width: project.width,
  height: project.height,
  onFrame: syncUi,
});

function activeScene() {
  return project.scenes[activeSceneIndex];
}

// 切换场景：先彻底暂停并清掉音频调度，保证声音不会从上一场景延续。
async function switchScene(index, seekToInPoint = true) {
  await transport.pause();
  audio.stopAll();
  activeSceneIndex = index;
  if (seekToInPoint) await transport.seek(activeScene().inPoint);
  renderAll();
}

function renderAll() {
  buildSceneTabs();
  buildTimeline(project, activeScene());
  renderKeyframeEditor(activeScene(), activeLayer, (layer) => {
    activeLayer = layer;
    renderAll();
  });
  fillInOut();
  transport.setProject(project);
  syncUi(transport.time);
}

function buildSceneTabs() {
  const wrap = $('#sceneTabs');
  wrap.innerHTML = '';
  project.scenes.forEach((scene, i) => {
    const btn = document.createElement('button');
    btn.textContent = scene.name;
    if (i === activeSceneIndex) btn.className = 'active';
    btn.addEventListener('click', () => switchScene(i));
    wrap.appendChild(btn);
  });
}

function fillInOut() {
  const s = activeScene();
  $('#inPoint').value = s.inPoint;
  $('#outPoint').value = s.outPoint;
  $('#audioStart').value = s.audio.startAt;
  $('#transitionType').value = s.transition?.type || 'none';
  $('#transitionDur').value = s.transition?.duration ?? 0;
}

function syncUi(time) {
  $('#clock').textContent = `${formatClock(time)} / ${formatClock(project.duration)}`;
  const pct = (time / project.duration) * 100;
  $('#playhead').style.left = `${pct}%`;
  const { scene } = locateScene(project, time);
  const beatLen = 60 / scene.audio.bpm;
  const local = time - scene.inPoint - scene.audio.startAt;
  const nearest = [...scene.audio.kick, ...scene.audio.hat]
    .map((b) => b * beatLen)
    .filter((b) => b <= local + 0.001)
    .sort((a, b) => b - a)[0];
  $('#audioEvent').textContent = nearest === undefined
    ? '音频事件：—'
    : `音频事件：beat@${nearest.toFixed(2)}s`;
}

function setStatus(text) {
  $('#status').textContent = text;
}

// ---- 播放控制 ----
$('#btnPlay').addEventListener('click', async () => {
  setStatus('播放中');
  await transport.play();
});
$('#btnPause').addEventListener('click', async () => {
  await transport.pause();
  setStatus(`已暂停 @ ${formatClock(transport.time)}（画面与声音同时冻结）`);
});
$('#btnLoop').addEventListener('click', () => {
  project.loop = !project.loop;
  const btn = $('#btnLoop');
  btn.textContent = project.loop ? '循环 开' : '循环 关';
  btn.classList.toggle('active', project.loop);
});

// 拖动播放头：指针按下与移动都实时 seek 插值。
const timeline = $('#timeline');
let dragging = false;
function seekFromEvent(e) {
  const rect = timeline.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  transport.seek(ratio * project.duration);
}
timeline.addEventListener('pointerdown', (e) => {
  dragging = true;
  timeline.setPointerCapture(e.pointerId);
  seekFromEvent(e);
});
timeline.addEventListener('pointermove', (e) => {
  if (dragging) seekFromEvent(e);
});
timeline.addEventListener('pointerup', () => { dragging = false; });

export { project, transport, audio, activeScene, renderAll, setStatus, switchScene };

// ---- 关键帧编辑 ----
$('#btnAddKf').addEventListener('click', () => {
  const scene = activeScene();
  const local = transport.time - scene.inPoint;
  const layer = scene.layers[activeLayer];
  const target = activeLayer === 'background'
    ? layer.tracks.opacity
    : layer.tracks.opacity;
  const exists = target.find((f) => Math.abs(f.t - local) < 0.01);
  if (!exists) {
    target.push(kf(local, target[target.length - 1]?.value ?? 1));
    target.sort((a, b) => a.t - b.t);
  }
  renderAll();
  setStatus(`已在 ${local.toFixed(2)}s 写入关键帧`);
});

// ---- 入点 / 出点 / 音频起点 / 转场 ----
$('#inPoint').addEventListener('change', (e) => {
  const s = activeScene();
  const v = parseFloat(e.target.value);
  if (v < s.outPoint) s.inPoint = v;
  renderAll();
});
$('#outPoint').addEventListener('change', (e) => {
  const s = activeScene();
  const v = parseFloat(e.target.value);
  if (v > s.inPoint) s.outPoint = v;
  renderAll();
});
$('#audioStart').addEventListener('change', (e) => {
  activeScene().audio.startAt = Math.max(0, parseFloat(e.target.value) || 0);
  renderAll();
});
$('#transitionType').addEventListener('change', (e) => {
  const s = activeScene();
  if (e.target.value === 'none') s.transition = { type: 'none', duration: 0 };
  else s.transition = { type: e.target.value, duration: s.transition?.duration || 0.8 };
  renderAll();
});
$('#transitionDur').addEventListener('change', (e) => {
  const s = activeScene();
  s.transition = { ...(s.transition || { type: 'fade' }), duration: parseFloat(e.target.value) || 0 };
  renderAll();
});

// ---- 保存 / 重载 / 导入 ----
$('#btnSave').addEventListener('click', () => {
  saveProject(project);
  setStatus('工程已保存到本地（关键帧 / 转场 / 音频起点）');
});

$('#btnLoad').addEventListener('click', () => {
  try {
    const data = loadProject();
    if (!data) { setStatus('没有已保存工程'); return; }
    applyLoadedProject(data, '工程已重载，时间线与参数恢复');
  } catch (err) {
    setStatus(`重载失败，保留当前工程：${err.message}`);
  }
});

$('#fileImport').addEventListener('change', async (e) => {
  try {
    const text = await e.target.files[0].text();
    applyLoadedProject(parseProjectJSON(text), 'JSON 工程已导入');
  } catch (err) {
    setStatus(`导入失败，保留当前工程：${err.message}`);
  }
});

async function applyLoadedProject(data, message) {
  await transport.pause();
  audio.stopAll(); // 防止上一场景/工程的声音继续
  project = data;
  activeSceneIndex = 0;
  transport.project = project;
  transport.currentTime = 0;
  renderAll();
  setStatus(message);
}

// ---- 导出 ----
$('#btnExportJson').addEventListener('click', () => {
  const json = exportProjectJSON(project);
  downloadBlob(new Blob([json], { type: 'application/json' }), 'poster-project.json');
  setStatus('工程 JSON 已导出');
});

$('#btnExportWebm').addEventListener('click', async () => {
  const backup = cloneProject(project); // 失败回滚保护
  try {
    setStatus('正在导出 WebM…');
    const result = await exportWebM(project, audio, {
      onProgress: (p) => setStatus(`导出中 ${(p * 100).toFixed(0)}%`),
    });
    downloadBlob(result.blob, 'poster.webm');
    setStatus(`导出完成：${result.frames} 帧 / ${result.duration}s / ${(result.size / 1024).toFixed(1)}KB`);
    window.__lastExport = result;
  } catch (err) {
    project = backup; // 导出失败必须保留原工程
    transport.project = project;
    renderAll();
    setStatus(`导出失败，已保留原工程：${err.message}`);
  }
});

// 暴露给端到端测试
window.__app = {
  get project() { return project; },
  transport,
  audio,
  applyLoadedProject,
  switchScene,
  renderAll,
};

// 等待 Web Font 就绪再首绘，避免中文回退字体。
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => renderAll());
}
renderAll();
