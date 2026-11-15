/* SVG 导出：与 Canvas 共用 layout 的折叠矩阵；保留可编辑矢量元素 */
(function (root, factory) {
  var api = factory(root.TF);
  if (typeof module === "object" && module.exports) module.exports = api;
  Object.assign(root.TF, api);
})(typeof self !== "undefined" ? self : this, function (TF) {
  "use strict";

  function matrixStr(m) {
    return "matrix(" + m.map(function (n) { return round(n); }).join(" ") + ")";
  }
  function round(n) { return Math.round(n * 1000) / 1000; }

  function spanWithPadding(project, pad) {
    var g = project.geometry;
    var bounds = [];
    for (var p = 0; p < TF.PANEL_COUNT; p++) {
      var m = TF.panelFoldMatrix(g, p, project.foldAngle);
      bounds.push(TF.transformRect(m, { x: 0, y: 0, w: g.width, h: g.height }));
    }
    var xs = bounds.map(function (b) { return b.x; });
    var ys = bounds.map(function (b) { return b.y; });
    var x2 = bounds.map(function (b) { return b.x + b.w; });
    var y2 = bounds.map(function (b) { return b.y + b.h; });
    var minX = Math.min.apply(null, xs) - pad;
    var minY = Math.min.apply(null, ys) - pad;
    return {
      minX: minX, minY: minY,
      width: Math.max.apply(null, x2) - minX + pad,
      height: Math.max.apply(null, y2) - minY + pad
    };
  }

  function buildSvg(project, options) {
    options = options || {};
    var g = project.geometry;
    var pad = options.padding != null ? options.padding : 20;
    var span = spanWithPadding(project, pad);
    var parts = [];
    parts.push('<svg xmlns="http://www.w3.org/2000/svg" ' +
      'width="' + round(span.width) + '" height="' + round(span.height) + '" ' +
      'viewBox="' + round(span.minX) + " " + round(span.minY) + " " +
      round(span.width) + " " + round(span.height) + '">');
    parts.push("<metadata>" + TF.escapeXml(JSON.stringify({
      app: "trifold-editor",
      version: TF.SCHEMA_VERSION,
      title: project.title,
      foldAngle: project.foldAngle,
      geometry: g,
      exportedAt: new Date().toISOString(),
      params: options.exportParams || null
    })) + "</metadata>");

    // 自定义字体以 @font-face data URI 内嵌
    (project.fonts || []).forEach(function (f) {
      if (!f.src) return;
      var fmt = /\.woff2/.test(f.name) ? "woff2" : (/\.woff/.test(f.name) ? "woff" :
        (/\.otf/.test(f.name) ? "opentype" : "truetype"));
      parts.push('<defs><style type="text/css"><![CDATA[@font-face{font-family:' +
        "'" + TF.escapeXml(f.family) + "';src:url(" + f.src + ") format('" + fmt + "');}]]></style></defs>");
    });

    var order = TF.panelDrawOrder(project.foldAngle);
    order.forEach(function (panel) {
      var m = TF.panelFoldMatrix(g, panel, project.foldAngle);
      parts.push('<g class="panel panel-' + panel + '" transform="' + matrixStr(m) + '">');
      parts.push('<rect x="0" y="0" width="' + g.width + '" height="' + g.height +
        '" fill="#ffffff" stroke="#9aa5b1" stroke-width="1"/>');
      if (options.showSafe !== false) {
        parts.push('<rect x="' + g.margin + '" y="' + g.margin +
          '" width="' + (g.width - g.margin * 2) + '" height="' + (g.height - g.margin * 2) +
          '" fill="none" stroke="#2563eb" stroke-width="1" stroke-dasharray="6 4"/>');
      }
      var shade = TF.panelShading(project.foldAngle);
      if (shade > 0.01) {
        parts.push('<rect x="0" y="0" width="' + g.width + '" height="' + g.height +
          '" fill="rgba(15,23,42,' + round(shade) + ')"/>');
      }
      project.elements.filter(function (el) { return el.panel === panel; })
        .forEach(function (el) {
          var origin = TF.panelOrigin(g, panel);
          var localEl = Object.assign({}, el, {
            x: el.x - origin.x, y: el.y - origin.y,
            id: el.id, type: el.type
          });
          parts.push(elementToSvg(localEl));
        });
      parts.push("</g>");
    });

    if (options.showFoldLines !== false) {
      TF.foldLines(g).forEach(function (line) {
        parts.push('<line x1="' + line.x + '" y1="' + line.y + '" x2="' + line.x +
          '" y2="' + (line.y + line.h) + '" stroke="rgba(217,45,32,.85)" stroke-width="1.5" stroke-dasharray="8 5"/>');
      });
    }
    parts.push("</svg>");
    return parts.join("\n");
  }

  function elementToSvg(el) {
    var r = TF.normalizeRect(el);
    if (el.type === "shape") {
      if (el.shape === "ellipse") {
        return '<ellipse data-id="' + el.id + '" cx="' + round(r.x + r.w / 2) +
          '" cy="' + round(r.y + r.h / 2) + '" rx="' + round(r.w / 2) + '" ry="' + round(r.h / 2) +
          '" fill="' + (el.fill || "none") + '" stroke="' + el.stroke +
          '" stroke-width="' + el.strokeWidth + '"/>';
      }
      var rad = Math.min(el.radius || 0, r.w / 2, r.h / 2);
      return '<rect data-id="' + el.id + '" x="' + round(r.x) + '" y="' + round(r.y) +
        '" width="' + round(r.w) + '" height="' + round(r.h) + '" rx="' + round(rad) +
        '" fill="' + (el.fill || "none") + '" stroke="' + el.stroke +
        '" stroke-width="' + el.strokeWidth + '"/>';
    }
    if (el.type === "image") {
      var broken = !el.src;
      var head = '<image data-id="' + el.id + '" x="' + round(r.x) + '" y="' + round(r.y) +
        '" width="' + round(r.w) + '" height="' + round(r.h) + '"';
      if (broken) return head + ' data-broken="true"/>';
      var par = el.objectFit === "fill" ? "none"
        : (el.objectFit === "contain" ? "xMidYMid meet" : "xMidYMid slice");
      return head + ' preserveAspectRatio="' + par + '" href="' +
        TF.escapeXml(el.src) + '"/>';
    }
    return textToSvg(el);
  }

  function textToSvg(el) {
    var metrics = TF.textMetrics(el);
    var attrs = [
      'data-id="' + el.id + '"',
      'x="' + round(el.x) + '"',
      'font-family="' + TF.escapeXml(el.fontFamily) + '"',
      'font-size="' + round(el.fontSize) + '"',
      'fill="' + el.color + '"',
      'text-anchor="' + (el.align === "center" ? "middle" : el.align === "right" ? "end" : "start") + '"',
      el.bold ? 'font-weight="700"' : "",
      el.italic ? 'font-style="italic"' : ""
    ].filter(Boolean).join(" ");
    var anchorX = el.align === "center" ? el.x + el.w / 2 : (el.align === "right" ? el.x + el.w : el.x);
    var out = ['<text ' + attrs.replace('x="' + round(el.x) + '"', 'x="' + round(anchorX) + '"' ) + ">"];
    metrics.lines.forEach(function (line, i) {
      out.push('<tspan x="' + round(anchorX) + '" y="' +
        round(el.y + i * metrics.lineHeight + el.fontSize) + '">' +
        TF.escapeXml(line) + "</tspan>");
    });
    out.push("</text>");
    return out.join("");
  }

  function svgBlob(svg) {
    return new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  }

  return { buildSvg: buildSvg, svgBlob: svgBlob, elementToSvg: elementToSvg };
});
