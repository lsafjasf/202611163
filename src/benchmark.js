import { replayRecording } from "./engine.js";
import { buildScenarios } from "./scenarios.js";
import { createRenderer } from "./renderer.js";

function createCountingContext() {
  const gradient = () => ({ addColorStop() {} });
  const noop = () => {};
  return {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "",
    globalAlpha: 1,
    shadowColor: "",
    shadowBlur: 0,
    fillRect: noop,
    strokeRect: noop,
    clearRect: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    fill: noop,
    stroke: noop,
    save: noop,
    restore: noop,
    fillText: noop,
    createLinearGradient: gradient,
    createRadialGradient: gradient,
  };
}

function digest(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function digestRecording(recording) {
  return digest(JSON.stringify(recording));
}

function sampleStates(states, limit = 180) {
  if (states.length <= limit) {
    return states;
  }
  const result = [];
  for (let index = 0; index < limit; index += 1) {
    const sourceIndex = Math.round(
      (index / (limit - 1)) * (states.length - 1),
    );
    result.push(states[sourceIndex]);
  }
  return result;
}

function benchmarkRender(replay, profileId) {
  const renderer = createRenderer(profileId);
  const ctx = createCountingContext();
  const frames = sampleStates(replay.states);
  renderer.resetMetrics();
  const started = globalThis.performance?.now?.() ?? Date.now();
  for (const state of frames) {
    renderer.render({
      ctx,
      width: 960,
      height: 540,
      state,
      tick: state.tick,
      validation: replay,
      mode: "audit",
    });
  }
  const wallMs = (globalThis.performance?.now?.() ?? Date.now()) - started;
  const metrics = renderer.metrics;
  const frameCount = Math.max(1, metrics.frames);
  return {
    profile: profileId,
    frames: metrics.frames,
    wallMs: Number(wallMs.toFixed(3)),
    drawCalls: metrics.drawCalls,
    drawCallsPerFrame: Number((metrics.drawCalls / frameCount).toFixed(2)),
    particleDraws: metrics.particleDraws,
    particleDrawsPerFrame: Number(
      (metrics.particleDraws / frameCount).toFixed(2),
    ),
    gradientCalls: metrics.gradientCalls,
    shadowCalls: metrics.shadowCalls,
    peakLiveShapes: metrics.peakLiveShapes,
    renderMsPerFrame: Number((metrics.renderMs / frameCount).toFixed(3)),
    resourceUnits:
      metrics.drawCalls +
      replay.states.length +
      replay.timeline.length +
      replay.stats.randomChecks,
  };
}

export function runScenarioAudit(scenario, profileId) {
  const replay = replayRecording(scenario.recording);
  const render = benchmarkRender(replay, profileId);
  return {
    id: scenario.id,
    label: scenario.label,
    expectedPass: scenario.shouldPass,
    recording: {
      seed: scenario.recording.seed,
      endTick: scenario.recording.endTick,
      inputEvents: scenario.recording.inputs.length,
      randomRows: scenario.recording.random.length,
      tickHashes: scenario.recording.tickHashes.length,
      digest: digestRecording(scenario.recording),
    },
    result: {
      ok: replay.ok,
      status: replay.status,
      finalHash: replay.finalHash,
      expectedFinalHash: replay.expectedFinalHash,
      score: replay.finalState?.score ?? null,
      lives: replay.finalState?.lives ?? null,
      firstDivergence: replay.firstDivergence
        ? { ...replay.firstDivergence }
        : null,
      firstRandomDivergence: replay.firstRandomDivergence
        ? { ...replay.firstRandomDivergence }
        : null,
      firstStateDivergence: replay.firstStateDivergence
        ? { ...replay.firstStateDivergence }
        : null,
      errorCount: replay.errors.length,
      errorCodes: replay.errors.map((error) => error.code),
      replayMs: Number(replay.elapsedMs.toFixed(3)),
    },
    resources: {
      ...render,
      recordedInputs: scenario.recording.inputs.length,
      randomRows: scenario.recording.random.length,
      tickHashes: scenario.recording.tickHashes.length,
      replayStates: replay.states.length,
      timelineSegments: replay.timeline.length,
      audioNodes: 0,
      recordingBytes: JSON.stringify(scenario.recording).length,
    },
    errors: replay.errors,
  };
}

export function createAuditReport({ profile = "lean", label = "current" } = {}) {
  const scenarios = buildScenarios().map((scenario, index) => {
    if (
      scenario.id === "corrupt" &&
      scenario.recording.inputs.some((input) => input.action === "warp")
    ) {
      const tamperRow = scenario.recording.random[Math.floor(
        scenario.recording.random.length * 0.37,
      )];
      scenario.repro = {
        command:
          "node scripts/scenario-audit.js --profile lean --output artifacts/audit-after.json",
        tamperTick: tamperRow?.tick ?? null,
      };
    }
    const result = runScenarioAudit(scenario, profile);
    return {
      order: index + 1,
      ...result,
      repro: scenario.repro ?? null,
    };
  });
  return {
    schema: "pulse-trace-audit/1",
    generatedAt: new Date().toISOString(),
    label,
    profile,
    engine: {
      tickRate: 60,
      protocol: "pulse-trace/1",
      determinism: "fixed-step + seeded xorshift32 + recorded random rows",
    },
    scenarios,
  };
}
