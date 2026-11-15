import {
  DATASETS,
  DEFAULT_DATASET,
  LINE_DEFS,
  formatClock
} from "./data.js";
import {
  ALL_LINE_IDS,
  WINDOW_PRESETS,
  buildViewModel,
  createWindow,
  describeWindow,
  findInterval,
  formatMinutes,
  formatPercent,
  formatSignedMinutes,
  makeDisplaySnapshot,
  makeExportSnapshot,
  windowKey
} from "./core.js";
import {
  STATUS_LABELS,
  STATUS_SHORT_LABELS,
  drawSpaceTimeChart,
  hitTestSegment
} from "./chart.js";
import { renderExportSheet } from "./export.js";

const $ = (id) => document.getElementById(id);

const state = {
  selectedLineIds: [...ALL_LINE_IDS],
  window: { ...WINDOW_PRESETS[1] },
  selectedKey: null,
  hoverKey: null,
  windowMemory: new Map(),
  view: null,
  snapshot: null,
  exportSnapshot: null,
  chartLayout: null
};

const els = {
  heroDate: $("heroDate"),
  heroVersion: $("heroVersion"),
  versionLabel: $("versionLabel"),
  datasetNote: $("datasetNote"),
  exportButton: $("exportButton"),
  lineFilters: $("lineFilters"),
  windowPresets: $("windowPresets"),
  zoomOut: $("zoomOut"),
  zoomIn: $("zoomIn"),
  currentFilterLine: $("currentFilterLine"),
  currentFilterWindow: $("currentFilterWindow"),
  currentFilterSource: $("currentFilterSource"),
  currentFilterVersion: $("currentFilterVersion"),
  chartQualityBadge: $("chartQualityBadge"),
  chartSampleBadge: $("chartSampleBadge"),
  legend: $("legend"),
  canvas: $("chartCanvas"),
  chartStage: $("chartStage"),
  tooltip: $("chartTooltip"),
  chartEmpty: $("chartEmpty"),
  selectionPill: $("selectionPill"),
  rawPlaceholder: $("rawPlaceholder"),
  rawContent: $("rawContent"),
  selectionSummary: $("selectionSummary"),
  rawTableBody: $("rawTableBody"),
  rawMissingNote: $("rawMissingNote"),
  intervalCount: $("intervalCount"),
  intervalTableBody: $("intervalTableBody"),
  intervalTableEmpty: $("intervalTableEmpty"),
  clearSelection: $("clearSelection"),
  dedupeCount: $("dedupeCount"),
  missingCount: $("missingCount"),
  anomalyCount: $("anomalyCount"),
  rawRecordCount: $("rawRecordCount"),
  uniqueRecordCount: $("uniqueRecordCount"),
  expectedCount: $("expectedCount"),
  validIntervalCount: $("validIntervalCount"),
  completenessRing: $("completenessRing"),
  completenessValue: $("completenessValue"),
  canonicalSummary: $("canonicalSummary"),
  averageHeadway: $("averageHeadway"),
  averageScope: $("averageScope"),
  medianHeadway: $("medianHeadway"),
  averageFormula: $("averageFormula"),
  versionBlockValue: $("versionBlockValue"),
  fixtureList: $("fixtureList"),
  footerVersion: $("footerVersion"),
  toast: $("toast")
};

let toastTimer = null;

function showToast(message) {
  window.clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add("visible");
  toastTimer = window.setTimeout(() => els.toast.classList.remove("visible"), 2600);
}

function statusClass(status) {
  return `state-${status === "normal" ? "normal" : status}`;
}

function formatDeviation(seconds) {
  return formatSignedMinutes(seconds);
}

function intervalStatusText(interval) {
  if (interval.status === "missing") {
    return `缺失 ${interval.missingSlots.length} 班`;
  }
  if (interval.status === "duplicate") {
    return `重复 ${interval.duplicateCount} 条`;
  }
  if (interval.status === "anomaly") {
    return `异常 ${formatMinutes(interval.headwaySeconds)}`;
  }
  return "正常";
}

function getWindowFromId(id) {
  const preset = WINDOW_PRESETS.find((item) => item.id === id);
  return preset ? { ...preset } : null;
}

