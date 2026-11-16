/* SVG 导出：与 Canvas 预览共用布局结果，文字保留为可编辑的 <text>，
 * 二维码导出为矢量路径，自定义字体以 @font-face 内嵌，图片以 dataURL 内嵌。 */
(function (global) {
  'use strict';

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function num(n) {
    return Math.round(n * 100) / 100;
  }

  // 背景纹理 → SVG pattern（与 render.js 参数一致）
  function textureDef(bg) {
    if (!bg.texture || bg.texture === 'none' || bg.textureOpacity <= 0) return { def: '', fill: '' };
    var s = Math.max(4, bg.textureSize);
    var id = 'bgTexture';
    var inner = '';
    var w = s, h = s;
    if (bg.texture === 'dots') {
      inner = '<circle cx="' + num(s / 2) + '" cy="' + num(s / 2) + '" r="' + num(s * 0.12) + '" fill="' + bg.textureColor + '"/>';
    } else if (bg.texture === 'grid') {
      inner = '<path d="M ' + s + ' 0 H 0 V ' + s + '" fill="none" stroke="' + bg.textureColor + '" stroke-width="1"/>';
    } else if (bg.texture === 'diagonal') {
      inner = '<path d="M 0 ' + s + ' L ' + s + ' 0" stroke="' + bg.textureColor + '" stroke-width="' + num(s * 0.18) + '"/>';
    } else if (bg.texture === 'waves') {
      var d = 'M 0 ' + num(s * 0.5) + ' Q ' + num(s * 0.25) + ' ' + num(s * 0.25) + ', ' + num(s * 0.5) + ' ' + num(s * 0.5) +
        ' T ' + s + ' ' + num(s * 0.5);
      inner = '<path d="' + d + '" fill="none" stroke="' + bg.textureColor + '" stroke-width="' + num(s * 0.1) + '"/>';
    }
    var def = '<pattern id="' + id + '" width="' + w + '" height="' + h + '" patternUnits="userSpaceOnUse">' + inner + '</pattern>';
    return { def: def, fill: '<rect width="100%" height="100%" fill="url(#' + id + ')" opacity="' + bg.textureOpacity + '"/>' };
  }

  function qrPath(el) {
    var m = PosterRender.qrMatrix(el.data);
    var q = QRGen.QUIET;
    var cell = el.size / m.size;
    var total = (m.size + q * 2) * cell;
    var origin = -total / 2;
    var d = '';
    for (var r = 0; r < m.size; r++) {
      var c = 0;
      while (c < m.size) {
        if (m.modules[r][c] === 1) {
          var run = 1;
          while (c + run < m.size && m.modules[r][c + run] === 1) run++;
          d += 'M' + num(origin + (c + q) * cell) + ' ' + num(origin + (r + q) * cell) +
            'h' + num(run * cell) + 'v' + num(cell) + 'h' + num(-run * cell) + 'z';
          c += run;
        } else c++;
      }
    }
    var parts = [];
    parts.push('<rect x="' + num(origin) + '" y="' + num(origin) + '" width="' + num(total) + '" height="' + num(total) + '" fill="' + (el.bg || '#ffffff') + '"/>');
    parts.push('<path d="' + d + '" fill="' + el.fg + '"/>');
    var icon = el.icon || {};
    if (icon.type && icon.type !== 'none' && icon.scale > 0) {
      var iconSize = el.size * icon.scale;
      var rad = iconSize / 2 + iconSize * 0.15;
      parts.push('<circle cx="0" cy="0" r="' + num(rad) + '" fill="' + (el.bg || '#ffffff') + '"/>');
      if (icon.type === 'emoji' && icon.text) {
        parts.push('<text x="0" y="0" font-size="' + num(iconSize) + '" text-anchor="middle" dominant-baseline="central">' + esc(icon.text) + '</text>');
      } else if (icon.type === 'image' && icon.image) {
        parts.push('<image href="' + icon.image + '" x="' + num(-iconSize / 2) + '" y="' + num(-iconSize / 2) +
          '" width="' + num(iconSize) + '" height="' + num(iconSize) + '"/>');
      }
    }
    return parts.join('');
  }

  function elementSvg(ctx, el) {
    var st = PosterRender.animState(el, 0); // 导出静态首帧
    var tf = 'translate(' + num(el.x + st.dx) + ' ' + num(el.y + st.dy) + ')';
    var rot = (el.rotation || 0) + st.rotation;
    if (rot) tf += ' rotate(' + num(rot) + ')';
    if (st.scale !== 1) tf += ' scale(' + num(st.scale) + ')';
    var opacity = (el.opacity === undefined ? 1 : el.opacity) * st.opacity;
    var body = '';
    if (el.type === 'text') {
      var lay = PosterRender.layoutText(ctx, el);
      var anchor = el.align === 'center' ? 'middle' : el.align === 'right' ? 'end' : 'start';
      var tx = el.align === 'center' ? 0 : el.align === 'right' ? lay.width / 2 : -lay.width / 2;
      var startY = -lay.height / 2 + lay.lineHeightPx / 2;
      var style = 'font-family:' + el.fontFamily + ';font-size:' + el.fontSize + 'px;' +
        (el.bold ? 'font-weight:bold;' : '') + (el.italic ? 'font-style:italic;' : '');
      var tspans = lay.lines.map(function (line, i) {
        return '<tspan x="' + num(tx) + '" y="' + num(startY + i * lay.lineHeightPx) + '">' + esc(line) + '</tspan>';
      }).join('');
      body = '<text style="' + esc(style) + '" fill="' + el.color + '" text-anchor="' + anchor +
        '" dominant-baseline="central">' + tspans + '</text>';
    } else if (el.type === 'rect') {
      body = '<rect x="' + num(-el.w / 2) + '" y="' + num(-el.h / 2) + '" width="' + num(el.w) + '" height="' + num(el.h) + '"' +
        (el.radius ? ' rx="' + num(el.radius) + '"' : '') +
        ' fill="' + (el.fill || 'none') + '"' +
        (el.stroke && el.strokeWidth ? ' stroke="' + el.stroke + '" stroke-width="' + num(el.strokeWidth) + '"' : '') + '/>';
    } else if (el.type === 'ellipse') {
      body = '<ellipse cx="0" cy="0" rx="' + num(el.w / 2) + '" ry="' + num(el.h / 2) + '"' +
        ' fill="' + (el.fill || 'none') + '"' +
        (el.stroke && el.strokeWidth ? ' stroke="' + el.stroke + '" stroke-width="' + num(el.strokeWidth) + '"' : '') + '/>';
    } else if (el.type === 'image' && el.src) {
      body = '<image href="' + el.src + '" x="' + num(-el.w / 2) + '" y="' + num(-el.h / 2) +
        '" width="' + num(el.w) + '" height="' + num(el.h) + '"/>';
    } else if (el.type === 'qr') {
      body = qrPath(el);
    }
    if (!body) return '';
    return '<g transform="' + tf + '"' + (opacity !== 1 ? ' opacity="' + num(opacity) + '"' : '') +
      ' data-element-id="' + el.id + '" data-element-type="' + el.type + '">' + body + '</g>';
  }

  // ctx：用于文本测量的 2d 上下文（与预览同一测量逻辑）
  function toSvg(project, ctx) {
    var W = project.canvas.width, H = project.canvas.height;
    var defs = [];
    (project.fonts || []).forEach(function (f) {
      defs.push('<style>@font-face{font-family:"' + esc(f.name) + '";src:url(' + f.dataUrl + ');}</style>');
    });
    var tex = textureDef(project.background);
    if (tex.def) defs.push(tex.def);
    var body = ['<rect width="100%" height="100%" fill="' + project.background.color + '"/>'];
    if (tex.fill) body.push(tex.fill);
    project.elements.forEach(function (el) {
      body.push(elementSvg(ctx, el));
    });
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
      'width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' +
      (defs.length ? '<defs>' + defs.join('') + '</defs>' : '') +
      body.join('\n') + '</svg>';
  }

  var api = { toSvg: toSvg };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.PosterSvg = api;
})(typeof window !== 'undefined' ? window : globalThis);
