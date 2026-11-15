// Web Audio：两条工位节奏声随动作密度变化，冲突/成功用独立音效反馈。
// 所有声音均由振荡器与滤波噪声实时合成，不依赖外部资源。
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.lastClampBeat = 0;
    this.lastModuleBeat = 0;
  }

  ensureContext() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctx) return null;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) {
      this.master.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, 0.02);
    }
  }

  tone(freq, duration, type = 'sine', gainValue = 0.2, when = 0) {
    if (!this.enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const start = ctx.currentTime + when;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(gainValue, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain).connect(this.master);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  // 夹具节奏：压力越接近稳定区，节拍越快、音高越低沉。
  updateClamp(state) {
    if (!this.ctx || state.paused) return;
    const pressure = state.clamp.pressure;
    const interval = 0.55 - pressure * 0.32;
    if (state.time - this.lastClampBeat < interval) return;
    this.lastClampBeat = state.time;
    const freq = state.clamp.locked ? 140 : 190 - pressure * 40;
    this.tone(freq, 0.12, 'triangle', 0.12);
  }

  // 模块节奏：偏移越小节奏越密，压装时加入短促高频。
  updateModule(state) {
    if (!this.ctx || state.paused) return;
    const closeness = 1 - Math.min(1, Math.abs(state.module.offset));
    const interval = 0.5 - closeness * 0.3;
    if (state.time - this.lastModuleBeat < interval) return;
    this.lastModuleBeat = state.time;
    this.tone(320 + closeness * 160, 0.09, 'square', 0.05);
  }

  success() {
    this.tone(523, 0.12, 'sine', 0.18);
    this.tone(659, 0.12, 'sine', 0.18, 0.1);
    this.tone(784, 0.22, 'sine', 0.18, 0.2);
  }

  conflict() {
    this.tone(160, 0.28, 'sawtooth', 0.22);
    this.tone(92, 0.34, 'square', 0.14, 0.05);
  }

  victory() {
    [523, 659, 784, 1046].forEach((f, i) =>
      this.tone(f, 0.25, 'triangle', 0.2, i * 0.14));
  }

  defeat() {
    [330, 262, 196, 131].forEach((f, i) =>
      this.tone(f, 0.3, 'sawtooth', 0.16, i * 0.16));
  }

  click() {
    this.tone(440, 0.05, 'square', 0.08);
  }

  // 重开/复位：关闭旧上下文，下一个动作重新创建，保证音效与倒计时同步清零。
  reset() {
    this.lastClampBeat = 0;
    this.lastModuleBeat = 0;
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
      this.master = null;
    }
  }
}

// 根据引擎事件触发一次性音效，供主循环在事件增量上调用。
export function soundForEvent(audio, type) {
  switch (type) {
    case 'round-success':
    case 'match-victory':
      audio.success();
      break;
    case 'round-fail':
    case 'gasket-crush':
    case 'unlocked-install':
    case 'offset-install':
    case 'round-timeout':
      audio.conflict();
      break;
    default:
      audio.click();
  }
}
