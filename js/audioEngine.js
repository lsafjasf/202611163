// Web Audio 合成音轨引擎。
// 与主时钟对齐：play(fromTime) 时把场景内所有未播放事件
// 按 (event.start - fromTime) 的偏移调度到 AudioContext 时间轴上。
// pause/seek/切场景时 stopAll() 立即停掉全部已调度节点，
// 保证上一场景的声音不会泄漏到下一场景。

// 纯函数：计算从 fromTime 起需要调度的事件计划（也供自检比对用）。
export function planEvents(scene, fromTime, horizon = Infinity) {
  const plan = [];
  for (const ev of scene.audio) {
    const evEnd = ev.start + ev.duration;
    if (evEnd <= fromTime || ev.start >= fromTime + horizon) continue;
    plan.push({
      id: ev.id,
      type: ev.type,
      // 事件相对调度起点的偏移与事件内偏移（从中途切入时）
      offset: Math.max(0, ev.start - fromTime),
      skip: Math.max(0, fromTime - ev.start),
      duration: evEnd - Math.max(ev.start, fromTime),
      freq: ev.freq,
      gain: ev.gain,
    });
  }
  return plan.sort((a, b) => a.offset - b.offset);
}

// 纯函数：t 时刻正在发声的事件 id 列表（自检用）。
export function activeEventsAt(scene, t, eps = 1e-3) {
  return scene.audio
    .filter((ev) => t >= ev.start - eps && t < ev.start + ev.duration - eps)
    .map((ev) => ev.id)
    .sort();
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.exportDest = null;   // 导出时挂接的 MediaStreamDestination
    this.live = [];           // 已调度、待停止的节点
    this.sceneToken = 0;      // 切场景/停止时使旧回调失效
  }

  ensureContext() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  }

  // 导出时调用：把主输出同时送入录制流。
  attachExportDestination() {
    this.ensureContext();
    if (!this.exportDest) {
      this.exportDest = this.ctx.createMediaStreamDestination();
    }
    this.master.connect(this.exportDest);
    return this.exportDest.stream;
  }

  detachExportDestination() {
    if (this.exportDest) {
      try { this.master.disconnect(this.exportDest); } catch (_) { /* 已断开 */ }
    }
  }

  _scheduleOne(plan, when) {
    const ctx = this.ctx;
    const nodes = [];
    const g = ctx.createGain();
    g.connect(this.master);
    const peak = Math.max(0.0001, plan.gain);
    const t0 = when, t1 = when + plan.duration;

    if (plan.type === "whoosh") {
      // 噪声呼啸：滤波噪声 + 频率扫掠
      const len = Math.ceil(ctx.sampleRate * plan.duration);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const filt = ctx.createBiquadFilter();
      filt.type = "bandpass";
      filt.Q.value = 2.5;
      filt.frequency.setValueAtTime(plan.freq * 0.5, t0);
      filt.frequency.exponentialRampToValueAtTime(plan.freq * 4, t1);
      src.connect(filt).connect(g);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + plan.duration * 0.4);
      g.gain.exponentialRampToValueAtTime(0.0001, t1);
      src.start(t0);
      nodes.push(src);
    } else if (plan.type === "chime") {
      // 钟声：基频 + 泛音，指数衰减
      for (const [ratio, amp] of [[1, 1], [2.01, 0.5], [2.99, 0.25]]) {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = plan.freq * ratio;
        const og = ctx.createGain();
        og.gain.setValueAtTime(peak * amp, t0);
        og.gain.exponentialRampToValueAtTime(0.0001, t1);
        osc.connect(og).connect(g);
        g.gain.value = 1;
        osc.start(t0);
        osc.stop(t1 + 0.05);
        nodes.push(osc);
      }
    } else {
      // 脉冲：低频方波连击
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = plan.freq;
      const lfo = ctx.createOscillator();
      lfo.type = "square";
      lfo.frequency.value = 6;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = peak / 2;
      g.gain.setValueAtTime(peak / 2, t0);
      lfo.connect(lfoGain).connect(g.gain);
      g.gain.setValueAtTime(peak / 2, t1 - 0.08);
      g.gain.linearRampToValueAtTime(0.0001, t1);
      osc.connect(g);
      osc.start(t0); osc.stop(t1 + 0.05);
      lfo.start(t0); lfo.stop(t1 + 0.05);
      nodes.push(osc, lfo);
    }
    this.live.push({ nodes, gain: g, token: this.sceneToken });
  }

  // 从场景本地时间 fromTime 开始播放。返回调度计划（供自检）。
  play(scene, fromTime) {
    this.ensureContext();
    this.stopAll();
    this.sceneToken++;
    const plan = planEvents(scene, fromTime);
    const base = this.ctx.currentTime + 0.06; // 少量前导，避免爆音
    for (const p of plan) {
      this._scheduleOne(p, base + p.offset);
    }
    return plan;
  }

  // 立即停止全部已调度声音（暂停/拖动/切场景/导出取消时调用）。
  stopAll() {
    this.sceneToken++;
    for (const item of this.live) {
      try { item.gain.disconnect(); } catch (_) { /* 忽略 */ }
      for (const n of item.nodes) {
        try { n.stop(); } catch (_) { /* 已停止 */ }
        try { n.disconnect(); } catch (_) { /* 已断开 */ }
      }
    }
    this.live = [];
  }
}
