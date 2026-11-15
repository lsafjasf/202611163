/* Web Audio：全部声音程序化合成，无外部资源。
   - 划水声：短促滤波噪声，音高随该侧桨频上升
   - 水流：循环噪声 + 低通，截止频率随流速变化
   - 碰撞：低频冲击；胜利/失败：和弦序列；倒计时：滴答 */
(function (root, factory) {
  const mod = factory();
  if (typeof RG_BROWSER !== 'undefined' && RG_BROWSER) { root.RG = root.RG || {}; Object.assign(root.RG, mod); }
  else if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.RG = Object.assign(root.RG || {}, mod);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.muted = false;
      this.currentGain = null;
      this.currentFilter = null;
      this.master = null;
    }

    /* 必须在用户手势后调用，浏览器才允许 AudioContext 发声。 */
    ensure() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      this.master.connect(this.ctx.destination);
      this._startCurrentBed();
    }

    _noiseBuffer(seconds) {
      const len = Math.floor(this.ctx.sampleRate * seconds);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      return buf;
    }

    _startCurrentBed() {
      const src = this.ctx.createBufferSource();
      src.buffer = this._noiseBuffer(2);
      src.loop = true;
      this.currentFilter = this.ctx.createBiquadFilter();
      this.currentFilter.type = 'lowpass';
      this.currentFilter.frequency.value = 320;
      this.currentGain = this.ctx.createGain();
      this.currentGain.gain.value = 0.05;
      src.connect(this.currentFilter).connect(this.currentGain).connect(this.master);
      src.start();
    }

    /* flow: 0..1 归一化流速，用于改变水流声的亮度和响度。 */
    updateCurrent(flow) {
      if (!this.ctx || this.muted) return;
      const f = 280 + flow * 900;
      this.currentFilter.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.2);
      this.currentGain.gain.setTargetAtTime(0.04 + flow * 0.09, this.ctx.currentTime, 0.2);
    }

    stroke(side, rate) {
      if (!this.ctx || this.muted) return;
      const t = this.ctx.currentTime;
      const src = this.ctx.createBufferSource();
      src.buffer = this._noiseBuffer(0.18);
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = (side === 'left' ? 520 : 660) + rate * 140;
      bp.Q.value = 1.4;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.22, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      src.connect(bp).connect(g).connect(this.master);
      src.start(t);
      src.stop(t + 0.18);
    }

    collision(strength) {
      if (!this.ctx || this.muted) return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(160 + strength * 40, t);
      osc.frequency.exponentialRampToValueAtTime(45, t + 0.35);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      osc.connect(g).connect(this.master);
      osc.start(t);
      osc.stop(t + 0.42);
    }

    tick() {
      if (!this.ctx || this.muted) return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 880;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      osc.connect(g).connect(this.master);
      osc.start(t);
      osc.stop(t + 0.09);
    }

    fanfare(win) {
      if (!this.ctx || this.muted) return;
      const notes = win ? [523, 659, 784, 1047] : [392, 330, 262, 196];
      notes.forEach((freq, i) => {
        const t = this.ctx.currentTime + i * 0.16;
        const osc = this.ctx.createOscillator();
        osc.type = win ? 'triangle' : 'sawtooth';
        osc.frequency.value = freq;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.25, t + 0.03);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
        osc.connect(g).connect(this.master);
        osc.start(t);
        osc.stop(t + 0.35);
      });
    }

    toggleMute() {
      this.muted = !this.muted;
      if (this.master) this.master.gain.value = this.muted ? 0 : 0.9;
      return this.muted;
    }
  }

  return { AudioEngine };
});
