import {
  formatClock,
  formatDuration,
  formatPercent,
  formatSigned,
  formatValue,
  SENSORS,
  STAT_DEFINITION,
  WINDOW_PRESETS,
} from "./config.js";
import {
  computeView,
  createDefaultCalibration,
  cleanDataset,
  SENSOR_IDS,
  updateAnchor,
} from "./engine.js";
import {
  applyWindowPreset,
  ensureDatasetState,
  getActiveDatasetState,
  restoreWorkspace,
  setActiveDataset,
  setCustomWindow,
  STORAGE_KEY,
} from "./state.js";
import { renderChart, renderComparisonCanvas } from "./chart.js";
import {
  buildCalibrationCsv,
  buildRawCsv,
  downloadText,
  durationText,
  exportFilename,
  windowLabel,
} from "./export.js";

const $ = (selector) => document.querySelector(selector);
const dom = {
  loading: $("#loading"),
  main: $("#main"),
  topVersion: $("#top-version"),
  topClock: $("#top-clock"),
  heroVersion: $("#hero-version"),
  heroSource: $("#hero-source"),
  datasetTabs: $("#dataset-tabs"),
  conditionChips: $("#condition-chips"),
  timeline: $("#timeline"),
  timelineSelection: $("#timeline-selection"),
  timelineTicks: $("#timeline-ticks"),
  handleStart: $("#handle-start"),
  handleEnd: $("#handle-end"),
  windowLabel: $("#window-label"),
  windowDuration: $("#window-duration"),
  customWindowHint: $("#custom-window-hint"),
  sensorToggles: $("#sensor-toggles"),
  anomalyToggle: $("#anomaly-toggle"),
  filteredBadge: $("#filtered-badge"),
  metricCalMae: $("#metric-cal-mae"),
  metricRawMae: $("#metric-raw-mae"),
  metricCalMax: $("#metric-cal-max"),
  metricRawMax: $("#metric-raw-max"),
  metricImprovement: $("#metric-improvement"),
  metricImprovementTag: $("#metric-improvement-tag"),
  metricSamples: $("#metric-samples"),
  metricCoverage: $("#metric-coverage"),
  chart: $("#chart"),
  chartScope: $("#chart-scope"),
  chartFormula: $("#chart-formula"),
  qualityCoverage: $("#quality-coverage"),
  qualityDuplicates: $("#quality-duplicates"),
  qualityMissing: $("#quality-missing"),
  qualityAnomalies: $("#quality-anomalies"),
  qualityWindow: $("#quality-window"),
  qualityMethod: $("#quality-method"),
  sensorSelector: $("#sensor-selector"),
  anchorList: $("#anchor-list"),
  resetCalibration: $("#reset-calibration"),
  definitionList: $("#definition-list"),
  definitionVersion: $("#definition-version"),
  definitionSource: $("#definition-source"),
  tableSummary: $("#table-summary"),
  tableBody: $("#table-body"),
  tableRowCount: $("#table-row-count"),
  exportRaw: $("#export-raw"),
  exportCsv: $("#export-csv"),
  exportPng: $("#export-png"),
  toast: $("#toast"),
};

let manifest;
let datasets = [];
let workspace;
let view;
let cleanCache = new Map();
let chartGeometry = null;
let hoverSlot = null;
let selectedAnchorId = null;
let anchorDrag = null;
let timelineDrag = null;
let toastTimer;

function activeDataset() {
  return datasets.find((dataset) => dataset.id === workspace.activeDatasetId) ?? datasets[0];
}

function activeClean() {
  const dataset = activeDataset();
  if (!cleanCache.has(dataset.id)) cleanCache.set(dataset.id, cleanDataset(dataset));
  return cleanCache.get(dataset.id);
}

function activeDatasetState() {
  return getActiveDatasetState(workspace, activeDataset());
}

function ensureCalibration() {
  const state = activeDatasetState();
  if (!state.calibration) {
    state.calibration = createDefaultCalibration(activeClean());
  }
  for (const sensor of SENSOR_IDS) {
    state.calibration[sensor] = (state.calibration[sensor] ?? []).map((anchor, index) => ({
      id: anchor.id ?? `${sensor}-anchor-${index + 1}`,
      slot: Number(anchor.slot) || 0,
      targetError: Number(anchor.targetError) || 0,
    }));
  }
  return state.calibration;
}

