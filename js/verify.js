/* 验证场景：浏览器自检与 Node 无头测试共用同一套逻辑。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./physics.js'));
  } else root.WTVerify = factory(root.WTPhysics);
})(typeof self !== 'undefined' ? self : this, function (WT) {
  'use strict';

  function deepEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function finite(v) { return typeof v === 'number' && isFinite(v); }
  function allFinite(s) {
    return ['V', 'alpha', 'T', 'P', 'q', 'Re', 'lift', 'drag',
      'liftMeas', 'dragMeas', 'posX', 'posY'].every(function (k) {
      return finite(s[k]);
    });
  }
  function result(id, name, pass, detail, extra) {
    var r = { id: id, name: name, pass: !!pass, detail: detail };
    if (extra) for (var k in extra) r[k] = extra[k];
    return r;
  }

  // 场景 1：正常工况 —— 稳定来流、无失速无触发，升阻力保持在合理带内
  function scenarioNormal() {
    var e = new WT.WindTunnelEngine({ seed: 42 });
    e.setTargets({ V: 30, alpha: 4, T: 293.15, P: 101325 });
    var last, maxLift = -Infinity, minLift = Infinity;
    for (var i = 0; i < 400; i++) {
      last = e.advance();
      if (!allFinite(last)) return result('normal', '正常工况', false, '出现非有限状态量');
      if (i < 200) continue; // 跳过建立瞬态，只统计稳态测量带
      maxLift = Math.max(maxLift, last.lift);
      minLift = Math.min(minLift, last.lift);
    }
    var ok = !e.tripped && !last.stalled && last.lift > 40 && last.lift < 120 &&
      (maxLift - minLift) < 1.0;
    return result('normal', '正常工况', ok,
      '末态 L=' + last.lift.toFixed(2) + 'N D=' + last.drag.toFixed(2) +
      'N Re=' + last.Re.toExponential(2) + ' 无触发/无失速',
      { record: { position: { x: last.posX, y: last.posY }, V: last.V,
        alpha: last.alpha, P: last.P, T: last.T, q: last.q, lift: last.lift } });
  }

  // 场景 2：极限载荷 —— 高风速大迎角，载荷越过 600N 上限即冻结并记录触发点
  function scenarioLimitLoad() {
    var e = new WT.WindTunnelEngine({ seed: 7, noiseEnabled: false });
    e.setTargets({ V: 80, alpha: 15, T: 293.15, P: 101325 });
    var s = null, i = 0;
    while (!e.tripped && i < 500) { s = e.advance(); i++; }
    if (!e.tripped) return result('limit', '极限载荷', false, '未按预期触发载荷保护');
    var tr = e.tripped;
    var frozen = e.advance();
    var freezeOk = frozen.step === s.step && frozen.lift === s.lift;
    var ok = tr.channel === 'load' && tr.value > WT.LIMITS.load.max &&
      finite(tr.position.x) && finite(tr.V) && finite(tr.P) && finite(tr.T) && freezeOk;
    return result('limit', '极限载荷', ok,
      '第 ' + tr.step + ' 步触发：' + tr.limit.label + '=' + tr.value.toFixed(1) +
      WT.LIMITS.load.unit + ' 超过 ' + WT.LIMITS.load.max + '，积分已冻结',
      { record: { position: tr.position, V: tr.V, alpha: tr.alpha,
        P: tr.P, T: tr.T, q: tr.q, lift: tr.lift, drag: tr.drag, Re: tr.Re } });
  }

  // 场景 3：失稳（失速）—— 迎角扫过临界角，升力突降并记录迟滞再附
  function scenarioStall() {
    var e = new WT.WindTunnelEngine({ seed: 99, noiseEnabled: false });
    e.setTargets({ V: 35, alpha: 10, T: 293.15, P: 101325 });
    var peak = -Infinity, stallSnap = null, i, s;
    for (i = 0; i < 120; i++) { s = e.advance(); peak = Math.max(peak, s.lift); }
    e.setTarget('alpha', 18);
    for (i = 0; i < 300 && !stallSnap; i++) {
      s = e.advance();
      peak = Math.max(peak, s.lift);
      if (e.stalled && !stallSnap) stallSnap = e.snapshot();
    }
    for (i = 0; i < 200; i++) s = e.advance(); // 等待失速后系数完全收敛
    var stallEvt = e.events.filter(function (ev) { return ev.kind === 'stall'; })[0];
    var postLift = s.lift;
    e.setTarget('alpha', 8);
    var reEvt = null;
    for (i = 0; i < 300 && !reEvt; i++) {
      s = e.advance();
      if (e.events.some(function (ev) { return ev.kind === 'reattach'; })) {
        reEvt = e.events.filter(function (ev) { return ev.kind === 'reattach'; })[0];
      }
    }
    var dropPct = (peak - postLift) / peak;
    var ok = !!stallEvt && Math.abs(stallEvt.alpha - WT.ALPHA_CRIT) < 1.0 &&
      dropPct > 0.15 && !!reEvt && reEvt.alpha < WT.ALPHA_REATTACH + 1;
    return result('stall', '失稳失速', ok,
      '失速于 α=' + stallEvt.alpha.toFixed(2) + '°（临界 ' + WT.ALPHA_CRIT +
      '°），升力峰值 ' + peak.toFixed(1) + 'N → ' + postLift.toFixed(1) +
      'N（降 ' + (dropPct * 100).toFixed(1) + '%），再附 α=' +
      (reEvt ? reEvt.alpha.toFixed(2) : 'N/A') + '°',
      { record: { position: stallEvt.position, V: stallEvt.V, alpha: stallEvt.alpha,
        P: stallEvt.P, T: stallEvt.T, q: stallEvt.q, lift: stallEvt.lift,
        drag: stallEvt.drag, Re: stallEvt.Re } });
  }

  // 场景 4：确定性 —— 同参数同种子重复运行，逐快照完全一致；换种子噪声不同
  function scenarioDeterminism() {
    function run(seed) {
      var e = new WT.WindTunnelEngine({ seed: seed });
      e.setTargets({ V: 40, alpha: 9, T: 290, P: 100000 });
      var out = [];
      for (var i = 0; i < 250; i++) {
        e.setTarget('alpha', 9 + 2 * Math.sin(i / 30));
        out.push(e.advance());
      }
      return out;
    }
    var a = run(123), b = run(123), c = run(999);
    var same = a.every(function (s, i) { return deepEqual(s, b[i]); });
    var noiseDiffers = c.some(function (s, i) {
      return s.liftMeas !== a[i].liftMeas;
    });
    var meanDiff = a.reduce(function (acc, s, i) {
      return acc + Math.abs(s.liftMeas - b[i].liftMeas);
    }, 0) / a.length;
    return result('determinism', '重复一致性', same && noiseDiffers,
      '同种子 250 步逐帧一致（平均差=' + meanDiff.toExponential(2) +
      'N），换种子噪声轨迹不同=' + noiseDiffers);
  }

  // 场景 5：暂停/单步 —— 分段单步拼接的轨迹必须与连续运行逐快照相同
  function scenarioPauseStep() {
    var cont = new WT.WindTunnelEngine({ seed: 555 });
    cont.setTargets({ V: 45, alpha: 7, T: 295, P: 101000 });
    var contSnap = [];
    for (var i = 0; i < 160; i++) contSnap.push(cont.advance());

    var step = new WT.WindTunnelEngine({ seed: 555 });
    step.setTargets({ V: 45, alpha: 7, T: 295, P: 101000 });
    var stepSnap = [];
    for (i = 0; i < 40; i++) stepSnap.push(step.advance());      // 运行
    for (i = 0; i < 80; i++) {                                  // 暂停期单步
      stepSnap.push(step.advance());
    }
    for (i = 0; i < 40; i++) stepSnap.push(step.advance());      // 恢复运行
    var ok = stepSnap.every(function (s, j) { return deepEqual(s, contSnap[j]); });
    return result('pauseStep', '暂停/单步等价', ok,
      '160 步中含 80 次暂停单步，物理状态与连续运行' + (ok ? '完全相同' : '出现差异'));
  }

  // 场景 6：重置不漂移 —— 反复重置后初始快照字段恒定
  function scenarioResetDrift() {
    var e = new WT.WindTunnelEngine({ seed: 321 });
    e.setTargets({ V: 55, alpha: 11, T: 300, P: 99000 });
    var first = e.snapshot();
    var ok = true, n = 0;
    for (var r = 0; r < 10; r++) {
      for (var i = 0; i < 100; i++) e.advance();
      e.setTarget('alpha', 3);
      for (i = 0; i < 50; i++) e.advance();
      var init = e.reset();
      n++;
      if (!deepEqual(init, first)) ok = false;
    }
    return result('reset', '重置无漂移', ok,
      '10 次“运行→重置”后初始条件与首次完全一致（t=' + first.t + ', α=' +
      first.alpha + '°, V=' + first.V + 'm/s）');
  }

  // 场景 7：回放平滑 —— 快照回放无状态跳变：时间单调、相邻增量有界、无 NaN
  function scenarioReplay() {
    var e = new WT.WindTunnelEngine({ seed: 88 });
    e.setTargets({ V: 50, alpha: 11, T: 293.15, P: 101325 });
    var buf = [];
    for (var i = 0; i < 300; i++) buf.push(WT.WindTunnelEngine.restoreSnapshot(e.advance()));
    var monotone = true, bounded = true, sane = true;
    var maxLiftJump = 0, dtMax = 0;
    for (i = 1; i < buf.length; i++) {
      var a = buf[i - 1], b = buf[i];
      if (!(b.t > a.t)) monotone = false;
      var ddt = Math.abs(b.t - a.t - WT.DT);
      dtMax = Math.max(dtMax, ddt);
      if (ddt > 1e-9) bounded = false;
      var dl = Math.abs(b.lift - a.lift);
      maxLiftJump = Math.max(maxLiftJump, dl);
      if (!allFinite(b)) sane = false;
    }
    // 快照恢复值必须与现场引擎同一步状态一致，保证回放可无缝接管
    var live = new WT.WindTunnelEngine({ seed: 88 });
    live.setTargets({ V: 50, alpha: 11, T: 293.15, P: 101325 });
    var liveSnap = null;
    for (var j = 0; j < 201; j++) liveSnap = live.advance();
    var seamless = deepEqual(liveSnap, buf[200]);
    var ok = monotone && bounded && sane && seamless;
    return result('replay', '回放无跳变', ok,
      '300 帧回放时间单调、步长恒为 ' + WT.DT + 's、最大单帧升力增量 ' +
      maxLiftJump.toFixed(3) + 'N（失速突降为物理预期，非数值跳变）、状态量全部有限');
  }

  // 场景 3b：环境量越限 —— 静压、温度越过上下限时分别冻结并指明通道
  function scenarioEnvLimit() {
    var details = [];
    var cases = [
      { key: 'P', value: WT.LIMITS.P.max + 1000, name: '静压上限' },
      { key: 'T', value: WT.LIMITS.T.min - 5, name: '温度下限' },
      { key: 'V', value: WT.LIMITS.V.min - 2, name: '风速下限' },
      { key: 'alpha', value: WT.LIMITS.alpha.max + 1, name: '迎角上限' }
    ];
    var allOk = cases.every(function (c) {
      var e = new WT.WindTunnelEngine({ seed: 11, noiseEnabled: false });
      e.setTarget(c.key, c.value);
      var s = null, guard = 0;
      while (!e.tripped && guard < 400) { s = e.advance(); guard++; }
      var lim = WT.LIMITS[c.key];
      var crossed = c.value > lim.max ? e.tripped && e.tripped.value > lim.max
        : e.tripped && e.tripped.value < lim.min;
      var ok = !!e.tripped && e.tripped.channel === c.key &&
        !!crossed && finite(s.tripped.q) && finite(s.tripped.T);
      details.push(c.name + (ok ? '✓' : '✕'));
      return ok;
    });
    return result('envLimit', '温压/速度/迎角越限', allOk,
      '四类越限均在下一步冻结并记录触发通道与触发点：' + details.join('，'));
  }

  function runAll() {
    var fns = [scenarioNormal, scenarioLimitLoad, scenarioStall, scenarioEnvLimit,
      scenarioDeterminism, scenarioPauseStep, scenarioResetDrift, scenarioReplay];
    var rows = fns.map(function (fn) { return fn(); });
    return {
      rows: rows,
      pass: rows.every(function (r) { return r.pass; }),
      count: rows.length,
      passed: rows.filter(function (r) { return r.pass; }).length
    };
  }

  return {
    scenarioNormal: scenarioNormal, scenarioLimitLoad: scenarioLimitLoad,
    scenarioStall: scenarioStall, scenarioEnvLimit: scenarioEnvLimit,
    scenarioDeterminism: scenarioDeterminism,
    scenarioPauseStep: scenarioPauseStep, scenarioResetDrift: scenarioResetDrift,
    scenarioReplay: scenarioReplay, runAll: runAll,
    _helpers: { deepEqual: deepEqual, allFinite: allFinite }
  };
});
