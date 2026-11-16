// Simulation runner. Environment-agnostic: the caller (browser rAF loop or
// headless harness) feeds frame deltas via tick(). Two modes:
//   'variable' — legacy behaviour: integrate with whatever dt arrives.
//   'fixed'    — accumulator + fixed dt + interpolation alpha for rendering.

import { createWorld, stepWorld, inputAt, sanitizeTrack } from './physics.js';

export const FIXED_DT = 1 / 120;          // physics step (s)
export const MAX_FRAME_DELTA = 0.25;      // s; clamps huge deltas (tab switch)
export const TRAIL_CAP_FIXED = 240;       // bounded ring buffer after fix
export const LOG_CAP = 200;               // bounded error log
export const MAX_CONSECUTIVE_INPUT_ERRORS = 3;

export class SimRunner {
  constructor({ mode = 'fixed', rawTrack = [], initial = {}, now = () => 0 }) {
    this.mode = mode;
    this.now = now; // injectable clock for step-cost measurement
    this.world = createWorld(initial);
    this.errors = [];
    this.totalErrors = 0;      // never capped — failures stay countable
    this.droppedLogEntries = 0;
    this.recoveryEvents = [];
    this.paused = false;
    this.autoPausedByBlur = false;
    this.pausedByErrorStorm = false;
    this.speed = 1;
    this.acc = 0;
    this.alpha = 1;
    this.trail = [];
    this.listenerCount = 0;
    this.consecutiveInputErrors = 0;
    this.metrics = {
      frames: 0,
      fixedSteps: 0,
      clampedFrames: 0,
      maxFrameDeltaMs: 0,
      simTime: 0,
      wallTimeMs: 0,
      frameMsAvg: 0,
      stepMsAvg: 0,
    };
    const { track, errors } = sanitizeTrack(rawTrack, () => {});
    this.track = track;
    errors.forEach((e) => this.logError('input', e.code, e.detail, e.hint));
  }

  logError(kind, code, detail, hint) {
    this.totalErrors += 1;
    const entry = { kind, code, detail, hint, simTime: this.world.time };
    if (this.errors.length < LOG_CAP) this.errors.push(entry);
    else this.droppedLogEntries += 1;
    if (hint && !this.recoveryEvents.includes(hint)) this.recoveryEvents.push(hint);
    return entry;
  }

  setSpeed(mult) {
    if (!Number.isFinite(mult) || mult <= 0 || mult > 8) {
      this.logError('control', 'SPEED_RANGE', `speed=${String(mult)}`, '倍速非法，已忽略；请使用 0.25–8 之间的值。');
      return;
    }
    this.speed = mult;
  }

  pause() { this.paused = true; }

  resume() {
    this.paused = false;
    this.autoPausedByBlur = false;
    this.pausedByErrorStorm = false;
    this.consecutiveInputErrors = 0;
    this.acc = 0; // discard stale remainder so resume never jumps
  }

  // Window blur/focus recovery: auto-pause while hidden, and on return the
  // caller resets its clock, so no giant delta is ever applied.
  notifyHidden() {
    if (!this.paused) {
      this.paused = true;
      this.autoPausedByBlur = true;
    }
  }

  notifyVisible() {
    if (this.autoPausedByBlur) {
      this.paused = false;
      this.autoPausedByBlur = false;
      this.acc = 0;
    }
  }

  tick(deltaMs) {
    const frameStart = this.now();
    const m = this.metrics;
    m.frames += 1;
    if (this.paused) return;

    let dt = (deltaMs / 1000) * this.speed;
    m.maxFrameDeltaMs = Math.max(m.maxFrameDeltaMs, deltaMs);
    if (dt > MAX_FRAME_DELTA) {
      dt = MAX_FRAME_DELTA;
      m.clampedFrames += 1;
      this.logError('frame', 'FRAME_CLAMP',
        `delta=${deltaMs.toFixed(1)}ms clamped to ${MAX_FRAME_DELTA * 1000}ms`,
        '检测到超大帧间隔（可能切后台），已钳制并丢弃多余时间，画面不会跳跃。');
    }

    if (this.mode === 'fixed') {
      this.acc += dt;
      while (this.acc >= FIXED_DT) {
        this.stepOnce(FIXED_DT);
        this.acc -= FIXED_DT;
      }
      this.alpha = this.acc / FIXED_DT;
    } else {
      this.stepOnce(dt);
      this.alpha = 1;
    }

    m.simTime = this.world.time;
    const frameCost = this.now() - frameStart;
    m.wallTimeMs += frameCost;
    m.frameMsAvg += (frameCost - m.frameMsAvg) * 0.1;
  }

  stepOnce(dt) {
    const ax = inputAt(this.track, this.world.time);
    const t0 = this.now();
    stepWorld(this.world, ax, dt);
    const cost = this.now() - t0;
    const m = this.metrics;
    m.fixedSteps += 1;
    m.stepMsAvg += (cost - m.stepMsAvg) * 0.05;
    this.pushTrail(this.world.state.x, this.world.state.y);
  }

  pushTrail(x, y) {
    this.trail.push({ x, y });
    // Fixed mode keeps a bounded ring buffer (resource fix); variable mode
    // reproduces the legacy unbounded growth for before/after comparison.
    if (this.mode === 'fixed' && this.trail.length > TRAIL_CAP_FIXED) {
      this.trail.splice(0, this.trail.length - TRAIL_CAP_FIXED);
    }
  }

  // Interpolated render state — never mutates physics state.
  getRenderState() {
    const { state, prev } = this.world;
    const a = this.mode === 'fixed' ? this.alpha : 1;
    return {
      x: prev.x + (state.x - prev.x) * a,
      y: prev.y + (state.y - prev.y) * a,
    };
  }

  noteInputError(code, detail, hint) {
    this.consecutiveInputErrors += 1;
    this.logError('input', code, detail, hint);
    if (this.consecutiveInputErrors >= MAX_CONSECUTIVE_INPUT_ERRORS && !this.pausedByErrorStorm) {
      this.pausedByErrorStorm = true;
      this.paused = true;
      this.recoveryEvents.push('连续输入错误过多，已自动暂停；修复输入源后点击“继续”。');
    }
  }

  getResourceStats() {
    return {
      trailPoints: this.trail.length,
      trailCap: this.mode === 'fixed' ? TRAIL_CAP_FIXED : null,
      logEntries: this.errors.length,
      logCap: LOG_CAP,
      droppedLogEntries: this.droppedLogEntries,
      listeners: this.listenerCount,
      timers: 0,
    };
  }

  snapshot() {
    return {
      mode: this.mode,
      state: { ...this.world.state },
      simTime: this.world.time,
      steps: this.world.steps,
      totalErrors: this.totalErrors,
      metrics: { ...this.metrics },
      resources: this.getResourceStats(),
    };
  }
}
