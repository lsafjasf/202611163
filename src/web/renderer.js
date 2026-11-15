import { CONFIG } from '../engine/config.js';
import { drawCenterHud } from './renderer-hud.js';
import { COLORS, roundRect } from './draw-utils.js';

function panel(ctx, x, y, w, h, title) {
  ctx.fillStyle = COLORS.panel;
  roundRect(ctx, x, y, w, h, 12);
  ctx.fill();
  ctx.fillStyle = COLORS.muted;
  ctx.font = '600 14px system-ui, sans-serif';
  ctx.fillText(title, x + 16, y + 24);
}

function drawGauge(ctx, x, y, w, label, value, min, max, locked) {
  ctx.fillStyle = COLORS.muted;
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillText(label, x, y - 8);
  ctx.fillStyle = '#0d1119';
  roundRect(ctx, x, y, w, 14, 7);
  ctx.fill();
  const stableX = x + w * min;
  const stableW = w * (max - min);
  ctx.fillStyle = 'rgba(61,220,151,0.25)';
  roundRect(ctx, stableX, y, stableW, 14, 6);
  ctx.fill();
  const px = x + w * Math.max(0, Math.min(1, value));
  ctx.fillStyle = locked ? COLORS.ok : value > max ? COLORS.bad : COLORS.accent;
  roundRect(ctx, px - 4, y - 3, 8, 20, 4);
  ctx.fill();
}

function drawClampStation(ctx, state, x, y, w, h) {
  panel(ctx, x, y, w, h, '左侧工位 · 底座夹具');
  const cx = x + w / 2;
  const baseY = y + h - 70;

  // 底座
  ctx.fillStyle = COLORS.metal;
  roundRect(ctx, cx - 70, baseY, 140, 26, 6);
  ctx.fill();

  // 夹臂张开度随压力变化
  const gap = 46 - state.clamp.pressure * 26;
  ctx.strokeStyle = state.clamp.locked ? COLORS.ok : COLORS.warn;
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(cx - 70, baseY);
  ctx.lineTo(cx - gap, baseY - 56);
  ctx.moveTo(cx + 70, baseY);
  ctx.lineTo(cx + gap, baseY - 56);
  ctx.stroke();

  // 垫圈
  ctx.fillStyle = state.gasket.health > 0.35 ? COLORS.ok : COLORS.bad;
  ctx.globalAlpha = Math.max(0.25, state.gasket.health);
  ctx.beginPath();
  ctx.ellipse(cx, baseY - 18, 34, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  drawGauge(
    ctx, x + 20, y + 56, w - 40,
    `压力 ${(state.clamp.pressure * 100).toFixed(0)}%  锁定进度 ${(state.clamp.lockProgress * 100).toFixed(0)}%`,
    state.clamp.pressure,
    CONFIG.clamp.stableMin, CONFIG.clamp.stableMax,
    state.clamp.locked
  );

  ctx.fillStyle = state.clamp.locked ? COLORS.ok : COLORS.warn;
  ctx.font = '700 15px system-ui, sans-serif';
  ctx.fillText(state.clamp.locked ? '夹具已锁稳' : '夹具未稳定', x + 20, y + 108);
}

function drawModuleStation(ctx, state, x, y, w, h) {
  panel(ctx, x, y, w, h, '右侧工位 · 上部模块');
  const cx = x + w / 2;
  const topY = y + 70;

  // 导轨
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(x + 24, topY + 40);
  ctx.lineTo(x + w - 24, topY + 40);
  ctx.stroke();

  // 模块位置 = 中心 + 偏移
  const mx = cx + state.module.offset * (w / 2 - 60);
  ctx.fillStyle = COLORS.accent;
  roundRect(ctx, mx - 34, topY, 68, 64, 8);
  ctx.fill();
  ctx.fillStyle = COLORS.text;
  ctx.font = '700 13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('模块', mx, topY + 38);
  ctx.textAlign = 'left';

  // 对准容差区
  ctx.strokeStyle = 'rgba(61,220,151,0.6)';
  ctx.setLineDash([6, 6]);
  ctx.lineWidth = 2;
  const tolW = CONFIG.module.alignTolerance * (w / 2 - 60);
  ctx.strokeRect(cx - tolW, topY - 8, tolW * 2, 90);
  ctx.setLineDash([]);

  // 误差数字与方向箭头
  const aligned = Math.abs(state.module.offset) <= CONFIG.module.alignTolerance;
  ctx.fillStyle = aligned ? COLORS.ok : COLORS.warn;
  ctx.font = '700 15px system-ui, sans-serif';
  ctx.fillText(
    `对准误差 ${Math.abs(state.module.offset).toFixed(2)} ${aligned ? '✓ 已对准' : (state.module.offset > 0 ? '→ 偏右' : '← 偏左')}`,
    x + 20, y + h - 46
  );
  if (state.module.pressing) {
    ctx.fillStyle = COLORS.warn;
    ctx.fillText('▼ 压装中', x + 20, y + h - 22);
  }
}

export function render(ctx, state, layout) {
  const { width, height } = layout;
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, width, height);

  drawClampStation(ctx, state, 16, 70, width / 2 - 28, height - 150);
  drawModuleStation(ctx, state, width / 2 + 12, 70, width / 2 - 28, height - 150);
  drawCenterHud(ctx, state, width, height);
}

export { COLORS, roundRect };