function rememberWindowSelection() {
  state.windowMemory.set(windowKey(state.window), state.selectedKey);
}

function changeWindow(nextWindow) {
  const nextKey = windowKey(nextWindow);
  const currentKey = windowKey(state.window);
  if (nextKey === currentKey) return;
  rememberWindowSelection();
  state.window = { ...nextWindow };
  state.hoverKey = null;
  state.selectedKey = null;
  refresh();
  const cachedKey = state.windowMemory.get(nextKey);
  if (cachedKey && findInterval(state.view, cachedKey)) {
    state.selectedKey = cachedKey;
    refresh();
  }
}

function buildZoomWindow(direction) {
  const span = state.window.endMinute - state.window.startMinute;
  const nextSpan = direction === "out" ? Math.max(60, span - 30) : Math.min(240, span + 30);
  if (nextSpan === span) return null;
  const center = (state.window.startMinute + state.window.endMinute) / 2;
  let start = Math.round((center - nextSpan / 2) / 5) * 5;
  start = Math.max(390, Math.min(630 - nextSpan, start));
  return createWindow(start, start + nextSpan);
}

function setLineSelection(ids) {
  const next = ALL_LINE_IDS.filter((id) => ids.includes(id));
  if (!next.length) {
    showToast("至少保留一条线路");
    return;
  }
  state.selectedLineIds = next;
  if (state.selectedKey) {
    const selected = findInterval(state.view, state.selectedKey);
    if (selected && !next.includes(selected.lineId)) state.selectedKey = null;
  }
  state.windowMemory.set(windowKey(state.window), state.selectedKey);
  refresh();
}

function renderLineFilters() {
  const allSelected = state.selectedLineIds.length === ALL_LINE_IDS.length;
  const allButton = document.createElement("button");
  allButton.type = "button";
  allButton.className = "line-filter all-filter";
  allButton.dataset.lineId = "all";
  allButton.setAttribute("aria-pressed", String(allSelected));
  allButton.innerHTML = '<span class="filter-dot"></span>全部线路';
  allButton.addEventListener("click", () => setLineSelection(ALL_LINE_IDS));
  els.lineFilters.replaceChildren(allButton);

  LINE_DEFS.forEach((line) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "line-filter";
    button.dataset.lineId = line.id;
    button.style.setProperty("--line-color", line.color);
    button.setAttribute("aria-pressed", String(state.selectedLineIds.includes(line.id)));
    button.title = `${line.name} · ${line.station} · ${line.direction}`;
    button.innerHTML = `<span class="filter-dot"></span>${line.name}`;
    button.addEventListener("click", () => {
      if (state.selectedLineIds.length === ALL_LINE_IDS.length) {
        setLineSelection([line.id]);
        return;
      }
      const next = state.selectedLineIds.includes(line.id)
        ? state.selectedLineIds.filter((id) => id !== line.id)
        : [...state.selectedLineIds, line.id];
      setLineSelection(next);
    });
    els.lineFilters.append(button);
  });
}

function renderWindowPresets() {
  els.windowPresets.replaceChildren();
  WINDOW_PRESETS.forEach((preset) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "window-button";
    button.textContent = preset.label;
    button.title = preset.id === "all" ? "查看全部样例时段" : `切换到 ${preset.label}`;
    const active =
      state.window.startMinute === preset.startMinute &&
      state.window.endMinute === preset.endMinute;
    button.setAttribute("aria-pressed", String(active));
    button.addEventListener("click", () => changeWindow(preset));
    els.windowPresets.append(button);
  });
}

function updateFilterStates() {
  const allSelected = state.selectedLineIds.length === ALL_LINE_IDS.length;
  els.lineFilters.querySelectorAll(".line-filter").forEach((button) => {
    const id = button.dataset.lineId;
    const pressed = id === "all" ? allSelected : state.selectedLineIds.includes(id);
    button.setAttribute("aria-pressed", String(pressed));
  });
  els.windowPresets.querySelectorAll(".window-button").forEach((button, index) => {
    const preset = WINDOW_PRESETS[index];
    const active =
      state.window.startMinute === preset.startMinute &&
      state.window.endMinute === preset.endMinute;
    button.setAttribute("aria-pressed", String(active));
  });
  const span = state.window.endMinute - state.window.startMinute;
  els.zoomOut.disabled = span <= 60;
  els.zoomIn.disabled = span >= 240;
}

