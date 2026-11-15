const P = require("../js/physics.js");

function run(label, params, seconds = 60) {
  const sim = new P.Simulation(params);
  let maxTilt = 0;
  while (sim.status === "running" && sim.state.t < seconds) {
    sim.step();
    maxTilt = Math.max(maxTilt, sim.state.tilt);
  }
  const s = sim.state;
  console.log(
    `[${label}] status=${sim.status} t=${s.t.toFixed(2)} ` +
      `tilt=${s.tilt.toFixed(4)} maxTilt=${maxTilt.toFixed(4)} ` +
      `ws=${s.ws.toFixed(1)} temp=${s.temp.toFixed(1)} ` +
      `pMPa=${(s.pressure / 1e6).toFixed(3)} hold=${s.hold.toFixed(1)}`
  );
  if (sim.event) console.log("   event:", sim.event.msg, "key=", sim.event.key);
  return sim;
}

run("default", P.DEFAULTS);
run("low-spin", { wsCmd: 100 });
run("big-bias", { biasX: 1.2 });
run("heavy", { m: 2.0, wsCmd: 400 });
run("light", { m: 0.8, wsCmd: 150 });