function buildView() {
  const dataset = activeDataset();
  const state = activeDatasetState();
  const calibration = ensureCalibration();
  const selected = SENSOR_IDS.filter((sensor) => workspace.sensors[sensor]);
  if (!selected.length) {
    workspace.sensors[firstSensorId()] = true;
    selected.push(firstSensorId());
  }
  if (!selected.includes(workspace.activeSensor)) {
    workspace.activeSensor = selected[0];
  }
  return computeView(dataset, activeClean(), {
    startSlot: state.window.start,
    endSlot: state.window.end,
    sensorIds: selected,
    excludeAnomalies: workspace.excludeAnomalies,
    calibration,
    activeSensor: workspace.activeSensor,
  });
}

function firstSensorId() {
  return SENSOR_IDS[0];
}

function saveWorkspace() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
  } catch {
    return false;
  }
  return true;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function sensorMeta(id) {
  return SENSORS.find((sensor) => sensor.id === id);
}

function toast(message) {
  window.clearTimeout(toastTimer);
  dom.toast.textContent = message;
  dom.toast.classList.add("show");
  toastTimer = window.setTimeout(() => dom.toast.classList.remove("show"), 2600);
}

function drawChartOnly() {
  chartGeometry = renderChart(dom.chart, view, {
    hoverSlot,
    selectedAnchorId,
  });
}

function renderAll({ persist = true } = {}) {
  ensureCalibration();
  view = buildView();
  renderHeader();
  renderDatasetTabs();
  renderFilter();
  renderMetrics();
  renderQuality();
  renderCalibration();
  renderTable();
  drawChartOnly();
  if (persist) saveWorkspace();
}

function renderHeader() {
  const dataset = activeDataset();
  dom.topVersion.textContent = dataset.version;
  dom.heroVersion.textContent = dataset.version;
  dom.heroSource.textContent = `${dataset.source} · ${dataset.description}`;
  dom.definitionVersion.textContent = dataset.version;
  dom.definitionSource.textContent = `${dataset.source}；原始 ${dataset.readings.length} 行 / 参考 ${dataset.reference.length} 点。`;
  dom.topClock.textContent = dataset.day.replaceAll("-", ".");
}

function renderDatasetTabs() {
  dom.datasetTabs.innerHTML = datasets.map((dataset, index) => {
    const selected = dataset.id === workspace.activeDatasetId;
    return `
      <button class="dataset-tab" type="button" role="tab" data-dataset="${escapeHtml(dataset.id)}"
        aria-selected="${selected}" aria-controls="chart">
        <span class="tab-top">
          <strong>${escapeHtml(dataset.title)}</strong>
          <span class="tab-index">0${index + 1}</span>
        </span>
        <p>${escapeHtml(dataset.description)}</p>
        <span class="tab-quality">${escapeHtml(dataset.qualityHint)}</span>
        <span class="tab-version">${escapeHtml(dataset.version)}</span>
      </button>
    `;
  }).join("");
}

