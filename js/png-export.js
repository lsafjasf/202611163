/* PNG 导出：把同一套布局生成的 SVG 栅格化，保证与预览一致 */
(function (root, factory) {
  var api = factory(root.TF);
  if (typeof module === "object" && module.exports) module.exports = api;
  Object.assign(root.TF, api);
})(typeof self !== "undefined" ? self : this, function (TF) {
  "use strict";

  function exportPng(project, options) {
    options = options || {};
    var scale = options.pixelScale || 2;
    var svg = TF.buildSvg(project, options);
    var svgUrl = URL.createObjectURL(TF.svgBlob(svg));
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var vb = svgViewBox(svg);
        var canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(vb.width * scale));
        canvas.height = Math.max(1, Math.round(vb.height * scale));
        var ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(svgUrl);
        canvas.toBlob(function (blob) {
          if (!blob) {
            reject(new Error("PNG 编码失败。修复方法：减小图片体积或降低导出倍率后重试。"));
            return;
          }
          resolve({ blob: blob, width: canvas.width, height: canvas.height, svgSource: svg });
        }, "image/png");
      };
      img.onerror = function () {
        URL.revokeObjectURL(svgUrl);
        reject(new Error("SVG 栅格化失败，通常是图片 data URI 损坏。修复方法：重新导入该图片后再导出。"));
      };
      img.src = svgUrl;
    });
  }

  function svgViewBox(svg) {
    var m = /viewBox="([-\d.\s]+)"/.exec(svg);
    if (!m) return { width: 100, height: 100 };
    var parts = m[1].split(/\s+/).map(Number);
    return { width: parts[2], height: parts[3] };
  }

  return { exportPng: exportPng };
});
