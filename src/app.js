// 应用控制器：UI 事件、编辑操作、持久化、导出与场景切换。

import {
  createDefaultProject, createBlankScene, saveProjectLocal, loadProjectLocal,
  clearProjectLocal, MAX_FRAMES, STAGE_W, STAGE_H,
} from './model.js';
import {
  drawSceneFrame, drawStrip, stripCellAt, jointAt, clientToStage,
  sceneDuration,
} from './render.js';
import { MasterClock, FootstepAudio } from './clock.js';
import { exportGif, exportWebm, expectedExportSeconds, downloadBlob } from './exporter.js';

const $ = (id) => document.getElementById(id);

const state = {
  project: null,
  currentFrame: 0,
  exportHooks: {},
  eventLog: [],
};

const audio = new FootstepAudio();

function activeScene() {
  return state.project.scenes.find((s) => s.id === state.project.activeSceneId);
}

const clock = new MasterClock({
  audio,
  fpsRef: () => state.project.fps,
  sceneRef: activeScene,
  onFrame: (frameIndex, timeSec) => {
    state.currentFrame = frameIndex;
    renderAll(timeSec);
  },
  onEvent: (ev) => {
    state.eventLog.push(ev);
    if (state.eventLog.length > 500) state.eventLog.shift();
    const line = eventToText(ev);
    if (line) {
      const log = $('statusLog');
      log.textContent += `${line}\n`;
      log.scrollTop = log.scrollHeight;
    }
  },
});

function eventToText(ev) {
  if (ev.type === 'footstep') {
    return `🔊 脚步 ${ev.kind} @帧${ev.frame + 1} t=${ev.time.toFixed(3)}s`;
  }
  if (ev.type === 'play') return '▶ 播放开始';
  if (ev.type === 'pause') return `⏸ 暂停 @帧${ev.frame + 1} t=${ev.time.toFixed(3)}s`;
  if (ev.type === 'seek') return `↳ 拖动到帧${ev.frame + 1} t=${ev.time.toFixed(3)}s`;
  if (ev.type === 'loop') return '🔁 循环回到入点';
  return '';
}

function renderAll(timeSec = clock.time) {
  const scene = activeScene();
  // 始终带编辑标记，保证同一帧在播放/暂停/截图三种路径下像素完全一致
  drawSceneFrame($('stage'), scene, state.currentFrame, { editMode: true });
  drawStrip($('strip'), state.project, scene, state.currentFrame);

  const fps = state.project.fps;
  const total = sceneDuration(scene, fps);
  const shown = Math.min(timeSec, total);
  const mm = Math.floor(shown / 60);
  const ss = (shown % 60).toFixed(2).padStart(5, '0');
  $('clockLabel').textContent = `${String(mm).padStart(2, '0')}:${ss} / 帧 ${state.currentFrame + 1}`;
  $('rangeLabel').textContent =
    `入点 ${scene.inPoint} · 出点 ${scene.outPoint} · 时长 ${total.toFixed(2)}s`;

  // 面板同步
  $('stepSelect').value = scene.frames[state.currentFrame].footstep;
  $('audioStart').value = scene.audioStartFrame;
  $('fadeIn').value = scene.fadeInFrames;
  $('fadeOut').value = scene.fadeOutFrames;
  renderSubtitleList();
}

function renderSubtitleList() {
  const scene = activeScene();
  const box = $('subtitleList');
  box.innerHTML = '';
  for (const sub of scene.subtitles) {
    const item = document.createElement('div');
    item.className = 'subtitle-item';
    const span = document.createElement('span');
    span.textContent = `[${sub.startFrame + 1}-${sub.endFrame + 1}] ${sub.text}`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '删除';
    btn.addEventListener('click', () => {
      scene.subtitles = scene.subtitles.filter((s) => s.id !== sub.id);
      persist();
      renderAll();
    });
    item.append(span, btn);
    box.appendChild(item);
  }
}

function persist() {
  saveProjectLocal(state.project);
}

function fmtClock() {
  return clock.time.toFixed(3);
}

export function getDebugState() {
  return {
    project: state.project,
    currentFrame: state.currentFrame,
    clockTime: clock.time,
    playing: clock.playing,
    events: state.eventLog.slice(),
    audioState: audio.ctx ? audio.ctx.state : 'none',
  };
}

