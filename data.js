(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.WindData = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SEASONS = [
    { key: "spring", label: "春季", months: "3—5月", base: 3.7, weights: [5, 6, 9, 8, 13, 12, 9, 7] },
    { key: "summer", label: "夏季", months: "6—8月", base: 3.3, weights: [4, 5, 8, 12, 15, 14, 10, 8] },
    { key: "autumn", label: "秋季", months: "9—11月", base: 4.2, weights: [8, 10, 12, 9, 11, 9, 7, 6] },
    { key: "winter", label: "冬季", months: "12—2月", base: 4.8, weights: [15, 12, 8, 5, 6, 5, 8, 12] },
  ];

  const PERIODS = [
    { key: "all", label: "全天", range: "00:00—24:00", short: "00—24时" },
    { key: "day", label: "白天", range: "06:00—18:00", short: "06—18时" },
    { key: "night", label: "夜间", range: "18:00—06:00", short: "18—06时" },
  ];

  const DIRECTIONS = [
    { key: "N", label: "北", spoken: "北风", angle: 0 },
    { key: "NE", label: "东北", spoken: "东北风", angle: 45 },
    { key: "E", label: "东", spoken: "东风", angle: 90 },
    { key: "SE", label: "东南", spoken: "东南风", angle: 135 },
    { key: "S", label: "南", spoken: "南风", angle: 180 },
    { key: "SW", label: "西南", spoken: "西南风", angle: 225 },
    { key: "W", label: "西", spoken: "西风", angle: 270 },
    { key: "NW", label: "西北", spoken: "西北风", angle: 315 },
  ];

  const SPEED_BANDS = [
    { key: "calm", label: "0—2", spoken: "0—2 m/s", min: 0, max: 2, color: "#b8d8cf" },
    { key: "light", label: "2—4", spoken: "2—4 m/s", min: 2, max: 4, color: "#76b7a8" },
    { key: "breeze", label: "4—6", spoken: "4—6 m/s", min: 4, max: 6, color: "#2f8f83" },
    { key: "fresh", label: "6—8", spoken: "6—8 m/s", min: 6, max: 8, color: "#f0a94a" },
    { key: "strong", label: "≥8", spoken: "8 m/s 以上", min: 8, max: Infinity, color: "#d9694c" },
  ];

  const DATA_VERSIONS = [
    {
      id: "normal",
      version: "v1.2.0",
      label: "完整样例",
      short: "无质量问题注入",
      description: "格式完整的地面风观测样例。",
    },
    {
      id: "missing",
      version: "v1.1.0",
      label: "缺失样例",
      short: "含字段缺失与越界值",
      description: "在完整样例上注入空字段与风速越界值。",
    },
    {
      id: "duplicate",
      version: "v1.0.0",
      label: "重复样例",
      short: "含精确重复与冲突重复",
      description: "在完整样例上追加同观测编号的重复记录。",
    },
  ];

  const REQUIRED_FIELDS = ["eventId", "observedAt", "direction", "speed"];
  const MAX_REASONABLE_SPEED = 40;
  const DIRECTION_KEYS = new Set(DIRECTIONS.map((item) => item.key));

  function mulberry32(seed) {
    let value = seed >>> 0;
    return function random() {
      value += 0x6d2b79f5;
      let t = value;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pickWeighted(random, weights) {
    const total = weights.reduce((sum, value) => sum + value, 0);
    let cursor = random() * total;
    for (let index = 0; index < weights.length; index += 1) {
      cursor -= weights[index];
      if (cursor <= 0) return index;
    }
    return weights.length - 1;
  }

  function pad(value, length) {
    return String(value).padStart(length, "0");
  }

  function buildBaseRecords() {
    const records = [];
    const startDates = {
      spring: [2026, 3, 4],
      summer: [2026, 6, 5],
      autumn: [2026, 9, 7],
      winter: [2026, 12, 2],
    };

    SEASONS.forEach((season, seasonIndex) => {
      const random = mulberry32(7231 + seasonIndex * 97);
      const [startYear, startMonth, startDay] = startDates[season.key];
      for (let index = 0; index < 72; index += 1) {
        const isDay = index < 36;
        const hour = isDay ? 6 + (index % 12) : index % 4 < 2 ? 18 + (index % 6) : index % 6;
        const dayOffset = Math.floor(index / 4);
        const minute = (index * 7 + seasonIndex * 11) % 60;
        const direction = DIRECTIONS[pickWeighted(random, season.weights)].key;
        const speed = Math.max(0.2, season.base + (random() - 0.42) * 7.2);
        const calendar = new Date(Date.UTC(startYear, startMonth - 1, startDay + dayOffset));
        const year = calendar.getUTCFullYear();
        const normalizedMonth = calendar.getUTCMonth() + 1;
        const day = calendar.getUTCDate();
        records.push({
          eventId: `WX-${season.key.slice(0, 2).toUpperCase()}-${pad(index + 1, 3)}`,
          observedAt: `${year}-${pad(normalizedMonth, 2)}-${pad(day, 2)}T${pad(hour, 2)}:${pad(minute, 2)}:00+08:00`,
          direction,
          speed: Number(speed.toFixed(1)),
          station: seasonIndex % 2 === 0 ? "滨海站" : "东滩站",
        });
      }
    });
    return records;
  }

  const BASE_RECORDS = buildBaseRecords();

  function clone(record) {
    return { ...record };
  }

  function buildMissingSample() {
    const records = BASE_RECORDS.map(clone);
    [2, 11, 19, 28].forEach((index) => {
      records[index].direction = null;
    });
    [5, 22].forEach((index) => {
      records[index].speed = null;
    });
    records[37].observedAt = "";
    records[40].speed = 42.8;
    records[48].speed = -1.2;
    records[53].direction = "X";
    return records;
  }

  function buildDuplicateSample() {
    const records = BASE_RECORDS.map(clone);
    const exactCopies = [1, 7, 20, 31, 45, 63];
    exactCopies.forEach((index) => records.push(clone(records[index])));
    records.push({ ...records[14], speed: Number((records[14].speed + 0.8).toFixed(1)) });
    records.push({ ...records[56], direction: "NW" });
    records[70].speed = 51.4;
    return records;
  }

  const SAMPLE_BUILDERS = {
    normal: () => BASE_RECORDS.map(clone),
    missing: buildMissingSample,
    duplicate: buildDuplicateSample,
  };

  const rawCache = new Map();

  function getRawDataset(datasetId) {
    if (!SAMPLE_BUILDERS[datasetId]) {
      throw new Error(`Unknown dataset: ${datasetId}`);
    }
    if (!rawCache.has(datasetId)) {
      rawCache.set(datasetId, SAMPLE_BUILDERS[datasetId]());
    }
    return rawCache.get(datasetId);
  }

  function roundOne(value) {
    return Number(value.toFixed(1));
  }

  function formatSpeed(value) {
    return Number.isFinite(value) ? value.toFixed(1) : "—";
  }

  function getShanghaiParts(observedAt) {
    if (typeof observedAt !== "string" || !observedAt.trim()) return null;
    const match = observedAt.match(
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:[+-]\d{2}:\d{2}|Z)?$/
    );
    if (!match) return null;
    const [, year, month, day, hour, minute, second = "0"] = match;
    const numericHour = Number(hour);
    if (
      numericHour > 23 ||
      Number(minute) > 59 ||
      Number(second) > 59 ||
      Number(month) < 1 ||
      Number(month) > 12
    ) {
      return null;
    }
    const calendar = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), numericHour));
    if (
      calendar.getUTCFullYear() !== Number(year) ||
      calendar.getUTCMonth() + 1 !== Number(month) ||
      calendar.getUTCDate() !== Number(day)
    ) {
      return null;
    }
    return {
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hour: numericHour,
      minute: Number(minute),
    };
  }

  function getSeasonKey(month) {
    if (month >= 3 && month <= 5) return "spring";
    if (month >= 6 && month <= 8) return "summer";
    if (month >= 9 && month <= 11) return "autumn";
    return "winter";
  }

  function getPeriodKey(hour) {
    return hour >= 6 && hour < 18 ? "day" : "night";
  }

  function getVersion(datasetId) {
    const version = DATA_VERSIONS.find((item) => item.id === datasetId);
    if (!version) throw new Error(`Unknown dataset: ${datasetId}`);
    return version;
  }

  function cleanDataset(datasetId) {
    const raw = getRawDataset(datasetId);
    const seenIds = new Set();
    const cleaned = [];
    const rejected = { duplicate: [], missing: [], anomaly: [] };
    let missingCells = 0;

    raw.forEach((record, index) => {
      const eventId = record.eventId == null ? "" : String(record.eventId).trim();
      if (eventId && seenIds.has(eventId)) {
        rejected.duplicate.push({ index, record, reason: "重复观测编号" });
        return;
      }
      if (eventId) seenIds.add(eventId);

      const missingFields = REQUIRED_FIELDS.filter((field) => {
        const value = record[field];
        return value == null || String(value).trim() === "";
      });
      if (missingFields.length) {
        missingCells += missingFields.length;
        rejected.missing.push({ index, record, reason: "必填字段缺失", fields: missingFields });
        return;
      }

      const timeParts = getShanghaiParts(record.observedAt);
      const rawSpeed = Number(record.speed);
      const direction = String(record.direction).trim().toUpperCase();
      const anomalyReasons = [];
      if (!timeParts) anomalyReasons.push("观测时间无法解析");
      if (!DIRECTION_KEYS.has(direction)) anomalyReasons.push("风向不在八方位内");
      if (!Number.isFinite(rawSpeed)) anomalyReasons.push("风速不是数值");
      if (Number.isFinite(rawSpeed) && (rawSpeed < 0 || rawSpeed > MAX_REASONABLE_SPEED)) {
        anomalyReasons.push(`风速超出 0—${MAX_REASONABLE_SPEED} m/s`);
      }
      if (anomalyReasons.length) {
        rejected.anomaly.push({ index, record, reason: anomalyReasons.join("；") });
        return;
      }

      cleaned.push({
        eventId,
        observedAt: record.observedAt,
        direction,
        speed: rawSpeed,
        station: record.station || "未标注站",
        seasonKey: getSeasonKey(timeParts.month),
        periodKey: getPeriodKey(timeParts.hour),
        localHour: timeParts.hour,
        localDate: `${timeParts.year}-${pad(timeParts.month, 2)}-${pad(timeParts.day, 2)}`,
        minuteOfDay: timeParts.hour * 60 + timeParts.minute,
      });
    });

    const quality = {
      rawRows: raw.length,
      uniqueRows: raw.length - rejected.duplicate.length,
      duplicateRows: rejected.duplicate.length,
      missingRows: rejected.missing.length,
      missingCells,
      anomalyRows: rejected.anomaly.length,
      validRows: cleaned.length,
      retainedRate: raw.length ? roundOne((cleaned.length / raw.length) * 100) : 0,
      rejectedRows: rejected.duplicate.length + rejected.missing.length + rejected.anomaly.length,
    };

    return { raw, cleaned, rejected, quality };
  }

  function matchesPeriod(record, periodKey) {
    if (periodKey === "all") return true;
    return record.periodKey === periodKey;
  }

  function filterRecords(cleaned, seasonKey, periodKey) {
    return cleaned.filter(
      (record) => record.seasonKey === seasonKey && matchesPeriod(record, periodKey)
    );
  }

  function getSpeedBand(speed) {
    return SPEED_BANDS.find((band) => speed >= band.min && speed < band.max) || SPEED_BANDS[0];
  }

  function aggregateRecords(records) {
    const byDirection = DIRECTIONS.map((direction) => ({
      key: direction.key,
      label: direction.label,
      spoken: direction.spoken,
      angle: direction.angle,
      count: 0,
      sumSpeed: 0,
      avgSpeed: null,
      maxSpeed: null,
      bands: SPEED_BANDS.map((band) => ({ key: band.key, count: 0 })),
    }));
    const byBand = SPEED_BANDS.map((band) => ({
      key: band.key,
      label: band.label,
      spoken: band.spoken,
      color: band.color,
      count: 0,
    }));
    const directionMap = new Map(byDirection.map((item) => [item.key, item]));
    const bandMap = new Map(byBand.map((item) => [item.key, item]));
    let speedSum = 0;
    let minSpeed = null;
    let maxSpeed = null;

    records.forEach((record) => {
      const direction = directionMap.get(record.direction);
      const band = getSpeedBand(record.speed);
      if (!direction) return;
      direction.count += 1;
      direction.sumSpeed += record.speed;
      direction.maxSpeed =
        direction.maxSpeed == null ? record.speed : Math.max(direction.maxSpeed, record.speed);
      direction.bands.find((item) => item.key === band.key).count += 1;
      bandMap.get(band.key).count += 1;
      speedSum += record.speed;
      minSpeed = minSpeed == null ? record.speed : Math.min(minSpeed, record.speed);
      maxSpeed = maxSpeed == null ? record.speed : Math.max(maxSpeed, record.speed);
    });

    byDirection.forEach((direction) => {
      direction.avgSpeed =
        direction.count > 0 ? roundOne(direction.sumSpeed / direction.count) : null;
    });
    const topDirection = byDirection.reduce((best, current) => {
      if (!best || current.count > best.count) return current;
      return best;
    }, null);
    const total = records.length;

    return {
      total,
      avgSpeed: total ? roundOne(speedSum / total) : null,
      minSpeed,
      maxSpeed,
      topDirection,
      byDirection,
      byBand,
      maxDirectionCount: Math.max(0, ...byDirection.map((item) => item.count)),
    };
  }

  function buildViewModel(datasetId, seasonKey, periodKey) {
    const version = getVersion(datasetId);
    const season = SEASONS.find((item) => item.key === seasonKey) || SEASONS[0];
    const period = PERIODS.find((item) => item.key === periodKey) || PERIODS[0];
    const result = cleanDataset(datasetId);
    const filtered = filterRecords(result.cleaned, season.key, period.key);
    const sorted = filtered
      .slice()
      .sort((a, b) => String(b.observedAt).localeCompare(String(a.observedAt)));
    return {
      version,
      season,
      period,
      clean: result,
      records: sorted,
      aggregate: aggregateRecords(filtered),
      generatedAt: new Date().toISOString(),
    };
  }

  function buildExportSummary(view) {
    return {
      dataVersion: view.version.version,
      dataset: view.version.label,
      season: view.season.label,
      period: view.period.label,
      timeWindow: view.period.range,
      rawRows: view.clean.quality.rawRows,
      duplicateRows: view.clean.quality.duplicateRows,
      missingRows: view.clean.quality.missingRows,
      anomalyRows: view.clean.quality.anomalyRows,
      validRows: view.clean.quality.validRows,
      filteredRows: view.aggregate.total,
      avgSpeed: view.aggregate.avgSpeed,
      maxSpeed: view.aggregate.maxSpeed,
      topDirection: view.aggregate.topDirection ? view.aggregate.topDirection.key : "—",
      topDirectionCount: view.aggregate.topDirection ? view.aggregate.topDirection.count : 0,
      directions: view.aggregate.byDirection.map((item) => ({
        direction: item.key,
        frequency: item.count,
        avgSpeed: item.avgSpeed,
        maxSpeed: item.maxSpeed,
      })),
    };
  }

  function csvCell(value) {
    const text = value == null ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function buildCsv(view) {
    const summary = buildExportSummary(view);
    const rows = [];
    rows.push(["section", "key", "value"]);
    rows.push(["metadata", "data_version", summary.dataVersion]);
    rows.push(["metadata", "dataset", summary.dataset]);
    rows.push(["metadata", "season", summary.season]);
    rows.push(["metadata", "period", summary.period]);
    rows.push(["metadata", "time_window", summary.timeWindow]);
    rows.push(["quality", "raw_rows", summary.rawRows]);
    rows.push(["quality", "duplicate_rows", summary.duplicateRows]);
    rows.push(["quality", "missing_rows", summary.missingRows]);
    rows.push(["quality", "anomaly_rows", summary.anomalyRows]);
    rows.push(["quality", "valid_rows", summary.validRows]);
    rows.push(["summary", "filtered_rows", summary.filteredRows]);
    rows.push(["summary", "avg_speed", formatSpeed(summary.avgSpeed)]);
    rows.push(["summary", "max_speed", formatSpeed(summary.maxSpeed)]);
    rows.push(["summary", "top_direction", summary.topDirection]);
    rows.push(["summary", "top_direction_count", summary.topDirectionCount]);
    rows.push([]);
    rows.push([
      "direction",
      "label",
      "frequency",
      "avg_speed",
      "max_speed",
      ...SPEED_BANDS.map((band) => `speed_${band.key}`),
    ]);
    view.aggregate.byDirection.forEach((item) => {
      rows.push([
        item.key,
        item.label,
        item.count,
        formatSpeed(item.avgSpeed),
        formatSpeed(item.maxSpeed),
        ...item.bands.map((band) => band.count),
      ]);
    });
    rows.push([]);
    rows.push([
      "record",
      "event_id",
      "observed_at",
      "station",
      "direction",
      "speed",
      "season",
      "period",
    ]);
    view.records.forEach((record) => {
      rows.push([
        "record",
        record.eventId,
        record.observedAt,
        record.station,
        record.direction,
        formatSpeed(record.speed),
        view.season.label,
        record.periodKey,
      ]);
    });
    return "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  }

  return {
    SEASONS,
    PERIODS,
    DIRECTIONS,
    SPEED_BANDS,
    DATA_VERSIONS,
    MAX_REASONABLE_SPEED,
    getRawDataset,
    getVersion,
    cleanDataset,
    filterRecords,
    aggregateRecords,
    buildViewModel,
    buildExportSummary,
    buildCsv,
    formatSpeed,
    roundOne,
    getSeasonKey,
    getPeriodKey,
    getShanghaiParts,
  };
});
