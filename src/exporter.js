// 导出器：GIF（离屏逐帧，时长精确）与 WebM（MediaRecorder 实时录制，含脚步声音轨）。
// 两者都只渲染入点..出点区间，因此导出总时长 = (out - in + 1) / fps。

import { drawSceneFrame } from './render.js';
import { encodeGif } from './gif.js';

function frameImages(scene, fps, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const frames = [];
  for (let i = scene.inPoint; i <= scene.outPoint; i += 1) {
    drawSceneFrame(canvas, scene, i, { showFrameTag: false });
    const ctx = canvas.getContext('2d');
    frames.push(ctx.getImageData(0, 0, width, height).data.slice());
  }
  return { canvas, frames };
}

export function expectedExportSeconds(scene, fps) {
  return (scene.outPoint - scene.inPoint + 1) / fps;
}

export async function exportGif(scene, fps, width, height, hooks = {}) {
  if (hooks.onBegin) hooks.onBegin({ format: 'gif' });
  if (hooks.failNext) {
    // 测试钩子：模拟编码阶段失败
    throw new Error('模拟的 GIF 编码失败');
  }
  const { frames } = frameImages(scene, fps, width, height);
  const blob = encodeGif(frames, width, height, fps);
  if (hooks.onFinish) hooks.onFinish({ format: 'gif', bytes: blob.size });
  return blob;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 逐帧实时录制入点..出点。画面帧与脚步声都挂在同一张 AudioContext
// 时间表上（每帧间隔精确为 1/fps），因此视频帧、声音与总时长共用同一时钟。
export async function exportWebm({
  scene, fps, width, height, audio, clockFactory, hooks = {},
}) {
  if (hooks.onBegin) hooks.onBegin({ format: 'webm' });
  if (hooks.failNext) throw new Error('模拟的 WebM 录制失败');

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const draw = (index) => drawSceneFrame(canvas, scene, index, { showFrameTag: false });
  draw(scene.inPoint);

  await audio.ensureContext();
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0];
  const audioDest = audio.ctx.createMediaStreamDestination();
  audio.master.connect(audioDest);
  audioDest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));

  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
    ? 'video/webm;codecs=vp9,opus'
    : 'video/webm';
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_500_000 });
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  const stopped = new Promise((resolve) => { recorder.onstop = resolve; });

  await audio.ensureContext();
  if (audio.ctx.state !== 'running') {
    await audio.ctx.resume().catch(() => {});
  }
  const frameCount = scene.outPoint - scene.inPoint + 1;
  const frameMs = 1000 / fps;
  // 先准备首帧并请求编码，再在基准时刻启动录制，压缩编码器的启动偏移
  const baseCtx = audio.now() + 0.4;

  // 1) 先把所有脚步按固定帧边界排进同一个 AudioContext 时间表
  for (let k = 0; k < frameCount; k += 1) {
    const globalFrame = scene.inPoint + k;
    if (globalFrame < scene.audioStartFrame) continue;
    const frame = scene.frames[globalFrame];
    if (frame && frame.footstep !== 'none') {
      audio.playFootstep(baseCtx + k / fps, frame.footstep);
    }
  }

  // 2) 画面帧按同一时间表驱动；用 ctx 时间校准，避免 rAF 漂移
  draw(scene.inPoint);
  if (track.requestFrame) track.requestFrame();
  await sleep(Math.max(0, (baseCtx - audio.now()) * 1000));
  recorder.start(100);
  for (let k = 0; k < frameCount; k += 1) {
    const targetCtx = baseCtx + k / fps;
    const waitMs = Math.max(0, (targetCtx - audio.now()) * 1000);
    await sleep(waitMs);
    draw(scene.inPoint + k);
    if (track.requestFrame) track.requestFrame();
  }
  // 对齐到最后一帧开始时刻（目标时长 = frameCount/fps 的帧边界）
  const endCtx = baseCtx + (frameCount - 1) / fps;
  await sleep(Math.max(0, (endCtx - audio.now()) * 1000));
  // 在最后一帧时刻立即停止，避免尾部额外累积时间戳
  recorder.stop();
  await stopped;
  try { audio.master.disconnect(audioDest); } catch { /* 忽略 */ }
  track.stop();

  const blob = new Blob(chunks, { type: 'video/webm' });
  if (hooks.onFinish) hooks.onFinish({ format: 'webm', bytes: blob.size });
  return blob;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
