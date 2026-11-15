import {
  STATIONS, TIME_WINDOWS, DATASET_VERSIONS, DURATION_S,
  buildFullPipeline, applyFilters, describeFilter, fmt, QUALITY_CALIBER,
} from "./data.js";
import { drawMap } from "./map-view.js";
import { drawWaveforms, timeForX, stationAtY } from "./wave-view.js";
import { drawTimeline, timeFromTimelineX } from "./timeline-view.js";
import { LowBeep } from "./audio.js";
import { exportFrame, exportCsv } from "./export.js";

const STORAGE_KEY = "seismic-playback-state-v1";

const els = {
  meta: document.getElementById("meta-line"),
  dsButtons: [...document.querySelectorAll(".ds-btn")],
  stationChks: [...document.querySelectorAll(".station-chk")],
  qualityFilter: document.getElementById("quality-filter"),
  windowSwitch: document.getElementById("window-switch"),
  filterText: document.getElementById("active-filter-text"),
  map: document.getElementById("map-canvas"),
  wave: document.getElementById("wave-canvas"),
  timeline: document.getElementById("timeline-canvas"),
  play: document.getElementById("play-btn"),
  speed: document.getElementById("speed-select"),
  audioToggle: document.getElementById("audio-toggle"),
  readout: document.getElementById("time-readout"),
  exportFrame: document.getElementById("export-frame-btn"),
  exportCsv: document.getElementById("export-csv-btn"),
  qualityBody: document.querySelector("#quality-table tbody"),
  binBody: document.querySelector("#bin-table tbody"),
  caliber: document.getElementById("caliber-text"),
};

const beep = new LowBeep();

const state = {
  datasetId: "normal",
  currentTime: 0,
  playing: false,
  speed: 1,
  audioOn: true,
  winStart: 0,
  winEnd: 30,
  winId: "full",
  visibleStations: new Set(STATIONS.map((s) => s.id)),
  qualityMode: "all",
  picks: {},                 // { stationId: time }，切窗口/数据集均保留
  samplesByStation: {},
  quality: {},
  qualityTotals: {},
  bins: [],
  version: "",
  datasetLabel: "",
};

let lastFrameTs = null;
let lastBeepSecond = -1;

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (DATASET_VERSIONS[saved.datasetId]) state.datasetId = saved.datasetId;
    if (Array.isArray(saved.pickList)) {
      state.picks = Object.fromEntries(saved.pickList);
    }
    if (saved.qualityMode) state.qualityMode = saved.qualityMode;
    if (typeof saved.audioOn === "boolean") state.audioOn = saved.audioOn;
    if (saved.speed) state.speed = saved.speed;
  } catch {
    // 持久化数据损坏时忽略，使用默认状态
  }
}

function persist() {
  const pickList = Object.entries(state.picks)
    .filter(([, v]) => v !== undefined && v !== null);
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    datasetId: state.datasetId,
    pickList,
    qualityMode: state.qualityMode,
    audioOn: state.audioOn,
    speed: state.speed,
  }));
}

function loadDataset(datasetId) {
  state.datasetId = datasetId;
  const { dataset, cleaned, bins } = buildFullPipeline(datasetId);
  state.samplesByStation = cleaned.samplesByStation;
  state.quality = cleaned.quality;
  state.qualityTotals = cleaned.qualityTotals;
  state.bins = bins;
  state.version = dataset.meta.version;
  state.datasetLabel = dataset.meta.label;
  persist();
}

function currentFilter(matchCount) {
  return {
    stations: [...state.visibleStations],
    quality: state.qualityMode,
    windowStart: state.winStart,
    windowEnd: state.winEnd,
    matchCount,
    version: state.version,
    datasetId: state.datasetId,
  };
}

function renderMeta() {
  els.meta.innerHTML =
    `数据版本 <b>${state.version}</b> ｜ 采样 40Hz / ${DURATION_S}s ｜ ` +
    `去重删除 <b>${state.qualityTotals.duplicatesRemoved}</b> ｜ ` +
    `缺失样例 <b>${state.qualityTotals.missingSamples}</b> ｜ ` +
    `异常样例 <b>${state.qualityTotals.anomalySamples}</b>`;
}

