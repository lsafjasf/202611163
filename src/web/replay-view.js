import { ReplayPlayer } from '../engine/replay.js';
import { COLORS, conflictLabel, roundRect } from './draw-utils.js';

// 回放查看器：时间轴拖动、逐冲突跳转，画面复用实时渲染器绘制快照状态。
export class ReplayView {
  constructor(replay, renderFn) {
    this.player = new ReplayPlayer(replay);
    this.renderFn = renderFn;
    this.open = true;
  }

  handleAction(action) {
    if (action === 'replay') this.open = !this.open;
    if (!this.open) return;
    if (action === 'swap') this.player.nextConflict();
    if (action === 'debug') this.player.prevConflict();
    if (action === 'pause') {
      this.player.playing = !this.player.playing;
    }
  }

  update(dt) {
    if (this.open) this.player.advance(dt);
  }

  draw(ctx, width, height) {
    if (!this.open) return;
    const state = this.player.currentState;
    this.renderFn(ctx, state, { width, height });

    ctx.fillStyle = 'rgba(8,10,16,0.82)';
    ctx.fillRect(0, height - 130, width, 130);
    ctx.fillStyle = COLORS.accent;
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.fillText('回放查看（L 关闭 · P 播放/暂停 · Tab 下一冲突 · D 上一冲突）', 20, height - 104);

    // 时间轴
    const barX = 20;
    const barW = width - 40;
    const barY = height - 78;
    ctx.fillStyle = '#0d1119';
    roundRect(ctx, barX, barY, barW, 12, 6);
    ctx.fill();
    for (const tick of this.player.replay.conflictTicks) {
      const px = barX + barW * (tick / this.player.length);
      ctx.fillStyle = COLORS.bad;
      ctx.fillRect(px - 2, barY - 4, 4, 20);
    }
    const ratio = this.player.cursorTick / this.player.length;
    ctx.fillStyle = COLORS.accent;
    roundRect(ctx, barX + barW * ratio - 5, barY - 4, 10, 20, 4);
    ctx.fill();

    const at = this.player.eventsAtCursor;
    const conflict = at.find((e) => conflictLabel(e.type) !== '未知冲突');
    ctx.fillStyle = conflict ? COLORS.bad : COLORS.muted;
    ctx.font = '13px system-ui, sans-serif';
    const info = conflict
      ? `冲突时刻 ${this.player.currentState.time.toFixed(2)}s：${conflictLabel(conflict.type)}`
      : `回放时间 ${this.player.currentState.time.toFixed(2)}s / ${this.player.replay.durationSec.toFixed(1)}s`;
    ctx.fillText(info, 20, height - 34);
  }
}
