const ACTION_TONES = Object.freeze({
  left: { frequency: 330, endFrequency: 250, duration: 0.055, gain: 0.052 },
  right: { frequency: 440, endFrequency: 520, duration: 0.055, gain: 0.052 },
  dash: { frequency: 150, endFrequency: 720, duration: 0.13, gain: 0.07 },
});

export class InputAudio {
  constructor({ onError = () => {}, maxVoices = 6 } = {}) {
    this.context = null;
    this.master = null;
    this.enabled = true;
    this.activeNodes = 0;
    this.peakNodes = 0;
    this.totalVoices = 0;
    this.maxVoices = maxVoices;
    this.onError = onError;
  }

  async ensureContext() {
    if (typeof window === "undefined") {
      return null;
    }
    const AudioContextClass =
      window.AudioContext ?? window.webkitAudioContext ?? null;
    if (!AudioContextClass) {
      return null;
    }
    if (!this.context) {
      this.context = new AudioContextClass();
      this.master = this.context.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
    return this.context;
  }

  async setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (this.enabled) {
      await this.ensureContext();
    }
  }

  play(action) {
    if (!this.enabled || !ACTION_TONES[action]) {
      return;
    }
    if (this.activeNodes >= this.maxVoices) {
      return;
    }
    this.ensureContext()
      .then((context) => {
        if (!context) {
          return;
        }
        const tone = ACTION_TONES[action];
        const oscillator = context.createOscillator();
        const envelope = context.createGain();
        const start = context.currentTime;
        oscillator.type = action === "dash" ? "sawtooth" : "sine";
        oscillator.frequency.setValueAtTime(tone.frequency, start);
        oscillator.frequency.exponentialRampToValueAtTime(
          tone.endFrequency,
          start + tone.duration,
        );
        envelope.gain.setValueAtTime(0.0001, start);
        envelope.gain.exponentialRampToValueAtTime(
          tone.gain,
          start + 0.008,
        );
        envelope.gain.exponentialRampToValueAtTime(
          0.0001,
          start + tone.duration,
        );
        oscillator.connect(envelope);
        envelope.connect(this.master);
        this.activeNodes += 1;
        this.totalVoices += 1;
        this.peakNodes = Math.max(this.peakNodes, this.activeNodes);
        const release = () => {
          oscillator.disconnect();
          envelope.disconnect();
          this.activeNodes = Math.max(0, this.activeNodes - 1);
        };
        oscillator.addEventListener("ended", release, { once: true });
        oscillator.start(start);
        oscillator.stop(start + tone.duration + 0.01);
      })
      .catch((error) => {
        this.enabled = false;
        this.onError({
          code: "E_AUDIO",
          message: `音频反馈已关闭：${error.message}`,
          tick: null,
          recovery: "点击“声音”重新启用，或继续静音游玩；录放不受影响。",
        });
      });
  }

  reset() {
    this.activeNodes = 0;
    if (this.master && this.context?.state === "running") {
      this.master.gain.setTargetAtTime(0.55, this.context.currentTime, 0.02);
    }
  }

  snapshot() {
    return {
      state: this.context?.state ?? "locked",
      activeNodes: this.activeNodes,
      peakNodes: this.peakNodes,
      totalVoices: this.totalVoices,
      maxVoices: this.maxVoices,
      enabled: this.enabled,
    };
  }
}
