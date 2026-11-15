/* Canvas 渲染：俯视河面，相机跟随筏体。
   同模块提供回放帧渲染，保证“游戏画面”和“回放画面”一致。 */
(function (root, factory) {
  const deps = [(typeof RG_BROWSER !== 'undefined' && RG_BROWSER) ? root.RG : require('./config')];
  const mod = factory(deps[0].CONFIG);
  if (typeof RG_BROWSER !== 'undefined' && RG_BROWSER) { root.RG = root.RG || {}; Object.assign(root.RG, mod); }
  else if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.RG = Object.assign(root.RG || {}, mod);
})(typeof self !== 'undefined' ? self : this, function (CONFIG) {
  'use strict';

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.cssWidth = canvas.clientWidth || canvas.width || 900;
      this.cssHeight = canvas.clientHeight || canvas.height || 600;
      const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
      canvas.width = Math.round(this.cssWidth * dpr);
      canvas.height = Math.round(this.cssHeight * dpr);
      this.g = canvas.getContext('2d');
      this.g.scale(dpr, dpr);
      this.width = this.cssWidth;
      this.height = this.cssHeight;
      this.particles = [];
      this.flash = null;          // 撞击/冲突时的全屏闪烁
      this.debug = false;
      this.time = 0;
      for (let i = 0; i < 70; i++) {
        this.particles.push({
          x: Math.random() * CONFIG.RIVER_WIDTH,
          y: Math.random() * CONFIG.RIVER_LENGTH,
          speed: 0.7 + Math.random() * 0.6
        });
      }
    }

    setDebug(on) { this.debug = !!on; }

    triggerFlash(text, color) {
      this.flash = { text, color, life: 0.9 };
    }

    draw(world, raft, sync, trail, dt) {
      this.time += dt;
      const g = this.g;
      const cw = this.width;
      const ch = this.height;
      const camY = Math.max(ch / 2, Math.min(CONFIG.RIVER_LENGTH - ch / 2, raft.y));
      const toScreenX = (x) => cw / 2 + (x - CONFIG.RIVER_WIDTH / 2) * 2.1;
      const toScreenY = (y) => ch / 2 + (y - camY) * 1.55;
      const scale = 2.1;

      g.fillStyle = '#0e2a38';
      g.fillRect(0, 0, cw, ch);

      // 河岸
      g.fillStyle = '#3d5a3a';
      g.fillRect(0, 0, toScreenX(CONFIG.BANK), ch);
      g.fillRect(toScreenX(CONFIG.RIVER_WIDTH - CONFIG.BANK), 0, cw, ch);

      // 出发岸 / 对岸标记
      this._drawBand(toScreenY(world.startY), '#d9b382', '出发岸');
      this._drawBand(toScreenY(world.goalY), '#8fd18a', '对岸 · 送达 3 名乘客');

      // 水流粒子
      g.fillStyle = 'rgba(180,220,235,0.5)';
      for (const p of this.particles) {
        p.y += CONFIG.CURRENT_DOWNSTREAM * p.speed * dt;
        if (p.y > CONFIG.RIVER_LENGTH) { p.y = 0; p.x = Math.random() * CONFIG.RIVER_WIDTH; }
        const sx = toScreenX(p.x);
        const sy = toScreenY(p.y);
        if (sy < -10 || sy > ch + 10) continue;
        g.fillRect(sx, sy, 2, 7);
      }

      // 礁石
      for (const rock of world.rocks) {
        const sx = toScreenX(rock.x);
        const sy = toScreenY(rock.y);
        if (sy < -30 || sy > ch + 30) continue;
        g.beginPath();
        g.arc(sx, sy, rock.r * scale * 0.9, 0, Math.PI * 2);
        g.fillStyle = '#5b5f66';
        g.fill();
        g.strokeStyle = '#2e3136';
        g.lineWidth = 2;
        g.stroke();
      }

      // 桨迹
      for (const tr of trail) {
        const alpha = Math.max(0, tr.life / 1.2) * 0.55;
        g.beginPath();
        g.arc(toScreenX(tr.x), toScreenY(tr.y), 5 * scale * 0.4, 0, Math.PI * 2);
        g.fillStyle = tr.side === 'left'
          ? 'rgba(120,190,255,' + alpha + ')'
          : 'rgba(255,180,120,' + alpha + ')';
        g.fill();
      }

      this._drawRaft(toScreenX(raft.x), toScreenY(raft.y), raft, sync);

      if (this.debug) this._drawDebug(world, raft, toScreenX, toScreenY, scale);
      if (this.flash) {
        this.flash.life -= dt;
        if (this.flash.life <= 0) this.flash = null;
        else {
          g.fillStyle = this.flash.color.replace('ALPHA', (this.flash.life * 0.4).toFixed(3));
          g.fillRect(0, 0, cw, ch);
          g.font = 'bold 30px sans-serif';
          g.fillStyle = '#fff';
          g.textAlign = 'center';
          g.fillText(this.flash.text, cw / 2, 90);
        }
      }
    }

    _drawBand(sy, color, label) {
      const g = this.g;
      g.fillStyle = color;
      g.globalAlpha = 0.85;
      g.fillRect(0, sy - 8, this.width, 16);
      g.globalAlpha = 1;
      g.font = '14px sans-serif';
      g.fillStyle = '#10242f';
      g.textAlign = 'left';
      g.fillText(label, 12, sy - 12);
    }

    _drawRaft(sx, sy, raft, sync) {
      const g = this.g;
      g.save();
      g.translate(sx, sy);
      g.rotate(raft.heading);
      const w = CONFIG.RAFT_HALF_WIDTH * 2.1;
      const h = CONFIG.RAFT_HALF_LENGTH * 2.1;
      g.fillStyle = raft.invuln > 0 ? '#ff9c6b' : '#c98843';
      g.strokeStyle = '#5d3a1c';
      g.lineWidth = 3;
      this._roundRect(-w / 2, -h / 2, w, h, 10);
      g.fill();
      g.stroke();
      // 乘客：三个圆点，重量让筏体中心前后分布
      g.fillStyle = '#26435c';
      [-1, 0, 1].forEach((i) => {
        g.beginPath();
        g.arc(i * 9, -2, 4.5, 0, Math.PI * 2);
        g.fill();
      });
      // 左右桨
      g.strokeStyle = '#e8e2d0';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(-w / 2, -4); g.lineTo(-w / 2 - 14, 10);
      g.moveTo(w / 2, -4); g.lineTo(w / 2 + 14, 10);
      g.stroke();
      g.restore();

      // 同步率光环
      g.beginPath();
      g.arc(sx, sy, 30, 0, Math.PI * 2 * sync.level);
      g.strokeStyle = sync.level > CONFIG.SYNC_GOOD ? '#7be382'
        : sync.level > CONFIG.SYNC_BAD ? '#e8d35c' : '#ef6b5f';
      g.lineWidth = 4;
      g.stroke();
    }

    _drawDebug(world, raft, tx, ty, scale) {
      const g = this.g;
      g.font = '12px monospace';
      g.fillStyle = '#9be38f';
      g.textAlign = 'left';
      const lines = [
        'x=' + raft.x.toFixed(1) + ' y=' + raft.y.toFixed(1),
        'vx=' + raft.vx.toFixed(1) + ' vy=' + raft.vy.toFixed(1),
        'heading=' + raft.heading.toFixed(2) + ' omega=' + raft.omega.toFixed(2),
        'hull=' + raft.hull + ' mass=' + (CONFIG.RAFT_BASE_MASS
          + raft.passengers * CONFIG.PASSENGER_TOTAL_MASS / 3).toFixed(0)
      ];
      lines.forEach((line, i) => g.fillText(line, 10, 20 + i * 16));
    }

    _roundRect(x, y, w, h, r) {
      const g = this.g;
      g.beginPath();
      g.moveTo(x + r, y);
      g.arcTo(x + w, y, x + w, y + h, r);
      g.arcTo(x + w, y + h, x, y + h, r);
      g.arcTo(x, y + h, x, y, r);
      g.arcTo(x, y, x + w, y, r);
      g.closePath();
    }
  }

  return { Renderer };
});
