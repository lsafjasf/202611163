// Web Audio：节拍 + 警报 + 成功/失败音效。所有方法在不支持时静默降级。

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.beatTimer = null;
    this.beatStep = 0;
    this.bpm = 104;
    this.enabled = true;
  }

  // 必须在用户手势中调用一次。
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
  }

  _tone(freq, duration, type = 'sine', gain = 0.4, when = 0) {
    if (!this.ctx || !this.enabled) return;
    const t0 = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  _noise(duration = 0.5, gain = 0.25) {
    if (!this.ctx || !this.enabled) return;
    const len = Math.floor(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1800;
    src.connect(filter).connect(g).connect(this.master);
    src.start();
  }

  startBeat() {
    this.ensure();
    if (!this.ctx || this.beatTimer) return;
    const interval = 60000 / this.bpm;
    this.beatStep = 0;
    this.beatTimer = setInterval(() => {
      const strong = this.beatStep % 4 === 0;
      this._tone(strong ? 880 : 660, 0.06, 'triangle', strong ? 0.22 : 0.12);
      this.beatStep += 1;
    }, interval);
  }

  stopBeat() {
    if (this.beatTimer) {
      clearInterval(this.beatTimer);
      this.beatTimer = null;
    }
  }

  warn() {
    this.ensure();
    this._tone(740, 0.16, 'square', 0.28);
    this._tone(740, 0.16, 'square', 0.28, 0.22);
    this._noise(0.3, 0.12);
  }

  overheat() {
    this.ensure();
    this._tone(180, 0.5, 'sawtooth', 0.3);
    this._noise(0.5, 0.2);
  }

  cue() {
    this.ensure();
    this._tone(1046, 0.12, 'sine', 0.3);
    this._tone(1568, 0.18, 'sine', 0.24, 0.1);
  }

  miss() {
    this.ensure();
    this._tone(320, 0.14, 'triangle', 0.2);
  }

  success() {
    this.stopBeat();
    this.ensure();
    [523, 659, 784, 1046].forEach((f, i) =>
      this._tone(f, 0.3, 'sine', 0.32, i * 0.16)
    );
  }

  fail() {
    this.stopBeat();
    this.ensure();
    [392, 330, 262, 196].forEach((f, i) =>
      this._tone(f, 0.32, 'sawtooth', 0.26, i * 0.18)
    );
  }

  pause() {
    this.stopBeat();
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  resume() {
    this.ensure();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    this.startBeat();
  }

  // 重开时全部复位：节拍、振荡器调度与上下文时间线重新开始。
  reset() {
    this.stopBeat();
    this.beatStep = 0;
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
      this.master = null;
    }
  }
}
