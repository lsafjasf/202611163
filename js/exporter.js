// WebM 导出器。
// 关键保证：
// 1) 画面（canvas.captureStream）与合成音轨（MediaStreamDestination）
//    合并进同一条 MediaStream，由同一个 MediaRecorder 同时写入；
// 2) 录制的分片只存在于内存，取消导出时直接丢弃，绝不生成文件残片；
// 3) 导出在工程快照上进行，导出失败/取消都不会改动原工程；
// 4) 导出完成后用 <video> 实测时长，校验入点/出点/总时长一致。
import { renderFrame } from "./renderer.js";
import { sceneDuration, cloneProject } from "./project.js";

function pickMimeType() {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  for (const m of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

// 通过 seek 技巧读取 WebM 真实时长（MediaRecorder 产出的时长常为 Infinity）。
export function probeDuration(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    const cleanup = () => URL.revokeObjectURL(url);
    video.onloadedmetadata = () => {
      if (video.duration === Infinity || isNaN(video.duration)) {
        video.currentTime = Number.MAX_SAFE_INTEGER;
        video.ontimeupdate = () => {
          const d = video.duration;
          cleanup();
          resolve(isFinite(d) ? d : video.currentTime);
        };
      } else {
        const d = video.duration;
        cleanup();
        resolve(d);
      }
    };
    video.onerror = () => { cleanup(); reject(new Error("无法解析导出的 WebM")); };
    video.src = url;
  });
}

export class Exporter {
  constructor(audioEngine) {
    this.audio = audioEngine;
    this.active = null;
  }

  get isExporting() { return this.active !== null; }

  // project: 当前工程；sceneIndex: 导出哪个场景。
  // callbacks: onProgress / onDone(blob, expected) / onError(err) / onCancel()
  export(project, sceneIndex, canvas, callbacks) {
    if (this.active) throw new Error("已有导出任务进行中");
    const mime = pickMimeType();
    if (!mime) throw new Error("当前浏览器不支持 WebM 录制");

    // 快照：导出期间用户继续编辑也不影响本次导出，更不会反向污染工程。
    const snapshot = cloneProject(project);
    const scene = snapshot.scenes[sceneIndex];
    const duration = sceneDuration(scene);
    const fps = snapshot.fps || 30;

    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = snapshot.width;
    exportCanvas.height = snapshot.height;
    const ctx = exportCanvas.getContext("2d");

    const videoStream = exportCanvas.captureStream(fps);
    const audioStream = this.audio.attachExportDestination();
    const mixed = new MediaStream([
      ...videoStream.getVideoTracks(),
      ...audioStream.getAudioTracks(),
    ]);

    const recorder = new MediaRecorder(mixed, {
      mimeType: mime,
      videoBitsPerSecond: 6_000_000,
      audioBitsPerSecond: 128_000,
    });

    const state = { recorder, chunks: [], cancelled: false, rafId: 0, failed: false };
    this.active = state;

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0 && !state.cancelled) state.chunks.push(e.data);
    };

    recorder.onerror = (e) => {
      state.failed = true;
      this._teardown(state);
      callbacks.onError?.(e.error || new Error("录制器错误"));
    };

    recorder.onstop = () => {
      const wasCancelled = state.cancelled;
      const chunks = state.chunks;
      this._teardown(state);
      if (wasCancelled || state.failed) {
        // 取消/失败：分片随 state 一起被丢弃，不创建 Blob、不触发下载。
        if (wasCancelled) callbacks.onCancel?.();
        return;
      }
      const blob = new Blob(chunks, { type: mime });
      callbacks.onDone?.(blob, duration);
    };

    // 从场景入点开始，与主时钟同源（performance.now）实时推进 duration 秒。
    const plan = this.audio.play(scene, 0);
    const startPerf = performance.now();
    const tick = () => {
      if (state.cancelled || state.failed) return;
      const t = (performance.now() - startPerf) / 1000;
      if (t >= duration) {
        renderFrame(ctx, snapshot, scene, duration);
        try { recorder.stop(); } catch (_) { /* 已停止 */ }
        return;
      }
      renderFrame(ctx, snapshot, scene, t);
      callbacks.onProgress?.(t / duration);
      state.rafId = requestAnimationFrame(tick);
    };

    recorder.start(250); // 每 250ms 出一个分片，音画写入同一容器
    tick();
    return { expectedDuration: duration, audioPlan: plan };
  }

  cancel() {
    if (!this.active) return;
    this.active.cancelled = true;
    try { this.active.recorder.stop(); } catch (_) { /* 已停止 */ }
  }

  _teardown(state) {
    cancelAnimationFrame(state.rafId);
    this.audio.stopAll();
    this.audio.detachExportDestination();
    if (this.active === state) this.active = null;
  }
}

// 触发浏览器下载（仅在导出完整成功后才会被调用）。
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
