/**
 * Canvas 渲染模块：热图、折线、剖面三种视图，图例也在 Canvas 内绘制。
 * 同一份 draw() 同时用于屏幕与 PNG 导出，保证导出数值与屏幕一致。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./tide-core.js'));
  } else {
    root.TideChart = factory(root.TideCore);
  }
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  var PALETTE = [
    { t: 0.0, c: [49, 54, 149] },
    { t: 0.25, c: [69, 117, 180] },
    { t: 0.5, c: [171, 217, 233] },
    { t: 0.68, c: [254, 224, 144] },
    { t: 0.85, c: [244, 109, 67] },
    { t: 1.0, c: [165, 0, 38] }
  ];
  var MISSING_COLOR = '#d9d9d9';
  var GRID_COLOR = 'rgba(0,0,0,0.12)';
  var TEXT_COLOR = '#333';
  var FOCUS_COLOR = '#111';

  function lerp(a, b, t) { return a + (b - a) * t; }

  function colorFor(value) {
    if (value === null || value === undefined || isNaN(value)) return MISSING_COLOR;
    var x = (value - C.COLOR_MIN) / (C.COLOR_MAX - C.COLOR_MIN);
    x = Math.max(0, Math.min(1, x));
    for (var i = 0; i < PALETTE.length - 1; i++) {
      var p0 = PALETTE[i], p1 = PALETTE[i + 1];
      if (x >= p0.t && x <= p1.t) {
        var k = (x - p0.t) / (p1.t - p0.t);
        var rgb = p0.c.map(function (v, idx) { return Math.round(lerp(v, p1.c[idx], k)); });
        return 'rgb(' + rgb.join(',') + ')';
      }
    }
    return 'rgb(' + PALETTE[PALETTE.length - 1].c.join(',') + ')';
  }

  function lineColor(index) {
    var hue = (index * 47) % 360;
    return 'hsl(' + hue + ',65%,38%)';
  }

  var layout = {
    marginLeft: 84,
    marginRight: 28,
    marginTop: 44,
    marginBottom: 84,
    legendWidth: 150,
    legendGap: 26
  };

  function plotRect(canvasWidth, canvasHeight) {
    return {
      x: layout.marginLeft,
      y: layout.marginTop,
      w: canvasWidth - layout.marginLeft - layout.marginRight - layout.legendWidth - layout.legendGap,
      h: canvasHeight - layout.marginTop - layout.marginBottom
    };
  }

  function prepareCanvas(canvas, cssWidth, cssHeight) {
    var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    canvas.style.width = cssWidth + 'px';
    canvas.style.height = cssHeight + 'px';
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = '12px sans-serif';
    ctx.textBaseline = 'middle';
    return ctx;
  }

  function clear(ctx, w, h) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
  }

  function drawTitle(ctx, view, agg, state) {
    ctx.fillStyle = TEXT_COLOR;
    ctx.font = 'bold 14px sans-serif';
    var name = view === 'heatmap' ? '逐小时站点潮位热图'
      : view === 'line' ? '多站点潮位过程线' : '单时刻站点潮位剖面';
    ctx.fillText(name, layout.marginLeft, 22);
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#666';
    ctx.fillText(
      '窗口 ' + C.formatHour(agg.hours[0]) + ' — ' + C.formatHour(agg.hours[agg.hours.length - 1])
      + ' ｜ 焦点 ' + focusName(agg, state.focusStationId),
      layout.marginLeft + 260, 22
    );
  }

  function focusName(agg, focusId) {
    var row = agg.matrix.filter(function (r) { return r.stationId === focusId; })[0];
    return row ? row.stationId + ' ' + row.stationName : '（已被筛选移除）';
  }

  function axisLabelEvery(n) {
    if (n <= 12) return 1;
    if (n <= 48) return 6;
    return 12;
  }

  function drawAxes(ctx, rect, agg) {
    ctx.strokeStyle = GRID_COLOR;
    ctx.fillStyle = TEXT_COLOR;
    ctx.lineWidth = 1;
    var every = axisLabelEvery(agg.hours.length);
    ctx.textAlign = 'center';
    agg.hours.forEach(function (h, i) {
      if (i % every !== 0) return;
      var x = rect.x + (i + 0.5) * (rect.w / agg.hours.length);
      ctx.strokeStyle = GRID_COLOR;
      ctx.beginPath();
      ctx.moveTo(x, rect.y + rect.h);
      ctx.lineTo(x, rect.y + rect.h + 4);
      ctx.stroke();
      var d = new Date(C.hourAt(h));
      ctx.save();
      ctx.translate(x, rect.y + rect.h + 18);
      ctx.rotate(-Math.PI / 4);
      ctx.textAlign = 'right';
      ctx.fillText((d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours() + ':00', 0, 0);
      ctx.restore();
    });
    ctx.textAlign = 'right';
    agg.matrix.forEach(function (row, ri) {
      var y = rect.y + (ri + 0.5) * (rect.h / agg.matrix.length);
      ctx.fillText(row.stationId + ' ' + row.stationName, rect.x - 8, y);
    });
  }

  function drawHeatLegend(ctx, rect) {
    var lx = rect.x + rect.w + layout.legendGap;
    var ly = rect.y;
    var lh = rect.h;
    var lw = 16;
    var steps = 40;
    for (var i = 0; i < steps; i++) {
      var v = C.COLOR_MAX - (i / (steps - 1)) * (C.COLOR_MAX - C.COLOR_MIN);
      ctx.fillStyle = colorFor(v);
      ctx.fillRect(lx, ly + (i * lh) / steps, lw, lh / steps + 1);
    }
    ctx.strokeStyle = '#999';
    ctx.strokeRect(lx, ly, lw, lh);
    ctx.fillStyle = TEXT_COLOR;
    ctx.textAlign = 'left';
    [0, 0.25, 0.5, 0.75, 1].forEach(function (t) {
      var val = C.COLOR_MAX - t * (C.COLOR_MAX - C.COLOR_MIN);
      var y = ly + t * lh;
      ctx.fillText(C.formatValue(val), lx + lw + 6, y);
    });
    ctx.fillStyle = MISSING_COLOR;
    ctx.fillRect(lx, ly + lh + 14, lw, 14);
    ctx.strokeStyle = '#999';
    ctx.strokeRect(lx, ly + lh + 14, lw, 14);
    ctx.fillStyle = TEXT_COLOR;
    ctx.fillText('缺失', lx + lw + 6, ly + lh + 21);
    ctx.save();
    ctx.translate(lx + lw + 46, ly + lh / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('潮高 (m)', 0, 0);
    ctx.restore();
  }

  function renderHeatmap(ctx, w, h, agg, state) {
    var rect = plotRect(w, h);
    var cw = rect.w / agg.hours.length;
    var rh = rect.h / agg.matrix.length;
    agg.matrix.forEach(function (row, ri) {
      var isFocus = row.stationId === state.focusStationId;
      row.values.forEach(function (v, ci) {
        var x = rect.x + ci * cw;
        var y = rect.y + ri * rh;
        ctx.fillStyle = colorFor(v);
        ctx.fillRect(x, y, Math.ceil(cw), Math.ceil(rh));
        if (v === null) {
          ctx.strokeStyle = 'rgba(0,0,0,0.18)';
          ctx.beginPath();
          ctx.moveTo(x + 2, y + 2);
          ctx.lineTo(x + cw - 2, y + rh - 2);
          ctx.stroke();
        }
      });
      if (isFocus) {
        ctx.strokeStyle = FOCUS_COLOR;
        ctx.lineWidth = 2;
        ctx.strokeRect(rect.x + 1, rect.y + ri * rh + 1, rect.w - 2, rh - 2);
        ctx.lineWidth = 1;
      }
    });
    ctx.strokeStyle = '#555';
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    drawAxes(ctx, rect, agg);
    drawHeatLegend(ctx, rect);
  }

  function hitHeatmap(mx, my, w, h, agg) {
    var rect = plotRect(w, h);
    if (mx < rect.x || mx > rect.x + rect.w || my < rect.y || my > rect.y + rect.h) return null;
    var ci = Math.floor((mx - rect.x) / (rect.w / agg.hours.length));
    var ri = Math.floor((my - rect.y) / (rect.h / agg.matrix.length));
    if (ri < 0 || ri >= agg.matrix.length || ci < 0 || ci >= agg.hours.length) return null;
    var row = agg.matrix[ri];
    return {
      stationId: row.stationId,
      stationName: row.stationName,
      hour: agg.hours[ci],
      value: row.values[ci]
    };
  }

  function valueRange(agg) {
    var lo = Infinity, hi = -Infinity;
    agg.matrix.forEach(function (row) {
      row.values.forEach(function (v) {
        if (v === null) return;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      });
    });
    if (!isFinite(lo)) { lo = C.COLOR_MIN; hi = C.COLOR_MAX; }
    var pad = Math.max(0.2, (hi - lo) * 0.08);
    return { lo: Math.floor((lo - pad) * 10) / 10, hi: Math.ceil((hi + pad) * 10) / 10 };
  }

  function drawValueAxis(ctx, rect, range) {
    var ticks = 5;
    ctx.textAlign = 'right';
    ctx.fillStyle = TEXT_COLOR;
    for (var i = 0; i <= ticks; i++) {
      var v = range.lo + (i / ticks) * (range.hi - range.lo);
      var y = rect.y + rect.h - (i / ticks) * rect.h;
      ctx.strokeStyle = GRID_COLOR;
      ctx.beginPath();
      ctx.moveTo(rect.x, y);
      ctx.lineTo(rect.x + rect.w, y);
      ctx.stroke();
      ctx.fillText(v.toFixed(1), rect.x - 8, y);
    }
    ctx.save();
    ctx.translate(20, rect.y + rect.h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('潮高 (m)', 0, 0);
    ctx.restore();
  }

  function drawTimeAxis(ctx, rect, agg) {
    var every = axisLabelEvery(agg.hours.length);
    ctx.textAlign = 'center';
    agg.hours.forEach(function (hr, i) {
      if (i % every !== 0) return;
      var x = rect.x + (i + 0.5) * (rect.w / agg.hours.length);
      var d = new Date(C.hourAt(hr));
      ctx.save();
      ctx.translate(x, rect.y + rect.h + 16);
      ctx.rotate(-Math.PI / 4);
      ctx.textAlign = 'right';
      ctx.fillStyle = TEXT_COLOR;
      ctx.fillText((d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours() + ':00', 0, 0);
      ctx.restore();
    });
  }

  function drawLineLegend(ctx, rect, agg, state) {
    var lx = rect.x + rect.w + layout.legendGap;
    var ly = rect.y;
    ctx.textAlign = 'left';
    agg.matrix.forEach(function (row, i) {
      var y = ly + i * 22;
      var col = lineColor(i);
      var focused = row.stationId === state.focusStationId;
      ctx.strokeStyle = col;
      ctx.lineWidth = focused ? 3 : 1.5;
      ctx.beginPath();
      ctx.moveTo(lx, y);
      ctx.lineTo(lx + 22, y);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.fillStyle = focused ? FOCUS_COLOR : TEXT_COLOR;
      ctx.font = focused ? 'bold 12px sans-serif' : '12px sans-serif';
      ctx.fillText(row.stationId + ' ' + row.stationName, lx + 28, y);
      ctx.font = '12px sans-serif';
    });
  }

  function renderLine(ctx, w, h, agg, state) {
    var rect = plotRect(w, h);
    var range = valueRange(agg);
    drawValueAxis(ctx, rect, range);
    drawTimeAxis(ctx, rect, agg);
    var n = agg.hours.length;
    function xAt(i) { return rect.x + (i + 0.5) * (rect.w / n); }
    function yAt(v) {
      return rect.y + rect.h - ((v - range.lo) / (range.hi - range.lo)) * rect.h;
    }
    agg.matrix.forEach(function (row, ri) {
      var focused = row.stationId === state.focusStationId;
      ctx.strokeStyle = lineColor(ri);
      ctx.lineWidth = focused ? 2.6 : 1.2;
      ctx.globalAlpha = focused ? 1 : 0.75;
      ctx.beginPath();
      var pen = false;
      row.values.forEach(function (v, i) {
        if (v === null) { pen = false; return; }
        var x = xAt(i), y = yAt(v);
        if (!pen) { ctx.moveTo(x, y); pen = true; } else { ctx.lineTo(x, y); }
      });
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1;
    });
    ctx.strokeStyle = '#555';
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    drawLineLegend(ctx, rect, agg, state);
  }

  function hitLine(mx, my, w, h, agg) {
    var rect = plotRect(w, h);
    if (mx < rect.x || mx > rect.x + rect.w || my < rect.y || my > rect.y + rect.h) return null;
    var range = valueRange(agg);
    var n = agg.hours.length;
    var best = null, bestDist = Infinity;
    agg.matrix.forEach(function (row) {
      row.values.forEach(function (v, i) {
        if (v === null) return;
        var px = rect.x + (i + 0.5) * (rect.w / n);
        var py = rect.y + rect.h - ((v - range.lo) / (range.hi - range.lo)) * rect.h;
        var d = Math.hypot(px - mx, py - my);
        if (d < bestDist) {
          bestDist = d;
          best = { stationId: row.stationId, stationName: row.stationName, hour: agg.hours[i], value: v };
        }
      });
    });
    return bestDist <= 24 ? best : null;
  }

  function resolveProfileHour(agg, state) {
    if (typeof state.profileHour === 'number' && agg.hours.indexOf(state.profileHour) !== -1) {
      return state.profileHour;
    }
    return agg.hours[Math.floor(agg.hours.length / 2)];
  }

  function renderProfile(ctx, w, h, agg, state) {
    var rect = plotRect(w, h);
    var range = valueRange(agg);
    var hour = resolveProfileHour(agg, state);
    var hi = agg.hours.indexOf(hour);
    drawValueAxis(ctx, rect, range);
    var step = rect.w / agg.matrix.length;
    var pts = agg.matrix.map(function (row, i) {
      return {
        stationId: row.stationId,
        stationName: row.stationName,
        value: row.values[hi],
        x: rect.x + (i + 0.5) * step
      };
    });
    function yAt(v) {
      return rect.y + rect.h - ((v - range.lo) / (range.hi - range.lo)) * rect.h;
    }
    ctx.strokeStyle = 'hsl(210,65%,38%)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    var pen = false;
    pts.forEach(function (p) {
      if (p.value === null) { pen = false; return; }
      var y = yAt(p.value);
      if (!pen) { ctx.moveTo(p.x, y); pen = true; } else { ctx.lineTo(p.x, y); }
    });
    ctx.stroke();
    pts.forEach(function (p) {
      var focused = p.stationId === state.focusStationId;
      if (p.value === null) {
        ctx.fillStyle = MISSING_COLOR;
        ctx.fillRect(p.x - 5, rect.y + rect.h - 5, 10, 10);
      } else {
        ctx.fillStyle = focused ? FOCUS_COLOR : 'hsl(210,65%,38%)';
        ctx.beginPath();
        ctx.arc(p.x, yAt(p.value), focused ? 6 : 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = TEXT_COLOR;
        ctx.textAlign = 'center';
        ctx.fillText(C.formatValue(p.value), p.x, yAt(p.value) - 10);
      }
      ctx.fillStyle = focused ? FOCUS_COLOR : TEXT_COLOR;
      ctx.font = focused ? 'bold 12px sans-serif' : '12px sans-serif';
      ctx.textAlign = 'right';
      ctx.save();
      ctx.translate(p.x, rect.y + rect.h + 16);
      ctx.rotate(-Math.PI / 4);
      ctx.fillText(p.stationId, 0, 0);
      ctx.restore();
      ctx.font = '12px sans-serif';
    });
    ctx.strokeStyle = '#555';
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    ctx.fillStyle = TEXT_COLOR;
    ctx.textAlign = 'left';
    ctx.font = '12px sans-serif';
    ctx.fillText('剖面时刻：' + C.formatHour(hour) + '（在图上点击可切换整点时刻）',
      rect.x, rect.y + rect.h + 46);
    drawProfileLegend(ctx, rect, agg);
  }

  function drawProfileLegend(ctx, rect, agg) {
    var lx = rect.x + rect.w + layout.legendGap;
    var ly = rect.y;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'hsl(210,65%,38%)';
    ctx.beginPath();
    ctx.arc(lx + 8, ly + 6, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = TEXT_COLOR;
    ctx.fillText('站点潮位', lx + 18, ly + 6);
    ctx.fillStyle = MISSING_COLOR;
    ctx.fillRect(lx, ly + 22, 14, 14);
    ctx.strokeStyle = '#999';
    ctx.strokeRect(lx, ly + 22, 14, 14);
    ctx.fillStyle = TEXT_COLOR;
    ctx.fillText('该时刻缺失', lx + 20, ly + 29);
  }

  function hitProfile(mx, my, w, h, agg, state) {
    var rect = plotRect(w, h);
    if (mx < rect.x || mx > rect.x + rect.w || my < rect.y || my > rect.y + rect.h) return null;
    var hour = resolveProfileHour(agg, state);
    var hi = agg.hours.indexOf(hour);
    var step = rect.w / agg.matrix.length;
    var i = Math.floor((mx - rect.x) / step);
    if (i < 0 || i >= agg.matrix.length) return null;
    var row = agg.matrix[i];
    return {
      stationId: row.stationId,
      stationName: row.stationName,
      hour: hour,
      value: row.values[hi],
      hourIndex: i
    };
  }

  function draw(canvas, agg, state, sizeOverride) {
    var cssW = sizeOverride ? sizeOverride.width : 980;
    var cssH = sizeOverride ? sizeOverride.height : 520;
    var ctx = prepareCanvas(canvas, cssW, cssH);
    clear(ctx, cssW, cssH);
    drawTitle(ctx, state.view, agg, state);
    if (state.view === 'heatmap') renderHeatmap(ctx, cssW, cssH, agg, state);
    else if (state.view === 'line') renderLine(ctx, cssW, cssH, agg, state);
    else renderProfile(ctx, cssW, cssH, agg, state);
    return { width: cssW, height: cssH };
  }

  function hitTest(view, mx, my, size, agg, state) {
    if (view === 'heatmap') return hitHeatmap(mx, my, size.width, size.height, agg);
    if (view === 'line') return hitLine(mx, my, size.width, size.height, agg);
    return hitProfile(mx, my, size.width, size.height, agg, state);
  }

  return {
    layout: layout,
    colorFor: colorFor,
    lineColor: lineColor,
    prepareCanvas: prepareCanvas,
    plotRect: plotRect,
    clear: clear,
    drawTitle: drawTitle,
    draw: draw,
    hitTest: hitTest,
    resolveProfileHour: resolveProfileHour
  };
});
