import test from "node:test";
import assert from "node:assert/strict";

import { CONFIG, applyControl, createInitialState, stepSimulation } from "../src/sim.js";
import { captureFrame, frameContinuity, sampleFrames } from "../src/replay.js";
import { runScenario, runValidationSuite } from "../src/validation.js";

test("fresh reset states do not drift", () => {
  const first = createInitialState();
  for (let index = 0; index < 25; index += 1) {
    const next = createInitialState();
    assert.equal(next.tankA, first.tankA);
    assert.equal(next.tankB, first.tankB);
    assert.deepEqual(next.valves, first.valves);
    assert.deepEqual(next.valveTargets, first.valveTargets);
    assert.equal(next.pump, first.pump);
    assert.equal(next.pressure, first.pressure);
  }
});

test("normal setup reaches both target ranges before the deadline", () => {
  const result = runScenario("normal");
  assert.equal(result.state.status, "success");
  assert.ok(result.state.time < CONFIG.deadline);
  assert.ok(result.state.tankA >= CONFIG.target.aMin && result.state.tankA <= CONFIG.target.aMax);
  assert.ok(result.state.tankB >= CONFIG.target.bMin && result.state.tankB <= CONFIG.target.bMax);
});

test("extreme pump load stops at the load limit", () => {
  const result = runScenario("extreme");
  assert.equal(result.state.status, "trip");
  assert.equal(result.state.trip.primary, "load");
  assert.ok(result.state.trip.value > CONFIG.limits.load);
  assert.ok(result.state.trip.dynamics.pressure > 0);
  assert.ok(result.state.trip.position.tankA >= 0);
});

test("rapid valve reversal produces water hammer and freezes on pressure", () => {
  const result = runScenario("unstable");
  assert.equal(result.state.status, "trip");
  assert.equal(result.state.trip.primary, "pressure");
  assert.ok(result.state.trip.value > CONFIG.limits.pressure);
  assert.ok(result.state.trip.dynamics.valveRate > CONFIG.safeValveRate);
});

test("pump dry run raises temperature and trips the temperature limit", () => {
  let state = createInitialState({
    tankA: 0.2,
    tankB: 0.2,
    valveTargets: [0, 0, 0],
    pumpTarget: 1
  });
  for (let index = 0; index < 2000 && state.status === "running"; index += 1) {
    state = stepSimulation(state);
  }
  assert.equal(state.status, "trip");
  assert.equal(state.trip.primary, "temperature");
  assert.ok(state.trip.value > CONFIG.limits.temperature);
  assert.ok(state.trip.dynamics.temperature > CONFIG.limits.temperature);
});

test("identical inputs are deterministic", () => {
  const first = runScenario("normal", { capture: false }).state;
  const second = runScenario("normal", { capture: false }).state;
  const fields = ["time", "tankA", "tankB", "pressure", "temperature", "load", "pumpRpm"];
  for (const field of fields) assert.equal(second[field], first[field]);
  assert.deepEqual(second.flows, first.flows);
});

test("pause followed by single steps matches uninterrupted physics", () => {
  let uninterrupted = createInitialState();
  let paused = createInitialState();
  for (let index = 1; index <= 300; index += 1) {
    if (index === 50) {
      uninterrupted = applyControl(uninterrupted, 0, 0.71);
      paused = applyControl(paused, 0, 0.71);
    }
    uninterrupted = stepSimulation(uninterrupted);
    paused = stepSimulation(paused);
  }
  assert.equal(paused.tick, uninterrupted.tick);
  assert.equal(paused.time, uninterrupted.time);
  assert.equal(paused.tankA, uninterrupted.tankA);
  assert.equal(paused.tankB, uninterrupted.tankB);
  assert.equal(paused.pressure, uninterrupted.pressure);
  assert.deepEqual(paused.flows, uninterrupted.flows);
});

test("replay samples interpolate without discontinuities", () => {
  const result = runScenario("normal");
  const continuity = frameContinuity(result.frames);
  assert.equal(continuity.passed, true);
  const start = sampleFrames(result.frames, 0);
  const middle = sampleFrames(result.frames, result.frames[100].time + 0.008);
  const end = sampleFrames(result.frames, result.state.time);
  assert.ok(middle.time > start.time && middle.time < end.time);
  assert.ok(Math.abs(middle.tankA - start.tankA) < 0.1);
  assert.equal(end.status, result.state.status);
});

test("terminal states cannot keep evolving", () => {
  const terminal = runScenario("extreme").state;
  const next = stepSimulation(terminal);
  assert.equal(next.tick, terminal.tick);
  assert.equal(next.pressure, terminal.pressure);
  assert.equal(next.status, terminal.status);
});

test("complete validation suite passes", () => {
  const suite = runValidationSuite();
  assert.equal(suite.passed, true);
  assert.equal(suite.checks.length, 7);
  assert.ok(suite.checks.every((check) => check.passed));
});
