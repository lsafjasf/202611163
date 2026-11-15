/*
 * 双卷扬机确定性物理引擎（固定步长，无随机数、无时钟依赖）
 * 同一参数与同一输入序列重复运行，状态按位近似一致。
 * 可在浏览器（globalThis.WinchPhysics）与 Node（module.exports）中运行。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.WinchPhysics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const G = 9.81;                 // 重力加速度 m/s^2
  const SUB_DT = 1 / 240;         // 物理子步长 s
  const SUBS_PER_FRAME = 4;       // 每帧 4 子步 => 帧步长 1/60 s
  const FRAME_DT = SUB_DT * SUBS_PER_FRAME;

  // 合理上下限（超出即触发保护并冻结，不再继续计算）
  const LIMITS = {
    loadMin: 200, loadMax: 3000,        // 货箱质量 kg
    cwMin: 0, cwMax: 3000,              // 配重质量 kg
    speedMax: 12,                       // 卷筒角速度 rad/s
    tensionMax: 55000,                  // 绳索破断张力 N
    slackTrip: 0.35,                    // 松弛量超此值判定缠结 m
    tempMax: 120,                       // 电机/制动器温度上限 ℃
    tempAmbient: 25,
    pressureMax: 8.0,                   // 制动液压上限 MPa
    swingMax: 0.35,                     // 摆角上限 rad（失稳）
    wallX: 1.8,                         // 货箱侧边到滑轮中心的碰撞距离 m
    groundY: 11.0,                      // 地面（向下距离）m
    heightTol: 0.25,                    // 目标高度到位容差 m
    holdTime: 2.0                       // 稳定保持时间 s
  };

  const DEFAULT_PARAMS = [
    { name: 'A', load: 800, cw: 700, targetH: 6.0, lL0: 5.0, theta0: 0 },
    { name: 'B', load: 1400, cw: 1300, targetH: 9.0, lL0: 7.0, theta0: 0 }
  ];

  // 结构与传动参数
  const MECH = {
    pulleyY: 12.0,   // 滑轮离地高度 m（向下坐标原点）
    ropeTotal: 14.0, // 单台卷扬绳总长 m
    drumR: 0.25,     // 卷筒半径 m
    drumI: 120.0,    // 卷筒转动惯量 kg m^2（含减速系等效惯量）
    ropeK: 2.0e5,    // 绳轴向刚度 N/m（含弹性绳+卷筒等效柔度）
    ropeC: 4.0e4,    // 绳轴向阻尼 N s/m（3000kg 时阻尼比≈0.82）
    motorKp: 30000,  // 速度环比例增益 N m /(rad/s)
    torqueMax: 15000,// 电机最大转矩 N m
    powerMax: 30000, // 电机最大功率 W
    accelMax: 3.0,   // 命令角速度斜坡限速 rad/s^2
    brakeK: 5000,    // 制动转矩系数 N m / MPa
    heatC: 1500.0,   // 热容量 J/K（等效简化热模型）
    coolH: 8.0,      // 散热系数 W/K
    tensionSlew: 9.0e5 // 单步张力变化率上限 N/s（绳/缓冲器冲击软化）
  };

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  function makeHoist(p, idx) {
    const h = {
      index: idx,
      name: p.name,
      load: p.load,
      cw: p.cw,
      targetH: p.targetH,
      // 货箱摆（极坐标：l 为几何绳长，theta 为摆角，向右为正）
      l: p.lL0, lDot: 0,
      theta: p.theta0 || 0, thetaDot: 0,
      lL: p.lL0,   // 卷筒放出的载货侧自然绳长
      lC: MECH.ropeTotal - p.lL0,
      lCw: MECH.ropeTotal - p.lL0, // 配重侧几何绳长（独立动力学状态）
      lCwDot: 0,
      omega: 0,    // 卷筒角速度（放出为正）
      torque: 0, motorTorque: 0, brakeTorque: 0,
      temp: LIMITS.tempAmbient,
      pressure: 0,
      brakeOn: false,
      targetOmega: 0,
      holdT: 0,
      tripped: null,
      _autoBrake: false
    };
    // 静力平衡初始化：T=mg，按刚度反算初始伸长，避免开机冲击
    h.tensionL = h.load * G;
    h.tensionC = h.cw * G;
    h.l = h.lL + h.tensionL / MECH.ropeK;
    h.lCw = h.lC + h.tensionC / MECH.ropeK;
    h.slackL = 0; h.slackC = 0;
    return h;
  }

  function WinchSim(params) {
    this.params = (params && params.length === 2)
      ? params.map((p) => ({ ...p }))
      : DEFAULT_PARAMS.map((p) => ({ ...p }));
    this.reset();
  }

  WinchSim.prototype.reset = function () {
    this.time = 0;
    this.frame = 0;
    this.status = 'running'; // running | tripped | success
    this.trip = null;        // {hoist, code, msg, time, state}
    this.events = [];        // 变化/事件日志
    this.snapshots = [];     // 每帧关键状态，供回放
    this.inputLog = [];      // 每帧输入，供确定性复算
    this.hoists = this.params.map(makeHoist);
    this._pushSnapshot();
    return this;
  };

  // 每帧由 UI 调用；输入结构 { A:{targetOmega,brakeOn}, B:{...} }
  WinchSim.prototype.setInput = function (input) {
    this.pendingInput = input;
  };

  WinchSim.prototype.log = function (msg) {
    this.events.push({ time: round6(this.time), frame: this.frame, msg });
    if (this.events.length > 200) this.events.shift();
  };

  function round6(v) { return Math.round(v * 1e6) / 1e6; }

  // 单边弹簧-阻尼绳索：伸长才受力，松弛时张力为 0
  function ropeForce(ext, extDot) {
    if (ext <= 0) return { tension: 0, slack: -ext };
    const t = MECH.ropeK * ext + MECH.ropeC * extDot;
    return { tension: t > 0 ? t : 0, slack: 0 };
  }

  WinchSim.prototype.stepFrame = function (input) {
    if (input !== undefined) this.pendingInput = input;
    const inp = this.pendingInput || {
      A: { targetOmega: 0, brakeOn: true },
      B: { targetOmega: 0, brakeOn: true }
    };
    this.inputLog.push({ frame: this.frame, time: round6(this.time), input: cloneInput(inp) });
    if (this.status !== 'running') { this._pushSnapshot(); return; }

    for (let s = 0; s < SUBS_PER_FRAME; s++) {
      this._substep(inp);
      this.time += SUB_DT;
      if (this.status !== 'running') break;
    }
    this.frame += 1;
    this._updateSuccess();
    this._pushSnapshot();
  };

  function cloneInput(inp) {
    return {
      A: { targetOmega: inp.A.targetOmega, brakeOn: !!inp.A.brakeOn, hardBrake: !!inp.A.hardBrake },
      B: { targetOmega: inp.B.targetOmega, brakeOn: !!inp.B.brakeOn, hardBrake: !!inp.B.hardBrake }
    };
  }

  WinchSim.prototype._substep = function (inp) {
    for (const h of this.hoists) {
      if (h.tripped) continue;
      this._stepHoist(h, inp[h.name]);
      this._checkLimits(h);
      if (h.tripped) {
        this.status = 'tripped';
        this.trip = {
          hoist: h.name, code: h.tripped, time: round6(this.time),
          state: this._hoistState(h)
        };
        this.log(h.name + ' 触发保护: ' + h.tripped);
      }
    }
  };

  WinchSim.prototype._stepHoist = function (h, ctrl) {
    const rawTarget = clamp(ctrl.targetOmega, -LIMITS.speedMax, LIMITS.speedMax);
    // 命令斜坡限速，避免阶跃造成绳冲击
    const dOmegaMax = MECH.accelMax * SUB_DT;
    h.targetOmega += clamp(rawTarget - h.targetOmega, -dOmegaMax, dOmegaMax);
    h.brakeOn = !!ctrl.brakeOn;

    // --- 1. 先按当前几何与速度求两根绳的张力 ---
    const r = MECH.drumR;
    const extL = h.l - h.lL;
    const extLDot = h.lDot - r * h.omega;
    const rfL = ropeForce(extL, extLDot);
    const extC = h.lCw - h.lC;
    const extCDot = h.lCwDot - r * h.omega;
    const rfC = ropeForce(extC, extCDot);
    // 张力变化率限制：再张紧冲击由缓冲器/绳黏弹性吸收
    const slew = MECH.tensionSlew * SUB_DT;
    h.tensionL += clamp(rfL.tension - h.tensionL, -slew, slew);
    h.tensionC += clamp(rfC.tension - h.tensionC, -slew, slew);
    h.tensionL = Math.max(0, h.tensionL);
    h.tensionC = Math.max(0, h.tensionC);
    h.slackL = rfL.slack; h.slackC = rfC.slack;

    // --- 2. 卷筒动力学（速度环电机 + 制动），同子步张力反馈 ---
    const loadTau = r * (h.tensionL - h.tensionC);
    let tauMotor = 0;
    let tauBrake = 0;
    // 防松绳联锁：任一侧绳松弛且卷筒仍在收紧（omega<0 放出为正），
    // 立即抑制电机目标，防止再张紧冲击
    const slackNow = rfL.slack > 0.005 || rfC.slack > 0.005;
    const effectiveTarget = (slackNow && h.omega < 0) ? 0 : h.targetOmega;
    if (!h.brakeOn) {
      tauMotor = clamp(MECH.motorKp * (effectiveTarget - h.omega),
        -MECH.torqueMax, MECH.torqueMax);
      const pCap = Math.abs(h.omega) > 1e-6
        ? clamp(MECH.powerMax / Math.abs(h.omega), 0, MECH.torqueMax)
        : MECH.torqueMax;
      tauMotor = clamp(tauMotor, -pCap, pCap);
    } else {
      // 正常制动目标 4MPa；强制动(hard)目标 9MPa，越过 8MPa 上限触发过压保护
      const pTarget = ctrl.hardBrake ? 9.0 : 4.0;
      h.pressure = clamp(h.pressure + (pTarget - h.pressure) *
        (1 - Math.exp(-SUB_DT * 8)), 0, 12);
      const brakeCap = MECH.brakeK * clamp(h.pressure, 0, LIMITS.pressureMax);
      if (Math.abs(h.omega) < 0.05) {
        // 静止/近静止：制动力矩恰好平衡净负载矩，避免符号翻转抖振
        tauBrake = clamp(-loadTau, -brakeCap, brakeCap);
        h.omega = 0;
      } else {
        tauBrake = -Math.sign(h.omega) * brakeCap;
      }
    }
    if (!h.brakeOn) h.pressure = Math.max(0, h.pressure * Math.exp(-SUB_DT * 10));
    h.motorTorque = tauMotor; h.brakeTorque = tauBrake;
    h.torque = tauMotor + tauBrake - loadTau;
    h.omega += (h.torque / MECH.drumI) * SUB_DT;
    if (h.brakeOn && Math.abs(h.omega) < 0.005) h.omega = 0;

    // 自然绳长由卷筒卷放决定，总长守恒
    h.lL += r * h.omega * SUB_DT;
    h.lL = clamp(h.lL, 0.5, MECH.ropeTotal - 0.5);
    h.lC = MECH.ropeTotal - h.lL;

    // --- 3. 货箱：极坐标摆（l, theta） ---
    const m = h.load;
    // 径向
    const lAcc = h.l * h.thetaDot * h.thetaDot + G * Math.cos(h.theta) - h.tensionL / m;
    h.lDot += lAcc * SUB_DT;
    h.l += h.lDot * SUB_DT;
    // 切向（小角度线性阻尼代表空气阻力）
    const thAcc = -(G / h.l) * Math.sin(h.theta) - (2 * h.lDot / h.l) * h.thetaDot
      - 0.05 * h.thetaDot;
    h.thetaDot += thAcc * SUB_DT;
    h.theta += h.thetaDot * SUB_DT;
    if (!Number.isFinite(h.l) || !Number.isFinite(h.lDot) ||
        !Number.isFinite(h.theta) || !Number.isFinite(h.thetaDot)) {
      this.log(h.name + ' 检测到非有限状态，已钳制');
      h.l = Number.isFinite(h.l) ? h.l : h.lL;
      h.lDot = Number.isFinite(h.lDot) ? h.lDot : 0;
      h.theta = Number.isFinite(h.theta) ? h.theta : 0;
      h.thetaDot = Number.isFinite(h.thetaDot) ? h.thetaDot : 0;
    }

    // --- 4. 配重：垂直单边绳，独立位置状态 lCw ---
    const cwAcc = G - h.tensionC / h.cw;
    h.lCwDot += cwAcc * SUB_DT;
    h.lCw += h.lCwDot * SUB_DT;
    // 配重被绳总长约束在 [0.5, ropeTotal-0.5]，触界速度归零，杜绝 NaN 扩散
    if (h.lCw < 0.5) { h.lCw = 0.5; h.lCwDot = Math.max(0, h.lCwDot); }
    if (h.lCw > MECH.ropeTotal - 0.5) {
      h.lCw = MECH.ropeTotal - 0.5;
      h.lCwDot = Math.min(0, h.lCwDot);
    }
    if (!Number.isFinite(h.lCw)) { h.lCw = h.lC; h.lCwDot = 0; }
    if (!Number.isFinite(h.lCwDot)) h.lCwDot = 0;

    // --- 5. 热模型：电机焦耳热 + 制动摩擦热，被动散热 ---
    const heat = (Math.abs(tauMotor * h.omega) * 0.9
      + Math.abs(tauBrake * h.omega)) / MECH.heatC;
    const cool = MECH.coolH * (h.temp - LIMITS.tempAmbient) / MECH.heatC;
    h.temp += (heat - cool) * SUB_DT;
    if (h.temp < LIMITS.tempAmbient) h.temp = LIMITS.tempAmbient;
  };

  WinchSim.prototype._checkLimits = function (h) {
    const trip = (code) => { if (!h.tripped) h.tripped = code; };
    if (h.tensionL > LIMITS.tensionMax || h.tensionC > LIMITS.tensionMax) trip('ROPE_BREAK');
    if (h.slackL > LIMITS.slackTrip || h.slackC > LIMITS.slackTrip) trip('ROPE_TANGLE');
    if (Math.abs(h.theta) > LIMITS.swingMax) trip('SWING_UNSTABLE');
    if (Math.abs(h.omega) > LIMITS.speedMax * 1.02) trip('OVER_SPEED');
    if (h.temp > LIMITS.tempMax) trip('OVER_TEMP');
    if (h.pressure > LIMITS.pressureMax) trip('OVER_PRESSURE');
    const x = h.l * Math.sin(h.theta);
    if (Math.abs(x) > LIMITS.wallX) trip('WALL_HIT');
    if (h.l > LIMITS.groundY) trip('GROUND_HIT');
  };

  WinchSim.prototype._updateSuccess = function () {
    if (this.status !== 'running') return;
    let allOk = true;
    for (const h of this.hoists) {
      const height = MECH.pulleyY - h.l; // 离地高度
      const inPlace = Math.abs(height - h.targetH) <= LIMITS.heightTol;
      const steady = Math.abs(h.lDot) < 0.05 && Math.abs(h.thetaDot) < 0.05 &&
        Math.abs(h.omega) < 0.05;
      if (inPlace && steady && h.brakeOn) { h.holdT += FRAME_DT; } else { h.holdT = 0; }
      if (h.holdT < LIMITS.holdTime) allOk = false;
    }
    if (allOk) {
      this.status = 'success';
      this.log('两台卷扬均到位并稳定保持，任务成功');
    }
  };

  WinchSim.prototype._hoistState = function (h) {
    const x = h.l * Math.sin(h.theta);
    const yDown = h.l * Math.cos(h.theta);
    return {
      name: h.name,
      x: round6(x),
      y: round6(MECH.pulleyY - yDown),           // 离地高度
      vx: round6(h.lDot * Math.sin(h.theta) + h.l * h.thetaDot * Math.cos(h.theta)),
      vy: round6(-(h.lDot * Math.cos(h.theta) - h.l * h.thetaDot * Math.sin(h.theta))),
      theta: round6(h.theta), thetaDot: round6(h.thetaDot),
      l: round6(h.l), lDot: round6(h.lDot),
      omega: round6(h.omega),
      tensionL: round6(h.tensionL), tensionC: round6(h.tensionC),
      slackL: round6(h.slackL), slackC: round6(h.slackC),
      temp: round6(h.temp), pressure: round6(h.pressure),
      torque: round6(h.torque),
      targetOmega: round6(h.targetOmega), brakeOn: h.brakeOn,
      targetH: h.targetH, holdT: round6(h.holdT),
      tripped: h.tripped
    };
  };

  WinchSim.prototype._pushSnapshot = function () {
    this.snapshots.push({
      frame: this.frame,
      time: round6(this.time),
      status: this.status,
      hoists: this.hoists.map((h) => this._hoistState(h)),
      trip: this.trip ? JSON.parse(JSON.stringify(this.trip)) : null
    });
    if (this.snapshots.length > 6000) this.snapshots.shift();
  };

  WinchSim.prototype.snapshot = function () {
    return this.snapshots[this.snapshots.length - 1];
  };

  // 用已记录输入序列完整复算，验证确定性（返回新仿真实例）
  WinchSim.prototype.rerun = function () {
    const sim2 = new WinchSim(this.params);
    for (const rec of this.inputLog) {
      sim2.stepFrame(rec.input);
      if (sim2.status !== 'running') break;
    }
    return sim2;
  };

  // 内置保守自动控制律：位置误差 + 径向速度阻尼，死区内制动
  WinchSim.prototype.autopilotInput = function (opts) {
    const o = opts || {};
    const kp = o.kp != null ? o.kp : 0.9;
    const kd = o.kd != null ? o.kd : 2.0;
    const vmax = o.vmax != null ? o.vmax : 2.2;
    const dead = o.dead != null ? o.dead : 0.15;
    const inp = {};
    for (const h of this.hoists) {
      const lStar = MECH.pulleyY - h.targetH;
      const e = lStar - h.l;
      // 滞回：进入制动后，误差不超过 dead 的 1.6 倍就保持制动
      if (!h._autoBrake) h._autoBrake = false;
      const enter = Math.abs(e) < dead && Math.abs(h.lDot) < 0.2;
      const stay = Math.abs(e) < dead * 1.6;
      h._autoBrake = enter || (h._autoBrake && stay);
      const near = h._autoBrake;
      const om = near ? 0 : clamp(kp * e - kd * h.lDot, -vmax, vmax);
      inp[h.name] = { targetOmega: om, brakeOn: near };
    }
    return inp;
  };

  return { G, SUB_DT, FRAME_DT, SUBS_PER_FRAME, LIMITS, MECH, DEFAULT_PARAMS, clamp, WinchSim };
});
