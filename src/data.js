export const STATIONS = [
  { id: "beigang", name: "北港", x: 90, y: 210, label: "left" },
  { id: "kechuang", name: "科创园", x: 250, y: 210, label: "top" },
  { id: "shimin", name: "市民中心", x: 430, y: 210, label: "bottom" },
  { id: "zhongyang", name: "中央广场", x: 600, y: 210, label: "top" },
  { id: "nanmen", name: "南门", x: 760, y: 210, label: "right" },
  { id: "jiangpan", name: "江畔", x: 920, y: 210, label: "right" },
  { id: "xizhan", name: "西站", x: 120, y: 430, label: "left" },
  { id: "wutong", name: "梧桐里", x: 270, y: 340, label: "bottom" },
  { id: "dongcheng", name: "东城", x: 650, y: 320, label: "right" },
  { id: "huizhan", name: "会展中心", x: 790, y: 400, label: "right" },
  { id: "jichang", name: "机场", x: 920, y: 470, label: "right" },
  { id: "huxin", name: "湖心岛", x: 760, y: 60, label: "top" },
  { id: "yishuguan", name: "艺术馆", x: 760, y: 135, label: "right" },
  { id: "daxuecheng", name: "大学城", x: 760, y: 530, label: "bottom" },
  { id: "beiyuan", name: "北苑", x: 310, y: 530, label: "left" },
  { id: "yungu", name: "云谷", x: 245, y: 390, label: "left" },
  { id: "binhe", name: "滨河公园", x: 690, y: 530, label: "bottom" }
];

export const LINES = [
  {
    id: "L1",
    name: "蓝湾线",
    shortName: "蓝线",
    color: "#37d6ff",
    stations: ["beigang", "kechuang", "shimin", "zhongyang", "nanmen", "jiangpan"]
  },
  {
    id: "L2",
    name: "橙港线",
    shortName: "橙线",
    color: "#ffb454",
    stations: ["xizhan", "wutong", "shimin", "dongcheng", "huizhan", "jichang"]
  },
  {
    id: "L3",
    name: "青岚线",
    shortName: "绿线",
    color: "#70e3a4",
    stations: ["huxin", "yishuguan", "nanmen", "daxuecheng"]
  },
  {
    id: "L4",
    name: "紫藤线",
    shortName: "紫线",
    color: "#c7a2ff",
    stations: ["beiyuan", "yungu", "kechuang", "dongcheng", "binhe"]
  }
];

export const TIME_WINDOWS = [
  {
    id: "morning",
    label: "早高峰",
    range: "07:00–09:30",
    shortRange: "07:00–09:30",
    transferMinutes: 3,
    closures: ["L3:nanmen|yishuguan", "L4:dongcheng|kechuang"],
    note: "早高峰施工：青岚线与紫藤线各有一处区间停运，路径已自动绕行。"
  },
  {
    id: "day",
    label: "平峰",
    range: "10:00–16:30",
    shortRange: "10:00–16:30",
    transferMinutes: 3,
    closures: [],
    note: "平峰时段全部区间正常运营，换乘等待按 3 分钟计入总时长。"
  },
  {
    id: "evening",
    label: "晚高峰",
    range: "17:00–19:30",
    shortRange: "17:00–19:30",
    transferMinutes: 3,
    closures: ["L2:huizhan|jichang", "L3:daxuecheng|nanmen"],
    note: "晚高峰两处区间停运；前往机场或大学城方向需改选可用路径。"
  }
];

const NORMAL_RECORDS = [
  ["R001", "L1", "beigang", "kechuang", 5],
  ["R002", "L1", "kechuang", "shimin", 5],
  ["R003", "L1", "shimin", "zhongyang", 4],
  ["R004", "L1", "zhongyang", "nanmen", 5],
  ["R005", "L1", "nanmen", "jiangpan", 4],
  ["R006", "L2", "xizhan", "wutong", 5],
  ["R007", "L2", "wutong", "shimin", 4],
  ["R008", "L2", "shimin", "dongcheng", 5],
  ["R009", "L2", "dongcheng", "huizhan", 5],
  ["R010", "L2", "huizhan", "jichang", 4],
  ["R011", "L3", "huxin", "yishuguan", 3],
  ["R012", "L3", "yishuguan", "nanmen", 6],
  ["R013", "L3", "nanmen", "daxuecheng", 5],
  ["R014", "L4", "beiyuan", "yungu", 4],
  ["R015", "L4", "yungu", "kechuang", 4],
  ["R016", "L4", "kechuang", "dongcheng", 4],
  ["R017", "L4", "dongcheng", "binhe", 5]
].map(([recordId, lineId, from, to, minutes]) => ({
  recordId,
  lineId,
  from,
  to,
  minutes,
  collectedAt: "2026-11-16 05:30"
}));

function cloneRecords(records) {
  return records.map((record) => ({ ...record }));
}

function buildMissingDataset() {
  const records = cloneRecords(NORMAL_RECORDS);
  delete records[4].minutes;
  records[5].lineId = null;
  delete records[9].to;
  records[15].from = "";
  records[16].minutes = -9;
  return records;
}

function buildDuplicateDataset() {
  const records = cloneRecords(NORMAL_RECORDS);
  const duplicateIndexes = [1, 3, 5, 11, 14];
  duplicateIndexes.forEach((index, offset) => {
    records.push({
      ...NORMAL_RECORDS[index],
      recordId: `D${String(offset + 1).padStart(3, "0")}`
    });
  });
  records.push({
    recordId: "X001",
    lineId: "L1",
    from: "beigang",
    to: "unknown-yard",
    minutes: 4,
    collectedAt: "2026-11-16 05:31"
  });
  records.push({
    recordId: "X002",
    lineId: "L1",
    from: "jiangpan",
    to: "beigang",
    minutes: 130,
    collectedAt: "2026-11-16 05:31"
  });
  return records;
}

export const DATASETS = [
  {
    id: "normal",
    label: "正常数据",
    shortLabel: "正常",
    version: "NET-2026.11.16-A",
    collectedAt: "2026-11-16 05:30",
    description: "完整采集样例，无缺失、无重复、无异常。",
    rawRecords: cloneRecords(NORMAL_RECORDS)
  },
  {
    id: "missing",
    label: "缺失数据",
    shortLabel: "缺失",
    version: "NET-2026.11.16-B",
    collectedAt: "2026-11-16 05:42",
    description: "含必填字段缺失与 1 条负时长异常，用于验证清洗。",
    rawRecords: buildMissingDataset()
  },
  {
    id: "duplicate",
    label: "重复数据",
    shortLabel: "重复",
    version: "NET-2026.11.16-C",
    collectedAt: "2026-11-16 05:51",
    description: "在完整样例上叠加重复区间与 2 条异常记录。",
    rawRecords: buildDuplicateDataset()
  }
];

export const REQUIRED_FIELDS = ["recordId", "lineId", "from", "to", "minutes"];
export const MAX_SEGMENT_MINUTES = 120;

export const STATION_BY_ID = new Map(STATIONS.map((station) => [station.id, station]));
export const LINE_BY_ID = new Map(LINES.map((line) => [line.id, line]));
export const DATASET_BY_ID = new Map(DATASETS.map((dataset) => [dataset.id, dataset]));
export const WINDOW_BY_ID = new Map(TIME_WINDOWS.map((window) => [window.id, window]));

export function edgeKey(lineId, from, to) {
  return `${lineId}:${[from, to].sort().join("|")}`;
}

export function closureKey(closure) {
  return closure;
}

export function stationLines(stationId) {
  return LINES.filter((line) => line.stations.includes(stationId));
}
