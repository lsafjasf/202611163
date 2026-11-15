/* Web Audio feedback: pitch encodes drift direction and magnitude.
 * Two oscillators (X/Y): positive tilt -> sharp/high, negative -> flat/low. */
(function (root) {
  "use strict";

  class AudioFeedback {
    constructor() {
      this.ctx = null;
      this.enabled = false;
      this.baseFreq = 220;
    }

    async enable() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.0001;
        this.master.connect(this.ctx.destination);
        this.oscX = this._makeVoice(-12);
        this.oscY = this._makeVoice(12);
      }
      await this.ctx.resume();
      this.enabled = true;
      this.master.gain.setTargetAtTime(0.06, this.ctx.currentTime, 0.05);
    }

    _makeVoice(pan) {
      const osc = this.ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = this.baseFreq;
      const g = this.ctx.createGain();
      g.gain.value = 0.5;
      const panner = this.ctx.createStereoPanner
        ? this.ctx.createStereoPanner()
        : null;
      if (panner) {
        panner.pan.value = pan < 0 ? -0.7 : 0.7;
        osc.connect(g).connect(panner).connect(this.master);
      } else {
        osc.connect(g).connect(this.master);
      }
      osc.start();
      return { osc, gain: g.gain };
    }

    disable() {
      this.enabled = false;
      if (this.master) {
        this.master.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.05);
      }
    }

    /* qx,qy in rad. Sign of tilt shifts pitch: +drift rises, -drift falls. */
    update(qx, qy, tilt) {
      if (!this.ctx || !this.enabled) return;
      const t = this.ctx.currentTime;
      const scale = 900; // Hz per radian
      this.oscX.osc.frequency.setTargetAtTime(
        Math.max(40, this.baseFreq + qx * scale),
        t,
        0.08
      );
      this.oscY.osc.frequency.setTargetAtTime(
        Math.max(40, this.baseFreq + qy * scale),
        t,
        0.08
      );
      // louder as tilt grows; near-zero tilt goes nearly silent
      const vol = Math.min(1, tilt / 0.1);
      this.oscX.gain.setTargetAtTime(0.15 + 0.5 * vol, t, 0.1);
      this.oscY.gain.setTargetAtTime(0.15 + 0.5 * vol, t, 0.1);
    }

    blip(freq, dur = 0.18, type = "triangle") {
      if (!this.ctx || !this.enabled) return;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.25, this.ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
      osc.connect(g).connect(this.master);
      osc.start();
      osc.stop(this.ctx.currentTime + dur);
    }

    success() {
      this.blip(660, 0.15);
      setTimeout(() => this.blip(880, 0.25), 160);
    }

    trip() {
      this.blip(160, 0.4, "sawtooth");
    }
  }

  root.GyroAudio = AudioFeedback;
})(typeof self !== "undefined" ? self : this);
