import { clamp, computeAudioEvents } from "./project.js";

const noiseCache = new WeakMap();

function getNoiseBuffer(context) {
  if (noiseCache.has(context)) return noiseCache.get(context);
  const length = Math.ceil(context.sampleRate * 0.35);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 9273;
  for (let index = 0; index < length; index += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    data[index] = (seed / 4294967296) * 2 - 1;
  }
  noiseCache.set(context, buffer);
  return buffer;
}

function envelope(context, when, attack, decay, peak) {
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), when + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay);
  return gain;
}

function scheduleKick(context, destination, when, velocity) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(142, when);
  oscillator.frequency.exponentialRampToValueAtTime(43, when + 0.16);
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(0.86 * velocity, when + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.27);
  oscillator.connect(gain).connect(destination);
  oscillator.start(when);
  oscillator.stop(when + 0.3);
  return [oscillator];
}

function scheduleSnare(context, destination, when, velocity) {
  const source = context.createBufferSource();
  source.buffer = getNoiseBuffer(context);
  const filter = context.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(1850, when);
  filter.Q.setValueAtTime(0.72, when);
  const gain = envelope(context, when, 0.003, 0.15, 0.5 * velocity);
  source.connect(filter).connect(gain).connect(destination);
  source.start(when);
  source.stop(when + 0.2);

  const body = context.createOscillator();
  const bodyGain = envelope(context, when, 0.002, 0.09, 0.18 * velocity);
  body.type = "triangle";
  body.frequency.setValueAtTime(205, when);
  body.frequency.exponentialRampToValueAtTime(145, when + 0.08);
  body.connect(bodyGain).connect(destination);
  body.start(when);
  body.stop(when + 0.12);
  return [source, body];
}

function scheduleHat(context, destination, when, velocity) {
  const source = context.createBufferSource();
  source.buffer = getNoiseBuffer(context);
  const filter = context.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.setValueAtTime(7200, when);
  const gain = envelope(context, when, 0.001, 0.045, 0.18 * velocity);
  source.connect(filter).connect(gain).connect(destination);
  source.start(when);
  source.stop(when + 0.06);
  return [source];
}

function scheduleRim(context, destination, when, velocity) {
  const oscillator = context.createOscillator();
  const filter = context.createBiquadFilter();
  const gain = envelope(context, when, 0.001, 0.055, 0.2 * velocity);
  oscillator.type = "square";
  oscillator.frequency.setValueAtTime(840, when);
  oscillator.frequency.exponentialRampToValueAtTime(520, when + 0.045);
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(1100, when);
  oscillator.connect(filter).connect(gain).connect(destination);
  oscillator.start(when);
  oscillator.stop(when + 0.07);
  return [oscillator];
}

function scheduleDrum(context, destination, event, when) {
  switch (event.type) {
    case "kick":
      return scheduleKick(context, destination, when, event.velocity);
    case "snare":
      return scheduleSnare(context, destination, when, event.velocity);
    case "rim":
      return scheduleRim(context, destination, when, event.velocity);
    case "hat":
    default:
      return scheduleHat(context, destination, when, event.velocity);
  }
}

function createMasterChain(context, destination = context.destination) {
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -18;
  compressor.knee.value = 18;
  compressor.ratio.value = 3.5;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.2;
  const master = context.createGain();
  master.connect(compressor).connect(destination);
  return { master, compressor };
}

export class DrumEngine {
  constructor() {
    this.context = null;
    this.master = null;
    this.compressor = null;
    this.activeNodes = [];
    this.running = false;
    this.startGeneration = 0;
    this.anchorContextTime = 0;
    this.anchorTimelineTime = 0;
    this.currentGain = 0.68;
  }

  async ensureContext() {
    if (!this.context) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) throw new Error("当前浏览器不支持 Web Audio");
      this.context = new Context({ latencyHint: "interactive" });
      const chain = createMasterChain(this.context);
      this.master = chain.master;
      this.compressor = chain.compressor;
      this.master.gain.value = this.currentGain;
    }
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
    return this.context;
  }

  setGain(value) {
    this.currentGain = clamp(value, 0, 1);
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(this.currentGain, this.context.currentTime, 0.01);
    }
  }

  schedule(project, layout, fromTime) {
    if (!this.context || !this.master) return;
    const events = computeAudioEvents(project, layout);
    const base = this.context.currentTime + 0.025;
    for (const event of events) {
      if (event.time < fromTime - 0.001) continue;
      const when = base + (event.time - fromTime);
      if (when >= this.context.currentTime) {
        const nodes = scheduleDrum(this.context, this.master, event, when);
        this.activeNodes.push(...nodes);
      }
    }
  }

  async start(project, layout, fromTime) {
    const generation = ++this.startGeneration;
    const context = await this.ensureContext();
    if (generation !== this.startGeneration) return false;
    this.stopNodes();
    this.setGain(project.audio.gain);
    this.running = true;
    this.anchorContextTime = context.currentTime;
    this.anchorTimelineTime = fromTime;
    this.schedule(project, layout, fromTime);
    return true;
  }

  stopNodes() {
    this.running = false;
    for (const node of this.activeNodes) {
      try {
        node.stop();
      } catch {
        // A node may already have stopped naturally.
      }
      try {
        node.disconnect();
      } catch {
        // Disconnected nodes are safe to ignore.
      }
    }
    this.activeNodes = [];
  }

  stop() {
    this.startGeneration += 1;
    this.stopNodes();
  }

  getTime() {
    if (!this.running || !this.context) return null;
    return this.anchorTimelineTime + (this.context.currentTime - this.anchorContextTime);
  }

  async destroy() {
    this.stop();
    if (this.context) {
      try {
        await this.context.close();
      } catch {
        // Closing an already closed context is harmless.
      }
      this.context = null;
      this.master = null;
    }
  }
}

export async function renderDrumBuffer(project, layout, sampleRate = 48000) {
  const duration = Math.max(0.25, layout.total);
  const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OfflineContext) throw new Error("当前浏览器不支持离线音频渲染");
  const context = new OfflineContext(2, Math.ceil(duration * sampleRate), sampleRate);
  const { master } = createMasterChain(context);
  master.gain.value = project.audio.gain;
  const events = computeAudioEvents(project, layout);
  for (const event of events) {
    scheduleDrum(context, master, event, event.time + 0.025);
  }
  return context.startRendering();
}