window.__studio = {
  getState: getDebugState,
  clock,
  audio,
  setExportHook: (name, value) => { state.exportHooks[name] = value; },
  clearExportHooks: () => { state.exportHooks = {}; },
  renderAll: () => renderAll(),
  stageCanvas: () => $('stage'),
  stripCanvas: () => $('strip'),
  snapshotStage: () => $('stage').getContext('2d').getImageData(0, 0, STAGE_W, STAGE_H).data.slice(),
};

function boot() {
  const restored = loadProjectLocal();
  state.project = restored || createDefaultProject();
  const scene = activeScene();
  state.currentFrame = scene.inPoint;
  populateSceneSelect();
  bindUi();
  renderAll(0);
  if (!restored) persist();
}

function populateSceneSelect() {
  const sel = $('sceneSelect');
  sel.innerHTML = '';
  for (const scene of state.project.scenes) {
    const opt = document.createElement('option');
    opt.value = scene.id;
    opt.textContent = scene.name;
    sel.appendChild(opt);
  }
  sel.value = state.project.activeSceneId;
}

boot();

export { state, clock, audio, activeScene, persist, renderAll, fmtClock };

function bindUi() {
  const scene = activeScene();

  // 播放控制
  $('playBtn').addEventListener('click', () => clock.play());
  $('pauseBtn').addEventListener('click', () => clock.pause());
  $('loopChk').addEventListener('change', (e) => {
    // 循环行为直接在 clock 内实现；非循环时播完自动停
    clock.looping = e.target.checked;
  });
  clock.looping = $('loopChk').checked;

  $('fpsSelect').value = String(state.project.fps);
  $('fpsSelect').addEventListener('change', (e) => {
    state.project.fps = Number(e.target.value);
    clock.seekToFrame(state.currentFrame);
    persist();
    renderAll();
  });

  // 帧跳转
  $('prevFrameBtn').addEventListener('click', () => {
    const s = activeScene();
    clock.seekToFrame(Math.max(s.inPoint, state.currentFrame - 1));
  });
  $('nextFrameBtn').addEventListener('click', () => {
    const s = activeScene();
    clock.seekToFrame(Math.min(s.outPoint, state.currentFrame + 1));
  });
  $('setInBtn').addEventListener('click', () => {
    const s = activeScene();
    if (state.currentFrame <= s.outPoint) s.inPoint = state.currentFrame;
    clock.seekToFrame(s.inPoint);
    persist(); renderAll();
  });
  $('setOutBtn').addEventListener('click', () => {
    const s = activeScene();
    if (state.currentFrame >= s.inPoint) s.outPoint = state.currentFrame;
    clock.seekToFrame(state.currentFrame);
    persist(); renderAll();
  });
  $('resetRangeBtn').addEventListener('click', () => {
    const s = activeScene();
    s.inPoint = 0;
    s.outPoint = s.frames.length - 1;
    clock.seekToFrame(0);
    persist(); renderAll();
  });

  bindStageEditing();
  bindStripScrubbing();
  bindFrameOps();
  bindPanel();
  bindSceneOps();
  bindProjectIo();
  bindExport();
}

