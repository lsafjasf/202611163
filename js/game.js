/* 游戏主控：固定步长物理 + 渲染插值，串联输入、音频、HUD、回放。 */
(function (root, factory) {
  const mod = factory();
  if (typeof RG_BROWSER !== 'undefined' && RG_BROWSER) { root.RG = root.RG || {}; Object.assign(root.RG, mod); }
  else if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.RG = Object.assign(root.RG || {}, mod);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  class Game {
    constructor(deps) {
      this.config = deps.CONFIG;
      this.physics = deps.Physics;
      this.renderer = deps.renderer;
      this.input = deps.input;
      this.audio = deps.audio;
      this.ui = deps.ui;
      this.ReplayStore = deps.ReplayStore;
      this.Recorder = deps.Recorder;
      this.accumulator = 0;
      this.lastTs = 0;
      this.paused = true;       // 首屏遮罩期间暂停，点击开始后恢复
      this.debugMode = false;
      this.swapLog = [];
      this.seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0;
      this._resetRun();
    }

    _resetRun() {
      this.ctx = this.physics.createRunContext(this.seed);
      this.recorder = new this.Recorder({
        seed: this.seed,
        mode: this.debugMode ? 'debug' : 'coop',
        initialSides: { p1: this.input.p1Side, p2: this.input.otherSide(this.input.p1Side) },
        swapLog: this.swapLog
      });
      this.accumulator = 0;
      this._lastTickSecond = Math.ceil(this.config.TIME_LIMIT);
      this._ended = false;
      this.audio.ensure && this.audio.ensure();
    }

    restart() {
      this.input.clear();
      this.seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0;
      this.swapLog = [];
      this.paused = false;
      this._resetRun();
      this.ui.setOverlay(null);
      this.ui.flash('已重开：仪表/资源/计时/音效全部复位', '#3b82f6');
    }

    swapSides() {
      const sides = this.input.swapSides();
      this.swapLog.push({ t: this.ctx.time, from: sides.p2, to: sides.p1 });
      this.ui.flash('控制侧已交换：玩家1→' + (sides.p1 === 'left' ? '左桨' : '右桨'), '#8b5cf6');
      this.ui.updateSideTags(sides);
    }

    togglePause() {
      if (this.ctx.status !== 'running') return;
      this.paused = !this.paused;
      this.ui.setOverlay(this.paused ? {
        title: '已暂停',
        body: '按 Space 继续，按 R 重新开始。',
        actions: [{ label: '继续', fn: () => this.togglePause() },
          { label: '重开', fn: () => this.restart() }]
      } : null);
    }

    toggleDebug() {
      this.debugMode = !this.debugMode;
      this.input.setDebugMode(this.debugMode);
      this.renderer.setDebug(this.debugMode);
      this.ui.flash(this.debugMode ? '单人调试模式：B 双桨同划，Q/E 单侧划' : '已退出调试模式',
        '#0ea5e9');
    }

    frame(ts) {
      const dt = Math.min(0.05, (ts - this.lastTs) / 1000 || 0);
      this.lastTs = ts;
      if (!this.paused) {
        this.accumulator += dt;
        let guard = 0;
        while (this.accumulator >= this.config.FIXED_DT && guard < 8) {
          this._stepFixed(this.config.FIXED_DT);
          this.accumulator -= this.config.FIXED_DT;
          guard++;
        }
      } else {
        this.audio.updateCurrent(0);
      }
      this.renderer.draw(this.ctx.world, this.ctx.raft, this.ctx.sync,
        this.ctx.trail, this.paused ? 0 : dt);
      this.ui.updateHud(this.ctx, this.input, this.paused);
      requestAnimationFrame((t) => this.frame(t));
    }

    _stepFixed(dt) {
      const t = this.ctx.time;
      const intents = this.input.drainQueue();
      for (const intent of intents) {
        if (this.ctx.status !== 'running') break;
        const ev = this.physics.applyStroke(this.ctx, intent.side, intent.reverse, t);
        if (!ev) continue;
        this.recorder.recordEvent(ev);
        this.audio.stroke(ev.side, this.ctx.raft.strokeRate[ev.side]);
        if (ev.conflict) {
          this.renderer.triggerFlash(
            ev.conflict === 'one-sided' ? '单侧发力：另一侧未配合！' : '节奏冲撞！',
            'rgba(239,107,95,ALPHA)');
        }
      }
      const before = this.ctx.events.length;
      this.physics.step(this.ctx, dt);
      for (let i = before; i < this.ctx.events.length; i++) {
        const ev = this.ctx.events[i];
        this.recorder.recordEvent(ev);
        if (ev.type === 'collision') {
          this.audio.collision(1);
          this.renderer.triggerFlash('撞击！船体耐久 -1', 'rgba(239,68,68,ALPHA)');
        }
        if (ev.type === 'end') this._finish(ev);
      }
      // 倒计时滴答
      const remain = Math.ceil(this.config.TIME_LIMIT - this.ctx.time);
      if (remain < this._lastTickSecond && remain <= 5 && remain > 0) {
        this.audio.tick();
      }
      this._lastTickSecond = remain;
      const flow = Math.min(1, Math.hypot(this.ctx.raft.vx, this.ctx.raft.vy) / 120);
      this.audio.updateCurrent(flow);
      this.recorder.recordFrame(this.ctx);
    }

    _finish(endEvent) {
      if (this._ended) return;
      this._ended = true;
      this.paused = true;
      this.input.drainQueue();
      const record = this.recorder.finalize(this.ctx);
      this.ReplayStore.save(record);
      this.audio.fanfare(endEvent.result === 'won');
      const won = endEvent.result === 'won';
      this.ui.setOverlay({
        title: won ? '渡河成功！三名乘客已送达' : '渡河失败：' + this._loseText(endEvent.reason),
        body: '用时 ' + this.ctx.time.toFixed(1) + ' 秒 · 冲突 '
          + this.ctx.sync.conflicts + ' 次 · 撞击 '
          + this.ctx.events.filter((e) => e.type === 'collision').length + ' 次',
        actions: [{ label: '再开一局', fn: () => this.restart() },
          { label: '查看回放', fn: () => this.ui.openReplay(record) }]
      });
    }

    _loseText(reason) {
      return reason === 'hull' ? '船体耐久耗尽'
        : reason === 'timeout' ? '倒计时结束'
          : reason === 'grounded' ? '筏子搁浅无法脱浅' : reason;
    }
  }

  return { Game };
});
