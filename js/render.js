/* Canvas 渲染器：预览与 PNG 导出共用；文本换行测量同时供校验与 SVG 导出使用，
 * 保证导出结果与预览一致。 */
(function (global) {
  'use strict';

  var qrCache = {};
  function qrMatrix(data) {
    if (!qrCache[data]) qrCache[data] = QRGen.makeMatrix(data);
    return qrCache[data];
  }

  function fontOf(el) {
    return (el.italic ? 'italic ' : '') + (el.bold ? 'bold ' : '') +
      el.fontSize + 'px ' + el.fontFamily;
  }

  // 文本换行：maxWidth<=0 时不自动换行。返回 {lines, width, height, lineHeightPx}
  function layoutText(ctx, el) {
    ctx.font = fontOf(el);
    var lineHeightPx = el.fontSize * (el.lineHeight || 1.3);
    var lines = [];
    el.text.split('\n').forEach(function (para) {
      if (!el.maxWidth || el.maxWidth <= 0) { lines.push(para); return; }
      var cur = '';
      for (var i = 0; i < para.length; i++) {
        var ch = para[i];
        if (cur && ctx.measureText(cur + ch).width > el.maxWidth) {
          lines.push(cur);
          cur = ch;
        } else {
          cur += ch;
        }
      }
      lines.push(cur);
    });
    var width = 0;
    lines.forEach(function (l) {
      width = Math.max(width, ctx.measureText(l).width);
    });
    return { lines: lines, width: width, height: lines.length * lineHeightPx, lineHeightPx: lineHeightPx };
  }

  // 元素包围盒（海报坐标系，未应用关键帧变换）
  function elementBBox(ctx, project, el) {
    if (el.type === 'text') {
      var lay = layoutText(ctx, el);
      return { x: el.x - lay.width / 2, y: el.y - lay.height / 2, w: lay.width, h: lay.height, textLayout: lay };
    }
    if (el.type === 'qr') {
      var q = QRGen.QUIET;
      var m = qrMatrix(el.data);
      var total = el.size * (m.size + q * 2) / m.size; // 含静区
      return { x: el.x - total / 2, y: el.y - total / 2, w: total, h: total };
    }
    return { x: el.x - el.w / 2, y: el.y - el.h / 2, w: el.w, h: el.h };
  }

  function layoutAll(ctx, project) {
    var boxes = {};
    project.elements.forEach(function (el) {
      boxes[el.id] = elementBBox(ctx, project, el);
    });
    return boxes;
  }

  // ---- 背景纹理 ----
  function drawBackground(ctx, project, W, H) {
    var bg = project.background;
    ctx.fillStyle = bg.color;
    ctx.fillRect(0, 0, W, H);
    if (!bg.texture || bg.texture === 'none' || bg.textureOpacity <= 0) return;
    ctx.save();
    ctx.globalAlpha = bg.textureOpacity;
    ctx.fillStyle = bg.textureColor;
    ctx.strokeStyle = bg.textureColor;
    var s = Math.max(4, bg.textureSize);
    var x, y;
    if (bg.texture === 'dots') {
      for (y = s / 2; y < H; y += s) for (x = s / 2; x < W; x += s) {
        ctx.beginPath();
        ctx.arc(x, y, s * 0.12, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (bg.texture === 'grid') {
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (x = 0; x <= W; x += s) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
      for (y = 0; y <= H; y += s) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
      ctx.stroke();
    } else if (bg.texture === 'diagonal') {
      ctx.lineWidth = s * 0.18;
      ctx.beginPath();
      for (var d = -H; d < W + H; d += s) {
        ctx.moveTo(d, 0);
        ctx.lineTo(d + H, H);
      }
      ctx.stroke();
    } else if (bg.texture === 'waves') {
      ctx.lineWidth = s * 0.1;
      for (y = s; y < H + s; y += s) {
        ctx.beginPath();
        for (x = 0; x <= W; x += 8) {
          var yy = y + Math.sin((x / W) * Math.PI * 4) * s * 0.25;
          if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ---- 关键帧求值：t 为 0..1 的归一化时间 ----
  function animState(el, timeSec) {
    var a = el.anim;
    if (!a || !a.keyframes || a.keyframes.length === 0 || !a.duration) {
      return { dx: 0, dy: 0, scale: 1, opacity: 1, rotation: 0 };
    }
    var t = (timeSec / a.duration) % 1;
    if (t < 0) t += 1;
    if (!a.loop) t = Math.min(1, timeSec / a.duration);
    var ks = a.keyframes;
    var prev = ks[0], next = ks[ks.length - 1];
    for (var i = 0; i < ks.length; i++) {
      if (ks[i].t <= t) prev = ks[i];
      if (ks[i].t >= t) { next = ks[i]; break; }
    }
    var span = next.t - prev.t;
    var k = span > 0 ? (t - prev.t) / span : 0;
    function lerp(key, dflt) {
      var v0 = prev[key] === undefined ? dflt : prev[key];
      var v1 = next[key] === undefined ? dflt : next[key];
      return v0 + (v1 - v0) * k;
    }
    return {
      dx: lerp('dx', 0), dy: lerp('dy', 0),
      scale: lerp('scale', 1), opacity: lerp('opacity', 1),
      rotation: lerp('rotation', 0)
    };
  }

  // ---- 各元素绘制 ----
  function drawQR(ctx, el) {
    var m = qrMatrix(el.data);
    var q = QRGen.QUIET;
    var total = m.size + q * 2;
    var cell = el.size / m.size;
    var origin = -total * cell / 2;
    // 静区底
    ctx.fillStyle = el.bg || '#ffffff';
    ctx.fillRect(origin, origin, total * cell, total * cell);
    // 模块
    ctx.fillStyle = el.fg;
    for (var r = 0; r < m.size; r++) {
      for (var c = 0; c < m.size; c++) {
        if (m.modules[r][c] === 1) {
          ctx.fillRect(origin + (c + q) * cell, origin + (r + q) * cell, cell + 0.5, cell + 0.5);
        }
      }
    }
    // 中心图标：先清空圆形区域再绘制
    var icon = el.icon || {};
    if (icon.type && icon.type !== 'none' && icon.scale > 0) {
      var iconSize = el.size * icon.scale;
      var pad = iconSize * 0.15;
      ctx.fillStyle = el.bg || '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, iconSize / 2 + pad, 0, Math.PI * 2);
      ctx.fill();
      if (icon.type === 'emoji' && icon.text) {
        ctx.font = iconSize + 'px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(icon.text, 0, iconSize * 0.06);
      } else if (icon.type === 'image' && icon.image) {
        var img = imageCache[icon.image];
        if (img && img.complete) {
          ctx.drawImage(img, -iconSize / 2, -iconSize / 2, iconSize, iconSize);
        }
      }
    }
  }

  var imageCache = {};
  function getImage(src) {
    if (!imageCache[src]) {
      var img = new Image();
      img.src = src;
      img.onload = function () { if (api.onImageLoad) api.onImageLoad(); };
      imageCache[src] = img;
    }
    return imageCache[src];
  }

  function drawElement(ctx, project, el, timeSec) {
    var st = animState(el, timeSec || 0);
    ctx.save();
    ctx.translate(el.x + st.dx, el.y + st.dy);
    ctx.rotate(((el.rotation || 0) + st.rotation) * Math.PI / 180);
    ctx.scale(st.scale, st.scale);
    ctx.globalAlpha = (el.opacity === undefined ? 1 : el.opacity) * st.opacity;
    if (el.type === 'text') {
      var lay = layoutText(ctx, el);
      ctx.font = fontOf(el);
      ctx.fillStyle = el.color;
      ctx.textBaseline = 'middle';
      var startY = -lay.height / 2 + lay.lineHeightPx / 2;
      lay.lines.forEach(function (line, i) {
        var tx = 0;
        if (el.align === 'center') ctx.textAlign = 'center';
        else if (el.align === 'right') { ctx.textAlign = 'right'; tx = lay.width / 2; }
        else { ctx.textAlign = 'left'; tx = -lay.width / 2; }
        ctx.fillText(line, tx, startY + i * lay.lineHeightPx);
      });
    } else if (el.type === 'rect') {
      ctx.beginPath();
      var x = -el.w / 2, y = -el.h / 2;
      if (el.radius > 0 && ctx.roundRect) ctx.roundRect(x, y, el.w, el.h, el.radius);
      else ctx.rect(x, y, el.w, el.h);
      if (el.fill) { ctx.fillStyle = el.fill; ctx.fill(); }
      if (el.stroke && el.strokeWidth > 0) {
        ctx.strokeStyle = el.stroke;
        ctx.lineWidth = el.strokeWidth;
        ctx.stroke();
      }
    } else if (el.type === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse(0, 0, el.w / 2, el.h / 2, 0, 0, Math.PI * 2);
      if (el.fill) { ctx.fillStyle = el.fill; ctx.fill(); }
      if (el.stroke && el.strokeWidth > 0) {
        ctx.strokeStyle = el.stroke;
        ctx.lineWidth = el.strokeWidth;
        ctx.stroke();
      }
    } else if (el.type === 'image' && el.src) {
      var img = getImage(el.src);
      if (img.complete) ctx.drawImage(img, -el.w / 2, -el.h / 2, el.w, el.h);
    } else if (el.type === 'qr') {
      drawQR(ctx, el);
    }
    ctx.restore();
  }

  // 整幅渲染：scale 为导出倍率；timeSec 用于关键帧预览
  function render(ctx, project, opts) {
    opts = opts || {};
    var W = project.canvas.width, H = project.canvas.height;
    var scale = opts.scale || 1;
    ctx.save();
    ctx.scale(scale, scale);
    drawBackground(ctx, project, W, H);
    project.elements.forEach(function (el) {
      drawElement(ctx, project, el, opts.timeSec || 0);
    });
    ctx.restore();
  }

  var api = {
    render: render,
    layoutText: layoutText,
    layoutAll: layoutAll,
    elementBBox: elementBBox,
    qrMatrix: qrMatrix,
    fontOf: fontOf,
    animState: animState,
    onImageLoad: null
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.PosterRender = api;
})(typeof window !== 'undefined' ? window : globalThis);
