const test = require("node:test");
const assert = require("node:assert/strict");
const wind = require("../data.js");

function mean(values) {
  return wind.roundOne(values.reduce((sum, value) => sum + value, 0) / values.length);
}

test("normal sample passes every quality gate", () => {
  const result = wind.cleanDataset("normal");
  assert.equal(result.quality.rawRows, 288);
  assert.equal(result.quality.duplicateRows, 0);
  assert.equal(result.quality.missingRows, 0);
  assert.equal(result.quality.anomalyRows, 0);
  assert.equal(result.quality.validRows, 288);
});

test("missing sample removes incomplete rows before range validation", () => {
  const result = wind.cleanDataset("missing");
  assert.equal(result.quality.missingRows, 7);
  assert.equal(result.quality.anomalyRows, 3);
  assert.equal(
    result.quality.rawRows - result.quality.missingRows - result.quality.anomalyRows,
    result.quality.validRows
  );
  assert.ok(result.rejected.missing.every((row) => row.fields.length > 0));
  assert.ok(result.rejected.anomaly.every((row) => row.reason.length > 0));
});

test("duplicate sample deduplicates by observation id", () => {
  const result = wind.cleanDataset("duplicate");
  const rawIds = new Map();
  wind.getRawDataset("duplicate").forEach((record) => {
    rawIds.set(record.eventId, (rawIds.get(record.eventId) || 0) + 1);
  });
  const expectedDuplicates = [...rawIds.values()].reduce(
    (sum, count) => sum + Math.max(0, count - 1),
    0
  );
  assert.equal(result.quality.duplicateRows, expectedDuplicates);
  assert.equal(result.quality.duplicateRows, 8);
  assert.equal(
    new Set(result.cleaned.map((record) => record.eventId)).size,
    result.cleaned.length
  );
});

test("direction aggregation exactly recomputes from filtered cleaned samples", () => {
  const result = wind.cleanDataset("normal");
  const records = wind.filterRecords(result.cleaned, "autumn", "night");
  const aggregate = wind.aggregateRecords(records);
  const south = records.filter((record) => record.direction === "S");
  const southAggregate = aggregate.byDirection.find((item) => item.key === "S");

  assert.equal(aggregate.total, records.length);
  assert.equal(southAggregate.count, south.length);
  assert.equal(southAggregate.avgSpeed, mean(south.map((record) => record.speed)));
  assert.equal(
    aggregate.byBand.reduce((sum, band) => sum + band.count, 0),
    records.length
  );
  assert.equal(aggregate.avgSpeed, mean(records.map((record) => record.speed)));
});

test("every season and time window yields records", () => {
  wind.SEASONS.forEach((season) => {
    wind.PERIODS.forEach((period) => {
      const view = wind.buildViewModel("normal", season.key, period.key);
      assert.ok(view.aggregate.total > 0, `${season.key}/${period.key}`);
      assert.equal(view.records.length, view.aggregate.total);
    });
  });
});

test("CSV export repeats the on-screen aggregate values", () => {
  const view = wind.buildViewModel("duplicate", "winter", "day");
  const summary = wind.buildExportSummary(view);
  const csv = wind.buildCsv(view);
  const records = view.records.filter((record) => record.direction === "N");
  const north = view.aggregate.byDirection.find((item) => item.key === "N");

  assert.equal(summary.filteredRows, view.records.length);
  assert.equal(summary.avgSpeed, view.aggregate.avgSpeed);
  assert.equal(summary.duplicateRows, view.clean.quality.duplicateRows);
  assert.equal(north.count, records.length);
  assert.match(csv, new RegExp(`summary,filtered_rows,${summary.filteredRows}`));
  assert.match(csv, new RegExp(`summary,avg_speed,${wind.formatSpeed(summary.avgSpeed)}`));
  assert.match(csv, new RegExp(`N,北,${north.count},${wind.formatSpeed(north.avgSpeed)}`));
});

test("all three samples export their own auditable view", () => {
  wind.DATA_VERSIONS.forEach((version) => {
    const view = wind.buildViewModel(version.id, "summer", "night");
    const summary = wind.buildExportSummary(view);
    const csv = wind.buildCsv(view);
    const exportedRecords = csv
      .split("\r\n")
      .filter((line) => line.startsWith("record,WX-")).length;
    const directionFrequency = view.aggregate.byDirection.reduce(
      (sum, item) => sum + item.count,
      0
    );

    assert.equal(exportedRecords, summary.filteredRows, version.id);
    assert.equal(directionFrequency, summary.filteredRows, version.id);
    assert.match(csv, new RegExp(`metadata,data_version,${version.version}`));
    assert.match(csv, new RegExp(`quality,duplicate_rows,${summary.duplicateRows}`));
    assert.match(csv, new RegExp(`quality,missing_rows,${summary.missingRows}`));
    assert.match(csv, new RegExp(`quality,anomaly_rows,${summary.anomalyRows}`));
  });
});
