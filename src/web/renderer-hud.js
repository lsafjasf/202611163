import { COLORS, conflictLabel, roundRect } from './draw-utils.js';
import { CONFIG, MATCH, ROUND } from '../engine/config.js';

export function drawCenterHud(ctx, state, width, height) {
  const cx = width / 2;

  // 顶部任务与共享资源
  ctx.fillStyle = COLORS.text;
  ctx.font = '700 18px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(
    `第 ${Math.min(state.round.index + 1, CONFIG.requiredWins)} / ${CONFIG.requiredWins} 组装配`,
    cx, 32
  );
  ctx.font = '13px system-ui, sans-serif';
  ctx.fillStyle = COLORS.muted;
  const remaining = CONFIG.startingGaskets - state.score.gasketsUsed;
  ctx.fillText(
    `成功 ${state.score.wins}  失误 ${state.score.fails}  冲突 ${state.score.conflicts}  剩余垫圈 ${remaining}`,
    cx, 54
  );
  ctx.textAlign = 'left';

  // 中央倒计时圆
  const cy = height / 2 - 10;
  ctx.beginPath();
  ctx.arc(cx, cy, 44, 0, Math.PI * 2);
  ctx.fillStyle = '#0d1119';
  ctx.fill();
  ctx.strokeStyle = state.round.timeLeft < 4 ? COLORS.bad : COLORS.accent;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = COLORS.text;
  ctx.font = '700 22px system-ui, sans-serif';
  ctx.textAlign = 'center';
  const shown = state.round.phase === ROUND.READY
    ? '准备'
    : state.round.timeLeft.toFixed(1);
  ctx.fillText(shown, cx, cy + 8);
  ctx.textAlign = 'left';

  // 阶段横幅
  if (state.round.phase === ROUND.READY) {
    banner(ctx, cx, height - 110, '双方就位…准备开始', COLORS.accent, width);
  } else if (state.round.phase === ROUND.SUCCESS) {
    banner(ctx, cx, height - 110, '✓ 本组装配成功', COLORS.ok, width);
  } else if (state.round.phase === ROUND.FAILED) {
    banner(ctx, cx, height - 110, `✗ 失误：${conflictLabel(state.round.conflictType)}`, COLORS.bad, width);
  }

  if (state.mode === MATCH.VICTORY) {
    overlay(ctx, width, height, '任务成功', '三组装配全部完成，合作默契！', COLORS.ok);
  } else if (state.mode === MATCH.DEFEAT) {
    overlay(ctx, width, height, '任务失败', '垫圈耗尽，按下 R 重新开始', COLORS.bad);
  } else if (state.paused) {
    overlay(ctx, width, height, '已暂停', '按 P / Esc 继续', COLORS.warn);
  }
}

function banner(ctx, cx, y, text, color, width) {
  ctx.font = '700 20px system-ui, sans-serif';
  const tw = ctx.measureText(text).width + 40;
  ctx.fillStyle = 'rgba(13,17,25,0.85)';
  roundRect(ctx, cx - tw / 2, y - 26, tw, 38, 10);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.fillText(text, cx, y);
  ctx.textAlign = 'left';
}

function overlay(ctx, width, height, title, sub, color) {
  ctx.fillStyle = 'rgba(8,10,16,0.72)';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = color;
  ctx.font = '800 42px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(title, width / 2, height / 2 - 12);
  ctx.fillStyle = COLORS.text;
  ctx.font = '16px system-ui, sans-serif';
  ctx.fillText(sub, width / 2, height / 2 + 26);
  ctx.textAlign = 'left';
}