function renderContext() {
  const snapshot = state.snapshot;
  const allSelected = state.selectedLineIds.length === ALL_LINE_IDS.length;
  els.currentFilterLine.textContent = allSelected
    ? `全部线路 · ${state.selectedLineIds.length} 条`
    : snapshot.filterLineShort;
  els.currentFilterWindow.textContent = `${snapshot.timeWindow} · ${snapshot.validCount} 个有效间隔`;
  els.currentFilterSource.textContent =
    `原始 ${snapshot.rawCount} 条 · 去重后 ${snapshot.canonicalCount} 班`;
  els.currentFilterVersion.textContent = snapshot.dataVersion;
}

function renderLegend() {
  els.legend.innerHTML = state.snapshot.legend
    .map(
      (item) => `
        <div class="legend-item" style="--line-color:${item.color}">
          <span class="legend-swatch"></span>
          <span>${item.name}</span>
          <strong>${item.average}</strong>
          <span>n=${item.validCount}</span>
        </div>
      `
    )
    .join("");
}

function renderQuality() {
  const snapshot = state.snapshot;
  const quality = state.view.quality;
  const issueCount = quality.duplicateCount + quality.missingCount + quality.anomalyCount;
  const hasAnomaly = quality.anomalyCount > 0;

  els.chartQualityBadge.textContent = issueCount
    ? `需关注 ${issueCount} 项数据问题`
    : "数据质量检查通过";
  els.chartQualityBadge.className = `status-badge ${
    issueCount ? (hasAnomaly ? "status-danger" : "status-warn") : "status-ok"
  }`;
  els.chartSampleBadge.textContent = `${snapshot.validCount} 段有效 · ${snapshot.observedCount} 段可观测`;

  els.completenessRing.style.setProperty("--progress", String(quality.completeness));
  els.completenessValue.textContent = snapshot.completeness;
  els.canonicalSummary.textContent =
    `${quality.canonicalCount} / ${quality.expectedCount} 个计划班次`;
  els.dedupeCount.textContent = `${quality.duplicateCount} 条`;
  els.missingCount.textContent = `${quality.missingCount} 班`;
  els.anomalyCount.textContent = `${quality.anomalyCount} 段`;
  els.rawRecordCount.textContent = `${quality.rawRecordCount} 条`;
  els.uniqueRecordCount.textContent = `${quality.canonicalCount} 班`;
  els.expectedCount.textContent = `${quality.expectedCount} 班`;
  els.validIntervalCount.textContent = `${quality.validIntervalCount} 段`;

  els.averageHeadway.textContent = snapshot.average;
  els.averageScope.textContent =
    `n=${snapshot.validCount} 段 · ${snapshot.timeWindow}`;
  els.medianHeadway.textContent = snapshot.median;
  els.averageFormula.textContent =
    `Σ 有效间隔秒数 ÷ ${snapshot.validCount}`;
  els.versionBlockValue.textContent = snapshot.dataVersion;
}

function renderFixtureList() {
  const fullWindow = WINDOW_PRESETS.find((item) => item.id === "all");
  const definitions = [
    { id: "normal", label: "正常组", icon: "✓" },
    { id: "missing", label: "缺失组", icon: "!" },
    { id: "duplicate", label: "重复组", icon: "×" }
  ];
  els.fixtureList.innerHTML = definitions
    .map((definition) => {
      const view = buildViewModel(DATASETS[definition.id], ALL_LINE_IDS, fullWindow);
      const quality = view.quality;
      let detail = `${quality.rawRecordCount} 条原始记录 · 无缺陷`;
      if (definition.id === "missing") {
        detail = `${quality.rawRecordCount} 条原始记录 · ${quality.missingCount} 班缺失`;
      }
      if (definition.id === "duplicate") {
        detail = `${quality.rawRecordCount} 条原始记录 · ${quality.duplicateCount} 条重复`;
      }
      return `
        <div class="fixture-item">
          <span class="fixture-status">${definition.icon}</span>
          <div><span>${definition.label}</span><strong>${detail}</strong></div>
        </div>
      `;
    })
    .join("");
}