function renderQualityTable() {
  const rows = STATIONS.map((s) => {
    const q = state.quality[s.id];
    return `<tr><td>${s.id}</td><td>${q.rawRows}</td><td>${q.duplicatesRemoved}</td>` +
      `<td>${q.missingSamples}</td><td>${q.gapEvents}</td><td>${q.anomalySamples}</td>` +
      `<td>${q.cleanRows}</td><td>${q.binCount}</td></tr>`;
  }).join("");
  const t = state.qualityTotals;
  els.qualityBody.innerHTML = rows +
    `<tr><td class="row-total">${t.stationId}</td><td class="row-total">${t.rawRows}</td>` +
    `<td class="row-total">${t.duplicatesRemoved}</td>` +
    `<td class="row-total">${t.missingSamples}</td>` +
    `<td class="row-total">${t.gapEvents}</td>` +
    `<td class="row-total">${t.anomalySamples}</td>` +
    `<td class="row-total">${t.cleanRows}</td>` +
    `<td class="row-total">${t.binCount}</td></tr>`;
  els.caliber.textContent = QUALITY_CALIBER +
    "。所有派生数值均由原始样例经 cleanDataset/aggregate 实时重算，界面无预设结果。";
}

function renderBinTable(filtered) {
  if (filtered.length === 0) {
    els.binBody.innerHTML = `<tr><td colspan="10">当前筛选无命中分箱</td></tr>`;
    return;
  }
  els.binBody.innerHTML = filtered.map((b) => {
    const flagText = { ok: "正常", missing: "含缺失", anomaly: "含异常" }[b.flag];
    return `<tr><td>${b.stationId}</td><td>${b.binStart}–${b.binEnd}s</td><td>${b.count}</td>` +
      `<td>${fmt(b.mean)}</td><td>${fmt(b.min)}</td><td>${fmt(b.max)}</td>` +
      `<td>${fmt(b.rms)}</td><td>${b.missing}</td><td>${b.anomalies}</td>` +
      `<td class="flag-${b.flag}">${flagText}</td></tr>`;
  }).join("");
}

function render() {
  const filter = currentFilter(0);
  const filtered = applyFilters(state.bins, filter);
  filter.matchCount = filtered.length;

  drawMap(els.map, state);
  drawWaveforms(els.wave, state);
  drawTimeline(els.timeline, state);
  renderMeta();
  renderQualityTable();
  renderBinTable(filtered);
  els.filterText.textContent = describeFilter(filter);
  els.readout.textContent = `t = ${fmt(state.currentTime, 3)}s`;
  els.play.textContent = state.playing ? "⏸ 暂停" : "▶ 播放";
  state._lastFiltered = filtered;
  state._lastFilter = filter;
}

function tick(ts) {
  if (lastFrameTs === null) lastFrameTs = ts;
  const dt = (ts - lastFrameTs) / 1000;
  lastFrameTs = ts;

  if (state.playing) {
    const next = state.currentTime + dt * state.speed;
    if (next >= state.winEnd) {
      state.currentTime = state.winEnd;
      state.playing = false;
    } else {
      state.currentTime = next;
    }

    // 经过任一拾取点时触发一次低频提示
    if (state.audioOn) {
      const picks = Object.entries(state.picks)
        .filter(([, t]) => t !== undefined && t !== null)
        .map(([, t]) => t);
      for (const pickT of picks) {
        const key = Math.round(pickT * 10);
        if (state.currentTime >= pickT && key !== lastBeepSecond) {
          beep.play(95, 0.2, 0.14);
          lastBeepSecond = key;
        }
      }
    }
    render();
  }
  requestAnimationFrame(tick);
}

function togglePlay() {
  if (!state.playing && state.currentTime >= state.winEnd) {
    state.currentTime = state.winStart;
  }
  state.playing = !state.playing;
  lastFrameTs = null;
  lastBeepSecond = -1;
  if (state.playing && state.audioOn) beep.ensureContext();
  render();
}

