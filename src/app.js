import {
  DATASETS,
  LINES,
  LINE_BY_ID,
  REQUIRED_FIELDS,
  STATION_BY_ID,
  TIME_WINDOWS,
  WINDOW_BY_ID
} from "./data.js";
import { availableStations, createDashboardModel, normalizeState } from "./model.js";
import { createCsvExport, createPngFilename } from "./export.js";
import { createExportCanvas, nearestStation, renderCanvas } from "./canvas.js";
import { loadState, saveState } from "./state.js";

const $ = (selector) => document.querySelector(selector);
const dom = {
  canvas: $("#network-canvas"),
  canvasWrap: $("#canvas-wrap"),
  tooltip: $("#canvas-tooltip"),
  windowFilter: $("#window-filter"),
  datasetFilter: $("#dataset-filter"),
  origin: $("#origin-select"),
  destination: $("#destination-select"),
  routeList: $("#route-list"),
  routeDelta: $("#route-delta"),
  segmentTable: $("#segment-table"),
  rawTable: $("#raw-table"),
  qualityCounters: $("#quality-counters"),
  qualityRing: $("#quality-ring"),
  toast: $("#toast")
};

let state = loadState();
let model = createDashboardModel(state);
let resizeFrame = 0;
let toastTimer = 0;

function stationName(id) {
  return STATION_BY_ID.get(id)?.name || "—";
}

function lineText(lineId) {
  return LINE_BY_ID.get(lineId)?.shortName || "—";
}

function lineDots(lineIds) {
  return lineIds
    .map((lineId) => {
      const line = LINE_BY_ID.get(lineId);
      return `<i class="mini-line-dot" style="--line-color:${line.color}" title="${line.shortName}"></i>`;
    })
    .join("");
}

function renderFilterButtons() {
  dom.windowFilter.innerHTML = TIME_WINDOWS.map(
    (window) => `
      <button type="button" data-window-id="${window.id}" aria-pressed="false">
        <span>${window.label}</span>
        <small>${window.shortRange}</small>
      </button>`
  ).join("");

  dom.datasetFilter.innerHTML = DATASETS.map(
    (dataset) => `
      <button type="button" data-dataset-id="${dataset.id}" aria-pressed="false">
        ${dataset.shortLabel}
      </button>`
  ).join("");
}

function populateStationSelects() {
  const options = availableStations()
    .map((station) => {
      const lines = station.lines.map((line) => line.shortName).join("/");
      return `<option value="${station.id}">${station.name} · ${lines}</option>`;
    })
    .join("");
  dom.origin.innerHTML = options;
  dom.destination.innerHTML = options;
}

