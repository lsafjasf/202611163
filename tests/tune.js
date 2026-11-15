import { createState, stepOnce } from '../js/engine.js';
import { makeAutoPilot, makeManualPilot } from '../js/pilot.js';
import { SCENARIOS, PHYS } from '../js/constants.js';

function run(name, cfg, steps = 6000) {
  const state = createState(cfg);
  state.status = 'running';
  const pilot = cfg.auto ? makeAutoPilot(cfg.gain) : makeManualPilot(cfg.command);
  for (let n = 0; n < steps; n++) {
    stepOnce(state, pilot);
    if (state.status === 'triggered' || state.status === 'success' ||
        state.status === 'failed') break;
  }
  const summary = {
    name,
    status: state.status,
    t: state.t.toFixed(2),
    y: state.y.toFixed(3),
    vy: state.vy.toFixed(3),
    x: state.x.toFixed(3),
    rings: state.ringsPassed.map((v) => (v ? 1 : 0)).join(''),
    hits: state.ringsHit.map((v) => (v ? 1 : 0)).join(''),
    score: state.score,
    maxTemp: (Math.max(...state.temp) - 273.15).toFixed(1),
    maxPressure: (state.maxPressure / 1000).toFixed(1),
    trigger: state.trigger ? state.trigger.message : null
  };
  console.log(JSON.stringify(summary));
  return state;
}

for (const [name, cfg] of Object.entries(SCENARIOS)) {
  run(name, cfg);
}

// Quick determinism check.
const a = run('normal-a', SCENARIOS.normal);
const b = run('normal-b', SCENARIOS.normal);
console.log('deterministic:', a.step === b.step && a.y === b.y && a.score === b.score
  && a.rngState === b.rngState);
