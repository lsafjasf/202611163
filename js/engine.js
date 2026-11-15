import { PHYS, RING_Y, LIMITS } from './constants.js';
import { clamp, coilForce, magneticSummary } from './util.js';

// Pure PRNG step: returns [value, nextState]. Keeps every snapshot serializable.
function nextRng(s) {
  s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s];
}

export function createState(cfg = {}) {
  const mass = cfg.mass ?? PHYS.BALL_MASS;
  return {
    t: 0, step: 0,
    mass,
    damping: cfg.damping ?? 1.6,
    disturbAmp: cfg.disturb ?? 0.012,
    radialK: cfg.radialK ?? PHYS.RADIAL_K,
    seed: cfg.seed ?? PHYS.RAND_SEED,
    rngState: cfg.seed ?? PHYS.RAND_SEED,
    y: PHYS.START_Y, vy: 0, x: PHYS.START_X, vx: 0,
    current: [0, 0, 0, 0],
    command: [0, 0, 0, 0],
    temp: [PHYS.T_AMBIENT, PHYS.T_AMBIENT, PHYS.T_AMBIENT, PHYS.T_AMBIENT],
    ringsPassed: [false, false, false],
    ringsHit: [false, false, false],
    score: 100,
    status: 'idle', // idle | running | paused | triggered | success | failed
    trigger: null,
    contactPressure: 0,
    maxPressure: 0,
    lastEvent: { text: '系统就绪，等待启动', t: 0 },
    events: [],
    forceZ: 0, forceX: 0,
    trend: []
  };
}

function logEvent(state, text) {
  const ev = { text, t: state.t, step: state.step };
  state.lastEvent = ev;
  state.events.push(ev);
  if (state.events.length > 200) state.events.shift();
}

function fireTrigger(state, type, message, extra) {
  if (state.trigger) return;
  state.status = 'triggered';
  state.trigger = Object.assign({
    type, message, step: state.step, t: state.t,
    y: state.y, vy: state.vy, x: state.x, vx: state.vx,
    temp: Math.max(...state.temp), pressure: state.maxPressure
  }, extra || {});
  logEvent(state, `触发保护：${message}`);
}

export function checkLoadEnvelope(state) {
  if (state.mass < LIMITS.loadMin || state.mass > LIMITS.loadMax) {
    fireTrigger(state, 'load',
      `负载 ${state.mass.toFixed(3)} kg 超出 [${LIMITS.loadMin}, ${LIMITS.loadMax}] kg`);
    return false;
  }
  return true;
}

// One fixed-dt integration step. Shared by run, pause-step and replay rebuild.
export function stepOnce(state, pilot) {
  if (state.status === 'triggered' || state.status === 'success' ||
      state.status === 'failed') return state;
  if (!checkLoadEnvelope(state)) return state;

  const dt = PHYS.DT;
  if (pilot) pilot(state);

 // Actuator lag + thermal model per coil.
  for (let k = 0; k < 4; k++) {
    const cmd = clamp(state.command[k], 0, PHYS.CURRENT_MAX);
    state.current[k] += (dt / PHYS.CURRENT_TAU) * (cmd - state.current[k]);
    state.current[k] = clamp(state.current[k], 0, PHYS.CURRENT_MAX);
    const heat = PHYS.COIL_R * state.current[k] ** 2;
    const tEq = PHYS.T_AMBIENT + PHYS.THERM_R * heat;
    state.temp[k] += (dt / PHYS.THERM_TAU) * (tEq - state.temp[k]);
  }

 // Deterministic disturbance (two PRNG draws per axis per step).
  let ru1, ru2;
  [ru1, state.rngState] = nextRng(state.rngState);
  [ru2, state.rngState] = nextRng(state.rngState);
  const dz = state.disturbAmp * (ru1 + ru2 - 1);
  [ru1, state.rngState] = nextRng(state.rngState);
  [ru2, state.rngState] = nextRng(state.rngState);
  const dx = state.disturbAmp * 0.6 * (ru1 + ru2 - 1);

  const mag = magneticSummary(state);
  const fz = mag.total - state.mass * PHYS.G - state.damping * state.vy + dz;
  const fx = -state.radialK * state.x - state.damping * state.vx + dx;
  state.forceZ = fz;
  state.forceX = fx;

  const prevY = state.y;
  state.vy += (fz / state.mass) * dt;
  state.vx += (fx / state.mass) * dt;
  state.y += state.vy * dt;
  state.x += state.vx * dt;

  resolveRings(state, prevY);
  resolveWalls(state);
  resolveBase(state);
  state.t += dt;
  state.step += 1;
  state.trend.push({ y: state.y, vy: state.vy });
  if (state.trend.length > 240) state.trend.shift();
  if (state.status === 'running' && allRingsDone(state) && state.y <= PHYS.SEAT_Y + 0.06
      && Math.abs(state.vy) < 0.05 && Math.abs(state.x) < 0.03) {
    state.status = 'success';
    logEvent(state, `安全落座，任务成功，得分 ${state.score}`);
  } else {
    checkLimits(state);
  }
  return state;
}