function renderFilter() {
  const dataset = activeDataset();
  const state = activeDatasetState();
  const last = dataset.expectedSlots - 1;
  const start = state.window.start;
  const end = state.window.end;
  const startPercent = (start / last) * 100;
  const endPercent = (end / last) * 100;

  dom.timelineSelection.style.left = `${startPercent}%`;
  dom.timelineSelection.style.width = `${endPercent - startPercent}%`;
  dom.handleStart.style.left = `${startPercent}%`;
  dom.handleEnd.style.left = `${endPercent}%`;
  dom.handleStart.setAttribute("aria-valuetext", formatClock(start * dataset.intervalSeconds));
  dom.handleEnd.setAttribute("aria-valuetext", formatClock(end * dataset.intervalSeconds));

  dom.timelineTicks.innerHTML = Array.from({ length: 5 }, (_, index) => {
    const slot = Math.round((last * index) / 4);
    return `<span>${formatClock(slot * dataset.intervalSeconds, false)}</span>`;
  }).join("");

  dom.windowLabel.textContent = `${formatClock(start * dataset.intervalSeconds)}–${formatClock(end * dataset.intervalSeconds)}`;
  dom.windowDuration.textContent = `${formatDuration(start, end)} · ${end - start + 1} 个时槽`;
  dom.customWindowHint.textContent = `${formatClock(state.window.customStart * dataset.intervalSeconds, false)}–${formatClock(state.window.customEnd * dataset.intervalSeconds, false)}`;

  const sensorNames = view.selectedSensors.map((id) => sensorMeta(id).label).join("、");
  dom.conditionChips.innerHTML = [
    ["数据集", dataset.title],
    ["窗口", `${formatClock(start * dataset.intervalSeconds)}–${formatClock(end * dataset.intervalSeconds)}`],
    ["时长", formatDuration(start, end)],
    ["传感器", sensorNames],
    ["异常", workspace.excludeAnomalies ? "剔除" : "保留"],
    ["校准", `${SENSORS.reduce((sum, sensor) => sum + (state.calibration[sensor.id]?.length ?? 0), 0)} 个锚点`],
    ["版本", dataset.version],
  ].map(([label, value]) => `
    <span class="condition-chip"><i class="chip-dot"></i>${escapeHtml(label)} <b>${escapeHtml(value)}</b></span>
  `).join("");

  document.querySelectorAll(".preset-button").forEach((button) => {
    const preset = button.dataset.preset;
    button.classList.toggle("active", preset === state.window.mode);
  });

  dom.sensorToggles.innerHTML = SENSORS.map((sensor) => `
    <button class="sensor-toggle ${workspace.sensors[sensor.id] ? "active" : ""}" type="button"
      data-sensor="${sensor.id}" aria-pressed="${workspace.sensors[sensor.id]}"
      style="--toggle-color:${sensor.color}">
      <i></i>${sensor.short}
    </button>
  `).join("");
  dom.anomalyToggle.checked = workspace.excludeAnomalies;
  dom.filteredBadge.textContent = state.window.mode === "custom" ? "CUSTOM WINDOW" : "FILTERED VIEW";
}

function renderMetrics() {
  const stats = view.stats;
  dom.metricCalMae.textContent = formatValue(stats.calibratedMae, 3);
  dom.metricRawMae.textContent = formatValue(stats.rawMae, 3);
  dom.metricCalMax.textContent = formatValue(stats.calibratedMax, 3);
  dom.metricRawMax.textContent = formatValue(stats.rawMax, 3);
  dom.metricImprovement.textContent = Number.isFinite(stats.improvement)
    ? (stats.improvement * 100).toFixed(1)
    : "—";
  dom.metricImprovementTag.textContent = Number.isFinite(stats.improvement)
    ? (stats.improvement >= 0 ? "提升" : "回退")
    : "—";
  dom.metricImprovementTag.classList.toggle("positive", Number.isFinite(stats.improvement) && stats.improvement >= 0);
  dom.metricSamples.textContent = String(stats.n);
  const coverage = view.quality.expectedSensorSlots
    ? view.quality.presentSensorSlots / view.quality.expectedSensorSlots
    : 0;
  dom.metricCoverage.textContent = formatPercent(coverage, 1);

  dom.chartScope.textContent = `${view.title} · ${windowLabel(view)} · ${durationText(view)} · ${sensorNames()} · ${stats.n} 组有效配对`;
  dom.chartFormula.textContent = `MAE = Σ|误差| / ${stats.n || 0}；缺失不插值；重复取中位数；${workspace.excludeAnomalies ? "异常时槽不纳入统计" : "异常时槽保留"}`;
}

function sensorNames() {
  return view.selectedSensors.map((id) => sensorMeta(id).short).join("/");
}

function renderQuality() {
  const quality = view.quality;
  const coverage = quality.expectedSensorSlots
    ? quality.uniqueSensorSlots / quality.expectedSensorSlots
    : 0;
  dom.qualityCoverage.textContent = formatPercent(coverage, 1);
  dom.qualityDuplicates.textContent = String(quality.duplicateRemoved);
  dom.qualityMissing.textContent = String(quality.missing);
  dom.qualityAnomalies.textContent = String(quality.anomalyCount);
  dom.qualityWindow.innerHTML = `
    <span>当前窗口 · 去重 ${quality.duplicateRemovedInWindow}</span>
    <span>缺失 ${quality.missingInWindow}</span>
    <span>异常 ${quality.anomaliesInWindow}</span>
    <span>有效 ${quality.presentSensorSlots}/${quality.expectedSensorSlots}</span>
  `;
  dom.qualityMethod.textContent = `${STAT_DEFINITION.duplicateRule}；${STAT_DEFINITION.missingRule}；${STAT_DEFINITION.anomalyRule}。摘要基于所选样例的全部原始记录实时计算。`;
}

