import assert from "node:assert/strict";
import test from "node:test";
import {
  cloneRecording,
  recordDeterministicRun,
  replayRecording,
} from "../src/engine.js";
import { buildScenarios } from "../src/scenarios.js";

const scenarios = buildScenarios();
const scenario = (id) => scenarios.find((item) => item.id === id);

test("normal and boundary recordings replay from initial without divergence", () => {
  for (const id of ["normal", "boundary"]) {
    const item = scenario(id);
    const result = replayRecording(item.recording);
    assert.equal(result.ok, true, id);
    assert.equal(result.status, "verified", id);
    assert.equal(result.replayFrom, "initial");
    assert.equal(result.firstDivergence, null);
    assert.equal(result.errors.length, 0);
    assert.equal(result.stats.stateChecks, item.recording.endTick + 1);
    assert.equal(result.stats.randomChecks, item.recording.endTick * 3);
    assert.equal(result.finalHash, item.recording.finalHash);
  }
});

test("boundary recording includes a valid inert event on the final tick", () => {
  const boundary = scenario("boundary").recording;
  const finalEvents = boundary.inputs.filter(
    (input) => input.tick === boundary.endTick,
  );
  assert.equal(finalEvents.length, 1);
  const result = replayRecording(boundary);
  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.stats.inputsRejected, 0);
});

test("corrupt scenario reports random and state divergence plus structural errors", () => {
  const recording = scenario("corrupt").recording;
  const first = replayRecording(recording);
  const second = replayRecording(cloneRecording(recording));
  assert.equal(first.ok, false);
  assert.equal(first.status, "failed");
  assert.equal(first.firstRandomDivergence.tick, 333);
  assert.equal(first.firstStateDivergence.tick, 334);
  assert.equal(first.firstDivergence.kind, "random");
  assert.equal(first.errors.length, 4);
  assert.deepEqual(
    first.errors.map((error) => error.code),
    ["E_INPUT_TICK", "E_INPUT_ACTION", "E_INPUT_PHASE", "E_INPUT_TICK"],
  );
  assert.notEqual(first.finalHash, first.expectedFinalHash);
  assert.deepEqual(first.errors, second.errors);
  assert.deepEqual(first.firstDivergence, second.firstDivergence);
  assert.equal(first.finalHash, second.finalHash);
});

test("scenario construction is repeatable byte for byte", () => {
  const again = buildScenarios();
  assert.deepEqual(
    again.map((item) => item.recording),
    scenarios.map((item) => item.recording),
  );
});

test("invalid input is logged instead of being silently accepted", () => {
  const recording = cloneRecording(scenario("normal").recording);
  recording.inputs.push({
    tick: -1,
    seq: 9999,
    action: "warp",
    phase: "down",
  });
  const result = replayRecording(recording);
  assert.equal(result.ok, false);
  assert.equal(result.status, "failed");
  assert.equal(result.finalHash, recording.finalHash);
  assert.equal(result.errors.length, 2);
  assert.equal(result.timeline[0], "error");
});

test("missing random row uses explicit recovery and still fails verification", () => {
  const recording = cloneRecording(scenario("boundary").recording);
  recording.random.splice(240, 1);
  const result = replayRecording(recording);
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.code === "E_RANDOM_COUNT"), true);
  assert.equal(result.errors.some((error) => error.code === "E_RANDOM_VALUE"), true);
  assert.match(
    result.errors.find((error) => error.code === "E_RANDOM_VALUE").recovery,
    /安全恢复/,
  );
});

test("tampered initial state is flagged at tick zero", () => {
  const recording = cloneRecording(scenario("normal").recording);
  recording.initial.playerX = 0.123456;
  const result = replayRecording(recording);
  assert.equal(result.ok, false);
  assert.equal(result.firstStateDivergence.tick, 0);
  assert.equal(result.firstStateDivergence.kind, "state");
});

test("malformed initial and final state are reported without throwing", () => {
  const recording = cloneRecording(scenario("normal").recording);
  recording.initial = {};
  recording.finalState = {};
  const result = replayRecording(recording);
  assert.equal(result.ok, false);
  assert.equal(result.status, "failed");
  assert.equal(
    result.errors.some((error) => error.code === "E_INITIAL_SHAPE"),
    true,
  );
  assert.equal(
    result.errors.some((error) => error.code === "E_FINAL_STATE_SHAPE"),
    true,
  );
  assert.equal(result.firstStateDivergence, null);
});

test("timeline marks every random mismatch instead of only the first", () => {
  const recording = cloneRecording(scenario("normal").recording);
  recording.random[100].values[0] = 0;
  recording.random[200].values[0] = 0;
  const result = replayRecording(recording);
  assert.equal(result.ok, false);
  assert.equal(result.timeline[100], "random");
  assert.equal(result.timeline[200], "random");
  assert.equal(result.firstRandomDivergence.tick, 100);
});

test("invalid endTick is rejected before allocating a huge replay", () => {
  const recording = cloneRecording(scenario("normal").recording);
  recording.endTick = 999999;
  const result = replayRecording(recording);
  assert.equal(result.fatal, true);
  assert.equal(result.status, "invalid");
  assert.equal(result.errors[0].code, "E_END_TICK");
});

test("a completed run ends with a duration reason and stable final hash", () => {
  const recording = recordDeterministicRun({
    seed: 42,
    durationTicks: 120,
  });
  assert.equal(recording.finalState.status, "ended");
  assert.equal(recording.finalState.reason, "duration");
  const result = replayRecording(recording);
  assert.equal(result.ok, true);
  assert.equal(result.finalState.reason, "duration");
  assert.equal(result.finalHash, recording.finalHash);
});
