/**
 * 界面主控：唯一可信状态在 state 中；任何筛选/窗口/视图变化都走
 * recompute() -> renderAll() 单通道，图形、表格、摘要与导出同源刷新。
 */
(function () {
  'use strict';
  var C = window.TideCore;
  var T = window.TideChart;
  var STORAGE_KEY = 'tide-dashboard-state-v1';

  var datasets = C.buildDatasets();
  var cleanedCache = {};
  var canvas = document.getElementById('tide-canvas');
  var tooltip = document.getElementById('tooltip');
  var lastSize = { width: 980, height: 520 };

  var state = loadState() || {
    datasetId: 'normal',
    view: 'heatmap',
    windowId: 'all',
    startHour: 0,
    endHour: C.HOURS - 1,
    focusStationId: 'S01',
    stationFilter: C.STATIONS.map(function (s) { return s.id; }),
    profileHour: null
  };

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* 无存储时静默 */ }
  }

  function getCleaned(id) {
    if (!cleanedCache[id]) cleanedCache[id] = C.clean(datasets[id].raw);
    return cleanedCache[id];
  }

  /** 每次交互都重算；界面从不缓存派生统计。 */
  function recompute() {
    var cleaned = getCleaned(state.datasetId);
    var filter = state.stationFilter.length ? state.stationFilter : C.STATIONS.map(function (s) { return s.id; });
    var agg = C.aggregate(cleaned, {
      startHour: state.startHour,
      endHour: state.endHour,
      stationFilter: filter
    });
    return { cleaned: cleaned, agg: agg, filter: filter };
  }

  function el(id) { return document.getElementById(id); }

  function initControls() {
    var ds = el('dataset-select');
    Object.keys(datasets).forEach(function (key) {
      var opt = document.createElement('option');
      opt.value = key;
      opt.textContent = datasets[key].label + '（' + key + '）';
      ds.appendChild(opt);
    });
    ds.value = state.datasetId;
    ds.addEventListener('change', function () {
      state.datasetId = ds.value;
      persist();
      renderAll();
    });

    var ws = el('window-select');
    C.WINDOW_PRESETS.forEach(function (p) {
      var opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.label;
      ws.appendChild(opt);
    });
    ws.value = state.windowId;
    ws.addEventListener('change', function () {
      var preset = C.WINDOW_PRESETS.filter(function (p) { return p.id === ws.value; })[0];
      state.windowId = preset.id;
      state.startHour = preset.startHour;
      state.endHour = preset.endHour;
      state.profileHour = null;
      persist();
      renderAll();
    });

    el('view-switch').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-view]');
      if (!btn) return;
      state.view = btn.getAttribute('data-view');
      persist();
      renderAll();
    });

    var fs = el('focus-select');
    C.STATIONS.forEach(function (s) {
      var opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.id + ' ' + s.name;
      fs.appendChild(opt);
    });
    fs.value = state.focusStationId;
    fs.addEventListener('change', function () {
      state.focusStationId = fs.value;
      persist();
      renderAll();
    });

    var chips = el('station-filter');
    C.STATIONS.forEach(function (s) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.dataset.station = s.id;
      chip.textContent = s.id + ' ' + s.name;
      chip.addEventListener('click', function () {
        var idx = state.stationFilter.indexOf(s.id);
        if (idx === -1) state.stationFilter.push(s.id);
        else if (state.stationFilter.length > 1) state.stationFilter.splice(idx, 1);
        persist();
        renderAll();
      });
      chips.appendChild(chip);
    });

    el('export-png').addEventListener('click', exportPng);
    el('run-selftest').addEventListener('click', runSelfTest);
  }

  function renderMetaBar() {
    var ds = datasets[state.datasetId];
    el('meta-bar').innerHTML =
      '<span>数据版本：<b>' + ds.version + '</b></span>'
      + '<span>生成时间：<b>' + ds.generatedAt + '</b></span>'
      + '<span>生成种子：<b>' + ds.seed + '</b>（确定性可复算）</span>'
      + '<span>统计口径：<b>整点槽位去重均值，异常剔除，单位 m</b></span>';
  }

  function renderFilterSummary(agg) {
    var preset = C.WINDOW_PRESETS.filter(function (p) { return p.id === state.windowId; })[0];
    var ds = datasets[state.datasetId];
    var names = state.stationFilter.map(function (id) {
      return C.STATIONS.filter(function (s) { return s.id === id; })[0].name;
    }).join('、');
    el('filter-summary').innerHTML =
      '当前筛选：数据集 <code>' + ds.label + '</code> ｜ 视图 <code>' + state.view + '</code>'
      + ' ｜ 时间窗口 <code>' + preset.label + '</code>（'
      + C.formatHour(state.startHour) + ' 至 ' + C.formatHour(state.endHour) + '，共 '
      + agg.hours.length + ' 个整点）｜ 站点 <code>' + names + '</code>（'
      + state.stationFilter.length + '/' + C.STATIONS.length + '）｜ 焦点站点 <code>'
      + state.focusStationId + '</code>。窗口内槽位 ' + agg.windowQuality.expectedSlots
      + ' 个，有效 ' + agg.windowQuality.validSlots + '，缺失 ' + agg.windowQuality.missingSlots + '。';
  }

  function qualityCard(num, label, warn) {
    return '<div class="quality-card' + (warn ? ' warn' : '') + '">'
      + '<div class="num">' + num + '</div><div class="lbl">' + label + '</div></div>';
  }

  function renderQuality(cleaned) {
    var q = cleaned.quality;
    el('quality-summary').innerHTML =
      qualityCard(q.rawRecords, '原始记录数')
      + qualityCard(q.duplicateRecords, '去重移除的重复上报', q.duplicateRecords > 0)
      + qualityCard(q.missingSlots, '缺失整点槽位', q.missingSlots > 0)
      + qualityCard(q.anomalyRecords, '物理区间外异常记录', q.anomalyRecords > 0)
      + qualityCard(q.validSlots, '清洗后有效槽位')
      + qualityCard(q.expectedSlots, '理论槽位（8×168）');
  }

  function renderStationTable(agg) {
    var tbody = el('station-table').querySelector('tbody');
    tbody.innerHTML = agg.stationStats.map(function (s) {
      var focus = s.stationId === state.focusStationId ? ' class="focus-row"' : '';
      return '<tr' + focus + '>'
        + '<td>' + s.stationId + ' ' + s.stationName + '</td>'
        + '<td>' + s.count + '</td>'
        + '<td>' + s.missing + '</td>'
        + '<td>' + C.formatValue(s.mean) + '</td>'
        + '<td>' + C.formatValue(s.max) + '</td>'
        + '<td>' + C.formatValue(s.min) + '</td>'
        + '<td>' + s.completeness.toFixed(1) + '</td></tr>';
    }).join('');
  }

  function renderDetailTable(agg) {
    var tbody = el('detail-table').querySelector('tbody');
    var row = agg.matrix.filter(function (r) { return r.stationId === state.focusStationId; })[0];
    if (!row) {
      tbody.innerHTML = '<tr><td colspan="4">焦点站点已被站点筛选移除，请在上方筛选中重新启用。</td></tr>';
      return;
    }
    tbody.innerHTML = agg.hours.map(function (hour, i) {
      var v = row.values[i];
      var status = v === null ? '缺失（无有效记录）' : '有效（去重值）';
      return '<tr' + (v === null ? ' class="focus-row"' : '') + '>'
        + '<td>' + C.formatHour(hour) + '</td>'
        + '<td>' + row.stationId + ' ' + row.stationName + '</td>'
        + '<td>' + C.formatValue(v) + '</td>'
        + '<td>' + status + '</td></tr>';
    }).join('');
  }

  function renderChart(agg) {
    lastSize = T.draw(canvas, agg, state);
    syncControlState(agg);
  }

  function syncControlState(agg) {
    el('dataset-select').value = state.datasetId;
    el('window-select').value = state.windowId;
    el('focus-select').value = state.focusStationId;
    document.querySelectorAll('#view-switch button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-view') === state.view);
    });
    document.querySelectorAll('#station-filter .chip').forEach(function (chip) {
      var on = state.stationFilter.indexOf(chip.dataset.station) !== -1;
      chip.classList.toggle('off', !on);
    });
    var focusInFilter = agg.matrix.some(function (r) { return r.stationId === state.focusStationId; });
    el('focus-select').classList.toggle('chip-off', !focusInFilter);
  }

  function renderAll() {
    var result = recompute();
    renderMetaBar();
    renderFilterSummary(result.agg);
    renderQuality(result.cleaned);
    renderStationTable(result.agg);
    renderDetailTable(result.agg);
    renderChart(result.agg);
  }

  function canvasPoint(e) {
    var rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function showTooltip(hit, x, y) {
    if (!hit) {
      tooltip.hidden = true;
      return;
    }
    tooltip.innerHTML =
      '时间：' + C.formatHour(hit.hour) + '<br>'
      + '站点：' + hit.stationId + ' ' + hit.stationName + '<br>'
      + '潮高：' + (hit.value === null ? '缺失（无有效记录）' : C.formatValue(hit.value) + ' m');
    tooltip.hidden = false;
    var wrapW = canvas.parentElement.clientWidth;
    var left = x + 14;
    if (left + tooltip.offsetWidth > wrapW) left = x - tooltip.offsetWidth - 14;
    tooltip.style.left = Math.max(4, left) + 'px';
    tooltip.style.top = Math.max(4, y + 14) + 'px';
  }

  function bindCanvas() {
    canvas.addEventListener('mousemove', function (e) {
      var p = canvasPoint(e);
      var agg = recompute().agg;
      var hit = T.hitTest(state.view, p.x, p.y, lastSize, agg, state);
      showTooltip(hit, p.x, p.y);
      canvas.style.cursor = hit ? 'pointer' : 'default';
    });
    canvas.addEventListener('mouseleave', function () { tooltip.hidden = true; });
    canvas.addEventListener('click', function (e) {
      if (state.view !== 'profile') return;
      var p = canvasPoint(e);
      var agg = recompute().agg;
      var hit = T.hitTest('profile', p.x, p.y, lastSize, agg, state);
      if (!hit) return;
      state.profileHour = hit.hour;
      state.focusStationId = hit.stationId;
      el('focus-select').value = hit.stationId;
      persist();
      renderAll();
    });
  }

  /** 导出走与屏幕完全相同的 draw()，仅在离屏画布上重画一遍并附带当前筛选元信息。 */
  function exportPng() {
    var result = recompute();
    var off = document.createElement('canvas');
    var size = T.draw(off, result.agg, state, { width: 980, height: 588 });
    var ctx = off.getContext('2d');
    var ds = datasets[state.datasetId];
    ctx.fillStyle = 'rgba(255,255,255,0.94)';
    ctx.fillRect(8, size.height - 40, size.width - 16, 36);
    ctx.fillStyle = '#333';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('数据版本 ' + ds.version + ' ｜ 数据集 ' + ds.label + ' ｜ 窗口 '
      + C.formatHour(state.startHour) + '—' + C.formatHour(state.endHour)
      + ' ｜ 焦点 ' + state.focusStationId, 14, size.height - 25);
    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#666';
    ctx.fillText('口径：物理区间[-5,8]m 异常剔除；同槽重复取均值；缺失槽位无数值。导出数值与屏幕同源。',
      14, size.height - 9);
    var url = off.toDataURL('image/png');
    var a = document.createElement('a');
    a.href = url;
    a.download = 'tide-' + state.view + '-' + state.datasetId + '-' + state.windowId + '.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  /** 页面内置自检：重算派生值并核对屏幕/导出共用的格式化结果。 */
  function runSelfTest() {
    var out = el('selftest-out');
    out.hidden = false;
    var lines = [];
    function check(name, ok, detail) {
      lines.push((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
    }
    Object.keys(datasets).forEach(function (id) {
      var cleaned = getCleaned(id);
      var q = cleaned.quality;
      check(id + ' 质量守恒', q.validSlots + q.missingSlots === q.expectedSlots,
        '有效 ' + q.validSlots + ' + 缺失 ' + q.missingSlots + ' = ' + q.expectedSlots);
    });
    var result = recompute();
    var agg = result.agg;
    var st0 = agg.stationStats[0];
    var row0 = agg.matrix[0];
    var vals = row0.values.filter(function (v) { return v !== null; });
    var mean = C.round3(vals.reduce(function (a, b) { return a + b; }, 0) / vals.length);
    check('表格均值由原始样例重算', st0 && st0.mean === mean,
      st0 ? st0.stationId + ' mean=' + st0.mean : '无站点');
    var screenText = C.formatValue(st0 ? st0.max : null);
    check('屏幕与导出共用数值格式', screenText === (st0 ? C.round2(st0.max).toFixed(2) : '—'), screenText);
    check('视图状态保留', ['heatmap', 'line', 'profile'].indexOf(state.view) !== -1, state.view);
    check('时间窗口状态保留', state.endHour >= state.startHour,
      state.startHour + '..' + state.endHour);
    out.textContent = lines.join('\n') + '\n\n' + (lines.some(function (l) { return l.indexOf('FAIL') === 0; })
      ? '存在失败项' : '全部通过 ' + lines.length + '/' + lines.length);
  }

  initControls();
  bindCanvas();
  renderAll();
})();
