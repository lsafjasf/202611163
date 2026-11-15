// Core simulation for the two-player gondola co-op game.
// Pure logic only: no DOM, no AudioContext. Driven by main.js (browser)
// and by test/sim.test.mjs (node, headless verification).

export const CONFIG = {
  g: 9.81,
  mass: 220, // kg, gondola + repairman
  lenMin: 3,
  lenMax: 26,
  lenStart: 6,
  armMin: -14,
  armMax: 14,
  hoistSpeed: 2.0, // m/s
  armSpeed: 2.2, // m/s
  driveAccel: 4, // m/s^2 ramp for drives
  damping: 0.35,
  windAccel: 1.2, // m/s^2 horizontal push at gondola during gust
  gustMinGap: 7,
  gustRandGap: 8,
  gustMinDur: 2,
  gustRandDur: 2.5,
  tensionWarn: 3400, // N
  tensionMax: 4600, // N, cable snaps above
  estopSpike: 520, // N added per m/s of killed drive speed
  countdown: 240, // s
  resourceMax: 100,
  drainHoist: 1.1, // per second while driving
  drainArm: 1.0,
  drainEstop: 6,
  degradedFactor: 0.35, // drive scale when resource is empty
  repairRadius: 1.6,
  repairOmegaMax: 0.22, // rad/s, must be calm to repair
  repairDwell: 2.2, // s of calm hover to finish one window
  frameEvery: 0.1, // replay frame sampling
  repairs: [
    { x: -8, y: 10 },
    { x: 7, y: 16 },
    { x: -2, y: 22 },
  ],
};

export function createGame(seed = 1) {
  const state = {
    seed,
    rng: seed >>> 0,
    t: 0,
    status: 'running', // running | paused | won | lost
    loseReason: null,
    timeLeft: CONFIG.countdown,
    resource: CONFIG.resourceMax,
    solo: false, // single-player debug mode
    seats: { L: 'hoist', R: 'swing' }, // control-side assignment (rotatable)
    hoist: { len: CONFIG.lenStart, vel: 0 },
    arm: { x: 0, vel: 0 },
    pend: { theta: 0, omega: 0 },
    wind: { force: 0, tEnd: 0, nextAt: 5 },
    tension: CONFIG.mass * CONFIG.g,
    tensionBoost: 0, // decaying shock from emergency stops
    inputs: { hoist: 0, swing: 0 }, // -1, 0, +1 demand per axis
    estop: { L: false, R: false },
    repairs: CONFIG.repairs.map((r) => ({ ...r, done: false, progress: 0 })),
    events: [], // full replay event log: {t, type, ...}
    frames: [], // sampled snapshots for replay playback
    conflicts: [], // timestamps + kind of each conflict
    _frameClock: 0,
  };
  logEvent(state, 'start', { seats: { ...state.seats } });
  return state;
}

export function resetGame(state) {
  const fresh = createGame(state.seed);
  fresh.solo = state.solo;
  fresh.seats = { ...state.seats };
  return fresh;
}

export function rotateSeats(state) {
  state.seats.L = state.seats.L === 'hoist' ? 'swing' : 'hoist';
  state.seats.R = state.seats.R === 'hoist' ? 'swing' : 'hoist';
  logEvent(state, 'rotate', { seats: { ...state.seats } });
}

function rand(state) {
  // xorshift32, deterministic per seed for reproducible replays
  state.rng ^= state.rng << 13;
  state.rng ^= state.rng >>> 17;
  state.rng ^= state.rng << 5;
  state.rng >>>= 0;
  return state.rng / 0xffffffff;
}

function logEvent(state, type, data = {}) {
  state.events.push({ t: round3(state.t), type, ...data });
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}

// Resolve a seat ('L' | 'R') to the axis it currently owns.
export function seatAxis(state, seat) {
  return state.seats[seat];
}

