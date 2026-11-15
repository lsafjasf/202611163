/* 布局引擎：文字换行/自适应、折叠仿射矩阵、命中检测（预览与导出共用） */
(function (root, factory) {
  var api = factory(root.TF);
  if (typeof module === "object" && module.exports) module.exports = api;
  Object.assign(root.TF, api);
})(typeof self !== "undefined" ? self : this, function (TF) {
  "use strict";

  // 可由 canvas-view 注入真实测量上下文；Node 测试时使用估算
  var measureCtx = null;
  function setMeasureContext(ctx) { measureCtx = ctx; }

  function fontString(el) {
    var style = el.italic ? "italic " : "";
    var weight = el.bold ? "700 " : "400 ";
    return style + weight + el.fontSize + "px " + el.fontFamily;
  }

  function measureText(text, el) {
    if (measureCtx) {
      measureCtx.font = fontString(el);
      return measureCtx.measureText(text).width;
    }
    // 无 Canvas 环境的保守估算
    var w = 0;
    for (var i = 0; i < text.length; i++) {
      w += text.charCodeAt(i) > 255 ? el.fontSize : el.fontSize * 0.56;
    }
    return w;
  }

  function isCJK(ch) {
    return /[⺀-⿕　-〿぀-ヿ一-鿿豈-﫿]/.test(ch);
  }

  // 贪心换行：显式换行优先；CJK 逐字，拉丁按词
  function wrapText(text, el, maxWidth, maxLines) {
    var paragraphs = String(text || "").split("\n");
    var lines = [];
    for (var pi = 0; pi < paragraphs.length; pi++) {
      var para = paragraphs[pi];
      if (para === "") { lines.push(""); continue; }
      var current = "";
      var i = 0;
      while (i < para.length) {
        var ch = para[i];
        if (ch === " " && current === "") { i++; continue; }
        var next;
        if (isCJK(ch)) {
          next = current + ch; i++;
        } else {
          var m = /^[A-Za-z0-9'’\-]+/.exec(para.slice(i));
          var word = m ? m[0] : ch;
          next = current === "" ? word : current + (para[i - 1] && isCJK(para[i - 1]) ? "" : " ") + word;
          i += word.length;
        }
        if (current !== "" && measureText(next, el) > maxWidth) {
          lines.push(current);
          current = isCJK(ch) ? ch : word;
          if (maxLines && lines.length >= maxLines) {
            return { lines: lines, truncated: true };
          }
        } else {
          current = next;
        }
      }
      lines.push(current);
      if (maxLines && lines.length > maxLines) {
        return { lines: lines.slice(0, maxLines), truncated: true };
      }
    }
    return { lines: lines, truncated: false };
  }

  function textMetrics(el) {
    var lineHeight = el.fontSize * el.lineHeight;
    var wrap = wrapText(el.text, el, Math.max(1, el.w));
    return {
      lines: wrap.lines,
      truncated: wrap.truncated,
      lineHeight: lineHeight,
      height: wrap.lines.length * lineHeight,
      maxLineWidth: wrap.lines.reduce(function (mx, ln) {
        return Math.max(mx, measureText(ln, el));
      }, 0)
    };
  }

  // 自动缩小字号直到内容适合盒子；返回可使用的字号（不小于 4px）
  function fitFontSize(el) {
    var probe = Object.assign({}, el);
    var size = el.fontSize;
    var lineHeight = el.lineHeight;
    while (size >= 4) {
      probe.fontSize = size;
      var wrap = wrapText(probe.text, probe, Math.max(1, el.w));
      var h = wrap.lines.length * size * lineHeight;
      if (!wrap.truncated && h <= el.h) return size;
      size -= 1;
    }
    return 4;
  }

  function normalizeRect(r) {
    var x = r.x, y = r.y, w = r.w, h = r.h;
    if (w < 0) { x += w; w = -w; }
    if (h < 0) { y += h; h = -h; }
    return { x: x, y: y, w: w, h: h };
  }

  function elementRect(el) { return normalizeRect(el); }

  function deg2rad(a) { return a * Math.PI / 180; }

  // 各面板在世界坐标中的折叠矩阵（面板局部坐标 -> 世界坐标）
  function panelFoldMatrix(geometry, panel, angleDeg) {
    var a = TF.clamp(angleDeg, 0, 180);
    var rad = deg2rad(a);
    var sx = Math.cos(rad);           // 水平投影
    var sy = 1 - 0.12 * Math.sin(rad); // 轻微透视压缩
    var w = geometry.width;
    var origin = TF.panelOrigin(geometry, panel);
    var translate = [1, 0, 0, 1, origin.x, origin.y];
    if (panel === 1) return translate;
    if (panel === 0) {
      // 左面板绕自身右边缘（局部 x=w，世界 x=w）旋转：
      // 世界 x = w - sx * (w - 局部x)
      var left = [sx, 0, 0, sy, w * (1 - sx), 0];
      return left;
    }
    // 右面板绕自身左边缘（局部 x=0，世界 x=2w）旋转：
    // 世界 x = 2w + sx * 局部x
    var right = [sx, 0, 0, sy, 2 * w, 0];
    return right;
  }

  function panelShading(angleDeg) {
    return 0.28 * Math.sin(deg2rad(TF.clamp(angleDeg, 0, 180)));
  }

  // 绘制深度：中间最后绘制在最上层；两侧按投影宽度排序
  function panelDrawOrder(angleDeg) {
    var sx = Math.cos(deg2rad(TF.clamp(angleDeg, 0, 180)));
    if (sx >= 0) return [0, 2, 1];
    return [2, 0, 1];
  }

  // 视图矩阵：世界坐标 -> 屏幕坐标
  function viewMatrix(view) {
    return [view.scale, 0, 0, view.scale, view.panX, view.panY];
  }

  // 元素（世界坐标矩形）-> 屏幕绘制矩阵
  function elementScreenMatrix(geometry, el, angleDeg, view) {
    var origin = TF.panelOrigin(geometry, el.panel);
    var worldToLocal = [1, 0, 0, 1, -origin.x, -origin.y];
    var fold = panelFoldMatrix(geometry, el.panel, angleDeg);
    return TF.multiply(viewMatrix(view), TF.multiply(fold, worldToLocal));
  }

  function screenToWorld(view, p) {
    return TF.applyPoint(TF.invert(viewMatrix(view)), p);
  }

  // 命中检测：把元素四角变换到屏幕，再用逆矩阵把屏幕点投回元素局部
  function hitTest(geometry, elements, angleDeg, view, screenPoint) {
    for (var i = elements.length - 1; i >= 0; i--) {
      var el = elements[i];
      var m = elementScreenMatrix(geometry, el, angleDeg, view);
      var inv = TF.invert(m);
      var local = TF.applyPoint(inv, screenPoint);
      var r = normalizeRect(el);
      if (local.x >= r.x && local.x <= r.x + r.w &&
          local.y >= r.y && local.y <= r.y + r.h) {
        return el;
      }
    }
    return null;
  }

  function handlePositions(geometry, el, angleDeg, view) {
    var m = elementScreenMatrix(geometry, el, angleDeg, view);
    var r = normalizeRect(el);
    var pts = {
      nw: { x: r.x, y: r.y }, ne: { x: r.x + r.w, y: r.y },
      sw: { x: r.x, y: r.y + r.h }, se: { x: r.x + r.w, y: r.y + r.h }
    };
    Object.keys(pts).forEach(function (k) { pts[k] = TF.applyPoint(m, pts[k]); });
    return pts;
  }

  return {
    setMeasureContext: setMeasureContext,
    fontString: fontString, measureText: measureText, wrapText: wrapText,
    textMetrics: textMetrics, fitFontSize: fitFontSize,
    normalizeRect: normalizeRect, elementRect: elementRect,
    panelFoldMatrix: panelFoldMatrix, panelShading: panelShading,
    panelDrawOrder: panelDrawOrder, viewMatrix: viewMatrix,
    elementScreenMatrix: elementScreenMatrix, screenToWorld: screenToWorld,
    hitTest: hitTest, handlePositions: handlePositions
  };
});
