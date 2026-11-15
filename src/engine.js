import { ANOMALY_THRESHOLD, SENSORS } from "./config.js";

export const SENSOR_IDS = SENSORS.map((sensor) => sensor.id);

function median(values) {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function maxAbs(values) {
  return values.length ? Math.max(...values.map((value) => Math.abs(value))) : null;
}

function round(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function slotToSeconds(slot, intervalSeconds) {
  return slot * intervalSeconds;
}

export function secondsToSlot(seconds, intervalSeconds) {
  return seconds / intervalSeconds;
}

export function cleanDataset(dataset) {
  const intervalSeconds = dataset.intervalSeconds;
  const threshold = dataset.anomalyThreshold ?? ANOMALY_THRESHOLD;
  const references = new Map(dataset.reference.map((point) => [point.t / intervalSeconds, point.value]));
  const grouped = new Map();

  for (const reading of dataset.readings) {
    if (!SENSOR_IDS.includes(reading.sensor)) continue;
    const slot = reading.t / intervalSeconds;
    const key = `${reading.sensor}:${slot}`;
    if (!grouped.has(key)) {
      grouped.set(key, { sensor: reading.sensor, slot, values: [], ids: [] });
    }
    const group = grouped.get(key);
    group.values.push(reading.value);
    group.ids.push(reading.id);
  }

  const groups = Object.fromEntries(SENSOR_IDS.map((sensor) => [sensor, []]));
  let duplicateRemoved = 0;

  for (const group of grouped.values()) {
    const raw = median(group.values);
    const reference = references.get(group.slot);
    const rawError = Number.isFinite(reference) ? raw - reference : null;
    const anomaly = Number.isFinite(rawError) && Math.abs(rawError) > threshold;
    duplicateRemoved += group.values.length - 1;
    groups[group.sensor].push({
      sensor: group.sensor,
      slot: group.slot,
      t: group.slot * intervalSeconds,
      raw,
      reference: Number.isFinite(reference) ? reference : null,
      rawError,
      anomaly,
      sampleCount: group.values.length,
      duplicateRemoved: group.values.length - 1,
      sourceIds: [...group.ids],
    });
  }

  for (const sensor of SENSOR_IDS) {
    groups[sensor].sort((a, b) => a.slot - b.slot);
  }

  const expectedSensorSlots = dataset.expectedSlots * SENSOR_IDS.length;
  const uniqueSensorSlots = grouped.size;
  const anomalyCount = Object.values(groups)
    .flat()
    .filter((group) => group.anomaly).length;

  return {
    datasetId: dataset.id,
    version: dataset.version,
    intervalSeconds,
    expectedSlots: dataset.expectedSlots,
    lastSlot: dataset.expectedSlots - 1,
    threshold,
    groups,
    quality: {
      rawRows: dataset.readings.length,
      uniqueSensorSlots,
      expectedSensorSlots,
      duplicateRemoved,
      missing: Math.max(0, expectedSensorSlots - uniqueSensorSlots),
      anomalyCount,
    },
  };
}

function nearestEligibleGroup(series, targetSlot) {
  const eligible = series.filter((group) => Number.isFinite(group.reference) && !group.anomaly);
  if (!eligible.length) return series[0] ?? null;
  return eligible.reduce((best, group) => (
    Math.abs(group.slot - targetSlot) < Math.abs(best.slot - targetSlot) ? group : best
  ));
}

export function createDefaultCalibration(clean, sensorIds = SENSOR_IDS) {
  return Object.fromEntries(sensorIds.map((sensor) => {
    const series = clean.groups[sensor];
    const targets = [0.15, 0.5, 0.85].map((ratio) => ratio * clean.lastSlot);
    const anchors = [];
    for (const [index, target] of targets.entries()) {
      const group = nearestEligibleGroup(series, target);
      if (!group) continue;
      const slot = round(group.slot, 3);
      if (!anchors.some((anchor) => Math.abs(anchor.slot - slot) < 0.01)) {
        anchors.push({ id: `${sensor}-anchor-${index + 1}`, slot, targetError: 0 });
      }
    }
    return [sensor, anchors.sort((a, b) => a.slot - b.slot)];
  }));
}

function interpolate(x, points, fallback = 0) {
  if (!points.length) return fallback;
  if (x <= points[0].x) return points[0].y;
  if (x >= points.at(-1).x) return points.at(-1).y;
  for (let index = 1; index < points.length; index += 1) {
    const left = points[index - 1];
    const right = points[index];
    if (x <= right.x) {
      const ratio = (x - left.x) / (right.x - left.x || 1);
      return left.y + (right.y - left.y) * ratio;
    }
  }
  return points.at(-1).y;
}

function residualAt(series, slot) {
  const points = series
    .filter((group) => Number.isFinite(group.rawError))
    .map((group) => ({ x: group.slot, y: group.rawError }));
  return interpolate(slot, points, 0);
}

function buildCalibrationPoints(series, anchors) {
  return [...anchors]
    .sort((a, b) => a.slot - b.slot)
    .map((anchor) => ({
      x: anchor.slot,
      y: residualAt(series, anchor.slot) - anchor.targetError,
      sourceError: residualAt(series, anchor.slot),
      targetError: anchor.targetError,
    }));
}

function sensorStats(entries) {
  const rawErrors = entries.map((entry) => entry.rawError).filter(Number.isFinite);
  const calibratedErrors = entries.map((entry) => entry.calibratedError).filter(Number.isFinite);
  return {
    n: rawErrors.length,
    rawMae: mean(rawErrors.map(Math.abs)),
    rawMax: maxAbs(rawErrors),
    calibratedMae: mean(calibratedErrors.map(Math.abs)),
    calibratedMax: maxAbs(calibratedErrors),
  };
}

export function computeView(dataset, clean, options) {
  const {
    startSlot,
    endSlot,
    sensorIds = SENSOR_IDS,
    excludeAnomalies = false,
    calibration = {},
    activeSensor = "S1",
  } = options;

  const selectedSensors = SENSOR_IDS.filter((sensor) => sensorIds.includes(sensor));
  const groups = {};
  const anchors = {};
  const windowEntries = [];

  for (const sensor of selectedSensors) {
    const series = clean.groups[sensor];
    const sensorAnchors = calibration[sensor] ?? [];
    const correctionPoints = buildCalibrationPoints(series, sensorAnchors);
    groups[sensor] = [];

    for (const group of series) {
      if (group.slot < startSlot || group.slot > endSlot) continue;
      if (excludeAnomalies && group.anomaly) continue;
      const correction = interpolate(group.slot, correctionPoints, 0);
      const calibrated = group.raw - correction;
      const calibratedError = Number.isFinite(group.reference)
        ? calibrated - group.reference
        : null;
      const entry = {
        ...group,
        correction,
        calibrated,
        calibratedError,
        included: true,
      };
      groups[sensor].push(entry);
      windowEntries.push(entry);
    }

    anchors[sensor] = sensorAnchors.map((anchor) => ({
      ...anchor,
      sourceError: residualAt(series, anchor.slot),
      correction: residualAt(series, anchor.slot) - anchor.targetError,
    }));
  }

  const rawErrors = windowEntries.map((entry) => entry.rawError).filter(Number.isFinite);
  const calibratedErrors = windowEntries
    .map((entry) => entry.calibratedError)
    .filter(Number.isFinite);
  const rawMae = mean(rawErrors.map(Math.abs));
  const calibratedMae = mean(calibratedErrors.map(Math.abs));
  const expectedWindowSlots = endSlot - startSlot + 1;
  const expectedSensorSlots = expectedWindowSlots * selectedSensors.length;
  const presentSensorSlots = selectedSensors.reduce((sum, sensor) => (
    sum + clean.groups[sensor].filter((group) => group.slot >= startSlot && group.slot <= endSlot).length
  ), 0);
  const anomaliesInWindow = selectedSensors.reduce((sum, sensor) => (
    sum + clean.groups[sensor].filter((group) => (
      group.slot >= startSlot && group.slot <= endSlot && group.anomaly
    )).length
  ), 0);
  const duplicatesInWindow = selectedSensors.reduce((sum, sensor) => (
    sum + clean.groups[sensor].filter((group) => (
      group.slot >= startSlot && group.slot <= endSlot
    )).reduce((inner, group) => inner + group.duplicateRemoved, 0)
  ), 0);

  return {
    datasetId: dataset.id,
    version: dataset.version,
    title: dataset.title,
    day: dataset.day,
    intervalSeconds: dataset.intervalSeconds,
    startSlot,
    endSlot,
    selectedSensors,
    excludeAnomalies,
    activeSensor,
    groups,
    anchors,
    rows: [...windowEntries].sort((a, b) => a.slot - b.slot || SENSOR_IDS.indexOf(a.sensor) - SENSOR_IDS.indexOf(b.sensor)),
    slots: Array.from({ length: expectedWindowSlots }, (_, index) => {
      const slot = startSlot + index;
      const reference = dataset.reference.find((point) => point.t / dataset.intervalSeconds === slot);
      return { slot, t: slot * dataset.intervalSeconds, reference: reference?.value ?? null };
    }),
    quality: {
      ...clean.quality,
      duplicateRemovedInWindow: duplicatesInWindow,
      missingInWindow: Math.max(0, expectedSensorSlots - presentSensorSlots),
      anomaliesInWindow,
      presentSensorSlots,
      expectedSensorSlots,
    },
    stats: {
      n: rawErrors.length,
      rawMae,
      rawMax: maxAbs(rawErrors),
      calibratedMae,
      calibratedMax: maxAbs(calibratedErrors),
      improvement: Number.isFinite(rawMae) && rawMae > 0
        ? (rawMae - calibratedMae) / rawMae
        : null,
      sensorStats: Object.fromEntries(
        selectedSensors.map((sensor) => [sensor, sensorStats(groups[sensor])]),
      ),
    },
  };
}

export function updateAnchor(calibration, sensor, anchorId, patch, lastSlot) {
  const next = structuredClone(calibration);
  const anchors = next[sensor] ?? [];
  const anchor = anchors.find((item) => item.id === anchorId);
  if (!anchor) return next;
  if (Number.isFinite(patch.slot)) {
    anchor.slot = round(clamp(patch.slot, 0, lastSlot), 3);
  }
  if (Number.isFinite(patch.targetError)) {
    anchor.targetError = round(clamp(patch.targetError, -12, 12), 4);
  }
  anchors.sort((a, b) => a.slot - b.slot);
  return next;
}

export function recomputeStatsFromRows(rows) {
  const rawErrors = rows.map((row) => row.rawError).filter(Number.isFinite);
  const calibratedErrors = rows.map((row) => row.calibratedError).filter(Number.isFinite);
  return {
    n: rawErrors.length,
    rawMae: mean(rawErrors.map(Math.abs)),
    rawMax: maxAbs(rawErrors),
    calibratedMae: mean(calibratedErrors.map(Math.abs)),
    calibratedMax: maxAbs(calibratedErrors),
  };
}