// Input entry point. seat: 'L' | 'R'. action: 'inc' | 'dec' | 'estop'.
// pressed: true on keydown, false on keyup. In solo debug mode the
// explicit axis actions hoistInc/hoistDec/swingInc/swingDec are used.
export function applyInput(state, seat, action, pressed) {
  if (state.status !== 'running') return;
  if (action === 'estop') {
    state.estop[seat] = pressed;
    if (pressed) doEstop(state, seat);
    return;
  }
  let axis = null;
  let dir = 0;
  if (state.solo) {
    if (action === 'hoistInc') { axis = 'hoist'; dir = 1; }
    if (action === 'hoistDec') { axis = 'hoist'; dir = -1; }
    if (action === 'swingInc') { axis = 'swing'; dir = 1; }
    if (action === 'swingDec') { axis = 'swing'; dir = -1; }
  } else {
    axis = seatAxis(state, seat);
    if (action === 'inc') dir = 1;
    if (action === 'dec') dir = -1;
  }
  if (!axis || !dir) return;
  const prev = state.inputs[axis];
  state.inputs[axis] = pressed ? dir : prev === dir ? 0 : prev;
  logEvent(state, pressed ? 'input-on' : 'input-off', { seat, axis, dir });
}

function doEstop(state, seat) {
  const axis = seatAxis(state, seat);
  const other = axis === 'hoist' ? 'swing' : 'hoist';
  const otherActive = state.inputs[other] !== 0;
  const drive = axis === 'hoist' ? state.hoist : state.arm;
  const killed = Math.abs(drive.vel);
  // A moving pivot that suddenly stops hands its speed to the pendulum;
  // a stopped hoist just slams the cable. Both spike the tension.
  if (axis === 'swing') {
    state.pend.omega += (state.arm.vel * Math.cos(state.pend.theta)) / state.hoist.len;
  } else {
    state.pend.omega += (rand(state) - 0.5) * 0.3;
  }
  state.tensionBoost += killed * CONFIG.estopSpike + 180;
  state.resource = Math.max(0, state.resource - CONFIG.drainEstop);
  logEvent(state, 'estop', { seat, axis, killedSpeed: round3(killed) });
  if (otherActive) {
    addConflict(state, 'estop-interrupt', { seat, interrupted: other });
  }
}

function addConflict(state, kind, data = {}) {
  const c = { t: round3(state.t), kind, ...data };
  state.conflicts.push(c);
  logEvent(state, 'conflict', { kind, ...data });
}

// Advance the simulation. No-op unless status === 'running'.
export function step(state, dt) {
  if (state.status !== 'running') return;
  state.t += dt;
  state.timeLeft -= dt;
  if (state.timeLeft <= 0) {
    state.timeLeft = 0;
    return lose(state, 'timeout');
  }

  updateWind(state);
  const degraded = state.resource <= 0 ? CONFIG.degradedFactor : 1;
  const armAccPrev = state.arm.vel;

  // Drive ramps for both axes; either seat's estop freezes its own axis.
  driveAxis(state, 'hoist', state.inputs.hoist * CONFIG.hoistSpeed * degraded, dt);
  driveAxis(state, 'arm', state.inputs.swing * CONFIG.armSpeed * degraded, dt);
  if (state.estop.L) freezeAxis(state, seatAxis(state, 'L'));
  if (state.estop.R) freezeAxis(state, seatAxis(state, 'R'));

  // Shared resource drain while any axis is driven.
  const drain =
    (Math.abs(state.hoist.vel) > 0.05 ? CONFIG.drainHoist : 0) +
    (Math.abs(state.arm.vel) > 0.05 ? CONFIG.drainArm : 0);
  state.resource = Math.max(0, state.resource - drain * dt);

  state.hoist.len = clamp(state.hoist.len + state.hoist.vel * dt, CONFIG.lenMin, CONFIG.lenMax);
  state.arm.x = clamp(state.arm.x + state.arm.vel * dt, CONFIG.armMin, CONFIG.armMax);
  const armAcc = (state.arm.vel - armAccPrev) / dt;

  // Pendulum dynamics: gravity, arm acceleration coupling, wind, damping.
  const L = state.hoist.len;
  const th = state.pend.theta;
  const alpha =
    -(CONFIG.g / L) * Math.sin(th) -
    (armAcc / L) * Math.cos(th) +
    (state.wind.force / L) * Math.cos(th) -
    CONFIG.damping * state.pend.omega;
  state.pend.omega += alpha * dt;
  state.pend.theta += state.pend.omega * dt;

  // Cable tension: radial gravity + centripetal + decaying estop shock.
  state.tensionBoost *= Math.exp(-dt / 0.5);
  state.tension =
    CONFIG.mass *
      (CONFIG.g * Math.cos(th) + L * state.pend.omega * state.pend.omega) +
    state.tensionBoost;
  if (state.tension > CONFIG.tensionWarn && state.inputs.hoist !== 0 && state.inputs.swing !== 0) {
    if (!state._spikeWarned || state.t - state._spikeWarned > 1.5) {
      addConflict(state, 'dual-drive-spike', { tension: Math.round(state.tension) });
      state._spikeWarned = state.t;
    }
  }
  if (state.tension > CONFIG.tensionMax) return lose(state, 'cable-snap');

  updateRepairs(state, dt);
  if (state.repairs.every((r) => r.done)) return win(state);

  state._frameClock += dt;
  if (state._frameClock >= CONFIG.frameEvery) {
    state._frameClock = 0;
    state.frames.push(snapshot(state));
  }
}

