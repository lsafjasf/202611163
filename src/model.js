import { DATASET_BY_ID, STATIONS, STATION_BY_ID, TIME_WINDOWS, WINDOW_BY_ID } from "./data.js";
import { buildDatasetView, STATION_LINES } from "./pipeline.js";
import { calculateRoutes } from "./routing.js";

export const DEFAULT_STATE = Object.freeze({
  windowId: "day",
  datasetId: "normal",
  originId: "beigang",
  destinationId: "huizhan"
});

export function normalizeState(candidate = {}) {
  return {
    windowId: WINDOW_BY_ID.has(candidate.windowId)
      ? candidate.windowId
      : DEFAULT_STATE.windowId,
    datasetId: DATASET_BY_ID.has(candidate.datasetId)
      ? candidate.datasetId
      : DEFAULT_STATE.datasetId,
    originId: STATION_BY_ID.has(candidate.originId)
      ? candidate.originId
      : DEFAULT_STATE.originId,
    destinationId: STATION_BY_ID.has(candidate.destinationId)
      ? candidate.destinationId
      : DEFAULT_STATE.destinationId
  };
}

export function createDashboardModel(candidateState) {
  const state = normalizeState(candidateState);
  const datasetView = buildDatasetView(state.datasetId, state.windowId);
  const routes = calculateRoutes(
    state.originId,
    state.destinationId,
    datasetView.window,
    datasetView.network
  );
  const rawAssessments = datasetView.cleaned.assessments.map((assessment, index) => ({
    ...assessment,
    rawIndex: assessment.rawIndex ?? index
  }));
  const disconnectedSet = new Set(routes.disconnected);

  const stationRows = STATIONS.map((station) => ({
    ...station,
    lines: STATION_LINES.get(station.id),
    reachable: !disconnectedSet.has(station.id)
  }));

  return {
    state,
    dataset: datasetView.dataset,
    window: datasetView.window,
    cleaned: datasetView.cleaned,
    network: datasetView.network,
    statistics: datasetView.statistics,
    routes,
    rawAssessments,
    stationRows,
    lineRows: datasetView.network.segmentRows,
    quality: {
      ...datasetView.statistics,
      rateLabel: `${datasetView.statistics.integrityRate.toFixed(1)}%`,
      equation:
        `${datasetView.cleaned.rawCount} 原始记录 − ` +
        `${datasetView.cleaned.counts.deduplicated} 重复 − ` +
        `${datasetView.cleaned.counts.missing} 缺失 − ` +
        `${datasetView.cleaned.counts.anomaly} 异常 = ` +
        `${datasetView.cleaned.counts.valid} 有效记录`
    },
    filterLabel:
      `${datasetView.window.label} ${datasetView.window.range} · ` +
      `${datasetView.dataset.label} · ${STATION_BY_ID.get(state.originId).name} → ` +
      `${STATION_BY_ID.get(state.destinationId).name}`
  };
}

export function availableStations() {
  return STATIONS.map((station) => ({
    id: station.id,
    name: station.name,
    lines: STATION_LINES.get(station.id)
  }));
}

export function windows() {
  return TIME_WINDOWS;
}
