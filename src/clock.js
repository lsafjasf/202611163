// 主时钟 + Web Audio 动作声合成。
// 画面、文字（字幕）、声音全部由同一个虚拟时间 currentTime 驱动，
// 不使用各自独立的计时器，从而保证暂停/拖动/循环时三者始终一致。

// 每个音频块在 AudioContext 时钟上的前瞻调度窗口（秒）
const SCHED_AHEAD = 0.12;

export class FootstepAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.activeSources = new Set();
  }

  ensureContext() {
    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.85;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      return this.ctx.resume().catch(() => {});
    }
    return Promise.resolve();
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') return this.ctx.suspend();
    return Promise.resolve();
  }

  now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  trackSource(source) {
    this.activeSources.add(source);
    source.onended = () => this.activeSources.delete(source);
  }

  // 在 AudioContext 时间 whenSec 上合成一次脚步（低频噪声爆点 + 音高区分左右脚）
  playFootstep(whenSec, kind) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = whenSec;
    const dur = 0.09;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      const env = Math.exp(-i / (data.length * 0.18));
      data[i] = (Math.random() * 2 - 1) * env;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = kind === 'right' ? 320 : kind === 'both' ? 420 : 260;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(kind === 'both' ? 0.9 : 0.7, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start(t);
    src.stop(t + dur);
    this.trackSource(src);

    // 短促低频“咚”，让脚步更有实体感
    const osc = ctx.createOscillator();
    const og = ctx.createGain();
    osc.frequency.setValueAtTime(kind === 'right' ? 150 : 110, t);
    osc.frequency.exponentialRampToValueAtTime(55, t + 0.08);
    og.gain.setValueAtTime(0.35, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    osc.connect(og);
    og.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.1);
    this.trackSource(osc);
  }

  // 立刻停止并静音所有已调度声音（场景切换/停止/拖动时使用）
  panic() {
    for (const source of this.activeSources) {
      try {
        source.onended = null;
        source.stop();
      } catch { /* 源已自然结束 */ }
    }
    this.activeSources.clear();
    if (!this.ctx) return;
    const old = this.master;
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(this.ctx.destination);
    try { old.disconnect(); } catch { /* 已断开 */ }
  }
}

export class MasterClock {
  constructor({ audio, fpsRef, sceneRef, onFrame, onEvent, onEnded }) {
    this.audio = audio;
    this.fpsRef = fpsRef;       // () => fps
    this.sceneRef = sceneRef;   // () => 当前场景
    this.onFrame = onFrame;     // (frameIndex, timeSec) => void，驱动画面与字幕
    this.onEvent = onEvent || (() => {});
    this.onEnded = onEnded || null;

    this.time = 0;             // 虚拟时间（秒），相对当前场景入点
    this.playing = false;
    this.rafId = 0;
    this.lastWall = 0;

    this.schedVirtual = 0;     // 已完成音频调度的虚拟时间水位
    this.schedCtxAt = 0;       // 该水位对应的 AudioContext 时间
    this.anchorVirtual = 0;    // 仿射锚点：虚拟时间
    this.anchorCtx = 0;        // 仿射锚点：AudioContext 时间
    this.firedKeys = new Set();
    this.seq = 0;              // 每次播放/拖动递增，作废旧调度批次
  }

  duration() {
    const scene = this.sceneRef();
    return (scene.outPoint - scene.inPoint + 1) / this.fpsRef();
  }

  currentFrame() {
    const scene = this.sceneRef();
    const fps = this.fpsRef();
    const count = scene.outPoint - scene.inPoint + 1;
    let idx = Math.floor(this.time * fps);
    idx = Math.max(0, Math.min(count - 1, idx));
    return scene.inPoint + idx;
  }

