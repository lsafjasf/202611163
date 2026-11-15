(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CargoFlow = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const REGIONS = ["全部", "华东", "华南"];
  const WINDOWS = [
    { key: "7d", label: "近 7 天", days: 7 },
    { key: "14d", label: "近 14 天", days: 14 },
    { key: "30d", label: "近 30 天", days: 30 }
  ];
  const ANCHOR_DATE = "2026-11-15";
  const MAX_DAILY_QTY = 200;

  const NODE_LIST = [
    { id: "F1", name: "苏州智造厂", short: "苏州厂", type: "factory", region: "华东", x: 112, y: 82 },
    { id: "F2", name: "宁波装配厂", short: "宁波厂", type: "factory", region: "华东", x: 310, y: 82 },
    { id: "F3", name: "佛山制造厂", short: "佛山厂", type: "factory", region: "华南", x: 616, y: 82 },
    { id: "W1", name: "上海中心仓", short: "上海仓", type: "warehouse", region: "华东", x: 92, y: 232 },
    { id: "W2", name: "杭州前置仓", short: "杭州仓", type: "warehouse", region: "华东", x: 321, y: 232 },
    { id: "W3", name: "广州枢纽仓", short: "广州仓", type: "warehouse", region: "华南", x: 549, y: 232 },
    { id: "W4", name: "深圳中转仓", short: "深圳仓", type: "warehouse", region: "华南", x: 742, y: 232 },
    { id: "S1", name: "南京新街口店", short: "南京店", type: "store", region: "华东", x: 80, y: 434 },
    { id: "S2", name: "苏州园区店", short: "苏州店", type: "store", region: "华东", x: 294, y: 434 },
    { id: "S3", name: "深圳南山店", short: "深圳店", type: "store", region: "华南", x: 551, y: 434 },
    { id: "S4", name: "东莞松山湖店", short: "东莞店", type: "store", region: "华南", x: 742, y: 434 }
  ];

  const ROUTE_LIST = [
    { id: "R-F1-W1", from: "F1", to: "W1", baseCapacity: 70 },
    { id: "R-F1-W2", from: "F1", to: "W2", baseCapacity: 50 },
    { id: "R-F2-W1", from: "F2", to: "W1", baseCapacity: 55 },
    { id: "R-F2-W2", from: "F2", to: "W2", baseCapacity: 45 },
    { id: "R-W1-S1", from: "W1", to: "S1", baseCapacity: 60 },
    { id: "R-W1-S2", from: "W1", to: "S2", baseCapacity: 50 },
    { id: "R-W2-S1", from: "W2", to: "S1", baseCapacity: 55 },
    { id: "R-W2-S2", from: "W2", to: "S2", baseCapacity: 45 },
    { id: "R-F3-W3", from: "F3", to: "W3", baseCapacity: 100 },
    { id: "R-F3-W4", from: "F3", to: "W4", baseCapacity: 75 },
    { id: "R-W3-S3", from: "W3", to: "S3", baseCapacity: 80 },
    { id: "R-W3-S4", from: "W3", to: "S4", baseCapacity: 65 },
    { id: "R-W4-S3", from: "W4", to: "S3", baseCapacity: 85 },
    { id: "R-W4-S4", from: "W4", to: "S4", baseCapacity: 60 }
  ];

  const NODES = Object.fromEntries(NODE_LIST.map(function (node) { return [node.id, node]; }));
  const ROUTES = Object.fromEntries(ROUTE_LIST.map(function (route) { return [route.id, route]; }));

  const BASE_ROWS = [
    ["SO-1101", "2026-11-15", "F1", "W1", "S1", 28],
    ["SO-1102", "2026-11-14", "F1", "W1", "S2", 22],
    ["SO-1103", "2026-11-13", "F1", "W2", "S2", 18],
    ["SO-1104", "2026-11-15", "F2", "W1", "S1", 26],
    ["SO-1105", "2026-11-12", "F2", "W1", "S2", 20],
    ["SO-1106", "2026-11-10", "F2", "W2", "S1", 16],
    ["SO-1107", "2026-11-08", "F1", "W2", "S1", 14],
    ["SO-1108", "2026-11-06", "F2", "W2", "S2", 12],
    ["SO-1109", "2026-11-03", "F1", "W1", "S1", 24],
    ["SO-1110", "2026-11-01", "F2", "W1", "S2", 15],
    ["SO-1111", "2026-10-29", "F1", "W2", "S2", 10],
    ["SO-1112", "2026-10-25", "F2", "W2", "S1", 9],
    ["SO-1113", "2026-11-15", "F3", "W3", "S3", 34],
    ["SO-1114", "2026-11-14", "F3", "W3", "S4", 25],
    ["SO-1115", "2026-11-12", "F3", "W4", "S3", 30],
    ["SO-1116", "2026-11-10", "F3", "W4", "S4", 21],
    ["SO-1117", "2026-11-07", "F3", "W3", "S3", 28],
    ["SO-1118", "2026-11-04", "F3", "W4", "S4", 18],
    ["SO-1119", "2026-10-31", "F3", "W3", "S4", 16],
    ["SO-1120", "2026-10-28", "F3", "W4", "S3", 24],
    ["SO-1121", "2026-10-22", "F3", "W3", "S3", 12],
    ["SO-1122", "2026-10-18", "F3", "W4", "S4", 15],
    ["SO-1123", "2026-11-09", "F1", "W1", "S2", 13],
    ["SO-1124", "2026-11-05", "F2", "W2", "S1", 11]
  ].map(function (row) {
    return { recordId: row[0], date: row[1], factory: row[2], warehouse: row[3], store: row[4], qty: row[5] };
  });

  function cloneRows(rows) {
    return rows.map(function (row) { return Object.assign({}, row); });
  }

  function makeMissingRows() {
    const rows = cloneRows(BASE_ROWS);
    rows[2].warehouse = "";
    rows[5].qty = null;
    rows[9].store = "  ";
    rows[14].date = "";
    rows[18].recordId = "";
    rows[4].qty = 0;
    rows[8].qty = -12;
    rows[12].qty = 999;
    rows[16].date = "2026/11/31";
    rows[20].store = "S9";
    rows.push(Object.assign({}, BASE_ROWS[0]));
    rows.push(Object.assign({}, BASE_ROWS[1]));
    return rows;
  }

  function makeDuplicateRows() {
    const rows = cloneRows(BASE_ROWS);
    [0, 3, 6, 9, 12, 13, 15, 18, 21, 22].forEach(function (index) {
      rows.push(Object.assign({}, BASE_ROWS[index]));
    });
    rows.push(Object.assign({}, BASE_ROWS[4]));
    rows.push(Object.assign({}, BASE_ROWS[22]));
    rows[7].warehouse = null;
    rows[17].qty = -5;
    return rows;
  }

  const DATASETS = {
    normal: {
      key: "normal",
      name: "正常样例",
      badge: "正常",
      version: "OPS-N-2026.11.16",
      updatedAt: "2026-11-16 09:30",
      description: "完整、可用的物流单据，用于基线核对。",
      rows: cloneRows(BASE_ROWS)
    },
    missing: {
      key: "missing",
      name: "缺失样例",
      badge: "缺失",
      version: "OPS-M-2026.11.16",
      updatedAt: "2026-11-16 09:34",
      description: "含空字段、非数值、非法日期和未知节点。",
      rows: makeMissingRows()
    },
    duplicate: {
      key: "duplicate",
      name: "重复样例",
      badge: "重复",
      version: "OPS-D-2026.11.16",
      updatedAt: "2026-11-16 09:38",
      description: "含重复单据及少量缺失、异常记录。",
      rows: makeDuplicateRows()
    }
  };

  const REQUIRED_FIELDS = ["recordId", "date", "factory", "warehouse", "store", "qty"];

  function normalizeText(value) {
    return typeof value === "string" ? value.trim() : value;
  }

  function isBlank(value) {
    return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
  }

  function parseDate(value) {
    const text = normalizeText(value);
    if (typeof text !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
    const date = new Date(text + "T00:00:00Z");
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) return null;
    return date;
  }

  function dateText(date) {
    return date.toISOString().slice(0, 10);
  }

  function addDays(dateTextValue, days) {
    const date = parseDate(dateTextValue);
    if (!date) return null;
    date.setUTCDate(date.getUTCDate() + days);
    return dateText(date);
  }

  function shortDate(value) {
    const date = parseDate(value);
    if (!date) return value || "—";
    return String(date.getUTCMonth() + 1).padStart(2, "0") + "/" + String(date.getUTCDate()).padStart(2, "0");
  }

  function getWindow(windowKey, anchorDate) {
    const window = WINDOWS.find(function (item) { return item.key === windowKey; }) || WINDOWS[1];
    const end = anchorDate || ANCHOR_DATE;
    const start = addDays(end, 1 - window.days);
    return {
      key: window.key,
      label: window.label,
      days: window.days,
      start: start,
      end: end,
      rangeLabel: shortDate(start) + "–" + shortDate(end),
      fullLabel: start + " 至 " + end
    };
  }

  function rowSignature(row) {
    return REQUIRED_FIELDS.map(function (field) {
      return String(normalizeText(row[field]) ?? "");
    }).join("\u001f");
  }

  function validateRow(row) {
    const missing = REQUIRED_FIELDS.filter(function (field) { return isBlank(row[field]); });
    if (missing.length) {
      return { status: "missing", reason: "必填字段缺失：" + missing.join("、") };
    }

    const factory = NODES[row.factory];
    const warehouse = NODES[row.warehouse];
    const store = NODES[row.store];
    const nodeError = !factory || factory.type !== "factory"
      ? "未知工厂 " + row.factory
      : !warehouse || warehouse.type !== "warehouse"
        ? "未知仓库 " + row.warehouse
        : !store || store.type !== "store"
          ? "未知门店 " + row.store
          : null;
    if (nodeError) return { status: "anomaly", reason: nodeError };

    const date = parseDate(row.date);
    if (!date || row.date !== dateText(date)) {
      return { status: "anomaly", reason: "日期格式或日期值非法" };
    }

    const qty = Number(row.qty);
    if (!Number.isFinite(qty)) return { status: "anomaly", reason: "数量不是有效数字" };
    if (qty <= 0) return { status: "anomaly", reason: "数量必须大于 0" };
    if (qty > MAX_DAILY_QTY) return { status: "anomaly", reason: "数量超过单笔上限 " + MAX_DAILY_QTY };

    const inboundRoute = "R-" + row.factory + "-" + row.warehouse;
    const outboundRoute = "R-" + row.warehouse + "-" + row.store;
    if (!ROUTES[inboundRoute] || !ROUTES[outboundRoute]) {
      return { status: "anomaly", reason: "工厂—仓库—门店线路不存在" };
    }

    return {
      status: "valid",
      reason: "通过必填、节点、日期与数量校验",
      row: {
        recordId: row.recordId,
        date: row.date,
        factory: row.factory,
        warehouse: row.warehouse,
        store: row.store,
        qty: qty
      }
    };
  }

  function cleanDataset(dataset) {
    const seen = new Map();
    const seenIds = new Map();
    const rows = [];
    const cleanRows = [];
    let duplicates = 0;
    let missing = 0;
    let anomalies = 0;

    dataset.rows.forEach(function (source, index) {
      const row = {};
      Object.keys(source).forEach(function (key) { row[key] = normalizeText(source[key]); });
      const signature = rowSignature(row);
      const first = seen.get(signature);
      if (first !== undefined) {
        duplicates += 1;
        rows.push({
          index: index,
          source: Object.assign({}, source),
          status: "duplicate",
          reason: "与第 " + (first + 1) + " 条原始记录完全重复",
          duplicateOf: first
        });
        return;
      }
      seen.set(signature, index);

      const id = normalizeText(row.recordId);
      if (!isBlank(id) && seenIds.has(id) && seenIds.get(id) !== signature) {
        anomalies += 1;
        rows.push({
          index: index,
          source: Object.assign({}, source),
          status: "anomaly",
          reason: "单据号重复但内容不一致"
        });
        return;
      }
      if (!isBlank(id)) seenIds.set(id, signature);

      const result = validateRow(row);
      rows.push({
        index: index,
        source: Object.assign({}, source),
        status: result.status,
        reason: result.reason
      });
      if (result.status === "missing") missing += 1;
      if (result.status === "anomaly") anomalies += 1;
      if (result.status === "valid") {
        cleanRows.push(Object.assign({ sourceIndex: index }, result.row));
      }
    });

    return {
      datasetKey: dataset.key,
      datasetName: dataset.name,
      version: dataset.version,
      updatedAt: dataset.updatedAt,
      rawCount: dataset.rows.length,
      validCount: cleanRows.length,
      duplicates: duplicates,
      missing: missing,
      anomalies: anomalies,
      qualityScore: dataset.rows.length ? cleanRows.length / dataset.rows.length : 0,
      rows: rows,
      cleanRows: cleanRows
    };
  }

  function scopeRows(cleaned, windowKey, region, anchorDate) {
    const window = getWindow(windowKey, anchorDate);
    const inWindow = cleaned.cleanRows.filter(function (row) {
      return row.date >= window.start && row.date <= window.end;
    });
    const rows = inWindow.filter(function (row) {
      return region === "全部" || NODES[row.warehouse].region === region;
    });
    return { window: window, inWindow: inWindow, rows: rows };
  }

  function createDinic() {
    const graph = new Map();

    function ensure(node) {
      if (!graph.has(node)) graph.set(node, []);
    }

    function addEdge(from, to, capacity, meta) {
      ensure(from);
      ensure(to);
      const forward = { to: to, rev: graph.get(to).length, cap: capacity, initial: capacity, meta: meta || null };
      const backward = { to: from, rev: graph.get(from).length, cap: 0, initial: 0, meta: meta || null };
      graph.get(from).push(forward);
      graph.get(to).push(backward);
      return forward;
    }

    function maxFlow(source, sink) {
      ensure(source);
      ensure(sink);
      let total = 0;

      while (true) {
        const level = new Map();
        level.set(source, 0);
        const queue = [source];
        for (let head = 0; head < queue.length; head += 1) {
          const node = queue[head];
          graph.get(node).forEach(function (edge) {
            if (edge.cap > 0 && !level.has(edge.to)) {
              level.set(edge.to, level.get(node) + 1);
              queue.push(edge.to);
            }
          });
        }
        if (!level.has(sink)) break;

        const cursor = new Map();
        const send = function (node, available) {
          if (node === sink) return available;
          const edges = graph.get(node);
          let index = cursor.get(node) || 0;
          while (index < edges.length) {
            const edge = edges[index];
            if (edge.cap > 0 && level.get(edge.to) === level.get(node) + 1) {
              const pushed = send(edge.to, Math.min(available, edge.cap));
              if (pushed > 0) {
                edge.cap -= pushed;
                graph.get(edge.to)[edge.rev].cap += pushed;
                cursor.set(node, index);
                return pushed;
              }
            }
            index += 1;
            cursor.set(node, index);
          }
          return 0;
        };

        while (true) {
          const pushed = send(source, Number.MAX_SAFE_INTEGER);
          if (!pushed) break;
          total += pushed;
        }
      }
      return total;
    }

    return { addEdge: addEdge, maxFlow: maxFlow };
  }

  function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function sumValues(object) {
    return Object.keys(object).reduce(function (total, key) { return total + object[key]; }, 0);
  }

  function buildModel(cleaned, options, capacityOverrides, step) {
    const opts = options || {};
    const windowKey = opts.windowKey || "14d";
    const region = opts.region || "全部";
    const scoped = scopeRows(cleaned, windowKey, region, opts.anchorDate);
    const capacities = capacityOverrides || {};
    const factorySupply = Object.fromEntries(NODE_LIST.filter(function (node) {
      return node.type === "factory";
    }).map(function (node) { return [node.id, 0]; }));
    const storeDemand = Object.fromEntries(NODE_LIST.filter(function (node) {
      return node.type === "store";
    }).map(function (node) { return [node.id, 0]; }));
    const plannedLoads = Object.fromEntries(ROUTE_LIST.map(function (route) { return [route.id, 0]; }));

    scoped.rows.forEach(function (row) {
      factorySupply[row.factory] += row.qty;
      storeDemand[row.store] += row.qty;
      plannedLoads["R-" + row.factory + "-" + row.warehouse] += row.qty;
      plannedLoads["R-" + row.warehouse + "-" + row.store] += row.qty;
    });

    const source = "__SOURCE__";
    const sink = "__SINK__";
    const network = createDinic();
    Object.keys(factorySupply).forEach(function (id) {
      network.addEdge(source, id, factorySupply[id]);
    });

    const routeEdges = {};
    ROUTE_LIST.forEach(function (route) {
      const capacity = Number.isFinite(Number(capacities[route.id]))
        ? Math.max(0, Number(capacities[route.id]))
        : route.baseCapacity;
      routeEdges[route.id] = network.addEdge(route.from, route.to, capacity, { routeId: route.id });
    });
    Object.keys(storeDemand).forEach(function (id) {
      network.addEdge(id, sink, storeDemand[id]);
    });

    const maxFlowValue = network.maxFlow(source, sink);
    const routeFlows = {};
    ROUTE_LIST.forEach(function (route) {
      const edge = routeEdges[route.id];
      routeFlows[route.id] = edge.initial - edge.cap;
    });

    const inbound = Object.fromEntries(NODE_LIST.map(function (node) { return [node.id, 0]; }));
    const outbound = Object.fromEntries(NODE_LIST.map(function (node) { return [node.id, 0]; }));
    ROUTE_LIST.forEach(function (route) {
      outbound[route.from] += routeFlows[route.id];
      inbound[route.to] += routeFlows[route.id];
    });

    const isActiveNode = function (node) {
      return region === "全部" || node.region === region;
    };

    const nodes = NODE_LIST.map(function (base) {
      let supply = 0;
      let demand = 0;
      let stock = 0;
      let gap = 0;
      let status = "无流量";
      let statusTone = "muted";

      if (base.type === "factory") {
        supply = factorySupply[base.id] || 0;
        demand = outbound[base.id];
        stock = supply - demand;
        status = stock > 0 ? "余量 " + stock : supply > 0 ? "全部发运" : "待调度";
        statusTone = stock > 0 ? "warn" : supply > 0 ? "good" : "muted";
      } else if (base.type === "warehouse") {
        supply = inbound[base.id];
        demand = outbound[base.id];
        stock = supply - demand;
        status = supply === 0 ? "无流量" : stock === 0 ? "守恒" : "失衡";
        statusTone = supply === 0 ? "muted" : stock === 0 ? "good" : "danger";
      } else {
        supply = inbound[base.id];
        demand = storeDemand[base.id] || 0;
        gap = demand - supply;
        status = gap > 0 ? "缺口 " + gap : demand > 0 ? "已满足" : "无需求";
        statusTone = gap > 0 ? "danger" : demand > 0 ? "good" : "muted";
      }

      return {
        id: base.id,
        name: base.name,
        short: base.short,
        type: base.type,
        region: base.region,
        x: base.x,
        y: base.y,
        active: isActiveNode(base),
        supply: supply,
        demand: demand,
        inbound: inbound[base.id],
        outbound: outbound[base.id],
        stock: stock,
        gap: gap,
        status: status,
        statusTone: statusTone
      };
    });

    const maxPlanned = Math.max(1, Math.max.apply(null, Object.keys(plannedLoads).map(function (id) { return plannedLoads[id]; })));
    const routes = ROUTE_LIST.map(function (route) {
      const from = NODES[route.from];
      const to = NODES[route.to];
      const capacity = Number.isFinite(Number(capacities[route.id]))
        ? Math.max(0, Number(capacities[route.id]))
        : route.baseCapacity;
      const planned = plannedLoads[route.id];
      const flow = routeFlows[route.id];
      const overloadAmount = Math.max(0, planned - capacity);
      return {
        id: route.id,
        from: route.from,
        to: route.to,
        fromName: from.name,
        toName: to.name,
        region: from.region,
        active: isActiveNode(from) && isActiveNode(to),
        baseCapacity: route.baseCapacity,
        capacity: capacity,
        planned: planned,
        flow: flow,
        utilization: capacity > 0 ? flow / capacity : flow > 0 ? 1 : 0,
        plannedUtilization: capacity > 0 ? planned / capacity : planned > 0 ? 1 : 0,
        overloaded: planned > capacity,
        overloadAmount: overloadAmount,
        flowRatio: flow / maxPlanned
      };
    });

    const activeNodes = nodes.filter(function (node) { return node.active; });
    const activeRoutes = routes.filter(function (route) { return route.active; });
    const supplyTotal = activeNodes.reduce(function (total, node) {
      return total + (node.type === "factory" ? node.supply : 0);
    }, 0);
    const demandTotal = activeNodes.reduce(function (total, node) {
      return total + (node.type === "store" ? node.demand : 0);
    }, 0);
    const delivered = activeNodes.reduce(function (total, node) {
      return total + (node.type === "store" ? node.supply : 0);
    }, 0);
    const gapTotal = activeNodes.reduce(function (total, node) { return total + node.gap; }, 0);
    const unusedTotal = activeNodes.reduce(function (total, node) {
      return total + (node.type === "factory" ? node.stock : 0);
    }, 0);
    const overloadedRoutes = activeRoutes.filter(function (route) { return route.overloaded; }).length;
    const warehouseImbalance = activeNodes.filter(function (node) {
      return node.type === "warehouse" && node.stock !== 0;
    });
    const capacityViolations = activeRoutes.filter(function (route) {
      return route.flow > route.capacity;
    });

    const totals = {
      supply: supplyTotal,
      demand: demandTotal,
      delivered: delivered,
      gap: gapTotal,
      unused: unusedTotal,
      maxFlow: maxFlowValue,
      overloadedRoutes: overloadedRoutes,
      activeRoutes: activeRoutes.length,
      activeNodes: activeNodes.length,
      records: scoped.rows.length
    };
    const conservationChecks = [
      {
        key: "quality",
        label: "质量分类闭合",
        pass: cleaned.rawCount === cleaned.validCount + cleaned.duplicates + cleaned.missing + cleaned.anomalies,
        value: cleaned.rawCount + " = " + cleaned.validCount + " 有效 + " + cleaned.duplicates + " 去重 + " + cleaned.missing + " 缺失 + " + cleaned.anomalies + " 异常"
      },
      {
        key: "supply",
        label: "可供量守恒",
        pass: supplyTotal === delivered + unusedTotal,
        value: supplyTotal + " 可供 = " + delivered + " 已发运 + " + unusedTotal + " 余量"
      },
      {
        key: "demand",
        label: "需求量守恒",
        pass: demandTotal === delivered + gapTotal,
        value: demandTotal + " 需求 = " + delivered + " 到货 + " + gapTotal + " 缺口"
      },
      {
        key: "warehouse",
        label: "仓储节点守恒",
        pass: warehouseImbalance.length === 0,
        value: warehouseImbalance.length === 0 ? "所有仓库入库 = 出库" : warehouseImbalance.length + " 个仓库失衡"
      },
      {
        key: "capacity",
        label: "实流不超容量",
        pass: capacityViolations.length === 0,
        value: capacityViolations.length === 0 ? "实际流量全部 ≤ 线路容量" : capacityViolations.length + " 条线路越界"
      }
    ];
    const conservation = {
      valid: conservationChecks.every(function (check) { return check.pass; }),
      checks: conservationChecks,
      warehouseImbalance: warehouseImbalance.map(function (node) { return node.id; })
    };
    const statisticsScope = {
      source: "清洗后有效单据",
      records: scoped.rows.length,
      window: scoped.window,
      region: region,
      planMethod: "原始工厂—仓库—门店路径聚合",
      flowMethod: "线路容量约束最大流",
      note: "先去重，再剔除缺失与异常；质量摘要按整份数据集统计"
    };
    const stepValue = Math.min(10, Math.max(0, Number(step) || 0));
    const model = {
      datasetKey: cleaned.datasetKey,
      datasetName: cleaned.datasetName,
      version: cleaned.version,
      updatedAt: cleaned.updatedAt,
      quality: {
        rawCount: cleaned.rawCount,
        validCount: cleaned.validCount,
        duplicates: cleaned.duplicates,
        missing: cleaned.missing,
        anomalies: cleaned.anomalies,
        qualityScore: cleaned.qualityScore
      },
      window: scoped.window,
      region: region,
      step: stepValue,
      exportReady: stepValue >= 10,
      nodes: nodes,
      routes: routes,
      activeNodes: activeNodes,
      activeRoutes: activeRoutes,
      totals: totals,
      conservation: conservation,
      statisticsScope: statisticsScope
    };
    const snapshot = {
      datasetKey: model.datasetKey,
      version: model.version,
      region: model.region,
      window: model.window.key,
      totals: totals,
      nodes: activeNodes.map(function (node) {
        return [node.id, node.supply, node.demand, node.stock, node.gap];
      }),
      routes: activeRoutes.map(function (route) {
        return [route.id, route.capacity, route.planned, route.flow, route.overloaded];
      })
    };
    model.fingerprint = hashString(JSON.stringify(snapshot));
    return model;
  }

  function buildExportPayload(model, generatedAt) {
    return {
      schema: "cargo-flow-export/v1",
      generatedAt: generatedAt || new Date().toISOString(),
      dataVersion: model.version,
      dataset: {
        key: model.datasetKey,
        name: model.datasetName,
        updatedAt: model.updatedAt
      },
      filter: {
        windowKey: model.window.key,
        windowLabel: model.window.label,
        dateStart: model.window.start,
        dateEnd: model.window.end,
        region: model.region
      },
      statisticsScope: model.statisticsScope,
      step: model.step,
      quality: model.quality,
      totals: Object.assign({}, model.totals),
      conservation: {
        valid: model.conservation.valid,
        checks: model.conservation.checks
      },
      nodes: model.activeNodes.map(function (node) {
        return {
          id: node.id,
          name: node.name,
          type: node.type,
          region: node.region,
          supply: node.supply,
          demand: node.demand,
          stock: node.stock,
          gap: node.gap,
          status: node.status
        };
      }),
      routes: model.activeRoutes.map(function (route) {
        return {
          id: route.id,
          from: route.from,
          to: route.to,
          fromName: route.fromName,
          toName: route.toName,
          capacity: route.capacity,
          planned: route.planned,
          flow: route.flow,
          overloaded: route.overloaded,
          overloadAmount: route.overloadAmount
        };
      }),
      fingerprint: model.fingerprint
    };
  }

  function validateExportPayload(payload, model) {
    const totalsMatch = Object.keys(model.totals).every(function (key) {
      return payload.totals[key] === model.totals[key];
    });
    const exportNodes = new Map(payload.nodes.map(function (node) { return [node.id, node]; }));
    const nodesMatch = model.activeNodes.every(function (node) {
      const exported = exportNodes.get(node.id);
      return exported && exported.supply === node.supply && exported.demand === node.demand
        && exported.stock === node.stock && exported.gap === node.gap;
    });
    const exportRoutes = new Map(payload.routes.map(function (route) { return [route.id, route]; }));
    const routesMatch = model.activeRoutes.every(function (route) {
      const exported = exportRoutes.get(route.id);
      return exported && exported.capacity === route.capacity && exported.planned === route.planned
        && exported.flow === route.flow && exported.overloaded === route.overloaded;
    });
    return {
      valid: totalsMatch && nodesMatch && routesMatch && payload.fingerprint === model.fingerprint,
      totalsMatch: totalsMatch,
      nodesMatch: nodesMatch,
      routesMatch: routesMatch,
      fingerprintMatch: payload.fingerprint === model.fingerprint
    };
  }

  return {
    REGIONS: REGIONS,
    WINDOWS: WINDOWS,
    ANCHOR_DATE: ANCHOR_DATE,
    MAX_DAILY_QTY: MAX_DAILY_QTY,
    NODE_LIST: NODE_LIST,
    ROUTE_LIST: ROUTE_LIST,
    NODES: NODES,
    ROUTES: ROUTES,
    DATASETS: DATASETS,
    getWindow: getWindow,
    shortDate: shortDate,
    cleanDataset: cleanDataset,
    scopeRows: scopeRows,
    buildModel: buildModel,
    buildExportPayload: buildExportPayload,
    validateExportPayload: validateExportPayload,
    hashString: hashString
  };
});
