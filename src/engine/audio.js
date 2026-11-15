// Web Audio 程序化节拍：全部由 transport 时间驱动，暂停即 suspend 冻结。

const BEAT = 60; // 每分钟 60 拍基准，事件时间用秒表示

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.streamDest = null;
    this.active = new Set();
  }

  async ensureContext() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.6;
      this.master.connect(this.ctx.destination);
      this.streamDest = this.ctx.createMediaStreamDestination();
      this.master.connect(this.streamDest);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    return this.ctx;
  }

  get stream() {
    return this.streamDest ? this.streamDest.stream : null;
  }

  async suspend() {
    if (this.ctx && this.ctx.state === 'running') {
      this.stopAll();
      await this.ctx.suspend();
    }
  }

  async resume() {
    if (this.ctx && this.ctx.state === 'suspended') await this.ctx.resume();
  }

  // 清除所有已调度但未发声的节点（拖动 / 循环回绕时调用）。
  stopAll() {
    for (const node of this.active) {
      try {
        if (node.stop) node.stop();
        node.disconnect();
      } catch {
        /* 节点可能已结束 */
      }
    }
    this.active.clear();
  }

  kick(when) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, when);
    osc.frequency.exponentialRampToValueAtTime(45, when + 0.12);
    gain.gain.setValueAtTime(0.9, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + 0.22);
    osc.connect(gain).connect(this.master);
    osc.start(when);
    osc.stop(when + 0.24);
    this.active.add(osc);
    osc.onended = () => this.active.delete(osc);
  }

  hat(when) {
    const ctx = this.ctx;
    const bufferSize = ctx.sampleRate * 0.05;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i += 1) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 7000;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.25, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + 0.04);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(when);
    src.stop(when + 0.05);
    this.active.add(src);
    src.onended = () => this.active.delete(src);
  }

  // 收集某场景在 transport 区间 [from,to) 内触发的事件（全局时间）。
  eventsIn(project, scene, from, to) {
    const beatLen = BEAT / scene.audio.bpm;
    const out = [];
    const span = scene.outPoint - scene.inPoint;
    for (const beat of scene.audio.kick) {
      const local = scene.audio.startAt + beat * beatLen;
      if (local < span) out.push({ global: scene.inPoint + local, kind: 'kick' });
    }
    for (const beat of scene.audio.hat) {
      const local = scene.audio.startAt + beat * beatLen;
      if (local < span) out.push({ global: scene.inPoint + local, kind: 'hat' });
    }
    return out.filter((e) => e.global >= from && e.global < to);
  }

  // 枚举整个工程的音频事件（全局时间），供导出时一次性精确调度。
  allEvents(project) {
    const out = [];
    for (const scene of project.scenes) {
      const beatLen = BEAT / scene.audio.bpm;
      const span = scene.outPoint - scene.inPoint;
      for (const beat of scene.audio.kick) {
        const local = scene.audio.startAt + beat * beatLen;
        if (local < span) out.push({ global: scene.inPoint + local, kind: 'kick' });
      }
      for (const beat of scene.audio.hat) {
        const local = scene.audio.startAt + beat * beatLen;
        if (local < span) out.push({ global: scene.inPoint + local, kind: 'hat' });
      }
    }
    return out.sort((a, b) => a.global - b.global);
  }
}
