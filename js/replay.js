// Snapshot timeline. Stores one deep snapshot every N steps and reconstructs
// any intermediate instant by linear interpolation, so scrubbing never jumps.
export class Replay {
  constructor(interval = 10) {
    this.interval = interval;
    this.frames = [];
  }

  reset() {
    this.frames = [];
  }

  record(state) {
    if (state.step % this.interval === 0) {
      this.frames.push({
        step: state.step,
        t: state.t,
        y: state.y, vy: state.vy, x: state.x, vx: state.vx,
        current: state.current.slice(), temp: state.temp.slice(),
        forceZ: state.forceZ, forceX: state.forceX,
        contactPressure: state.contactPressure,
        ringsPassed: state.ringsPassed.slice(),
        ringsHit: state.ringsHit.slice(),
        score: state.score, status: state.status
      });
    }
  }

  get length() {
    return this.frames.length;
  }

  at(fraction) {
    if (this.frames.length === 0) return null;
    const pos = Math.max(0, Math.min(1, fraction)) * (this.frames.length - 1);
    const i = Math.floor(pos);
    const j = Math.min(this.frames.length - 1, i + 1);
    const a = this.frames[i];
    const b = this.frames[j];
    const u = pos - i;
    const mix = (va, vb) => va + (vb - va) * u;
    return {
      step: a.step,
      t: mix(a.t, b.t),
      y: mix(a.y, b.y), vy: mix(a.vy, b.vy),
      x: mix(a.x, b.x), vx: mix(a.vx, b.vx),
      current: a.current.map((v, k) => mix(v, b.current[k])),
      temp: a.temp.map((v, k) => mix(v, b.temp[k])),
      forceZ: mix(a.forceZ, b.forceZ), forceX: mix(a.forceX, b.forceX),
      contactPressure: mix(a.contactPressure, b.contactPressure),
      ringsPassed: u > 0.5 ? b.ringsPassed : a.ringsPassed,
      ringsHit: u > 0.5 ? b.ringsHit : a.ringsHit,
      score: u > 0.5 ? b.score : a.score,
      status: u > 0.5 ? b.status : a.status
    };
  }
}
