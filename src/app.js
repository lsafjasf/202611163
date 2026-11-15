import "./style.css";
import {
  DATASET_META,
  OPERATION_SAMPLES,
  RAW_DATASETS,
  THRESHOLDS,
} from "./data.js";
import {
  WINDOW_OPTIONS,
  aggregateRows,
  buildExportCsv,
  cleanDataset,
  filterRows,
  formatOne,
  formatTwo,
  qualityLabel,
  simulateOperation,
  simulateScenario,
} from "./analytics.js";
import { DamRenderer, HydroChart } from "./chart.js";
import { WaterAudio } from "./audio.js";
import { icons, renderShell } from "./template.js";

const STORAGE_KEY = "qinglan-hydro-console-v1";

const DATASETS = Object.fromEntries(
  Object.entries(RAW_DATASETS).map(([key, rows]) => [
    key,
    cleanDataset(rows),
  ]),
);

const datasetKeys = Object.keys(DATASET_META);
const windowKeys = Object.keys(WINDOW_OPTIONS);

function baselineGate(datasetKey) {
  return DATASETS[datasetKey].rows.at(-1).gate;
}

function makeSeedHistory() {
  return Object.fromEntries(
    datasetKeys.map((datasetKey) => [
      datasetKey,
      OPERATION_SAMPLES.map((operation) => ({
        ...operation,
        id: `${datasetKey}-${operation.id}`,
        dataset: datasetKey,
        createdAt: DATASETS[datasetKey].rows[operation.rowIndex].timestamp,
        source: "seed",
      })),
    ]),
  );
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!saved) return null;
    return saved;
  } catch {
    return null;
  }
}

const savedState = loadState();
const state = {
  dataset:
    savedState?.dataset && DATASET_META[savedState.dataset]
      ? savedState.dataset
      : "normal",
  windowKey:
    savedState?.windowKey && WINDOW_OPTIONS[savedState.windowKey]
      ? savedState.windowKey
      : "24h",
  gates: Object.fromEntries(
    datasetKeys.map((key) => [
      key,
      Number.isFinite(savedState?.gates?.[key])
        ? savedState.gates[key]
        : baselineGate(key),
    ]),
  ),
  histories: savedState?.histories || makeSeedHistory(),
  activeHistoryIds: savedState?.activeHistoryIds || {},
  audioEnabled: false,
  dragTimer: null,
};

Object.keys(makeSeedHistory()).forEach((key) => {
  state.histories[key] ||= makeSeedHistory()[key];
});

function persistState() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        dataset: state.dataset,
        windowKey: state.windowKey,
        gates: state.gates,
        histories: state.histories,
        activeHistoryIds: state.activeHistoryIds,
      }),
    );
  } catch {
    // The app remains fully usable when storage is unavailable.
  }
}

function deriveView() {
  const dataset = DATASETS[state.dataset];
  const rows = filterRows(dataset.rows, state.windowKey);
  const gate = state.gates[state.dataset];
  const scenario = simulateScenario(rows, gate);
  return {
    dataset,
    datasetMeta: DATASET_META[state.dataset],
    windowMeta: WINDOW_OPTIONS[state.windowKey],
    rows,
    gate,
    scenario,
    stats: aggregateRows(rows),
    previewActive: Math.abs(gate - scenario.baselineGate) > 0.05,
    activeHistoryId: state.activeHistoryIds?.[state.dataset] || null,
  };
}

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function formatDateTime(timestamp, includeYear = false) {
  return new Intl.DateTimeFormat("zh-CN", {
    ...(includeYear ? { year: "numeric" } : {}),
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  })
    .format(new Date(timestamp))
    .replaceAll("/", ".");
}

