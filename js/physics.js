/* Pure deterministic physics kernel for the gyroscope balancing simulator.
 * No DOM access here so the same code runs in the browser and under Node. */
(function (root, factory) {
  const api = factory(typeof require === "function" ? require("./rng.js") : root.GyroRNG);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.GyroPhysics = api;
  }
})(typeof self !== "undefined" ? self : this, function (RNG) {
  "use strict";

  const DT = 0.0005; // fixed integration step, 2 kHz (RK4 stability)
  const DISPLAY_HZ = 50;
  const STEPS_PER_FRAME = Math.round(1 / DT / DISPLAY_HZ);

  const G = 9.81;
  const L = 0.45; // pivot -> center of mass (m)
  const K_I1 = 0.6; // transverse inertia per kg: I1 = K_I1 * m
  const K_I3 = 0.05; // spin-axis inertia per kg: I3 = K_I3 * m
  const BEARING_B = 0.012; // transverse bearing damping (N*m*s/rad)
  const SPIN_B = 0.0016; // spin friction coefficient (N*m*s/rad)
  const ACT_TAU = 0.015; // actuator first-order lag (s)
  const MOTOR_TAU = 0.5; // spin motor time constant (s)
  const MOTOR_TMAX = 2.2; // max motor torque (N*m)
  const BEARING_AREA = 3e-5; // bearing contact area (m^2)
  const K_TILT_LOAD = 2.5; // pressure rise from tilt
  const K_SPIN_LOAD = 4.5e-4; // pressure rise from spin
  const C_TH = 42; // thermal capacity (J/K)
  const K_COOL = 4; // cooling conductance (W/K)
  const MOTOR_HEAT = 0.25; // fraction of motor work becoming heat
  const K_LOAD_HEAT = 2e-4; // load-dependent bearing heat coeff
  const T_ENV = 25;
  const NOISE_AMP = 0.04; // continuous disturbance torque (N*m)
  const IMPULSE_INTERVAL = 4.0; // mean interval between impulses (s)
  const IMPULSE_MAG = 0.45; // base impulse magnitude (N*m)
  const IMPULSE_DUR = 0.05; // impulse duration (s)
  const HOLD_TOL = 0.05; // tilt considered "on target" (rad)
  const HOLD_TIME = 10.0; // required hold duration (s)

  const LIMITS = {
    m: { min: 0.8, max: 2.0, unit: "kg", label: "负载质量" },
    wsCmd: { min: 120, max: 420, unit: "rad/s", label: "转速指令" },
    biasX: { min: -1.5, max: 1.5, unit: "N*m", label: "X 轴偏置" },
    biasY: { min: -1.5, max: 1.5, unit: "N*m", label: "Y 轴偏置" },
    biasZ: { min: -1.5, max: 1.5, unit: "N*m", label: "Z 轴偏置" },
    kp: { min: 0, max: 30, unit: "N*m/rad", label: "比例增益" },
    kd: { min: 0, max: 12, unit: "N*m*s/rad", label: "微分增益" },
    tilt: { min: -0.35, max: 0.35, unit: "rad", label: "倾角" },
    spin: { min: 55, max: 460, unit: "rad/s", label: "实际转速" },
    temp: { min: 0, max: 90, unit: "°C", label: "温度" },
    pressure: { min: 0, max: 3.0e6, unit: "Pa", label: "轴承压力" }
  };

  const DEFAULTS = {
    m: 1.0,
    wsCmd: 320,
    biasX: 0,
    biasY: 0,
    biasZ: 0,
    kp: 8,
    kd: 4,
    seed: 20261116
  };

  function clamp(x, lo, hi) {
    return Math.min(hi, Math.max(lo, x));
  }

  /* Validate user set-points. Returns {ok, violations:[{key,value,limit}]}. */
  function validateParams(p) {
    const violations = [];
    Object.keys(LIMITS).forEach((key) => {
      if (!(key in p)) return;
      const lim = LIMITS[key];
      const v = p[key];
      if (typeof v !== "number" || Number.isNaN(v) || v < lim.min || v > lim.max) {
        violations.push({ key, value: v, min: lim.min, max: lim.max, label: lim.label, unit: lim.unit });
      }
    });
    return { ok: violations.length === 0, violations };
  }

  function freshState(p) {
    return {
      t: 0,
      qx: 0,
      qy: 0,
      wx: 0,
      wy: 0,
      ws: Math.max(p.wsCmd * 0.75, LIMITS.spin.min + 5), // spin-up begins below target
      trqX: 0, // lagged applied transverse torque
      trqY: 0,
      trqZ: 0,
      motorT: 0,
      temp: T_ENV,
      pressure: 0,
      tilt: 0,
      hold: 0,
      lastImpulse: -99
    };
  }

  function snapshot(s) {
    const st = s.state;
    return {
      t: st.t,
      qx: st.qx,
      qy: st.qy,
      wx: st.wx,
      wy: st.wy,
      ws: st.ws,
      trqX: st.trqX,
      trqY: st.trqY,
      trqZ: st.trqZ,
      motorT: st.motorT,
      temp: st.temp,
      pressure: st.pressure,
      tilt: st.tilt,
      hold: st.hold
    };
  }

  class Simulation {
    constructor(params) {
      this.c = this.constructor._c;
      this.params = Object.assign({}, DEFAULTS, params);
      this.reset(this.params);
    }

    reset(params) {
      if (params) this.params = Object.assign({}, this.params, params);
      const p = this.params;
      this.rng = RNG.mulberry32(p.seed);
      this.stepCount = 0;
      this.state = freshState(p);
      this.status = "running"; // running | tripped | success
      this.event = null;
      this.impulse = { x: 0, y: 0, remaining: 0 };
      this.history = [snapshot(this)];
      this.log = [
        {
          t: 0,
          kind: "init",
          msg: `初始化: 质量 ${p.m} kg, 目标转速 ${p.wsCmd} rad/s`,
          snap: snapshot(this)
        }
      ];
      return this.state;
    }

    get I1() {
      return this.c.K_I1 * this.params.m;
    }

    get I3() {
      return this.c.K_I3 * this.params.m;
    }

    /* Disturbance: bounded white torque + scheduled random impulses. */
    _disturbance(st) {
      const n1 = this.rng() * 2 - 1;
      const n2 = this.rng() * 2 - 1;
      const roll = this.rng();
      const dirRoll = this.rng();
      let dx = this.c.NOISE_AMP * n1;
      let dy = this.c.NOISE_AMP * n2;
      if (
        st.t - st.lastImpulse > this.c.IMPULSE_INTERVAL &&
        roll < 0.25
      ) {
        const ang = dirRoll * Math.PI * 2;
        this.impulse = {
          x: this.c.IMPULSE_MAG * Math.cos(ang),
          y: this.c.IMPULSE_MAG * Math.sin(ang),
          remaining: this.c.IMPULSE_DUR
        };
        st.lastImpulse = st.t;
        this.log.push({
          t: st.t,
          kind: "impulse",
          msg: `外部冲击 (${this.impulse.x.toFixed(2)}, ${this.impulse.y.toFixed(2)}) N*m`,
          snap: snapshot(this)
        });
      }
      if (this.impulse.remaining > 0) {
        dx += this.impulse.x;
        dy += this.impulse.y;
        this.impulse.remaining -= this.c.DT;
      }
      return { dx, dy };
    }

    _checkLimits(st) {
      const checks = [
        ["tilt", st.tilt, "姿态超限: 倾斜过大"],
        ["spin", st.ws, "转速越限"],
        ["temp", st.temp, "温度越限"],
        ["pressure", st.pressure, "轴承压力越限"]
      ];
      for (const [key, value, msg] of checks) {
        const lim = LIMITS[key];
        if (value < lim.min || value > lim.max) {
          return { key, value, limit: lim, msg };
        }
      }
      return null;
    }

    /* Continuous dynamics RHS. y = [qx,qy,wx,wy,ws,trqX,trqY,temp]. */
    _derivs(y, dist) {
      const c = this.c;
      const p = this.params;
      const I1 = this.I1;
      const I3 = this.I3;
      const [qx, qy, wx, wy, ws, trqX, trqY, temp] = y;

      const cmdX = -p.kp * qx - p.kd * wx + p.biasX;
      const cmdY = -p.kp * qy - p.kd * wy + p.biasY;
      const dTrqX = (cmdX - trqX) / c.ACT_TAU;
      const dTrqY = (cmdY - trqY) / c.ACT_TAU;

      const motorT = clamp(
        (p.wsCmd - ws) * (I3 / c.MOTOR_TAU),
        -c.MOTOR_TMAX,
        c.MOTOR_TMAX
      );
      const dSpin = (motorT + p.biasZ - c.SPIN_B * ws) / I3;

      const gmL = c.G * p.m * c.L;
      const ax =
        (gmL * qx + I3 * ws * wy - c.BEARING_B * wx + trqX + dist.dx) / I1;
      const ay =
        (gmL * qy - I3 * ws * wx - c.BEARING_B * wy + trqY + dist.dy) / I1;

      const heat =
        c.MOTOR_HEAT * Math.abs(motorT * ws) +
        c.SPIN_B * ws * ws +
        c.K_LOAD_HEAT * p.m * ws * ws;
      const cool = c.K_COOL * (temp - c.T_ENV);
      const dTemp = (heat - cool) / c.C_TH;

      return [wx, wy, ax, ay, dSpin, dTrqX, dTrqY, dTemp];
    }

    step() {
      if (this.status !== "running") return this.state;
      const c = this.c;
      const st = this.state;
      const dt = c.DT;

      const dist = this._disturbance(st);
      const y0 = [
        st.qx,
        st.qy,
        st.wx,
        st.wy,
        st.ws,
        st.trqX,
        st.trqY,
        st.temp
      ];
      const k1 = this._derivs(y0, dist);
      const y2 = y0.map((v, i) => v + (k1[i] * dt) / 2);
      const k2 = this._derivs(y2, dist);
      const y3 = y0.map((v, i) => v + (k2[i] * dt) / 2);
      const k3 = this._derivs(y3, dist);
      const y4 = y0.map((v, i) => v + k3[i] * dt);
      const k4 = this._derivs(y4, dist);
      const y1 = y0.map(
        (v, i) => v + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i])
      );

      [
        st.qx,
        st.qy,
        st.wx,
        st.wy,
        st.ws,
        st.trqX,
        st.trqY,
        st.temp
      ] = y1;
      st.trqZ = this.params.biasZ;
      st.motorT = clamp(
        (this.params.wsCmd - st.ws) * (this.I3 / c.MOTOR_TAU),
        -c.MOTOR_TMAX,
        c.MOTOR_TMAX
      );
      st.t += dt;
      this.stepCount++;

      st.tilt = Math.hypot(st.qx, st.qy);
      const normal = this.params.m * c.G;
      const tiltLoad =
        c.K_TILT_LOAD * this.params.m * c.G * Math.abs(st.tilt);
      const spinLoad = c.K_SPIN_LOAD * st.ws * st.ws;
      st.pressure = (normal + tiltLoad + spinLoad) / c.BEARING_AREA;

      st.hold = st.tilt <= HOLD_TOL ? st.hold + dt : 0;

      const trip = this._checkLimits(st);
      if (trip) {
        this.status = "tripped";
        this.event = {
          t: st.t,
          kind: "trip",
          key: trip.key,
          value: trip.value,
          limit: trip.limit,
          msg: trip.msg,
          snap: snapshot(this)
        };
        this.log.push(this.event);
      } else if (st.hold >= HOLD_TIME) {
        this.status = "success";
        this.event = {
          t: st.t,
          kind: "success",
          msg: "目标姿态保持 10 秒，校准成功",
          snap: snapshot(this)
        };
        this.log.push(this.event);
      }

      if (this.stepCount % STEPS_PER_FRAME === 0) {
        this.history.push(snapshot(this));
      }
      return this.state;
    }

    advance(seconds) {
      const n = Math.max(0, Math.round(seconds / this.c.DT));
      for (let i = 0; i < n && this.status === "running"; i++) this.step();
      return this.state;
    }
  }
  Simulation._c = {
    DT,
    RNG,
    G,
    L,
    K_I1,
    K_I3,
    BEARING_B,
    SPIN_B,
    ACT_TAU,
    MOTOR_TAU,
    MOTOR_TMAX,
    BEARING_AREA,
    K_TILT_LOAD,
    K_SPIN_LOAD,
    C_TH,
    K_COOL,
    MOTOR_HEAT,
    K_LOAD_HEAT,
    T_ENV,
    NOISE_AMP,
    IMPULSE_INTERVAL,
    IMPULSE_MAG,
    IMPULSE_DUR
  };

  return {
    DT,
    DISPLAY_HZ,
    STEPS_PER_FRAME,
    LIMITS,
    DEFAULTS,
    HOLD_TOL,
    HOLD_TIME,
    validateParams,
    clamp,
    freshState,
    snapshot,
    Simulation,
    _build: function () {
      return {
        RNG,
        G,
        L,
        K_I1,
        K_I3,
        BEARING_B,
        SPIN_B,
        ACT_TAU,
        MOTOR_TAU,
        MOTOR_TMAX,
        BEARING_AREA,
        K_TILT_LOAD,
        K_SPIN_LOAD,
        C_TH,
        K_COOL,
        MOTOR_HEAT,
        T_ENV,
        NOISE_AMP,
        IMPULSE_INTERVAL,
        IMPULSE_MAG,
        IMPULSE_DUR
      };
    }
  };
});
