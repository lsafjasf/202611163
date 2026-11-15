/* Canvas 场景渲染：井架、滑轮、卷筒、绳索、货箱、配重、受力/趋势箭头 */
(function (global) {
  'use strict';

  function Renderer(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.W = canvas.width;
    this.H = canvas.height;
    this.marginX = 110;
    this.scaleY = 40;   // 米 -> 像素
    this.groundY = 500;
  }

  // 世界坐标（米，滑轮高度 pulleyY 向下）-> 画布像素
  Renderer.prototype.px = function (hoistIndex) {
    return this.marginX + hoistIndex * (this.W - 2 * this.marginX);
  };
  Renderer.prototype.py = function (worldDownFromPulley, pulleyWorldY) {
    const pulleyPx = this.groundY - pulleyWorldY * this.scaleY;
    return pulleyPx + worldDownFromPulley * this.scaleY;
  };

  Renderer.prototype.draw = function (snap, hoists, opts) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);
    this._drawFrame(hoists[0] ? global.WinchPhysics.MECH.pulleyY : 12);
    for (let i = 0; i < snap.hoists.length; i++) {
      this._drawHoist(i, snap.hoists[i], hoists[i], opts);
    }
    this._drawGround();
  };

  Renderer.prototype._drawFrame = function (pulleyY) {
    const ctx = this.ctx;
    // 地面
    ctx.strokeStyle = '#3a4a60';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(40, this.groundY);
    ctx.lineTo(this.W - 40, this.groundY);
    ctx.stroke();
    // 两根立柱与顶梁
    ctx.strokeStyle = '#46586f';
    ctx.lineWidth = 6;
    for (const i of [0, 1]) {
      const x = this.px(i);
      const top = this.py(0, pulleyY);
      ctx.beginPath();
      ctx.moveTo(x, this.groundY);
      ctx.lineTo(x, top - 30);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(this.px(0) - 40, this.py(0, pulleyY) - 30);
    ctx.lineTo(this.px(1) + 40, this.py(0, pulleyY) - 30);
    ctx.stroke();
  };

  Renderer.prototype._drawGround = function () {
    const ctx = this.ctx;
    ctx.strokeStyle = '#2c3a4d';
    ctx.lineWidth = 1;
    for (let x = 40; x < this.W - 40; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x, this.groundY);
      ctx.lineTo(x - 10, this.groundY + 12);
      ctx.stroke();
    }
  };

  Renderer.prototype._drawHoist = function (idx, st, h, opts) {
    const ctx = this.ctx;
    const P = global.WinchPhysics;
    const pulleyY = P.MECH.pulleyY;
    const x0 = this.px(idx);
    const pulleyPx = this.py(0, pulleyY);

    // 目标高度线
    const targetPy = this.py(pulleyY - st.targetH, pulleyY);
    ctx.strokeStyle = 'rgba(90,220,140,0.7)';
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(x0 - 70, targetPy);
    ctx.lineTo(x0 + 70, targetPy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#7ee0a0';
    ctx.font = '11px sans-serif';
    ctx.fillText('目标 ' + st.targetH.toFixed(1) + 'm', x0 - 66, targetPy - 4);

    // 墙（碰撞边界）
    const wallDx = P.LIMITS.wallX * this.scaleY;
    ctx.strokeStyle = 'rgba(255,120,120,0.35)';
    ctx.lineWidth = 2;
    for (const sgn of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x0 + sgn * wallDx, pulleyPx);
      ctx.lineTo(x0 + sgn * wallDx, this.groundY);
      ctx.stroke();
    }

    // 滑轮
    ctx.fillStyle = '#8fa6c0';
    ctx.beginPath();
    ctx.arc(x0, pulleyPx, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2a3648';
    ctx.beginPath();
    ctx.arc(x0, pulleyPx, 4, 0, Math.PI * 2);
    ctx.fill();

    // 卷筒（小矩形示意，随 omega 旋转标记）
    const drumX = x0 + 46, drumY = pulleyPx - 18;
    ctx.save();
    ctx.translate(drumX, drumY);
    ctx.rotate(h.omega * 0.4);
    ctx.fillStyle = '#6b7f99';
    ctx.fillRect(-9, -9, 18, 18);
    ctx.strokeStyle = '#cfe0f5';
    ctx.beginPath(); ctx.moveTo(-9, 0); ctx.lineTo(9, 0); ctx.stroke();
    ctx.restore();

    // 货箱几何位置
    const boxX = x0 + st.x * this.scaleY;
    const boxY = this.py(pulleyY - st.y, pulleyY);
    const slack = st.slackL;
    this._drawRope(x0, pulleyPx, boxX, boxY, slack, st.tripped === 'ROPE_BREAK');

    // 配重（滑轮另一侧，简化为左侧垂挂）
    const cwLen = h.lCw;
    const cwY = this.py(cwLen, pulleyY);
    this._drawRope(x0 - 30, pulleyPx, x0 - 30, cwY, st.slackC, false);
    ctx.fillStyle = '#5a6b82';
    ctx.fillRect(x0 - 44, cwY, 28, 22);
    ctx.fillStyle = '#c3d0e0';
    ctx.font = '10px sans-serif';
    ctx.fillText(h.cw + 'kg', x0 - 42, cwY + 15);

    // 货箱
    const bw = 46, bh = 34;
    ctx.save();
    ctx.translate(boxX, boxY);
    ctx.rotate(st.theta * 0.6);
    ctx.fillStyle = st.tripped ? '#8a3535' : (idx === 0 ? '#d98a3d' : '#4d96d1');
    ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
    ctx.strokeStyle = '#1a2330';
    ctx.strokeRect(-bw / 2, -bh / 2, bw, bh);
    ctx.restore();
    ctx.fillStyle = '#d8e0ea';
    ctx.fillText(h.load + 'kg', boxX - 16, boxY + 4);

    // 受力方向（张力，红）与速度趋势（蓝）
    if (opts.showForce) {
      this._arrow(boxX, boxY - bh / 2, 0, -st.tensionL / 2200, '#ff6b6b',
        'T ' + Math.round(st.tensionL) + 'N');
      this._arrow(boxX, boxY + bh / 2, st.vx * 14, st.vy * 14, '#5aa9ff',
        'v ' + Math.hypot(st.vx, st.vy).toFixed(2) + 'm/s');
    }

    // 名称标签
    ctx.fillStyle = '#9fb0c4';
    ctx.font = '12px sans-serif';
    ctx.fillText('卷扬 ' + st.name, x0 - 20, pulleyPx - 22);
  };

  Renderer.prototype._drawRope = function (x1, y1, x2, y2, slack, broken) {
    const ctx = this.ctx;
    ctx.strokeStyle = broken ? '#ff4d4d' : '#c8d4e3';
    ctx.lineWidth = 2;
    if (broken) {
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo((x1 + x2) / 2, (y1 + y2) / 2); ctx.stroke();
      ctx.setLineDash([]);
      return;
    }
    if (slack > 0.02) {
      // 松弛：画成下垂波浪
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      const midX = (x1 + x2) / 2, midY = (y1 + y2) / 2 + slack * this.scaleY;
      ctx.quadraticCurveTo(midX, midY, x2, y2);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  };

  Renderer.prototype._arrow = function (x, y, dx, dy, color, label) {
    const ctx = this.ctx;
    const mag = Math.hypot(dx, dy);
    if (mag < 1) return;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + dx, y + dy);
    ctx.stroke();
    const ang = Math.atan2(dy, dx);
    ctx.beginPath();
    ctx.moveTo(x + dx, y + dy);
    ctx.lineTo(x + dx - 7 * Math.cos(ang - 0.4), y + dy - 7 * Math.sin(ang - 0.4));
    ctx.lineTo(x + dx - 7 * Math.cos(ang + 0.4), y + dy - 7 * Math.sin(ang + 0.4));
    ctx.closePath();
    ctx.fill();
    ctx.font = '10px sans-serif';
    ctx.fillText(label, x + dx + 4, y + dy);
  };

  global.Renderer = Renderer;
})(typeof globalThis !== 'undefined' ? globalThis : this);
