/* 双人协作摄影机 —— 纯逻辑引擎（浏览器与 Node 通用）
 * 左玩家：云台（构图）  右玩家：对焦 + 曝光
 * 共享状态：胶片、得分、倒计时、事件/回放日志
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CameraEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var WORLD = { w: 1000, h: 600 };          // 场景坐标系
  var FRAME = { w: 220, h: 150 };           // 构图框尺寸
  var FOCUS_MIN = 1, FOCUS_MAX = 20;        // 对焦距离（米）
  var EXPO_MIN = -3, EXPO_MAX = 3;          // 曝光补偿（EV）
  var FOCUS_TOL = 0.8;                      // 对焦容差
  var EXPO_TOL = 0.45;                      // 曝光容差
  var START_FILM = 6;
  var PHOTOS_TO_WIN = 3;
  var TIME_LIMIT = 120000;                  // 倒计时（毫秒）

  var GIMBAL_SPEED = 260;                   // 像素/秒
  var FOCUS_SPEED = 3.2;                    // 米/秒
  var EXPO_SPEED = 1.6;                     // EV/秒

  // 亮度分区：暗 / 中 / 亮（按 x 坐标）
  function zoneBrightness(x) {
    if (x < WORLD.w * 0.33) return -1.6;
    if (x < WORLD.w * 0.66) return 0.2;
    return 1.8;
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function initialState() {
    return {
      status: 'running',            // running | paused | won | lost
      time: 0,
      timeLeft: TIME_LIMIT,
      film: START_FILM,
      score: 0,
      gimbal: { x: WORLD.w / 2, y: WORLD.h / 2 },
      focus: 10,
      exposure: 0,
      subject: { x: WORLD.w / 2, y: WORLD.h / 2, dist: 10, brightness: 0.2 },
      ready: { comp: false, focus: false, expo: false },
      lastShot: null,               // { ok, reasons, t }
      events: [],                   // 事件日志（含冲突）
      replay: [],                   // 每帧快照，用于回放
      shotCount: 0
    };
  }

  function createGame(options) {
    options = options || {};
    var state = initialState();
    var held = { left: {}, right: {} };     // 各侧按住的键
    var swapped = false;                    // 控制侧是否轮换
    var debugSolo = false;                  // 单人调试模式
    var archivedReplays = [];               // 重开后保留的历史回放
    var listeners = [];

    function emit(type, data) {
      var ev = { t: state.time, type: type };
      if (data) for (var k in data) ev[k] = data[k];
      state.events.push(ev);
      listeners.forEach(function (fn) { fn(ev); });
    }

    // 物理侧 -> 职责映射（轮换后交换）
    function domainOf(side) {
      var gimbalSide = swapped ? 'right' : 'left';
      return side === gimbalSide ? 'gimbal' : 'optics';
    }

    function updateSubject() {
      var t = state.time / 1000;
      var s = state.subject;
      s.x = WORLD.w / 2 + Math.sin(t * 0.55) * WORLD.w * 0.38;
      s.y = WORLD.h / 2 + Math.sin(t * 1.1) * WORLD.h * 0.18;
      s.dist = 10 + Math.sin(t * 0.7) * 4;
      s.brightness = zoneBrightness(s.x);
    }

    function updateReady() {
      var s = state.subject, g = state.gimbal;
      state.ready.comp =
        Math.abs(s.x - g.x) < FRAME.w / 2 - 20 &&
        Math.abs(s.y - g.y) < FRAME.h / 2 - 15;
      state.ready.focus = Math.abs(state.focus - s.dist) < FOCUS_TOL;
      state.ready.expo = Math.abs(state.exposure - s.brightness) < EXPO_TOL;
    }

    function applyHeld(dt) {
      var secs = dt / 1000;
      ['left', 'right'].forEach(function (side) {
        var h = held[side], dom = domainOf(side);
        var solo = debugSolo; // 调试模式：任意一侧可控制全部
        if (dom === 'gimbal' || solo) {
          if (h.panLeft) state.gimbal.x -= GIMBAL_SPEED * secs;
          if (h.panRight) state.gimbal.x += GIMBAL_SPEED * secs;
          if (h.panUp) state.gimbal.y -= GIMBAL_SPEED * secs;
          if (h.panDown) state.gimbal.y += GIMBAL_SPEED * secs;
        }
        if (dom === 'optics' || solo) {
          if (h.focusNear) state.focus -= FOCUS_SPEED * secs;
          if (h.focusFar) state.focus += FOCUS_SPEED * secs;
          if (h.expoDown) state.exposure -= EXPO_SPEED * secs;
          if (h.expoUp) state.exposure += EXPO_SPEED * secs;
        }
      });
      state.gimbal.x = clamp(state.gimbal.x, FRAME.w / 2, WORLD.w - FRAME.w / 2);
      state.gimbal.y = clamp(state.gimbal.y, FRAME.h / 2, WORLD.h - FRAME.h / 2);
      state.focus = clamp(state.focus, FOCUS_MIN, FOCUS_MAX);
      state.exposure = clamp(state.exposure, EXPO_MIN, EXPO_MAX);
    }

    function snapshot() {
      return {
        t: state.time,
        gimbal: { x: state.gimbal.x, y: state.gimbal.y },
        focus: state.focus,
        exposure: state.exposure,
        subject: { x: state.subject.x, y: state.subject.y, dist: state.subject.dist, brightness: state.subject.brightness },
        ready: { comp: state.ready.comp, focus: state.ready.focus, expo: state.ready.expo },
        film: state.film,
        score: state.score,
        timeLeft: state.timeLeft,
        status: state.status
      };
    }

    function tick(dt) {
      if (state.status !== 'running') return;
      state.time += dt;
      state.timeLeft = Math.max(0, state.timeLeft - dt);
      updateSubject();
      applyHeld(dt);
      updateReady();
      state.replay.push(snapshot());
      if (state.timeLeft <= 0 && state.score < PHOTOS_TO_WIN) {
        state.status = 'lost';
        emit('gameover', { reason: 'timeout', score: state.score });
      }
    }

    // 快门：任一玩家可触发；三项同时合格才成像，否则浪费一张胶片
    function shutter(side) {
      if (state.status !== 'running') return null;
      if (state.film <= 0) return null;
      state.film -= 1;
      state.shotCount += 1;
      var r = state.ready;
      var ok = r.comp && r.focus && r.expo;
      var reasons = [];
      if (!r.comp) reasons.push('comp');
      if (!r.focus) reasons.push('focus');
      if (!r.expo) reasons.push('expo');
      state.lastShot = { ok: ok, reasons: reasons, t: state.time, side: side };
      if (ok) {
        state.score += 1;
        emit('shot_ok', { side: side, score: state.score, film: state.film });
        if (state.score >= PHOTOS_TO_WIN) {
          state.status = 'won';
          emit('gameover', { reason: 'win', score: state.score });
        }
      } else {
        // 冲突事件：记录是哪一侧、哪些仪表未就绪
        emit('conflict', { side: side, reasons: reasons, film: state.film });
        if (state.film <= 0) {
          state.status = 'lost';
          emit('gameover', { reason: 'film', score: state.score });
        }
      }
      return state.lastShot;
    }

    var ACTIONS = ['panLeft', 'panRight', 'panUp', 'panDown',
      'focusNear', 'focusFar', 'expoDown', 'expoUp'];

    function setHeld(side, action, pressed) {
      if (ACTIONS.indexOf(action) < 0) return false;
      if (side !== 'left' && side !== 'right') return false;
      var before = held[side][action] || false;
      held[side][action] = !!pressed;
      if (before !== held[side][action]) {
        emit('input', { side: side, action: action, pressed: !!pressed });
      }
      return true;
    }

    function pressShutter(side) {
      if (side !== 'left' && side !== 'right') return null;
      return shutter(side);
    }

    function pause() {
      if (state.status === 'running') { state.status = 'paused'; emit('pause', {}); }
    }

    function resume() {
      if (state.status === 'paused') { state.status = 'running'; emit('resume', {}); }
    }

    function restart() {
      // 归档当前回放，保证至少保留一份完整回放
      if (state.replay.length > 0) {
        archivedReplays.push({ events: state.events, replay: state.replay });
        if (archivedReplays.length > 5) archivedReplays.shift();
      }
      state = initialState();
      held = { left: {}, right: {} };
      emit('restart', {});
    }

    function swapSides() {
      swapped = !swapped;
      held = { left: {}, right: {} }; // 防止换侧后按键卡住
      emit('swap', { swapped: swapped });
    }

    function toggleDebug() {
      debugSolo = !debugSolo;
      emit('debug', { debugSolo: debugSolo });
    }

    return {
      tick: tick,
      setHeld: setHeld,
      pressShutter: pressShutter,
      pause: pause,
      resume: resume,
      restart: restart,
      swapSides: swapSides,
      toggleDebug: toggleDebug,
      onEvent: function (fn) { listeners.push(fn); },
      getState: function () { return state; },
      isSwapped: function () { return swapped; },
      isDebugSolo: function () { return debugSolo; },
      domainOf: domainOf,
      getArchivedReplays: function () { return archivedReplays; },
      constants: {
        WORLD: WORLD, FRAME: FRAME,
        FOCUS_MIN: FOCUS_MIN, FOCUS_MAX: FOCUS_MAX,
        EXPO_MIN: EXPO_MIN, EXPO_MAX: EXPO_MAX,
        START_FILM: START_FILM, PHOTOS_TO_WIN: PHOTOS_TO_WIN,
        TIME_LIMIT: TIME_LIMIT
      }
    };
  }

  return { createGame: createGame };
});
