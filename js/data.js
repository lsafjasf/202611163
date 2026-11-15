export const DATA_VERSION = "ARR-2026.11.16-r4";
export const SAMPLE_DATE = "2026-11-16";
export const TIMEZONE = "Asia/Shanghai";
export const DAY_START_MIN = 390;
export const SLOT_MINUTES = 12;
export const SLOT_COUNT = 21;
export const SAMPLE_END_MIN = DAY_START_MIN + SLOT_MINUTES * (SLOT_COUNT - 1);

export const LINE_DEFS = [
  { id: "L1", name: "1号线", station: "人民广场", direction: "上行", color: "#2563eb" },
  { id: "L2", name: "2号线", station: "静安寺", direction: "上行", color: "#0f9d76" },
  { id: "L3", name: "3号线", station: "中山公园", direction: "上行", color: "#d97706" },
  { id: "L4", name: "4号线", station: "世纪大道", direction: "上行", color: "#7c3aed" },
  { id: "L5", name: "5号线", station: "陆家嘴", direction: "上行", color: "#df3f77" },
  { id: "L6", name: "6号线", station: "虹桥路", direction: "上行", color: "#0891b2" }
];

const ARRIVAL_OFFSETS = [
  [0.8, 1.4, 0.6, 1.8, 0.9, 1.2, 0.5, 1.6, 0.7, 1.1, 0.9, 1.5, 0.6, 1.2, 0.8, 1.7, 0.5, 1.3, 0.9, 1.4, 0.7],
  [1.2, 0.7, 1.6, 1.0, 0.5, 1.4, 0.8, 1.9, 1.1, 0.6, 1.3, 0.9, 1.5, 0.7, 1.2, 0.8, 1.6, 0.5, 1.1, 1.4, 0.9],
  [0.5, 1.1, 1.7, 0.8, 1.3, 0.6, 1.5, 0.9, 1.8, 1.0, 0.7, 1.4, 0.8, 1.6, 0.5, 1.2, 0.9, 1.7, 1.1, 0.6, 1.3],
  [1.4, 0.8, 1.2, 1.7, 0.6, 1.1, 1.5, 0.7, 1.3, 0.9, 1.8, 0.5, 1.2, 1.6, 0.8, 1.0, 1.4, 0.7, 1.6, 1.1, 0.9],
  [0.9, 1.5, 0.7, 1.2, 1.8, 0.6, 1.4, 1.0, 0.8, 1.6, 0.5, 1.3, 1.1, 0.7, 1.5, 0.9, 1.2, 1.7, 0.6, 1.0, 1.4],
  [1.1, 0.6, 1.5, 0.9, 1.3, 1.7, 0.5, 1.2, 1.8, 0.7, 1.1, 1.6, 0.8, 1.4, 0.6, 1.3, 0.9, 1.5, 0.7, 1.2, 1.0]
];

const PROFILES = {
  normal: {
    missing: [],
    duplicates: [],
    offsetOverrides: {}
  },
  missing: {
    missing: [
      ["L2", 3],
      ["L4", 7],
      ["L4", 8],
      ["L5", 12]
    ],
    duplicates: [],
    offsetOverrides: {}
  },
  duplicate: {
    missing: [],
    duplicates: [
      ["L1", 5],
      ["L2", 9],
      ["L3", 12],
      ["L4", 4],
      ["L5", 15],
      ["L6", 8]
    ],
    offsetOverrides: {}
  },
  combined: {
    missing: [
      ["L2", 3],
      ["L4", 7],
      ["L4", 8],
      ["L5", 12]
    ],
    duplicates: [
      ["L1", 5],
      ["L3", 12],
      ["L6", 8]
    ],
    offsetOverrides: { L6: { 11: -6.9 } }
  }
};

function pad(value, size = 2) {
  return String(value).padStart(size, "0");
}

export function isoFromMinute(minute) {
  const date = new Date(Date.UTC(2026, 10, 15, 16, 0, 0) + minute * 60_000);
  return date.toISOString();
}

export function minuteFromIso(iso) {
  return (Date.parse(iso) - Date.UTC(2026, 10, 15, 16, 0, 0)) / 60_000;
}

export function formatClock(isoOrMinute) {
  const minute = typeof isoOrMinute === "number" ? isoOrMinute : minuteFromIso(isoOrMinute);
  const rounded = Math.floor(minute + 1e-7);
  return `${pad(Math.floor(rounded / 60))}:${pad(rounded % 60)}`;
}

function makeRecord(line, slotIndex, offsetMinutes, profile, duplicateIndex = 0) {
  const scheduleMinute = DAY_START_MIN + slotIndex * SLOT_MINUTES;
  const override = profile.offsetOverrides[line.id]?.[slotIndex];
  const actualMinute = scheduleMinute + (override ?? offsetMinutes);
  const duplicate = duplicateIndex > 0;
  return {
    id: `R-${line.id}-${pad(slotIndex + 1, 3)}${duplicate ? `-D${duplicateIndex}` : ""}`,
    serviceKey: `${line.id}-${pad(slotIndex + 1, 3)}`,
    serviceDate: SAMPLE_DATE,
    lineId: line.id,
    station: line.station,
    direction: line.direction,
    scheduleIndex: slotIndex,
    scheduledAt: isoFromMinute(scheduleMinute),
    arrivedAt: isoFromMinute(actualMinute),
    vehicle: `${line.id}-${pad(((slotIndex * 7) % 19) + 1)}`,
    source: duplicate ? "补传批次" : "车载终端",
    receivedAt: isoFromMinute(actualMinute + (duplicate ? 0.8 : 0.2)),
    duplicate
  };
}

function buildDataset(profileName) {
  const profile = PROFILES[profileName];
  const missingKeys = new Set(profile.missing.map(([lineId, index]) => `${lineId}-${index}`));
  const duplicateMap = new Map();
  profile.duplicates.forEach(([lineId, index]) => {
    const key = `${lineId}-${index}`;
    duplicateMap.set(key, (duplicateMap.get(key) ?? 0) + 1);
  });

  const records = [];
  LINE_DEFS.forEach((line, lineIndex) => {
    for (let slotIndex = 0; slotIndex < SLOT_COUNT; slotIndex += 1) {
      if (missingKeys.has(`${line.id}-${slotIndex}`)) continue;
      const offset = ARRIVAL_OFFSETS[lineIndex][slotIndex];
      records.push(makeRecord(line, slotIndex, offset, profile));
      const duplicateCount = duplicateMap.get(`${line.id}-${slotIndex}`) ?? 0;
      for (let duplicateIndex = 1; duplicateIndex <= duplicateCount; duplicateIndex += 1) {
        records.push(makeRecord(line, slotIndex, offset, profile, duplicateIndex));
      }
    }
  });

  return {
    id: `sample-${profileName}`,
    profile: profileName,
    version: DATA_VERSION,
    sampleDate: SAMPLE_DATE,
    timezone: TIMEZONE,
    lines: LINE_DEFS.map((line) => ({ ...line })),
    schedule: {
      startMinute: DAY_START_MIN,
      endMinute: SAMPLE_END_MIN,
      slotMinutes: SLOT_MINUTES,
      slotCount: SLOT_COUNT
    },
    records
  };
}

export const DATASETS = {
  normal: buildDataset("normal"),
  missing: buildDataset("missing"),
  duplicate: buildDataset("duplicate"),
  combined: buildDataset("combined")
};

export const DEFAULT_DATASET = DATASETS.combined;
