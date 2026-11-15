import { WORLD_HALF_SIZE } from '../config.mjs';

// Canvas 渲染器：世界坐标（米，y 向下）映射到像素，绘制支点、摆杆、摆体与轨迹。
export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  toPixel(point) {
    const scale = this.canvas.width / (WORLD_HALF_SIZE * 2);
    return {
      x: this.canvas.width / 2 + point.x * scale,
      y: this.canvas.height / 2 + point.y * scale
    };
  }

  draw(frame, trailSamples, mode, forceInfo, trigger) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawBounds();
    this.drawTrail(trailSamples, mode === 'double' ? 1 : 0);

    const pivot = this.toPixel({ x: 0, y: 0 });
    const points = frame.positions.map((p) => this.toPixel(p));

    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(pivot.x, pivot.y);
    for (const p of points) ctx.lineTo(p.x, p.y);
    ctx.stroke();

    this.drawPivot(pivot);
    points.forEach((p, i) => this.drawBob(p, i));

    if (forceInfo) this.drawForceArrows(points, forceInfo);
    if (trigger) this.drawTrigger(trigger);
  }

  drawBounds() {
    const ctx = this.ctx;
    const corner = this.toPixel({ x: -WORLD_HALF_SIZE, y: -WORLD_HALF_SIZE });
    const size = this.canvas.width;
    ctx.strokeStyle = '#f87171';
    ctx.setLineDash([8, 6]);
    ctx.lineWidth = 2;
    ctx.strokeRect(corner.x, corner.y, size, size);
    ctx.setLineDash([]);
  }

  drawTrail(samples, bobIndex = 0) {
    if (samples.length < 2) return;
    const ctx = this.ctx;
    ctx.lineWidth = 1.5;
    for (let i = 1; i < samples.length; i++) {
      const alpha = 0.15 + 0.6 * (i / samples.length);
      ctx.strokeStyle =
        bobIndex === 0 ? `rgba(56, 189, 248, ${alpha})` : `rgba(192, 132, 252, ${alpha})`;
      const a = this.toPixel(samples[i - 1].positions[bobIndex]);
      const b = this.toPixel(samples[i].positions[bobIndex]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  drawPivot(p) {
    const ctx = this.ctx;
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
    ctx.fill();
  }

  drawBob(p, index) {
    const ctx = this.ctx;
    ctx.fillStyle = index === 0 ? '#2563eb' : '#7c3aed';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // 暂停/单步时展示受力方向（角加速度切向箭头）与运动趋势。
  drawForceArrows(points, info) {
    const ctx = this.ctx;
    points.forEach((p, i) => {
      const vec = info[i];
      if (!vec) return;
      const end = this.toPixel(vec.end);
      ctx.strokeStyle = vec.type === 'force' ? '#dc2626' : '#16a34a';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath();
      ctx.arc(end.x, end.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  drawTrigger(trigger) {
    const ctx = this.ctx;
    const p = this.toPixel(trigger.positions[0]);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 18, 0, Math.PI * 2);
    ctx.stroke();
  }
}
