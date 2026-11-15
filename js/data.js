// 原始样例数据：分时人流记录。所有界面数值均由这些原始记录实时清洗、聚合得到。
// 记录格式: { id, hour(0-23), from, to, count }
(function (root) {
  'use strict';

  var DATA_VERSION = 'v2026.11.16-r3';
  var STAT_CALIBER = '统计口径：按“小时 × 来源街区 × 目的街区”汇总的人次；' +
    '重复记录按 (hour,from,to,count) 完全相同的行去重，缺失关键字段的记录剔除，' +
    '负值/超上限异常值剔除并计入异常数。';

  // 街区节点（画布坐标，百分比）
  var BLOCKS = [
    { id: 'A', name: '老城站前', x: 0.16, y: 0.24 },
    { id: 'B', name: '中央商圈', x: 0.50, y: 0.16 },
    { id: 'C', name: '科创园区', x: 0.84, y: 0.26 },
    { id: 'D', name: '滨河住区', x: 0.20, y: 0.76 },
    { id: 'E', name: '大学城',   x: 0.52, y: 0.86 },
    { id: 'F', name: '物流枢纽', x: 0.85, y: 0.72 }
  ];

  // 通道容量（人次/小时），超过则箭头变色
  var CAPACITY = {
    'A>B': 900, 'B>A': 900,
    'A>D': 500, 'D>A': 500,
    'B>C': 700, 'C>B': 700,
    'B>E': 600, 'E>B': 600,
    'C>F': 450, 'F>C': 450,
    'D>E': 550, 'E>D': 550,
    'E>F': 400, 'F>E': 400
  };

  function rec(id, hour, from, to, count) {
    return { id: id, hour: hour, from: from, to: to, count: count };
  }

  // —— 数据集 1：正常 ——
  var DS_NORMAL = {
    key: 'normal',
    label: '正常数据（早高峰）',
    records: [
      rec('N01', 7, 'A', 'B', 620), rec('N02', 7, 'D', 'A', 310),
      rec('N03', 7, 'B', 'C', 540), rec('N04', 7, 'E', 'B', 430),
      rec('N05', 7, 'D', 'E', 280), rec('N06', 7, 'C', 'F', 390),
      rec('N07', 8, 'A', 'B', 960), rec('N08', 8, 'D', 'A', 540),
      rec('N09', 8, 'B', 'C', 780), rec('N10', 8, 'E', 'B', 660),
      rec('N11', 8, 'D', 'E', 610), rec('N12', 8, 'C', 'F', 470),
      rec('N13', 8, 'E', 'F', 430), rec('N14', 8, 'B', 'A', 240),
      rec('N15', 9, 'A', 'B', 700), rec('N16', 9, 'B', 'C', 610),
      rec('N17', 9, 'C', 'B', 320), rec('N18', 9, 'E', 'D', 260),
      rec('N19', 9, 'F', 'C', 210), rec('N20', 9, 'A', 'D', 180),
      rec('N21', 10, 'B', 'A', 410), rec('N22', 10, 'C', 'B', 450),
      rec('N23', 10, 'E', 'B', 300), rec('N24', 10, 'F', 'E', 220)
    ]
  };

  // —— 数据集 2：缺失（缺 count / 缺端点 / 缺 hour）——
  var DS_MISSING = {
    key: 'missing',
    label: '缺失数据（午间，含缺字段记录）',
    records: [
      rec('M01', 12, 'A', 'B', 480), rec('M02', 12, 'B', 'A', 460),
      rec('M03', 12, 'B', 'E', null),
      rec('M04', 12, 'C', 'B', 350),
      rec('M05', 12, null, 'D', 200),
      rec('M06', 12, 'D', 'E', 240),
      rec('M07', 13, 'A', 'B', 520), rec('M08', 13, 'B', 'C', 410),
      rec('M09', 13, 'E', 'F', undefined),
      rec('M10', 13, 'F', 'C', 260),
      rec('M11', null, 'D', 'A', 150),
      rec('M12', 13, 'C', 'F', 300),
      rec('M13', 14, 'B', 'A', 380), rec('M14', 14, 'E', 'D', 290),
      rec('M15', 14, 'A', 'D', 210), rec('M16', 14, 'C', 'B', 330)
    ]
  };

  // —— 数据集 3：重复（含完全重复行与异常值）——
  var DS_DUP = {
    key: 'dup',
    label: '重复数据（晚高峰，含重复与异常）',
    records: [
      rec('P01', 18, 'B', 'A', 880), rec('P02', 18, 'C', 'B', 720),
      rec('P03', 18, 'E', 'D', 500), rec('P04', 18, 'F', 'E', 380),
      rec('P05', 18, 'B', 'A', 880),
      rec('P06', 18, 'C', 'B', 720),
      rec('P07', 18, 'A', 'D', 460),
      rec('P08', 19, 'B', 'A', 940), rec('P09', 19, 'C', 'B', 760),
      rec('P10', 19, 'E', 'D', 560), rec('P11', 19, 'F', 'C', 420),
      rec('P12', 19, 'B', 'A', 940),
      rec('P13', 19, 'E', 'F', -50),
      rec('P14', 19, 'A', 'B', 99999),
      rec('P15', 20, 'B', 'A', 610), rec('P16', 20, 'C', 'B', 540),
      rec('P17', 20, 'D', 'A', 330), rec('P18', 20, 'E', 'B', 470),
      rec('P19', 20, 'F', 'E', 260), rec('P20', 20, 'A', 'B', 350)
    ]
  };

  var DATASETS = [DS_NORMAL, DS_MISSING, DS_DUP];

  var api = {
    DATA_VERSION: DATA_VERSION,
    STAT_CALIBER: STAT_CALIBER,
    BLOCKS: BLOCKS,
    CAPACITY: CAPACITY,
    DATASETS: DATASETS,
    MAX_PLAUSIBLE_COUNT: 50000
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FlowData = api;
})(typeof window !== 'undefined' ? window : globalThis);
