// Headless verification of the co-op gondola core (node test/sim.test.mjs).
import {
  CONFIG,
  createGame,
  resetGame,
  rotateSeats,
  applyInput,
  step,
  seatAxis,
  gondolaPos,
  panelView,
} from '../src/sim.js';

const DT = 1 / 60;
let failures = 0;

function check(name, cond, detail = '') {
  if (cond) console.log(`ok   - ${name}`);
  else {
    failures++;
    console.log(`FAIL - ${name} ${detail}`);
  }
}

function seatFor(state, axis) {
  return state.seats.L === axis ? 'L' : 'R';
}

// Track held directions so we only emit changed inputs (like real keys).
function setDemand(state, axis, dir, held) {
  if (held[axis] === dir) return;
  const seat = seatFor(state, axis);
  if (held[axis] !== 0) applyInput(state, seat, held[axis] > 0 ? 'inc' : 'dec', false);
  if (dir !== 0) applyInput(state, seat, dir > 0 ? 'inc' : 'dec', true);
  held[axis] = dir;
}

// Two-station autopilot. Like a human on a keyboard it feathers the keys
// (duty-cycled presses) instead of slamming full drive, and the swing
// station trims pendulum motion (the "counterbalance" job).
const CYCLE = 0.3;

function velDemand(state, axis, v, fullScale, held) {
  let dir = 0;
  const mag = Math.abs(v);
  if (mag > 0.2) {
    const duty = Math.min(1, mag / fullScale);
    if (state.t % CYCLE < duty * CYCLE) dir = Math.sign(v);
  }
  setDemand(state, axis, dir, held);
}

function guide(state, target, held) {
  velDemand(state, 'hoist', 0.8 * (target.y - state.hoist.len), 1.2, held);
  const L = state.hoist.len;
  const wantX = target.x - L * Math.sin(state.pend.theta);
  velDemand(
    state,
    'swing',
    0.4 * (wantX - state.arm.x) + 1.0 * L * state.pend.omega,
    CONFIG.armSpeed,
    held
  );
}

function runCoop(state, maxSeconds = CONFIG.countdown) {
  const held = { hoist: 0, swing: 0 };
  let idx = 0;
  while (state.status === 'running' && state.t < maxSeconds) {
    const target = state.repairs[idx];
    if (!target) break;
    guide(state, target, held);
    step(state, DT);
    if (state.repairs[idx].done) idx++;
  }
  setDemand(state, 'hoist', 0, held);
  setDemand(state, 'swing', 0, held);
  return state;
}

// 1) Full cooperative run: three windows repaired, both panels in sync.
{
  const s = runCoop(createGame(7));
  check('coop run wins', s.status === 'won', `status=${s.status} t=${s.t.toFixed(1)}`);
  check('coop all repairs done', s.repairs.every((r) => r.done));
  const pl = panelView(s, 'L');
  const pr = panelView(s, 'R');
  check(
    'panels share tension/resource/timer/progress',
    pl.tension === pr.tension &&
      pl.resource === pr.resource &&
      pl.timeLeft === pr.timeLeft &&
      pl.repairsDone === pr.repairsDone
  );
  check('panels have distinct duties', pl.axis === 'hoist' && pr.axis === 'swing');
  check('shared resource was consumed and visible', pl.resource < CONFIG.resourceMax);
  check('repair progress events logged', s.events.filter((e) => e.type === 'repair-done').length === 3);
}

// 2) Single-side mistake (estop interrupts the other seat) then recovery.
{
  const s = createGame(11);
  applyInput(s, 'R', 'inc', true); // swing seat drives arm
  for (let i = 0; i < 150; i++) step(s, DT); // 2.5s to build speed
  applyInput(s, 'L', 'estop', true); // hoist seat slams emergency stop
  check('estop during other-side drive logs conflict',
    s.conflicts.some((c) => c.kind === 'estop-interrupt' && c.interrupted === 'swing'));
  check('estop spikes cable tension', s.tensionBoost > 100,
    `boost=${s.tensionBoost.toFixed(0)}`);
  applyInput(s, 'L', 'estop', false);
  // Moving axis stops itself: pivot speed becomes pendulum kick.
  const omegaBefore = s.pend.omega;
  const armVel = s.arm.vel;
  const thetaAtStop = s.pend.theta;
  applyInput(s, 'R', 'estop', true);
  const omegaKick = s.pend.omega - omegaBefore;
  const expected = (armVel * Math.cos(thetaAtStop)) / s.hoist.len;
  check('estop kicks the pendulum',
    Math.abs(omegaKick - expected) < 1e-6 && Math.abs(omegaKick) > 0.2,
    `kick=${omegaKick.toFixed(3)} expected=${expected.toFixed(3)}`);
  applyInput(s, 'R', 'estop', false);
  applyInput(s, 'R', 'inc', false);
  // Recovery: the swing station trims while hoist repositions; finish all.
  runCoop(s, CONFIG.countdown);
  check('recovery after mistake still wins', s.status === 'won', `status=${s.status}`);
  check('conflict timestamps preserved in replay',
    s.events.some((e) => e.type === 'conflict' && typeof e.t === 'number' && e.t > 0));
}

