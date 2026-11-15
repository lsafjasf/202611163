// Canvas 渲染：舞台、两名演员、光锥、热量与过热效果。
import { CUES, CONFIG } from './engine.js';

const W = 960;
const H = 600;
const LAMP = { x: 480, y: 70 };
const FLOOR_Y = 470;

function angleToVec(deg) {
  // 0 度垂直向下照向舞台中央，负角向左、正角向右。
  const rad = (deg * Math.PI) / 180;
  return { x: Math.sin(rad), y: Math.cos(rad) };
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.flash = null; // { text, color, until }
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = W * dpr;
    this.canvas.height = H * dpr;
    this.canvas.style.aspectRatio = `${W} / ${H}`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  setFlash(text, color, ms = 900) {
    this.flash = { text, color, until: performance.now() + ms };
  }

  _performerPos(angle) {
    const v = angleToVec(angle);
    const t = (FLOOR_Y - LAMP.y) / v.y;
    return { x: LAMP.x + v.x * t, y: FLOOR_Y };
  }

  draw(state) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    this._drawStage(ctx);
    const cue = CUES[Math.min(state.cueIndex, CUES.length - 1)];
    const positions = cue.angles.map((a) => this._performerPos(a));
    this._drawCone(ctx, state);
    this._drawPerformers(ctx, state, cue, positions);
    this._drawLamp(ctx, state);
    this._drawCueBanner(ctx, state);
    if (this.flash && performance.now() < this.flash.until) {
      this._drawFlash(ctx);
    }
  }

  _drawStage(ctx) {
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#10131f');
    grad.addColorStop(1, '#1d2438');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    // 侧幕
    ctx.fillStyle = '#3a1d2b';
    ctx.fillRect(0, 0, 70, H);
    ctx.fillRect(W - 70, 0, 70, H);
    ctx.fillStyle = '#532a3d';
    for (let y = 0; y < H; y += 46) {
      ctx.fillRect(8, y, 54, 14);
      ctx.fillRect(W - 62, y, 54, 14);
    }
    // 舞台地板
    ctx.fillStyle = '#2c2636';
    ctx.beginPath();
    ctx.moveTo(120, FLOOR_Y);
    ctx.lineTo(W - 120, FLOOR_Y);
    ctx.lineTo(W - 60, H);
    ctx.lineTo(60, H);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#4a4258';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  _drawCone(ctx, state) {
    const half = CONFIG.coneHalfAngle;
    const v1 = angleToVec(state.aim - half);
    const v2 = angleToVec(state.aim + half);
    const len = 620;
    const p1 = { x: LAMP.x + v1.x * len, y: LAMP.y + v1.y * len };
    const p2 = { x: LAMP.x + v2.x * len, y: LAMP.y + v2.y * len };
    const alpha = 0.08 + state.brightness * 0.5;
    const grad = ctx.createRadialGradient(
      LAMP.x, LAMP.y, 10, LAMP.x, LAMP.y, len
    );
    const warm = state.overheated ? '255,90,60' : '255,226,150';
    grad.addColorStop(0, `rgba(${warm},${alpha})`);
    grad.addColorStop(1, `rgba(${warm},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(LAMP.x, LAMP.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.closePath();
    ctx.fill();
    const c = angleToVec(state.aim);
    ctx.strokeStyle = `rgba(255,236,180,${0.15 + state.brightness * 0.35})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(LAMP.x, LAMP.y);
    ctx.lineTo(LAMP.x + c.x * len, LAMP.y + c.y * len);
    ctx.stroke();
  }

  _drawPerformers(ctx, state, cue, positions) {
    positions.forEach((pos, i) => {
      const isTarget = i === cue.target;
      const lit = isTarget && state.coverage.targetCovered;
      const fullHit = i === 0 ? state.coverage.fullA : state.coverage.fullB;
      // 目标标记
      if (isTarget && state.phase === 'running') {
        ctx.strokeStyle = lit ? '#46e08a' : '#ffd45e';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(pos.x, pos.y + 34, 26, 9, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      // 身体
      ctx.fillStyle = lit
        ? '#ffe9a8'
        : fullHit
          ? '#ffb0a0'
          : '#8fa3c8';
      ctx.beginPath();
      ctx.arc(pos.x, pos.y - 26, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(pos.x - 10, pos.y - 15, 20, 34);
      // 编号
      ctx.fillStyle = '#141826';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`演员${i + 1}`, pos.x, pos.y - 21);
      // 完全命中警戒描边
      if (fullHit) {
        ctx.strokeStyle = '#ff5a5a';
        ctx.lineWidth = 2;
        ctx.strokeRect(pos.x - 13, pos.y - 40, 26, 60);
      }
    });
  }

  _drawLamp(ctx, state) {
    // 灯架
    ctx.fillStyle = '#39415c';
    ctx.fillRect(LAMP.x - 8, 0, 16, LAMP.y);
    ctx.fillStyle = '#5a6690';
    ctx.beginPath();
    ctx.arc(LAMP.x, LAMP.y, 16, 0, Math.PI * 2);
    ctx.fill();
    // 热量环
    const heatRatio = state.heat / CONFIG.overheatAt;
    ctx.strokeStyle = state.overheated
      ? '#ff4433'
      : heatRatio > 0.7
        ? '#ff9d3c'
        : '#46b6ff';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(
      LAMP.x,
      LAMP.y,
      24,
      -Math.PI / 2,
      -Math.PI / 2 + heatRatio * Math.PI * 2
    );
    ctx.stroke();
    if (state.overheated) {
      ctx.fillStyle = '#ff6b4a';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      const shake = Math.sin(performance.now() / 40) * 2;
      ctx.fillText('过热!', LAMP.x + shake, LAMP.y - 34);
    }
  }

  _drawCueBanner(ctx, state) {
    if (state.cueIndex >= CUES.length) return;
    const cue = CUES[state.cueIndex];
    ctx.fillStyle = 'rgba(10,14,26,0.72)';
    ctx.fillRect(290, 14, 380, 52);
    ctx.strokeStyle = '#3d4a6e';
    ctx.strokeRect(290, 14, 380, 52);
    ctx.fillStyle = '#dfe7ff';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      `${cue.name}（${state.cueIndex + 1}/${state.cueCount}）`,
      480,
        36
    );
    // 本段保持进度
    const ratio = state.cueProgress / state.cueHoldTime;
    ctx.fillStyle = '#26314e';
    ctx.fillRect(330, 46, 300, 10);
    ctx.fillStyle = state.coverage.targetCovered ? '#46e08a' : '#ffd45e';
    ctx.fillRect(330, 46, 300 * ratio, 10);
  }

  _drawFlash(ctx) {
    ctx.fillStyle = 'rgba(8,10,20,0.45)';
    ctx.fillRect(0, 220, W, 120);
    ctx.fillStyle = this.flash.color;
    ctx.font = 'bold 42px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(this.flash.text, W / 2, 292);
  }
}

export const STAGE = { W, H };
