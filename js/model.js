/* 数据模型：工程、元素、默认案例、边界案例 */
(function (root, factory) {
  var api = factory(root.TF);
  if (typeof module === "object" && module.exports) module.exports = api;
  Object.assign(root.TF, api);
})(typeof self !== "undefined" ? self : this, function (TF) {
  "use strict";

  var SCHEMA_VERSION = 1;
  var PANEL_COUNT = 3;

  function defaultGeometry() {
    return { width: 300, height: 600, margin: 24 };
  }

  function createProject(title) {
    return {
      version: SCHEMA_VERSION,
      title: title || "未命名三折页",
      geometry: defaultGeometry(),
      foldAngle: 0,
      keyframes: [
        { id: TF.uid("kf"), name: "展开", angle: 0 },
        { id: TF.uid("kf"), name: "半折", angle: 90 },
        { id: TF.uid("kf"), name: "折叠", angle: 180 }
      ],
      fonts: [],
      elements: []
    };
  }

  function panelOrigin(geometry, panel) {
    return { x: panel * geometry.width, y: 0 };
  }

  function panelRect(geometry, panel) {
    var o = panelOrigin(geometry, panel);
    return { x: o.x, y: o.y, w: geometry.width, h: geometry.height };
  }

  function safeRect(geometry, panel) {
    var r = panelRect(geometry, panel);
    var m = geometry.margin;
    return { x: r.x + m, y: r.y + m, w: r.w - m * 2, h: r.h - m * 2 };
  }

  function foldLines(geometry) {
    return [
      { x: geometry.width, y: 0, h: geometry.height },
      { x: geometry.width * 2, y: 0, h: geometry.height }
    ];
  }

  function createText(panel, geometry, partial) {
    var s = safeRect(geometry, panel);
    return Object.assign({
      id: TF.uid("txt"),
      type: "text",
      panel: panel,
      x: s.x + 8, y: s.y + 8, w: s.w - 16, h: 80,
      text: "双击编辑文字",
      fontSize: 18,
      fontFamily: "sans-serif",
      color: "#1f2933",
      bold: false, italic: false,
      align: "left", lineHeight: 1.35
    }, partial || {});
  }

  function createImage(panel, geometry, partial) {
    var s = safeRect(geometry, panel);
    var w = Math.min(180, s.w - 16);
    return Object.assign({
      id: TF.uid("img"),
      type: "image",
      panel: panel,
      x: s.x + 8, y: s.y + 120,
      w: w, h: Math.round(w * 0.62),
      src: "", name: "",
      objectFit: "cover"
    }, partial || {});
  }

  function createShape(panel, geometry, partial) {
    var s = safeRect(geometry, panel);
    return Object.assign({
      id: TF.uid("shp"),
      type: "shape",
      shape: "rect",
      panel: panel,
      x: s.x + 8, y: s.y + 260,
      w: 120, h: 60,
      fill: "#93c5fd", stroke: "#1d4ed8", strokeWidth: 2,
      radius: 8
    }, partial || {});
  }

  // 内置占位图：SVG data URI，无网络依赖
  function placeholderImage(label, c1, c2) {
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="' + c1 + '"/>' +
      '<stop offset="1" stop-color="' + c2 + '"/></linearGradient></defs>' +
      '<rect width="320" height="200" fill="url(#g)"/>' +
      '<text x="160" y="108" font-size="26" fill="rgba(255,255,255,.92)" ' +
      'text-anchor="middle" font-family="sans-serif">' + TF.escapeXml(label) + "</text></svg>";
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  function defaultCase() {
    var p = createProject("智能保温杯 · 三折产品说明");
    var g = p.geometry;
    p.elements = [
      createText(0, g, {
        x: 24 + 8, y: 40, w: g.width - 64,
        h: 90, text: "智能保温杯\nTHERMO CUP", fontSize: 26, bold: true, color: "#0f172a"
      }),
      createText(0, g, {
        y: 150, h: 70, text: "12 小时保温 · 温度显示\n316 不锈钢 · 防漏设计", fontSize: 15
      }),
      createImage(0, g, { y: 280, src: placeholderImage("产品主图", "#2563eb", "#06b6d4"), name: "产品主图" }),
      createText(1, g, {
        x: g.width + 32, y: 40, w: g.width - 64,
        h: 40, text: "产品特点", fontSize: 22, bold: true, color: "#1d4ed8"
      }),
      createText(1, g, {
        x: g.width + 32, y: 96, w: g.width - 64,
        h: 150, text: "• 杯盖 LED 实时测温\n• 双层真空隔热结构\n• 大容量 500ml\n• 轻量便携，车载适用", fontSize: 14, lineHeight: 1.6
      }),
      createShape(1, g, {
        x: g.width + 32, y: 330, w: g.width - 64, h: 90,
        fill: "#dbeafe", stroke: "#2563eb", radius: 12
      }),
      createText(1, g, {
        x: g.width + 44, y: 350, w: g.width - 88,
        h: 60, text: "规格参数\n容量 500ml / 重量 280g", fontSize: 13, color: "#1e3a8a"
      }),
      createText(2, g, {
        x: g.width * 2 + 32, y: 40, w: g.width - 64,
        h: 40, text: "使用与保养", fontSize: 22, bold: true, color: "#047857"
      }),
      createImage(2, g, {
        x: g.width * 2 + 32, y: 100, w: g.width - 64, h: 150,
        src: placeholderImage("使用场景", "#059669", "#84cc16"), name: "使用场景"
      }),
      createText(2, g, {
        x: g.width * 2 + 32, y: 280, w: g.width - 64,
        h: 110, text: "首次使用请温水清洗；\n避免微波炉加热；\n长时间不用请保持干燥。", fontSize: 14, lineHeight: 1.6
      }),
      createText(2, g, {
        x: g.width * 2 + 32, y: 470, w: g.width - 64,
        h: 30, text: "服务热线 400-000-0000", fontSize: 13, bold: true, color: "#065f46"
      })
    ];
    return p;
  }

  function edgeCase() {
    var p = createProject("边界压力案例");
    p.geometry = { width: 80, height: 120, margin: 4 };
    var g = p.geometry;
    var longText = new Array(40).join("极端长文本压力测试ABC123。");
    p.elements = [
      // 1. 极端长文本 + 大字号，超出安全区，应报错并给出修复建议
      createText(0, g, {
        x: 6, y: 6, w: 68, h: 60, text: longText, fontSize: 24, bold: true
      }),
      // 2. 元素越过折线（右边界进入中间面板）
      createText(0, g, {
        x: 40, y: 70, w: 70, h: 20, text: "跨折线文字", fontSize: 10
      }),
      // 3. 图片缺失数据源
      createImage(1, g, { x: g.width + 8, y: 8, w: 64, h: 40, src: "", name: "缺失图片" }),
      // 4. 图形超出面板下边界
      createShape(2, g, {
        x: g.width * 2 + 10, y: 96, w: 60, h: 50,
        fill: "#fca5a5", stroke: "#b91c1c"
      }),
      // 5. 极小安全区内的正常文字（对照组）
      createText(2, g, {
        x: g.width * 2 + 6, y: 8, w: 68, h: 16, text: "OK", fontSize: 8
      }),
      // 6. 负宽高元素
      createShape(1, g, {
        x: g.width + 40, y: 60, w: -30, h: -20, fill: "#fde68a", stroke: "#b45309"
      })
    ];
    p.keyframes.push({ id: TF.uid("kf"), name: "微缩检查", angle: 45 });
    return p;
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION, PANEL_COUNT: PANEL_COUNT,
    defaultGeometry: defaultGeometry, createProject: createProject,
    panelOrigin: panelOrigin, panelRect: panelRect, safeRect: safeRect, foldLines: foldLines,
    createText: createText, createImage: createImage, createShape: createShape,
    placeholderImage: placeholderImage,
    defaultCase: defaultCase, edgeCase: edgeCase
  };
});
