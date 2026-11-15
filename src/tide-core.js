/**
 * 潮位数据核心逻辑：数据生成、清洗、聚合与统计口径。
 * 纯函数模块，浏览器与 Node 共用；界面不保存任何预设统计结果，
 * 所有派生数值均由本模块从原始记录实时重算。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TideCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var HOURS = 24 * 7;
  var START_ISO = '2026-11-09T00:00:00+08:00';
  var START_MS = new Date(START_ISO).getTime();
  var HOUR_MS = 3600 * 1000;
  var DATA_VERSION = 'synth-tide-2026.11-v1';
  var GENERATED_AT = '2026-11-16T00:00:00+08:00';
  var PHYSICAL_MIN = -5;
  var PHYSICAL_MAX = 8;
  var COLOR_MIN = -2.5;
  var COLOR_MAX = 6;

  var STATIONS = [
    { id: 'S01', name: '芦潮港', mean: 1.6, amp1: 1.9, amp2: 0.55, p1: 0.4, p2: 1.1 },
    { id: 'S02', name: '金山嘴', mean: 1.2, amp1: 1.7, amp2: 0.45, p1: 1.2, p2: 0.6 },
    { id: 'S03', name: '乍浦', mean: 2.1, amp1: 2.3, amp2: 0.6, p1: 2.1, p2: 2.0 },
    { id: 'S04', name: '澉浦', mean: 2.4, amp1: 2.5, amp2: 0.7, p1: 2.8, p2: 0.3 },
    { id: 'S05', name: '镇海', mean: 1.0, amp1: 1.5, amp2: 0.4, p1: 3.6, p2: 1.7 },
    { id: 'S06', name: '北仑', mean: 0.9, amp1: 1.4, amp2: 0.35, p1: 4.2, p2: 2.6 },
    { id: 'S07', name: '舟山', mean: 1.3, amp1: 1.6, amp2: 0.5, p1: 5.0, p2: 0.9 },
    { id: 'S08', name: '温州', mean: 1.8, amp1: 2.0, amp2: 0.65, p1: 5.7, p2: 2.2 }
  ];

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function round3(x) {
    return Math.round(x * 1000) / 1000;
  }

  /** 确定性合成潮位：两个主要分潮叠加，单位 m（吴淞基面口径的模拟值）。 */
  function tideValue(station, hourIndex) {
    var v = station.mean
      + station.amp1 * Math.sin((2 * Math.PI * hourIndex) / 12.42 + station.p1)
      + station.amp2 * Math.sin((2 * Math.PI * hourIndex) / 24 + station.p2)
      + 0.12 * Math.sin((2 * Math.PI * hourIndex) / (12.42 * 14.77) + station.p1);
    return round3(v);
  }

  function hourAt(hourIndex) {
    return START_MS + hourIndex * HOUR_MS;
  }

  function record(stationId, hourIndex, value) {
    return { stationId: stationId, t: hourAt(hourIndex), value: value };
  }

  function baseGrid() {
    var rows = [];
    for (var s = 0; s < STATIONS.length; s++) {
      for (var h = 0; h < HOURS; h++) {
        rows.push(record(STATIONS[s].id, h, tideValue(STATIONS[s], h)));
      }
    }
    return rows;
  }

  /** 缺失组：确定性抽样删除约 8% 的整点槽位（整槽删除，无重复记录）。 */
  function buildMissing() {
    var rng = mulberry32(20261109);
    var removed = {};
    for (var s = 0; s < STATIONS.length; s++) {
      for (var h = 0; h < HOURS; h++) {
        if (rng() < 0.08) removed[STATIONS[s].id + '#' + h] = true;
      }
    }
    var rows = [];
    for (var i = 0; i < STATIONS.length; i++) {
      for (var k = 0; k < HOURS; k++) {
        if (!removed[STATIONS[i].id + '#' + k]) {
          rows.push(record(STATIONS[i].id, k, tideValue(STATIONS[i], k)));
        }
      }
    }
    return {
      id: 'missing',
      label: '缺失组',
      seed: 20261109,
      generatedAt: GENERATED_AT,
      version: DATA_VERSION,
      raw: rows
    };
  }

  /**
   * 重复组：同时注入重复上报、物理异常与整槽缺失。
   * 重复记录在真值上叠加确定性扰动；异常记录超出 [-5, 8] m 物理区间。
   */
  function buildDuplicate() {
    var rng = mulberry32(719719719);
    var dup = {}, anomaly = {}, missing = {};
    for (var s = 0; s < STATIONS.length; s++) {
      for (var h = 0; h < HOURS; h++) {
        var r = rng();
        var key = STATIONS[s].id + '#' + h;
        if (r < 0.05) missing[key] = true;
        else if (r < 0.09) anomaly[key] = true;
        else if (r < 0.15) dup[key] = true;
      }
    }
    var rows = [];
    for (var i = 0; i < STATIONS.length; i++) {
      var st = STATIONS[i];
      for (var k = 0; k < HOURS; k++) {
        var id = st.id + '#' + k;
        if (missing[id]) continue;
        if (anomaly[id]) {
          var bad = rng() < 0.5
            ? PHYSICAL_MAX + 2 + round3(rng() * 3)
            : PHYSICAL_MIN - 1 - round3(rng() * 2);
          rows.push(record(st.id, k, bad));
          continue;
        }
        rows.push(record(st.id, k, tideValue(st, k)));
        if (dup[id]) {
          var noise = round3((rng() - 0.35) * 0.18);
          rows.push(record(st.id, k, round3(tideValue(st, k) + noise)));
        }
      }
    }
    return {
      id: 'duplicate',
      label: '重复/异常组',
      seed: 719719719,
      generatedAt: GENERATED_AT,
      version: DATA_VERSION,
      raw: rows
    };
  }

  function buildDatasets() {
    var normal = {
      id: 'normal',
      label: '正常组',
      seed: 0,
      generatedAt: GENERATED_AT,
      version: DATA_VERSION,
      raw: baseGrid()
    };
    return { normal: normal, missing: buildMissing(), duplicate: buildDuplicate() };
  }

  function slotKey(stationId, t) {
    return stationId + '@' + t;
  }

  function hourIndexOf(t) {
    return Math.round((t - START_MS) / HOUR_MS);
  }

  function isAnomaly(value) {
    return typeof value !== 'number' || !isFinite(value)
      || value < PHYSICAL_MIN || value > PHYSICAL_MAX;
  }

  /**
   * 清洗管线（全部从原始记录重算，无预设结果）：
   * 1) 按站点+整点时间归组；2) 物理区间外记录记为异常并剔除；
   * 3) 同槽位多条有效记录取算术平均作为去重值；
   * 4) 无有效记录的理论槽位记为缺失。
   */
  function clean(raw) {
    var groups = new Map();
    var anomalyRecords = 0;
    for (var i = 0; i < raw.length; i++) {
      var r = raw[i];
      var key = slotKey(r.stationId, r.t);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }

    var slots = new Map();
    var duplicateRecords = 0;
    var validSlots = 0;

    groups.forEach(function (list, key) {
      var valid = [];
      var anomalies = 0;
      for (var j = 0; j < list.length; j++) {
        if (isAnomaly(list[j].value)) {
          anomalies++;
          anomalyRecords++;
        } else {
          valid.push(list[j].value);
        }
      }
      duplicateRecords += Math.max(0, list.length - 1);
      if (valid.length === 0) {
        slots.set(key, {
          stationId: list[0].stationId,
          t: list[0].t,
          value: null,
          rawCount: list.length,
          anomalyCount: anomalies,
          duplicateCount: Math.max(0, list.length - 1)
        });
        return;
      }
      var sum = 0;
      for (var k = 0; k < valid.length; k++) sum += valid[k];
      validSlots++;
      slots.set(key, {
        stationId: list[0].stationId,
        t: list[0].t,
        value: round3(sum / valid.length),
        rawCount: list.length,
        anomalyCount: anomalies,
        duplicateCount: Math.max(0, list.length - 1)
      });
    });

    var expectedSlots = STATIONS.length * HOURS;
    var missingSlots = 0;
    for (var s = 0; s < STATIONS.length; s++) {
      for (var h = 0; h < HOURS; h++) {
        var t = hourAt(h);
        var sk = slotKey(STATIONS[s].id, t);
        if (!slots.has(sk)) {
          missingSlots++;
          slots.set(sk, {
            stationId: STATIONS[s].id,
            t: t,
            value: null,
            rawCount: 0,
            anomalyCount: 0,
            duplicateCount: 0
          });
        } else if (slots.get(sk).value === null) {
          missingSlots++;
        }
      }
    }

    return {
      slots: slots,
      quality: {
        expectedSlots: expectedSlots,
        rawRecords: raw.length,
        validSlots: validSlots,
        missingSlots: missingSlots,
        duplicateRecords: duplicateRecords,
        anomalyRecords: anomalyRecords,
        cleanRecords: validSlots
      }
    };
  }

  var WINDOW_PRESETS = [
    { id: 'all', label: '整周 (7×24h)', startHour: 0, endHour: HOURS - 1 },
    { id: 'day1', label: '第 1 天', startHour: 0, endHour: 23 },
    { id: 'day3', label: '第 3 天', startHour: 48, endHour: 71 },
    { id: 'weekend', label: '周末 (第 6-7 天)', startHour: 120, endHour: HOURS - 1 }
  ];

  function windowHours(startHour, endHour) {
    var out = [];
    for (var h = startHour; h <= endHour; h++) out.push(h);
    return out;
  }

  /** 窗口内按站点过滤清洗结果；统计口径始终基于清洗后的去重值。 */
  function aggregate(cleanResult, opts) {
    var startHour = opts.startHour;
    var endHour = opts.endHour;
    var stationFilter = opts.stationFilter || STATIONS.map(function (s) { return s.id; });
    var hours = windowHours(startHour, endHour);
    var slots = cleanResult.slots;
    var matrix = [];
    var stationStats = [];
    var q = {
      expectedSlots: 0,
      validSlots: 0,
      missingSlots: 0,
      duplicateRecords: 0,
      anomalyRecords: 0,
      cleanRecords: 0
    };

    for (var si = 0; si < STATIONS.length; si++) {
      var st = STATIONS[si];
      if (stationFilter.indexOf(st.id) === -1) continue;
      var row = { stationId: st.id, stationName: st.name, values: [] };
      var values = [];
      for (var hi = 0; hi < hours.length; hi++) {
        var slot = slots.get(slotKey(st.id, hourAt(hours[hi])));
        q.expectedSlots++;
        if (slot) {
          q.duplicateRecords += slot.duplicateCount;
          q.anomalyRecords += slot.anomalyCount;
        }
        if (slot && slot.value !== null) {
          row.values.push(slot.value);
          values.push(slot.value);
          q.validSlots++;
        } else {
          row.values.push(null);
          q.missingSlots++;
        }
      }
      q.cleanRecords += values.length;
      matrix.push(row);
      var sum = 0, max = -Infinity, min = Infinity;
      for (var v = 0; v < values.length; v++) {
        sum += values[v];
        if (values[v] > max) max = values[v];
        if (values[v] < min) min = values[v];
      }
      stationStats.push({
        stationId: st.id,
        stationName: st.name,
        count: values.length,
        missing: row.values.length - values.length,
        mean: values.length ? round3(sum / values.length) : null,
        max: values.length ? max : null,
        min: values.length ? min : null,
        completeness: row.values.length
          ? Math.round((values.length / row.values.length) * 1000) / 10
          : 0
      });
    }

    return {
      hours: hours,
      matrix: matrix,
      stationStats: stationStats,
      windowQuality: q,
      globalQuality: cleanResult.quality
    };
  }

  function round2(x) {
    return x === null || x === undefined ? null : Math.round(x * 100) / 100;
  }

  /** 界面与 PNG 共用的数值格式，保证导出数值与屏幕一致。 */
  function formatValue(x) {
    if (x === null || x === undefined || isNaN(x)) return '—';
    return round2(x).toFixed(2);
  }

  function pad2(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  function formatTime(t) {
    var d = new Date(t);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
      + ' ' + pad2(d.getHours()) + ':00';
  }

  function formatHour(hourIndex) {
    return formatTime(hourAt(hourIndex));
  }

  return {
    HOURS: HOURS,
    START_ISO: START_ISO,
    START_MS: START_MS,
    HOUR_MS: HOUR_MS,
    DATA_VERSION: DATA_VERSION,
    GENERATED_AT: GENERATED_AT,
    PHYSICAL_MIN: PHYSICAL_MIN,
    PHYSICAL_MAX: PHYSICAL_MAX,
    COLOR_MIN: COLOR_MIN,
    COLOR_MAX: COLOR_MAX,
    STATIONS: STATIONS,
    WINDOW_PRESETS: WINDOW_PRESETS,
    mulberry32: mulberry32,
    tideValue: tideValue,
    hourAt: hourAt,
    hourIndexOf: hourIndexOf,
    buildDatasets: buildDatasets,
    isAnomaly: isAnomaly,
    clean: clean,
    aggregate: aggregate,
    round2: round2,
    round3: round3,
    formatValue: formatValue,
    formatTime: formatTime,
    formatHour: formatHour
  };
});
