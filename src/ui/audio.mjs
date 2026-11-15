// Web Audio：用振荡音高表示当前最大速度；无速度时静音。
export class SpeedAudio {
  constructor() {
    this.ctx = null;
    this.osc = null;
    this.gain = null;
    this.enabled = false;
  }

  async enable() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
      this.osc = this.ctx.createOscillator();
      this.gain = this.ctx.createGain();
      this.osc.type = 'sine';
      this.gain.gain.value = 0;
      this.osc.connect(this.gain).connect(this.ctx.destination);
      this.osc.start();
    }
    await this.ctx.resume();
    this.enabled = true;
  }

  disable() {
    this.enabled = false;
    if (this.gain) this.gain.gain.value = 0;
  }

  // speed 0..maxSpeed 映射到 110..880 Hz。
  update(speed, maxSpeed = 5.5) {
    if (!this.enabled || !this.ctx) return;
    const ratio = Math.min(speed / maxSpeed, 1);
    const freq = 110 * Math.pow(8, ratio); // 110 -> 880 Hz
    this.osc.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.03);
    this.gain.gain.setTargetAtTime(0.02 + ratio * 0.08, this.ctx.currentTime, 0.05);
  }

  silence() {
    if (this.gain) this.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
  }
}
