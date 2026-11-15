// Canvas 渲染器：renderFrame 是 (project, scene, t) 的纯函数，
// 同一 t 必得同一画面，这是"暂停截图 vs 重放截图一致"的基础。
import { sampleLayer } from "./keyframes.js";

function drawWave(ctx, w, h, params, t) {
  const { amplitude, frequency, speed, hue } = params;
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, `hsl(${hue}, 55%, 10%)`);
  grad.addColorStop(1, `hsl(${(hue + 40) % 360}, 60%, 22%)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  for (let band = 0; band < 3; band++) {
    const baseY = h * (0.55 + band * 0.14);
    const amp = amplitude * (1 - band * 0.25);
    const phase = t * speed * (1 + band * 0.35) + band * 1.7;
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 6) {
      const k = (x / w) * Math.PI * 2 * frequency;
      const y = baseY + Math.sin(k + phase) * amp + Math.sin(k * 0.5 - phase * 0.7) * amp * 0.4;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = `hsla(${(hue + band * 18) % 360}, 70%, ${38 + band * 10}%, ${0.55 - band * 0.12})`;
    ctx.fill();
  }
}

function drawLightband(ctx, w, h, params) {
  const { x, opacity, angle, width } = params;
  if (opacity <= 0.001) return;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
  ctx.translate(x, h / 2);
  ctx.rotate((angle * Math.PI) / 180);
  const grad = ctx.createLinearGradient(-width / 2, 0, width / 2, 0);
  grad.addColorStop(0, "rgba(255,255,255,0)");
  grad.addColorStop(0.5, "rgba(255,255,255,0.9)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  const len = Math.hypot(w, h) * 1.2;
  ctx.fillRect(-width / 2, -len / 2, width, len);
  ctx.restore();
}

function drawTitle(ctx, scene, params) {
  const { x, y, opacity, scale, tracking } = params;
  if (opacity <= 0.001) return;
  const text = scene.layers.title.text || "";
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.font = "bold 64px 'PingFang SC', 'Microsoft YaHei', sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const chars = [...text];
  const widths = chars.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + tracking * (chars.length - 1);
  let pen = -total / 2;
  ctx.shadowColor = "rgba(120,190,255,0.9)";
  ctx.shadowBlur = 24;
  ctx.fillStyle = "#f4f8ff";
  chars.forEach((c, i) => {
    ctx.fillText(c, pen, 0);
    pen += widths[i] + tracking;
  });
  ctx.restore();
}

function drawSubtitles(ctx, w, h, scene, t) {
  const active = scene.subtitles.filter((s) => t >= s.start && t < s.end);
  if (active.length === 0) return;
  ctx.save();
  ctx.font = "28px 'PingFang SC', 'Microsoft YaHei', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  active.forEach((sub, i) => {
    const y = h - 28 - i * 38;
    const fade = Math.min(1, (t - sub.start) / 0.25, (sub.end - t) / 0.25);
    ctx.globalAlpha = Math.max(0, fade);
    const metrics = ctx.measureText(sub.text);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(w / 2 - metrics.width / 2 - 14, y - 32, metrics.width + 28, 40);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(sub.text, w / 2, y);
  });
  ctx.restore();
}

function drawTransition(ctx, w, h, scene, t) {
  const d = scene.transition?.duration || 0;
  if (scene.transition?.type === "fade" && d > 0 && t < d) {
    ctx.save();
    ctx.globalAlpha = 1 - t / d;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
}

// t 为场景本地时间（0 .. scene.out - scene.in）。
export function renderFrame(ctx, project, scene, t) {
  const w = project.width, h = project.height;
  ctx.clearRect(0, 0, w, h);
  drawWave(ctx, w, h, sampleLayer(scene.layers.wave, t), t);
  drawLightband(ctx, w, h, sampleLayer(scene.layers.lightband, t));
  drawTitle(ctx, scene, sampleLayer(scene.layers.title, t));
  drawSubtitles(ctx, w, h, scene, t);
  drawTransition(ctx, w, h, scene, t);
}

// 画面指纹：对像素做稳定哈希，用于"同一时刻两帧一致"的自检。
export function frameHash(ctx, w, h) {
  const data = ctx.getImageData(0, 0, w, h).data;
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i += 97) {
    hash ^= data[i];
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