function setWindow(winId) {
  const win = TIME_WINDOWS.find((w) => w.id === winId) || TIME_WINDOWS[0];
  state.winId = win.id;
  state.winStart = win.start;
  state.winEnd = win.end;
  if (state.currentTime < win.start || state.currentTime > win.end) {
    state.currentTime = Math.max(win.start, Math.min(win.end, state.currentTime));
  }
  document.querySelectorAll(".win-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.win === win.id);
  });
  render();
}

function bindEvents() {
  els.dsButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      loadDataset(btn.dataset.dataset);
      els.dsButtons.forEach((b) => b.classList.toggle("active", b === btn));
      render();
    });
  });

  els.stationChks.forEach((chk) => {
    chk.addEventListener("change", () => {
      state.visibleStations = new Set(
        els.stationChks.filter((c) => c.checked).map((c) => c.value),
      );
      render();
    });
  });

  els.qualityFilter.addEventListener("change", () => {
    state.qualityMode = els.qualityFilter.value;
    persist();
    render();
  });

  els.windowSwitch.addEventListener("click", (e) => {
    const btn = e.target.closest(".win-btn");
    if (btn) setWindow(btn.dataset.win);
  });

  els.play.addEventListener("click", togglePlay);
  els.speed.addEventListener("change", () => {
    state.speed = Number(els.speed.value);
    persist();
  });
  els.audioToggle.addEventListener("change", () => {
    state.audioOn = els.audioToggle.checked;
    persist();
  });

  // 波形点击：在对应台站通道标记/取消到达时间
  els.wave.addEventListener("click", (e) => {
    if (state.visibleStations.size === 0) return;
    const rect = els.wave.getBoundingClientRect();
    const scaleX = els.wave.width / rect.width;
    const scaleY = els.wave.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    const stationId = stationAtY(els.wave, state.visibleStations, y);
    if (!stationId) return;
    const t = timeForX(els.wave, x, state.winStart, state.winEnd);
    const clamped = Math.max(0, Math.min(DURATION_S, t));
    const existing = state.picks[stationId];
    if (existing !== undefined && existing !== null && Math.abs(existing - clamped) < 0.25) {
      delete state.picks[stationId];
    } else {
      state.picks[stationId] = clamped;
      if (state.audioOn) beep.play(120, 0.18, 0.15);
    }
    persist();
    render();
  });

  // 时间轴拖动定位（含按住拖动）
  let dragging = false;
  const seek = (e) => {
    const rect = els.timeline.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (els.timeline.width / rect.width);
    state.currentTime = timeFromTimelineX(els.timeline, x);
    lastBeepSecond = -1;
    render();
  };
  els.timeline.addEventListener("pointerdown", (e) => {
    dragging = true;
    els.timeline.setPointerCapture(e.pointerId);
    seek(e);
  });
  els.timeline.addEventListener("pointermove", (e) => {
    if (dragging) seek(e);
  });
  els.timeline.addEventListener("pointerup", () => { dragging = false; });

  els.exportFrame.addEventListener("click", () => {
    exportFrame(
      { map: els.map, wave: els.wave, timeline: els.timeline },
      state,
      els.filterText.textContent,
      state.qualityTotals,
    );
  });

  els.exportCsv.addEventListener("click", () => {
    exportCsv(state._lastFiltered, state._lastFilter, state.qualityTotals);
  });

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" && e.target.tagName !== "SELECT") {
      e.preventDefault();
      togglePlay();
    }
  });
}

function init() {
  TIME_WINDOWS.forEach((win) => {
    const btn = document.createElement("button");
    btn.className = "win-btn" + (win.id === "full" ? " active" : "");
    btn.dataset.win = win.id;
    btn.textContent = win.label;
    els.windowSwitch.appendChild(btn);
  });

  loadPersisted();
  loadDataset(state.datasetId);
  els.dsButtons.forEach((b) =>
    b.classList.toggle("active", b.dataset.dataset === state.datasetId));
  els.qualityFilter.value = state.qualityMode;
  els.speed.value = String(state.speed);
  els.audioToggle.checked = state.audioOn;
  bindEvents();
  render();
  requestAnimationFrame(tick);
}

init();
