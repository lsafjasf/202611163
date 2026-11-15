import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runScenarioAudit } from "../src/benchmark.js";
import { buildScenarios } from "../src/scenarios.js";

const scenarios = buildScenarios();
const before = JSON.parse(
  await readFile(new URL("../artifacts/audit-before.json", import.meta.url)),
);
const after = JSON.parse(
  await readFile(new URL("../artifacts/audit-after.json", import.meta.url)),
);
const comparison = JSON.parse(
  await readFile(new URL("../artifacts/comparison.json", import.meta.url)),
);
const byId = (report, id) => report.scenarios.find((item) => item.id === id);

test("before/after artifacts use the expected render profiles", () => {
  assert.equal(before.profile, "full");
  assert.equal(after.profile, "lean");
  assert.equal(before.scenarios.length, 3);
  assert.equal(after.scenarios.length, 3);
});

test("all three scenarios keep final status, hash and errors across profiles", () => {
  for (const id of ["normal", "boundary", "corrupt"]) {
    const base = byId(before, id);
    const current = byId(after, id);
    assert.equal(base.result.status, current.result.status);
    assert.equal(base.result.finalHash, current.result.finalHash);
    assert.deepEqual(base.result.firstDivergence, current.result.firstDivergence);
    assert.deepEqual(base.result.errorCodes, current.result.errorCodes);
    assert.deepEqual(base.errors, current.errors);
    assert.equal(base.recording.digest, current.recording.digest);
  }
});

test("corrupt input remains a visible and reproducible failure", () => {
  const corrupt = byId(after, "corrupt");
  assert.equal(corrupt.result.ok, false);
  assert.equal(corrupt.result.status, "failed");
  assert.equal(corrupt.result.firstDivergence.tick, 333);
  assert.equal(corrupt.result.firstDivergence.kind, "random");
  assert.equal(corrupt.result.firstRandomDivergence.tick, 333);
  assert.deepEqual(corrupt.result.firstRandomDivergence.actualValues, [
    0, 687959292, 3283189684,
  ]);
  assert.equal(corrupt.result.firstStateDivergence.tick, 334);
  assert.match(corrupt.result.firstStateDivergence.actualHash, /^[0-9a-f]{16}$/);
  assert.match(corrupt.result.firstStateDivergence.expectedHash, /^[0-9a-f]{16}$/);
  assert.equal(corrupt.result.errorCount, 4);
  assert.equal(corrupt.repro.tamperTick, 333);
  assert.match(corrupt.repro.command, /scenario-audit\.js/);
  assert.deepEqual(
    corrupt.result.errorCodes,
    ["E_INPUT_TICK", "E_INPUT_ACTION", "E_INPUT_PHASE", "E_INPUT_TICK"],
  );
});

test("lean rendering reduces resource counts without changing replay output", () => {
  for (const id of ["normal", "boundary"]) {
    const base = byId(before, id);
    const current = byId(after, id);
    assert.ok(current.resources.drawCalls < base.resources.drawCalls);
    assert.ok(current.resources.peakLiveShapes < base.resources.peakLiveShapes);
    assert.ok(current.resources.gradientCalls < base.resources.gradientCalls);
    assert.ok(current.resources.shadowCalls < base.resources.shadowCalls);
    assert.equal(current.result.finalHash, base.result.finalHash);
    assert.equal(
      current.resources.replayStates,
      current.recording.endTick + 1,
    );
  }
});

test("audit artifacts match freshly computed scenario results", () => {
  for (const scenario of scenarios) {
    const current = byId(after, scenario.id);
    const fresh = runScenarioAudit(scenario, "lean");
    assert.equal(fresh.result.status, current.result.status);
    assert.equal(fresh.result.finalHash, current.result.finalHash);
    assert.deepEqual(fresh.result.errorCodes, current.result.errorCodes);
    assert.equal(fresh.recording.digest, current.recording.digest);
  }
});

test("comparison report confirms parity and a material draw-call reduction", () => {
  assert.equal(comparison.summary.finalResultEqual, 3);
  assert.equal(comparison.summary.errorLogEqual, 3);
  assert.equal(comparison.summary.exportDigestEqual, 3);
  assert.ok(comparison.summary.canvasDrawReductionPercent > 50);
  assert.ok(
    comparison.summary.currentDrawCalls <
      comparison.summary.baselineDrawCalls,
  );
});