function timeOnly(timestamp) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(new Date(timestamp));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function sparkline(values, color) {
  if (!values.length) return "";
  const width = 70;
  const height = 25;
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = maxValue - minValue || 1;
  const points = values.map((value, index) => {
    const x = 2 + (index / Math.max(1, values.length - 1)) * (width - 5);
    const y = 3 + (1 - (value - minValue) / range) * (height - 7);
    return [x, y];
  });
  const path = points
    .map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const area = `${path} L${points.at(-1)[0].toFixed(1)},${height} L2,${height} Z`;
  const gradientId = `spark-${color.replace("#", "")}`;
  return `
    <defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".2"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <path d="${area}" fill="url(#${gradientId})"/>
    <path d="${path}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${points.at(-1)[0].toFixed(1)}" cy="${points.at(-1)[1].toFixed(1)}" r="1.8" fill="${color}" stroke="#fff" stroke-width="1"/>
  `;
}

function setSparkline(id, values, color) {
  const element = document.getElementById(id);
  if (element) element.innerHTML = sparkline(values, color);
}

function statusForRow(row) {
  if (row._anomalyFields.length) return ["anomaly", "异常已插补"];
  if (row._missingFields.length) return ["issue", "缺失已插补"];
  if (row._wasDuplicate) return ["issue", "重复已去重"];
  return ["", "完整"];
}

function operationDerived(history) {
  const dataset = DATASETS[history.dataset];
  return simulateOperation(dataset.rows, history.rowIndex, history.gate);
}

function historyTime(history) {
  const dataset = DATASETS[history.dataset];
  const row =
    dataset.rows[Math.min(history.rowIndex, dataset.rows.length - 1)];
  return formatDateTime(row.timestamp);
}

let hydroChart;
let damRenderer;
const waterAudio = new WaterAudio();

function updateFilters(view) {
  $$("#datasetTabs button").forEach((button) => {
    button.classList.toggle("active", button.dataset.dataset === state.dataset);
  });
  $$("#windowTabs button").forEach((button) => {
    button.classList.toggle("active", button.dataset.window === state.windowKey);
  });
  $("#versionText").textContent = view.datasetMeta.version;
  $("#versionText").title = `更新于 ${view.datasetMeta.updatedAt}`;
}

function updateMetrics(view) {
  const { stats, rows } = view;
  $("#meanInflow").textContent = formatOne(stats.meanInflow);
  $("#meanOutflow").textContent = formatOne(stats.meanOutflow);
  $("#maxLevel").textContent = formatTwo(stats.maxLevel);
  $("#maxDownstream").textContent = formatOne(stats.maxDownstream);

  $("#inflowFoot").innerHTML = `峰值 <strong>${formatOne(stats.maxInflow)}</strong> · ${timeOnly(stats.peakInflowRow.timestamp)}`;
  $("#outflowFoot").innerHTML = `峰值 <strong>${formatOne(stats.maxOutflow)}</strong> · ${timeOnly(stats.peakOutflowRow.timestamp)}`;
  const levelGap = THRESHOLDS.warningLevel - stats.maxLevel;
  $("#levelFoot").innerHTML =
    levelGap >= 0
      ? `距警戒 <strong>${formatTwo(levelGap)} m</strong> · 峰值 ${timeOnly(stats.peakLevelRow.timestamp)}`
      : `<strong>超警戒 ${formatTwo(Math.abs(levelGap))} m</strong> · 需处置`;
  $("#downstreamFoot").innerHTML = `占上限 <strong>${formatOne((stats.maxDownstream / THRESHOLDS.downstreamCap) * 100)}%</strong> · 上限 ${THRESHOLDS.downstreamCap}`;

  setSparkline(
    "inflowSpark",
    rows.map((row) => row.inflow),
    "#1b8b8b",
  );
  setSparkline(
    "outflowSpark",
    rows.map((row) => row.outflow),
    "#e5a044",
  );
  setSparkline(
    "levelSpark",
    rows.map((row) => row.level),
    "#3568cd",
  );
  setSparkline(
    "downstreamSpark",
    rows.map((row) => row.downstream),
    "#d8594b",
  );
}