function bindStageEditing() {
  const canvas = $('stage');
  let dragging = null;
  canvas.addEventListener('pointerdown', (e) => {
    const hit = jointAt(activeScene(), state.currentFrame, canvas, e.clientX, e.clientY);
    if (hit) {
      dragging = hit;
      canvas.setPointerCapture(e.pointerId);
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const p = clientToStage(canvas, e.clientX, e.clientY);
    const pose = activeScene().frames[state.currentFrame].pose;
    pose[dragging].x = Math.round(p.x);
    pose[dragging].y = Math.round(p.y);
    persist();
    renderAll();
  });
  const release = () => { dragging = null; };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
}

function bindStripScrubbing() {
  const canvas = $('strip');
  let scrubbing = false;
  const jump = (e) => {
    const i = stripCellAt(canvas, e.clientX);
    if (i < 0 || i >= activeScene().frames.length) return;
    clock.seekToFrame(i);
  };
  canvas.addEventListener('pointerdown', (e) => {
    scrubbing = true;
    canvas.setPointerCapture(e.pointerId);
    jump(e);
  });
  canvas.addEventListener('pointermove', (e) => { if (scrubbing) jump(e); });
  canvas.addEventListener('pointerup', () => { scrubbing = false; });
}

function bindFrameOps() {
  $('addFrameBtn').addEventListener('click', () => {
    const s = activeScene();
    if (s.frames.length >= MAX_FRAMES) {
      window.alert(`每个场景最多 ${MAX_FRAMES} 帧`);
      return;
    }
    const src = s.frames[state.currentFrame];
    s.frames.splice(state.currentFrame + 1, 0, {
      id: `f${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      pose: structuredClone(src.pose),
      footstep: 'none',
    });
    if (state.currentFrame >= s.inPoint && state.currentFrame < s.outPoint) s.outPoint += 1;
    else if (s.outPoint === s.frames.length - 2) s.outPoint = s.frames.length - 1;
    clock.seekToFrame(state.currentFrame + 1);
    persist(); renderAll();
  });

  $('duplicateBtn').addEventListener('click', () => {
    const s = activeScene();
    if (s.frames.length >= MAX_FRAMES) {
      window.alert(`每个场景最多 ${MAX_FRAMES} 帧`);
      return;
    }
    // 记录复制发生前的位置，避免后续 seek 改变“上一帧”的含义
    const atIndex = state.currentFrame;
    const prevIndex = Math.max(0, atIndex - 1);
    const src = s.frames[prevIndex];
    const insertAt = atIndex;
    s.frames.splice(insertAt, 0, {
      id: `f${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      pose: structuredClone(src.pose),
      footstep: 'none',
    });
    s.outPoint = Math.min(MAX_FRAMES - 1, s.outPoint + 1);
    clock.seekToFrame(insertAt);
    persist(); renderAll();
  });

  $('deleteFrameBtn').addEventListener('click', () => {
    const s = activeScene();
    if (s.frames.length <= 1) {
      window.alert('至少保留一帧');
      return;
    }
    s.frames.splice(state.currentFrame, 1);
    s.inPoint = Math.min(s.inPoint, s.frames.length - 1);
    s.outPoint = Math.min(s.outPoint, s.frames.length - 1);
    const next = Math.min(state.currentFrame, s.frames.length - 1);
    clock.seekToFrame(next);
    persist(); renderAll();
  });
}

function bindPanel() {
  $('stepSelect').addEventListener('change', (e) => {
    const s = activeScene();
    s.frames[state.currentFrame].footstep = e.target.value;
    persist(); renderAll();
  });

  $('applySubtitleBtn').addEventListener('click', () => {
    const s = activeScene();
    const text = $('subtitleText').value.trim();
    if (!text) return;
    const existing = s.subtitles.find((sub) =>
      state.currentFrame >= sub.startFrame && state.currentFrame <= sub.endFrame);
    if (existing) {
      existing.text = text;
    } else {
      s.subtitles.push({
        id: `sub_${Math.random().toString(36).slice(2, 8)}`,
        startFrame: state.currentFrame,
        endFrame: Math.min(s.frames.length - 1, state.currentFrame + 2),
        text,
      });
    }
    $('subtitleText').value = '';
    persist(); renderAll();
  });

  $('audioStart').addEventListener('change', (e) => {
    const s = activeScene();
    s.audioStartFrame = Math.max(0, Math.min(s.frames.length - 1, Number(e.target.value)));
    persist(); renderAll();
  });
  $('fadeIn').addEventListener('change', (e) => {
    const s = activeScene();
    s.fadeInFrames = Math.max(0, Math.min(6, Number(e.target.value)));
    persist(); renderAll();
  });
  $('fadeOut').addEventListener('change', (e) => {
    const s = activeScene();
    s.fadeOutFrames = Math.max(0, Math.min(6, Number(e.target.value)));
    persist(); renderAll();
  });
}

function bindSceneOps() {
  $('sceneSelect').addEventListener('change', (e) => switchScene(e.target.value));
  $('addSceneBtn').addEventListener('click', () => {
    const scene = createBlankScene(`场景 ${state.project.scenes.length + 1}`);
    state.project.scenes.push(scene);
    populateSceneSelect();
    switchScene(scene.id);
  });
}

// 场景切换：先停时钟并切断所有已调度声音，再换数据并把时钟归零。
// 这样音频绝不会从上一场景继续播放，关键帧随工程数据整体保留。
function switchScene(sceneId) {
  clock.resetForScene();
  audio.panic();
  state.project.activeSceneId = sceneId;
  const s = activeScene();
  state.currentFrame = s.inPoint;
  $('sceneSelect').value = sceneId;
  persist();
  renderAll(0);
  $('statusLog').textContent += `🔀 切换到「${s.name}」，音频已停止并归零\n`;
}

function bindProjectIo() {
  $('saveBtn').addEventListener('click', () => {
    const data = saveProjectLocal(state.project);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `stickframe-${Date.now()}.json`);
    $('statusLog').textContent += '💾 工程已保存（localStorage + JSON 文件）\n';
  });

  $('openBtn').addEventListener('click', () => $('projectFile').click());
  $('projectFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const project = JSON.parse(await file.text());
      if (!project || !Array.isArray(project.scenes)) throw new Error('工程文件无效');
      clock.resetForScene();
      audio.panic();
      state.project = project;
      state.currentFrame = activeScene().inPoint;
      $('fpsSelect').value = String(project.fps);
      populateSceneSelect();
      persist();
      renderAll(0);
      $('statusLog').textContent += '📂 工程已重新打开，时间线/字幕/转场/音频起点已恢复\n';
    } catch (err) {
      window.alert(`打开失败：${err.message}；当前工程保持不变`);
    } finally {
      e.target.value = '';
    }
  });
}

