import { LINE_BY_ID, STATION_BY_ID } from "./data.js";

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function stationName(id) {
  return STATION_BY_ID.get(id)?.name || "—";
}

function routeStationText(route) {
  return route ? route.stationIds.map(stationName).join(" → ") : "不可达";
}

function routeLineText(route) {
  return route
    ? route.legs.map((leg) => LINE_BY_ID.get(leg.lineId).shortName).join(" → ")
    : "—";
}

export function buildCsvRows(model) {
  const common = [
    model.dataset.version,
    `${model.window.label} ${model.window.shortRange}`
  ];
  const rows = [
    ["类型", "项目", "数值", "说明", "数据版本", "时间窗口"],
    ["筛选", "起点", stationName(model.state.originId), "", ...common],
    ["筛选", "终点", stationName(model.state.destinationId), "", ...common],
    ["筛选", "数据样本", model.dataset.label, model.dataset.description, ...common],
    ["筛选", "统计口径", model.statistics.scope, "", ...common],
    ["质量", "原始记录", model.statistics.raw, "条", ...common],
    ["质量", "去重", model.statistics.duplicate, "条", ...common],
    ["质量", "缺失", model.statistics.missing, "条", ...common],
    ["质量", "异常", model.statistics.anomaly, "条", ...common],
    ["质量", "有效记录", model.statistics.valid, "条", ...common],
    ["质量", "有效率", model.statistics.integrityRate.toFixed(1), "%", ...common],
    ["网络", "有效站点", model.statistics.stationCount, "座", ...common],
    ["网络", "有效区间", model.statistics.operatingSegments, "段", ...common],
    ["网络", "停运区间", model.statistics.suspendedSegments, "段", ...common],
    ["网络", "数据缺失区间", model.statistics.missingSegments, "段", ...common],
    ["口径", "换乘等待", model.statistics.transferMinutes, "分钟/次", ...common]
  ];

  [
    ["最短时间", model.routes.shortest],
    ["最少换乘", model.routes.fewest]
  ].forEach(([label, route]) => {
    rows.push(["方案", `${label}-状态`, route ? "可达" : "不可达", "", ...common]);
    rows.push(["方案", `${label}-总分钟`, route?.totalMinutes ?? "—", "分钟", ...common]);
    rows.push(["方案", `${label}-换乘次数`, route?.transfers ?? "—", "次", ...common]);
    rows.push(["方案", `${label}-乘车分钟`, route?.rideMinutes ?? "—", "分钟", ...common]);
    rows.push([
      "方案",
      `${label}-换乘等待分钟`,
      route?.transferMinutes ?? "—",
      "分钟",
      ...common
    ]);
    rows.push(["方案", `${label}-线路`, routeLineText(route), "", ...common]);
    rows.push(["方案", `${label}-站点`, routeStationText(route), "", ...common]);
  });

  model.lineRows.forEach((segment) => {
    const statusLabels = {
      operating: "运营中",
      suspended: "停运绕行",
      missing: "数据缺失"
    };
    rows.push([
      "区间",
      `${LINE_BY_ID.get(segment.lineId).shortName} ${stationName(segment.from)}—${stationName(segment.to)}`,
      segment.minutes ?? "—",
      statusLabels[segment.status],
      ...common
    ]);
  });

  return rows;
}

export function createCsvExport(model) {
  const content = "\uFEFF" + buildCsvRows(model).map((row) => row.map(csvCell).join(",")).join("\n");
  const filename =
    `metro-routes_${model.window.id}_${model.dataset.id}_` +
    `${model.dataset.version.replaceAll(".", "-")}.csv`;
  return { filename, content };
}

export function createPngFilename(model) {
  return (
    `metro-route-map_${model.window.id}_${model.dataset.id}_` +
    `${model.dataset.version.replaceAll(".", "-")}.png`
  );
}
