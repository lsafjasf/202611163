export class HydraulicAudio {
  constructor() {
    this.context = null;
    this.enabled = false;
    this.nodes = null;
  }

  async init() {
    if (this.context) {
      if (this.context.state === "suspended") await this.context.resume();
      return;
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) throw new Error("Web Audio unavailable");
    const context = new AudioContext();
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 14;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.01;
    compressor.release.value = 0.25;

    const master = context.createGain();
    master.gain.value = 0;
    master.connect(compressor);
    compressor.connect(context.destination);

    const noiseBuffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const channel = noiseBuffer.getChannelData(0);
    let seed = 0x2f6e2b1;
    for (let index = 0; index < channel.length; index += 1) {
      seed = (1664525 * seed + 1013904223) >>> 0;
      channel[index] = (seed / 0xffffffff) * 2 - 1;
    }
    const noise = context.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;
    const noiseFilter = context.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.Q.value = 0.72;
    noiseFilter.frequency.value = 520;
    const noiseGain = context.createGain();
    noiseGain.gain.value = 0;
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(master);

    const pumpOscillator = context.createOscillator();
    pumpOscillator.type = "sawtooth";
    pumpOscillator.frequency.value = 46;
    const pumpFilter = context.createBiquadFilter();
    pumpFilter.type = "lowpass";
    pumpFilter.frequency.value = 190;
    pumpFilter.Q.value = 1.8;
    const pumpGain = context.createGain();
    pumpGain.gain.value = 0;
    pumpOscillator.connect(pumpFilter);
    pumpFilter.connect(pumpGain);
    pumpGain.connect(master);

    const alarmOscillator = context.createOscillator();
    alarmOscillator.type = "triangle";
    alarmOscillator.frequency.value = 720;
    const alarmGain = context.createGain();
    alarmGain.gain.value = 0;
    alarmOscillator.connect(alarmGain);
    alarmGain.connect(master);

    noise.start();
    pumpOscillator.start();
    alarmOscillator.start();
    this.context = context;
    this.nodes = { master, noise, noiseFilter, noiseGain, pumpOscillator, pumpGain, alarmOscillator, alarmGain };
  }

  async toggle(force) {
    if (!this.context) await this.init();
    this.enabled = typeof force === "boolean" ? force : !this.enabled;
    const gain = this.nodes.master.gain;
    gain.cancelScheduledValues(this.context.currentTime);
    gain.setTargetAtTime(this.enabled ? 0.72 : 0, this.context.currentTime, 0.055);
    if (this.enabled && this.context.state === "suspended") await this.context.resume();
    return this.enabled;
  }

  setPhysics(state, options = {}) {
    if (!this.context || !this.nodes) return;
    const now = this.context.currentTime;
    const totalFlow = state.flows.feed + state.flows.balance + state.flows.pumped + state.flows.drain;
    const flow = Math.max(0, Math.min(1, totalFlow / 320));
    const paused = Boolean(options.paused);
    const moving = paused ? 0.18 : 1;
    const fault = options.dryRun || state.temperature > 88 || state.pressure > 760 || state.status === "trip";
    this.nodes.noiseGain.gain.setTargetAtTime(0.018 + flow * 0.17 * moving, now, 0.08);
    this.nodes.noiseFilter.frequency.setTargetAtTime(280 + flow * 2800, now, 0.1);
    this.nodes.pumpGain.gain.setTargetAtTime(0.003 + state.pump * 0.036 * moving, now, 0.075);
    this.nodes.pumpOscillator.frequency.setTargetAtTime(34 + state.pumpRpm / 48, now, 0.08);
    const alarm = state.status === "trip" ? 0.06 : options.dryRun ? 0.032 : fault ? 0.016 : 0;
    this.nodes.alarmGain.gain.setTargetAtTime(alarm, now, 0.04);
    this.nodes.alarmOscillator.frequency.setTargetAtTime(fault ? 790 : 610, now, 0.06);
  }
}