function bindExport() {
  $('exportGifBtn').addEventListener('click', async () => {
    const snapshot = structuredClone(state.project); // 失败时用于证明原工程未变
    const s = activeScene();
    const fps = state.project.fps;
    try {
      const blob = await exportGif(s, fps, STAGE_W, STAGE_H, state.exportHooks);
      downloadBlob(blob, `stickframe-${Date.now()}.gif`);
      $('statusLog').textContent +=
        `🎞 GIF 导出成功：${s.outPoint - s.inPoint + 1} 帧 × ${(1 / fps).toFixed(3)}s ` +
        `= ${expectedExportSeconds(s, fps).toFixed(3)}s\n`;
    } catch (err) {
      ensureProjectIntact(snapshot);
      window.alert(`GIF 导出失败：${err.message}。原工程已保留，未做任何修改。`);
    } finally {
      state.exportHooks.failNext = false;
    }
  });

  $('exportWebmBtn').addEventListener('click', async () => {
    const snapshot = structuredClone(state.project);
    const s = activeScene();
    const fps = state.project.fps;
    try {
      const blob = await exportWebm({
        scene: s,
        fps,
        width: STAGE_W,
        height: STAGE_H,
        audio,
        hooks: state.exportHooks,
        clockFactory: (audioEngine, scene, useFps, onFrame) =>
          new MasterClock({
            audio: audioEngine,
            fpsRef: () => useFps,
            sceneRef: () => scene,
            onFrame,
            onEvent: (ev) => state.eventLog.push(ev),
          }),
      });
      downloadBlob(blob, `stickframe-${Date.now()}.webm`);
      $('statusLog').textContent +=
        `🎬 WebM 导出成功：预计时长 ${expectedExportSeconds(s, fps).toFixed(3)}s，含脚步声音轨\n`;
    } catch (err) {
      ensureProjectIntact(snapshot);
      window.alert(`WebM 导出失败：${err.message}。原工程已保留，未做任何修改。`);
    } finally {
      state.exportHooks.failNext = false;
    }
  });
}

function ensureProjectIntact(snapshot) {
  const before = JSON.stringify(snapshot);
  const after = JSON.stringify(state.project);
  if (before !== after) {
    // 理论上不会发生：导出全程只读工程；这里做最后一道保险
    state.project = snapshot;
    persist();
    renderAll();
  }
  $('statusLog').textContent += '⚠️ 导出失败，已校验原工程完整保留\n';
}
