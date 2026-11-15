/* 通用工具：命名空间、深拷贝、ID、几何与矩阵 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.TF = root.TF || {};
  Object.assign(root.TF, api);
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var uidCounter = 0;
  function uid(prefix) {
    uidCounter += 1;
    return (prefix || "id") + "_" + Date.now().toString(36) + "_" + uidCounter;
  }

  function deepClone(obj) {
    if (typeof structuredClone === "function") return structuredClone(obj);
    return JSON.parse(JSON.stringify(obj));
  }

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function rectsOverlap(a, b) {
    return !(a.x + a.w <= b.x || b.x + b.w <= a.x ||
             a.y + a.h <= b.y || b.y + b.h <= a.y);
  }

  function rectContainsRect(outer, inner, tolerance) {
    var t = tolerance || 0;
    return inner.x >= outer.x - t && inner.y >= outer.y - t &&
           inner.x + inner.w <= outer.x + outer.w + t &&
           inner.y + inner.h <= outer.y + outer.h + t;
  }

  function pointInRect(p, r) {
    return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  }

  // 2x3 仿射矩阵 [a b c d e f]，点: x' = a*x + c*y + e, y' = b*x + d*y + f
  function identity() { return [1, 0, 0, 1, 0, 0]; }
  function multiply(m1, m2) {
    return [
      m1[0] * m2[0] + m1[2] * m2[1],
      m1[1] * m2[0] + m1[3] * m2[1],
      m1[0] * m2[2] + m1[2] * m2[3],
      m1[1] * m2[2] + m1[3] * m2[3],
      m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
      m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
    ];
  }
  function applyPoint(m, p) {
    return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
  }
  function invert(m) {
    var det = m[0] * m[3] - m[1] * m[2];
    if (Math.abs(det) < 1e-12) return identity();
    var inv = 1 / det;
    return [
      m[3] * inv, -m[1] * inv, -m[2] * inv, m[0] * inv,
      (m[2] * m[5] - m[3] * m[4]) * inv,
      (m[1] * m[4] - m[0] * m[5]) * inv
    ];
  }
  function transformRect(m, r) {
    var pts = [
      applyPoint(m, { x: r.x, y: r.y }),
      applyPoint(m, { x: r.x + r.w, y: r.y }),
      applyPoint(m, { x: r.x, y: r.y + r.h }),
      applyPoint(m, { x: r.x + r.w, y: r.y + r.h })
    ];
    var xs = pts.map(function (p) { return p.x; });
    var ys = pts.map(function (p) { return p.y; });
    var x = Math.min.apply(null, xs), y = Math.min.apply(null, ys);
    return { x: x, y: y, w: Math.max.apply(null, xs) - x, h: Math.max.apply(null, ys) - y };
  }

  function escapeXml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  }

  function download(filename, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  return {
    uid: uid, deepClone: deepClone, clamp: clamp,
    rectsOverlap: rectsOverlap, rectContainsRect: rectContainsRect, pointInRect: pointInRect,
    identity: identity, multiply: multiply, applyPoint: applyPoint, invert: invert,
    transformRect: transformRect, escapeXml: escapeXml, download: download
  };
});
