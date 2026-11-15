import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "data");
const START = 8 * 3600;
const INTERVAL = 30;
const SLOTS = 41;
const SENSORS = ["S1", "S2", "S3"];

function mulberry32(seed) {
  return () => {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function referenceAt(t) {
  const progress = t / ((SLOTS - 1) * INTERVAL);
  return 24.2
    + 2.7 * Math.sin(progress * Math.PI * 1.35)
    + 0.58 * Math.sin(progress * Math.PI * 5.2)
    + 0.24 * Math.sin(progress * Math.PI * 11.4);
}

function drift(sensor, t) {
  if (sensor === "S1") return 1.25 + 0.00086 * t;
  if (sensor === "S2") return -0.78 - 0.00055 * t;
  return 0.42 + 0.0003 * t;
}

function makeBase(seed) {
  const random = mulberry32(seed);
  const readings = [];
  const reference = [];

  for (let slot = 0; slot < SLOTS; slot += 1) {
    const t = slot * INTERVAL;
    const ref = referenceAt(t);
    reference.push({ t, value: round(ref, 3) });

    for (const sensor of SENSORS) {
      const noise = (random() - 0.5) * 0.24;
      readings.push({
        id: `${sensor}-${String(slot).padStart(3, "0")}`,
        sensor,
        t,
        value: round(ref + drift(sensor, t) + noise, 3),
      });
    }
  }

  return { readings, reference };
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function cloneBase(base) {
  return {
    readings: base.readings.map((row) => ({ ...row })),
    reference: base.reference.map((row) => ({ ...row })),
  };
}

function injectAnomalies(rows, entries) {
  for (const { sensor, slot, delta } of entries) {
    const row = rows.find((item) => item.sensor === sensor && item.t === slot * INTERVAL);
    if (row) row.value = round(row.value + delta, 3);
  }
}

function removeMissing(rows, entries) {
  const keys = new Set(entries.map(({ sensor, slot }) => `${sensor}:${slot}`));
  return rows.filter((row) => !keys.has(`${row.sensor}:${row.t / INTERVAL}`));
}

function addDuplicates(rows, specs) {
  const duplicates = [];
  for (const { sensor, slot, delta = 0.12 } of specs) {
    const row = rows.find((item) => item.sensor === sensor && item.t === slot * INTERVAL);
    if (!row) continue;
    duplicates.push({
      ...row,
      id: `${row.id}-DUP`,
      value: round(row.value + delta, 3),
    });
  }
  return [...rows, ...duplicates];
}

function datasetMeta({ id, title, version, description, note, qualityHint, readings, reference }) {
  return {
    schemaVersion: 1,
    id,
    title,
    version,
    description,
    note,
    qualityHint,
    day: "2026-11-16",
    timezone: "Asia/Shanghai",
    startTime: "2026-11-16T08:00:00+08:00",
    intervalSeconds: INTERVAL,
    expectedSlots: SLOTS,
    anomalyThreshold: 4,
    source: "确定性合成样例 / 30 秒等间隔采样",
    readings,
    reference,
  };
}

const base = makeBase(20261116);

const normal = cloneBase(base);

const missing = cloneBase(base);
missing.readings = removeMissing(missing.readings, [
  { sensor: "S1", slot: 8 },
  { sensor: "S1", slot: 23 },
  { sensor: "S1", slot: 37 },
  { sensor: "S2", slot: 4 },
  { sensor: "S2", slot: 5 },
  { sensor: "S2", slot: 19 },
  { sensor: "S2", slot: 28 },
  { sensor: "S3", slot: 14 },
  { sensor: "S3", slot: 31 },
]);
injectAnomalies(missing.readings, [
  { sensor: "S1", slot: 12, delta: 7.2 },
  { sensor: "S3", slot: 25, delta: -6.4 },
  { sensor: "S2", slot: 33, delta: 8.1 },
]);

const duplicate = cloneBase(base);
duplicate.readings = removeMissing(duplicate.readings, [
  { sensor: "S2", slot: 9 },
  { sensor: "S1", slot: 30 },
  { sensor: "S3", slot: 39 },
]);
duplicate.readings = addDuplicates(duplicate.readings, [
  { sensor: "S1", slot: 2 },
  { sensor: "S2", slot: 6 },
  { sensor: "S3", slot: 10 },
  { sensor: "S1", slot: 14 },
  { sensor: "S2", slot: 18 },
  { sensor: "S3", slot: 22 },
  { sensor: "S1", slot: 26 },
  { sensor: "S2", slot: 31 },
  { sensor: "S3", slot: 34 },
  { sensor: "S1", slot: 36 },
  { sensor: "S2", slot: 38 },
  { sensor: "S3", slot: 40, delta: -0.09 },
]);
injectAnomalies(duplicate.readings, [
  { sensor: "S1", slot: 7, delta: -7.5 },
  { sensor: "S3", slot: 29, delta: 6.2 },
]);

const datasets = [
  datasetMeta({
    id: "normal",
    title: "正常序列",
    version: "NORM-2026.11.16.1",
    description: "连续采样、无重复、无缺失；用于验证基准曲线与自动校准。",
    note: "三枚传感器均保持完整覆盖，参考曲线连续可用。",
    qualityHint: "无缺失 · 无重复 · 无异常",
    ...normal,
  }),
  datasetMeta({
    id: "missing",
    title: "缺失序列",
    version: "GAPS-2026.11.16.2",
    description: "包含 9 个传感器时槽缺测与 3 个显著异常点。",
    note: "缺失点不做插值，统计仅使用实际存在的配对样本。",
    qualityHint: "9 缺失 · 3 异常",
    ...missing,
  }),
  datasetMeta({
    id: "duplicate",
    title: "重复序列",
    version: "DUPS-2026.11.16.3",
    description: "包含 12 条重复读数、3 个缺失时槽与 2 个显著异常点。",
    note: "重复读数按传感器与时槽取中位数，原始行数保持不变。",
    qualityHint: "12 重复 · 3 缺失 · 2 异常",
    ...duplicate,
  }),
];

await mkdir(dataDir, { recursive: true });
for (const dataset of datasets) {
  dataset.readings.sort((a, b) => a.t - b.t || a.sensor.localeCompare(b.sensor) || a.id.localeCompare(b.id));
  await writeFile(
    path.join(dataDir, `${dataset.id}.json`),
    `${JSON.stringify(dataset, null, 2)}\n`,
    "utf8",
  );
}

const manifest = {
  schemaVersion: 1,
  generatedAt: "2026-11-16T08:20:00+08:00",
  generator: "scripts/generate-data.mjs",
  datasets: datasets.map(({ id, title, version, description, qualityHint }) => ({
    id,
    title,
    version,
    description,
    qualityHint,
    file: `./data/${id}.json`,
  })),
};

await writeFile(path.join(dataDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Generated ${datasets.length} datasets in ${dataDir}`);
