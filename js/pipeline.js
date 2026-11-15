// 数据 pipeline：清洗（去重/缺失/异常）→ 过滤 → 聚合 → 质量摘要 → CSV。
// 纯函数实现，浏览器与 Node 通用，保证界面、表格、导出同源同数。
(function (root) {
  'use strict';

  var DATA = (typeof module !== 'undefined' && module.exports)
    ? require('./data.js')
    : root.FlowData;

  function isValidBlock(id) {
    return DATA.BLOCKS.some(function (b) { return b.id === id; });
  }

  // 清洗：返回 { clean, quality }
  // quality: { raw, duplicated, missing, anomaly, valid }
  function clean(records) {
    var seen = Object.create(null);
    var cleanRows = [];
    var duplicated = 0, missing = 0, anomaly = 0;

    records.forEach(function (r) {
      // 缺失：关键字段为空
      if (r.hour == null || r.from == null || r.to == null || r.count == null ||
          r.hour === '' || r.from === '' || r.to === '' || r.count === '') {
        missing++; return;
      }
      // 异常：小时越界、端点非法、人数非有限数、负值或超上限
      var hour = Number(r.hour), count = Number(r.count);
      if (!Number.isInteger(hour) || hour < 0 || hour > 23 ||
          !isValidBlock(r.from) || !isValidBlock(r.to) || r.from === r.to ||
          !isFinite(count) || count < 0 || count > DATA.MAX_PLAUSIBLE_COUNT) {
        anomaly++; return;
      }
      // 去重：(hour,from,to,count) 完全相同的行只保留第一条
      var key = hour + '|' + r.from + '|' + r.to + '|' + count;
      if (seen[key]) { duplicated++; return; }
      seen[key] = true;
      cleanRows.push({ id: r.id, hour: hour, from: r.from, to: r.to, count: count });
    });

    return {
      clean: cleanRows,
      quality: {
        raw: records.length,
        duplicated: duplicated,
        missing: missing,
        anomaly: anomaly,
        valid: cleanRows.length
      }
    };
  }

  // 过滤：state = { hourStart, hourEnd, from, to }，from/to 为 'ALL' 或街区 id
  function filterRows(cleanRows, state) {
    return cleanRows.filter(function (r) {
      if (r.hour < state.hourStart || r.hour > state.hourEnd) return false;
      if (state.from !== 'ALL' && r.from !== state.from) return false;
      if (state.to !== 'ALL' && r.to !== state.to) return false;
      return true;
    });
  }

  // 聚合：按 (from,to) 汇总人次，并附容量与是否超载
  function aggregate(rows) {
    var map = Object.create(null);
    rows.forEach(function (r) {
      var key = r.from + '>' + r.to;
      if (!map[key]) {
        map[key] = {
          from: r.from, to: r.to, count: 0, records: 0,
          capacity: DATA.CAPACITY[key] != null ? DATA.CAPACITY[key] : null
        };
      }
      map[key].count += r.count;
      map[key].records += 1;
    });
    var flows = Object.keys(map).map(function (k) {
      var f = map[k];
      f.overCapacity = f.capacity != null && f.count > f.capacity;
      return f;
    });
    flows.sort(function (a, b) { return b.count - a.count; });
    return flows;
  }

  // 节点流入/流出（供悬停提示与列表）
  function nodeTotals(flows) {
    var totals = {};
    DATA.BLOCKS.forEach(function (b) {
      totals[b.id] = { inflow: 0, outflow: 0 };
    });
    flows.forEach(function (f) {
      totals[f.from].outflow += f.count;
      totals[f.to].inflow += f.count;
    });
    return totals;
  }

  // 一站式计算：原始记录 + 筛选状态 → 视图模型
  function computeView(dataset, state) {
    var cleaned = clean(dataset.records);
    var rows = filterRows(cleaned.clean, state);
    var flows = aggregate(rows);
    return {
      quality: cleaned.quality,
      matchedRecords: rows.length,
      flows: flows,
      nodes: nodeTotals(flows),
      totalPeople: flows.reduce(function (s, f) { return s + f.count; }, 0)
    };
  }

  // CSV 导出（与屏幕表格完全一致的行）
  function blockName(id) {
    var b = DATA.BLOCKS.filter(function (x) { return x.id === id; })[0];
    return b ? b.name : id;
  }

  function toCSV(view, state, dataset) {
    var header = '数据版本,数据集,时间窗口,来源筛选,目的筛选';
    var meta = [
      DATA.DATA_VERSION, dataset.key,
      state.hourStart + ':00-' + state.hourEnd + ':59',
      state.from, state.to
    ].join(',');
    var lines = [header, meta, '', '来源,目的地,人次,容量(人次/小时),是否超容量,记录数'];
    view.flows.forEach(function (f) {
      lines.push([
        blockName(f.from), blockName(f.to), f.count,
        f.capacity == null ? '无' : f.capacity,
        f.overCapacity ? '超容量' : '正常',
        f.records
      ].join(','));
    });
    lines.push('合计,,' + view.totalPeople + ',,,');
    return '﻿' + lines.join('\r\n');
  }

  var api = {
    clean: clean,
    filterRows: filterRows,
    aggregate: aggregate,
    nodeTotals: nodeTotals,
    computeView: computeView,
    toCSV: toCSV,
    blockName: blockName
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FlowPipeline = api;
})(typeof window !== 'undefined' ? window : globalThis);
