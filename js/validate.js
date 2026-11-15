/* 安全校验与自动修复：安全边距、折线越界、文字裁切、资源完整性 */
(function (root, factory) {
  var api = factory(root.TF);
  if (typeof module === "object" && module.exports) module.exports = api;
  Object.assign(root.TF, api);
})(typeof self !== "undefined" ? self : this, function (TF) {
  "use strict";

  var TOL = 0.5;

  function issue(level, code, elementId, message, fix) {
    return { level: level, code: code, elementId: elementId || null, message: message, fix: fix || null };
  }

  function validate(project) {
    var g = project.geometry;
    var issues = [];

    if (g.width <= 0 || g.height <= 0) {
      issues.push(issue("error", "BAD_GEOMETRY", null,
        "面板尺寸必须为正数（当前 " + g.width + "×" + g.height + "）。",
        "在属性中把 width/height 改为正数。"));
    }
    if (g.margin * 2 >= Math.min(g.width, g.height)) {
      issues.push(issue("error", "BAD_MARGIN", null,
        "安全边距 " + g.margin + "px 相对面板 " + g.width + "×" + g.height +
        " 过大，安全区已消失。",
        "减小 margin（建议不超过面板短边的 1/4）。"));
    }

    project.elements.forEach(function (el) {
      var r = TF.normalizeRect(el);
      if (el.w < 0 || el.h < 0) {
        issues.push(issue("error", "NEGATIVE_SIZE", el.id,
          "元素 “" + label(el) + "” 存在负宽/负高（" + el.w + "×" + el.h + "）。",
          "点击“自动修复”归一化坐标与尺寸，或手工把宽高改为正数。"));
      }
      if (r.w < 2 || r.h < 2) {
        issues.push(issue("error", "ZERO_SIZE", el.id,
          "元素 “" + label(el) + "” 尺寸过小或为负（" + round(r.w) + "×" + round(r.h) + "）。",
          "拖大元素手柄，或在属性面板设置不小于 2px 的宽高。"));
        return;
      }

      // 元素坐标是世界坐标，校验前换算到所属面板的局部坐标
      var origin = TF.panelOrigin(g, el.panel);
      var local = { x: r.x - origin.x, y: r.y - origin.y, w: r.w, h: r.h };

      // 规则 1：必须位于所属面板内（不能跨折线）
      var panelLocal = { x: 0, y: 0, w: g.width, h: g.height };
      if (!TF.rectContainsRect(panelLocal, local, TOL)) {
        issues.push(issue("error", "OUT_OF_PANEL", el.id,
          "元素 “" + label(el) + "” 越过面板边界/折线，折叠时会被裁切。",
          "把元素移回面板 " + (el.panel + 1) + " 内，或缩小其宽高。"));
      }

      // 规则 2：安全边距
      var safeLocal = { x: g.margin, y: g.margin,
        w: g.width - g.margin * 2, h: g.height - g.margin * 2 };
      if (!TF.rectContainsRect(safeLocal, local, TOL)) {
        issues.push(issue("warn", "OUT_OF_SAFE", el.id,
          "元素 “" + label(el) + "” 超出蓝色安全边距，存在印刷裁切风险。",
          "移动元素使其四边都在安全区内（margin=" + g.margin + "px）。"));
      }

      // 规则 3：文字裁切
      if (el.type === "text") {
        var metrics = TF.textMetrics(el);
        if (metrics.height > el.h + TOL || metrics.maxLineWidth > el.w + TOL) {
          var need = TF.fitFontSize(el);
          issues.push(issue("error", "TEXT_CLIP", el.id,
            "文字 “" + label(el) + "” 在当前盒子内被裁切（需要 " +
            Math.ceil(metrics.height) + "px 高，可用 " + Math.round(el.h) + "px）。",
            need < el.fontSize
              ? "自动修复可把字号从 " + el.fontSize + "px 降到 " + need + "px；或加宽加高文本框。"
              : "即使 4px 字号仍放不下，请加大文本框或精简文案。"));
        }
      }

      // 规则 4：图片资源
      if (el.type === "image" && !el.src) {
        issues.push(issue("error", "IMAGE_MISSING", el.id,
          "图片 “" + label(el) + "” 没有数据源，导出会出现占位破图。",
          "选中元素后重新导入图片，或删除该元素。"));
      }
    });

    // 规则 5：接近 90° 折叠时两侧面板投影极窄，给出预警
    if (Math.abs(Math.cos(project.foldAngle * Math.PI / 180)) < 0.18) {
      issues.push(issue("warn", "NARROW_FOLD", null,
        "当前折叠角 " + project.foldAngle + "° 接近 90°，侧面板投影宽度接近 0，预览仅用于检查折叠过程。",
        "导出成品建议切回 0° 展开状态。"));
    }
    return issues;
  }

  function label(el) {
    if (el.type === "text") return String(el.text || "文字").split("\n")[0].slice(0, 14);
    if (el.type === "image") return el.name || "图片";
    return el.shape === "ellipse" ? "椭圆" : "矩形";
  }
  function round(n) { return Math.round(n * 10) / 10; }

  // 自动修复：移动进面板/安全区、归一化负宽高、缩小字号；返回修复报告
  function autoFix(project) {
    var g = project.geometry;
    var report = [];
    project.elements.forEach(function (el) {
      var before = JSON.stringify({ x: el.x, y: el.y, w: el.w, h: el.h, fontSize: el.fontSize });
      var nr = TF.normalizeRect(el);
      el.x = nr.x; el.y = nr.y; el.w = nr.w; el.h = nr.h;

      var panel = TF.panelRect(g, el.panel);
      el.w = Math.min(el.w, panel.w);
      el.h = Math.min(el.h, panel.h);
      el.x = TF.clamp(el.x, panel.x, panel.x + panel.w - el.w);
      el.y = TF.clamp(el.y, panel.y, panel.y + panel.h - el.h);

      var safe = TF.safeRect(g, el.panel);
      if (el.w <= safe.w && el.h <= safe.h) {
        el.x = TF.clamp(el.x, safe.x, safe.x + safe.w - el.w);
        el.y = TF.clamp(el.y, safe.y, safe.y + safe.h - el.h);
      } else {
        report.push("“" + label(el) + "” 比安全区还大，已先收回面板内，请手动缩小尺寸。");
      }

      if (el.type === "text") {
        var metrics = TF.textMetrics(el);
        if (metrics.height > el.h + TOL || metrics.maxLineWidth > el.w + TOL) {
          var fit = TF.fitFontSize(el);
          if (fit < el.fontSize) {
            el.fontSize = fit;
            report.push("“" + label(el) + "” 字号自动降至 " + fit + "px。");
          } else {
            // 字号已到下限仍放不下：在面板安全区内尽量扩大文本框
            var safeBox = TF.safeRect(g, el.panel);
            var grown = false;
            if (el.h < safeBox.h) {
              el.y = safeBox.y;
              el.h = Math.min(safeBox.h, metrics.height);
              grown = true;
            }
            if (el.w < safeBox.w) {
              el.x = safeBox.x;
              el.w = safeBox.w;
              grown = true;
            }
            if (grown) report.push("“" + label(el) + "” 已在安全区内扩大文本框以容纳文字。");
            else report.push("“" + label(el) + "” 无法自动容纳，请精简文案或扩大面板。");
          }
        }
      }
      if (JSON.stringify({ x: el.x, y: el.y, w: el.w, h: el.h, fontSize: el.fontSize }) !== before) {
        report.unshift("“" + label(el) + "” 已归位到面板" + (el.panel + 1) + "。");
      }
      if (el.type === "image" && !el.src) {
        report.push("“" + label(el) + "” 缺少图片源，无法自动补齐，请重新导入图片或删除该元素。");
      }
    });
    return report;
  }

  function hasErrors(issues) { return issues.some(function (i) { return i.level === "error"; }); }

  return { validate: validate, autoFix: autoFix, hasErrors: hasErrors };
});
