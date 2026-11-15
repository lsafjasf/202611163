(function () {
  "use strict";

  const C = window.CargoFlow;
  const STORAGE_KEY = "cargo-flow-compass.v1";
  const $ = function (selector) { return document.querySelector(selector); };
  const $$ = function (selector) { return Array.from(document.querySelectorAll(selector)); };
  const numberFormat = new Intl.NumberFormat("zh-CN");
  const TYPE_LABELS = { factory: "工厂", warehouse: "仓库", store: "门店" };
  const TYPE_GLYPHS = { factory: "厂", warehouse: "仓", store: "店" };
  const QUALITY_LABELS = { valid: "有效", duplicate: "重复", missing: "缺失", anomaly: "异常" };

  function defaultState() {
    return {
      datasetKey: "normal",
      windowKey: "14d",
      region: "全部",
      selectedNode: "F1",
      stepsByDataset: { normal: 0, missing: 0, duplicate: 0 },
      capacitiesByDataset: { normal: {}, missing: {}, duplicate: {} }
    };
  }

  function loadState() {
    const base = defaultState();
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!saved || !C.DATASETS[saved.datasetKey]) return base;
      return {
        datasetKey: saved.datasetKey,
        windowKey: C.WINDOWS.some(function (item) { return item.key === saved.windowKey; }) ? saved.windowKey : base.windowKey,
        region: C.REGIONS.includes(saved.region) ? saved.region : "全部",
        selectedNode: saved.selectedNode || null,
        stepsByDataset: Object.assign({}, base.stepsByDataset, saved.stepsByDataset || {}),
        capacitiesByDataset: Object.assign({}, base.capacitiesByDataset, saved.capacitiesByDataset || {})
      };
    } catch (error) {
      return base;
    }
  }

  const state = loadState();
  let cleaned = null;
  let model = null;
  let exportCheck = null;
  let toastTimer = null;
  let capacityTimer = null;

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      // Persistence is best-effort when local storage is unavailable.
    }
  }

  function format(value) {
    const numeric = Number(value) || 0;
    return numberFormat.format(Math.round(numeric * 10) / 10);
  }

  function percent(value) {
    return (Number(value) || 0).toFixed(1).replace(/\.0$/, "") + "%";
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function currentCapacities() {
    if (!state.capacitiesByDataset[state.datasetKey]) state.capacitiesByDataset[state.datasetKey] = {};
    return state.capacitiesByDataset[state.datasetKey];
  }

  function currentStep() {
    return Math.min(10, Math.max(0, Number(state.stepsByDataset[state.datasetKey]) || 0));
  }

  function ensureSelection() {
    const activeIds = model.activeNodes.map(function (node) { return node.id; });
    if (!activeIds.includes(state.selectedNode)) {
      state.selectedNode = activeIds[0] || null;
      saveState();
    }
  }

  function computeAll() {
    cleaned = C.cleanDataset(C.DATASETS[state.datasetKey]);
    model = C.buildModel(cleaned, {
      windowKey: state.windowKey,
      region: state.region,
      anchorDate: C.ANCHOR_DATE
    }, currentCapacities(), currentStep());
    ensureSelection();
    const payload = C.buildExportPayload(model, new Date().toISOString());
    exportCheck = C.validateExportPayload(payload, model);
    return model;
  }

  function showToast(message, isError) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.toggle("error", Boolean(isError));
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.classList.remove("show"); }, 2600);
  }

  function renderTabs() {
    $$("[data-dataset]").forEach(function (button) {
      const active = button.dataset.dataset === state.datasetKey;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    $$("[data-window]").forEach(function (button) {
      button.classList.toggle("active", button.dataset.window === state.windowKey);
    });
    $$("[data-region]").forEach(function (button) {
      button.classList.toggle("active", button.dataset.region === state.region);
    });
  }

  function renderHeader() {
    const dataset = C.DATASETS[state.datasetKey];
    $("#versionText").textContent = dataset.version;
    $("#updatedText").textContent = "更新 " + dataset.updatedAt;
    $("#footerVersion").textContent = dataset.name + " · " + dataset.version;
    $("#footerFingerprint").textContent = "快照指纹 " + model.fingerprint;
    const score = Math.round(model.quality.qualityScore * 100);
    $("#qualityRing").style.setProperty("--ring", score + "%");
    $("#qualityRing").style.setProperty("--ring-color", score >= 90 ? "var(--cyan)" : score >= 70 ? "var(--amber)" : "var(--red)");
    $("#qualityRing b").textContent = score + "%";
    $("#qualityScoreText").textContent = model.quality.validCount + " / " + model.quality.rawCount + " 条有效";
    $("#filterSummary").textContent = model.window.label + " " + model.window.rangeLabel
      + " · " + model.region + " · " + model.statisticsScope.records + " 张有效单据";
  }

  function renderKpis() {
    const totals = model.totals;
    $("#kpiSupply").textContent = format(totals.supply);
    $("#kpiDemand").textContent = format(totals.demand);
    $("#kpiDelivered").textContent = format(totals.delivered);
    $("#kpiGap").textContent = format(totals.gap);
    $("#kpiOverload").textContent = format(totals.overloadedRoutes);
    const deliveryRate = totals.demand ? totals.delivered / totals.demand : 0;
    $("#kpiDeliveredNote").textContent = "需求满足率 " + percent(deliveryRate * 100);
    $("#kpiGapNote").textContent = totals.gap > 0
      ? "尚有 " + format(totals.gap) + " 件需求未被线路消化"
      : "全部需求已由可行线路满足";
  }

  function renderDetail() {
    const node = model.activeNodes.find(function (item) { return item.id === state.selectedNode; }) || model.activeNodes[0];
    if (!node) {
      $("#detailTitle").textContent = "无可用节点";
      return;
    }
    $("#detailTitle").textContent = node.name;
    $("#detailRegion").textContent = node.region + " · " + node.id + " · 当前筛选内";
    $("#detailPill").textContent = TYPE_LABELS[node.type];
    $("#detailPill").className = "node-type-pill " + node.type;
    $("#detailStatus").textContent = node.status;
    $("#detailStatus").className = "status-chip " + node.statusTone;

    if (node.type === "factory") {
      $("#detailMetric1Label").textContent = "可供量";
      $("#detailMetric2Label").textContent = "已发运";
      $("#detailMetric3Label").textContent = "库存余量";
      $("#detailMetric1").textContent = format(node.supply);
      $("#detailMetric2").textContent = format(node.outbound);
      $("#detailMetric3").textContent = format(node.stock);
      $("#detailFormula").textContent = "可供 " + format(node.supply) + " − 已发运 " + format(node.outbound)
        + " = 余量 " + format(node.stock) + "。发运量来自容量约束最大流。";
    } else if (node.type === "warehouse") {
      $("#detailMetric1Label").textContent = "累计入库";
      $("#detailMetric2Label").textContent = "累计出库";
      $("#detailMetric3Label").textContent = "暂存差额";
      $("#detailMetric1").textContent = format(node.inbound);
      $("#detailMetric2").textContent = format(node.outbound);
      $("#detailMetric3").textContent = format(node.stock);
      $("#detailFormula").textContent = "入库 " + format(node.inbound) + " − 出库 " + format(node.outbound)
        + " = 暂存差额 " + format(node.stock) + "。中间节点应严格守恒。";
    } else {
      $("#detailMetric1Label").textContent = "实际到货";
      $("#detailMetric2Label").textContent = "需求量";
      $("#detailMetric3Label").textContent = "库存缺口";
      $("#detailMetric1").textContent = format(node.supply);
      $("#detailMetric2").textContent = format(node.demand);
      $("#detailMetric3").textContent = format(node.gap);
      $("#detailFormula").textContent = "需求 " + format(node.demand) + " − 到货 " + format(node.supply)
        + " = 缺口 " + format(node.gap) + "。缺口随线路容量调整实时变化。";
    }
    $("#detailMetric3").className = node.statusTone === "danger" ? "value-danger" : node.statusTone === "warn" ? "value-warn" : "";
  }

  function renderRouteList() {
    const list = $("#routeList");
    list.innerHTML = model.activeRoutes.map(function (route) {
      const stateClass = route.overloaded ? "over" : route.flow > 0 ? "ok" : "";
      const stateText = route.overloaded ? "超载 +" + format(route.overloadAmount) : route.flow > 0 ? "正常" : "待命";
      return '<div class="route-row ' + (route.overloaded ? "overloaded" : "") + '" data-route-row="' + route.id + '">'
        + '<div><div class="route-name"><span class="route-id">' + escapeHtml(route.id.replace(/^R-/, ""))
        + '</span>' + escapeHtml(route.fromName) + ' → ' + escapeHtml(route.toName) + '</div>'
        + '<div class="route-meta"><span>计划 <b>' + format(route.planned) + '</b></span><span>实流 <b>'
        + format(route.flow) + '</b></span><span>利用率 <b>' + percent(route.utilization * 100) + '</b></span></div></div>'
        + '<div class="route-controls"><span class="route-state ' + stateClass + '">' + stateText + '</span>'
        + '<div class="capacity-control"><input type="number" min="0" max="200" step="5" value="' + route.capacity
        + '" data-capacity-for="' + route.id + '" aria-label="' + escapeHtml(route.fromName) + '到'
        + escapeHtml(route.toName) + '容量"><span>件</span></div></div></div>';
    }).join("");
  }

  function renderNodeTable() {
    $("#nodeRowCount").textContent = model.activeNodes.length + " 个节点 · " + model.activeRoutes.length + " 条线路";
    $("#nodeTableBody").innerHTML = model.activeNodes.map(function (node) {
      const third = node.type === "store" ? node.gap : node.stock;
      const thirdLabel = node.type === "store" ? "缺口" : "余量";
      const thirdClass = node.type === "store" && third > 0 ? "value-danger" : node.type === "factory" && third > 0 ? "value-warn" : "";
      return '<tr data-node-row="' + node.id + '" class="' + (state.selectedNode === node.id ? "selected" : "") + '">'
        + '<td><div class="node-cell"><span class="node-glyph ' + node.type + '">' + TYPE_GLYPHS[node.type] + '</span>'
        + '<span>' + escapeHtml(node.name) + '<small>' + node.id + ' · ' + node.region + '</small></span></div></td>'
        + '<td>' + TYPE_LABELS[node.type] + '</td><td>' + format(node.supply) + '</td><td>' + format(node.demand) + '</td>'
        + '<td class="' + thirdClass + '">' + format(third) + ' <small>' + thirdLabel + '</small></td>'
        + '<td><span class="mini-status ' + node.statusTone + '">' + escapeHtml(node.status) + '</span></td></tr>';
    }).join("");
  }

  function renderQuality() {
    const quality = model.quality;
    const score = Math.round(quality.qualityScore * 100);
    $("#qualityBigScore").textContent = score + "%";
    $("#qualityHeadline").textContent = score + "% 原始记录可进入计算";
    $("#qualitySubline").textContent = "整份数据 " + quality.rawCount + " 条；当前筛选纳入 "
      + model.statisticsScope.records + " 条有效单据，覆盖 " + model.window.rangeLabel + "。";
    $("#qualityRaw").textContent = format(quality.rawCount);
    $("#qualityDuplicates").textContent = format(quality.duplicates);
    $("#qualityMissing").textContent = format(quality.missing);
    $("#qualityAnomalies").textContent = format(quality.anomalies);
    $("#qualityValid").textContent = format(quality.validCount);
    const checks = model.conservation.checks.concat([{
      key: "export",
      label: "导出一致性",
      pass: Boolean(exportCheck && exportCheck.valid),
      value: exportCheck && exportCheck.valid ? "屏幕模型与导出快照一致" : "快照不一致"
    }]);
    $("#validationList").innerHTML = checks.map(function (check) {
      return '<div class="validation-row ' + (check.pass ? "" : "fail") + '">'
        + '<span class="check">' + (check.pass ? "✓" : "!") + '</span><b>' + escapeHtml(check.label)
        + '</b><span>' + escapeHtml(check.value) + '</span></div>';
    }).join("");
  }

  function renderRunControls() {
    const step = currentStep();
    const done = step >= 10;
    $("#stepCounter").textContent = step + "/10";
    $("#stepProgress").style.width = (step * 10) + "%";
    $("#runButtonText").textContent = done ? "推演已完成" : step > 0 ? "再运行一步" : "运行一步";
    $("#runButton").classList.toggle("done", done);
    $("#runButton").disabled = done;
    $("#runHint").textContent = done ? "推演完成，可导出当前一致快照" : "再运行 " + (10 - step) + " 步解锁导出";
    $("#exportButton").disabled = !done;
    $("#exportButton").textContent = done ? "导出图表" : "导出图表 · " + step + "/10";
    $("#exportButton").title = done ? "导出包含当前筛选与数值的 PNG 图表" : "完成 10 步后解锁";
    $("#conservationBadge").textContent = model.conservation.valid ? "守恒校验通过" : "守恒校验异常";
    $("#conservationBadge").classList.toggle("invalid", !model.conservation.valid);
    const scope = model.statisticsScope;
    $("#statsScopeText").textContent = scope.source + " " + scope.records + " 张 · " + scope.window.fullLabel
      + " · " + scope.region + " · " + scope.flowMethod + "；计划负载按" + scope.planMethod + "。";
  }

  function renderSampleModal() {
    if (!cleaned) return;
    $("#sampleSummary").textContent = model.datasetName + " · " + model.version + " · 共 " + cleaned.rawCount
      + " 条原始记录：去重 " + cleaned.duplicates + "，缺失 " + cleaned.missing + "，异常 "
      + cleaned.anomalies + "，有效 " + cleaned.validCount + "。";
    $("#sampleTableBody").innerHTML = cleaned.rows.map(function (item) {
      const source = item.source || {};
      return '<tr><td><span class="quality-badge ' + item.status + '">' + QUALITY_LABELS[item.status] + '</span></td>'
        + '<td>' + escapeHtml(source.recordId || "—") + '</td>'
        + '<td>' + escapeHtml(source.date || "—") + '</td>'
        + '<td>' + escapeHtml(source.factory || "—") + '</td>'
        + '<td>' + escapeHtml(source.warehouse || "—") + '</td>'
        + '<td>' + escapeHtml(source.store || "—") + '</td>'
        + '<td>' + escapeHtml(source.qty === null || source.qty === undefined || source.qty === "" ? "—" : source.qty) + '</td>'
        + '<td>' + escapeHtml(item.reason || "—") + '</td></tr>';
    }).join("");
  }

  function renderAll() {
    computeAll();
    renderTabs();
    renderHeader();
    renderKpis();
    renderDetail();
    renderRouteList();
    renderNodeTable();
    renderQuality();
    renderRunControls();
    drawFlowMap();
  }

  function setDataset(key) {
    if (!C.DATASETS[key]) return;
    state.datasetKey = key;
    state.selectedNode = null;
    saveState();
    renderAll();
    showToast("已切换至" + C.DATASETS[key].name + "，容量与步数按数据版本保留");
  }

  function setWindow(key) {
    if (!C.WINDOWS.some(function (item) { return item.key === key; })) return;
    state.windowKey = key;
    saveState();
    renderAll();
    showToast("时间窗口已切换，容量、节点选择与推演步数保持不变");
  }

  function setRegion(region) {
    if (!C.REGIONS.includes(region)) return;
    state.region = region;
    saveState();
    renderAll();
    showToast("区域筛选已同步更新图形、表格与导出快照");
  }

  function runStep() {
    if (currentStep() >= 10) return;
    state.stepsByDataset[state.datasetKey] = currentStep() + 1;
    saveState();
    renderAll();
    if (currentStep() === 10) {
      showToast("10 步推演完成，当前图表可导出");
    }
  }

  function handleCapacityInput(event) {
    const input = event.target.closest("[data-capacity-for]");
    if (!input) return;
    const routeId = input.dataset.capacityFor;
    const raw = Math.max(0, Math.min(200, Number(input.value) || 0));
    currentCapacities()[routeId] = raw;
    saveState();
    clearTimeout(capacityTimer);
    capacityTimer = setTimeout(function () {
      renderAll();
      const next = document.querySelector('[data-capacity-for="' + routeId + '"]');
      if (next) {
        next.focus();
        next.select();
      }
    }, 120);
  }

  function resetCapacities() {
    state.capacitiesByDataset[state.datasetKey] = {};
    saveState();
    renderAll();
    showToast("当前数据的线路容量已恢复默认");
  }

  function resetSandbox() {
    const fresh = defaultState();
    Object.assign(state, fresh);
    saveState();
    renderAll();
    showToast("筛选、容量与推演进度已重置");
  }

  const MAP_WIDTH = 840;
  const MAP_HEIGHT = 520;
  const canvas = $("#flowCanvas");
  const ctx = canvas.getContext("2d");
  let mapTransform = { scale: 1, offsetX: 0, offsetY: 0, dpr: 1 };
  let hoverNodeId = null;
  let animationTime = 0;

  function roundRect(context, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
  }

  function routeGeometry(route) {
    const from = C.NODES[route.from];
    const to = C.NODES[route.to];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const direction = route.id.endsWith("2") ? 1 : route.id.endsWith("4") ? -1 : 1;
    const bend = Math.min(18, length * 0.075) * direction;
    return {
      start: { x: from.x, y: from.y },
      end: { x: to.x, y: to.y },
      control: {
        x: (from.x + to.x) / 2 - (dy / length) * bend,
        y: (from.y + to.y) / 2 + (dx / length) * bend
      }
    };
  }

  function pointOnCurve(geometry, t) {
    const inverse = 1 - t;
    return {
      x: inverse * inverse * geometry.start.x + 2 * inverse * t * geometry.control.x + t * t * geometry.end.x,
      y: inverse * inverse * geometry.start.y + 2 * inverse * t * geometry.control.y + t * t * geometry.end.y
    };
  }

  function curveTangent(geometry, t) {
    return {
      x: 2 * (1 - t) * (geometry.control.x - geometry.start.x) + 2 * t * (geometry.end.x - geometry.control.x),
      y: 2 * (1 - t) * (geometry.control.y - geometry.start.y) + 2 * t * (geometry.end.y - geometry.control.y)
    };
  }

  function strokeCurve(context, geometry) {
    context.beginPath();
    context.moveTo(geometry.start.x, geometry.start.y);
    context.quadraticCurveTo(geometry.control.x, geometry.control.y, geometry.end.x, geometry.end.y);
    context.stroke();
  }

  function drawZone(context, left, label, sublabel, active) {
    context.save();
    roundRect(context, left, 20, 396, 478, 20);
    const gradient = context.createLinearGradient(left, 20, left + 396, 498);
    gradient.addColorStop(0, active ? "rgba(42, 104, 111, 0.11)" : "rgba(42, 70, 82, 0.035)");
    gradient.addColorStop(1, active ? "rgba(11, 44, 57, 0.05)" : "rgba(10, 28, 35, 0.02)");
    context.fillStyle = gradient;
    context.fill();
    context.setLineDash([3, 7]);
    context.lineWidth = 1;
    context.strokeStyle = active ? "rgba(102, 190, 190, 0.15)" : "rgba(102, 150, 160, 0.06)";
    context.stroke();
    context.setLineDash([]);
    context.globalAlpha = active ? 1 : 0.35;
    context.fillStyle = "#6f929b";
    context.font = '650 10px "Noto Sans SC", "Microsoft YaHei", sans-serif';
    context.fillText(label, left + 17, 42);
    context.fillStyle = "rgba(111, 146, 155, 0.58)";
    context.font = '500 7px "Segoe UI", sans-serif';
    context.fillText(sublabel, left + 17, 53);
    context.restore();
  }

  function drawMapBackground(context) {
    const background = context.createLinearGradient(0, 0, MAP_WIDTH, MAP_HEIGHT);
    background.addColorStop(0, "#071820");
    background.addColorStop(0.52, "#071720");
    background.addColorStop(1, "#05131b");
    context.fillStyle = background;
    context.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);

    const glow = context.createRadialGradient(415, 260, 20, 415, 260, 380);
    glow.addColorStop(0, "rgba(41, 128, 129, 0.09)");
    glow.addColorStop(1, "rgba(41, 128, 129, 0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);

    context.fillStyle = "rgba(150, 197, 204, 0.09)";
    for (let x = 24; x < MAP_WIDTH; x += 24) {
      for (let y = 22; y < MAP_HEIGHT; y += 24) {
        context.beginPath();
        context.arc(x, y, 0.65, 0, Math.PI * 2);
        context.fill();
      }
    }
    drawZone(context, 8, "华东网络 / EAST", "F1 · F2 → W1 · W2 → S1 · S2", state.region === "全部" || state.region === "华东");
    drawZone(context, 436, "华南网络 / SOUTH", "F3 → W3 · W4 → S3 · S4", state.region === "全部" || state.region === "华南");

    context.strokeStyle = "rgba(123, 180, 191, 0.11)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(420, 38);
    context.lineTo(420, 480);
    context.stroke();
  }

  function drawRoute(context, route, maxFlow, time) {
    if (!route.active) return;
    const geometry = routeGeometry(route);
    const busy = route.flow > 0;
    const flowWidth = busy ? 2.2 + 5.8 * Math.min(1, route.flow / maxFlow) : 1;
    const warning = route.overloaded;
    const color = warning ? "#ff7378" : "#4fe3c1";
    const baseColor = warning ? "rgba(255, 115, 120, 0.18)" : "rgba(127, 175, 184, 0.13)";

    context.save();
    context.lineCap = "round";
    context.lineWidth = warning ? 8 : 7;
    context.strokeStyle = baseColor;
    strokeCurve(context, geometry);

    if (warning) {
      context.shadowColor = "rgba(255, 86, 94, 0.35)";
      context.shadowBlur = 12;
      context.strokeStyle = "rgba(255, 115, 120, 0.48)";
      context.lineWidth = 3.2;
      strokeCurve(context, geometry);
      context.shadowBlur = 0;
      context.setLineDash([5, 5]);
      context.lineDashOffset = -time * 0.018;
      context.strokeStyle = "rgba(255, 137, 140, 0.9)";
      context.lineWidth = 1.6;
      strokeCurve(context, geometry);
      context.setLineDash([]);
    }

    if (busy) {
      context.strokeStyle = color;
      context.globalAlpha = warning ? 0.92 : 0.86;
      context.lineWidth = flowWidth;
      context.shadowColor = warning ? "rgba(255, 93, 100, 0.42)" : "rgba(79, 227, 193, 0.33)";
      context.shadowBlur = 8;
      strokeCurve(context, geometry);
      context.shadowBlur = 0;
      context.globalAlpha = 1;

      const tangent = curveTangent(geometry, 0.7);
      const angle = Math.atan2(tangent.y, tangent.x);
      const arrow = pointOnCurve(geometry, 0.7);
      context.save();
      context.translate(arrow.x, arrow.y);
      context.rotate(angle);
      context.fillStyle = color;
      context.beginPath();
      context.moveTo(4.5, 0);
      context.lineTo(-2.5, -3.1);
      context.lineTo(-2.5, 3.1);
      context.closePath();
      context.fill();
      context.restore();

      const dotCount = Math.min(4, Math.max(1, Math.ceil(route.flow / 35)));
      for (let index = 0; index < dotCount; index += 1) {
        const phase = ((time * 0.00006) + index / dotCount + route.id.length * 0.071) % 1;
        const dot = pointOnCurve(geometry, 0.18 + phase * 0.62);
        context.beginPath();
        context.arc(dot.x, dot.y, warning ? 2 : 1.7, 0, Math.PI * 2);
        context.fillStyle = warning ? "#ffc0c2" : "#c8fff2";
        context.shadowColor = color;
        context.shadowBlur = 7;
        context.fill();
        context.shadowBlur = 0;
      }
    }

    if (warning) {
      const badge = pointOnCurve(geometry, 0.51);
      const label = "超载 +" + format(route.overloadAmount);
      context.font = '650 8px "Noto Sans SC", "Microsoft YaHei", sans-serif';
      const labelWidth = context.measureText(label).width + 14;
      roundRect(context, badge.x - labelWidth / 2, badge.y - 20, labelWidth, 16, 5);
      context.fillStyle = "rgba(61, 15, 22, 0.94)";
      context.fill();
      context.strokeStyle = "rgba(255, 115, 120, 0.42)";
      context.lineWidth = 1;
      context.stroke();
      context.fillStyle = "#ff9a9e";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(label, badge.x, badge.y - 11.7);
      context.textAlign = "start";
      context.textBaseline = "alphabetic";
    }
    context.restore();
  }

  function nodeColors(type) {
    if (type === "factory") return { main: "#4fe3c1", soft: "rgba(79,227,193,.12)", border: "rgba(79,227,193,.24)" };
    if (type === "warehouse") return { main: "#f3c66a", soft: "rgba(243,198,106,.12)", border: "rgba(243,198,106,.24)" };
    return { main: "#b49dff", soft: "rgba(180,157,255,.12)", border: "rgba(180,157,255,.24)" };
  }

  function drawNode(context, node, selected, hovered, time) {
    const colors = nodeColors(node.type);
    const x = node.x - 47;
    const y = node.y - 25;
    const width = 94;
    const height = 50;
    context.save();
    context.globalAlpha = node.active ? 1 : 0.18;
    if (selected) {
      context.shadowColor = colors.main;
      context.shadowBlur = 20;
    } else if (hovered) {
      context.shadowColor = "rgba(148, 213, 220, 0.25)";
      context.shadowBlur = 14;
    }
    roundRect(context, x, y, width, height, 12);
    const gradient = context.createLinearGradient(x, y, x, y + height);
    gradient.addColorStop(0, selected ? "rgba(25, 51, 61, 0.98)" : "rgba(18, 39, 49, 0.96)");
    gradient.addColorStop(1, "rgba(8, 25, 34, 0.98)");
    context.fillStyle = gradient;
    context.fill();
    context.shadowBlur = 0;
    context.strokeStyle = selected ? colors.main : hovered ? colors.border : "rgba(128, 173, 183, 0.15)";
    context.lineWidth = selected ? 1.4 : 1;
    context.stroke();

    roundRect(context, x + 8, y + 10, 26, 26, 7);
    context.fillStyle = colors.soft;
    context.fill();
    context.strokeStyle = colors.border;
    context.stroke();
    context.fillStyle = colors.main;
    context.font = '700 10px "Noto Sans SC", "Microsoft YaHei", sans-serif';
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(TYPE_GLYPHS[node.type], x + 21, y + 23.5);
    context.textAlign = "start";
    context.textBaseline = "alphabetic";

    context.fillStyle = "#e8f5f6";
    context.font = '600 10.5px "Noto Sans SC", "Microsoft YaHei", sans-serif';
    context.fillText(node.short, x + 41, y + 21);
    context.fillStyle = "rgba(139, 172, 180, 0.82)";
    context.font = '500 7.5px "Noto Sans SC", "Microsoft YaHei", sans-serif';
    let summary = "";
    if (node.type === "factory") summary = "供 " + format(node.supply) + " · 发 " + format(node.outbound);
    if (node.type === "warehouse") summary = "入 " + format(node.inbound) + " · 出 " + format(node.outbound);
    if (node.type === "store") summary = "到 " + format(node.supply) + " · 需 " + format(node.demand);
    context.fillText(summary, x + 41, y + 35);

    const toneColor = node.statusTone === "danger" ? "#ff7378" : node.statusTone === "warn" ? "#f3c66a" : node.statusTone === "good" ? "#69dfa4" : "#6c8992";
    context.beginPath();
    context.arc(x + width - 9, y + 9, 2.2, 0, Math.PI * 2);
    context.fillStyle = toneColor;
    context.shadowColor = toneColor;
    context.shadowBlur = node.statusTone === "danger" ? 8 : 3;
    context.fill();
    context.shadowBlur = 0;

    if (node.type === "factory" && node.stock > 0) {
      context.fillStyle = "#f3c66a";
      context.font = '600 7px "Noto Sans SC", "Microsoft YaHei", sans-serif';
      context.textAlign = "right";
      context.fillText("余 " + format(node.stock), x + width - 8, y + height - 7);
      context.textAlign = "start";
    }
    if (node.type === "store" && node.gap > 0) {
      context.fillStyle = "#ff8d91";
      context.font = '650 7px "Noto Sans SC", "Microsoft YaHei", sans-serif';
      context.textAlign = "right";
      context.fillText("缺 " + format(node.gap), x + width - 8, y + height - 7);
      context.textAlign = "start";
    }
    context.restore();
  }

  function drawFlowMap(contextOverride, options) {
    const context = contextOverride || ctx;
    const opts = options || {};
    const drawModel = opts.model || model;
    const time = opts.time === undefined ? performance.now() : opts.time;
    const selected = opts.selectedNode === undefined ? state.selectedNode : opts.selectedNode;
    const maxFlow = Math.max(1, Math.max.apply(null, drawModel.activeRoutes.map(function (route) { return route.flow; })));
    drawMapBackground(context);
    drawModel.activeRoutes.forEach(function (route) {
      drawRoute(context, route, maxFlow, time);
    });
    drawModel.activeNodes.forEach(function (node) {
      drawNode(context, node, selected === node.id, !opts.exportMode && hoverNodeId === node.id, time);
    });
  }

  function resizeCanvas() {
    const wrap = $("#canvasWrap");
    const rect = wrap.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    const scale = Math.min(width / MAP_WIDTH, height / MAP_HEIGHT);
    mapTransform = {
      scale: scale,
      offsetX: (width - MAP_WIDTH * scale) / 2,
      offsetY: (height - MAP_HEIGHT * scale) / 2,
      dpr: dpr
    };
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * mapTransform.offsetX, dpr * mapTransform.offsetY);
    drawFlowMap();
  }

  function eventToMapPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left - mapTransform.offsetX) / mapTransform.scale,
      y: (event.clientY - rect.top - mapTransform.offsetY) / mapTransform.scale
    };
  }

  function findNodeAt(point) {
    for (let index = model.activeNodes.length - 1; index >= 0; index -= 1) {
      const node = model.activeNodes[index];
      if (Math.abs(point.x - node.x) <= 50 && Math.abs(point.y - node.y) <= 28) return node;
    }
    return null;
  }

  function handleNodeClick(event) {
    const node = findNodeAt(eventToMapPoint(event));
    if (!node) return;
    state.selectedNode = node.id;
    saveState();
    renderDetail();
    renderNodeTable();
    drawFlowMap();
  }

  function handleCanvasMove(event) {
    const node = findNodeAt(eventToMapPoint(event));
    const nextHover = node ? node.id : null;
    canvas.style.cursor = nextHover ? "pointer" : "default";
    if (nextHover !== hoverNodeId) {
      hoverNodeId = nextHover;
      drawFlowMap();
    }
  }

  function animateMap(time) {
    animationTime = time;
    if (!document.hidden && model) {
      ctx.setTransform(mapTransform.dpr * mapTransform.scale, 0, 0, mapTransform.dpr * mapTransform.scale,
        mapTransform.dpr * mapTransform.offsetX, mapTransform.dpr * mapTransform.offsetY);
      drawFlowMap(ctx, { time: time });
    }
    window.requestAnimationFrame(animateMap);
  }

  function drawExportPill(context, text, x, y, color, background) {
    context.font = '600 15px "Noto Sans SC", "Microsoft YaHei", sans-serif';
    const width = context.measureText(text).width + 28;
    roundRect(context, x, y, width, 32, 16);
    context.fillStyle = background;
    context.fill();
    context.strokeStyle = color.replace(")", ", .25)").replace("rgb", "rgba");
    context.lineWidth = 1;
    context.stroke();
    context.fillStyle = color;
    context.textBaseline = "middle";
    context.fillText(text, x + 14, y + 16.5);
    context.textBaseline = "alphabetic";
    return width;
  }

  function renderExportCanvas(payload) {
    const width = 1900;
    const height = 1200;
    const output = document.createElement("canvas");
    output.width = width;
    output.height = height;
    const context = output.getContext("2d");
    context.fillStyle = "#06131c";
    context.fillRect(0, 0, width, height);
    const background = context.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, "rgba(13, 42, 51, .72)");
    background.addColorStop(0.48, "rgba(7, 24, 33, .55)");
    background.addColorStop(1, "rgba(8, 20, 31, .8)");
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);

    context.fillStyle = "#4fe3c1";
    context.fillRect(62, 52, 5, 44);
    context.fillStyle = "#edf7f8";
    context.font = '700 33px "Noto Sans SC", "Microsoft YaHei", sans-serif';
    context.fillText("货流罗盘 · 物流流量与库存缺口", 86, 82);
    context.fillStyle = "#78959e";
    context.font = '500 15px "Noto Sans SC", "Microsoft YaHei", sans-serif';
    context.fillText("工厂 → 仓储 → 门店  |  容量约束最大流  |  10 步推演快照", 87, 108);

    context.fillStyle = "rgba(255,255,255,.035)";
    roundRect(context, 1390, 43, 448, 70, 14);
    context.fill();
    context.strokeStyle = "rgba(124,181,193,.15)";
    context.stroke();
    context.fillStyle = "#6f8c95";
    context.font = '600 11px "Noto Sans SC", "Microsoft YaHei", sans-serif';
    context.fillText("DATA VERSION", 1412, 66);
    context.fillStyle = "#d9edef";
    context.font = '600 16px "Segoe UI", "Noto Sans SC", sans-serif';
    context.fillText(payload.dataVersion, 1412, 91);
    context.fillStyle = "#6f8c95";
    context.font = '500 11px "Noto Sans SC", "Microsoft YaHei", sans-serif';
    context.fillText(payload.dataset.name + " · " + payload.dataset.updatedAt, 1412, 107);

    let pillX = 86;
    const pills = [
      payload.filter.windowLabel + " " + payload.filter.dateStart + " → " + payload.filter.dateEnd,
      "区域 " + payload.filter.region,
      payload.statisticsScope.records + " 张有效单据",
      "第 " + payload.step + "/10 步"
    ];
    pills.forEach(function (text) {
      pillX += drawExportPill(context, text, pillX, 126, "#79d8c7", "rgba(79,227,193,.06)") + 10;
    });

    const kpis = [
      ["工厂可供量", payload.totals.supply, "#edf7f8"],
      ["门店需求量", payload.totals.demand, "#edf7f8"],
      ["已配送量", payload.totals.delivered, "#4fe3c1"],
      ["门店缺口", payload.totals.gap, payload.totals.gap > 0 ? "#ff7378" : "#4fe3c1"],
      ["超载线路", payload.totals.overloadedRoutes, payload.totals.overloadedRoutes > 0 ? "#f3c66a" : "#4fe3c1"]
    ];
    kpis.forEach(function (item, index) {
      const x = 62 + index * 360;
      roundRect(context, x, 178, 338, 78, 12);
      context.fillStyle = "rgba(10,29,39,.72)";
      context.fill();
      context.strokeStyle = "rgba(126,179,190,.12)";
      context.stroke();
      context.fillStyle = "#728e97";
      context.font = '500 13px "Noto Sans SC", "Microsoft YaHei", sans-serif';
      context.fillText(item[0], x + 18, 202);
      context.fillStyle = item[2];
      context.font = '650 30px "Segoe UI", "Noto Sans SC", sans-serif';
      context.fillText(format(item[1]), x + 18, 240);
    });

    context.save();
    context.translate(62, 286);
    const mapScale = 1190 / MAP_WIDTH;
    context.scale(mapScale, mapScale);
    drawFlowMap(context, { model: model, exportMode: true, time: 16000, selectedNode: state.selectedNode });
    context.restore();
    context.strokeStyle = "rgba(129,183,194,.16)";
    context.lineWidth = 1;
    roundRect(context, 62, 286, 1190, 735, 18);
    context.stroke();

    roundRect(context, 1282, 286, 556, 292, 16);
    context.fillStyle = "rgba(11,30,40,.8)";
    context.fill();
    context.strokeStyle = "rgba(129,183,194,.14)";
    context.stroke();
    context.fillStyle = "#edf7f8";
    context.font = '600 17px "Noto Sans SC", "Microsoft YaHei", sans-serif';
    context.fillText("数据质量摘要", 1308, 319);
    context.fillStyle = "#738f98";
    context.font = '500 12px "Noto Sans SC", "Microsoft YaHei", sans-serif';
    context.fillText("整份数据集 · 清洗先于筛选", 1308, 339);
    const quality = payload.quality;
    const qualityCells = [
      ["原始", quality.rawCount, "#dbecee"],
      ["去重", quality.duplicates, "#4fe3c1"],
      ["缺失", quality.missing, "#f3c66a"],
      ["异常", quality.anomalies, "#ff7378"],
      ["有效", quality.validCount, "#69dfa4"]
    ];
    qualityCells.forEach(function (item, index) {
      const x = 1308 + index * 101;
      roundRect(context, x, 356, 88, 67, 9);
      context.fillStyle = "rgba(255,255,255,.028)";
      context.fill();
      context.fillStyle = "#6e8a93";
      context.font = '500 11px "Noto Sans SC", "Microsoft YaHei", sans-serif';
      context.fillText(item[0], x + 10, 377);
      context.fillStyle = item[2];
      context.font = '650 20px "Segoe UI", sans-serif';
      context.fillText(format(item[1]), x + 10, 405);
    });
    context.fillStyle = "#73919a";
    context.font = '500 12px "Noto Sans SC", "Microsoft YaHei", sans-serif';
    context.fillText("统计口径", 1308, 452);
    context.fillStyle = "#c9dcdf";
    context.font = '500 13px "Noto Sans SC", "Microsoft YaHei", sans-serif';
    context.fillText(payload.statisticsScope.source + " " + payload.statisticsScope.records + " 张", 1308, 474);
    context.fillText(payload.statisticsScope.flowMethod + "；计划负载按路径聚合", 1308, 496);
    context.fillText("质量摘要：去重 " + quality.duplicates + " · 缺失 " + quality.missing
      + " · 异常 " + quality.anomalies + " · 有效 " + quality.validCount, 1308, 518);
    context.fillStyle = payload.conservation.valid ? "#69dfa4" : "#ff7378";
    context.font = '650 14px "Noto Sans SC", "Microsoft YaHei", sans-serif';
    context.fillText(payload.conservation.valid ? "✓ 全部守恒校验通过" : "! 守恒校验未通过", 1308, 548);

    roundRect(context, 1282, 594, 556, 427, 16);
    context.fillStyle = "rgba(11,30,40,.8)";
    context.fill();
    context.strokeStyle = "rgba(129,183,194,.14)";
    context.stroke();
    context.fillStyle = "#edf7f8";
    context.font = '600 17px "Noto Sans SC", "Microsoft YaHei", sans-serif';
    context.fillText("线路对账", 1308, 627);
    context.fillStyle = "#738f98";
    context.font = '500 11px "Noto Sans SC", "Microsoft YaHei", sans-serif';
    context.fillText("容量 / 计划负载 / 实际流量", 1308, 647);
    payload.routes.slice(0, 14).forEach(function (route, index) {
      const y = 674 + index * 23;
      if (index % 2 === 0) {
        context.fillStyle = "rgba(255,255,255,.018)";
        context.fillRect(1300, y - 12, 520, 21);
      }
      context.fillStyle = route.overloaded ? "#ff8589" : "#b8cdd1";
      context.font = '500 11px "Noto Sans SC", "Microsoft YaHei", sans-serif';
      context.fillText(route.fromName + " → " + route.toName, 1310, y + 2);
      context.fillStyle = "#f3c66a";
      context.fillText(format(route.capacity), 1602, y + 2);
      context.fillStyle = "#9eb4b9";
      context.fillText(format(route.planned), 1684, y + 2);
      context.fillStyle = route.overloaded ? "#ff7378" : "#4fe3c1";
      context.fillText(format(route.flow), 1762, y + 2);
    });

    context.fillStyle = "rgba(255,255,255,.025)";
    context.fillRect(0, 1062, width, 1);
    context.fillStyle = "#607d86";
    context.font = '500 12px "Noto Sans SC", "Microsoft YaHei", sans-serif';
    context.fillText("数据版本 " + payload.dataVersion + "  ·  快照指纹 " + payload.fingerprint
      + "  ·  生成 " + payload.generatedAt, 62, 1096);
    context.fillText("所有指标均由原始样例实时重算；导出数值与屏幕模型使用同一指纹校验。", 62, 1120);
    context.textAlign = "right";
    context.fillStyle = "#4fe3c1";
    context.font = '600 12px "Noto Sans SC", "Microsoft YaHei", sans-serif';
    context.fillText("Cargo Flow Compass / 货流罗盘", 1838, 1096);
    context.textAlign = "start";
    return output;
  }

  function exportChart() {
    if (!model.exportReady) {
      showToast("请先完成 10 步推演再导出", true);
      return;
    }
    const payload = C.buildExportPayload(model, new Date().toISOString());
    const check = C.validateExportPayload(payload, model);
    if (!check.valid) {
      showToast("屏幕模型与导出快照校验失败，已阻止导出", true);
      return;
    }
    const output = renderExportCanvas(payload);
    const filename = "cargo-flow_" + payload.filter.dateStart + "_" + payload.filter.dateEnd
      + "_" + payload.filter.region + "_" + payload.fingerprint + ".png";
    const finish = function (url, revoke) {
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      if (revoke) setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      showToast("图表已导出，快照指纹 " + payload.fingerprint);
    };
    if (output.toBlob) {
      output.toBlob(function (blob) {
        if (!blob) {
          finish(output.toDataURL("image/png"), false);
          return;
        }
        finish(URL.createObjectURL(blob), true);
      }, "image/png");
    } else {
      finish(output.toDataURL("image/png"), false);
    }
  }

  function openSampleModal() {
    renderSampleModal();
    $("#sampleModal").hidden = false;
  }

  function closeSampleModal() {
    $("#sampleModal").hidden = true;
  }

  function bindEvents() {
    $("#datasetSwitch").addEventListener("click", function (event) {
      const button = event.target.closest("[data-dataset]");
      if (button) setDataset(button.dataset.dataset);
    });
    $("#windowSwitch").addEventListener("click", function (event) {
      const button = event.target.closest("[data-window]");
      if (button) setWindow(button.dataset.window);
    });
    $("#regionSwitch").addEventListener("click", function (event) {
      const button = event.target.closest("[data-region]");
      if (button) setRegion(button.dataset.region);
    });
    $("#runButton").addEventListener("click", runStep);
    $("#exportButton").addEventListener("click", exportChart);
    $("#resetButton").addEventListener("click", resetSandbox);
    $("#resetCapacityButton").addEventListener("click", resetCapacities);
    $("#routeList").addEventListener("input", handleCapacityInput);
    $("#nodeTableBody").addEventListener("click", function (event) {
      const row = event.target.closest("[data-node-row]");
      if (!row) return;
      state.selectedNode = row.dataset.nodeRow;
      saveState();
      renderDetail();
      renderNodeTable();
      drawFlowMap();
    });
    $("#sampleButton").addEventListener("click", openSampleModal);
    $("#closeSampleButton").addEventListener("click", closeSampleModal);
    $("#sampleModal").addEventListener("click", function (event) {
      if (event.target === $("#sampleModal")) closeSampleModal();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !$("#sampleModal").hidden) closeSampleModal();
    });
    canvas.addEventListener("click", handleNodeClick);
    canvas.addEventListener("mousemove", handleCanvasMove);
    canvas.addEventListener("mouseleave", function () {
      hoverNodeId = null;
      canvas.style.cursor = "default";
      drawFlowMap();
    });

    if (window.ResizeObserver) {
      const observer = new ResizeObserver(function () { resizeCanvas(); });
      observer.observe($("#canvasWrap"));
    } else {
      window.addEventListener("resize", resizeCanvas);
    }
  }

  function init() {
    bindEvents();
    renderAll();
    renderSampleModal();
    resizeCanvas();
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        resizeCanvas();
        drawFlowMap();
      });
    }
    window.requestAnimationFrame(animateMap);
  }

  init();
})();
