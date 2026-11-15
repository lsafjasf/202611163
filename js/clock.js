// 主时钟：画面、文字、声音共用同一时间源。
// 播放时由 performance.now() 推进；暂停/拖动时显式 seek。

export class MasterClock {
  constructor(duration) {
    this.duration = duration;
    this.loop = false;
    this.playing = false;
    this._time = 0;          // 暂停时的时间
    this._startPerf = 0;     // 播放起点（performance.now 毫秒）
    this._startTime = 0;     // 播放起点对应的时间线秒
  }

  setDuration(d) {
    this.duration = d;
    if (this.time > d) this.seek(d);
  }

  get time() {
    if (!this.playing) return this._time;
    const elapsed = (performance.now() - this._startPerf) / 1000;
    let t = this._startTime + elapsed;
    if (this.loop && this.duration > 0) {
      t = t % this.duration;
    } else if (t >= this.duration) {
      t = this.duration;
    }
    return t;
  }

  play() {
    if (this.playing) return;
    let t = this._time;
    if (!this.loop && t >= this.duration) t = 0; // 播到尾再按播放则从头开始
    this._startPerf = performance.now();
    this._startTime = t;
    this.playing = true;
  }

  pause() {
    if (!this.playing) return;
    this._time = this.time;
    this.playing = false;
  }

  seek(t) {
    const clamped = Math.max(0, Math.min(t, this.duration));
    this._time = clamped;
    if (this.playing) {
      this._startPerf = performance.now();
      this._startTime = clamped;
    }
  }

  // 到达末尾且非循环时由外部循环调用，返回 true 表示自然停止。
  checkEnded() {
    if (this.playing && !this.loop && this.time >= this.duration) {
      this.pause();
      this.seek(this.duration);
      return true;
    }
    return false;
  }
}

export function formatTimecode(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const ms = Math.floor((t * 1000) % 1000);
  const pad = (n, w) => String(n).padStart(w, "0");
  return `${pad(m, 2)}:${pad(s, 2)}.${pad(ms, 3)}`;
}