function plannedIntervalSeconds(interval) {
  return (
    (interval.second.scheduleIndex - interval.first.scheduleIndex) *
    DEFAULT_DATASET.schedule.slotMinutes *
    60
  );
}

function renderIntervalTable() {
  const lineOrder = new Map(state.view.lines.map((line, index) => [line.id, index]));
  const intervals = [...state.view.intervals].sort(
    (a, b) =>
      lineOrder.get(a.lineId) - lineOrder.get(b.lineId) ||
      a.midpoint - b.midpoint
  );
  els.intervalCount.textContent = `${intervals.length} 段`;
  els.intervalTableEmpty.hidden = intervals.length > 0;
  els.clearSelection.hidden = !state.selectedKey;

  els.intervalTableBody.innerHTML = intervals
    .map((interval) => {
      const planned = plannedIntervalSeconds(interval);
      const planDelta = interval.headwaySeconds - planned;
      const selected = interval.key === state.selectedKey;
      const statusText =
        interval.status === "missing"
          ? `缺失 ${interval.missingSlots.length}`
          : interval.status === "duplicate"
            ? `重复 ${interval.duplicateCount}`
            : STATUS_SHORT_LABELS[interval.status];
      return `
        <tr data-key="${interval.key}" tabindex="0"
            class="${selected ? "selected" : ""} ${interval.status === "anomaly" ? "anomaly-row" : ""}">
          <td>
            <span class="line-cell" style="--line-color:${interval.line.color}">
              <span class="table-line-dot"></span>${interval.line.name}
            </span>
          </td>
          <td class="interval-time">${formatClock(interval.startMinute)} – ${formatClock(interval.endMinute)}</td>
          <td class="headway-value">${formatMinutes(interval.headwaySeconds)}</td>
          <td class="headway-value">${formatDeviation(planDelta)}</td>
          <td><span class="state-tag ${statusClass(interval.status)}">${statusText}</span></td>
          <td><span class="raw-count">${interval.records.length} 行</span></td>
        </tr>
      `;
    })
    .join("");
}

function renderRawPanel() {
  const interval = state.selectedKey
    ? findInterval(state.view, state.selectedKey)
    : null;
  const hasSelection = Boolean(interval);
  els.rawPlaceholder.hidden = hasSelection;
  els.rawContent.hidden = !hasSelection;
  els.selectionPill.classList.toggle("active", hasSelection);

  if (!interval) {
    els.selectionPill.textContent = "未选择间隔";
    els.selectionSummary.replaceChildren();
    els.rawTableBody.replaceChildren();
    els.rawMissingNote.hidden = true;
    return;
  }

  els.selectionPill.textContent =
    `${interval.line.name} · ${formatClock(interval.startMinute)}–${formatClock(interval.endMinute)}`;
  els.selectionSummary.innerHTML = `
    <span class="summary-dot" style="--line-color:${interval.line.color}"></span>
    <strong>${interval.line.name} · ${interval.line.station}</strong>
    <span>${formatClock(interval.startMinute)} → ${formatClock(interval.endMinute)}</span>
    <span class="summary-separator">|</span>
    <strong>${formatMinutes(interval.headwaySeconds)}</strong>
    <span class="state-tag ${statusClass(interval.status)}">${STATUS_LABELS[interval.status]}</span>
    <span>原始 ${interval.records.length} 行</span>
  `;

  const actualRows = interval.records
    .slice()
    .sort((a, b) => Date.parse(a.arrivedAt) - Date.parse(b.arrivedAt))
    .map((record) => {
      const deviation =
        (Date.parse(record.arrivedAt) - Date.parse(record.scheduledAt)) / 1000;
      const status = record.duplicate
        ? '<span class="state-tag state-discarded">重复 · 剔除</span>'
        : '<span class="state-tag state-normal">采用</span>';
      return `
        <tr class="${record.duplicate ? "duplicate-row" : ""}">
          <td><span class="interval-time">${record.id}</span></td>
          <td>${record.serviceKey}</td>
          <td>${formatClock(record.scheduledAt)}</td>
          <td>${formatClock(record.arrivedAt)}</td>
          <td class="headway-value">${formatDeviation(deviation)}</td>
          <td>${record.vehicle}</td>
          <td>${status}</td>
        </tr>
      `;
    });

  const missingRows = interval.missingSlots.map((slot) => `
    <tr class="state-missing-row">
      <td><span class="interval-time">—</span></td>
      <td>${interval.line.id}-${String(slot.index + 1).padStart(3, "0")}</td>
      <td>${formatClock(slot.minute)}</td>
      <td>—</td>
      <td>—</td>
      <td>—</td>
      <td><span class="state-tag state-missing">缺失 · 无记录</span></td>
    </tr>
  `);

  els.rawTableBody.innerHTML = [...actualRows, ...missingRows].join("");
  els.rawMissingNote.hidden = interval.missingSlots.length === 0;
  if (interval.missingSlots.length) {
    const times = interval.missingSlots.map((slot) => formatClock(slot.minute)).join("、");
    els.rawMissingNote.textContent =
      `该跨度含 ${interval.missingSlots.length} 个计划班次缺失（${times}），无原始记录；图中以虚线菱形标出，缺失段不进入平均间隔。`;
  }
}

