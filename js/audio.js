// Height-driven Web Audio. The context is created lazily on the first user
// gesture to satisfy browser autoplay policies.
export class HeightAudio {
  constructor() {
    this.ctx = null;
    this.osc = null;
    this.gain = null;
    this.enabled = false;
  }

  async enable() {
    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctor();
      this.osc = this.ctx.createOscillator();
      this.gain = this.ctx.createGain();
      this.osc.type = 'sine';
      this.gain.gain.value = 0.0;
      this.osc.connect(this.gain).connect(this.ctx.destination);
      this.osc.start();
    }
    await this.ctx.resume();
    this.enabled = true;
    this.gain.gain.setTargetAtTime(0.05, this.ctx.currentTime, 0.1);
  }

  disable() {
    this.enabled = false;
    if (this.gain && this.ctx) {
      this.gain.gain.setTargetAtTime(0.0, this.ctx.currentTime, 0.05);
    }
  }

  // Map height 0..1.1 m to 220..880 Hz; add a soft tremolo from vertical speed.
  update(y, vy) {
    if (!this.enabled || !this.ctx) return;
    const norm = Math.max(0, Math.min(1, y / 1.1));
    const freq = 220 * Math.pow(4, norm);
    this.osc.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.03);
    const trem = 1 + Math.max(-0.5, Math.min(0.5, vy * 0.15));
    this.gain.gain.setTargetAtTime(0.05 * trem, this.ctx.currentTime, 0.08);
  }
}