function renderCalibration() {
  const state = activeDatasetState();
  const calibration = state.calibration;
  dom.sensorSelector.innerHTML = SENSORS.map((sensor) => `
    <button class="sensor-option ${workspace.activeSensor === sensor.id ? "active" : ""}" type="button"
      data-calibration-sensor="${sensor.id}" style="--sensor-color:${sensor.color}">
      <span><i></i>${sensor.short}</span>
      <small>${calibration[sensor.id]?.length ?? 0} anchors</small>
    </button>
  `).join("");

  const anchors = calibration[workspace.activeSensor] ?? [];
  const meta = sensorMeta(workspace.activeSensor);
  dom.anchorList.innerHTML = anchors.length
    ? anchors.map((anchor, index) => `
      <div class="anchor-row" style="--sensor-color:${meta.color}">
        <span class="anchor-id">${index + 1}</span>
        <span><b>${formatClock(anchor.slot * activeDataset().intervalSeconds)}</b> · 目标残差</span>
        <b>${formatSigned(anchor.targetError)} °C</b>
      </div>
    `).join("")
    : '<div class="anchor-row"><span class="anchor-id">–</span><span>当前传感器没有可用校准点</span><b>—</b></div>';
}

function renderTable() {
  const rows = view.rows;
  if (!rows.length) {
    dom.tableBody.innerHTML = `
      <tr class="empty-row"><td colspan="9">当前筛选条件没有可显示的对齐记录。请扩大时间窗口、启用传感器或调整异常策略。</td></tr>
    `;
  } else {
    dom.tableBody.innerHTML = rows.map((row) => {
      const meta = sensorMeta(row.sensor);
      const clean = row.sampleCount > 1
        ? `中位数 · 去重 ${row.duplicateRemoved}`
        : "单样本";
      const status = row.anomaly
        ? '<span class="table-tag anomaly">异常 · 已纳入</span>'
        : '<span class="table-tag included">有效</span>';
      return `
        <tr>
          <td class="time-cell">${formatClock(row.t)}</td>
          <td><span class="sensor-label" style="--sensor-color:${meta.color}"><i></i>${meta.label}</span></td>
          <td class="num">${formatValue(row.reference)}</td>
          <td class="num">${formatValue(row.raw)}</td>
          <td class="num">${formatValue(row.calibrated)}</td>
          <td class="num error-value">${formatSigned(row.rawError)}</td>
          <td class="num error-value calibrated">${formatSigned(row.calibratedError)}</td>
          <td><span class="table-tag">${clean}</span></td>
          <td>${status}</td>
        </tr>
      `;
    }).join("");
  }
  dom.tableSummary.textContent = `${windowLabel(view)} · ${durationText(view)} · ${view.selectedSensors.length} 枚传感器 · 去重 ${view.quality.duplicateRemovedInWindow} 条 · 窗口缺失 ${view.quality.missingInWindow} 个`;
  dom.tableRowCount.textContent = `${rows.length} 条对齐记录 / 显示值与导出共用同一模型`;
}

function renderDefinitions() {
  const definitions = [
    ["时间聚合", `${STAT_DEFINITION.intervalSeconds} 秒等间隔时槽；原始采样时刻不做位移。`],
    ["重复处置", STAT_DEFINITION.duplicateRule],
    ["误差口径", STAT_DEFINITION.errorRule],
    ["最大偏差", STAT_DEFINITION.maxRule],
    ["缺失口径", STAT_DEFINITION.missingRule],
    ["异常口径", STAT_DEFINITION.anomalyRule],
    ["范围约束", STAT_DEFINITION.scopeRule],
  ];
  dom.definitionList.innerHTML = definitions.map(([term, description]) => `
    <div><dt>${escapeHtml(term)}</dt><dd>${escapeHtml(description)}</dd></div>
  `).join("");
}

function timelineSlotFromPointer(clientX) {
  const rect = dom.timeline.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  return Math.round(ratio * (activeDataset().expectedSlots - 1));
}

function beginTimelineDrag(handle, event) {
  timelineDrag = handle;
  dom.timeline.classList.add("dragging");
  dom.timeline.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}

function handleTimelineMove(clientX) {
  if (!timelineDrag) return;
  const dataset = activeDataset();
  const state = activeDatasetState();
  const slot = timelineSlotFromPointer(clientX);
  let start = state.window.start;
  let end = state.window.end;
  if (timelineDrag === "start") {
    start = Math.min(slot, end - 1);
  } else {
    end = Math.max(slot, start + 1);
  }
  setCustomWindow(workspace, dataset, start, end);
  hoverSlot = null;
  renderAll({ persist: false });
}

