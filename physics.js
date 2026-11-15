/* 液压升降平台物理内核。
 * 纯函数 + 固定步长 + 无随机数，保证同参数重复运行结果一致。
 * 同时供浏览器(main.js)与 Node 验证脚本(test_sim.js)使用。
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.HydraSim = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const P = {
    g: 9.81,          // 重力加速度 m/s²
    Mp: 200,          // 平台质量 kg
    W: 2.0,           // 两缸间距 m
    I: 260,           // 平台转动惯量 kg·m²
    A: 0.008,         // 缸筒有效面积 m²
    stroke: 3.0,      // 缸行程 m
    V0: 0.002,        // 缸底死容积 m³
    beta: 4.0e7,      // 油液有效体积模量 Pa
    Kq: 3.0e-6,       // 阀流量系数 m³/s/√Pa
    pumpMax: 16e6,    // 泵压可调上限 Pa
    pMin: 0.05e6,     // 汽蚀压力下限 Pa
    loadDamp: 3.0,    // 负载滑动阻尼 1/s
    sMax: 1.0,        // 负载限位 m
    Cth: 3.0e4,       // 液压系统热容 J/°C
    coolK: 0.02,      // 散热系数 1/s
    tAmb: 20,         // 环境温度 °C
    lossFrac: 0.25,   // 泵功损耗转热比例
    dampY: 400,       // 垂向阻尼 N/(m/s)
    dampW: 40,        // 旋转阻尼 N·m/(rad/s)
  };

  // 安全限值：任一超出即冻结计算并记录触发点
  const LIMITS = {
    loadMax: 800,                 // kg
    pMax: 12e6,                   // Pa
    tMax: 80,                     // °C
    vMax: 1.5,                    // m/s
    thMax: 12 * Math.PI / 180,    // rad
    wMax: 1.2,                    // rad/s
  };

  const DT = 1 / 240;   // 固定物理子步长 s
  const SUBSTEPS = 4;   // 每帧(60Hz)子步数
  const FRAME_DT = DT * SUBSTEPS;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  const SCENARIOS = {
    normal:   { name: '正常工况', load: 300, s0: 0.15, targets: [1.0, 2.0, 2.6], script: 'auto' },
    extreme:  { name: '极限载荷', load: 850, s0: 0.0,  targets: [1.0, 2.0, 2.6], script: 'auto' },
    unstable: { name: '失稳工况', load: 300, s0: 0.85, targets: [1.0, 2.0, 2.6], script: 'unbalanced' },
  };

  function createState(scnId) {
    const scn = SCENARIOS[scnId] || SCENARIOS.normal;
    return {
      scn: SCENARIOS[scnId] ? scnId : 'normal',
      t: 0, y: 0, vy: 0, th: 0, w: 0,
      s: scn.s0, sv: 0,
      pL: P.pMin, pR: P.pMin, T: P.tAmb,
      load: scn.load,
      targets: scn.targets.slice(),
      targetIdx: 0, hold: 0,
      phase: 'lift',        // lift | return | success | failed
      event: null,          // 触发事件(含触发点快照)
      frames: 0,
    };
  }

  function snapshot(st) {
    return {
      t: st.t, y: st.y, vy: st.vy, th: st.th, w: st.w,
      s: st.s, sv: st.sv, pL: st.pL, pR: st.pR, T: st.T, load: st.load,
    };
  }

  function makeEvent(st, type, label) {
    return Object.assign({ type, label }, snapshot(st));
  }

  // 限值检查：返回触发事件或 null
  function checkLimits(st) {
    if (st.load > LIMITS.loadMax) return makeEvent(st, 'overload', '超载');
    if (st.pL > LIMITS.pMax || st.pR > LIMITS.pMax) return makeEvent(st, 'overpressure', '过压');
    if (st.T > LIMITS.tMax) return makeEvent(st, 'overheat', '过热');
    if (Math.abs(st.vy) > LIMITS.vMax) return makeEvent(st, 'overspeed', '超速');
    if (Math.abs(st.th) > LIMITS.thMax) return makeEvent(st, 'tilt', '失稳:倾斜超限');
    if (Math.abs(st.w) > LIMITS.wMax) return makeEvent(st, 'spin', '失稳:角速度超限');
    return null;
  }

  // 单个物理子步（半隐式欧拉）
  function substep(st, ctl, dt) {
    const halfW = P.W / 2;
    const sinT = Math.sin(st.th), cosT = Math.cos(st.th);
    const mTot = P.Mp + st.load;

    // 阀流量：正=泵向缸进油，负=缸经阀回油（泵压低于缸压时下降）
    function flow(valve, p) {
      const dp = ctl.pump - p;
      return valve * P.Kq * Math.sign(dp) * Math.sqrt(Math.abs(dp));
    }
    const qL = flow(ctl.valveL, st.pL);
    const qR = flow(ctl.valveR, st.pR);

    // 两侧缸杆位移/速度（由平台高度与倾角耦合）
    const xL = st.y - halfW * sinT, xR = st.y + halfW * sinT;
    const dxL = st.vy - halfW * cosT * st.w;
    const dxR = st.vy + halfW * cosT * st.w;

    // 油液可压缩性 → 压力更新
    const VL = P.V0 + P.A * Math.max(xL, 0);
    const VR = P.V0 + P.A * Math.max(xR, 0);
    st.pL = clamp(st.pL + dt * P.beta / VL * (qL - P.A * dxL), P.pMin, P.pumpMax * 1.2);
    st.pR = clamp(st.pR + dt * P.beta / VR * (qR - P.A * dxR), P.pMin, P.pumpMax * 1.2);

    // 缸推力
    const FL = st.pL * P.A * cosT;
    const FR = st.pR * P.A * cosT;

    // 垂向动力学
    const ay = (FL + FR - mTot * P.g - P.dampY * st.vy) / mTot;
    st.vy += ay * dt;
    st.y += st.vy * dt;

    // 转动动力学：缸力差矩 + 负载偏心重力矩（重心随负载移动）
    const torque = (FR - FL) * halfW - st.load * P.g * st.s * cosT - P.dampW * st.w;
    const I = P.I + st.load * st.s * st.s;
    st.w += torque / I * dt;
    st.th += st.w * dt;

    // 负载沿平台滑动（倾斜时重心改变）
    const sa = P.g * sinT - P.loadDamp * st.sv;
    st.sv += sa * dt;
    st.s += st.sv * dt;
    if (st.s > P.sMax) { st.s = P.sMax; if (st.sv > 0) st.sv = 0; }
    if (st.s < -P.sMax) { st.s = -P.sMax; if (st.sv < 0) st.sv = 0; }

    // 油温：泵功损耗加热 - 环境散热
    const heat = ctl.pump * (Math.abs(qL) + Math.abs(qR)) * P.lossFrac;
    st.T += (heat / P.Cth - P.coolK * (st.T - P.tAmb)) * dt;

    // 地面与行程软约束
    if (st.y < 0) { st.y = 0; if (st.vy < 0) st.vy = 0; }
    const maxSin = clamp(st.y / halfW, 0, 1);
    const sT = Math.sin(st.th);
    if (sT > maxSin) { st.th = Math.asin(maxSin); if (st.w > 0) st.w = 0; }
    else if (sT < -maxSin) { st.th = -Math.asin(maxSin); if (st.w < 0) st.w = 0; }
    const xLn = st.y - halfW * Math.sin(st.th);
    const xRn = st.y + halfW * Math.sin(st.th);
    if (xLn > P.stroke || xRn > P.stroke) {
      st.y = P.stroke - halfW * Math.abs(Math.sin(st.th));
      if (st.vy > 0) st.vy = 0;
    }

    st.t += dt;
  }

  // 推进一个显示帧（4 个子步），随后做限值检查与任务逻辑
  function frame(st, ctl) {
    if (st.event) return st;
    for (let i = 0; i < SUBSTEPS; i++) substep(st, ctl, DT);
    st.frames++;

    const ev = checkLimits(st);
    if (ev) { st.event = ev; st.phase = 'failed'; return st; }

    if (st.phase === 'lift') {
      const tgt = st.targets[st.targetIdx];
      if (Math.abs(st.y - tgt) < 0.05 && Math.abs(st.vy) < 0.12) {
        st.hold += FRAME_DT;
        if (st.hold >= 1.2) {
          st.targetIdx++;
          st.hold = 0;
          if (st.targetIdx >= st.targets.length) st.phase = 'return';
        }
      } else {
        st.hold = 0;
      }
    } else if (st.phase === 'return') {
      if (st.y <= 0.08 && Math.abs(st.vy) < 0.3) {
        st.phase = 'success';
        st.event = makeEvent(st, 'success', '任务成功:三个高度完成并安全回落');
      }
    }
    return st;
  }

  // 自动演示控制：跟踪目标高度 + 纠偏平衡
  function autoControl(st) {
    let pump, base;
    if (st.phase === 'return') {
      pump = 0.05e6;
      base = 0.85;
    } else {
      const tgt = st.targets[Math.min(st.targetIdx, st.targets.length - 1)];
      const err = tgt - st.y;
      // 连续调节：悬停压力约 0.35MPa，误差与速度反馈修正
      pump = clamp(0.35e6 + 6e6 * err - 2.5e6 * st.vy, 0.05e6, 8e6);
      base = clamp(0.25 + 0.5 * err - 0.3 * st.vy, 0.05, 0.9);
    }
    // th>0 表示右侧偏高 → 加大左阀、减小右阀纠偏
    const bal = clamp(3.0 * st.th + 1.0 * st.w, -0.45, 0.45);
    return {
      pump: pump,
      valveL: clamp(base + bal, 0, 1),
      valveR: clamp(base - bal, 0, 1),
    };
  }

  // 失稳工况脚本：左阀远大于右阀，压力失衡导致倾斜
  function unbalancedControl() {
    return { pump: 8e6, valveL: 0.9, valveR: 0.25 };
  }

  function scriptControl(st) {
    const scn = SCENARIOS[st.scn];
    if (scn && scn.script === 'unbalanced') return unbalancedControl(st);
    return autoControl(st);
  }

  return {
    P, LIMITS, DT, SUBSTEPS, FRAME_DT, SCENARIOS,
    clamp, createState, snapshot, frame, substep,
    autoControl, unbalancedControl, scriptControl,
  };
});
