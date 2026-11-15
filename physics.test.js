import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CONFIG,
  DEFAULT_CONTROLS,
  FIXED_DT,
  LIMITS,
  SCENARIOS,
  TARGET_OUTPUT_RPM,
  cloneState,
  createInitialState,
  gearGeometry,
  playbackSmoothness,
  runScenario,
  stateHash,
  stepSimulation,
  validateScenarios,
} from "./physics.js";

test("normal scenario reaches the target speed deterministically", () => {
  const normal = SCENARIOS.find((scenario) => scenario.id === "normal");
  const first = runScenario(normal);
  const second = runScenario(normal);

  assert.equal(first.state.status, "success");
  assert.equal(first.state.trigger.code, "TARGET_REACHED");
  assert.ok(Math.abs(first.state.outputRpm - TARGET_OUTPUT_RPM) < 0.8);
  assert.deepEqual(first.state, second.state);
});

test("extreme load stops at a recorded pressure trigger", () => {
  const extreme = SCENARIOS.find((scenario) => scenario.id === "extreme");
  const run = runScenario(extreme);
  const trigger = run.state.trigger;

  assert.equal(run.state.status, "failed");
  assert.equal(trigger.code, "PRESSURE_LIMIT");
  assert.ok(trigger.pressureMPa > LIMITS.pressure);
  assert.ok(trigger.positionDeg >= 0 && trigger.positionDeg < 360);
  assert.ok(trigger.speedRpm > 0);
  assert.ok(trigger.time > 0);
});

test("unstable mesh triggers without advancing the failed state", () => {
  const unstable = SCENARIOS.find((scenario) => scenario.id === "instability");
  const run = runScenario(unstable);
  const frozen = cloneState(run.state);

  stepSimulation(run.state, unstable.config, unstable.controls);
  stepSimulation(run.state, unstable.config, unstable.controls);

  assert.equal(run.state.status, "failed");
  assert.equal(run.state.trigger.code, "PRESSURE_LIMIT");
  assert.equal(stateHash(run.state), stateHash(frozen));
  assert.equal(run.state.t, frozen.t);
});

test("repeated runs stay within a tight numerical tolerance", () => {
  const results = validateScenarios();

  for (const result of results) {
    assert.equal(result.passed, true);
    assert.ok(result.repeatDelta < 1e-10);
  }
});

test("pause state and one fixed step produce the same physical state", () => {
  const running = createInitialState();
  for (let index = 0; index < 90; index += 1) {
    stepSimulation(running, DEFAULT_CONFIG, DEFAULT_CONTROLS);
  }
  const paused = cloneState(running);
  paused.status = "paused";

  stepSimulation(running, DEFAULT_CONFIG, DEFAULT_CONTROLS, FIXED_DT);
  stepSimulation(paused, DEFAULT_CONFIG, DEFAULT_CONTROLS, FIXED_DT);

  assert.equal(stateHash(running), stateHash(paused));
  assert.equal(running.t, paused.t);
});

test("repeated resets preserve identical initial conditions", () => {
  const hashes = [];
  for (let index = 0; index < 8; index += 1) {
    hashes.push(stateHash(createInitialState(DEFAULT_CONFIG, DEFAULT_CONTROLS)));
  }
  assert.equal(new Set(hashes).size, 1);
});

test("hard limits stop integration before advancing time", () => {
  const state = createInitialState(DEFAULT_CONFIG, DEFAULT_CONTROLS);
  stepSimulation(state, DEFAULT_CONFIG, { inputRpm: 90, loadNm: LIMITS.loadHard[1] + 0.2 });

  assert.equal(state.status, "failed");
  assert.equal(state.trigger.code, "INPUT_LIMIT");
  assert.equal(state.t, 0);
  assert.equal(state.steps, 0);
});

test("excess oil temperature stops at a thermal trigger", () => {
  const state = createInitialState(DEFAULT_CONFIG, DEFAULT_CONTROLS);
  state.tempC = LIMITS.temperature + 0.1;
  stepSimulation(state, DEFAULT_CONFIG, DEFAULT_CONTROLS);

  assert.equal(state.status, "failed");
  assert.equal(state.trigger.code, "TEMP_LIMIT");
  assert.ok(state.trigger.tempC > LIMITS.temperature);
  assert.ok(state.trigger.positionDeg >= 0);
});

test("oversized gears report a shaft jam", () => {
  const jamConfig = { input: 30, idler: 46, output: 36 };
  const geometry = gearGeometry(jamConfig);
  const state = createInitialState(jamConfig, DEFAULT_CONTROLS);
  stepSimulation(state, jamConfig, DEFAULT_CONTROLS);

  assert.equal(geometry.jam, true);
  assert.equal(state.trigger.code, "SHAFT_JAM");
  assert.equal(state.outputRpm, 0);
});

test("a valid but wrong ratio stops with a speed mismatch trigger", () => {
  const scenario = {
    config: { input: 24, idler: 46, output: 36 },
    controls: { inputRpm: 90, loadNm: 1.15 },
  };
  const run = runScenario(scenario);

  assert.equal(run.state.status, "failed");
  assert.equal(run.state.trigger.code, "SPEED_MISMATCH");
  assert.ok(run.state.trigger.speedRpm < TARGET_OUTPUT_RPM - 1);
  assert.ok(run.state.trigger.positionDeg > 0);
});

test("recorded traces have no discontinuous key-state jumps", () => {
  const normal = SCENARIOS.find((scenario) => scenario.id === "normal");
  const run = runScenario(normal);
  const smoothness = playbackSmoothness(run.samples);

  assert.ok(run.samples.length > 20);
  assert.ok(smoothness < 1);
  for (let index = 1; index < run.samples.length; index += 1) {
    assert.ok(Math.abs(run.samples[index].outputRpm - run.samples[index - 1].outputRpm) < 12);
    assert.ok(Math.abs(run.samples[index].tempC - run.samples[index - 1].tempC) < 1);
  }
});