function canvasPoint(event) {
  const rect = dom.chart.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function findAnchor(point) {
  if (!chartGeometry?.anchors) return null;
  let nearest = null;
  for (const anchor of chartGeometry.anchors) {
    const distance = Math.hypot(anchor.x - point.x, anchor.y - point.y);
    if (distance <= 15 && (!nearest || distance < nearest.distance)) {
      nearest = { ...anchor, distance };
    }
  }
  return nearest;
}

function beginAnchorDrag(point, event) {
  const hit = findAnchor(point);
  if (!hit) return false;
  anchorDrag = {
    id: hit.id,
    sensor: view.activeSensor,
    pointerId: event.pointerId,
  };
  selectedAnchorId = hit.id;
  hoverSlot = null;
  dom.chart.classList.add("dragging-anchor");
  dom.chart.setPointerCapture?.(event.pointerId);
  drawChartOnly();
  event.preventDefault();
  return true;
}

function updateAnchorDrag(point) {
  if (!anchorDrag || !chartGeometry) return;
  const state = activeDatasetState();
  const slot = Math.max(
    view.startSlot,
    Math.min(view.endSlot, chartGeometry.xToSlot(point.x)),
  );
  const targetError = chartGeometry.errPxToValue(point.y);
  state.calibration = updateAnchor(
    state.calibration,
    anchorDrag.sensor,
    anchorDrag.id,
    { slot, targetError },
    activeClean().lastSlot,
  );
  renderAll({ persist: false });
}

function finishAnchorDrag() {
  if (!anchorDrag) return;
  anchorDrag = null;
  dom.chart.classList.remove("dragging-anchor");
  saveWorkspace();
  toast("校准点已更新；原始数据结构保持不变。");
}

function updateHover(point) {
  if (!chartGeometry) return;
  const inside = point.x >= chartGeometry.main.left
    && point.x <= chartGeometry.main.right
    && point.y >= chartGeometry.main.top
    && point.y <= chartGeometry.error.bottom;
  const next = inside ? Math.round(chartGeometry.xToSlot(point.x)) : null;
  if (next !== hoverSlot) {
    hoverSlot = next;
    drawChartOnly();
  }
}

function exportComparison() {
  const canvas = renderComparisonCanvas(view);
  canvas.toBlob((blob) => {
    if (!blob) {
      toast("对比图生成失败，请重试。");
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = exportFilename(view, "png");
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1800);
    toast(`已导出 PNG：${view.stats.n} 个有效配对，数值与屏幕一致。`);
  }, "image/png");
}

function resetCalibration() {
  const state = activeDatasetState();
  state.calibration = createDefaultCalibration(activeClean());
  selectedAnchorId = null;
  renderAll();
  toast("已恢复基于当前原始序列的自动锚点。");
}

function bindEvents() {
  dom.datasetTabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-dataset]");
    if (!button) return;
    const dataset = datasets.find((item) => item.id === button.dataset.dataset);
    if (!dataset || dataset.id === workspace.activeDatasetId) return;
    setActiveDataset(workspace, dataset);
    hoverSlot = null;
    selectedAnchorId = null;
    renderAll();
    toast(`已切换到「${dataset.title}」，恢复该数据版本的窗口与校准点。`);
  });

  document.querySelector(".preset-group").addEventListener("click", (event) => {
    const button = event.target.closest("[data-preset]");
    if (!button) return;
    applyWindowPreset(workspace, activeDataset(), button.dataset.preset);
    hoverSlot = null;
    renderAll();
    const preset = WINDOW_PRESETS.find((item) => item.id === button.dataset.preset);
    toast(preset ? `时间窗口：${preset.label}。自定义窗口已保留。` : "已恢复上次自定义窗口。");
  });

  dom.sensorToggles.addEventListener("click", (event) => {
    const button = event.target.closest("[data-sensor]");
    if (!button) return;
    const sensor = button.dataset.sensor;
    const enabled = SENSOR_IDS.filter((id) => workspace.sensors[id]);
    if (workspace.sensors[sensor] && enabled.length === 1) {
      toast("至少保留一枚传感器用于比较。");
      return;
    }
    workspace.sensors[sensor] = !workspace.sensors[sensor];
    if (!workspace.sensors[sensor] && workspace.activeSensor === sensor) {
      workspace.activeSensor = SENSOR_IDS.find((id) => workspace.sensors[id]);
      selectedAnchorId = null;
    }
    renderAll();
  });

  dom.anomalyToggle.addEventListener("change", () => {
    workspace.excludeAnomalies = dom.anomalyToggle.checked;
    renderAll();
    toast(workspace.excludeAnomalies ? "异常时槽已从统计与图形中剔除。" : "异常时槽已保留在统计与图形中。");
  });

  dom.sensorSelector.addEventListener("click", (event) => {
    const button = event.target.closest("[data-calibration-sensor]");
    if (!button) return;
    workspace.activeSensor = button.dataset.calibrationSensor;
    selectedAnchorId = null;
    renderAll();
  });

  dom.resetCalibration.addEventListener("click", resetCalibration);

  dom.timeline.addEventListener("pointerdown", (event) => {
    const handle = event.target.closest(".window-handle");
    if (handle) {
      beginTimelineDrag(handle.id === "handle-start" ? "start" : "end", event);
      return;
    }
    const rect = dom.timeline.getBoundingClientRect();
    const pixel = event.clientX - rect.left;
    const startPixel = (activeDatasetState().window.start / (activeDataset().expectedSlots - 1)) * rect.width;
    const endPixel = (activeDatasetState().window.end / (activeDataset().expectedSlots - 1)) * rect.width;
    beginTimelineDrag(Math.abs(pixel - startPixel) <= Math.abs(pixel - endPixel) ? "start" : "end", event);
    handleTimelineMove(event.clientX);
  });

  document.addEventListener("pointermove", (event) => {
    if (timelineDrag) handleTimelineMove(event.clientX);
  });
  document.addEventListener("pointerup", () => {
    if (timelineDrag) {
      timelineDrag = null;
      dom.timeline.classList.remove("dragging");
      saveWorkspace();
      toast("时间窗口已更新，图形、列表与导出同步。");
    }
    finishAnchorDrag();
  });

  dom.chart.addEventListener("pointerdown", (event) => {
    const point = canvasPoint(event);
    beginAnchorDrag(point, event);
  });
  dom.chart.addEventListener("pointermove", (event) => {
    const point = canvasPoint(event);
    if (anchorDrag) {
      updateAnchorDrag(point);
    } else {
      updateHover(point);
    }
  });
  dom.chart.addEventListener("pointerleave", () => {
    if (anchorDrag) return;
    hoverSlot = null;
    drawChartOnly();
  });
  dom.chart.addEventListener("pointerup", finishAnchorDrag);
  dom.chart.addEventListener("pointercancel", finishAnchorDrag);

  dom.exportRaw.addEventListener("click", () => {
    const dataset = activeDataset();
    downloadText(exportFilename({ ...view, version: dataset.version }, "raw.csv"), buildRawCsv(dataset));
    toast(`已导出 ${dataset.readings.length} 条原始记录；未写入任何校准值。`);
  });
  dom.exportCsv.addEventListener("click", () => {
    downloadText(exportFilename(view, "csv"), buildCalibrationCsv(view));
    toast(`已导出 ${view.rows.length} 条当前视图记录，数值与表格显示一致。`);
  });
  dom.exportPng.addEventListener("click", exportComparison);

  const resizeObserver = new ResizeObserver(() => {
    if (!dom.main.hidden && view) drawChartOnly();
  });
  resizeObserver.observe(dom.chart.parentElement);
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`无法载入 ${url} (${response.status})`);
  return response.json();
}

async function init() {
  try {
    await document.fonts.load('600 16px "Noto Sans SC"');
    manifest = await fetchJson("./data/manifest.json");
    datasets = await Promise.all(manifest.datasets.map((entry) => fetchJson(entry.file)));
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    } catch {
      saved = null;
    }
    workspace = restoreWorkspace(saved, datasets);
    renderDefinitions();
    bindEvents();
    dom.loading.hidden = true;
    dom.main.hidden = false;
    renderAll();
  } catch (error) {
    dom.loading.innerHTML = `
      <strong>载入失败</strong>
      <small>${escapeHtml(error.message)}</small>
      <small>请通过 npm start 启动本地服务器后重试。</small>
    `;
    console.error(error);
  }
}

init();
