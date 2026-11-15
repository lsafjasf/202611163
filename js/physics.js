/* 2D 翼型风洞物理引擎：纯函数式核心 + 确定性状态机，浏览器与 Node 通用。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WTPhysics = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- 固定几何与参考量（二维单位展长） ----
  var CHORD = 0.3;            // 弦长 m
  var SPAN = 1.0;             // 单位展长 m
  var AREA = CHORD * SPAN;    // 参考面积 m^2
  var DT = 0.02;              // 固定积分步长 s（暂停/单步与连续运行严格一致）
  var LAG_TAU = 0.12;         // 气动状态一阶滞后时间常数 s
  var R_AIR = 287.05;         // 空气气体常数 J/(kg·K)
  var MU0 = 1.716e-5;         // Sutherland 参考黏度 Pa·s
  var T0 = 273.15;
  var S_SUTH = 110.4;

  // ---- 安全上下限（超出即触发保护，停止积分） ----
  var LIMITS = {
    V:     { min: 5,   max: 80,   unit: 'm/s',  label: '风速' },
    alpha: { min: -25, max: 30,   unit: '°',    label: '迎角' },
    T:     { min: 253, max: 333,  unit: 'K',    label: '温度' },
    P:     { min: 60000, max: 110000, unit: 'Pa', label: '静压' },
    load:  { min: -600, max: 600, unit: 'N',    label: '单展载荷' }
  };

  var ALPHA_CRIT = 16;         // 临界迎角（失速触发角）
  var ALPHA_REATTACH = 12;     // 迟滞再附迎角
  var CL_SLOPE = 0.105;        // 线性段升力线斜率 /deg
  var CD0 = 0.012;             // 零升阻力系数
  var K_IND = 0.038;           // 诱导阻力因子
  var NOISE_SIGMA = 0.012;     // 传感器噪声相对标准差

  // ---- 确定性随机：mulberry32 + Box-Muller 高斯 ----
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gaussian(rng) {
    var u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function hashSeed(n) { return (n * 2654435761) >>> 0; }

  // ---- 大气与流场 ----
  function density(P, T) { return P / (R_AIR * T); }
  function viscosity(T) {
    return MU0 * Math.pow(T / T0, 1.5) * (T0 + S_SUTH) / (T + S_SUTH);
  }
  function reynolds(rho, V, T) {
    return rho * V * CHORD / Math.max(viscosity(T), 1e-9);
  }
  function dynamicPressure(rho, V) { return 0.5 * rho * V * V; }

  // ---- 风洞引擎：固定步长、确定性噪声、失速迟滞与保护触发 ----
  var MOUNT_KX = 8000, MOUNT_KY = 8000; // 弹性支架刚度 N/m，用于记录受力位置

  function WindTunnelEngine(opts) {
    opts = opts || {};
    this.baseSeed = (opts.seed >>> 0) || 20261116;
    this.noiseEnabled = opts.noiseEnabled !== false;
    this._initialParams = { V: 30, alpha: 4, T: 293.15, P: 101325 };
    this.reset();
  }

  WindTunnelEngine.prototype.reset = function () {
    var p = this._initialParams;
    this.params = { V: p.V, alpha: p.alpha, T: p.T, P: p.P };
    this.t = 0;
    this.step = 0;
    this.eff = { V: p.V, alpha: p.alpha, cl: 0, cd: 0 };
    this.stalled = false;
    this.tripped = null;      // 非 null 时积分冻结
    this.events = [];         // 失速/再附/保护触发记录
    var rho0 = density(p.P, p.T);
    this.meas = {
      t: 0, step: 0, V: p.V, alpha: p.alpha, T: p.T, P: p.P,
      Tstag: p.T, rho: rho0, q: dynamicPressure(rho0, p.V),
      Re: reynolds(rho0, p.V, p.T),
      cl: 0, cd: 0, lift: 0, drag: 0, liftMeas: 0, dragMeas: 0,
      posX: 0, posY: 0, stalled: false, tripped: null
    };
    return this.snapshot();
  };

  WindTunnelEngine.prototype._zeroMeas = function () {
    return {
      t: 0, step: 0, V: 0, alpha: 0, T: 0, P: 0, rho: 0, q: 0, Re: 0,
      cl: 0, cd: 0, lift: 0, drag: 0, liftMeas: 0, dragMeas: 0,
      posX: 0, posY: 0, stalled: false, tripped: null
    };
  };

  // 设定目标工况；越界值不被静默钳制，而在下一步触发保护并记录触发点
  WindTunnelEngine.prototype.setTarget = function (key, value) {
    if (!(key in this.params)) return false;
    if (typeof value !== 'number' || !isFinite(value)) return false;
    this.params[key] = Number(value);
    return true;
  };
  WindTunnelEngine.prototype.setTargets = function (obj) {
    for (var k in obj) if (k in this.params) this.setTarget(k, obj[k]);
  };

  WindTunnelEngine.prototype._checkLimits = function (s) {
    var checks = [
      ['V', s.V], ['alpha', s.alpha], ['T', s.T], ['P', s.P],
      ['load', s.lift]
    ];
    for (var i = 0; i < checks.length; i++) {
      var key = checks[i][0], val = checks[i][1], lim = LIMITS[key];
      if (val < lim.min || val > lim.max) {
        return {
          channel: key, value: val, limit: lim,
          t: this.t, step: this.step,
          position: { x: s.posX, y: s.posY },
          V: s.V, alpha: s.alpha, P: s.P, T: s.T,
          q: s.q, lift: s.lift, drag: s.drag, Re: s.Re
        };
      }
    }
    return null;
  };

  function aeroTargets(alpha, stalled) {
    var rad = alpha * Math.PI / 180;
    var clTarget, cdTarget;
    if (!stalled) {
      clTarget = CL_SLOPE * alpha;
      var cl2 = clTarget * clTarget;
      cdTarget = CD0 + K_IND * cl2;
    } else {
      clTarget = 1.2 * Math.sin(2 * rad) * Math.cos(rad);
      cdTarget = CD0 + 0.028 * Math.abs(alpha) + 0.62 * Math.sin(rad) * Math.sin(rad);
    }
    return { cl: clTarget, cd: cdTarget };
  }

  // 单个固定步长：暂停后的单步与连续运行调用完全相同的函数，物理状态必然一致
  WindTunnelEngine.prototype.advance = function () {
    if (this.tripped) return this.snapshot();

    // 1) 目标量一阶滞后（迎角机构与流场建立过程）
    var k = 1 - Math.exp(-DT / LAG_TAU);
    this.eff.V += (this.params.V - this.eff.V) * k;
    this.eff.alpha += (this.params.alpha - this.eff.alpha) * k;

    // 2) 失速状态机：越过临界角突降，降低到再配角才恢复（迟滞）
    var prevStalled = this.stalled;
    if (!this.stalled && this.eff.alpha > ALPHA_CRIT) this.stalled = true;
    else if (this.stalled && this.eff.alpha < ALPHA_REATTACH) this.stalled = false;

    // 3) 系数目标 + 一阶平滑，保证回放/连续两种方式状态不跳变
    var tgt = aeroTargets(this.eff.alpha, this.stalled);
    this.eff.cl += (tgt.cl - this.eff.cl) * k;
    this.eff.cd += (tgt.cd - this.eff.cd) * k;

    // 4) 大气、动压、雷诺数与力
    var rho = density(this.params.P, this.params.T);
    var q = dynamicPressure(rho, this.eff.V);
    var Re = reynolds(rho, this.eff.V, this.params.T);
    var lift = q * AREA * this.eff.cl;
    var drag = q * AREA * this.eff.cd;

    // 5) 确定性传感器噪声：种子只由 (baseSeed, step) 决定，可精确复现
    var rng = mulberry32(hashSeed(this.baseSeed + this.step * 1013));
    var nl = this.noiseEnabled ? gaussian(rng) * NOISE_SIGMA * Math.abs(lift) : 0;
    var nd = this.noiseEnabled ? gaussian(rng) * NOISE_SIGMA * Math.abs(drag) : 0;

    // 6) 弹性支架变形（受力位置记录，单位 m），与载荷同相位、无漂移
    var posX = drag / MOUNT_KX, posY = lift / MOUNT_KY;
    var Tstag = this.params.T * (1 + 0.2 * (this.eff.V / 340) * (this.eff.V / 340));

    var nextStep = this.step + 1;
    var s = {
      t: nextStep * DT, step: nextStep,
      V: this.eff.V, alpha: this.eff.alpha,
      T: this.params.T, P: this.params.P, Tstag: Tstag,
      rho: rho, q: q, Re: Re,
      cl: this.eff.cl, cd: this.eff.cd,
      lift: lift, drag: drag,
      liftMeas: lift + nl, dragMeas: drag + nd,
      posX: posX, posY: posY,
      stalled: this.stalled, tripped: null
    };

    // 7) 保护检查：超限即冻结并记录触发点，不再继续积分
    var trip = this._checkLimits(s);
    if (trip) {
      this.tripped = trip;
      s.tripped = trip;
      this.events.push({ kind: 'trip', at: this.step + 1, detail: trip });
    }
    if (this.stalled !== prevStalled) {
      this.events.push({
        kind: this.stalled ? 'stall' : 'reattach',
        at: this.step + 1,
        alpha: s.alpha, V: s.V, q: s.q, lift: s.lift, drag: s.drag,
        Re: s.Re, T: s.T, P: s.P, position: { x: posX, y: posY }
      });
    }

    this.meas = s;
    this.t = s.t;
    this.step = nextStep;
    return this.snapshot();
  };

  // 深拷贝快照，供回放/历史缓冲使用（回放恢复的状态与现场完全一致）
  WindTunnelEngine.prototype.snapshot = function () {
    return JSON.parse(JSON.stringify(this.meas));
  };
  WindTunnelEngine.restoreSnapshot = function (snap) {
    return JSON.parse(JSON.stringify(snap));
  };

  return {
    CHORD: CHORD, AREA: AREA, DT: DT, LAG_TAU: LAG_TAU,
    MOUNT_KX: MOUNT_KX, MOUNT_KY: MOUNT_KY,
    LIMITS: LIMITS, ALPHA_CRIT: ALPHA_CRIT, ALPHA_REATTACH: ALPHA_REATTACH,
    CL_SLOPE: CL_SLOPE, CD0: CD0, K_IND: K_IND, NOISE_SIGMA: NOISE_SIGMA,
    mulberry32: mulberry32, gaussian: gaussian, hashSeed: hashSeed,
    density: density, viscosity: viscosity, reynolds: reynolds,
    dynamicPressure: dynamicPressure,
    aeroTargets: aeroTargets, WindTunnelEngine: WindTunnelEngine
  };
});
