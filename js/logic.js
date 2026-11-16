/* 吊桥协同维修 - 核心逻辑(纯状态机,浏览器与 Node 测试共用) */
(function (root) {
'use strict';

var C = {
  SPAN: 100,               // 桥面逻辑宽度 0..100
  HOME_L: 8, HOME_R: 92,   // 两侧平台起始位置
  DOCK_L: 46, DOCK_R: 54,  // 对接位置
  DOCK_TOL: 2.0,           // 对接容差
  MIN_L: 4, MAX_L: 48,     // 左平台活动范围
  MIN_R: 52, MAX_R: 96,    // 右平台活动范围
  MOVE_SPEED: 9,           // 平台移动速度 /s
  REEL_SPEED: 10,          // 收放绳峰值速度 /s(长按达到)
  REEL_SAFE: 6,            // 安全收绳速度,桥板近桥面时超过会撞栏杆
  HOOK_MAX: 30,
  ATTACH_LEN: 24,          // 吊钩够到桥板所需绳长
  COUNTDOWN: 180,
  STRESS_WARN: 60,         // 应力告警阈值
  STRESS_MAX: 100,         // 应力极限 -> 断缆
  WEAR_RATE: 6,            // 高应力下磨损速率 /s
  SWING_HIT: 1.0,          // 桥板摆幅撞栏杆阈值
  HIT_DAMAGE: 25,          // 撞栏杆损伤
  SNAP_DT: 0.1             // 回放采样间隔
};

var PHASES = ['APPROACH', 'ATTACH', 'LIFT', 'PLACE', 'RETREAT', 'SUCCESS', 'FAILED'];
var PHASE_NAMES = {
  APPROACH: '就位', ATTACH: '挂钩', LIFT: '吊出旧板',
  PLACE: '安装新板', RETREAT: '撤回', SUCCESS: '成功', FAILED: '失败'
};

function makeSide(x) {
  return {
    x: x, hookLen: 0, attached: false,
    move: 0, reel: 0,          // 本帧输入
    reelVel: 0,                // 平滑后的收绳速度(点按慢、长按快)
    tension: 0, stress: 0, wear: 0,
    overWarn: false            // 应力是否处于告警区(用于恢复事件)
  };
}

function createState() {
  return {
    time: 0,
    phase: 'APPROACH',
    countdown: C.COUNTDOWN,
    wind: { force: 0, dir: 1 },
    left: makeSide(C.HOME_L),
    right: makeSide(C.HOME_R),
    plank: { kind: 'old', lift: 0, swing: 0, swingVel: 0 },
    integrity: 100,
    progress: 0,
    failReason: null,
    events: [],                // {t, type, msg}
    replay: { version: 1, snapshots: [], events: [], result: null },
    _snapTimer: 0
  };
}

/* 按键映射:swapped=true 时两名玩家控制侧对调 */
function mapKeys(keys, swapped, debug) {
  var wasd = {
    move: (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0),
    reel: (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0)
  };
  var arrows = {
    move: (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0),
    reel: (keys.ArrowUp ? 1 : 0) - (keys.ArrowDown ? 1 : 0)
  };
  var left = swapped ? arrows : wasd;
  var right = swapped ? wasd : arrows;
  if (debug) {
    // 单人调试:WASD 同时镜像驱动两侧,便于一人验证流程
    left = { move: wasd.move, reel: wasd.reel };
    right = { move: wasd.move !== 0 ? -wasd.move : arrows.move,
              reel: wasd.reel !== 0 ? wasd.reel : arrows.reel };
  }
  return { left: left, right: right };
}

function logEvent(state, type, msg) {
  var ev = { t: +state.time.toFixed(2), type: type, msg: msg };
  state.events.push(ev);
  state.replay.events.push(ev);
  return ev;
}

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

function windAt(t) {
  var f = 30 + 25 * Math.sin(t * 0.5) + 15 * Math.sin(t * 1.7 + 1.3);
  return { force: Math.abs(f), dir: f >= 0 ? 1 : -1 };
}

function fail(state, reason, msg) {
  if (state.phase === 'FAILED' || state.phase === 'SUCCESS') return;
  state.phase = 'FAILED';
  state.failReason = reason;
  state.replay.result = { ok: false, reason: reason, t: +state.time.toFixed(2) };
  logEvent(state, 'fail', msg);
}

function hitRailing(state, reason) {
  if (state.time - (state._lastHit || -10) < 1.0) return; // 撞击冷却
  state._lastHit = state.time;
  state.integrity = clamp(state.integrity - C.HIT_DAMAGE, 0, 100);
  state.plank.swing = 0;
  state.plank.swingVel = 0;
  logEvent(state, 'conflict', reason + ',桥板撞击栏杆!桥体完整度 -' + C.HIT_DAMAGE);
  if (state.integrity <= 0) fail(state, 'integrity', '桥体结构损坏,任务失败');
}

function updateSide(state, side, input, minX, maxX, dt) {
  side.move = input.move;
  side.reel = input.reel;
  side.x = clamp(side.x + input.move * C.MOVE_SPEED * dt, minX, maxX);
  var k = Math.min(1, dt * 4);
  side.reelVel += (input.reel * C.REEL_SPEED - side.reelVel) * k;
  side.hookLen = clamp(side.hookLen - side.reelVel * dt, 0, C.HOOK_MAX);
}

function updateStress(state, dt) {
  var L = state.left, R = state.right;
  // 平台位置差拉弯绳索:缆绳承载(挂接/放绳)越多,位置差影响越大
  var dev = Math.abs((R.x - L.x) - (C.DOCK_R - C.DOCK_L));
  var loadFactor = (L.attached || R.attached) ? 1 :
    Math.max(L.hookLen, R.hookLen) / C.ATTACH_LEN * 0.5;
  var windLoad = state.wind.force * 0.25;
  var swingLoad = Math.abs(state.plank.swing) * 25;
  var reelLoadL = Math.abs(L.reelVel) * 2.2;
  var reelLoadR = Math.abs(R.reelVel) * 2.2;
  var attachLoad = (L.attached || R.attached) ? 12 : 0;

  L.tension = clamp(attachLoad + reelLoadL + windLoad * 0.6 + swingLoad * 0.5, 0, 100);
  R.tension = clamp(attachLoad + reelLoadR + windLoad * 0.6 + swingLoad * 0.5, 0, 100);
  L.stress = clamp(dev * 5 * loadFactor + L.tension * 0.5 + swingLoad * 0.5, 0, 100);
  R.stress = clamp(dev * 5 * loadFactor + R.tension * 0.5 + swingLoad * 0.5, 0, 100);

  [['left', L, '左侧'], ['right', R, '右侧']].forEach(function (e) {
    var s = e[1], name = e[2];
    if (s.stress >= C.STRESS_WARN && !s.overWarn) {
      s.overWarn = true;
      logEvent(state, 'conflict', name + '应力超限 (' + Math.round(s.stress) + '),缆绳告急!');
    } else if (s.stress < C.STRESS_WARN - 10 && s.overWarn) {
      s.overWarn = false;
      logEvent(state, 'recover', name + '应力回落至安全区,恢复作业');
    }
    if (s.stress > 70) s.wear = clamp(s.wear + C.WEAR_RATE * dt, 0, 100);
    if (s.stress >= C.STRESS_MAX) fail(state, 'snap', name + '缆绳应力达到极限,断缆!');
    if (s.wear >= 100) fail(state, 'wear', name + '缆绳磨损殆尽,断缆!');
  });
}

function nearDock(state) {
  return Math.abs(state.left.x - C.DOCK_L) <= C.DOCK_TOL &&
         Math.abs(state.right.x - C.DOCK_R) <= C.DOCK_TOL;
}

function updatePlankSwing(state, dt, imbalance) {
  var p = state.plank;
  p.swingVel += imbalance * 2.5 * dt;
  p.swingVel += state.wind.dir * (state.wind.force / 100) * 0.8 * dt;
  p.swingVel += -p.swing * 6 * dt;      // 回摆
  p.swingVel *= Math.pow(0.4, dt);      // 阻尼
  p.swing += p.swingVel * dt;
  if (Math.abs(p.swing) > C.SWING_HIT && p.lift < 0.9) {
    hitRailing(state, '桥板摆动过大');
  }
}

function checkFastReel(state, side, name) {
  // 桥板接近桥面时收绳(收进)过快 -> 直接撞栏杆
  if (side.attached && side.reelVel > C.REEL_SAFE && state.plank.lift < 0.25) {
    hitRailing(state, name + '收绳过快');
  }
}

function updatePhase(state, dt) {
  var L = state.left, R = state.right, p = state.plank;
  switch (state.phase) {
    case 'APPROACH':
      if (nearDock(state)) {
        state.phase = 'ATTACH';
        logEvent(state, 'info', '平台就位,双方放绳挂钩');
      }
      break;
    case 'ATTACH':
      if (!L.attached && L.hookLen >= C.ATTACH_LEN && Math.abs(L.x - C.DOCK_L) <= C.DOCK_TOL) {
        L.attached = true; logEvent(state, 'info', '左侧吊钩已挂接桥板');
      }
      if (!R.attached && R.hookLen >= C.ATTACH_LEN && Math.abs(R.x - C.DOCK_R) <= C.DOCK_TOL) {
        R.attached = true; logEvent(state, 'info', '右侧吊钩已挂接桥板');
      }
      if (L.attached && R.attached) {
        state.phase = 'LIFT';
        logEvent(state, 'info', '双侧挂接完成,同步起吊旧桥板');
      }
      break;
    case 'LIFT': {
      var inL = Math.max(0, L.reelVel), inR = Math.max(0, R.reelVel);
      var rate = Math.min(inL, inR) / C.HOOK_MAX;
      p.lift = clamp(p.lift + rate * dt, 0, 1);
      updatePlankSwing(state, dt, (inL - inR) / C.REEL_SPEED);
      checkFastReel(state, L, '左侧'); checkFastReel(state, R, '右侧');
      if (p.lift >= 1) {
        p.kind = 'new';
        state.phase = 'PLACE';
        logEvent(state, 'info', '旧板吊出,新桥板就位,同步下放安装');
      }
      break;
    }
    case 'PLACE': {
      var outL = Math.max(0, -L.reelVel), outR = Math.max(0, -R.reelVel);
      var down = Math.min(outL, outR) / C.HOOK_MAX;
      p.lift = clamp(p.lift - down * dt, 0, 1);
      updatePlankSwing(state, dt, (outL - outR) / C.REEL_SPEED);
      // 下放末段(近桥面)任一端放绳过猛也会撞栏杆
      if (p.lift < 0.25 && p.lift > 0) {
        if (outL > C.REEL_SAFE) hitRailing(state, '左侧放绳过猛');
        if (outR > C.REEL_SAFE) hitRailing(state, '右侧放绳过猛');
      }
      if (p.lift <= 0) {
        L.attached = false; R.attached = false;
        state.phase = 'RETREAT';
        logEvent(state, 'info', '新桥板安装到位,脱钩并撤回平台');
      }
      break;
    }
    case 'RETREAT':
      if (L.x <= C.HOME_L + 4 && R.x >= C.HOME_R - 4 && L.hookLen < 2 && R.hookLen < 2) {
        state.phase = 'SUCCESS';
        state.replay.result = { ok: true, t: +state.time.toFixed(2) };
        logEvent(state, 'success', '双方安全撤回,桥板更换完成!');
      }
      break;
  }
}

function computeProgress(state) {
  var base = { APPROACH: 0, ATTACH: 15, LIFT: 30, PLACE: 55, RETREAT: 80, SUCCESS: 100, FAILED: state.progress };
  var p = base[state.phase];
  if (state.phase === 'APPROACH') {
    var d = (Math.abs(state.left.x - C.DOCK_L) + Math.abs(state.right.x - C.DOCK_R)) / 2;
    p = clamp(15 * (1 - d / 40), 0, 15);
  } else if (state.phase === 'ATTACH') {
    p = 15 + 7.5 * ((state.left.attached ? 1 : 0) + (state.right.attached ? 1 : 0));
  } else if (state.phase === 'LIFT') {
    p = 30 + 25 * state.plank.lift;
  } else if (state.phase === 'PLACE') {
    p = 55 + 25 * (1 - state.plank.lift);
  } else if (state.phase === 'RETREAT') {
    var dl = clamp((state.left.x - C.HOME_L) / (C.DOCK_L - C.HOME_L), 0, 1);
    var dr = clamp((C.HOME_R - state.right.x) / (C.HOME_R - C.DOCK_R), 0, 1);
    p = 80 + 20 * (1 - (dl + dr) / 2);
  }
  if (state.phase !== 'FAILED') state.progress = clamp(p, 0, 100);
}

function snapshot(state) {
  return {
    t: +state.time.toFixed(2),
    xL: +state.left.x.toFixed(2), xR: +state.right.x.toFixed(2),
    hookL: +state.left.hookLen.toFixed(2), hookR: +state.right.hookLen.toFixed(2),
    attL: state.left.attached, attR: state.right.attached,
    lift: +state.plank.lift.toFixed(3), swing: +state.plank.swing.toFixed(3),
    kind: state.plank.kind,
    wind: +state.wind.force.toFixed(1), wdir: state.wind.dir,
    stressL: Math.round(state.left.stress), stressR: Math.round(state.right.stress),
    tensionL: Math.round(state.left.tension), tensionR: Math.round(state.right.tension),
    wearL: Math.round(state.left.wear), wearR: Math.round(state.right.wear),
    integrity: Math.round(state.integrity),
    countdown: +state.countdown.toFixed(1),
    phase: state.phase, progress: Math.round(state.progress)
  };
}

/* 主更新:inputs = {left:{move,reel}, right:{move,reel}} */
function update(state, inputs, dt) {
  if (state.phase === 'SUCCESS' || state.phase === 'FAILED') return state;
  state.time += dt;
  state.countdown -= dt;
  if (state.countdown <= 0) {
    state.countdown = 0;
    fail(state, 'timeout', '倒计时结束,任务超时');
  }
  state.wind = windAt(state.time);
  updateSide(state, state.left, inputs.left, C.MIN_L, C.MAX_L, dt);
  updateSide(state, state.right, inputs.right, C.MIN_R, C.MAX_R, dt);
  updatePhase(state, dt);
  updateStress(state, dt);
  computeProgress(state);
  state._snapTimer += dt;
  if (state._snapTimer >= C.SNAP_DT || state.phase === 'SUCCESS' || state.phase === 'FAILED') {
    state._snapTimer -= C.SNAP_DT;
    if (state._snapTimer < 0 || state._snapTimer >= C.SNAP_DT) state._snapTimer = 0;
    state.replay.snapshots.push(snapshot(state));
  }
  return state;
}

var API = {
  C: C, PHASES: PHASES, PHASE_NAMES: PHASE_NAMES,
  createState: createState, update: update, mapKeys: mapKeys,
  snapshot: snapshot, windAt: windAt
};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
root.BridgeLogic = API;
})(typeof window !== 'undefined' ? window : globalThis);
