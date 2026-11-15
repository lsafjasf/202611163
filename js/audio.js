export class BeatEngine {
  constructor(onBeat) {
    this.onBeat = onBeat;
    this.context = null;
    this.master = null;
    this.timer = null;
    this.nextBeatAt = 0;
    this.beatIndex = 0;
    this.bpm = 92;
    this.running = false;
  }

  async ensureContext() {
    if (!this.context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error("当前浏览器不支持 Web Audio API。");
      this.context = new AudioContextClass();
      this.master = this.context.createGain();
      this.master.gain.value = 0.28;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === "suspended") await this.context.resume();
    return this.context;
  }

  async start(bpm = this.bpm) {
    this.bpm = Math.min(220, Math.max(40, Number(bpm) || 92));
    await this.ensureContext();
    if (this.running) return;
    this.running = true;
    this.beatIndex = 0;
    this.nextBeatAt = this.context.currentTime + 0.06;
    this.schedule();
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  schedule() {
    if (!this.running || !this.context) return;
    while (this.nextBeatAt < this.context.currentTime + 0.1) {
      const beatTime = this.nextBeatAt;
      const accent = this.beatIndex % 4 === 0;
      this.click(beatTime, accent);
      const delay = Math.max(0, (beatTime - this.context.currentTime) * 1000);
      window.setTimeout(() => this.onBeat?.({ index: this.beatIndex, accent }), delay);
      this.beatIndex += 1;
      this.nextBeatAt += 60 / this.bpm;
    }
  }

  click(time, accent) {
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(accent ? 1320 : 880, time);
    oscillator.frequency.exponentialRampToValueAtTime(accent ? 780 : 620, time + 0.035);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.2, time + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.045);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(time);
    oscillator.stop(time + 0.055);
  }

  setBpm(bpm) {
    const next = Math.min(220, Math.max(40, Number(bpm) || 92));
    if (this.running && this.context) {
      this.nextBeatAt = this.context.currentTime + 60 / next;
    }
    this.bpm = next;
  }

  stop() {
    this.running = false;
    if (this.timer) window.clearInterval(this.timer);
    this.timer = null;
  }
}
