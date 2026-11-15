import { SENSOR_IDS } from "./engine.js";
import { WINDOW_PRESETS } from "./config.js";

export const STORAGE_KEY = "trident-calibration-workspace-v1";

function datasetState(dataset) {
  const last = dataset.expectedSlots - 1;
  return {
    window: {
      mode: "full",
      start: 0,
      end: last,
      customStart: 0,
      customEnd: last,
    },
    calibration: null,
  };
}

export function createWorkspace(datasets) {
  return {
    storageVersion: 1,
    activeDatasetId: datasets[0].id,
    activeSensor: "S1",
    sensors: Object.fromEntries(SENSOR_IDS.map((sensor) => [sensor, true])),
    excludeAnomalies: true,
    perDataset: Object.fromEntries(datasets.map((dataset) => [dataset.id, datasetState(dataset)])),
  };
}

export function ensureDatasetState(workspace, dataset) {
  if (!workspace.perDataset[dataset.id]) {
    workspace.perDataset[dataset.id] = datasetState(dataset);
  }
  const state = workspace.perDataset[dataset.id];
  const last = dataset.expectedSlots - 1;
  state.window.start = Math.max(0, Math.min(last, Math.round(state.window.start)));
  state.window.end = Math.max(state.window.start + 1, Math.min(last, Math.round(state.window.end)));
  state.window.customStart = Math.max(0, Math.min(last - 1, Math.round(state.window.customStart)));
  state.window.customEnd = Math.max(state.window.customStart + 1, Math.min(last, Math.round(state.window.customEnd)));
  return state;
}

export function getActiveDatasetState(workspace, dataset) {
  return ensureDatasetState(workspace, dataset);
}

export function setActiveDataset(workspace, dataset) {
  workspace.activeDatasetId = dataset.id;
  return ensureDatasetState(workspace, dataset);
}

export function setCustomWindow(workspace, dataset, start, end) {
  const state = ensureDatasetState(workspace, dataset);
  const last = dataset.expectedSlots - 1;
  const nextStart = Math.max(0, Math.min(last - 1, Math.round(start)));
  const nextEnd = Math.max(nextStart + 1, Math.min(last, Math.round(end)));
  state.window.mode = "custom";
  state.window.start = nextStart;
  state.window.end = nextEnd;
  state.window.customStart = nextStart;
  state.window.customEnd = nextEnd;
  return state;
}

export function applyWindowPreset(workspace, dataset, presetId) {
  const state = ensureDatasetState(workspace, dataset);
  const last = dataset.expectedSlots - 1;

  if (presetId === "custom") {
    state.window.mode = "custom";
    state.window.start = state.window.customStart;
    state.window.end = state.window.customEnd;
    return state;
  }

  const preset = WINDOW_PRESETS.find((item) => item.id === presetId);
  if (!preset) return state;
  const [start, end] = preset.read(last);
  state.window.mode = preset.id;
  state.window.start = start;
  state.window.end = end;
  return state;
}

export function restoreWorkspace(saved, datasets) {
  const workspace = createWorkspace(datasets);
  if (!saved || typeof saved !== "object") return workspace;

  if (datasets.some((dataset) => dataset.id === saved.activeDatasetId)) {
    workspace.activeDatasetId = saved.activeDatasetId;
  }
  if (SENSOR_IDS.includes(saved.activeSensor)) workspace.activeSensor = saved.activeSensor;
  if (saved.sensors && typeof saved.sensors === "object") {
    for (const sensor of SENSOR_IDS) {
      if (typeof saved.sensors[sensor] === "boolean") {
        workspace.sensors[sensor] = saved.sensors[sensor];
      }
    }
  }
  if (!SENSOR_IDS.some((sensor) => workspace.sensors[sensor])) {
    workspace.sensors[SENSOR_IDS[0]] = true;
  }
  if (typeof saved.excludeAnomalies === "boolean") {
    workspace.excludeAnomalies = saved.excludeAnomalies;
  }

  for (const dataset of datasets) {
    const incoming = saved.perDataset?.[dataset.id];
    if (!incoming) continue;
    const state = workspace.perDataset[dataset.id];
    if (incoming.window) {
      for (const field of ["start", "end", "customStart", "customEnd"]) {
        if (Number.isFinite(incoming.window[field])) {
          state.window[field] = incoming.window[field];
        }
      }
      if (typeof incoming.window.mode === "string") state.window.mode = incoming.window.mode;
    }
    if (incoming.calibration && typeof incoming.calibration === "object") {
      state.calibration = incoming.calibration;
    }
    ensureDatasetState(workspace, dataset);
  }

  return workspace;
}
