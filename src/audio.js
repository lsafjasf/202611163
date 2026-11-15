const SOUND_PATTERNS = {
  place: [520, 700],
  route: [330, 450],
  risk: [220, 165],
  select: [420],
  undo: [360, 290],
  warning: [145, 112],
  blocked: [180, 135, 105],
  success: [392, 523, 659, 880],
  fail: [294, 246, 196, 131],
  pause: [420, 300],
  resume: [300, 420],
  ui: [480],
};

export class SoundEngine {
  constructor() {
    this.context = null;
    this.master = null;
    this.muted = false;
    this.activeSources = new Set();
  }

  ensure() {
    if (!this.context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      this.context = new AudioContextClass();
      this.master = this.context.createGain();
      this.master.gain.value = this.muted ? 0 : 0.18;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === "suspended") this.context.resume().catch(() => {});
    return this.context;
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master && this.context) {
      this.master.gain.cancelScheduledValues(this.context.currentTime);
      this.master.gain.setTargetAtTime(muted ? 0 : 0.18, this.context.currentTime, 0.015);
    }
    if (muted) this.stopAll();
  }

  toggleMuted() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  play(name) {
    if (this.muted) return;
    const context = this.ensure();
    const notes = SOUND_PATTERNS[name];
    if (!context || !notes) return;
    const start = context.currentTime + 0.012;
    notes.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      oscillator.type = name === "risk" || name === "fail" ? "triangle" : "sine";
      oscillator.frequency.setValueAtTime(frequency, start + index * 0.085);
      oscillator.frequency.exponentialRampToValueAtTime(
        frequency * 1.015,
        start + index * 0.085 + 0.06,
      );
      envelope.gain.setValueAtTime(0.0001, start + index * 0.085);
      envelope.gain.exponentialRampToValueAtTime(0.42, start + index * 0.085 + 0.012);
      envelope.gain.exponentialRampToValueAtTime(0.0001, start + index * 0.085 + 0.115);
      oscillator.connect(envelope);
      envelope.connect(this.master);
      oscillator.start(start + index * 0.085);
      oscillator.stop(start + index * 0.085 + 0.13);
      this.activeSources.add(oscillator);
      oscillator.onended = () => this.activeSources.delete(oscillator);
    });
  }

  stopAll() {
    for (const source of this.activeSources) {
      try {
        source.stop();
      } catch {
        // The source may already have ended.
      }
    }
    this.activeSources.clear();
  }

  reset() {
    this.stopAll();
    if (this.context && this.master) {
      this.master.gain.cancelScheduledValues(this.context.currentTime);
      this.master.gain.setValueAtTime(this.muted ? 0 : 0.18, this.context.currentTime);
    }
  }

  getState() {
    return {
      muted: this.muted,
      contextState: this.context?.state ?? "not-created",
      activeSources: this.activeSources.size,
    };
  }
}