function updateStaticMeta() {
  const dataset = DEFAULT_DATASET;
  els.heroDate.textContent = dataset.sampleDate;
  els.heroVersion.textContent = dataset.version;
  els.versionLabel.textContent = dataset.version;
  els.datasetNote.textContent = `${dataset.profile === "combined" ? "综合样例" : "内置样例"} · 可完整复算`;
  els.footerVersion.textContent = `${dataset.version} · ${dataset.timezone}`;
}

function drawMainChart() {
  const canvas = els.canvas;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pixelWidth = Math.round(rect.width * dpr);
  const pixelHeight = Math.round(rect.height * dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  state.chartLayout = drawSpaceTimeChart(
    ctx,
    rect.width,
    rect.height,
    state.view,
    { selectedKey: state.selectedKey, hoverKey: state.hoverKey }
  );
  els.chartEmpty.hidden = state.view.intervals.length > 0;
}

function refresh() {
  state.view = buildViewModel(
    DEFAULT_DATASET,
    state.selectedLineIds,
    state.window
  );
  if (state.selectedKey && !findInterval(state.view, state.selectedKey)) {
    state.selectedKey = null;
  }
  state.snapshot = makeDisplaySnapshot(state.view);
  state.exportSnapshot = makeExportSnapshot(state.view);

  updateFilterStates();
  renderContext();
  renderLegend();
  renderQuality();
  renderIntervalTable();
  renderRawPanel();
  drawMainChart();
  els.exportButton.disabled = state.view.intervals.length === 0;
}

function hideTooltip() {
  els.tooltip.classList.remove("visible");
  els.canvas.style.cursor = "crosshair";
}

function selectInterval(key) {
  if (!findInterval(state.view, key)) return;
  state.selectedKey = key;
  state.windowMemory.set(windowKey(state.window), key);
  hideTooltip();
  refresh();
}

function clearSelection() {
  state.selectedKey = null;
  state.windowMemory.set(windowKey(state.window), null);
  hideTooltip();
  refresh();
}

function pointerPosition(event) {
  const rect = els.canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    width: rect.width,
    height: rect.height
  };
}

function tooltipMarkup(interval) {
  const detail =
    interval.status === "missing"
      ? `缺失 ${interval.missingSlots.length} 个计划班次`
      : interval.status === "duplicate"
        ? `重复记录 ${interval.duplicateCount} 条，已去重`
        : interval.status === "anomaly"
          ? "间隔超出 6–20 分阈值"
          : "有效观测间隔";
  return `
    <strong>${interval.line.name} · ${interval.line.station}</strong>
    ${formatClock(interval.startMinute)} → ${formatClock(interval.endMinute)}
    · ${formatMinutes(interval.headwaySeconds)}<br>
    ${detail}<br>
    <small>点击查看 ${interval.records.length} 条原始记录</small>
  `;
}

