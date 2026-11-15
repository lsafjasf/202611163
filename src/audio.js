export class CanyonAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.tensionGain = null;
    this.tensionOsc = null;
    this.windGain = null;
    this.noiseSource = null;
    this.initialized = false;
    this.muted = false;
    this.paused = false;
    this.lastBeep = -10;
    this.lastState = "ready";
  }

  async init() {
    if (this.initialized) {
      if (this.context?.state === "suspended" && !this.paused) await this.context.resume();
      return true;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return false;

    this.context = new AudioContextClass();
    this.master = this.context.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(this.context.destination);

    this.windGain = this.context.createGain();
    this.windGain.gain.value = 0;
    this.windGain.connect(this.master);

    const filter = this.context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 480;
    filter.Q.value = 0.5;
    filter.connect(this.windGain);

    const buffer = this.context.createBuffer(1, this.context.sampleRate * 2, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.94 + white * 0.06;
      data[i] = last * 2.8;
    }
    this.noiseSource = this.context.createBufferSource();
    this.noiseSource.buffer = buffer;
    this.noiseSource.loop = true;
    this.noiseSource.connect(filter);
    this.noiseSource.start();

    this.tensionGain = this.context.createGain();
    this.tensionGain.gain.value = 0;
    this.tensionGain.connect(this.master);

    this.tensionOsc = this.context.createOscillator();
    this.tensionOsc.type = "sawtooth";
    this.tensionOsc.frequency.value = 92;
    const tensionFilter = this.context.createBiquadFilter();
    tensionFilter.type = "lowpass";
    tensionFilter.frequency.value = 760;
    tensionFilter.Q.value = 1.6;
    this.tensionOsc.connect(tensionFilter);
    tensionFilter.connect(this.tensionGain);
    this.tensionOsc.start();

    this.initialized = true;
    if (this.context.state === "suspended" && !this.paused) await this.context.resume();
    return true;
  }

  setMuted(muted) {
    this.muted = muted;
    if (!this.master || !this.context) return;
    this.master.gain.setTargetAtTime(muted ? 0 : 0.8, this.context.currentTime, 0.08);
  }

  toggleMuted() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  async setPaused(paused) {
    this.paused = paused;
    if (!this.context) return;
    if (paused) {
      this.windGain.gain.setTargetAtTime(0.006, this.context.currentTime, 0.08);
      this.tensionGain.gain.setTargetAtTime(0, this.context.currentTime, 0.08);
      if (this.context.state === "running") await this.context.suspend();
    } else if (this.context.state === "suspended") {
      await this.context.resume();
    }
  }

  async reset() {
    if (!this.initialized || !this.context) return;
    if (this.context.state === "suspended") await this.context.resume();
    this.paused = false;
    this.lastState = "ready";
    this.lastBeep = -10;
    const now = this.context.currentTime;
    this.tensionGain.gain.cancelScheduledValues(now);
    this.tensionGain.gain.setValueAtTime(0, now);
    this.windGain.gain.cancelScheduledValues(now);
    this.windGain.gain.setValueAtTime(0.003, now);
    this.tensionOsc.frequency.setValueAtTime(92, now);
    this.playTone(340, 0.06, 0.025, "sine");
  }

  update(state) {
    if (!this.initialized || this.paused) return;
    const now = this.context.currentTime;
    const tension = Math.max(0, state.tension || 0);
    const wind = Math.abs(state.wind || 0);
    const active = state.phase === "playing" || state.phase === "retrieving";
    const frequency = 72 + tension * 3.25 + wind * 0.72;
    const tensionTarget = active ? 0.008 + (tension / 100) * 0.072 : 0;
    const windTarget = active ? 0.011 + (wind / 90) * 0.027 : 0;
    this.tensionOsc.frequency.setTargetAtTime(frequency, now, 0.08);
    this.tensionGain.gain.setTargetAtTime(this.muted ? 0 : tensionTarget, now, 0.08);
    this.windGain.gain.setTargetAtTime(this.muted ? 0 : windTarget, now, 0.13);

    if (active && tension >= 82 && now - this.lastBeep > 0.82) {
      this.lastBeep = now;
      this.playTone(190 + tension * 2.1, 0.16, 0.032, "triangle");
    }
    if (state.phase !== this.lastState) {
      if (state.phase === "won") this.playSuccess();
      if (state.phase === "lost") this.playFailure();
      this.lastState = state.phase;
    }
  }

  playSuccess() {
    const now = this.context.currentTime;
    [392, 523, 659, 784].forEach((frequency, index) => {
      const osc = this.context.createOscillator();
      const gain = this.context.createGain();
      osc.type = "sine";
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0, now + index * 0.11);
      gain.gain.linearRampToValueAtTime(0.045, now + index * 0.11 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.11 + 0.38);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(now + index * 0.11);
      osc.stop(now + index * 0.11 + 0.42);
    });
  }

  playFailure() {
    const now = this.context.currentTime;
    [220, 174, 128].forEach((frequency, index) => {
      const osc = this.context.createOscillator();
      const gain = this.context.createGain();
      osc.type = "sawtooth";
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0, now + index * 0.13);
      gain.gain.linearRampToValueAtTime(0.04, now + index * 0.13 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.13 + 0.42);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(now + index * 0.13);
      osc.stop(now + index * 0.13 + 0.45);
    });
  }

  playTone(frequency, duration, volume, type = "sine") {
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  snapshot() {
    return {
      initialized: this.initialized,
      contextState: this.context ? this.context.state : "none",
      muted: this.muted,
      paused: this.paused,
      tensionGain: this.tensionGain ? Number(this.tensionGain.gain.value.toFixed(4)) : 0,
      windGain: this.windGain ? Number(this.windGain.gain.value.toFixed(4)) : 0,
      frequency: this.tensionOsc ? Number(this.tensionOsc.frequency.value.toFixed(1)) : 0,
    };
  }
}
