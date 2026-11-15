// 单一事实时钟：画面（RAF）与声音（AudioContext 调度）共用 currentTime。
import { locateScene } from './project.js';

const LOOKAHEAD = 0.12; // 音频预调度窗口（秒）
const SCHED_INTERVAL = 25; // 调度器运行间隔（毫秒）

export class Transport {
  constructor(project, renderer, ctx2d, audio, { width, height, onFrame } = {}) {
    this.project = project;
    this.renderer = renderer;
    this.ctx2d = ctx2d;
    this.audio = audio;
    this.width = width;
    this.height = height;
    this.onFrame = onFrame || (() => {});
    this.playing = false;
    this.currentTime = 0;
    this.rafId = 0;
    this.schedTimer = 0;
    this.lastPerf = 0;
    this.audioStartPerf = 0;
    this.audioStartTransport = 0;
    this.scheduledUntil = 0;
  }

  setProject(project) {
    this.project = project;
    this.currentTime = Math.min(this.currentTime, project.duration);
    this.redraw();
  }

  get time() {
    return this.currentTime;
  }

  redraw() {
    this.renderer(this.ctx2d, this.project, this.currentTime, this.width, this.height);
    this.onFrame(this.currentTime);
  }

  async play() {
    if (this.playing) return;
    if (this.currentTime >= this.project.duration) this.currentTime = 0;
    await this.audio.ensureContext();
    await this.audio.resume();
    this.playing = true;
    this.lastPerf = performance.now();
    this.audioStartPerf = performance.now();
    this.audioStartTransport = this.currentTime;
    this.scheduledUntil = this.currentTime;
    this.audio.stopAll();
    this.loop();
    this.scheduleLoop();
  }

  async pause() {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.rafId);
    clearInterval(this.schedTimer);
    await this.audio.suspend(); // 声音立即冻结，画面停在当前帧
    this.redraw();
  }

  // 拖动播放头：实时插值重绘，并丢弃旧调度，避免声音从错误位置继续。
  async seek(time) {
    const wasPlaying = this.playing;
    if (wasPlaying) {
      this.playing = false;
      cancelAnimationFrame(this.rafId);
      clearInterval(this.schedTimer);
    }
    this.currentTime = Math.min(Math.max(0, time), this.project.duration);
    this.audio.stopAll();
    this.redraw();
    if (wasPlaying) await this.play();
  }

  loop = () => {
    if (!this.playing) return;
    const now = performance.now();
    const delta = (now - this.lastPerf) / 1000;
    this.lastPerf = now;
    let next = this.currentTime + delta;
    if (next >= this.project.duration) {
      if (this.project.loop) {
        next = next % this.project.duration;
        this.handleLoop(next);
      } else {
        next = this.project.duration;
        this.currentTime = next;
        this.redraw();
        this.pause();
        return;
      }
    }
    this.currentTime = next;
    this.redraw();
    this.rafId = requestAnimationFrame(this.loop);
  };

  handleLoop(restartTime) {
    this.audio.stopAll();
    this.audioStartPerf = performance.now();
    this.audioStartTransport = restartTime;
    this.scheduledUntil = restartTime;
  }

  scheduleLoop = () => {
    this.schedTimer = setInterval(() => this.schedule(), SCHED_INTERVAL);
    this.schedule();
  };

  schedule() {
    if (!this.playing) return;
    const perfNow = performance.now();
    const transportNow =
      this.audioStartTransport + (perfNow - this.audioStartPerf) / 1000;
    const horizon = transportNow + LOOKAHEAD;
    const from = this.scheduledUntil;
    const to = Math.min(horizon, this.project.duration);
    if (to <= from) return;

    for (const scene of this.project.scenes) {
      const events = this.audio.eventsIn(this.project, scene, from, to);
      for (const ev of events) {
        const when =
          this.audio.ctx.currentTime + (ev.global - transportNow);
        if (ev.kind === 'kick') this.audio.kick(when);
        else this.audio.hat(when);
      }
    }
    this.scheduledUntil = to;
  }

  // 当前 transport 时间对应的场景（用于 UI 与测试核对音频事件）。
  currentScene() {
    return locateScene(this.project, this.currentTime);
  }
}
