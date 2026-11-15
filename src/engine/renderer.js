// 确定性 Canvas 渲染：同一工程 + 同一时间 -> 同一像素，不依赖实时时钟。
import { valueAt } from './interpolate.js';
import { locateScene } from './project.js';

function num(track, t, fallback) {
  const v = valueAt(track, t, 'number');
  return v === undefined ? fallback : v;
}
function col(track, t, fallback) {
  const v = valueAt(track, t, 'color');
  return v === undefined ? fallback : v;
}

function drawBackground(ctx, scene, t, w, h) {
  const tr = scene.layers.background.tracks;
  const cx = num(tr.x, t, 0.5) * w;
  const cy = num(tr.y, t, 0.5) * h;
  const r = num(tr.radius, t, 150);
  const rot = num(tr.rotation, t, 0);
  const opacity = num(tr.opacity, t, 0.8);
  const color = col(tr.color, t, '#1d2b64');

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  const grad = ctx.createRadialGradient(0, 0, r * 0.1, 0, 0, r);
  grad.addColorStop(0, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  for (let i = 0; i < 6; i += 1) {
    const a = (Math.PI / 3) * i;
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawTitle(ctx, scene, t, w, h) {
  const layer = scene.layers.title;
  const tr = layer.tracks;
  const opacity = num(tr.opacity, t, 1);
  if (opacity <= 0.001) return;
  const x = num(tr.x, t, 0.5) * w;
  const y = num(tr.y, t, 0.25) * h;
  const size = num(tr.fontSize, t, 64);
  const color = col(tr.color, t, '#ffffff');
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.fillStyle = color;
  ctx.font = `700 ${size}px "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(layer.text, x, y);
  ctx.restore();
}

function drawLabels(ctx, scene, t, w, h) {
  const layer = scene.layers.labels;
  const tr = layer.tracks;
  const opacity = num(tr.opacity, t, 1);
  if (opacity <= 0.001) return;
  const shift = num(tr.y, t, 0) * h;
  const color = col(tr.color, t, '#9ad7ff');
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.textAlign = 'center';
  for (const item of layer.items) {
    const x = item.offsetX * w;
    const y = item.offsetY * h + shift;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(x - 90, y - 34, 180, 68);
    ctx.fillStyle = color;
    ctx.font = '600 30px sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(item.value, x, y);
    ctx.font = '400 16px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(item.label, x, y + 22);
  }
  ctx.restore();
}

function renderScene(ctx, scene, local, w, h) {
  ctx.fillStyle = scene.palette?.bg || '#000';
  ctx.fillRect(0, 0, w, h);
  drawBackground(ctx, scene, local, w, h);
  drawTitle(ctx, scene, local, w, h);
  drawLabels(ctx, scene, local, w, h);
}

// 计算转场混合权重：处于场景入口转场区间时返回 0..1。
function transitionWeight(project, scene, globalTime) {
  if (scene.inPoint <= 0) return 1;
  const dur = scene.transition?.duration || 0;
  if (!dur || globalTime <= scene.inPoint) return 0;
  const p = Math.min(1, (globalTime - scene.inPoint) / dur);
  return p;
}

export function renderFrame(ctx, project, globalTime, width, height) {
  const w = width || project.width;
  const h = height || project.height;
  const { scene, local, global } = locateScene(project, globalTime);
  const weight = transitionWeight(project, scene, global);

  if (weight >= 1 || scene.inPoint <= 0) {
    renderScene(ctx, scene, local, w, h);
    return;
  }

  // 转场：与上一个场景交叉混合（fade / slide）。
  const idx = project.scenes.indexOf(scene);
  const prev = project.scenes[idx - 1];
  const prevLocal = scene.inPoint - prev.inPoint;
  if (scene.transition?.type === 'slide') {
    renderScene(ctx, prev, prevLocal, w, h);
    ctx.save();
    ctx.translate((1 - weight) * w, 0);
    renderScene(ctx, scene, local, w, h);
    ctx.restore();
  } else {
    renderScene(ctx, prev, prevLocal, w, h);
    ctx.save();
    ctx.globalAlpha = weight;
    renderScene(ctx, scene, local, w, h);
    ctx.restore();
  }
}
