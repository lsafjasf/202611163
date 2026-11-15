import { PHYS, COIL_Y, RING_Y } from './constants.js';
import { celsius } from './util.js';

const TOP_Y = 1.12;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = canvas.width;
    this.h = canvas.height;
    this.marginX = 46;
    this.marginTop = 24;
    this.marginBottom = 40;
  }

  py(y) {
    const usable = this.h - this.marginTop - this.marginBottom;
    return this.marginTop + usable * (1 - y / TOP_Y);
  }

  px(x) {
    return this.w / 2 + x * ((this.w / 2 - this.marginX) / PHYS.MAX_R);
  }

  draw(state, replayState) {
    const s = replayState || state;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    this.drawGrid();
    this.drawField(s);
    this.drawTubeAndBase();
    this.drawRings(s);
    this.drawCoils(s);
    this.drawBall(s);
    this.drawForceArrows(s);
    this.drawTrend(s);
  }

  drawTrend(s) {
    const ctx = this.ctx;
    const x0 = this.w - 132;
    const y0 = 12;
    const w = 120;
    const h = 46;
    ctx.fillStyle = 'rgba(13,20,32,0.82)';
    ctx.fillRect(x0, y0, w, h);
    ctx.strokeStyle = '#2b3a52';
    ctx.strokeRect(x0, y0, w, h);
    ctx.fillStyle = '#8aa0bd';
    ctx.font = '10px sans-serif';
    ctx.fillText('高度 / 速度趋势', x0 + 6, y0 + 12);
    const hist = s.trend || [];
    if (hist.length < 2) return;
    const n = Math.min(hist.length, 60);
    const data = hist.slice(-n);
    const ys = data.map((d) => d.y);
    const vs = data.map((d) => Math.abs(d.vy));
    const yMax = Math.max(0.01, ...ys) * 1.1;
    const vMax = Math.max(0.01, ...vs) * 1.1;
    const plot = (arr, max, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      arr.forEach((v, i) => {
        const px = x0 + 6 + (i / (n - 1)) * (w - 12);
        const py = y0 + h - 6 - (v / max) * (h - 16);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
    };
    plot(ys, yMax, '#4fc3f7');
    plot(vs, vMax, '#ffb74d');
  }

  drawGrid() {
    const ctx = this.ctx;
    ctx.strokeStyle = '#15202f';
    ctx.lineWidth = 1;
    for (let y = 0; y <= TOP_Y; y += 0.1) {
      ctx.beginPath();
      ctx.moveTo(this.marginX, this.py(y));
      ctx.lineTo(this.w - this.marginX, this.py(y));
      ctx.stroke();
    }
    ctx.fillStyle = '#3f5470';
    ctx.font = '10px monospace';
    for (let y = 0; y <= TOP_Y; y += 0.2) {
      ctx.fillText(`${y.toFixed(1)}m`, 6, this.py(y) + 3);
    }
  }

  drawField(state) {
    const ctx = this.ctx;
    // Field strength shading: sum of i^2 gaussian lobes around each coil.
    for (let pyPx = this.marginTop; pyPx < this.h - this.marginBottom; pyPx += 6) {
      const y = TOP_Y * (1 - (pyPx - this.marginTop) /
        (this.h - this.marginTop - this.marginBottom));
      let b = 0;
      for (let k = 0; k < 4; k++) {
        const z = (y - COIL_Y[k]) / PHYS.SIGMA;
        b += state.current[k] ** 2 * Math.exp(-z * z);
      }
      const alpha = Math.min(0.28, b * 0.05);
      if (alpha > 0.01) {
        ctx.fillStyle = `rgba(79,195,247,${alpha})`;
        ctx.fillRect(this.marginX, pyPx, this.w - 2 * this.marginX, 6);
      }
    }
    // Symmetric field loops.
    ctx.strokeStyle = 'rgba(124,156,255,0.28)';
    ctx.lineWidth = 1;
    for (let k = 0; k < 4; k++) {
      const i = state.current[k];
      if (i < 0.05) continue;
      const cy = this.py(COIL_Y[k]);
      const rx = 30 + i * 22;
      const ry = 26 + i * 10;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(this.w / 2 + side * 26, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  drawTubeAndBase() {
    const ctx = this.ctx;
    const x0 = this.px(-PHYS.MAX_R);
    const x1 = this.px(PHYS.MAX_R);
    const yBase = this.py(PHYS.BALL_RADIUS);
    ctx.strokeStyle = '#33455e';
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(x0, this.marginTop);
    ctx.lineTo(x0, yBase);
    ctx.moveTo(x1, this.marginTop);
    ctx.lineTo(x1, yBase);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#26364d';
    ctx.fillRect(x0 - 10, yBase, x1 - x0 + 20, 14);
    ctx.strokeStyle = '#46607f';
    ctx.strokeRect(x0 - 10, yBase, x1 - x0 + 20, 14);
    // Seat cup.
    ctx.fillStyle = '#33506e';
    ctx.beginPath();
    ctx.arc(this.w / 2, yBase, 14, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#7f95b0';
    ctx.font = '11px sans-serif';
    ctx.fillText('底座 / 落座杯', this.w / 2 - 34, yBase + 30);
  }

  drawRings(state) {
    const ctx = this.ctx;
    RING_Y.forEach((ry, k) => {
      const y = this.py(ry);
      const cx = this.w / 2;
      const inner = PHYS.RING_CLEAR * ((this.w / 2 - this.marginX) / PHYS.MAX_R);
      const passed = state.ringsPassed[k];
      const hit = state.ringsHit[k];
      ctx.lineWidth = 4;
      ctx.strokeStyle = hit ? '#ff6b6b' : passed ? '#57d38a' : '#d9a441';
      ctx.beginPath();
      ctx.ellipse(cx, y, inner, inner * 0.32, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.font = '11px sans-serif';
      ctx.fillText(`环 ${k + 1}`, cx + inner + 8, y + 4);
    });
  }

  drawCoils(state) {
    const ctx = this.ctx;
    COIL_Y.forEach((cy, k) => {
      const y = this.py(cy);
      const halfW = (this.w / 2 - this.marginX) + 4;
      const t = celsius(state.temp[k]);
      const hot = t > 60;
      ctx.save();
      ctx.translate(this.w / 2, y);
      ctx.strokeStyle = hot ? '#ff8a5c' : '#7c9cff';
      ctx.lineWidth = 3;
      for (let w = 0; w < 5; w++) {
        ctx.beginPath();
        ctx.ellipse(0, (w - 2) * 3.2, halfW, 7, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
      ctx.fillStyle = '#9db4d3';
      ctx.font = '11px sans-serif';
      ctx.fillText(`线圈 ${k + 1}  I=${state.current[k].toFixed(2)}A  ${t.toFixed(1)}°C`,
        this.marginX, y - 12);
    });
  }

  drawBall(state) {
    const ctx = this.ctx;
    const x = this.px(state.x);
    const y = this.py(state.y);
    const r = PHYS.BALL_RADIUS * ((this.w / 2 - this.marginX) / PHYS.MAX_R);
    const grad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
    grad.addColorStop(0, '#ffe9b0');
    grad.addColorStop(0.5, '#e0a83d');
    grad.addColorStop(1, '#8a5a17');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#5c3d0f';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  drawForceArrows(state) {
    const ctx = this.ctx;
    const bx = this.px(state.x);
    const by = this.py(state.y);
    const scale = 140;
    this.arrow(bx, by, bx + state.forceX * scale * 0.4, by, '#7ff1a4', 'Fx');
    this.arrow(bx, by, bx, by - state.forceZ * scale, '#ffd166', 'Fz');
    // Gravity reference arrow.
    this.arrow(bx + 26, by, bx + 26, by + state.mass * PHYS.G * scale, '#ff8080', 'G');
  }

  arrow(x0, y0, x1, y1, color, label) {
    const ctx = this.ctx;
    const dx = x1 - x0;
    const dy = y1 - y0;
    if (Math.hypot(dx, dy) < 4) return;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    const ang = Math.atan2(dy, dx);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - 8 * Math.cos(ang - 0.4), y1 - 8 * Math.sin(ang - 0.4));
    ctx.lineTo(x1 - 8 * Math.cos(ang + 0.4), y1 - 8 * Math.sin(ang + 0.4));
    ctx.closePath();
    ctx.fill();
    ctx.font = '10px sans-serif';
    ctx.fillText(label, x1 + 3, y1 - 3);
  }
}