function renderFilterState() {
  dom.windowFilter.querySelectorAll("button").forEach((button) => {
    const active = button.dataset.windowId === state.windowId;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  dom.datasetFilter.querySelectorAll("button").forEach((button) => {
    const active = button.dataset.datasetId === state.datasetId;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  dom.origin.value = state.originId;
  dom.destination.value = state.destinationId;
}

function renderHeader() {
  $("#data-version").textContent = model.dataset.version;
  $("#window-label").textContent = `${model.window.label} · ${model.window.range}`;
  $("#stat-scope").textContent = model.statistics.scope;
  $("#transfer-rule").textContent = `换乘等待 ${model.window.transferMinutes} 分钟`;
  $("#quality-version").textContent = model.dataset.version;
  $("#quality-version").title = model.dataset.description;
  $("#raw-count-label").textContent = `${model.statistics.raw} 条`;
  document.title = `轨脉 · ${model.window.label} · ${model.dataset.label}`;

  $("#line-legend").innerHTML = LINES.map(
    (line) => `
      <span class="legend-item">
        <i style="--line-color:${line.color}"></i>
        <b>${line.id}</b> ${line.shortName}
      </span>`
  ).join("");

  $("#network-counts").textContent =
    `${model.network.stationCount} 站 · ${model.network.operatingSegmentCount} 有效区间`;
  $("#metric-valid-segments").textContent = model.network.operatingSegmentCount;
  $("#metric-stations").textContent = model.network.stationCount;
  $("#metric-closures").textContent = model.network.suspendedSegmentCount;

  const disconnected = model.routes.disconnected.map(stationName);
  const extra = disconnected.length
    ? ` 当前选点不可达，断开节点：${disconnected.join("、")}。`
    : "";
  $("#network-note").textContent = `${model.window.note}${extra}`;
}

function routeCard(route, variant, index) {
  const objective = index === 0 ? "最短时间" : "最少换乘";
  if (!route) {
    const disconnected = model.routes.disconnected.map(stationName);
    return `
      <article class="route-card route-card--${variant} route-card--empty">
        <div class="route-card-head">
          <span class="route-index">0${index + 1}</span>
          <div><span class="route-objective">${objective}</span><h3>不可达</h3></div>
          <span class="route-state">断开</span>
        </div>
        <p>停运区间已剔除后仍无可用路径。</p>
        <div class="disconnected-list">
          ${disconnected.length
            ? disconnected.map((name) => `<span>${name}</span>`).join("")
            : "<span>无可用站点</span>"}
        </div>
      </article>`;
  }

  const legs = route.legs
    .map(
      (leg) => `
        <div class="route-leg">
          <span class="leg-line" style="--line-color:${LINE_BY_ID.get(leg.lineId).color}">
            ${leg.lineId} ${lineText(leg.lineId)}
          </span>
          <span>${leg.stations.map(stationName).join(" → ")}</span>
        </div>`
    )
    .join("");

  return `
    <article class="route-card route-card--${variant}">
      <div class="route-card-head">
        <span class="route-index">0${index + 1}</span>
        <div>
          <span class="route-objective">${objective}</span>
          <h3>${route.totalMinutes}<small>分钟</small></h3>
        </div>
        <div class="route-facts">
          <span><b>${route.transfers}</b> 换乘</span>
          <span><b>${route.stops}</b> 区间</span>
        </div>
      </div>
      <div class="ride-breakdown">
        乘车 ${route.rideMinutes} 分钟 <i></i> 换乘等待 ${route.transferMinutes} 分钟
      </div>
      <div class="route-legs">${legs}</div>
      <div class="route-trail">${route.stationIds.map(stationName).join(" · ")}</div>
    </article>`;
}

function renderRoutes() {
  const shortest = model.routes.shortest;
  const fewest = model.routes.fewest;
  const isSameStation = state.originId === state.destinationId;
  const sameCards = model.routes.samePath && !isSameStation;

  dom.routeList.innerHTML = `
    ${routeCard(shortest, "fast", 0)}
    ${routeCard(fewest, "easy", 1)}
  `;
  dom.routeList.classList.toggle("has-same-path", sameCards);

  if (isSameStation) {
    dom.routeDelta.innerHTML = `<span class="delta-note">起点与终点相同，请选择不同的站点。</span>`;
  } else if (!shortest || !fewest) {
    dom.routeDelta.innerHTML =
      `<span class="delta-note delta-note--warning">未找到可达路径，断开站点已在画布中标红。</span>`;
  } else if (sameCards) {
    dom.routeDelta.innerHTML = `
      <span>两种目标在当前筛选下重合为同一条路径</span>
      <span>总时长 <b>${shortest.totalMinutes}</b> 分钟 · <b>${shortest.transfers}</b> 次换乘</span>`;
  } else {
    const minuteGap = Number((fewest.totalMinutes - shortest.totalMinutes).toFixed(1));
    const transferGap = Math.max(shortest.transfers - fewest.transfers, 0);
    dom.routeDelta.innerHTML = `
      <span>最短时间快 <b>${minuteGap}</b> 分钟</span>
      <span>少换乘省 <b>${transferGap}</b> 次换乘</span>`;
  }
}

function renderSegmentTable() {
  const statusLabels = {
    operating: "运营中",
    suspended: "停运绕行",
    missing: "数据缺失"
  };
  dom.segmentTable.innerHTML = model.lineRows
    .map(
      (segment) => `
        <tr class="segment-row segment-row--${segment.status}">
          <td><span class="line-cell">${lineDots([segment.lineId])}<b>${segment.lineId}</b> ${lineText(segment.lineId)}</span></td>
          <td>${stationName(segment.from)} <span class="route-arrow">↔</span> ${stationName(segment.to)}</td>
          <td class="numeric">${segment.minutes ?? "—"}</td>
          <td class="numeric">${segment.sourceCount || "—"}</td>
          <td><span class="status-tag status-tag--${segment.status}">${statusLabels[segment.status]}</span></td>
        </tr>`
    )
    .join("");

  $("#table-summary").textContent =
    `${model.network.operatingSegmentCount} 运营 · ` +
    `${model.network.suspendedSegmentCount} 停运 · ` +
    `${model.network.missingSegmentCount} 缺失`;
}

function renderQuality() {
  const items = [
    ["原始", model.statistics.raw, "raw"],
    ["去重", model.statistics.duplicate, "duplicate"],
    ["缺失", model.statistics.missing, "missing"],
    ["异常", model.statistics.anomaly, "anomaly"],
    ["有效", model.statistics.valid, "valid"]
  ];
  dom.qualityCounters.innerHTML = items
    .map(
      ([label, value, type]) => `
        <div class="quality-counter quality-counter--${type}">
          <span>${label}</span>
          <strong>${value}</strong>
        </div>`
    )
    .join("");

  $("#quality-rate").textContent = model.quality.rateLabel;
  dom.qualityRing.style.setProperty("--score", model.statistics.integrityRate.toFixed(2));
  dom.qualityRing.classList.toggle(
    "is-warning",
    model.statistics.integrityRate < 80
  );
  $("#quality-equation").textContent = model.quality.equation;
  $("#rules-copy").textContent =
    `去重键：线路 + 起终站；必填字段：${REQUIRED_FIELDS.join("、")}；` +
    `异常规则：未知线路/站点、同站起终、非正时长、时长超过 120 分钟。` +
    `清洗后按无向区间聚合平均分钟数。${model.dataset.description}`;

  const statusLabels = {
    valid: "有效",
    duplicate: "重复",
    missing: "缺失",
    anomaly: "异常"
  };
  dom.rawTable.innerHTML = model.rawAssessments
    .map((assessment) => {
      const record = assessment.record;
      const from = stationName(record.from);
      const to = stationName(record.to);
      return `
        <tr>
          <td class="mono">${record.recordId || "—"}</td>
          <td>${record.lineId || "—"}</td>
          <td>${from} ↔ ${to}</td>
          <td class="numeric">${record.minutes ?? "—"}</td>
          <td><span class="raw-status raw-status--${assessment.status}" title="${assessment.reason}">${statusLabels[assessment.status]}</span></td>
        </tr>`;
    })
    .join("");
}

function renderCanvasSafe() {
  renderCanvas(dom.canvas, model);
}

function render() {
  model = createDashboardModel(state);
  renderFilterState();
  renderHeader();
  renderRoutes();
  renderSegmentTable();
  renderQuality();
  renderCanvasSafe();
}

function applyState(patch, options = {}) {
  state = normalizeState({ ...state, ...patch });
  saveState(state);
  render();
  if (options.toast) showToast(options.toast);
}

function showToast(message) {
  dom.toast.textContent = message;
  dom.toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    dom.toast.classList.remove("is-visible");
  }, 2400);
}

function downloadBlob(blob, filename) {
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportRouteMap() {
  const exportCanvas = createExportCanvas(model);
  exportCanvas.toBlob((blob) => {
    if (!blob) {
      showToast("路线图导出失败，请重试");
      return;
    }
    downloadBlob(blob, createPngFilename(model));
    showToast("路线图已导出，数值与当前屏幕一致");
  }, "image/png");
}

function exportCsv() {
  const { filename, content } = createCsvExport(model);
  downloadBlob(new Blob([content], { type: "text/csv;charset=utf-8" }), filename);
  showToast("明细 CSV 已导出，含当前筛选与质量摘要");
}

function moveTooltip(event, station) {
  if (!station) {
    dom.tooltip.hidden = true;
    dom.canvas.style.cursor = "default";
    return;
  }
  const rect = dom.canvas.getBoundingClientRect();
  const lines = STATION_BY_ID.has(station.id)
    ? LINES.filter((line) => line.stations.includes(station.id))
        .map((line) => line.shortName)
        .join(" / ")
    : "";
  const disconnected = model.routes.disconnected.includes(station.id);
  dom.tooltip.innerHTML =
    `<strong>${station.name}</strong><span>${lines}${disconnected ? " · 断开节点" : ""}</span>`;
  dom.tooltip.style.left = `${event.clientX - rect.left + 16}px`;
  dom.tooltip.style.top = `${event.clientY - rect.top + 16}px`;
  dom.tooltip.hidden = false;
  dom.canvas.style.cursor = "pointer";
}

function bindEvents() {
  dom.windowFilter.addEventListener("click", (event) => {
    const button = event.target.closest("[data-window-id]");
    if (!button || button.dataset.windowId === state.windowId) return;
    const window = WINDOW_BY_ID.get(button.dataset.windowId);
    applyState({ windowId: window.id }, { toast: `已切换到${window.label}，筛选状态已保留` });
  });

  dom.datasetFilter.addEventListener("click", (event) => {
    const button = event.target.closest("[data-dataset-id]");
    if (!button || button.dataset.datasetId === state.datasetId) return;
    applyState({ datasetId: button.dataset.datasetId }, { toast: "原始样本已切换，图形与列表已重算" });
  });

  dom.origin.addEventListener("change", () => applyState({ originId: dom.origin.value }));
  dom.destination.addEventListener("change", () =>
    applyState({ destinationId: dom.destination.value })
  );

  $("#swap-route").addEventListener("click", () => {
    applyState(
      {
        originId: state.destinationId,
        destinationId: state.originId
      },
      { toast: "起点与终点已交换" }
    );
  });

  dom.canvas.addEventListener("pointermove", (event) => {
    const station = nearestStation(dom.canvas, event.clientX, event.clientY);
    moveTooltip(event, station);
  });

  dom.canvas.addEventListener("pointerleave", () => {
    dom.tooltip.hidden = true;
    dom.canvas.style.cursor = "default";
  });

  dom.canvas.addEventListener("click", (event) => {
    const station = nearestStation(dom.canvas, event.clientX, event.clientY);
    if (!station) return;
    const target = event.altKey ? "origin" : "destination";
    const other = target === "origin" ? state.destinationId : state.originId;
    if (station.id === other) {
      showToast("起点与终点不能是同一站");
      return;
    }
    applyState(
      target === "origin" ? { originId: station.id } : { destinationId: station.id },
      { toast: `${target === "origin" ? "起点" : "终点"}已设为 ${station.name}` }
    );
  });

  $("#export-map").addEventListener("click", exportRouteMap);
  $("#export-csv").addEventListener("click", exportCsv);

  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(renderCanvasSafe);
  });
  observer.observe(dom.canvasWrap);
}

function init() {
  renderFilterButtons();
  populateStationSelects();
  bindEvents();
  saveState(state);
  render();
  document.fonts?.ready.then(renderCanvasSafe);
}

init();
