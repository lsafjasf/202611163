/* 主应用：状态管理、撤销/重做、画布交互、属性面板、保存/载入、导出、关键帧播放。 */
(function () {
  'use strict';

  var M = PosterModel;
  var R = PosterRender;
  var V = PosterValidate;

  var canvas = document.getElementById('poster');
  var ctx = canvas.getContext('2d');
  var measureCtx = document.createElement('canvas').getContext('2d');

  var LS_KEY = 'qr-poster-project';

  var state = {
    project: null,
    selectedId: null,
    history: [],
    historyIndex: -1,
    playing: false,
    playStart: 0,
    boxes: {}
  };

  // ---------- 工具 ----------
  function $(id) { return document.getElementById(id); }

  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  function selected() {
    return state.project.elements.find(function (el) { return el.id === state.selectedId; }) || null;
  }

  function download(filename, blob) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }

  // ---------- 历史（撤销/重做） ----------
  function commit() {
    state.history = state.history.slice(0, state.historyIndex + 1);
    state.history.push(M.serialize(state.project));
    if (state.history.length > 80) state.history.shift();
    state.historyIndex = state.history.length - 1;
    autosave();
    refresh();
  }

  function restore(json) {
    state.project = M.deserialize(json);
    injectFonts();
    if (state.selectedId && !selected()) state.selectedId = null;
    refresh();
  }

  function undo() {
    if (state.historyIndex <= 0) return;
    state.historyIndex--;
    restore(state.history[state.historyIndex]);
  }

  function redo() {
    if (state.historyIndex >= state.history.length - 1) return;
    state.historyIndex++;
    restore(state.history[state.historyIndex]);
  }

  function autosave() {
    try { localStorage.setItem(LS_KEY, M.serialize(state.project)); } catch (e) { /* 存储满时忽略 */ }
  }

  // ---------- 字体 ----------
  function injectFonts() {
    var style = $('projectFonts');
    if (!style) {
      style = document.createElement('style');
      style.id = 'projectFonts';
      document.head.appendChild(style);
    }
    style.textContent = (state.project.fonts || []).map(function (f) {
      return '@font-face{font-family:"' + f.name + '";src:url(' + f.dataUrl + ');}';
    }).join('\n');
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(refresh);
  }

  // ---------- 预览 ----------
  function viewScale() {
    var stage = $('stage');
    var W = state.project.canvas.width, H = state.project.canvas.height;
    return Math.min((stage.clientWidth - 40) / W, (stage.clientHeight - 40) / H, 1.5);
  }

  function redraw(timeSec) {
    var p = state.project;
    var vs = viewScale();
    var dpr = window.devicePixelRatio || 1;
    var W = p.canvas.width, H = p.canvas.height;
    canvas.width = Math.round(W * vs * dpr);
    canvas.height = Math.round(H * vs * dpr);
    canvas.style.width = W * vs + 'px';
    canvas.style.height = H * vs + 'px';
    ctx.setTransform(vs * dpr, 0, 0, vs * dpr, 0, 0);
    R.render(ctx, p, { scale: 1, timeSec: timeSec || 0 });
    drawOverlay();
  }

  function drawOverlay() {
    var p = state.project;
    var W = p.canvas.width, H = p.canvas.height;
    var m = p.canvas.safeMarginRatio * Math.min(W, H);
    ctx.save();
    ctx.setLineDash([8, 6]);
    ctx.strokeStyle = 'rgba(255, 209, 102, 0.8)';
    ctx.lineWidth = 1.5 / (viewScale() || 1);
    ctx.strokeRect(m, m, W - 2 * m, H - 2 * m);
    ctx.setLineDash([]);
    var el = selected();
    if (el && state.boxes[el.id]) {
      var b = state.boxes[el.id];
      ctx.strokeStyle = '#5da9ff';
      ctx.lineWidth = 2 / viewScale();
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      var hs = handleSize();
      ctx.fillStyle = '#5da9ff';
      ctx.fillRect(b.x + b.w - hs / 2, b.y + b.h - hs / 2, hs, hs);
    }
    ctx.restore();
  }

  function handleSize() { return 12 / viewScale(); }

  // ---------- 校验 ----------
  function runValidation(exportScale) {
    state.boxes = R.layoutAll(measureCtx, state.project);
    return V.validate(state.project, state.boxes, { exportScale: exportScale || 1 });
  }

  function renderIssues() {
    var issues = runValidation(1);
    var list = $('issueList');
    list.innerHTML = '';
    $('issueCount').textContent = issues.length ? '(' + issues.length + ')' : '(✓)';
    issues.forEach(function (iss) {
      var li = document.createElement('li');
      li.className = iss.level;
      li.innerHTML = '<strong>' + (iss.level === 'error' ? '错误' : '警告') + '</strong> ' +
        escapeHtml(iss.message) + '<span class="fix">修复建议：' + escapeHtml(iss.fix) + '</span>';
      if (iss.elementId) {
        li.onclick = function () { state.selectedId = iss.elementId; refresh(); };
      }
      list.appendChild(li);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ---------- 全局刷新 ----------
  function refresh() {
    state.boxes = R.layoutAll(measureCtx, state.project);
    redraw(state.playing ? (performance.now() - state.playStart) / 1000 : 0);
    renderIssues();
    renderLayers();
    renderProps();
    renderCanvasProps();
    $('btnUndo').disabled = state.historyIndex <= 0;
    $('btnRedo').disabled = state.historyIndex >= state.history.length - 1;
  }

  // ---------- 图层面板 ----------
  function renderLayers() {
    var list = $('layerList');
    list.innerHTML = '';
    var els = state.project.elements.slice().reverse(); // 顶层在上
    els.forEach(function (el) {
      var li = document.createElement('li');
      li.textContent = el.name;
      li.className = el.id === state.selectedId ? 'selected' : '';
      li.onclick = function () { state.selectedId = el.id; refresh(); };
      list.appendChild(li);
    });
  }

  // ---------- 属性面板辅助 ----------
  function row(labelText, input) {
    var div = document.createElement('div');
    div.className = 'row';
    var label = document.createElement('label');
    label.textContent = labelText;
    div.appendChild(label);
    div.appendChild(input);
    return div;
  }

  function input(type, value, onChange, attrs) {
    var el = document.createElement('input');
    el.type = type;
    if (type === 'checkbox') el.checked = !!value;
    else el.value = value;
    if (attrs) Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    el.addEventListener('change', function () {
      var v = type === 'checkbox' ? el.checked
        : type === 'number' || type === 'range' ? parseFloat(el.value)
        : el.value;
      onChange(v);
      commit();
    });
    return el;
  }

  function selectInput(options, value, onChange) {
    var el = document.createElement('select');
    options.forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      el.appendChild(opt);
    });
    el.value = value;
    el.addEventListener('change', function () { onChange(el.value); commit(); });
    return el;
  }

  // ---------- 画布与背景面板 ----------
  function renderCanvasProps() {
    var p = state.project;
    var box = $('canvasProps');
    box.innerHTML = '';
    var cv = p.canvas, bg = p.background;
    box.appendChild(row('宽度', input('number', cv.width, function (v) { if (v >= 100) cv.width = v; }, { min: 100, max: 4096 })));
    box.appendChild(row('高度', input('number', cv.height, function (v) { if (v >= 100) cv.height = v; }, { min: 100, max: 4096 })));
    box.appendChild(row('安全边距%', input('number', cv.safeMarginRatio * 100, function (v) {
      cv.safeMarginRatio = Math.min(0.2, Math.max(0, v / 100));
    }, { min: 0, max: 20, step: 0.5 })));
    box.appendChild(row('背景色', input('color', bg.color, function (v) { bg.color = v; })));
    box.appendChild(row('纹理', selectInput([
      { value: 'none', label: '无' }, { value: 'dots', label: '圆点' },
      { value: 'grid', label: '网格' }, { value: 'diagonal', label: '斜纹' },
      { value: 'waves', label: '波浪' }
    ], bg.texture, function (v) { bg.texture = v; })));
    box.appendChild(row('纹理色', input('color', bg.textureColor, function (v) { bg.textureColor = v; })));
    box.appendChild(row('纹理强度', input('range', bg.textureOpacity, function (v) { bg.textureOpacity = v; }, { min: 0, max: 0.5, step: 0.01 })));
    box.appendChild(row('纹理间距', input('number', bg.textureSize, function (v) { bg.textureSize = Math.max(4, v); }, { min: 4, max: 200 })));
  }

  // ---------- 元素属性面板 ----------
  var FONT_CHOICES = ['system-ui', 'serif', 'sans-serif', 'monospace', 'PingFang SC', 'Microsoft YaHei', 'SimSun', 'KaiTi'];

  function renderProps() {
    var box = $('props');
    box.innerHTML = '';
    var el = selected();
    if (!el) {
      box.innerHTML = '<p class="hint">点击画布中的元素进行编辑；拖动可移动，拖动右下角手柄可缩放。</p>';
      $('animPanel').hidden = true;
      return;
    }
    box.appendChild(row('名称', input('text', el.name, function (v) { el.name = v; })));
    box.appendChild(row('X', input('number', Math.round(el.x), function (v) { el.x = v; })));
    box.appendChild(row('Y', input('number', Math.round(el.y), function (v) { el.y = v; })));
    box.appendChild(row('旋转°', input('number', el.rotation || 0, function (v) { el.rotation = v; }, { step: 5 })));
    box.appendChild(row('不透明度', input('range', el.opacity === undefined ? 1 : el.opacity, function (v) { el.opacity = v; }, { min: 0, max: 1, step: 0.05 })));

    if (el.type === 'text') textProps(box, el);
    else if (el.type === 'rect' || el.type === 'ellipse') shapeProps(box, el);
    else if (el.type === 'image') imageProps(box, el);
    else if (el.type === 'qr') qrProps(box, el);

    renderAnimPanel(el);
  }

  function textProps(box, el) {
    var ta = document.createElement('textarea');
    ta.value = el.text;
    ta.addEventListener('change', function () { el.text = ta.value; commit(); });
    box.appendChild(row('内容', ta));
    var fonts = FONT_CHOICES.concat((state.project.fonts || []).map(function (f) { return f.name; }));
    box.appendChild(row('字体', selectInput(
      fonts.map(function (f) { return { value: f, label: f }; }),
      el.fontFamily, function (v) { el.fontFamily = v; })));
    var addFont = document.createElement('button');
    addFont.textContent = '导入字体文件…';
    addFont.onclick = function () { $('fileFont').click(); };
    box.appendChild(row('', addFont));
    box.appendChild(row('字号', input('number', el.fontSize, function (v) { el.fontSize = Math.max(6, v); }, { min: 6, max: 500 })));
    box.appendChild(row('颜色', input('color', el.color, function (v) { el.color = v; })));
    box.appendChild(row('对齐', selectInput([
      { value: 'left', label: '左对齐' }, { value: 'center', label: '居中' }, { value: 'right', label: '右对齐' }
    ], el.align, function (v) { el.align = v; })));
    box.appendChild(row('换行宽度', input('number', el.maxWidth, function (v) { el.maxWidth = Math.max(0, v); }, { min: 0, max: 2000, step: 20 })));
    box.appendChild(row('行高', input('number', el.lineHeight, function (v) { el.lineHeight = Math.max(0.8, v); }, { min: 0.8, max: 3, step: 0.1 })));
    box.appendChild(row('加粗', input('checkbox', el.bold, function (v) { el.bold = v; })));
    box.appendChild(row('斜体', input('checkbox', el.italic, function (v) { el.italic = v; })));
  }

  function shapeProps(box, el) {
    box.appendChild(row('宽', input('number', Math.round(el.w), function (v) { el.w = Math.max(4, v); })));
    box.appendChild(row('高', input('number', Math.round(el.h), function (v) { el.h = Math.max(4, v); })));
    box.appendChild(row('填充', input('color', el.fill || '#ffffff', function (v) { el.fill = v; })));
    if (el.type === 'rect') {
      box.appendChild(row('圆角', input('number', el.radius || 0, function (v) { el.radius = Math.max(0, v); })));
    }
    box.appendChild(row('描边色', input('color', el.stroke || '#000000', function (v) { el.stroke = v; })));
    box.appendChild(row('描边宽', input('number', el.strokeWidth || 0, function (v) { el.strokeWidth = Math.max(0, v); })));
  }

  function imageProps(box, el) {
    var btn = document.createElement('button');
    btn.textContent = el.src ? '替换图片…' : '选择图片…';
    btn.onclick = function () {
      $('fileImage').onchange = function () {
        readFileAsDataUrl($('fileImage').files[0], function (url) {
          el.src = url;
          commit();
        });
      };
      $('fileImage').click();
    };
    box.appendChild(row('图片', btn));
    box.appendChild(row('宽', input('number', Math.round(el.w), function (v) { el.w = Math.max(4, v); })));
    box.appendChild(row('高', input('number', Math.round(el.h), function (v) { el.h = Math.max(4, v); })));
  }

  function qrProps(box, el) {
    box.appendChild(row('内容', input('text', el.data, function (v) {
      try { QRGen.makeMatrix(v); el.data = v; }
      catch (e) { toast(e.message); }
    })));
    box.appendChild(row('尺寸', input('number', Math.round(el.size), function (v) { el.size = Math.max(20, v); }, { min: 20, max: 1200 })));
    box.appendChild(row('前景色', input('color', el.fg, function (v) { el.fg = v; })));
    box.appendChild(row('码底色', input('color', el.bg || '#ffffff', function (v) { el.bg = v; })));
    var icon = el.icon;
    box.appendChild(row('中心图标', selectInput([
      { value: 'none', label: '无' }, { value: 'emoji', label: 'Emoji 文字' }, { value: 'image', label: '图片' }
    ], icon.type, function (v) { icon.type = v; })));
    if (icon.type === 'emoji') {
      box.appendChild(row('图标字符', input('text', icon.text || '', function (v) { icon.text = v; })));
    } else if (icon.type === 'image') {
      var btn = document.createElement('button');
      btn.textContent = icon.image ? '替换图标…' : '选择图标…';
      btn.onclick = function () {
        $('fileImage').onchange = function () {
          readFileAsDataUrl($('fileImage').files[0], function (url) {
            icon.image = url;
            commit();
          });
        };
        $('fileImage').click();
      };
      box.appendChild(row('图标文件', btn));
    }
    if (icon.type !== 'none') {
      box.appendChild(row('图标占比', input('range', icon.scale, function (v) { icon.scale = v; }, { min: 0.1, max: 0.5, step: 0.01 })));
    }
  }

  // ---------- 关键帧面板 ----------
  function renderAnimPanel(el) {
    var panel = $('animPanel');
    panel.hidden = false;
    var box = $('animProps');
    box.innerHTML = '';
    var enable = input('checkbox', !!el.anim, function (v) {
      el.anim = v ? { duration: 2, loop: true, keyframes: [{ t: 0, scale: 1, opacity: 1 }] } : null;
    });
    box.appendChild(row('启用动画', enable));
    if (!el.anim) return;
    var a = el.anim;
    box.appendChild(row('时长(秒)', input('number', a.duration, function (v) { a.duration = Math.max(0.2, v); }, { min: 0.2, step: 0.2 })));
    box.appendChild(row('循环', input('checkbox', a.loop, function (v) { a.loop = v; })));
    var tInput = input('number', 0.5, function () {}, { min: 0, max: 1, step: 0.05 });
    box.appendChild(row('时间点 t', tInput));
    var addBtn = document.createElement('button');
    addBtn.textContent = '记录当前状态为关键帧';
    addBtn.onclick = function () {
      var t = Math.min(1, Math.max(0, parseFloat(tInput.value) || 0));
      a.keyframes = a.keyframes.filter(function (k) { return Math.abs(k.t - t) > 0.001; });
      a.keyframes.push({
        t: t, dx: 0, dy: 0,
        scale: 1, opacity: el.opacity === undefined ? 1 : el.opacity,
        rotation: el.rotation || 0
      });
      a.keyframes.sort(function (x, y) { return x.t - y.t; });
      commit();
    };
    box.appendChild(addBtn);
    a.keyframes.forEach(function (k, i) {
      var div = document.createElement('div');
      div.className = 'row';
      var label = document.createElement('span');
      label.textContent = 't=' + k.t + ' 缩放=' + (k.scale === undefined ? 1 : k.scale);
      label.style.fontSize = '12px';
      var editScale = input('number', k.scale === undefined ? 1 : k.scale, function (v) { k.scale = v; }, { min: 0.1, max: 3, step: 0.05 });
      var editDy = input('number', k.dy || 0, function (v) { k.dy = v; }, { step: 10 });
      var del = document.createElement('button');
      del.textContent = '×';
      del.onclick = function () { a.keyframes.splice(i, 1); commit(); };
      div.appendChild(label);
      div.appendChild(editScale);
      div.appendChild(editDy);
      div.appendChild(del);
      box.appendChild(div);
    });
  }

  // ---------- 画布交互：选择 / 拖动 / 缩放 ----------
  function toPosterCoords(e) {
    var rect = canvas.getBoundingClientRect();
    var vs = viewScale();
    return { x: (e.clientX - rect.left) / vs, y: (e.clientY - rect.top) / vs };
  }

  function hitTest(pt) {
    var els = state.project.elements;
    for (var i = els.length - 1; i >= 0; i--) {
      var b = state.boxes[els[i].id];
      if (b && pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h) return els[i];
    }
    return null;
  }

  var drag = null;

  canvas.addEventListener('pointerdown', function (e) {
    var pt = toPosterCoords(e);
    var el = selected();
    // 缩放手柄
    if (el && state.boxes[el.id]) {
      var b = state.boxes[el.id];
      var hs = handleSize();
      if (pt.x >= b.x + b.w - hs && pt.x <= b.x + b.w + hs && pt.y >= b.y + b.h - hs && pt.y <= b.y + b.h + hs) {
        drag = { mode: 'scale', el: el, start: pt, orig: snapshotTransform(el) };
        canvas.setPointerCapture(e.pointerId);
        return;
      }
    }
    var hit = hitTest(pt);
    state.selectedId = hit ? hit.id : null;
    if (hit) {
      drag = { mode: 'move', el: hit, start: pt, orig: { x: hit.x, y: hit.y } };
      canvas.setPointerCapture(e.pointerId);
    }
    refresh();
  });

  function snapshotTransform(el) {
    return { x: el.x, y: el.y, w: el.w, h: el.h, size: el.size, fontSize: el.fontSize };
  }

  canvas.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var pt = toPosterCoords(e);
    var dx = pt.x - drag.start.x, dy = pt.y - drag.start.y;
    var el = drag.el;
    if (drag.mode === 'move') {
      el.x = Math.round(drag.orig.x + dx);
      el.y = Math.round(drag.orig.y + dy);
    } else if (drag.mode === 'scale') {
      var k = Math.max(0.05, 1 + dx / 200);
      if (el.type === 'qr') el.size = Math.max(20, Math.round(drag.orig.size * k));
      else if (el.type === 'text') el.fontSize = Math.max(6, Math.round(drag.orig.fontSize * k));
      else {
        el.w = Math.max(4, Math.round(drag.orig.w * k));
        el.h = Math.max(4, Math.round(drag.orig.h * k));
      }
    }
    state.boxes = R.layoutAll(measureCtx, state.project);
    redraw();
    renderIssues();
  });

  canvas.addEventListener('pointerup', function () {
    if (drag) { drag = null; commit(); }
  });

  // ---------- 播放 ----------
  function togglePlay() {
    state.playing = !state.playing;
    $('btnPlay').textContent = state.playing ? '⏸ 停止' : '▶ 播放';
    if (state.playing) {
      state.playStart = performance.now();
      requestAnimationFrame(tick);
    } else {
      redraw();
    }
  }

  function tick() {
    if (!state.playing) return;
    redraw((performance.now() - state.playStart) / 1000);
    requestAnimationFrame(tick);
  }

  // ---------- 文件 ----------
  function readFileAsDataUrl(file, cb) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () { cb(reader.result); };
    reader.readAsDataURL(file);
  }

  function saveProject() {
    var json = M.serialize(state.project);
    download('poster-project.json', new Blob([json], { type: 'application/json' }));
    autosave();
    toast('工程已保存为 JSON（含模板、字体、图片与关键帧）');
  }

  function loadProjectFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var p = M.deserialize(reader.result);
        state.project = p;
        state.selectedId = null;
        injectFonts();
        commit();
        toast('工程已载入：' + (p.templateName || '未命名'));
      } catch (e) {
        toast(e.message);
      }
    };
    reader.readAsText(file);
  }

  // ---------- 导出 ----------
  // 导出前运行完整校验：安全边距、文字裁切、对比度、定位块遮挡。
  // 存在 error 时给出修复指引，不静默丢失内容；用户确认后仍可导出。
  function gateExport(format, doExport) {
    var scale = parseFloat($('exportScale').value) || 1;
    state.project.exportParams = { format: format, scale: scale };
    autosave(); // 导出参数随工程保留
    var issues = runValidation(scale);
    var errors = issues.filter(function (i) { return i.level === 'error'; });
    if (errors.length === 0) { doExport(scale); return; }
    $('modalTitle').textContent = '导出前发现 ' + errors.length + ' 个错误';
    $('modalBody').innerHTML = '<p>以下问题可能导致内容丢失或无法扫描，建议先修复：</p><ul>' +
      errors.map(function (i) {
        return '<li>' + escapeHtml(i.message) + '<br><em>修复建议：' + escapeHtml(i.fix) + '</em></li>';
      }).join('') + '</ul>';
    $('modal').hidden = false;
    $('modalOk').onclick = function () {
      $('modal').hidden = true;
      doExport(scale);
    };
    $('modalCancel').onclick = function () { $('modal').hidden = true; };
  }

  function exportPng() {
    gateExport('png', function (scale) {
      var p = state.project;
      var off = document.createElement('canvas');
      off.width = p.canvas.width * scale;
      off.height = p.canvas.height * scale;
      var octx = off.getContext('2d');
      R.render(octx, p, { scale: scale, timeSec: 0 });
      off.toBlob(function (blob) {
        download('poster-' + p.canvas.width + 'x' + p.canvas.height + '@' + scale + 'x.png', blob);
        toast('PNG 已导出（' + scale + 'x），与预览使用同一渲染管线');
      }, 'image/png');
    });
  }

  function exportSvg() {
    gateExport('svg', function () {
      var svg = PosterSvg.toSvg(state.project, measureCtx);
      download('poster.svg', new Blob([svg], { type: 'image/svg+xml' }));
      toast('SVG 已导出：文字保持 <text> 可编辑，未做截图烧录');
    });
  }

  // ---------- 事件绑定 ----------
  function addElement(el) {
    state.project.elements.push(el);
    state.selectedId = el.id;
    commit();
  }

  function bind() {
    $('btnAddText').onclick = function () { addElement(M.textElement({})); };
    $('btnAddRect').onclick = function () { addElement(M.shapeElement('rect', {})); };
    $('btnAddEllipse').onclick = function () { addElement(M.shapeElement('ellipse', {})); };
    $('btnAddQR').onclick = function () { addElement(M.qrElement({})); };
    $('btnAddImage').onclick = function () {
      $('fileImage').onchange = function () {
        readFileAsDataUrl($('fileImage').files[0], function (url) {
          addElement(M.imageElement({ src: url }));
        });
      };
      $('fileImage').click();
    };
    $('btnUndo').onclick = undo;
    $('btnRedo').onclick = redo;
    $('btnSave').onclick = saveProject;
    $('btnLoad').onclick = function () { $('fileLoad').click(); };
    $('fileLoad').addEventListener('change', function () {
      if ($('fileLoad').files[0]) loadProjectFile($('fileLoad').files[0]);
      $('fileLoad').value = '';
    });
    $('btnExportPng').onclick = exportPng;
    $('btnExportSvg').onclick = exportSvg;
    $('btnPlay').onclick = togglePlay;
    $('btnDefault').onclick = function () {
      state.project = M.defaultProject();
      state.selectedId = null;
      commit();
      toast('已载入默认案例');
    };
    $('btnEdge').onclick = function () {
      state.project = M.edgeProject();
      state.selectedId = null;
      commit();
      toast('已载入边界案例：注意左侧实时检查面板');
    };
    $('btnLayerUp').onclick = function () { moveLayer(1); };
    $('btnLayerDown').onclick = function () { moveLayer(-1); };
    $('btnDelete').onclick = function () {
      var el = selected();
      if (!el) return;
      state.project.elements = state.project.elements.filter(function (e) { return e.id !== el.id; });
      state.selectedId = null;
      commit();
    };
    $('fileFont').addEventListener('change', function () {
      var file = $('fileFont').files[0];
      if (!file) return;
      readFileAsDataUrl(file, function (url) {
        var name = file.name.replace(/\.[^.]+$/, '');
        state.project.fonts.push({ name: name, dataUrl: url });
        injectFonts();
        commit();
        toast('字体 ' + name + ' 已加入工程，保存后可一致恢复');
      });
      $('fileFont').value = '';
    });
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selected() && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
        $('btnDelete').click();
      }
    });
    window.addEventListener('resize', refresh);
    R.onImageLoad = function () { redraw(); };
  }

  function moveLayer(dir) {
    var els = state.project.elements;
    var i = els.findIndex(function (e) { return e.id === state.selectedId; });
    if (i < 0) return;
    var j = i + dir;
    if (j < 0 || j >= els.length) return;
    var tmp = els[i];
    els[i] = els[j];
    els[j] = tmp;
    commit();
  }

  // ---------- 启动 ----------
  function init() {
    var saved = null;
    try { saved = localStorage.getItem(LS_KEY); } catch (e) { /* 隐私模式 */ }
    if (saved) {
      try {
        state.project = M.deserialize(saved);
      } catch (e) {
        state.project = M.defaultProject();
      }
    } else {
      state.project = M.defaultProject();
    }
    injectFonts();
    bind();
    commit(); // 初始历史
  }

  init();
})();