  async play() {
    if (this.playing) return;
    try {
      await this.audio.ensureContext();
    } catch {
      // 无头/受限环境下音频不可用时，视觉时钟仍须正常运转
    }
    if (this.time >= this.duration() - 1e-6) this.time = 0;
    this.playing = true;
    this.seq += 1;
    this.resetScheduleWatermark();
    this.lastWall = performance.now();
    this.onEvent({ type: 'play', time: this.time });
    const tick = (wall) => {
      if (!this.playing) return;
      const dt = Math.min(0.05, (wall - this.lastWall) / 1000);
      this.lastWall = wall;
      const dur = this.duration();
      let next = this.time + dt;
      if (next >= dur) {
        next = next % dur;
        if (this.looping === false) {
          this.time = dur;
          this.pause();
          this.time = 0;
          this.emitFrame();
          if (this.onEnded) this.onEnded();
          return;
        }
        this.seq += 1;
        this.resetScheduleWatermark(0);
        this.onEvent({ type: 'loop', time: 0 });
      }
      this.time = next;
      this.pumpScheduler();
      this.emitFrame();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
    this.pumpScheduler();
    this.emitFrame();
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.rafId);
    this.audio.panic();
    this.seq += 1;
    this.onEvent({ type: 'pause', time: this.time, frame: this.currentFrame() });
  }

  // 拖动到任意虚拟时间
  seek(timeSec) {
    const wasPlaying = this.playing;
    if (wasPlaying) this.pause();
    this.time = Math.max(0, Math.min(this.duration(), timeSec));
    this.audio.panic();
    this.seq += 1;
    this.resetScheduleWatermark();
    if (wasPlaying) {
      this.play();
    } else {
      this.emitFrame();
      this.onEvent({ type: 'seek', time: this.time, frame: this.currentFrame() });
    }
  }

  seekToFrame(frameIndex) {
    const scene = this.sceneRef();
    this.seek((frameIndex - scene.inPoint) / this.fpsRef());
  }

  // 重置时钟但不触发画面（场景切换时由外部先停音频再调用）
  resetForScene() {
    this.playing = false;
    cancelAnimationFrame(this.rafId);
    this.time = 0;
    this.seq += 1;
    this.audio.panic();
  }

  stop() {
    this.pause();
    this.time = 0;
    this.emitFrame();
  }

  emitFrame() {
    this.onFrame(this.currentFrame(), this.time);
  }

  resetScheduleWatermark(atVirtual = this.time) {
    this.anchorVirtual = atVirtual;
    this.anchorCtx = this.audio.now() + 0.03;
    this.schedVirtual = atVirtual;
  }

  // 标准 look-ahead：虚拟时间 -> AudioContext 时间的仿射映射，
  // 在每个 rAF 内把未来 SCHED_AHEAD 秒内的脚步一次性排进 Web Audio。
  pumpScheduler() {
    if (!this.playing || !this.audio.ctx) return;
    const scene = this.sceneRef();
    const fps = this.fpsRef();
    const dur = this.duration();
    const batch = this.seq;
    let guard = 0;
    while (this.schedVirtual < Math.min(dur, this.time + SCHED_AHEAD) && guard < 32) {
      const localFrame = Math.floor(this.schedVirtual * fps + 1e-9);
      const frameStartVirtual = localFrame / fps;
      const whenCtx = this.anchorCtx + (frameStartVirtual - this.anchorVirtual);
      const globalFrame = scene.inPoint + localFrame;
      this.scheduleFootstep(scene, globalFrame, localFrame, whenCtx, batch);
      this.schedVirtual = frameStartVirtual + 1 / fps;
      guard += 1;
    }
  }

  scheduleFootstep(scene, globalFrame, localFrame, whenCtx, batch) {
    if (globalFrame < scene.audioStartFrame) return;
    const frame = scene.frames[globalFrame];
    if (!frame || frame.footstep === 'none') return;
    const key = `${batch}:${localFrame}`;
    if (this.firedKeys.has(key)) return;
    this.firedKeys.add(key);
    this.audio.playFootstep(whenCtx, frame.footstep);
    this.onEvent({
      type: 'footstep',
      seq: batch,
      frame: globalFrame,
      kind: frame.footstep,
      time: localFrame / this.fpsRef(),
      ctxTime: whenCtx,
    });
  }
}