function driveAxis(state, axis, targetVel, dt) {
  const drive = axis === 'hoist' ? state.hoist : state.arm;
  const dv = targetVel - drive.vel;
  const maxDv = CONFIG.driveAccel * dt;
  drive.vel += clamp(dv, -maxDv, maxDv);
}

function freezeAxis(state, axis) {
  const drive = axis === 'hoist' ? state.hoist : state.arm;
  drive.vel = 0;
}

function updateWind(state) {
  const w = state.wind;
  if (state.t >= w.nextAt) {
    w.force = (rand(state) < 0.5 ? -1 : 1) * CONFIG.windAccel * (0.7 + rand(state) * 0.6);
    w.tEnd = state.t + CONFIG.gustMinDur + rand(state) * CONFIG.gustRandDur;
    w.nextAt = state.t + w.tEnd - state.t + CONFIG.gustMinGap + rand(state) * CONFIG.gustRandGap;
    logEvent(state, 'gust', { force: round3(w.force), until: round3(w.tEnd) });
  }
  if (state.t >= w.tEnd) w.force = 0;
}

function updateRepairs(state, dt) {
  const pos = gondolaPos(state);
  for (const r of state.repairs) {
    if (r.done) continue;
    const near = Math.hypot(pos.x - r.x, pos.y - r.y) < CONFIG.repairRadius;
    const calm = Math.abs(state.pend.omega) < CONFIG.repairOmegaMax;
    if (near && calm) {
      const before = r.progress;
      r.progress = Math.min(CONFIG.repairDwell, r.progress + dt);
      if (r.progress >= CONFIG.repairDwell && before < CONFIG.repairDwell) {
        r.done = true;
        logEvent(state, 'repair-done', { x: r.x, y: r.y });
      }
    } else {
      r.progress = Math.max(0, r.progress - dt * 0.8);
    }
  }
}

export function gondolaPos(state) {
  return {
    x: state.arm.x + state.hoist.len * Math.sin(state.pend.theta),
    y: state.hoist.len * Math.cos(state.pend.theta),
  };
}

function snapshot(state) {
  const pos = gondolaPos(state);
  return {
    t: round3(state.t),
    x: round3(pos.x),
    y: round3(pos.y),
    armX: round3(state.arm.x),
    len: round3(state.hoist.len),
    theta: round3(state.pend.theta),
    tension: Math.round(state.tension),
    resource: round3(state.resource),
    timeLeft: round3(state.timeLeft),
    wind: round3(state.wind.force),
    done: state.repairs.filter((r) => r.done).length,
  };
}

// Instrument-panel view: both seats read the same shared state. Used by
// the renderer and by tests to prove both sides stay in sync.
export function panelView(state, seat) {
  return {
    seat,
    axis: state.solo ? 'both' : seatAxis(state, seat),
    tension: Math.round(state.tension),
    resource: round3(state.resource),
    timeLeft: round3(state.timeLeft),
    repairsDone: state.repairs.filter((r) => r.done).length,
    wind: round3(state.wind.force),
    status: state.status,
  };
}

function win(state) {
  state.status = 'won';
  logEvent(state, 'won', { timeLeft: round3(state.timeLeft) });
}

function lose(state, reason) {
  state.status = 'lost';
  state.loseReason = reason;
  logEvent(state, 'lost', { reason });
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
