/* 工程数据模型：结构定义、默认/边界案例、序列化与载入校验。
 * 工程可完整序列化为 JSON，保存后重新载入可一致恢复（含模板、字体、图片、关键帧）。 */
(function (global) {
  'use strict';

  var SCHEMA_VERSION = 1;

  function uid() {
    return 'el_' + Math.random().toString(36).slice(2, 9);
  }

  // ---- 元素工厂 ----
  function textElement(opts) {
    return Object.assign({
      id: uid(), type: 'text', name: '文字',
      x: 540, y: 300, // 中心点坐标
      text: '双击编辑文字',
      fontFamily: 'system-ui', fontSize: 64, bold: false, italic: false,
      color: '#ffffff', align: 'center', maxWidth: 900, lineHeight: 1.3,
      rotation: 0, opacity: 1,
      anim: null
    }, opts);
  }

  function shapeElement(shape, opts) {
    return Object.assign({
      id: uid(), type: shape, name: shape === 'rect' ? '矩形' : '椭圆',
      x: 300, y: 300, w: 240, h: 160, radius: 0,
      fill: '#ff8a3d', stroke: null, strokeWidth: 0,
      rotation: 0, opacity: 1, anim: null
    }, opts);
  }

  function imageElement(opts) {
    return Object.assign({
      id: uid(), type: 'image', name: '图片',
      x: 540, y: 700, w: 300, h: 300, src: null,
      rotation: 0, opacity: 1, anim: null
    }, opts);
  }

  function qrElement(opts) {
    return Object.assign({
      id: uid(), type: 'qr', name: '二维码',
      x: 540, y: 1000, size: 420,
      data: 'https://example.com/event',
      fg: '#1a1a2e', bg: '#ffffff',
      icon: { type: 'emoji', text: '🎉', scale: 0.22, image: null },
      rotation: 0, opacity: 1, anim: null
    }, opts);
  }

  function baseProject() {
    return {
      app: 'qr-poster-studio',
      schemaVersion: SCHEMA_VERSION,
      canvas: { width: 1080, height: 1440, safeMarginRatio: 0.05 },
      background: {
        color: '#232a68', texture: 'dots',
        textureColor: '#ffffff', textureOpacity: 0.07, textureSize: 28
      },
      fonts: [], // {name, dataUrl} 自定义字体，随工程保存
      elements: [],
      exportParams: { format: 'png', scale: 2 } // 保留最近一次导出参数
    };
  }

  // ---- 默认案例 ----
  function defaultProject() {
    var p = baseProject();
    p.templateName = '夏日音乐节（默认案例）';
    p.elements = [
      shapeElement('ellipse', {
        name: '装饰圆', x: 920, y: 180, w: 320, h: 320,
        fill: '#ffb03d', opacity: 0.85
      }),
      shapeElement('rect', {
        name: '标题底板', x: 540, y: 300, w: 880, h: 180, radius: 24,
        fill: '#12163f', opacity: 0.6
      }),
      textElement({
        name: '主标题', x: 540, y: 270, text: '夏日音乐节',
        fontSize: 110, bold: true, color: '#ffffff'
      }),
      textElement({
        name: '副标题', x: 540, y: 380, text: '2026.07.18 · 海滨公园 · 18:00 入场',
        fontSize: 40, color: '#ffd166'
      }),
      textElement({
        name: '说明', x: 540, y: 1250, maxWidth: 800,
        text: '扫码购票，凭二维码入场。长按保存本海报可分享给好友。',
        fontSize: 32, color: '#cdd6ff'
      }),
      qrElement({
        x: 540, y: 980, size: 420,
        data: 'https://example.com/event/summer-music-2026?src=poster',
        icon: { type: 'emoji', text: '🎵', scale: 0.22, image: null },
        anim: {
          duration: 2.4, loop: true,
          keyframes: [
            { t: 0, scale: 1, opacity: 1 },
            { t: 0.5, scale: 1.04, opacity: 1 },
            { t: 1, scale: 1, opacity: 1 }
          ]
        }
      })
    ];
    return p;
  }

  // ---- 边界案例：极端长文本 + 极小二维码 + 越界元素 + 低对比度 ----
  function edgeProject() {
    var p = baseProject();
    p.templateName = '边界压力测试（边界案例）';
    p.background.texture = 'grid';
    var longText = '这是一段用于压力测试的超长标题：' +
      '二维码海报编辑器需要优雅地处理极端输入而不是静默丢失内容。'.repeat(8);
    p.elements = [
      textElement({
        name: '超长标题', x: 540, y: 200, text: longText,
        fontSize: 48, maxWidth: 1000, color: '#ffffff'
      }),
      qrElement({
        name: '极小二维码', x: 120, y: 1320, size: 60,
        data: 'https://example.com/tiny',
        fg: '#8f9bd8', // 与背景接近 → 触发对比度告警
        icon: { type: 'emoji', text: '🎉', scale: 0.45, image: null } // 图标过大 → 触发告警
      }),
      shapeElement('rect', {
        name: '越界装饰', x: 1060, y: 60, w: 220, h: 120, fill: '#ff5d5d'
      }),
      textElement({
        name: '贴边文字', x: 160, y: 1420, text: '贴近画布边缘的文字',
        fontSize: 30, align: 'left', maxWidth: 0, color: '#9fe8ff'
      })
    ];
    return p;
  }

  // ---- 序列化 / 载入 ----
  function serialize(project) {
    return JSON.stringify(project, null, 2);
  }

  var ELEMENT_TYPES = ['text', 'rect', 'ellipse', 'image', 'qr'];

  // 载入时校验并补全缺省值；结构不合法时抛出带修复提示的错误。
  function deserialize(json) {
    var p;
    try {
      p = typeof json === 'string' ? JSON.parse(json) : json;
    } catch (e) {
      throw new Error('文件不是合法的 JSON：' + e.message + '。请确认选择的是本工具导出的工程文件。');
    }
    if (!p || p.app !== 'qr-poster-studio') {
      throw new Error('不是本工具的工程文件（缺少 app 标识）。请使用「保存工程」生成的 JSON 文件。');
    }
    if (typeof p.schemaVersion !== 'number' || p.schemaVersion > SCHEMA_VERSION) {
      throw new Error('工程版本过新（v' + p.schemaVersion + '），当前编辑器支持到 v' + SCHEMA_VERSION + '。请升级编辑器。');
    }
    var base = baseProject();
    p.canvas = Object.assign(base.canvas, p.canvas);
    p.background = Object.assign(base.background, p.background);
    p.exportParams = Object.assign(base.exportParams, p.exportParams);
    p.fonts = Array.isArray(p.fonts) ? p.fonts : [];
    if (!Array.isArray(p.elements)) p.elements = [];
    p.elements = p.elements.filter(function (el) {
      return el && ELEMENT_TYPES.indexOf(el.type) >= 0;
    }).map(function (el) {
      var factory = el.type === 'text' ? textElement
        : el.type === 'qr' ? qrElement
        : el.type === 'image' ? imageElement
        : function (o) { return shapeElement(el.type, o); };
      var merged = factory(el);
      merged.id = el.id || merged.id;
      if (el.type === 'qr') merged.icon = Object.assign(qrElement().icon, el.icon || {});
      if (el.anim && Array.isArray(el.anim.keyframes)) {
        merged.anim = {
          duration: el.anim.duration || 2,
          loop: !!el.anim.loop,
          keyframes: el.anim.keyframes
            .filter(function (k) { return typeof k.t === 'number'; })
            .sort(function (a, b) { return a.t - b.t; })
        };
      } else {
        merged.anim = null;
      }
      return merged;
    });
    return p;
  }

  var api = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    uid: uid,
    textElement: textElement,
    shapeElement: shapeElement,
    imageElement: imageElement,
    qrElement: qrElement,
    defaultProject: defaultProject,
    edgeProject: edgeProject,
    serialize: serialize,
    deserialize: deserialize
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.PosterModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
