/* 实时校验：安全区域、对比度、定位块遮挡、文字裁切、二维码尺寸。
 * 每条问题都附带修复建议，导出前会再次运行（error 级默认阻止导出）。 */
(function (global) {
  'use strict';

  function hexToRgb(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return null;
    var v = parseInt(m[1], 16);
    return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
  }

  function luminance(hex) {
    var c = hexToRgb(hex);
    if (!c) return 0.5;
    function f(u) {
      u /= 255;
      return u <= 0.03928 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4);
    }
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }

  function contrastRatio(fg, bg) {
    var l1 = luminance(fg), l2 = luminance(bg);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }

  function rectsIntersect(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  // 二维码三个定位块在海报坐标系中的矩形
  function finderRects(el) {
    var m = PosterRender.qrMatrix(el.data);
    var q = QRGen.QUIET;
    var cell = el.size / m.size;
    var total = (m.size + q * 2) * cell;
    var ox = el.x - total / 2 + q * cell; // 模块区左上角
    var oy = el.y - total / 2 + q * cell;
    var f = 7 * cell;
    return [
      { x: ox, y: oy, w: f, h: f },
      { x: ox + (m.size - 7) * cell, y: oy, w: f, h: f },
      { x: ox, y: oy + (m.size - 7) * cell, w: f, h: f }
    ];
  }

  function validate(project, boxes, opts) {
    opts = opts || {};
    var issues = [];
    var W = project.canvas.width, H = project.canvas.height;
    var margin = project.canvas.safeMarginRatio * Math.min(W, H);
    var safe = { x: margin, y: margin, w: W - margin * 2, h: H - margin * 2 };
    var exportScale = opts.exportScale || 1;

    function push(level, el, message, fix) {
      issues.push({
        level: level,
        elementId: el ? el.id : null,
        elementName: el ? el.name : null,
        message: message,
        fix: fix
      });
    }

    project.elements.forEach(function (el) {
      var b = boxes[el.id];
      if (!b) return;

      // 1) 画布外 → 错误
      if (b.x < 0 || b.y < 0 || b.x + b.w > W || b.y + b.h > H) {
        var overX = Math.max(0, -(b.x), b.x + b.w - W);
        var overY = Math.max(0, -(b.y), b.y + b.h - H);
        push('error', el,
          '「' + el.name + '」超出画布（横向约 ' + Math.ceil(overX) + 'px，纵向约 ' + Math.ceil(overY) + 'px）',
          el.type === 'text'
            ? '缩小字号、增大自动换行宽度，或将元素移回画布内'
            : '将元素移回画布内，或缩小其尺寸');
      } else if (!rectsIntersect(b, safe) ||
          b.x < safe.x || b.y < safe.y || b.x + b.w > safe.x + safe.w || b.y + b.h > safe.y + safe.h) {
        // 2) 安全区外 → 警告
        push('warn', el,
          '「' + el.name + '」超出安全边距（' + Math.round(margin) + 'px），导出印刷时可能被裁切',
          '将元素向画布中心移动，或缩小尺寸使其完全进入虚线安全区');
      }

      // 3) 文字特有检查
      if (el.type === 'text') {
        if (el.text.length > 120) {
          push('warn', el,
            '「' + el.name + '」文本长达 ' + el.text.length + ' 字，可能影响排版与阅读',
            '拆分为多个文字元素，或缩短内容');
        }
        if (el.text.trim() === '') {
          push('warn', el, '「' + el.name + '」内容为空', '输入文字或删除该元素');
        }
      }

      // 4) 二维码特有检查
      if (el.type === 'qr') {
        var ratio = contrastRatio(el.fg, el.bg || '#ffffff');
        if (ratio < 2) {
          push('error', el,
            '二维码前景/背景对比度仅 ' + ratio.toFixed(2) + ':1，几乎无法扫描',
            '将前景色改为深色（如 #1a1a2e），或把码底改为 #ffffff');
        } else if (ratio < 3) {
          push('warn', el,
            '二维码对比度 ' + ratio.toFixed(2) + ':1 偏低，弱光下可能扫不出',
            '加深前景色或提亮码底，建议对比度 ≥ 3:1');
        }
        var m = PosterRender.qrMatrix(el.data);
        var modulePx = el.size / m.size;
        if (modulePx * exportScale < 2) {
          push('error', el,
            '二维码模块在导出图上仅 ' + (modulePx * exportScale).toFixed(1) + 'px，无法可靠扫描',
            '把二维码尺寸调大到 ' + Math.ceil(m.size * 2 / exportScale) + 'px 以上，或提高导出倍率');
        } else if (modulePx < 3) {
          push('warn', el,
            '二维码模块仅 ' + modulePx.toFixed(1) + 'px，远距离扫描可能失败',
            '建议二维码尺寸 ≥ ' + m.size * 3 + 'px');
        }
        var icon = el.icon || {};
        if (icon.type && icon.type !== 'none') {
          if (icon.scale > 0.3) {
            push('error', el,
              '中心图标占码面 ' + Math.round(icon.scale * 100) + '%，超出 H 级纠错可恢复范围',
              '将图标比例调小到 0.25 以下');
          } else if (icon.scale > 0.25) {
            push('warn', el,
              '中心图标占码面 ' + Math.round(icon.scale * 100) + '%，接近纠错上限',
              '建议图标比例 ≤ 0.22，并确保持码测试扫描');
          }
        }
      }
    });

    // 5) 定位块遮挡：层级在二维码之上的元素与定位块相交
    project.elements.forEach(function (qr, qi) {
      if (qr.type !== 'qr') return;
      var finders = finderRects(qr);
      project.elements.forEach(function (other, oi) {
        if (oi <= qi || other.id === qr.id) return; // 只检查更上层
        var ob = boxes[other.id];
        if (!ob) return;
        finders.forEach(function (f) {
          if (rectsIntersect(f, ob)) {
            push('error', other,
              '「' + other.name + '」遮挡了「' + qr.name + '」的定位块，二维码将无法识别',
              '将该元素移开，或用「下移层级」放到二维码之下');
          }
        });
      });
    });

    return issues;
  }

  var api = { validate: validate, contrastRatio: contrastRatio, luminance: luminance, finderRects: finderRects };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.PosterValidate = api;
})(typeof window !== 'undefined' ? window : globalThis);
