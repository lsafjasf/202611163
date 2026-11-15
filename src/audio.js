// Web Audio layer: cable-tension hum, wind noise, and event stingers.
// Everything is created lazily on first user gesture (browser policy).

export function createAudio() {
  let ctx = null;
  let hum = null; // { osc, gain } tension-driven hum
  let wind = null; // { src, gain, filter } gust noise
  let master = null;

  function ensure() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 55;
    const humGain = ctx.createGain();
    humGain.gain.value = 0;
    const humFilter = ctx.createBiquadFilter();
    humFilter.type = 'lowpass';
    humFilter.frequency.value = 400;
    osc.connect(humFilter).connect(humGain).connect(master);
    osc.start();
    hum = { osc, gain: humGain, filter: humFilter };

    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const wFilter = ctx.createBiquadFilter();
    wFilter.type = 'bandpass';
    wFilter.frequency.value = 600;
    const wGain = ctx.createGain();
    wGain.gain.value = 0;
    src.connect(wFilter).connect(wGain).connect(master);
    src.start();
    wind = { src, gain: wGain, filter: wFilter };
    return true;
  }

  function blip(freq, dur, type = 'sine', vol = 0.25) {
    if (!ensure()) return;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g).connect(master);
    o.start();
    o.stop(ctx.currentTime + dur);
  }

  return {
    unlock() {
      if (ensure() && ctx.state === 'suspended') ctx.resume();
    },
    // Called every frame with the live simulation state.
    update(state, tensionMax) {
      if (!ctx) return;
      const ratio = Math.min(1.2, state.tension / tensionMax);
      const target = state.status === 'running' ? 0.03 + ratio * 0.12 : 0;
      hum.gain.gain.setTargetAtTime(target, ctx.currentTime, 0.08);
      hum.osc.frequency.setTargetAtTime(45 + ratio * 140, ctx.currentTime, 0.08);
      hum.filter.frequency.setTargetAtTime(250 + ratio * 900, ctx.currentTime, 0.1);
      const w = Math.min(1, Math.abs(state.wind.force) / 2);
      wind.gain.gain.setTargetAtTime(w * 0.14, ctx.currentTime, 0.15);
      wind.filter.frequency.setTargetAtTime(400 + w * 700, ctx.currentTime, 0.2);
    },
    estop() {
      blip(90, 0.35, 'square', 0.3);
      blip(60, 0.5, 'sawtooth', 0.2);
    },
    repair() {
      blip(660, 0.12, 'sine', 0.25);
      setTimeout(() => blip(880, 0.2, 'sine', 0.25), 110);
    },
    gust() {
      blip(220, 0.4, 'triangle', 0.12);
    },
    win() {
      [523, 659, 784, 1047].forEach((f, i) =>
        setTimeout(() => blip(f, 0.3, 'sine', 0.3), i * 140)
      );
    },
    lose() {
      [330, 262, 196, 131].forEach((f, i) =>
        setTimeout(() => blip(f, 0.35, 'sawtooth', 0.22), i * 160)
      );
    },
    // Full reset on restart: silence hum and wind immediately.
    reset() {
      if (!ctx) return;
      hum.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
      wind.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
      hum.osc.frequency.setValueAtTime(55, ctx.currentTime);
    },
  };
}
