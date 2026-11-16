// Pure, deterministic physics core. No DOM, no timers — safe for Node and
// browser. The same `stepWorld` integrator is used by both the legacy
// variable-step mode and the fixed-step mode; only the dt source differs.

export const LIMITS = Object.freeze({
  width: 800,
  height: 450,
  gravity: 900,        // units / s^2
  restitution: 0.78,
  airDrag: 0.12,       // 1/s, applied as (1 - drag*dt)
  ballRadius: 12,
  maxInputAccel: 600,  // units / s^2, boundary for input validation
});

export function createWorld(initial = {}) {
  const r = LIMITS.ballRadius;
  const state = {
    x: initial.x ?? LIMITS.width * 0.5,
    y: initial.y ?? r + 1,
    vx: initial.vx ?? 0,
    vy: initial.vy ?? 0,
  };
  return { time: 0, steps: 0, state, prev: { ...state } };
}

// Semi-implicit Euler + positional wall clamp (no tunnelling possible).
export function stepWorld(world, inputAccel, dt) {
  const s = world.state;
  world.prev = { ...s };
  const L = LIMITS;
  const r = L.ballRadius;

  s.vy += L.gravity * dt;
  s.vx += inputAccel * dt;
  const dragK = 1 - L.airDrag * dt;
  s.vx *= dragK;
  s.vy *= dragK;
  s.x += s.vx * dt;
  s.y += s.vy * dt;

  if (s.x < r) { s.x = r; s.vx = Math.abs(s.vx) * L.restitution; }
  else if (s.x > L.width - r) { s.x = L.width - r; s.vx = -Math.abs(s.vx) * L.restitution; }
  if (s.y < r) { s.y = r; s.vy = Math.abs(s.vy) * L.restitution; }
  else if (s.y > L.height - r) { s.y = L.height - r; s.vy = -Math.abs(s.vy) * L.restitution; }

  world.time += dt;
  world.steps += 1;
  return s;
}

// Last-entry-wins sampling of a recorded input trajectory.
export function inputAt(track, t) {
  let ax = 0;
  for (let i = 0; i < track.length; i += 1) {
    if (track[i].t <= t) ax = track[i].ax;
    else break;
  }
  return ax;
}

export const RECOVERY_HINTS = Object.freeze({
  INPUT_TYPE: '输入条目不是对象，已跳过；请检查输入采集模块的输出格式。',
  INPUT_TIME: '输入时间戳非法，已丢弃该条目；请确认时间戳为有限非负数。',
  INPUT_ORDER: '输入时间戳乱序，已丢弃该条目；请在录制端按时间排序。',
  INPUT_NAN: '输入加速度为 NaN/Infinity，已按 0 恢复；请检查传感器或数据源。',
  INPUT_MISSING: '输入缺少加速度字段，已按 0 恢复；请补全 ax 字段。',
  INPUT_RANGE: '输入加速度越界，已钳制到安全范围；请确认输入单位一致。',
});

// Validate a raw recorded track. Never throws: every defect is logged and
// recovered with a safe value so a corrupted scenario stays reproducible.
export function sanitizeTrack(raw, logError) {
  const clean = [];
  const errors = [];
  const report = (code, index, detail) => {
    const err = { code, index, detail, hint: RECOVERY_HINTS[code], recovered: true };
    errors.push(err);
    if (logError) logError(err);
  };
  if (!Array.isArray(raw)) {
    report('INPUT_TYPE', -1, 'track is not an array');
    return { track: clean, errors };
  }
  let lastT = -Infinity;
  raw.forEach((entry, i) => {
    if (entry === null || typeof entry !== 'object') {
      report('INPUT_TYPE', i, `entry is ${entry === null ? 'null' : typeof entry}`);
      return;
    }
    if (typeof entry.t !== 'number' || !Number.isFinite(entry.t) || entry.t < 0) {
      report('INPUT_TIME', i, `t=${String(entry.t)}`);
      return;
    }
    if (entry.t < lastT) {
      report('INPUT_ORDER', i, `t=${entry.t} < previous ${lastT}`);
      return;
    }
    lastT = entry.t;
    let ax = entry.ax;
    if (ax === undefined || ax === null) {
      report('INPUT_MISSING', i, 'ax missing');
      ax = 0;
    } else if (typeof ax !== 'number' || !Number.isFinite(ax)) {
      report('INPUT_NAN', i, `ax=${String(ax)}`);
      ax = 0;
    } else if (Math.abs(ax) > LIMITS.maxInputAccel) {
      report('INPUT_RANGE', i, `ax=${ax} clamped to ±${LIMITS.maxInputAccel}`);
      ax = Math.sign(ax) * LIMITS.maxInputAccel;
    }
    clean.push({ t: entry.t, ax });
  });
  return { track: clean, errors };
}
