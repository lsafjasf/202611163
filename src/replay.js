const NUMBER_KEYS = [
  "time",
  "tankA",
  "tankB",
  "pump",
  "pumpTarget",
  "pressure",
  "temperature",
  "load",
  "pumpRpm",
  "hammerAmp",
  "commandRate",
  "holdTime"
];
const FLOW_KEYS = ["feed", "balance", "pumped", "drain"];

export function captureFrame(state) {
  return {
    tick: state.tick,
    time: state.time,
    status: state.status,
    tankA: state.tankA,
    tankB: state.tankB,
    valves: state.valves.map((value) => value),
    valveTargets: state.valveTargets.map((value) => value),
    pump: state.pump,
    pumpTarget: state.pumpTarget,
    pressure: state.pressure,
    temperature: state.temperature,
    load: state.load,
    pumpRpm: state.pumpRpm,
    hammerAmp: state.hammerAmp,
    commandRate: state.commandRate,
    holdTime: state.holdTime,
    flows: { feed: state.flows.feed, balance: state.flows.balance, pumped: state.flows.pumped, drain: state.flows.drain },
    dryRun: state.dryRun,
    inTarget: { a: state.inTarget.a, b: state.inTarget.b },
    tripPrimary: state.trip?.primary ?? null,
    latestChange: state.latestChange
      ? { time: state.latestChange.time, kind: state.latestChange.kind, text: state.latestChange.text }
      : null
  };
}

const mix = (a, b, u) => a + (b - a) * u;

export function interpolateFrames(first, second, u) {
  const t = Math.max(0, Math.min(1, u));
  const output = {
    tick: Math.round(mix(first.tick, second.tick, t)),
    time: mix(first.time, second.time, t),
    status: t < 1 ? first.status : second.status,
    valves: first.valves.map((value, index) => mix(value, second.valves[index], t)),
    valveTargets: first.valveTargets.map((value, index) => mix(value, second.valveTargets[index], t)),
    flows: {},
    dryRun: t < 0.5 ? first.dryRun : second.dryRun,
    inTarget: t < 0.5 ? { ...first.inTarget } : { ...second.inTarget },
    tripPrimary: t < 1 ? first.tripPrimary : second.tripPrimary,
    latestChange: t < 0.5 ? first.latestChange : second.latestChange
  };
  for (const key of NUMBER_KEYS) output[key] = mix(first[key], second[key], t);
  for (const key of FLOW_KEYS) output.flows[key] = mix(first.flows[key], second.flows[key], t);
  return output;
}

export function sampleFrames(frames, time) {
  if (!frames.length) return null;
  if (frames.length === 1 || time <= frames[0].time) return { ...frames[0] };
  const last = frames[frames.length - 1];
  if (time >= last.time) return { ...last };
  let low = 0;
  let high = frames.length - 1;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (frames[middle].time <= time) low = middle;
    else high = middle;
  }
  const span = frames[high].time - frames[low].time;
  const u = span > 0 ? (time - frames[low].time) / span : 0;
  return interpolateFrames(frames[low], frames[high], u);
}

export function frameContinuity(frames) {
  if (frames.length < 3) return { passed: false, maxStep: 0, maxPressureStep: 0, maxLevelStep: 0 };
  let maxStep = 0;
  let maxPressureStep = 0;
  let maxLevelStep = 0;
  for (let i = 1; i < frames.length; i += 1) {
    const a = frames[i - 1];
    const b = frames[i];
    maxPressureStep = Math.max(maxPressureStep, Math.abs(a.pressure - b.pressure));
    maxLevelStep = Math.max(maxLevelStep, Math.abs(a.tankA - b.tankA), Math.abs(a.tankB - b.tankB));
    for (let sample = 1; sample <= 4; sample += 1) {
      const before = interpolateFrames(a, b, (sample - 1) / 4);
      const after = interpolateFrames(a, b, sample / 4);
      maxStep = Math.max(
        maxStep,
        Math.abs(after.tankA - before.tankA),
        Math.abs(after.tankB - before.tankB),
        Math.abs(after.valves[0] - before.valves[0])
      );
    }
  }
  return {
    passed: maxStep < 0.01 && maxPressureStep < 260,
    maxStep,
    maxPressureStep,
    maxLevelStep
  };
}