function updateGate(view) {
  const { scenario, gate, previewActive, stats } = view;
  const levelPeak = Math.max(stats.maxLevel, scenario.maxLevel);
  const downstreamPeak = Math.max(stats.maxDownstream, scenario.maxDownstream);
  const levelAlarm = levelPeak > THRESHOLDS.warningLevel;
  const downstreamAlarm = downstreamPeak > THRESHOLDS.downstreamCap;
  const hasAlarm = levelAlarm || downstreamAlarm;
  const status = $("#gateStatus");
  const banner = $("#alarmBanner");

  status.className = "status-chip";
  banner.className = "alarm-banner";
  if (hasAlarm) {
    status.classList.add("danger");
    status.innerHTML = `<span class="pulse-dot"></span>${levelAlarm && downstreamAlarm ? "双阈值预警" : "阈值预警"}`;
    banner.classList.add("alert");
  } else {
    status.innerHTML = `<span class="pulse-dot"></span>平稳`;
  }

  const messages = [];
  if (levelAlarm) {
    messages.push(
      `水位峰值 <strong>${formatTwo(levelPeak)} m</strong>，超过警戒水位 ${formatTwo(levelPeak - THRESHOLDS.warningLevel)} m`,
    );
  }
  if (downstreamAlarm) {
    messages.push(
      `下游峰值 <strong>${formatOne(downstreamPeak)} m³/s</strong>，超过上限 ${formatOne(downstreamPeak - THRESHOLDS.downstreamCap)} m³/s`,
    );
  }
  if (messages.length) {
    $("#alarmText").innerHTML = `<strong>${previewActive ? "推演触发安全约束。" : "窗口数据触发安全约束。"}</strong> ${messages.join("；")}，请立即调整闸门或复核调度方案。`;
  } else {
    $("#alarmText").innerHTML = `<strong>约束正常。</strong> 当前${previewActive ? "推演" : "窗口"}水位与下游流量均在安全边界内。`;
  }

  $("#gateValue").textContent = formatOne(gate);
  $("#gateSlider").value = String(gate);
  $("#gateSlider").style.setProperty("--slider-fill", `${gate}%`);
  $("#baselineGateText").textContent = `${formatOne(scenario.baselineGate)}%`;
  const delayedLevel = scenario.forecast[THRESHOLDS.delayHours].level;
  const previewLevel = $("#previewLevel");
  previewLevel.textContent = `${formatTwo(delayedLevel)} m`;
  previewLevel.className = `preview-value${delayedLevel > THRESHOLDS.warningLevel ? " danger" : ""}`;
  const previewDownstream = $("#previewDownstream");
  previewDownstream.textContent = `${formatOne(scenario.maxDownstream)} m³/s`;
  previewDownstream.className = `preview-value${scenario.maxDownstream > THRESHOLDS.downstreamCap ? " danger" : ""}`;
  $("#forecastNote").textContent = previewActive
    ? `推演 +6h · 水位延迟 ${THRESHOLDS.delayHours}h 响应`
    : "闸门调整后显示 6h 延迟推演";
  waterAudio.setFlow(gate, scenario.maxDownstream);
}

function updateTable(view) {
  const { rows, datasetMeta, windowMeta } = view;
  const history = state.histories[state.dataset]?.find(
    (item) => item.id === view.activeHistoryId,
  );
  const focusTimestamp = history
    ? DATASETS[state.dataset].rows[history.rowIndex]?.timestamp
    : null;
  const body = $("#dataTableBody");
  body.innerHTML = [...rows]
    .reverse()
    .map((row) => {
      const [stateClass, stateLabel] = statusForRow(row);
      const levelClass =
        row.level > THRESHOLDS.warningLevel
          ? "warn-cell"
          : "level-cell";
      return `
        <tr class="${row.timestamp === focusTimestamp ? "replay-target" : ""}">
          <td>${formatDateTime(row.timestamp)}</td>
          <td>${formatOne(row.inflow)}</td>
          <td>${formatOne(row.outflow)}</td>
          <td class="${levelClass}">${formatTwo(row.level)}</td>
          <td>${formatOne(row.downstream)}</td>
          <td>${formatOne(row.gate)}</td>
          <td><span class="table-state ${stateClass}">${stateLabel}</span></td>
        </tr>
      `;
    })
    .join("");
  $("#detailWindowLabel").textContent = `${datasetMeta.label} · ${windowMeta.label} · ${datasetMeta.version}`;
  $("#detailCount").textContent = String(rows.length);
  $("#detailFoot").textContent = `按时刻倒序 · 导出包含全部 ${rows.length} 条及推演参数`;
  $("#chartWindowTag").textContent = windowMeta.label;
}

