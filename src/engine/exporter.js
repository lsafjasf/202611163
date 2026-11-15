// 导出：WebM（VP9/Opus，含音频）与工程 JSON。
// 所有导出基于工程深拷贝，失败时绝不修改当前已加载工程。
import { cloneProject } from './project.js';
import { renderFrame } from './renderer.js';

function pickMimeType() {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  for (const type of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

export function exportProjectJSON(project) {
  const snapshot = cloneProject(project);
  return JSON.stringify(snapshot, null, 2);
}

// 以固定帧率离屏渲染并录制，时长严格等于 in=0 到 out=duration。
export async function exportWebM(project, audioEngine, {
  fps = 30,
  width = project.width,
  height = project.height,
  onProgress = () => {},
  simulateFailure = false,
  liveAudio = true,
} = {}) {
  const working = cloneProject(project);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  // 离屏 canvas 同样需要等 Web Font，避免中文回退成方框。
  if (document.fonts && document.fonts.ready) await document.fonts.ready;

  let recorder;
  let track;
  try {
    const stream = canvas.captureStream(fps);
    track = stream.getVideoTracks()[0];
    if (audioEngine && audioEngine.stream) {
      for (const audioTrack of audioEngine.stream.getAudioTracks()) {
        stream.addTrack(audioTrack);
      }
    }
    const mimeType = pickMimeType();
    if (simulateFailure) throw new Error('模拟导出失败');
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  } catch (err) {
    // 录制器初始化失败：直接抛出，调用方保留原工程，working 被丢弃。
    throw new Error(`导出初始化失败: ${err.message}`);
  }

  const chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const totalMs = working.duration * 1000;
  const frameMs = 1000 / fps;
  const started = new Promise((resolve, reject) => {
    recorder.onstop = resolve;
    recorder.onerror = (e) => reject(new Error(`录制错误: ${e.error.name}`));
  });

  recorder.start(100);
  const exportStartPerf = performance.now();
  let ctxBaseTime = 0;
  if (liveAudio && audioEngine && audioEngine.ctx) {
    await audioEngine.ensureContext();
    ctxBaseTime = audioEngine.ctx.currentTime + 0.2;
    for (const ev of audioEngine.allEvents(working)) {
      const when = ctxBaseTime + ev.global;
      if (ev.kind === 'kick') audioEngine.kick(when);
      else audioEngine.hat(when);
    }
  }
  let frames = 0;
  for (let t = 0; t < totalMs; t += frameMs) {
    // 以墙钟节奏推进，保证录制时长与工程时长一致，音频同步对齐。
    const target = exportStartPerf + t;
    let wait = target - performance.now();
    while (wait > 0) {
      await new Promise((r) => setTimeout(r, Math.min(wait, 8)));
      wait = target - performance.now();
    }
    const timeSec = Math.min(t / 1000, working.duration);
    renderFrame(ctx, working, timeSec, width, height);
    if (track.requestFrame) track.requestFrame();
    frames += 1;
    onProgress(Math.min(1, t / totalMs));
  }
  // 等待最后一个音频事件与尾音结束，再停止，保证出点一致。
  const tailMs = liveAudio && audioEngine ? 300 : 0;
  const endTarget = exportStartPerf + totalMs + tailMs;
  while (performance.now() < endTarget) {
    await new Promise((r) => setTimeout(r, 10));
  }
  recorder.stop();
  await started;
  onProgress(1);

  const blob = new Blob(chunks, { type: 'video/webm' });
  return {
    blob,
    mimeType: recorder.mimeType || 'video/webm',
    frames,
    duration: working.duration,
    size: blob.size,
  };
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
