import {
  DATASET_BY_ID,
  LINES,
  LINE_BY_ID,
  MAX_SEGMENT_MINUTES,
  REQUIRED_FIELDS,
  STATIONS,
  STATION_BY_ID,
  TIME_WINDOWS,
  WINDOW_BY_ID,
  edgeKey
} from "./data.js";

function isMissing(value) {
  return value === undefined || value === null || String(value).trim() === "";
}

function normalizeText(value) {
  return String(value).trim();
}

function missingFields(record) {
  return REQUIRED_FIELDS.filter((field) => isMissing(record[field]));
}

export function cleanRecords(rawRecords) {
  const valid = [];
  const duplicates = [];
  const anomalies = [];
  const assessments = [];
  const seen = new Set();

  rawRecords.forEach((rawRecord, index) => {
    const absentFields = missingFields(rawRecord);
    if (absentFields.length) {
      const detail = { record: rawRecord, reason: `缺失 ${absentFields.join(" / ")}` };
      assessments.push({ ...detail, status: "missing" });
      return;
    }

    const record = {
      ...rawRecord,
      recordId: normalizeText(rawRecord.recordId),
      lineId: normalizeText(rawRecord.lineId),
      from: normalizeText(rawRecord.from),
      to: normalizeText(rawRecord.to),
      minutes: Number(rawRecord.minutes)
    };
    const key = edgeKey(record.lineId, record.from, record.to);
    const duplicate = { record, reason: "重复区间" };

    if (seen.has(key)) {
      duplicates.push(duplicate);
      assessments.push({ ...duplicate, status: "duplicate", rawIndex: index });
      return;
    }
    seen.add(key);

    const anomalyReasons = [];
    if (!LINE_BY_ID.has(record.lineId)) anomalyReasons.push("未知线路");
    if (!STATION_BY_ID.has(record.from) || !STATION_BY_ID.has(record.to)) {
      anomalyReasons.push("未知站点");
    }
    if (record.from === record.to) anomalyReasons.push("起终点相同");
    if (!Number.isFinite(record.minutes) || record.minutes <= 0) anomalyReasons.push("时长非正数");
    if (record.minutes > MAX_SEGMENT_MINUTES) anomalyReasons.push("时长超限");

    if (anomalyReasons.length) {
      const detail = { record, reason: anomalyReasons.join(" / ") };
      anomalies.push(detail);
      assessments.push({ ...detail, status: "anomaly", rawIndex: index });
      return;
    }

    valid.push(record);
    assessments.push({ record, reason: "有效", status: "valid", rawIndex: index });
  });

  const missingRecords = rawRecords.filter((record) => missingFields(record).length);
  const missingDetails = missingRecords.map((record) => ({
    record,
    reason: `缺失 ${missingFields(record).join(" / ")}`
  }));

  const assessmentsWithMissing = assessments.map((assessment) => {
    if (assessment.status !== "missing") return assessment;
    const source = missingDetails.find((item) => item.record === assessment.record);
    return source ? { ...assessment, reason: source.reason } : assessment;
  });

  return {
    rawCount: rawRecords.length,
    valid,
    missing: missingDetails,
    duplicates,
    anomalies,
    assessments: assessmentsWithMissing,
    counts: {
      raw: rawRecords.length,
      deduplicated: duplicates.length,
      missing: missingDetails.length,
      anomaly: anomalies.length,
      valid: valid.length
    }
  };
}

export function aggregateSegments(validRecords) {
  const groups = new Map();

  validRecords.forEach((record) => {
    const key = edgeKey(record.lineId, record.from, record.to);
    const current = groups.get(key) || {
      key,
      lineId: record.lineId,
      from: record.from,
      to: record.to,
      minutesTotal: 0,
      sourceCount: 0,
      recordIds: []
    };
    current.minutesTotal += record.minutes;
    current.sourceCount += 1;
    current.recordIds.push(record.recordId);
    groups.set(key, current);
  });

  return [...groups.values()].map((group) => ({
    ...group,
    minutes: Number((group.minutesTotal / group.sourceCount).toFixed(1))
  }));
}

function buildStationLineMap() {
  const map = new Map();
  STATIONS.forEach((station) => map.set(station.id, []));
  LINES.forEach((line) => {
    line.stations.forEach((stationId) => map.get(stationId).push(line));
  });
  return map;
}