function updateQuality(view) {
  const { dataset, datasetMeta } = view;
  const { quality } = dataset;
  const cells = quality.cleanedRows * 5;
  const validCells = Math.max(
    0,
    cells - quality.missingValues - quality.anomalyValues,
  );
  const validPercent = (validCells / cells) * 100;
  const missingPercent = (quality.missingValues / cells) * 100;
  const anomalyPercent = (quality.anomalyValues / cells) * 100;
  $("#qualityRawTag").textContent = `原始 ${quality.rawRows} 条`;
  $("#qualityDedup").textContent = String(quality.duplicateRows);
  $("#qualityMissing").textContent = String(quality.missingValues);
  $("#qualityAnomaly").textContent = String(quality.anomalyValues);
  $("#qualityClean").textContent = String(quality.cleanedRows);
  $("#qualityCompleteness").textContent = `${formatOne(validPercent)}%`;
  $("#qualityBarClean").style.width = `${validPercent}%`;
  $("#qualityBarMissing").style.width = `${missingPercent}%`;
  $("#qualityBarAnomaly").style.width = `${anomalyPercent}%`;
  $("#qualityRawTag").title = datasetMeta.description;
}

function updateHistory(view) {
  const histories = [...(state.histories[state.dataset] || [])].sort(
    (a, b) => b.createdAt - a.createdAt,
  );
  const container = $("#historyList");
  if (!histories.length) {
    container.innerHTML = `<div class="history-empty">拖动闸门后，这里会生成可回放的调整记录。</div>`;
    return;
  }
  container.innerHTML = histories
    .slice(0, 8)
    .map((history) => {
      const result = operationDerived(history);
      const active = history.id === view.activeHistoryId;
      return `
        <div class="history-row ${active ? "active" : ""}" data-history-id="${escapeHtml(history.id)}">
          <div class="history-time">${historyTime(history)}</div>
          <div class="history-main">
            <div class="history-title">${escapeHtml(history.note)} · 开度 ${formatOne(history.gate)}%</div>
            <div class="history-detail">下游 <strong>${formatOne(result.downstream)}</strong> · 3h 后水位 <strong>${formatTwo(result.level)}</strong></div>
          </div>
          <button class="replay-button" type="button" data-replay="${escapeHtml(history.id)}" title="回放此调整" aria-label="回放 ${escapeHtml(history.note)}">
            ${icons.play}
          </button>
        </div>
      `;
    })
    .join("");
}