function handlePointerMove(event) {
  const point = pointerPosition(event);
  const segment = hitTestSegment(state.chartLayout, point.x, point.y);
  const nextKey = segment?.key ?? null;
  if (nextKey !== state.hoverKey) {
    state.hoverKey = nextKey;
    drawMainChart();
  }

  if (!segment) {
    hideTooltip();
    return;
  }

  const tooltipX = Math.max(105, Math.min(point.width - 105, point.x));
  const tooltipY = Math.max(72, point.y - 9);
  els.tooltip.style.left = `${tooltipX}px`;
  els.tooltip.style.top = `${tooltipY}px`;
  els.tooltip.innerHTML = tooltipMarkup(segment.interval);
  els.tooltip.classList.add("visible");
  els.canvas.style.cursor = "pointer";
}

function handleChartClick(event) {
  const point = pointerPosition(event);
  const segment = hitTestSegment(state.chartLayout, point.x, point.y);
  if (segment) selectInterval(segment.key);
}

function bindChartEvents() {
  els.canvas.addEventListener("mousemove", handlePointerMove);
  els.canvas.addEventListener("mouseleave", () => {
    state.hoverKey = null;
    hideTooltip();
    drawMainChart();
  });
  els.canvas.addEventListener("click", handleChartClick);
}

function bindTableEvents() {
  els.intervalTableBody.addEventListener("click", (event) => {
    const row = event.target.closest("tr[data-key]");
    if (row) selectInterval(row.dataset.key);
  });
  els.intervalTableBody.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest("tr[data-key]");
    if (!row) return;
    event.preventDefault();
    selectInterval(row.dataset.key);
  });
}

function downloadCanvas(canvas, filename) {
  canvas.toBlob((blob) => {
    if (!blob) {
      showToast("导出失败，请重试");
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    showToast("PNG 已导出，统计数值与当前屏幕一致");
  }, "image/png");
}

function exportCurrentWindow() {
  if (!state.view.intervals.length) {
    showToast("当前窗口没有可导出的间隔");
    return;
  }
  const canvas = renderExportSheet(state.view, state.exportSnapshot, {
    selectedKey: state.selectedKey
  });
  const snapshot = structuredClone(state.exportSnapshot);
  window.__EXPORT_AUDIT__ = {
    snapshot,
    width: canvas.width,
    height: canvas.height,
    timeWindow: state.view.windowLabel,
    selectedKey: state.selectedKey,
    exportedAt: new Date().toISOString()
  };
  const safeWindow = state.view.windowLabel.replace("–", "-").replace(":", "");
  downloadCanvas(canvas, `headway_${safeWindow}_${DEFAULT_DATASET.version}.png`);
}

function bindControls() {
  els.zoomOut.addEventListener("click", () => {
    const next = buildZoomWindow("out");
    if (next) changeWindow(next);
  });
  els.zoomIn.addEventListener("click", () => {
    const next = buildZoomWindow("in");
    if (next) changeWindow(next);
  });
  els.clearSelection.addEventListener("click", clearSelection);
  els.exportButton.addEventListener("click", exportCurrentWindow);
}

function exposeDebugApi() {
  window.__headwayApp = {
    getState: () => ({
      selectedLineIds: [...state.selectedLineIds],
      window: { ...state.window },
      selectedKey: state.selectedKey
    }),
    getSnapshot: () => structuredClone(state.snapshot),
    getExportSnapshot: () => structuredClone(state.exportSnapshot),
    getView: () => state.view,
    getFixtures: () => DATASETS,
    setLineFilter: (ids) => setLineSelection(ids),
    setWindowById: (id) => {
      const next = getWindowFromId(id);
      if (next) changeWindow(next);
    },
    selectInterval,
    clearSelection,
    exportCurrentWindow
  };
}

function init() {
  updateStaticMeta();
  renderLineFilters();
  renderWindowPresets();
  renderFixtureList();
  bindChartEvents();
  bindTableEvents();
  bindControls();
  exposeDebugApi();
  refresh();
  new ResizeObserver(() => drawMainChart()).observe(els.chartStage);
  document.fonts?.ready.then(() => {
    drawMainChart();
  });
  document.documentElement.dataset.ready = "true";
}

init();
