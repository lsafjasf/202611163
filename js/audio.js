/* 张力音效：两台卷扬各一个振荡器，频率与音量随绳张力单调变化 */
(function (global) {
  'use strict';
  function TensionAudio() {
    this.ctx = null;
    this.enabled = false;
    this.osc = [null, null];
    this.gain = [null, null];
  }

  TensionAudio.prototype.ensure = function () {
    if (this.ctx) return;
    const AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    for (let i = 0; i < 2; i++) {
      this.osc[i] = this.ctx.createOscillator();
      this.gain[i] = this.ctx.createGain();
      this.osc[i].type = 'sawtooth';
      this.osc[i].frequency.value = 60;
      this.gain[i].gain.value = 0;
      this.osc[i].connect(this.gain[i]).connect(this.ctx.destination);
      this.osc[i].start();
    }
  };

  TensionAudio.prototype.setEnabled = function (on) {
    this.enabled = on;
    if (on) {
      this.ensure();
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    } else if (this.ctx) {
      for (let i = 0; i < 2; i++) this.gain[i].gain.value = 0;
    }
  };

  // tensions: [tA, tB]，0..tensionMax
  TensionAudio.prototype.update = function (tensions, limit) {
    if (!this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const ratio = Math.max(0, Math.min(1, tensions[i] / limit));
      const freq = 55 + ratio * 220;       // 55Hz -> 275Hz
      const vol = 0.015 + ratio * 0.08;
      this.osc[i].frequency.setTargetAtTime(freq, now, 0.05);
      this.gain[i].gain.setTargetAtTime(vol, now, 0.08);
    }
  };

  global.TensionAudio = TensionAudio;
})(typeof globalThis !== 'undefined' ? globalThis : this);
