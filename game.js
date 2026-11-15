// 双人协作长货叉车 - 核心逻辑（浏览器与 Node 通用）
(function (global) {
  'use strict';

  var CONFIG = {
    world: { w: 960, h: 640 },
    truck: {
      w: 46, h: 26, forkLen: 34,
      accel: 90, maxSpeed: 130, reverseMax: 60, friction: 0.92,
      steerRate: 2.4, maxSteer: 0.6
    },
    fork: { rate: 0.55, tiltRate: 1.6, pickupBand: 0.25, shelfBandLo: 0.3, shelfBandHi: 0.9 },
    physics: {
      liftCgThreshold: 0.85,   // 重心因子超过则后轮离地
      dropCgThreshold: 1.25,   // 超过则货箱滑落
      liftRecoverBelow: 0.6,
      wheelOffDropMs: 3000     // 后轮持续离地过久掉箱
    },
    box: { weight: 1.0, integrity: 100, dropDamage: 50 },
    task: { deliveriesToWin: 3, timeLimitMs: 240000 },
    shelves: [
      { x: 180, y: 120, w: 200, h: 40 },
      { x: 180, y: 300, w: 200, h: 40 },
      { x: 560, y: 120, w: 200, h: 40 },
      { x: 560, y: 300, w: 200, h: 40 }
    ],
    pickupStation: { x: 80, y: 520, w: 90, h: 70 },
    dropZone: { x: 800, y: 500, w: 110, h: 90 },
    start: { x: 480, y: 520, heading: -Math.PI / 2 }
  };

  function freshState() {
    return {
      phase: 'running',            // running | won | lost
      paused: false,
      debugSolo: false,            // 单人调试：一人可同时用两套键
      swapped: false,              // 控制侧轮换
      time: 0,
      timeLeft: CONFIG.task.timeLimitMs,
      truck: {
        x: CONFIG.start.x, y: CONFIG.start.y, heading: CONFIG.start.heading,
        speed: 0, steer: 0, rearWheelsOff: false, wheelOffMs: 0
      },
      fork: { h: 0, tilt: 0 },     // h:0..1 tilt:-1(后)..1(前)
      carrying: null,              // {id, integrity}
      boxes: [],                   // 地面上的箱子 {id,x,y,integrity,onPallet}
      nextBoxId: 1,
      stock: CONFIG.task.deliveriesToWin, // 取货站剩余
      delivered: 0,
      lost: 0,
      events: [],                  // {t,type,...}
      replay: [],                  // 帧快照
      collisionCooldown: 0
    };
  }

  // 键盘 -> 职责映射。driver: 行驶/转向, operator: 货叉升降/倾斜
  var DRIVER_KEYS = { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' };
  var OPERATOR_KEYS = { raise: 'ArrowUp', lower: 'ArrowDown', tiltBack: 'ArrowLeft', tiltFwd: 'ArrowRight' };
  // 换边后：方向键开车，WASD 操作货叉
  var OPERATOR_KEYS_AS_DRIVER = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
  var DRIVER_KEYS_AS_OPERATOR = { raise: 'KeyW', lower: 'KeyS', tiltBack: 'KeyA', tiltFwd: 'KeyD' };

  function nullAudio() {
    return { setEngine: function () {}, event: function () {}, reset: function () {} };
  }

  function createGame(opts) {
    opts = opts || {};
    var audio = opts.audio || nullAudio();
    var state = freshState();
    var keysDown = {};
    var lastReplay = null;         // 重开后保留上一份完整回放

    function emit(type, data) {
      var ev = { t: state.time, type: type };
      if (data) for (var k in data) ev[k] = data[k];
      state.events.push(ev);
      audio.event(type, ev);
      return ev;
    }

    // 根据 swapped / debugSolo 计算两个职责的输入
    function readInput() {
      function k(code) { return !!keysDown[code]; }
      var driverSet = state.swapped ? OPERATOR_KEYS_AS_DRIVER : DRIVER_KEYS;
      var operatorSet = state.swapped ? DRIVER_KEYS_AS_OPERATOR : OPERATOR_KEYS;
      var inp = {
        driver: {
          up: k(driverSet.up), down: k(driverSet.down),
          left: k(driverSet.left), right: k(driverSet.right)
        },
        operator: {
          raise: k(operatorSet.raise), lower: k(operatorSet.lower),
          tiltBack: k(operatorSet.tiltBack), tiltFwd: k(operatorSet.tiltFwd)
        }
      };
      if (state.debugSolo) {
        // 单人调试：两套键同时驱动两个职责（并集）
        inp.driver.up = inp.driver.up || k(DRIVER_KEYS.up) || k(OPERATOR_KEYS_AS_DRIVER.up);
        inp.driver.down = inp.driver.down || k(DRIVER_KEYS.down) || k(OPERATOR_KEYS_AS_DRIVER.down);
        inp.driver.left = inp.driver.left || k(DRIVER_KEYS.left) || k(OPERATOR_KEYS_AS_DRIVER.left);
        inp.driver.right = inp.driver.right || k(DRIVER_KEYS.right) || k(OPERATOR_KEYS_AS_DRIVER.right);
        inp.operator.raise = inp.operator.raise || k(OPERATOR_KEYS.raise) || k(DRIVER_KEYS_AS_OPERATOR.raise);
        inp.operator.lower = inp.operator.lower || k(OPERATOR_KEYS.lower) || k(DRIVER_KEYS_AS_OPERATOR.lower);
        inp.operator.tiltBack = inp.operator.tiltBack || k(OPERATOR_KEYS.tiltBack) || k(DRIVER_KEYS_AS_OPERATOR.tiltBack);
        inp.operator.tiltFwd = inp.operator.tiltFwd || k(OPERATOR_KEYS.tiltFwd) || k(DRIVER_KEYS_AS_OPERATOR.tiltFwd);
      }
      return inp;
    }

    // ---- 几何 ----
    function forkTip() {
      var t = state.truck;
      var d = CONFIG.truck.w / 2 + CONFIG.truck.forkLen;
      return { x: t.x + Math.cos(t.heading) * d, y: t.y + Math.sin(t.heading) * d };
    }

    function truckCorners() {
      var t = state.truck, hw = CONFIG.truck.w / 2, hh = CONFIG.truck.h / 2;
      var c = Math.cos(t.heading), s = Math.sin(t.heading);
      var pts = [];
      var local = [[hw, hh], [hw, -hh], [-hw, hh], [-hw, -hh]];
      for (var i = 0; i < local.length; i++) {
        pts.push({ x: t.x + local[i][0] * c - local[i][1] * s, y: t.y + local[i][0] * s + local[i][1] * c });
      }
      // 货叉尖端两个点（转弯扫掠区）
      var fd = CONFIG.truck.w / 2 + CONFIG.truck.forkLen;
      var fo = CONFIG.truck.h / 2 - 3;
      pts.push({ x: t.x + fd * c - fo * s, y: t.y + fd * s + fo * c });
      pts.push({ x: t.x + fd * c + fo * s, y: t.y + fd * s - fo * c });
      return pts;
    }

    function pointInRect(p, r) {
      return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
    }

    function hitShelf() {
      var pts = truckCorners();
      for (var i = 0; i < CONFIG.shelves.length; i++) {
        var r = CONFIG.shelves[i];
        for (var j = 0; j < pts.length; j++) {
          if (pointInRect(pts[j], r)) return { shelf: i, forkTipHit: j >= 4 };
        }
      }
      return null;
    }

    // 重心因子：载重 + 货叉高度 + 前倾 共同推高重心
    function cgFactor() {
      var load = state.carrying ? CONFIG.box.weight : 0;
      var tiltFwd = Math.max(0, state.fork.tilt);
      return load * (0.35 + 0.65 * state.fork.h) + tiltFwd * 0.5 * (load > 0 ? 1 : 0.4);
    }

    // ---- 主更新 ----
    function update(dtMs) {
      if (state.paused || state.phase !== 'running') return;
      var dt = dtMs / 1000;
      state.time += dtMs;
      state.timeLeft -= dtMs;
      if (state.timeLeft <= 0) {
        state.timeLeft = 0;
        state.phase = 'lost';
        emit('timeout', { delivered: state.delivered });
        return;
      }
      var inp = readInput();
      var t = state.truck;

      // 行驶与转向（驾驶员职责）
      if (inp.driver.up) t.speed += CONFIG.truck.accel * dt;
      if (inp.driver.down) t.speed -= CONFIG.truck.accel * dt;
      t.speed *= Math.pow(CONFIG.truck.friction, dt * 60);
      var maxS = state.carrying ? CONFIG.truck.maxSpeed * 0.8 : CONFIG.truck.maxSpeed;
      t.speed = Math.max(-CONFIG.truck.reverseMax, Math.min(maxS, t.speed));
      if (inp.driver.left) t.steer -= CONFIG.truck.steerRate * dt;
      if (inp.driver.right) t.steer += CONFIG.truck.steerRate * dt;
      if (!inp.driver.left && !inp.driver.right) t.steer *= Math.pow(0.8, dt * 60);
      t.steer = Math.max(-CONFIG.truck.maxSteer, Math.min(CONFIG.truck.maxSteer, t.steer));

      // 货叉升降与倾斜（操作员职责）
      var f = state.fork;
      if (inp.operator.raise) f.h += CONFIG.fork.rate * dt;
      if (inp.operator.lower) f.h -= CONFIG.fork.rate * dt;
      f.h = Math.max(0, Math.min(1, f.h));
      if (inp.operator.tiltFwd) f.tilt += CONFIG.fork.tiltRate * dt;
      if (inp.operator.tiltBack) f.tilt -= CONFIG.fork.tiltRate * dt;
      f.tilt = Math.max(-1, Math.min(1, f.tilt));

      // 重心 -> 后轮离地 / 掉箱
      var cg = cgFactor();
      var turningHard = Math.abs(t.steer) > 0.25 && Math.abs(t.speed) > 40;
      if (cg > CONFIG.physics.liftCgThreshold && (turningHard || cg > CONFIG.physics.dropCgThreshold)) {
        if (!t.rearWheelsOff) { t.rearWheelsOff = true; t.wheelOffMs = 0; emit('wheel_lift', { cg: cg }); }
      } else if (t.rearWheelsOff && cg < CONFIG.physics.liftRecoverBelow) {
        t.rearWheelsOff = false; t.wheelOffMs = 0; emit('wheel_recover', {});
      }
      if (t.rearWheelsOff) {
        t.wheelOffMs += dtMs;
        t.steer *= 0.2; // 后轮离地转向几乎失效
        // 重心极端时宽限较短，否则按长时限；给玩家恢复窗口
        var grace = cg > CONFIG.physics.dropCgThreshold ? 800 : CONFIG.physics.wheelOffDropMs;
        var shouldDrop = t.wheelOffMs > grace;
        if (shouldDrop && state.carrying) dropBox('wheel_lift');
      }

      // 位置积分 + 碰撞
      t.heading += t.steer * (t.speed / CONFIG.truck.maxSpeed) * dt * 2;
      var nx = t.x + Math.cos(t.heading) * t.speed * dt;
      var ny = t.y + Math.sin(t.heading) * t.speed * dt;
      var oldX = t.x, oldY = t.y;
      t.x = Math.max(20, Math.min(CONFIG.world.w - 20, nx));
      t.y = Math.max(20, Math.min(CONFIG.world.h - 20, ny));
      if (state.collisionCooldown > 0) state.collisionCooldown -= dtMs;
      var hit = hitShelf();
      if (hit && state.collisionCooldown <= 0) {
        t.x = oldX; t.y = oldY; t.speed = 0;
        state.collisionCooldown = 500;
        emit('collision', { shelf: hit.shelf, forkSweep: hit.forkTipHit, x: t.x, y: t.y });
        if (state.carrying && f.h > CONFIG.fork.shelfBandLo && f.h < CONFIG.fork.shelfBandHi) {
          dropBox('shelf_knock');
        }
      }

      handlePickupDeliver();
      updateAudio();
      recordFrame();
    }

    // ---- 装卸与掉箱 ----
    function dropBox(cause) {
      var box = state.carrying;
      if (!box) return;
      var tip = forkTip();
      box.integrity -= CONFIG.box.dropDamage;
      state.carrying = null;
      if (box.integrity <= 0) {
        state.lost++;
        emit('box_destroyed', { cause: cause, id: box.id, lost: state.lost });
        checkAllLost();
      } else {
        box.x = tip.x; box.y = tip.y; box.onPallet = false;
        state.boxes.push(box);
        emit('box_dropped', { cause: cause, id: box.id, integrity: box.integrity, x: tip.x, y: tip.y });
      }
    }

    function checkAllLost() {
      var remaining = state.stock + state.boxes.length + (state.carrying ? 1 : 0);
      if (remaining === 0 && state.delivered < CONFIG.task.deliveriesToWin) {
        state.phase = 'lost';
        emit('all_items_lost', { delivered: state.delivered });
      }
    }

    function handlePickupDeliver() {
      var f = state.fork, tip = forkTip(), t = state.truck;
      // 取货：货叉低位，叉尖触及取货站或地面箱子
      if (!state.carrying && f.h <= CONFIG.fork.pickupBand) {
        if (state.stock > 0 && pointInRect(tip, CONFIG.pickupStation)) {
          state.stock--;
          state.carrying = { id: state.nextBoxId++, integrity: CONFIG.box.integrity };
          emit('pickup', { id: state.carrying.id, stock: state.stock });
        } else {
          for (var i = 0; i < state.boxes.length; i++) {
            var b = state.boxes[i];
            var dx = b.x - tip.x, dy = b.y - tip.y;
            if (dx * dx + dy * dy < 24 * 24) {
              state.boxes.splice(i, 1);
              state.carrying = b;
              emit('repickup', { id: b.id, integrity: b.integrity });
              break;
            }
          }
        }
      }
      // 卸货：载货进入交付区且货叉放低
      if (state.carrying && f.h <= CONFIG.fork.pickupBand && pointInRect(tip, CONFIG.dropZone)) {
        var id = state.carrying.id;
        state.carrying = null;
        state.delivered++;
        emit('delivered', { id: id, delivered: state.delivered });
        if (state.delivered >= CONFIG.task.deliveriesToWin) {
          state.phase = 'won';
          emit('win', { time: state.time });
        }
      }
    }

    // ---- 音效参数：随速度/负载变化 ----
    function updateAudio() {
      var load = state.carrying ? CONFIG.box.weight : 0;
      audio.setEngine({
        rpm: Math.abs(state.truck.speed) / CONFIG.truck.maxSpeed,
        load: load * (0.5 + 0.5 * state.fork.h),
        rearWheelsOff: state.truck.rearWheelsOff
      });
    }

    // ---- 回放记录 ----
    function recordFrame() {
      var t = state.truck;
      state.replay.push({
        t: state.time, x: t.x, y: t.y, heading: t.heading,
        h: state.fork.h, tilt: state.fork.tilt,
        carrying: !!state.carrying, wheelsOff: t.rearWheelsOff,
        delivered: state.delivered, stock: state.stock, lost: state.lost
      });
    }

    // ---- 控制 ----
    function restart() {
      var finished = {
        frames: state.replay, events: state.events,
        phase: state.phase, duration: state.time, delivered: state.delivered
      };
      if (finished.frames.length > 0) lastReplay = finished; // 保留上一份完整回放
      var keepDebug = state.debugSolo, keepSwapped = state.swapped;
      var fresh = freshState();
      for (var k in fresh) state[k] = fresh[k];
      state.debugSolo = keepDebug; state.swapped = keepSwapped;
      keysDown = {};
      audio.reset();
      emit('restart', {});
    }

    function getDashboards() {
      var t = state.truck, f = state.fork;
      return {
        driver: {
          speed: t.speed, steer: t.steer,
          rearWheelsOff: t.rearWheelsOff, heading: t.heading
        },
        operator: {
          forkHeight: f.h, tilt: f.tilt,
          load: state.carrying ? CONFIG.box.weight : 0,
          boxIntegrity: state.carrying ? state.carrying.integrity : null
        },
        shared: {
          delivered: state.delivered, stock: state.stock, lost: state.lost,
          groundBoxes: state.boxes.length,
          timeLeft: state.timeLeft, phase: state.phase, paused: state.paused,
          cg: cgFactor()
        }
      };
    }

    return {
      state: state,
      CONFIG: CONFIG,
      update: update,
      forkTip: forkTip,
      cgFactor: cgFactor,
      restart: restart,
      getDashboards: getDashboards,
      togglePause: function () { if (state.phase === 'running') { state.paused = !state.paused; emit(state.paused ? 'pause' : 'resume', {}); } },
      toggleDebug: function () { state.debugSolo = !state.debugSolo; emit('debug_mode', { on: state.debugSolo }); },
      swapRoles: function () { state.swapped = !state.swapped; emit('swap_roles', { swapped: state.swapped }); },
      getReplay: function () { return { frames: state.replay, events: state.events, phase: state.phase, duration: state.time }; },
      setKey: function (code, down) { keysDown[code] = down; },
      clearKeys: function () { keysDown = {}; },
      emit: emit,
      readInput: readInput,
      getLastReplay: function () { return lastReplay; },
      setLastReplay: function (r) { lastReplay = r; },
      audio: audio
    };
  }

  global.ForkliftGame = { CONFIG: CONFIG, createGame: createGame, freshState: freshState };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.ForkliftGame;
})(typeof window !== 'undefined' ? window : globalThis);