export const STATION_LINES = buildStationLineMap();

export function buildOperationalNetwork(cleaned, window) {
  const aggregated = aggregateSegments(cleaned.valid);
  const aggregateByKey = new Map(aggregated.map((segment) => [segment.key, segment]));
  const closureSet = new Set(window.closures);
  const segmentRows = [];

  LINES.forEach((line) => {
    for (let index = 0; index < line.stations.length - 1; index += 1) {
      const from = line.stations[index];
      const to = line.stations[index + 1];
      const key = edgeKey(line.id, from, to);
      const aggregate = aggregateByKey.get(key);
      const suspended = closureSet.has(key);
      const status = suspended ? "suspended" : aggregate ? "operating" : "missing";
      segmentRows.push({
        key,
        lineId: line.id,
        from,
        to,
        minutes: aggregate?.minutes ?? null,
        sourceCount: aggregate?.sourceCount ?? 0,
        status
      });
    }
  });

  const edgeRows = segmentRows.filter((segment) => segment.status === "operating");
  const adjacency = new Map(STATIONS.map((station) => [station.id, []]));

  edgeRows.forEach((segment) => {
    adjacency.get(segment.from).push({
      to: segment.to,
      lineId: segment.lineId,
      minutes: segment.minutes,
      key: segment.key
    });
    adjacency.get(segment.to).push({
      to: segment.from,
      lineId: segment.lineId,
      minutes: segment.minutes,
      key: segment.key
    });
  });

  const stationIds = new Set();
  edgeRows.forEach((segment) => {
    stationIds.add(segment.from);
    stationIds.add(segment.to);
  });

  return {
    aggregated,
    aggregateByKey,
    closureSet,
    segmentRows,
    edgeRows,
    adjacency,
    stationIds,
    stationCount: stationIds.size,
    operatingSegmentCount: edgeRows.length,
    suspendedSegmentCount: segmentRows.filter((segment) => segment.status === "suspended").length,
    missingSegmentCount: segmentRows.filter((segment) => segment.status === "missing").length
  };
}

export function reachableStations(originId, network) {
  const reachable = new Set();
  if (!network.adjacency.has(originId)) return reachable;
  const queue = [originId];
  reachable.add(originId);

  while (queue.length) {
    const stationId = queue.shift();
    network.adjacency.get(stationId).forEach((edge) => {
      if (!reachable.has(edge.to)) {
        reachable.add(edge.to);
        queue.push(edge.to);
      }
    });
  }
  return reachable;
}

export function createStatistics(cleaned, network, window) {
  const integrityRate = cleaned.rawCount
    ? (cleaned.counts.valid / cleaned.rawCount) * 100
    : 0;

  return {
    raw: cleaned.rawCount,
    duplicate: cleaned.counts.deduplicated,
    missing: cleaned.counts.missing,
    anomaly: cleaned.counts.anomaly,
    valid: cleaned.counts.valid,
    uniqueSegments: network.aggregated.length,
    stationCount: network.stationCount,
    operatingSegments: network.operatingSegmentCount,
    suspendedSegments: network.suspendedSegmentCount,
    missingSegments: network.missingSegmentCount,
    integrityRate,
    windowLabel: `${window.label} ${window.range}`,
    transferMinutes: window.transferMinutes,
    closures: window.closures.length,
    scope:
      `原始 ${cleaned.rawCount} 条 → 去重 ${cleaned.counts.deduplicated}、` +
      `缺失 ${cleaned.counts.missing}、异常 ${cleaned.counts.anomaly}；` +
      `${window.label} ${window.range}，换乘等待 ${window.transferMinutes} 分钟，停运区间剔除`
  };
}

export function buildDatasetView(datasetId, windowId) {
  const dataset = DATASET_BY_ID.get(datasetId) || DATASET_BY_ID.get("normal");
  const window = WINDOW_BY_ID.get(windowId) || TIME_WINDOWS[1];
  const cleaned = cleanRecords(dataset.rawRecords);
  const network = buildOperationalNetwork(cleaned, window);
  const statistics = createStatistics(cleaned, network, window);

  return {
    dataset,
    window,
    cleaned,
    network,
    statistics
  };
}
