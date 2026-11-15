/* In-browser verification mirroring tools/selftest.js. */
export function runBrowser({ Physics: P, Scenarios }) {
  let passed = 0;
  let failed = 0;
  const lines = [];

  const check = (name, cond, detail) => {
    if (cond) {
      passed++;
      lines.push("PASS " + name);
    } else {
      failed++;
      lines.push("FAIL " + name + (detail ? " -> " + detail : ""));
    }
  };

  const runSim = (params, seconds = 60) => {
    const sim = new P.Simulation(params);
    while (sim.status === "running" && sim.state.t < seconds) sim.step();
    return sim;
  };

  const hash = (sim) => {
    const s = sim.state;
    const keys = ["t", "qx", "qy", "wx", "wy", "ws", "trqX", "trqY", "temp", "pressure", "tilt", "hold"];
    let h = 0;
    for (const k of keys) {
      h = (Math.imul(h, 31) + (Math.round(s[k] * 1e9) | 0)) | 0;
    }
    return h;
  };

  for (const sc of Scenarios) {
    const sim = runSim(sc.params);
    check(sc.id + " 状态=" + sc.expect, sim.status === sc.expect, sim.status);
    if (sc.expectKey) {
      check(
        sc.id + " 触发量=" + sc.expectKey,
        sim.event && sim.event.key === sc.expectKey
      );
    }
  }

  const a = runSim(Scenarios[0].params, 8);
  const b = runSim(Scenarios[0].params, 8);
  check("重复运行结果一致", hash(a) === hash(b));

  const r1 = new P.Simulation(Scenarios[0].params);
  r1.advance(2);
  const h0 = hash(r1);
  r1.advance(0);
  check("暂停零推进状态不变", hash(r1) === h0);
  const ref = new P.Simulation(Scenarios[0].params);
  ref.advance(2);
  for (let i = 0; i < P.STEPS_PER_FRAME; i++) {
    r1.step();
    ref.step();
  }
  check("单步与连续推进一致", hash(r1) === hash(ref));

  const rs = new P.Simulation(Scenarios[0].params);
  const init = hash(rs);
  rs.advance(4);
  rs.reset();
  check("重置后初始条件无漂移", hash(rs) === init);

  const rep = runSim(Scenarios[0].params, 9);
  let maxRate = 0;
  let monotonic = true;
  for (let i = 1; i < rep.history.length; i++) {
    const x = rep.history[i - 1];
    const y = rep.history[i];
    if (y.t <= x.t) monotonic = false;
    const dt = y.t - x.t;
    if (dt > 0) {
      maxRate = Math.max(
        maxRate,
        (Math.abs(y.qx - x.qx) +
          Math.abs(y.qy - x.qy) +
          Math.abs(y.ws - x.ws) +
          Math.abs(y.temp - x.temp)) /
          dt
      );
    }
  }
  check("回放时间戳单调", monotonic);
  check("回放无状态跳变", maxRate < 300, "rate=" + maxRate.toFixed(1));

  const bad = P.validateParams({ m: 99, wsCmd: 9999 });
  check("越限参数被拦截", !bad.ok && bad.violations.length === 2);

  const trip = runSim(Scenarios[2].params);
  const frozen = hash(trip);
  trip.advance(5);
  check("触发后状态冻结", hash(trip) === frozen);
  check("触发点四量已记录", (() => {
    const s = trip.event.snap;
    return [s.qx, s.wx, s.ws, s.pressure, s.temp].every(Number.isFinite);
  })());

  lines.push("");
  lines.push("结果: " + passed + " 通过, " + failed + " 失败");
  return lines.join("\n");
}