function runSelfChecks(view) {
  const uniqueTimestamps =
    new Set(view.dataset.rows.map((row) => row.timestamp)).size ===
    view.dataset.rows.length;
  const cleanCheck =
    uniqueTimestamps &&
    view.dataset.quality.rawRows - view.dataset.quality.duplicateRows ===
      view.dataset.quality.cleanedRows;
  const inflowValues = view.rows.map((row) => row.inflow);
  const recomputedMean =
    inflowValues.reduce((total, value) => total + value, 0) /
    inflowValues.length;
  const aggregateCheck =
    Math.abs(recomputedMean - view.stats.meanInflow) < 0.000001 &&
    Math.abs(view.stats.maxLevel - Math.max(...view.rows.map((row) => row.level))) <
      0.000001;
  const csv = buildExportCsv({
    rows: view.rows,
    datasetMeta: view.datasetMeta,
    windowLabel: view.windowMeta.label,
    scenario: view.scenario,
    quality: view.dataset.quality,
  });
  const first = view.rows[0];
  const exportCheck =
    csv.includes(formatOne(first.inflow)) &&
    csv.includes(formatTwo(first.level)) &&
    csv.includes(formatOne(view.scenario.maxDownstream)) &&
    (csv.match(/,完整|,异常已插补|,缺失已插补|,重复已去重/g) || [])
      .length >= view.rows.length;
  const passed = [cleanCheck, aggregateCheck, exportCheck].filter(Boolean).length;
  $("#checkDetail").textContent = `${passed}/3 项通过`;
  $("#checkStatus").textContent =
    passed === 3 ? "聚合与导出一致" : "校验待复核";
  $("#checkStatus").style.color = passed === 3 ? "" : "#b06d1f";
  return { cleanCheck, aggregateCheck, exportCheck };
}

function renderAll() {
  const view = deriveView();
  updateFilters(view);
  updateMetrics(view);
  updateGate(view);
  updateTable(view);
  updateQuality(view);
  updateHistory(view);
  hydroChart?.setData({
    rows: view.rows,
    scenario: view.scenario,
    previewActive: view.previewActive,
  });
  damRenderer?.setData({
    rows: view.rows,
    scenario: view.scenario,
  });
  const checks = runSelfChecks(view);
  window.__hydroViewModel = { ...view, checks };
  return view;
}

function showToast(title, message, iconText = "✓") {
  const stack = $("#toastStack");
  if (stack.children.length >= 3) stack.firstElementChild?.remove();
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `
    <span class="toast-icon">${iconText}</span>
    <span><strong>${escapeHtml(title)}</strong>${escapeHtml(message)}</span>
  `;
  stack.appendChild(toast);
  window.setTimeout(() => {
    toast.classList.add("out");
    window.setTimeout(() => toast.remove(), 200);
  }, 3600);
}

