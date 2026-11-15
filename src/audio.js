export class WaterAudio {
  constructor() {
    this.context = null;
    this.source = null;
    this.filter = null;
    this.gain = null;
    this.enabled = false;
    this.started = false;
  }

  async toggle() {
    if (!this.context) this.createGraph();
    if (this.context.state === "suspended") await this.context.resume();
    this.enabled = !this.enabled;
    const now = this.context.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setTargetAtTime(this.enabled ? 0.055 : 0.0001, now, 0.16);
    if (this.enabled && !this.started) {
      this.source.start();
      this.started = true;
    }
    return this.enabled;
  }

  createGraph() {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) throw new Error("当前浏览器不支持 Web Audio");
    this.context = new Context();
    const seconds = 3;
    const buffer = this.context.createBuffer(
      1,
      this.context.sampleRate * seconds,
      this.context.sampleRate,
    );
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let index = 0; index < data.length; index += 1) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.025 * white) / 1.025;
      data[index] = last * 3.4;
    }

    this.source = this.context.createBufferSource();
    this.source.buffer = buffer;
    this.source.loop = true;

    this.filter = this.context.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 720;
    this.filter.Q.value = 0.65;

    const highpass = this.context.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 95;

    this.gain = this.context.createGain();
    this.gain.gain.value = 0.0001;
    this.source.connect(this.filter);
    this.filter.connect(highpass);
    highpass.connect(this.gain);
    this.gain.connect(this.context.destination);
  }

  setFlow(gateOpening, downstream) {
    if (!this.context || !this.enabled) return;
    const now = this.context.currentTime;
    const normalized = Math.min(1, downstream / 360);
    this.filter.frequency.setTargetAtTime(
      420 + gateOpening * 8 + normalized * 480,
      now,
      0.22,
    );
    this.gain.gain.setTargetAtTime(0.025 + normalized * 0.055, now, 0.22);
  }

  async setEnabled(enabled) {
    if (enabled !== this.enabled) return this.toggle();
    if (enabled && this.context?.state === "suspended") {
      await this.context.resume();
    }
    return this.enabled;
  }
}