// 3) Neither side alone can complete the job.
{
  const hoistOnly = createGame(3);
  while (hoistOnly.status === 'running') {
    const r = hoistOnly.repairs.find((x) => !x.done);
    const dL = (r ? r.y : 10) - hoistOnly.hoist.len;
    if (Math.abs(dL) > 0.15) {
      applyInput(hoistOnly, 'L', dL > 0 ? 'inc' : 'dec', true);
    }
    step(hoistOnly, DT);
  }
  check('hoist-only cannot win', hoistOnly.status === 'lost' && hoistOnly.repairs.every((r) => !r.done));

  const swingOnly = createGame(3);
  while (swingOnly.status === 'running') {
    const r = swingOnly.repairs.find((x) => !x.done);
    const dA = (r ? r.x : 0) - swingOnly.arm.x;
    if (Math.abs(dA) > 0.12) {
      applyInput(swingOnly, 'R', dA > 0 ? 'inc' : 'dec', true);
    }
    step(swingOnly, DT);
  }
  check('swing-only cannot win', swingOnly.status === 'lost' && swingOnly.repairs.every((r) => !r.done));
}

// 4) Rotate control sides: seats swap duties, same task still completable.
{
  const s = createGame(7);
  rotateSeats(s);
  check('rotation swaps duties', seatAxis(s, 'L') === 'swing' && seatAxis(s, 'R') === 'hoist');
  applyInput(s, 'L', 'inc', true);
  check('left seat now drives swing axis', s.inputs.swing === 1 && s.inputs.hoist === 0);
  applyInput(s, 'L', 'inc', false);
  runCoop(s);
  check('rotated coop run wins', s.status === 'won', `status=${s.status}`);
}

// 5) Restart resets shared state for both sides.
{
  const s = createGame(5);
  applyInput(s, 'L', 'inc', true);
  applyInput(s, 'R', 'inc', true);
  for (let i = 0; i < 600; i++) step(s, DT);
  applyInput(s, 'L', 'estop', true);
  const fresh = resetGame(s);
  const pl = panelView(fresh, 'L');
  const pr = panelView(fresh, 'R');
  check('restart restores countdown', pl.timeLeft === CONFIG.countdown && pr.timeLeft === CONFIG.countdown);
  check('restart restores shared resource', pl.resource === CONFIG.resourceMax && pr.resource === CONFIG.resourceMax);
  check('restart restores baseline tension', pl.tension === Math.round(CONFIG.mass * CONFIG.g));
  check('restart clears progress and status', fresh.status === 'running' && fresh.repairs.every((r) => !r.done));
  check('restart clears replay log', fresh.events.length === 1 && fresh.events[0].type === 'start');
}

// 6) Replay integrity: frames sampled, conflicts timestamped, serializable.
{
  const s = createGame(11);
  applyInput(s, 'R', 'inc', true);
  for (let i = 0; i < 150; i++) step(s, DT);
  applyInput(s, 'L', 'estop', true);
  for (let i = 0; i < 120; i++) step(s, DT);
  check('replay frames sampled', s.frames.length > 20);
  const c = s.events.find((e) => e.type === 'conflict');
  check('conflict event has valid timestamp', c && c.t > 0 && c.t <= s.t);
  check('replay is JSON serializable', JSON.stringify({ events: s.events, frames: s.frames }).length > 0);
}

console.log(failures === 0 ? '\nall tests passed' : `\n${failures} test(s) failed`);
process.exit(failures === 0 ? 0 : 1);
