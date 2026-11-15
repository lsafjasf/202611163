(function () {
  "use strict";

  const Data = window.WindData;
  const STORAGE_KEY = "wind-observatory-view-v1";
  const DEFAULT_STATE = { dataset: "normal", season: "autumn", period: "all" };
  const SEASON_MAP = new Map(Data.SEASONS.map((season) => [season.key, season]));
  const PERIOD_MAP = new Map(Data.PERIODS.map((period) => [period.key, period]));
  const DIRECTION_MAP = new Map(Data.DIRECTIONS.map((direction) => [direction.key, direction]));
  const BAND_MAP = new Map(Data.SPEED_BANDS.map((band) => [band.key, band]));
  const CHART_SANS = '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';
  const CHART_SERIF = '"Noto Serif SC", "Songti SC", Georgia, serif';

  const elements = {
    versionSelect: document.getElementById("versionSelect"),
    exportPngTop: document.getElementById("exportPngTop"),
    ticketLive: document.getElementById("ticketLive"),
    ticketSeason: document.getElementById("ticketSeason"),
    ticketPeriod: document.getElementById("ticketPeriod"),
    ticketWindow: document.getElementById("ticketWindow"),
    ticketVersion: document.getElementById("ticketVersion"),
    ticketRows: document.getElementById("ticketRows"),
    ticketAvg: document.getElementById("ticketAvg"),
    seasonSwitcher: document.getElementById("seasonSwitcher"),
    chartTitle: document.getElementById("chartTitle"),
    chartSubtitle: document.getElementById("chartSubtitle"),
    periodControl: document.getElementById("periodControl"),
    activeFilters: document.getElementById("activeFilters"),
    canvasStage: document.getElementById("canvasStage"),
    canvas: document.getElementById("windRoseCanvas"),
    tooltip: document.getElementById("chartTooltip"),
    chartEmpty: document.getElementById("chartEmpty"),
    metricRows: document.getElementById("metricRows"),
    metricAvg: document.getElementById("metricAvg"),
    metricMax: document.getElementById("metricMax"),
    metricTop: document.getElementById("metricTop"),
    metricTopCount: document.getElementById("metricTopCount"),
    exportPng: document.getElementById("exportPng"),
    exportCsv: document.getElementById("exportCsv"),
    qualityRing: document.getElementById("qualityRing"),
    qualityRate: document.getElementById("qualityRate"),
    qualityRaw: document.getElementById("qualityRaw"),
    qualityValid: document.getElementById("qualityValid"),
    qualityScopeNote: document.getElementById("qualityScopeNote"),
    qualityBar: document.getElementById("qualityBar"),
    qValidBar: document.getElementById("qValidBar"),
    qDupBar: document.getElementById("qDupBar"),
    qMissingBar: document.getElementById("qMissingBar"),
    qAnomalyBar: document.getElementById("qAnomalyBar"),
    qualityDup: document.getElementById("qualityDup"),
    qualityMissing: document.getElementById("qualityMissing"),
    qualityAnomaly: document.getElementById("qualityAnomaly"),
    qualityRetained: document.getElementById("qualityRetained"),
    recordsCount: document.getElementById("recordsCount"),
    recordsBody: document.getElementById("recordsBody"),
    recordsFootFilter: document.getElementById("recordsFootFilter"),
    exportNoteTitle: document.getElementById("exportNoteTitle"),
    exportNoteText: document.getElementById("exportNoteText"),
    toast: document.getElementById("toast"),
  };

  const context = elements.canvas.getContext("2d");
  let state = loadState();
  let view = null;
  let chartGeometry = null;
  let hoveredDirection = null;
  let lastChartWidth = 0;
  let toastTimer = null;
  let renderToken = 0;

  function isValidState(candidate) {
    return (
      candidate &&
      Data.DATA_VERSIONS.some((item) => item.id === candidate.dataset) &&
      SEASON_MAP.has(candidate.season) &&
      PERIOD_MAP.has(candidate.period)
    );
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (isValidState(saved)) return { ...DEFAULT_STATE, ...saved };
    } catch (error) {
      console.warn("无法恢复视图状态", error);
    }
    return { ...DEFAULT_STATE };
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.warn("无法保存视图状态", error);
    }
  }

  function setState(patch, options) {
    const next = { ...state, ...patch };
    if (!isValidState(next)) return;
    state = next;
    saveState();
    if (!options || options.render !== false) render();
  }

  function formatPercent(value) {
    return Number.isFinite(value) ? `${value.toFixed(1)}%` : "—";
  }

  function formatSpeed(value) {
    return Data.formatSpeed(value);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function buildVersionOptions() {
    elements.versionSelect.innerHTML = Data.DATA_VERSIONS.map(
      (version) =>
        `<option value="${version.id}">${version.version} · ${version.label}</option>`
    ).join("");
  }

  function buildPeriodControl() {
    elements.periodControl.innerHTML = Data.PERIODS.map(
      (period) =>
        `<button class="period-option" type="button" data-period="${period.key}" aria-pressed="false" title="${period.range}">${period.label}</button>`
    ).join("");
  }

  function buildSeasonSwitcher() {
    elements.seasonSwitcher.innerHTML = Data.SEASONS.map(
      (season) => `
        <button class="season-tab" type="button" data-season="${season.key}" aria-pressed="false">
          <span class="season-tab-main">
            <strong>${season.label.replace("季", "")}</strong>
            <small>${season.label} · ${season.months}</small>
          </span>
          <span class="season-tab-count" data-season-count="${season.key}">— 条</span>
          <span class="season-tab-detail" data-season-detail="${season.key}">正在计算当前时段</span>
        </button>`
    ).join("");
  }

  function render() {
    renderToken += 1;
    hoveredDirection = null;
    hideTooltip();
    view = Data.buildViewModel(state.dataset, state.season, state.period);
    elements.versionSelect.value = state.dataset;
    renderSeasonSwitcher();
    renderPeriodControl();
    renderTicket();
    renderActiveFilters();
    renderMetrics();
    renderQuality();
    renderRecords();
    renderChartSummary();
    drawChart();
    const live = document.getElementById("ticketLive");
    live.textContent = "已同步";
    live.animate(
      [{ opacity: 0.35 }, { opacity: 1 }],
      { duration: 260, easing: "ease-out" }
    );
  }

  function renderTicket() {
    const aggregate = view.aggregate;
    elements.ticketSeason.textContent = view.season.label;
    elements.ticketPeriod.textContent = view.period.label;
    elements.ticketWindow.textContent = view.period.range;
    elements.ticketVersion.textContent = `${view.version.version} · ${view.version.label}`;
    elements.ticketRows.textContent = String(aggregate.total);
    elements.ticketAvg.textContent = `${formatSpeed(aggregate.avgSpeed)} m/s`;
  }

  function renderSeasonSwitcher() {
    const views = new Map(
      Data.SEASONS.map((season) => [
        season.key,
        Data.buildViewModel(state.dataset, season.key, state.period),
      ])
    );
    elements.seasonSwitcher.querySelectorAll("[data-season]").forEach((button) => {
      const key = button.dataset.season;
      const seasonView = views.get(key);
      button.setAttribute("aria-pressed", String(key === state.season));
      button.querySelector("[data-season-count]").textContent =
        `${seasonView.aggregate.total} 条`;
      button.querySelector("[data-season-detail]").textContent =
        `${view.period.label} · 均速 ${formatSpeed(seasonView.aggregate.avgSpeed)} m/s`;
    });
  }

  function renderPeriodControl() {
    elements.periodControl.querySelectorAll("[data-period]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.period === state.period));
    });
  }

  function renderActiveFilters() {
    elements.activeFilters.innerHTML = `
      <span class="filter-chip accent">当前筛选</span>
      <span class="filter-chip">季节 <b>${view.season.label}</b></span>
      <span class="filter-chip">时段 <b>${view.period.label} · ${view.period.range}</b></span>
      <span class="filter-chip">版本 <b>${view.version.version}</b></span>
      <span class="filter-chip">有效 <b>${view.aggregate.total} 条</b></span>
      <button class="filter-reset" id="resetView" type="button">恢复默认视图</button>
    `;
    const reset = document.getElementById("resetView");
    reset.addEventListener("click", () => setState({ ...DEFAULT_STATE }));
  }

  function renderMetrics() {
    const aggregate = view.aggregate;
    elements.metricRows.textContent = String(aggregate.total);
    elements.metricAvg.textContent = formatSpeed(aggregate.avgSpeed);
    elements.metricMax.textContent = formatSpeed(aggregate.maxSpeed);
    elements.metricTop.textContent = aggregate.topDirection
      ? aggregate.topDirection.spoken
      : "—";
    elements.metricTopCount.textContent = aggregate.topDirection
      ? `${aggregate.topDirection.count} 次`
      : "— 次";
  }

  function renderQuality() {
    const quality = view.clean.quality;
    const denominator = Math.max(quality.rawRows, 1);
    elements.qualityRate.textContent = formatPercent(quality.retainedRate);
    elements.qualityRing.style.setProperty("--rate", String(quality.retainedRate));
    elements.qualityRaw.textContent = String(quality.rawRows);
    elements.qualityValid.textContent = String(quality.validRows);
    elements.qualityDup.textContent = String(quality.duplicateRows);
    elements.qualityMissing.textContent = String(quality.missingRows);
    elements.qualityAnomaly.textContent = String(quality.anomalyRows);
    elements.qualityRetained.textContent = String(quality.validRows);
    elements.qualityScopeNote.textContent =
      `${view.version.version} ${view.version.label} · ${view.version.description}`;
    elements.qValidBar.style.width = `${(quality.validRows / denominator) * 100}%`;
    elements.qDupBar.style.width = `${(quality.duplicateRows / denominator) * 100}%`;
    elements.qMissingBar.style.width = `${(quality.missingRows / denominator) * 100}%`;
    elements.qAnomalyBar.style.width = `${(quality.anomalyRows / denominator) * 100}%`;
    elements.qualityBar.setAttribute(
      "aria-label",
      `有效 ${quality.validRows} 行，重复 ${quality.duplicateRows} 行，缺失 ${quality.missingRows} 行，异常 ${quality.anomalyRows} 行`
    );
  }

  function formatObservedAt(observedAt) {
    const match = String(observedAt).match(
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/
    );
    if (!match) return { date: "—", time: "—" };
    return {
      date: `${match[1]}-${match[2]}-${match[3]}`,
      time: `${match[4]}:${match[5]}`,
    };
  }

  function renderRecords() {
    const rows = view.records.map((record) => {
      const direction = DIRECTION_MAP.get(record.direction);
      const band =
        Data.SPEED_BANDS.find(
          (item) => record.speed >= item.min && record.speed < item.max
        ) || Data.SPEED_BANDS[0];
      const observed = formatObservedAt(record.observedAt);
      const period = PERIOD_MAP.get(record.periodKey);
      return `
        <tr>
          <td>${escapeHtml(record.eventId)}</td>
          <td class="record-time">${observed.date} ${observed.time}<small>+08:00</small></td>
          <td>${escapeHtml(record.station)}</td>
          <td>
            <span class="direction-label">
              <span class="direction-arrow" style="--arrow-angle:${direction.angle}deg" aria-hidden="true">↑</span>
              ${direction.spoken}
              <span class="direction-code">${direction.key}</span>
            </span>
          </td>
          <td>
            <span class="speed-value">
              <span class="speed-dot" style="--band-color:${band.color}"></span>
              ${formatSpeed(record.speed)} m/s
            </span>
          </td>
          <td><span class="period-label ${record.periodKey}">${period.label}</span></td>
        </tr>`;
    });
    elements.recordsBody.innerHTML = rows.join("");
    elements.recordsCount.textContent = `${view.aggregate.total} 条有效记录`;
    elements.recordsFootFilter.textContent =
      `${view.season.label} · ${view.period.label} ${view.period.range} · ${view.version.version}`;
  }

  function renderChartSummary() {
    const aggregate = view.aggregate;
    elements.chartTitle.textContent = `${view.season.label}地面风场`;
    elements.chartSubtitle.textContent =
      `${view.period.label} ${view.period.range} · ${view.version.version} · ` +
      `主导风向 ${aggregate.topDirection ? aggregate.topDirection.spoken : "—"}`;
    elements.chartEmpty.hidden = aggregate.total > 0;
    elements.canvas.setAttribute(
      "aria-label",
      `${view.season.label}${view.period.label}风向玫瑰图，有效记录 ${aggregate.total} 条，平均风速 ${formatSpeed(aggregate.avgSpeed)} 米每秒，包含八方位网格与五档风速图例`
    );
  }

  function init() {
    buildVersionOptions();
    buildPeriodControl();
    buildSeasonSwitcher();
    elements.versionSelect.addEventListener("change", (event) => {
      setState({ dataset: event.target.value });
    });
    elements.seasonSwitcher.addEventListener("click", (event) => {
      const button = event.target.closest("[data-season]");
      if (!button) return;
      setState({ season: button.dataset.season });
    });
    elements.periodControl.addEventListener("click", (event) => {
      const button = event.target.closest("[data-period]");
      if (!button) return;
      setState({ period: button.dataset.period });
    });
    elements.exportPng.addEventListener("click", exportPng);
    elements.exportPngTop.addEventListener("click", exportPng);
    elements.exportCsv.addEventListener("click", exportCsv);
    elements.canvas.addEventListener("pointermove", handleCanvasPointer);
    elements.canvas.addEventListener("pointerleave", hideTooltip);
    window.addEventListener("beforeunload", saveState);
    window.addEventListener("pagehide", saveState);

    if ("ResizeObserver" in window) {
      const observer = new ResizeObserver(() => {
        if (!view) return;
        const width = elements.canvasStage.clientWidth;
        if (Math.abs(width - lastChartWidth) > 1) drawChart();
      });
      observer.observe(elements.canvasStage);
    } else {
      window.addEventListener("resize", () => drawChart());
    }

    render();
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        if (view) drawChart();
      });
    }
  }

  window.__windApp = {
    getState: () => ({ ...state }),
    getView: () => view,
    getExportSummary: () => (view ? Data.buildExportSummary(view) : null),
    getCsv: () => (view ? Data.buildCsv(view) : ""),
    setState: (patch) => setState(patch),
    redraw: () => drawChart(),
    getChartGeometry: () => chartGeometry,
  };

  init();

  function niceCeil(value) {
    if (!Number.isFinite(value) || value <= 0) return 1;
    const exponent = Math.pow(10, Math.floor(Math.log10(value)));
    const fraction = value / exponent;
    const nice =
      fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
    return nice * exponent;
  }

  function roundedRectPath(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function annularPath(ctx, cx, cy, innerRadius, outerRadius, startAngle, endAngle) {
    ctx.beginPath();
    ctx.arc(cx, cy, outerRadius, startAngle, endAngle);
    ctx.arc(cx, cy, innerRadius, endAngle, startAngle, true);
    ctx.closePath();
  }

  function polarPoint(cx, cy, radius, degrees) {
    const radians = ((degrees - 90) * Math.PI) / 180;
    return {
      x: cx + Math.cos(radians) * radius,
      y: cy + Math.sin(radians) * radius,
    };
  }

  function drawGrid(ctx, cx, cy, radius, maxValue, step, compact) {
    const rings = 4;
    const gridColor = "rgba(22, 51, 45, 0.12)";
    const labelColor = "rgba(83, 106, 96, 0.74)";

    ctx.save();
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    for (let ring = 1; ring <= rings; ring += 1) {
      ctx.beginPath();
      ctx.arc(cx, cy, (radius * ring) / rings, 0, Math.PI * 2);
      ctx.setLineDash(ring === rings ? [] : [3, 5]);
      ctx.stroke();
    }

    ctx.setLineDash([2, 5]);
    ctx.strokeStyle = "rgba(22, 51, 45, 0.09)";
    Data.DIRECTIONS.forEach((direction) => {
      const point = polarPoint(cx, cy, radius, direction.angle);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
    });
    ctx.setLineDash([]);

    ctx.font = `${compact ? 7 : 8}px ${CHART_SANS}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (let ring = 1; ring <= rings; ring += 1) {
      const value = step * ring;
      const point = polarPoint(cx, cy, (radius * ring) / rings, 90);
      const text = String(value);
      const textWidth = ctx.measureText(text).width;
      ctx.fillStyle = "rgba(251, 252, 248, 0.82)";
      roundedRectPath(ctx, point.x + 3, point.y - 7, textWidth + 6, 14, 4);
      ctx.fill();
      ctx.fillStyle = labelColor;
      ctx.fillText(text, point.x + 6, point.y);
    }

    Data.DIRECTIONS.forEach((direction) => {
      const point = polarPoint(cx, cy, radius + (compact ? 18 : 24), direction.angle);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#33544c";
      ctx.font = `600 ${compact ? 9 : 11}px ${CHART_SANS}`;
      ctx.fillText(direction.label, point.x, point.y - (compact ? 3 : 4));
      ctx.fillStyle = "#91a097";
      ctx.font = `7px ${CHART_SANS}`;
      ctx.fillText(direction.key, point.x, point.y + (compact ? 7 : 9));
    });
    ctx.restore();
  }

  function drawSectors(ctx, cx, cy, radius, innerRadius, aggregate, maxValue, compact) {
    const gap = ((compact ? 1.3 : 1.8) * Math.PI) / 180;
    const halfAngle = Math.PI / 8 - gap;
    aggregate.byDirection.forEach((direction) => {
      const centerAngle = ((direction.angle - 90) * Math.PI) / 180;
      const startAngle = centerAngle - halfAngle;
      const endAngle = centerAngle + halfAngle;
      let currentRadius = innerRadius;

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, innerRadius + 3, startAngle, endAngle);
      ctx.arc(cx, cy, innerRadius, endAngle, startAngle, true);
      ctx.closePath();
      ctx.fillStyle = "rgba(31, 114, 99, 0.055)";
      ctx.fill();

      direction.bands.forEach((bandCount) => {
        if (bandCount.count <= 0) return;
        const band = BAND_MAP.get(bandCount.key);
        const nextRadius =
          currentRadius + (bandCount.count / maxValue) * (radius - innerRadius);
        annularPath(ctx, cx, cy, currentRadius, nextRadius, startAngle, endAngle);
        ctx.fillStyle = band.color;
        ctx.fill();
        ctx.strokeStyle = "rgba(251, 252, 248, 0.72)";
        ctx.lineWidth = compact ? 0.6 : 0.85;
        ctx.stroke();
        currentRadius = nextRadius;
      });

      if (direction.key === hoveredDirection) {
        annularPath(ctx, cx, cy, innerRadius, currentRadius, startAngle, endAngle);
        ctx.fillStyle = "rgba(255, 255, 255, 0.13)";
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 252, 242, 0.95)";
        ctx.lineWidth = 1.8;
        ctx.stroke();
      }
      ctx.restore();
    });
  }

  function drawCenter(ctx, cx, cy, radius, total, compact) {
    const fontFamily = CHART_SANS;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = "#fbfcf8";
    ctx.fill();
    ctx.strokeStyle = "#d8e2da";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#16332d";
    ctx.font = `600 ${compact ? 11 : 14}px ${fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(total), cx, cy - 2);
    ctx.fillStyle = "#809087";
    ctx.font = `${compact ? 6 : 7}px ${fontFamily}`;
    ctx.fillText("有效", cx, cy + (compact ? 8 : 10));
    ctx.restore();
  }

  function drawLegend(ctx, width, height, compact) {
    const fontFamily = CHART_SANS;
    const left = compact ? 20 : 34;
    const right = compact ? 20 : 34;
    const lineY = height - (compact ? 61 : 66);
    const legendY = height - (compact ? 34 : 36);

    ctx.save();
    ctx.strokeStyle = "rgba(22, 51, 45, 0.1)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, lineY);
    ctx.lineTo(width - right, lineY);
    ctx.stroke();

    ctx.font = `600 ${compact ? 8 : 9}px ${fontFamily}`;
    ctx.fillStyle = "#61766c";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("风速 m/s", left, legendY);

    const labelWidth = compact ? 54 : 66;
    const legendLeft = left + labelWidth;
    const itemsWidth = width - legendLeft - right;
    const itemWidth = itemsWidth / Data.SPEED_BANDS.length;
    Data.SPEED_BANDS.forEach((band, index) => {
      const x = legendLeft + index * itemWidth;
      ctx.fillStyle = band.color;
      roundedRectPath(ctx, x, legendY - 4, 8, 8, 2);
      ctx.fill();
      ctx.fillStyle = "#52685e";
      ctx.font = `${compact ? 7.5 : 9}px ${fontFamily}`;
      ctx.fillText(band.label, x + 12, legendY);
    });

    if (!compact) {
      ctx.textAlign = "right";
      ctx.fillStyle = "#9aa89f";
      ctx.font = `8px ${fontFamily}`;
      ctx.fillText("半径 = 频次 · 颜色 = 风速区间 · 均值 = 算术平均", width - right, height - 11);
    }
    ctx.restore();
  }

  function drawChartHeader(ctx, width, compact) {
    const fontFamily = CHART_SANS;
    const left = compact ? 20 : 34;
    const right = compact ? 20 : 34;
    const aggregate = view.aggregate;

    ctx.save();
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#1f7263";
    ctx.font = `700 ${compact ? 7 : 8}px ${fontFamily}`;
    ctx.fillText("WIND ROSE  /  SEASONAL SAMPLE", left, compact ? 21 : 24);

    ctx.fillStyle = "#16332d";
    ctx.font = `500 ${compact ? 21 : 26}px ${CHART_SERIF}`;
    ctx.fillText(`${view.season.label} · 风场玫瑰`, left, compact ? 44 : 51);

    ctx.fillStyle = "#7a8b82";
    ctx.font = `${compact ? 8 : 9}px ${fontFamily}`;
    ctx.fillText(
      `${view.period.label} ${view.period.range}  ·  ${view.version.version} ${view.version.label}`,
      left,
      compact ? 64 : 72
    );

    ctx.textAlign = "right";
    ctx.fillStyle = "#16332d";
    ctx.font = `600 ${compact ? 11 : 13}px ${fontFamily}`;
    ctx.fillText(`${aggregate.total} 条有效`, width - right, compact ? 26 : 30);
    ctx.fillStyle = "#61766c";
    ctx.font = `${compact ? 8 : 9}px ${fontFamily}`;
    ctx.fillText(
      `均值 ${formatSpeed(aggregate.avgSpeed)} m/s  ·  峰值 ${formatSpeed(aggregate.maxSpeed)}`,
      width - right,
      compact ? 41 : 47
    );
    ctx.fillStyle = "#1f7263";
    ctx.font = `${compact ? 7 : 8}px ${fontFamily}`;
    ctx.fillText(
      compact
        ? `主导 ${aggregate.topDirection ? aggregate.topDirection.spoken : "—"} ${aggregate.topDirection ? aggregate.topDirection.count : 0} · ${view.version.version}`
        : `主导 ${aggregate.topDirection ? aggregate.topDirection.spoken : "—"} ${aggregate.topDirection ? aggregate.topDirection.count : 0} 次  ·  DATA ${view.version.version} / ${view.period.short}`,
      width - right,
      compact ? 55 : 62
    );

    ctx.strokeStyle = "rgba(22, 51, 45, 0.1)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, compact ? 82 : 86);
    ctx.lineTo(width - right, compact ? 82 : 86);
    ctx.stroke();
    ctx.restore();
  }

  function drawChart() {
    if (!view) return;
    const width = Math.max(300, Math.floor(elements.canvasStage.clientWidth));
    const compact = width < 620;
    const height = compact ? (width < 430 ? 460 : 510) : Math.max(560, Math.min(650, width * 0.66));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    lastChartWidth = width;
    elements.canvas.width = Math.round(width * dpr);
    elements.canvas.height = Math.round(height * dpr);
    elements.canvas.style.height = `${height}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);

    const maxCount = view.aggregate.maxDirectionCount;
    const step = niceCeil(Math.max(1, maxCount / 4));
    const maxValue = step * 4;
    const headerBottom = compact ? 94 : 99;
    const footerHeight = compact ? 64 : 74;
    const plotHeight = height - headerBottom - footerHeight;
    const cx = width / 2;
    const cy = headerBottom + plotHeight / 2;
    const radius = Math.max(
      76,
      Math.min(plotHeight / 2 - (compact ? 26 : 22), width / 2 - (compact ? 50 : 72))
    );
    const innerRadius = compact ? 18 : 23;

    drawChartHeader(context, width, compact);

    const background = context.createRadialGradient(cx, cy, 0, cx, cy, radius);
    background.addColorStop(0, "rgba(255, 255, 255, 0.9)");
    background.addColorStop(0.72, "rgba(255, 255, 255, 0.54)");
    background.addColorStop(1, "rgba(237, 243, 236, 0.16)");
    context.save();
    context.beginPath();
    context.arc(cx, cy, radius, 0, Math.PI * 2);
    context.fillStyle = background;
    context.fill();
    context.restore();

    drawGrid(context, cx, cy, radius, maxValue, step, compact);
    drawSectors(context, cx, cy, radius, innerRadius, view.aggregate, maxValue, compact);
    drawCenter(context, cx, cy, innerRadius, view.aggregate.total, compact);
    drawLegend(context, width, height, compact);

    chartGeometry = { cx, cy, radius, innerRadius, width, height };
  }

  function handleCanvasPointer(event) {
    if (!chartGeometry || !view) return;
    const rect = elements.canvas.getBoundingClientRect();
    const scaleX = chartGeometry.width / rect.width;
    const scaleY = chartGeometry.height / rect.height;
    const x = (event.clientX - rect.left) * scaleX;
    const y = (event.clientY - rect.top) * scaleY;
    const dx = x - chartGeometry.cx;
    const dy = y - chartGeometry.cy;
    const distance = Math.hypot(dx, dy);

    if (distance < chartGeometry.innerRadius || distance > chartGeometry.radius + 15) {
      hideTooltip();
      return;
    }

    const angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
    const normalizedAngle = (angle + 360) % 360;
    const index = Math.round(normalizedAngle / 45) % 8;
    const direction = Data.DIRECTIONS[index];
    if (direction.key !== hoveredDirection) {
      hoveredDirection = direction.key;
      drawChart();
    }
    showTooltip(direction.key, event);
  }

  function showTooltip(directionKey, event) {
    const item = view.aggregate.byDirection.find((direction) => direction.key === directionKey);
    if (!item) return;
    const percent = view.aggregate.total ? (item.count / view.aggregate.total) * 100 : 0;
    const nonZeroBands = item.bands.filter((band) => band.count > 0);
    const bandBar =
      item.count > 0
        ? `<div class="tt-bands" aria-hidden="true">${nonZeroBands
            .map((band) => {
              const meta = BAND_MAP.get(band.key);
              return `<span style="width:${(band.count / item.count) * 100}%;background:${meta.color}"></span>`;
            })
            .join("")}</div>`
        : "";
    elements.tooltip.innerHTML = `
      <div class="tt-head">
        <div><strong>${item.spoken}</strong><code>${item.key}</code></div>
        <span class="tt-angle">${item.angle}°</span>
      </div>
      <div class="tt-values">
        <span>频次<b>${item.count}<small>次</small></b></span>
        <span>平均速度<b>${formatSpeed(item.avgSpeed)}<small>m/s</small></b></span>
      </div>
      ${bandBar}
      <p class="tt-share">占当前时间窗口 ${formatPercent(percent)} · 峰值 ${formatSpeed(item.maxSpeed)} m/s</p>
    `;
    elements.tooltip.hidden = false;

    const stageRect = elements.canvasStage.getBoundingClientRect();
    const tooltipWidth = elements.tooltip.offsetWidth;
    const tooltipHeight = elements.tooltip.offsetHeight;
    let left = event.clientX - stageRect.left + 18;
    let top = event.clientY - stageRect.top - tooltipHeight / 2;
    if (left + tooltipWidth > stageRect.width - 8) {
      left = event.clientX - stageRect.left - tooltipWidth - 18;
    }
    left = Math.max(8, Math.min(left, stageRect.width - tooltipWidth - 8));
    top = Math.max(8, Math.min(top, stageRect.height - tooltipHeight - 8));
    elements.tooltip.style.left = `${left}px`;
    elements.tooltip.style.top = `${top}px`;
  }

  function hideTooltip() {
    const wasVisible = !elements.tooltip.hidden || hoveredDirection;
    elements.tooltip.hidden = true;
    if (hoveredDirection) {
      hoveredDirection = null;
      if (view) drawChart();
    } else if (wasVisible && view) {
      drawChart();
    }
  }

  function fileTimestamp() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return (
      `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
      `${pad(now.getHours())}${pad(now.getMinutes())}`
    );
  }

  function buildFileStem() {
    const version = view.version.version.replace(/\./g, "");
    return `wind-rose_${view.season.key}_${view.period.key}_${version}_${fileTimestamp()}`;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add("visible");
    toastTimer = window.setTimeout(() => {
      elements.toast.classList.remove("visible");
    }, 3200);
  }

  function updateExportNote(kind, filename) {
    const aggregate = view.aggregate;
    elements.exportNoteTitle.textContent = `最近导出 · ${kind}`;
    elements.exportNoteText.textContent =
      `${view.season.label} ${view.period.label} · ${aggregate.total} 条 · ` +
      `均速 ${formatSpeed(aggregate.avgSpeed)} m/s · v${view.version.version.replace(/^v/, "")} · ${filename}`;
  }

  function exportPng() {
    if (!view) return;
    drawChart();
    const filename = `${buildFileStem()}.png`;
    const finish = (blob) => {
      if (!blob) {
        showToast("PNG 生成失败，请重试");
        return;
      }
      downloadBlob(blob, filename);
      updateExportNote("PNG 图形", filename);
      showToast(`已导出 PNG · ${view.aggregate.total} 条记录的当前视图`);
    };
    if (elements.canvas.toBlob) {
      elements.canvas.toBlob(finish, "image/png");
    } else {
      fetch(elements.canvas.toDataURL("image/png"))
        .then((response) => response.blob())
        .then(finish);
    }
  }

  function exportCsv() {
    if (!view) return;
    const filename = `${buildFileStem()}.csv`;
    const blob = new Blob([Data.buildCsv(view)], {
      type: "text/csv;charset=utf-8",
    });
    downloadBlob(blob, filename);
    updateExportNote("CSV 明细", filename);
    showToast(`已导出 CSV · ${view.aggregate.total} 条记录与聚合结果`);
  }
})();