function downloadText(filename, content, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function getExportCsv() {
  const view = deriveView();
  return buildExportCsv({
    rows: view.rows,
    datasetMeta: view.datasetMeta,
    windowLabel: view.windowMeta.label,
    scenario: view.scenario,
    quality: view.dataset.quality,
  });
}

function exportCurrentView() {
  const view = deriveView();
  const csv = getExportCsv();
  const stamp = new Date()
    .toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" })
    .replaceAll(/[^\d]/g, "")
    .slice(0, 12);
  const filename = `qinglan_${state.dataset}_${state.windowKey}_${stamp}.csv`;
  downloadText(filename, csv);
  window.__lastExport = {
    filename,
    csv,
    rowCount: view.rows.length,
    gate: view.gate,
    maxLevel: view.scenario.maxLevel,
    maxDownstream: view.scenario.maxDownstream,
  };
  showToast(
    "当前视图已导出",
    `包含 ${view.rows.length} 条记录，表格数值与 CSV 使用同一格式化口径。`,
  );
}

function exportQualitySummary() {
  const view = deriveView();
  const { quality } = view.dataset;
  const cells = quality.cleanedRows * 5;
  const valid = cells - quality.missingValues - quality.anomalyValues;
  const lines = [
    ["青岚水库数据质量摘要"],
    ["数据版本", view.datasetMeta.version],
    ["样例", view.datasetMeta.label],
    ["更新时间", view.datasetMeta.updatedAt],
    ["原始记录数", quality.rawRows],
    ["去重记录数", quality.duplicateRows],
    ["缺失字段数", quality.missingValues],
    ["异常数值数", quality.anomalyValues],
    ["清洗后记录数", quality.cleanedRows],
    ["有效数据占比", `${formatOne((valid / cells) * 100)}%`],
    ["当前时间窗口", view.windowMeta.label],
    ["清洗规则", "同一时刻保留最后上报；缺失值线性插补；越界值退出统计后插补"],
    ["统计口径", "按小时对齐；流量 m³/s；水位 m；均值与峰值基于清洗后记录"],
  ];
  const csv = `\uFEFF${lines
    .map((row) =>
      row
        .map((value) =>
          /[",\n]/.test(String(value))
            ? `"${String(value).replaceAll('"', '""')}"`
            : value,
        )
        .join(","),
    )
    .join("\r\n")}`;
  const filename = `qinglan_quality_${state.dataset}_${view.datasetMeta.version}.csv`;
  downloadText(filename, csv);
  showToast("数据质量摘要已导出", "去重、缺失、异常与清洗计数均来自当前原始样例。");
}

function scheduleAdjustment() {
  window.clearTimeout(state.dragTimer);
  state.dragTimer = window.setTimeout(() => {
    commitAdjustment();
  }, 850);
}

function commitAdjustment() {
  window.clearTimeout(state.dragTimer);
  const datasetKey = state.dataset;
  const gate = state.gates[datasetKey];
  const histories = state.histories[datasetKey] || [];
  const latestUser = [...histories]
    .reverse()
    .find((history) => history.source === "user");
  if (latestUser && Math.abs(latestUser.gate - gate) < 0.05) return;
  const fullRows = DATASETS[datasetKey].rows;
  const visibleRows = filterRows(fullRows, state.windowKey);
  const lastTimestamp = visibleRows.at(-1).timestamp;
  const rowIndex = fullRows.findIndex(
    (row) => row.timestamp === lastTimestamp,
  );
  const history = {
    id: `ADJ-${Date.now()}-${Math.round(gate * 10)}`,
    dataset: datasetKey,
    rowIndex: Math.max(0, rowIndex),
    gate,
    operator: "当前值班员",
    note: "手动调整闸门",
    source: "user",
    createdAt: Date.now(),
  };
  state.histories[datasetKey] = [...histories, history].slice(-20);
  state.activeHistoryIds[datasetKey] = history.id;
  persistState();
  renderAll();
  showToast(
    "调整已记录",
    `闸门 ${formatOne(gate)}%，可在右下记录中回放。`,
    "✓",
  );
}

function setGate(gate, { record = false, fromHistory = false } = {}) {
  const clamped = Math.min(100, Math.max(0, Number(gate)));
  state.gates[state.dataset] = clamped;
  if (!fromHistory) state.activeHistoryIds[state.dataset] = null;
  persistState();
  renderAll();
  if (record) scheduleAdjustment();
}

function replayHistory(id) {
  const history = (state.histories[state.dataset] || []).find(
    (item) => item.id === id,
  );
  if (!history) return;
  state.gates[state.dataset] = history.gate;
  state.activeHistoryIds[state.dataset] = history.id;
  persistState();
  renderAll();
  const result = operationDerived(history);
  showToast(
    `回放：${history.note}`,
    `开度恢复至 ${formatOne(history.gate)}%，下游 ${formatOne(result.downstream)} m³/s，水位延迟响应已同步。`,
    "↺",
  );
}

function resetInitialState() {
  const target = baselineGate(state.dataset);
  state.gates[state.dataset] = target;
  state.activeHistoryIds[state.dataset] = null;
  window.clearTimeout(state.dragTimer);
  persistState();
  renderAll();
  showToast(
    "已恢复初始状态",
    `闸门回到基准开度 ${formatOne(target)}%，推演曲线已复位，记录仍可回放。`,
    "✓",
  );
}

function switchDataset(datasetKey) {
  if (!DATASET_META[datasetKey] || datasetKey === state.dataset) return;
  state.dataset = datasetKey;
  window.clearTimeout(state.dragTimer);
  persistState();
  const view = renderAll();
  showToast(
    "数据样例已切换",
    `${view.datasetMeta.label} · ${view.datasetMeta.version}，开度与记录状态已从本样例恢复。`,
  );
}

function switchWindow(windowKey) {
  if (!WINDOW_OPTIONS[windowKey] || windowKey === state.windowKey) return;
  const previousWindow = state.windowKey;
  state.windowKey = windowKey;
  persistState();
  renderAll();
  showToast(
    "时间窗口已同步",
    `${WINDOW_OPTIONS[previousWindow].label} → ${WINDOW_OPTIONS[windowKey].label}，闸门 ${formatOne(state.gates[state.dataset])}% 已保留。`,
    "↔",
  );
}

async function toggleAudio() {
  const button = $("#audioToggle");
  try {
    const enabled = await waterAudio.toggle();
    state.audioEnabled = enabled;
    button.setAttribute("aria-pressed", String(enabled));
    button.innerHTML = enabled ? icons.sound : icons.soundOff;
    button.title = enabled ? "关闭水声反馈" : "开启水声反馈";
    if (enabled) {
      waterAudio.setFlow(
        state.gates[state.dataset],
        deriveView().scenario.maxDownstream,
      );
    }
    showToast(
      enabled ? "水声反馈已开启" : "水声反馈已关闭",
      enabled
        ? "水声音量随闸门开度与下泄流量变化。"
        : "Web Audio 输出已静音。",
      enabled ? "♪" : "×",
    );
  } catch (error) {
    showToast("无法开启音频", "当前浏览器未提供可用的 Web Audio 环境。", "!");
  }
}

function bindEvents() {
  $("#datasetTabs").addEventListener("click", (event) => {
    const button = event.target.closest("[data-dataset]");
    if (button) switchDataset(button.dataset.dataset);
  });
  $("#windowTabs").addEventListener("click", (event) => {
    const button = event.target.closest("[data-window]");
    if (button) switchWindow(button.dataset.window);
  });
  $("#historyList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-replay]");
    if (button) replayHistory(button.dataset.replay);
  });
  $("#resetInitialBtn").addEventListener("click", resetInitialState);
  $("#gateSlider").addEventListener("input", (event) => {
    setGate(event.target.value, { record: true });
  });
  $("#gateSlider").addEventListener("change", (event) => {
    window.clearTimeout(state.dragTimer);
    state.gates[state.dataset] = Number(event.target.value);
    renderAll();
    commitAdjustment();
  });
  $("#exportBtn").addEventListener("click", exportCurrentView);
  $("#exportQualityBtn").addEventListener("click", exportQualitySummary);
  $("#audioToggle").addEventListener("click", toggleAudio);
  $$("[data-nav]").forEach((button) => {
    button.addEventListener("click", () => {
      $$("[data-nav]").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      const key = button.dataset.nav;
      const target =
        key === "trend"
          ? $(".chart-panel")
          : key === "profiles"
            ? $(".gate-panel")
            : key === "quality"
              ? $(".quality-panel")
              : null;
      if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
      else window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

function exposeApi() {
  window.hydroApp = {
    getState: () => structuredClone(state),
    getViewModel: () => {
      const view = deriveView();
      return {
        ...view,
        rows: view.rows.map((row) => ({ ...row })),
      };
    },
    setGate,
    setWindow: switchWindow,
    setDataset: switchDataset,
    replayHistory,
    resetInitialState,
    exportCurrentView,
    getExportCsv,
    getLastExport: () => window.__lastExport,
    getChecks: () => window.__hydroViewModel?.checks,
  };
}

function init() {
  $("#app").innerHTML = renderShell();
  hydroChart = new HydroChart($("#hydroChart"), $("#chartTooltip"));
  damRenderer = new DamRenderer($("#damChart"));
  bindEvents();
  exposeApi();
  renderAll();
  document.fonts?.ready.then(() => {
    hydroChart?.draw();
    damRenderer?.draw();
  });
}

init();