function allRingsDone(state) {
  return state.ringsPassed.every(Boolean);
}

function resolveRings(state, prevY) {
  const r = PHYS.BALL_RADIUS;
  state.contactPressure = 0;
  for (let k = 0; k < RING_Y.length; k++) {
    const ry = RING_Y[k];
    const crossed = (prevY < ry && state.y >= ry) || (prevY > ry && state.y <= ry);
    const dy = state.y - ry;
    const radial = Math.abs(state.x);
    // Ball edge reaches the annular gap only when its radial clearance vanishes.
    const blocked = radial + r > PHYS.RING_CLEAR;
    const withinReach = (dy * dy + Math.max(0, radial - PHYS.RING_CLEAR) ** 2) <= r * r;
    if (crossed && blocked) {
      state.y = prevY;
      state.vy = -PHYS.RESTITUTION * state.vy;
      // Deflect outward along the rim so the ball does not stick on the ring.
      state.vx += (Math.sign(state.x) || 1) * 0.25;
      if (!state.ringsHit[k]) {
        state.ringsHit[k] = true;
        state.score = Math.max(0, state.score - 15);
        logEvent(state, `碰撞 ${k + 1} 号环边，评分 -15`);
      }
    }
    if (withinReach && blocked) {
      const pen = radial + r - PHYS.RING_CLEAR;
      const push = PHYS.CONTACT_K * pen + PHYS.CONTACT_D * Math.abs(state.vx);
      state.vx += (-(Math.sign(state.x) || 1) * push / state.mass) * PHYS.DT;
      const pressure = push / PHYS.BALL_AREA;
      state.contactPressure = Math.max(state.contactPressure, pressure);
      state.maxPressure = Math.max(state.maxPressure, pressure);
    }
    if (crossed && !blocked && !state.ringsPassed[k]) {
      state.ringsPassed[k] = true;
      logEvent(state, `干净穿过 ${k + 1} 号环`);
    }
  }
}

function resolveWalls(state) {
  if (Math.abs(state.x) > PHYS.MAX_R) {
    const s = Math.sign(state.x);
    state.x = s * PHYS.MAX_R;
    state.vx = -PHYS.RESTITUTION * state.vx;
  }
}

function resolveBase(state) {
  const floor = PHYS.BALL_RADIUS;
  if (state.y <= floor) {
    state.y = floor;
    if (state.vy < -0.5) {
      const force = state.mass * Math.abs(state.vy) * (1 + PHYS.RESTITUTION) / PHYS.DT;
      state.maxPressure = Math.max(state.maxPressure, force / PHYS.BALL_AREA);
      state.score = Math.max(0, state.score - 30);
      logEvent(state, '硬着陆，评分 -30');
    }
    state.vy = state.vy < 0 ? -PHYS.RESTITUTION * state.vy : 0;
    if (Math.abs(state.vy) < 0.12) state.vy = 0;
  }
}

function checkLimits(state) {
  if (Math.abs(state.vy) > LIMITS.speedMax) {
    fireTrigger(state, 'speed', `速度 ${Math.abs(state.vy).toFixed(2)} m/s 超过上限 ${LIMITS.speedMax}`);
  } else if (Math.max(...state.temp) > LIMITS.tempMax) {
    fireTrigger(state, 'temp', `线圈温度 ${(Math.max(...state.temp) - 273.15).toFixed(1)} °C 超过 80 °C`);
  } else if (state.maxPressure > LIMITS.pressureMax) {
    fireTrigger(state, 'pressure',
      `接触压力 ${(state.maxPressure / 1000).toFixed(1)} kPa 超过 ${(LIMITS.pressureMax / 1000).toFixed(0)} kPa`);
  }
}

export function snapshot(state) {
  return JSON.parse(JSON.stringify({
    t: state.t, step: state.step, y: state.y, vy: state.vy, x: state.x, vx: state.vx,
    current: state.current, command: state.command, temp: state.temp,
    ringsPassed: state.ringsPassed, ringsHit: state.ringsHit, score: state.score,
    status: state.status, trigger: state.trigger, contactPressure: state.contactPressure,
    maxPressure: state.maxPressure, forceZ: state.forceZ, forceX: state.forceX,
    lastEvent: state.lastEvent, rngState: state.rngState, mass: state.mass,
    damping: state.damping, disturbAmp: state.disturbAmp, radialK: state.radialK
  }));
}

export { logEvent };
