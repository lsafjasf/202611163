// 确定性渲染：同一 (scene, frameIndex, fps) 永远产出相同像素。
// 舞台、帧条、GIF 导出与 WebM 导出都复用这里的纯函数。

import { BONES, JOINTS, MAX_FRAMES } from './model.js';

export function frameIndexAt(scene, timeSec, fps) {
  const span = scene.outPoint - scene.inPoint;
  const count = span + 1;
  const local = Math.floor(timeSec * fps);
  const wrapped = ((local % count) + count) % count;
  return scene.inPoint + wrapped;
}

export function sceneDuration(scene, fps) {
  return (scene.outPoint - scene.inPoint + 1) / fps;
}

function fadeAlpha(scene, index) {
  let alpha = 1;
  if (scene.fadeInFrames > 0 && index < scene.inPoint + scene.fadeInFrames) {
    alpha = Math.min(alpha, (index - scene.inPoint + 1) / scene.fadeInFrames);
  }
  const fadeStart = scene.outPoint - scene.fadeOutFrames + 1;
  if (scene.fadeOutFrames > 0 && index >= fadeStart) {
    alpha = Math.min(alpha, (scene.outPoint - index + 1) / scene.fadeOutFrames);
  }
  return Math.max(0, Math.min(1, alpha));
}

export function activeSubtitle(scene, index) {
  return (scene.subtitles || []).find((s) => index >= s.startFrame && index <= s.endFrame) || null;
}

export function drawSceneFrame(canvasLike, scene, index, opts = {}) {
  const ctx = canvasLike.getContext('2d');
  const W = canvasLike.width;
  const H = canvasLike.height;
  const frame = scene.frames[index];

  // 背景
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#f4f1e8';
  ctx.fillRect(0, 0, W, H);
  // 地面
  ctx.strokeStyle = '#c9c2b0';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, H - 38);
  ctx.lineTo(W, H - 38);
  ctx.stroke();

  const alpha = fadeAlpha(scene, index);
  ctx.save();
  ctx.globalAlpha = alpha;
  if (frame) drawFigure(ctx, frame.pose, opts);
  ctx.restore();

  // 字幕
  const sub = activeSubtitle(scene, index);
  if (sub && sub.text) {
    ctx.save();
    ctx.globalAlpha = 0.82 * alpha;
    ctx.font = `${Math.round(H * 0.055)}px sans-serif`;
    const metrics = ctx.measureText(sub.text);
    const boxW = metrics.width + 24;
    const boxH = H * 0.09;
    const x = (W - boxW) / 2;
    const y = H - boxH - 14;
    ctx.fillStyle = 'rgba(20,26,36,0.78)';
    ctx.fillRect(x, y, boxW, boxH);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(sub.text, W / 2, y + boxH / 2);
    ctx.restore();
  }

  // 帧标记（导出时关闭）
  if (opts.showFrameTag !== false) {
    ctx.fillStyle = 'rgba(20,26,36,0.6)';
    ctx.font = `${Math.round(H * 0.045)}px ui-monospace, monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`帧 ${index + 1}/${scene.frames.length}`, 10, 8);
  }

  // 编辑模式关节点
  if (opts.editMode && frame) {
    for (const key of JOINTS) {
      const p = frame.pose[key];
      ctx.beginPath();
      ctx.arc(p.x, p.y, key === 'head' ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = key === 'head' ? '#d8452f' : '#2b6cb0';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
}

function drawFigure(ctx, pose, opts) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#1f2937';
  ctx.lineWidth = opts.thumb ? 2.5 : 4;
  for (const [a, b] of BONES) {
    ctx.beginPath();
    ctx.moveTo(pose[a].x, pose[a].y);
    ctx.lineTo(pose[b].x, pose[b].y);
    ctx.stroke();
  }
  // 头
  ctx.beginPath();
  ctx.arc(pose.head.x, pose.head.y, opts.thumb ? 9 : 13, 0, Math.PI * 2);
  ctx.fillStyle = '#f4f1e8';
  ctx.fill();
  ctx.stroke();
}

// 帧条：每张缩略图、入/出点、播放头，全部按同一帧索引渲染。
export function drawStrip(canvas, project, scene, currentIndex) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0c1017';
  ctx.fillRect(0, 0, W, H);

  const pad = 10;
  const gap = 8;
  const thumbW = (W - pad * 2 - gap * (MAX_FRAMES - 1)) / MAX_FRAMES;
  const thumbH = 92;

  for (let i = 0; i < MAX_FRAMES; i += 1) {
    const x = pad + i * (thumbW + gap);
    const y = 26;
    const exists = i < scene.frames.length;

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, thumbW, thumbH);
    ctx.clip();
    if (exists) {
      const thumb = { width: thumbW, height: thumbH, getContext: () => ctx };
      ctx.save();
      ctx.translate(x, y);
      const sx = thumbW / project.stageWidth;
      const sy = thumbH / project.stageHeight;
      ctx.scale(sx, sy);
      const mini = { width: project.stageWidth, height: project.stageHeight, getContext: () => ctx };
      drawSceneFrame(mini, scene, i, { showFrameTag: false, thumb: true });
      ctx.restore();
    } else {
      ctx.fillStyle = '#151c28';
      ctx.fillRect(x, y, thumbW, thumbH);
    }
    ctx.restore();

    // 边框状态
    ctx.lineWidth = i === currentIndex ? 3 : 1.5;
    ctx.strokeStyle = i === currentIndex ? '#ffd166' : '#2c3a50';
    ctx.strokeRect(x + 0.5, y + 0.5, thumbW - 1, thumbH - 1);

    // 入/出点
    if (i === scene.inPoint) {
      tag(ctx, x, y - 16, '入', '#46b47a');
    } else if (i === scene.outPoint) {
      tag(ctx, x, y - 16, '出', '#e07a5f');
    }

    // 帧号与脚步标记
    ctx.fillStyle = '#8fa0b8';
    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${i + 1}`, x + 3, y + thumbH + 6);
    if (exists && scene.frames[i].footstep !== 'none') {
      const f = scene.frames[i].footstep;
      ctx.fillStyle = f === 'left' ? '#6cc6ff' : f === 'right' ? '#ff9f6c' : '#c9a0ff';
      ctx.textAlign = 'right';
      ctx.fillText(f === 'both' ? '👣👣' : '👣', x + thumbW - 3, y + thumbH + 6);
    }
  }
}

function tag(ctx, x, y, text, color) {
  ctx.fillStyle = color;
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(text, x + 2, y + 11);
}

export function stripCellAt(canvas, clientX) {
  const rect = canvas.getBoundingClientRect();
  const x = (clientX - rect.left) / rect.width * canvas.width;
  const pad = 10;
  const gap = 8;
  const thumbW = (canvas.width - pad * 2 - gap * (MAX_FRAMES - 1)) / MAX_FRAMES;
  const i = Math.floor((x - pad) / (thumbW + gap));
  if (i < 0 || i >= MAX_FRAMES) return -1;
  return i;
}

export function jointAt(scene, index, canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = (clientX - rect.left) / rect.width * canvas.width;
  const y = (clientY - rect.top) / rect.height * canvas.height;
  const pose = scene.frames[index].pose;
  let hit = null;
  let best = 14 * 14;
  for (const key of JOINTS) {
    const p = pose[key];
    const d2 = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d2 <= best) {
      best = d2;
      hit = key;
    }
  }
  return hit;
}

export function clientToStage(canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left) / rect.width * canvas.width,
    y: (clientY - rect.top) / rect.height * canvas.height,
  };
}
