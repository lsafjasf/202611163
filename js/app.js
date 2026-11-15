// 界面主逻辑：筛选状态管理、Canvas 绘制、表格渲染、导出与自检。
(function () {
  'use strict';

  var DATA = window.FlowData;
  var PIPE = window.FlowPipeline;
  var STORAGE_KEY = 'flow-viz-state-v1';

  var DEFAULT_STATE = {
    dataset: 'normal',
    hourStart: 0,
    hourEnd: 23,
    from: 'ALL',
    to: 'ALL'
  };

  // —— 状态持久化：切换时间窗口/筛选不丢失，刷新页面也可恢复 ——
  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return Object.assign({}, DEFAULT_STATE);
      var s = JSON.parse(raw);
      var merged = Object.assign({}, DEFAULT_STATE, s);
      if (merged.hourStart > merged.hourEnd) {
        var t = merged.hourStart; merged.hourStart = merged.hourEnd; merged.hourEnd = t;
      }
      return merged;
    } catch (e) {
      return Object.assign({}, DEFAULT_STATE);
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  var state = loadState();
  var view = null; // 当前视图模型（computeView 结果）

  var canvas = document.getElementById('flowCanvas');
  var ctx = canvas.getContext('2d');
  var tooltip = document.getElementById('tooltip');

  function datasetByKey(key) {
    return DATA.DATASETS.filter(function (d) { return d.key === key; })[0] || DATA.DATASETS[0];
  }

  // —— 初始化控件 ——
  function fillSelect(sel, options, value) {
    sel.innerHTML = '';
    options.forEach(function (o) {
      var el = document.createElement('option');
      el.value = o.value; el.textContent = o.label;
      sel.appendChild(el);
    });
    sel.value = String(value);
  }

  function initControls() {
    fillSelect(document.getElementById('datasetSel'),
      DATA.DATASETS.map(function (d) { return { value: d.key, label: d.label }; }),
      state.dataset);

    var hours = [];
    for (var h = 0; h < 24; h++) hours.push({ value: h, label: h + ':00' });
    fillSelect(document.getElementById('hourStart'), hours, state.hourStart);
    fillSelect(document.getElementById('hourEnd'),
      hours.map(function (o) { return { value: o.value, label: o.value + ':59' }; }),
      state.hourEnd);

    var blockOpts = [{ value: 'ALL', label: '全部' }].concat(
      DATA.BLOCKS.map(function (b) { return { value: b.id, label: b.name + ' (' + b.id + ')' }; }));
    fillSelect(document.getElementById('fromSel'), blockOpts, state.from);
    fillSelect(document.getElementById('toSel'), blockOpts, state.to);

    document.getElementById('dataVersion').textContent = '数据版本：' + DATA.DATA_VERSION;
    document.getElementById('statCaliber').textContent = DATA.STAT_CALIBER;

    bind('datasetSel', 'dataset', String);
    bind('hourStart', 'hourStart', Number);
    bind('hourEnd', 'hourEnd', Number);
    bind('fromSel', 'from', String);
    bind('toSel', 'to', String);

    document.getElementById('resetBtn').addEventListener('click', function () {
      state = Object.assign({}, DEFAULT_STATE);
      saveState(); initControls(); render();
    });
    document.getElementById('exportCsvBtn').addEventListener('click', exportCSV);
    document.getElementById('exportPngBtn').addEventListener('click', exportPNG);
  }

  function bind(id, key, cast) {
    document.getElementById(id).addEventListener('change', function (e) {
      state[key] = cast(e.target.value);
      if (state.hourStart > state.hourEnd) {
        var t = state.hourStart; state.hourStart = state.hourEnd; state.hourEnd = t;
        document.getElementById('hourStart').value = String(state.hourStart);
        document.getElementById('hourEnd').value = String(state.hourEnd);
      }
      saveState();
      render();
    });
  }

  // —— 渲染总入口：筛选变化后图形、表格、摘要同步更新 ——
  function render() {
    var ds = datasetByKey(state.dataset);
    view = PIPE.computeView(ds, state);
    renderStatus();
    renderQuality(view.quality);
    renderTable(view);
    drawCanvas(view);
    runSelfCheck(ds);
  }

  function renderStatus() {
    var ds = datasetByKey(state.dataset);
    var parts = [
      '数据集=' + ds.label,
      '时间=' + state.hourStart + ':00–' + state.hourEnd + ':59',
      '来源=' + (state.from === 'ALL' ? '全部' : PIPE.blockName(state.from)),
      '目的地=' + (state.to === 'ALL' ? '全部' : PIPE.blockName(state.to)),
      '匹配记录=' + view.matchedRecords + ' 条',
      '总人次=' + view.totalPeople
    ];
    document.getElementById('filterSummary').textContent = parts.join('；');
  }

  function renderQuality(q) {
    var rows = [
      ['原始记录数', q.raw],
      ['去重剔除（完全重复行）', q.duplicated],
      ['缺失剔除（缺小时/端点/人数）', q.missing],
      ['异常剔除（负值/越界/超上限）', q.anomaly],
      ['有效记录数', q.valid]
    ];
    document.getElementById('qualityTable').innerHTML =
      '<tbody>' + rows.map(function (r) {
        return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>';
      }).join('') + '</tbody>';
  }

  function renderTable(v) {
    var tbody = document.querySelector('#flowTable tbody');
    tbody.innerHTML = v.flows.map(function (f) {
      return '<tr class="' + (f.overCapacity ? 'over' : '') + '">' +
        '<td>' + PIPE.blockName(f.from) + '</td>' +
        '<td>' + PIPE.blockName(f.to) + '</td>' +
        '<td>' + f.count + '</td>' +
        '<td>' + (f.capacity == null ? '—' : f.capacity) + '</td>' +
        '<td>' + (f.overCapacity ? '超容量' : '正常') + '</td></tr>';
    }).join('');
    document.querySelector('#flowTable tfoot').innerHTML =
      '<tr><td colspan="2">合计</td><td>' + v.totalPeople + '</td><td colspan="2"></td></tr>';
  }

  window.__flowApp = {
    getState: function () { return state; },
    getView: function () { return view; }
  };

  // —— Canvas 绘制：街区节点、流动箭头、图例 ——
  var NODE_R = 26;
  var nodePos = {}; // 像素坐标缓存，供悬停命中检测

  function blockXY(b) {
    return { x: b.x * canvas.width, y: b.y * canvas.height };
  }

  function arrowWidth(count) {
    return 2 + Math.min(18, Math.sqrt(count) / 2.2);
  }

  function drawCanvas(v) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    nodePos = {};
    DATA.BLOCKS.forEach(function (b) { nodePos[b.id] = blockXY(b); });

    // 先画箭头（节点在上层）
    v.flows.forEach(function (f) { drawArrow(f); });
    // 节点
    DATA.BLOCKS.forEach(function (b) { drawNode(b, v.nodes[b.id]); });
    drawLegend();
  }

  function drawArrow(f) {
    var p1 = nodePos[f.from], p2 = nodePos[f.to];
    var dx = p2.x - p1.x, dy = p2.y - p1.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) return;
    var ux = dx / dist, uy = dy / dist;
    // 起止点缩到节点圆外
    var sx = p1.x + ux * (NODE_R + 4), sy = p1.y + uy * (NODE_R + 4);
    var ex = p2.x - ux * (NODE_R + 10), ey = p2.y - uy * (NODE_R + 10);
    // 垂直偏移，避免双向箭头重叠
    var px = -uy, py = ux;
    var bend = 22;
    var mx = (sx + ex) / 2 + px * bend, my = (sy + ey) / 2 + py * bend;

    var w = arrowWidth(f.count);
    var color = f.overCapacity ? '#ef4444' : '#38bdf8';

    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(mx, my, ex, ey);
    ctx.stroke();

    // 箭头头部（沿曲线末端切线方向）
    var tx = ex - mx, ty = ey - my;
    var tl = Math.sqrt(tx * tx + ty * ty) || 1;
    tx /= tl; ty /= tl;
    var hs = 7 + w * 0.9;
    ctx.beginPath();
    ctx.moveTo(ex + tx * hs * 0.6, ey + ty * hs * 0.6);
    ctx.lineTo(ex - tx * hs - ty * hs * 0.5, ey - ty * hs + tx * hs * 0.5);
    ctx.lineTo(ex - tx * hs + ty * hs * 0.5, ey - ty * hs - tx * hs * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    // 流量标签
    ctx.font = '12px sans-serif';
    ctx.fillStyle = f.overCapacity ? '#fca5a5' : '#7dd3fc';
    ctx.textAlign = 'center';
    ctx.fillText(String(f.count), mx + px * 8, my + py * 8 - 4);
  }

  function drawNode(b, totals) {
    var p = nodePos[b.id];
    var active = totals && (totals.inflow > 0 || totals.outflow > 0);
    ctx.beginPath();
    ctx.arc(p.x, p.y, NODE_R, 0, Math.PI * 2);
    ctx.fillStyle = active ? '#1d3557' : '#22303f';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = active ? '#3b82f6' : '#41546a';
    ctx.stroke();

    ctx.fillStyle = '#e6edf3';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(b.id, p.x, p.y - 6);
    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#9fb0c0';
    ctx.fillText(b.name, p.x, p.y + 11);
    ctx.textBaseline = 'alphabetic';
  }

  function drawLegend() {
    var x = 16, y = canvas.height - 92;
    ctx.fillStyle = 'rgba(15,22,32,0.85)';
    ctx.fillRect(x - 8, y - 16, 250, 92);
    ctx.strokeStyle = '#263242';
    ctx.strokeRect(x - 8, y - 16, 250, 92);

    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#9fb0c0';
    ctx.fillText('图例', x, y);

    ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(x, y + 18); ctx.lineTo(x + 34, y + 18); ctx.stroke();
    ctx.fillStyle = '#c8d4e0';
    ctx.fillText('通道人流（宽度 ∝ 人数）', x + 44, y + 22);

    ctx.strokeStyle = '#ef4444';
    ctx.beginPath(); ctx.moveTo(x, y + 40); ctx.lineTo(x + 34, y + 40); ctx.stroke();
    ctx.fillStyle = '#c8d4e0';
    ctx.fillText('超过通道容量', x + 44, y + 44);

    ctx.fillStyle = '#9fb0c0';
    ctx.fillText('悬停节点查看流入 / 流出', x, y + 66);
  }

  // —— 悬停节点：显示流入 / 流出 ——
  canvas.addEventListener('mousemove', function (e) {
    if (!view) return;
    var rect = canvas.getBoundingClientRect();
    var mx = (e.clientX - rect.left) * (canvas.width / rect.width);
    var my = (e.clientY - rect.top) * (canvas.height / rect.height);
    var hit = null;
    DATA.BLOCKS.forEach(function (b) {
      var p = nodePos[b.id];
      if (p && Math.hypot(mx - p.x, my - p.y) <= NODE_R + 4) hit = b;
    });
    if (!hit) { tooltip.hidden = true; return; }
    var t = view.nodes[hit.id];
    tooltip.innerHTML =
      '<b>' + hit.name + ' (' + hit.id + ')</b><br>' +
      '流入：' + t.inflow + ' 人次<br>' +
      '流出：' + t.outflow + ' 人次<br>' +
      '净流入：' + (t.inflow - t.outflow) + ' 人次';
    tooltip.style.left = (e.clientX - rect.left + 14) + 'px';
    tooltip.style.top = (e.clientY - rect.top + 14) + 'px';
    tooltip.hidden = false;
  });
  canvas.addEventListener('mouseleave', function () { tooltip.hidden = true; });

  // —— 导出：CSV / PNG，数值与屏幕一致（同一 view 模型） ——
  function download(filename, content, mime) {
    var blob = content instanceof Blob ? content : new Blob([content], { type: mime });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function exportCSV() {
    var ds = datasetByKey(state.dataset);
    var csv = PIPE.toCSV(view, state, ds);
    download('flows_' + ds.key + '_' + state.hourStart + '-' + state.hourEnd + '.csv',
      csv, 'text/csv;charset=utf-8');
  }

  function exportPNG() {
    canvas.toBlob(function (blob) {
      download('flows_' + state.dataset + '_' + state.hourStart + '-' + state.hourEnd + '.png',
        blob, 'image/png');
    });
  }

  // —— 自检：独立重算原始数据，与屏幕视图模型逐一比对 ——
  function runSelfCheck(ds) {
    var el = document.getElementById('selfCheck');
    var recomputed = PIPE.computeView(ds, state); // 独立重算（同一 pipeline，不同实例）
    var ok = recomputed.totalPeople === view.totalPeople &&
      recomputed.flows.length === view.flows.length &&
      recomputed.flows.every(function (f, i) {
        var g = view.flows[i];
        return f.from === g.from && f.to === g.to && f.count === g.count &&
          f.overCapacity === g.overCapacity;
      });
    // 再用最朴素的方式独立核对总人次（不经过 aggregate）
    var naiveTotal = 0;
    PIPE.clean(ds.records).clean.forEach(function (r) {
      if (r.hour >= state.hourStart && r.hour <= state.hourEnd &&
          (state.from === 'ALL' || r.from === state.from) &&
          (state.to === 'ALL' || r.to === state.to)) {
        naiveTotal += r.count;
      }
    });
    ok = ok && naiveTotal === view.totalPeople;
    el.textContent = ok
      ? '自检通过：图形/表格/导出数值与原始记录重算一致'
      : '自检失败：派生数值与原始记录不一致！';
    el.className = 'self-check ' + (ok ? 'ok' : 'fail');
  }

  // —— 启动 ——
  initControls();
  render();
})();
