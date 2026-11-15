/* 工程存取：JSON 序列化/校验/迁移、本地暂存、模板、字体注册 */
(function (root, factory) {
  var api = factory(root.TF);
  if (typeof module === "object" && module.exports) module.exports = api;
  Object.assign(root.TF, api);
})(typeof self !== "undefined" ? self : this, function (TF) {
  "use strict";

  var AUTOSAVE_KEY = "trifold.autosave.v1";
  var TEMPLATE_KEY = "trifold.templates.v1";

  function serialize(project) {
    return JSON.stringify(project, null, 2);
  }

  function isFiniteNumber(v) { return typeof v === "number" && isFinite(v); }

  // 结构校验 + 旧版本迁移；失败抛出带修复建议的错误
  function deserialize(text) {
    var data;
    try { data = JSON.parse(text); }
    catch (e) {
      throw new Error("JSON 解析失败：" + e.message + "。修复方法：确认文件由本编辑器“保存 JSON”生成，未被手工截断或改名。");
    }
    if (!data || typeof data !== "object") {
      throw new Error("工程文件根节点不是对象。修复方法：重新导出一份完整 JSON 后再载入。");
    }
    if (!isFiniteNumber(data.version)) {
      throw new Error("缺少 version 字段，无法判断文件版本。修复方法：使用当前版本重新保存工程。");
    }
    if (data.version > TF.SCHEMA_VERSION) {
      throw new Error("工程文件版本 v" + data.version + " 高于当前支持的 v" + TF.SCHEMA_VERSION +
        "。修复方法：升级编辑器，或在新版本中另存为兼容格式。");
    }
    if (!data.geometry || !isFiniteNumber(data.geometry.width) || !isFiniteNumber(data.geometry.height)) {
      throw new Error("geometry 尺寸缺失或非法。修复方法：补齐 width/height（正数）后重试。");
    }
    if (!(data.elements instanceof Array)) {
      throw new Error("elements 必须是数组。修复方法：恢复为编辑器导出的元素数组结构。");
    }
    var known = ["text", "image", "shape"];
    data.elements.forEach(function (el, i) {
      if (!el || known.indexOf(el.type) < 0) {
        throw new Error("第 " + (i + 1) + " 个元素类型未知：" + (el && el.type) +
          "。修复方法：删除该元素或改为 text/image/shape。");
      }
      if (!isFiniteNumber(el.x) || !isFiniteNumber(el.y)) {
        throw new Error("第 " + (i + 1) + " 个元素坐标非法。修复方法：在属性面板重新设置 x/y。");
      }
    });
    data.keyframes = data.keyframes instanceof Array ? data.keyframes : [];
    data.fonts = data.fonts instanceof Array ? data.fonts : [];
    data.foldAngle = isFiniteNumber(data.foldAngle) ? TF.clamp(data.foldAngle, 0, 180) : 0;
    return data;
  }

  function saveFile(project) {
    var blob = new Blob([serialize(project)], { type: "application/json" });
    TF.download(safeFilename(project.title) + ".json", blob);
  }

  function safeFilename(name) {
    return String(name || "trifold-project").replace(/[\\/:*?"<>|]+/g, "_");
  }

  function readTextFile(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(new Error("文件读取失败，请重试或更换文件。")); };
      fr.readAsText(file);
    });
  }

  function readDataURL(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(new Error("图片读取失败，请更换文件。")); };
      fr.readAsDataURL(file);
    });
  }

  function autosave(project) {
    try { localStorage.setItem(AUTOSAVE_KEY, serialize(project)); return true; }
    catch (e) { return false; } // 容量超限（大图）时静默由调用方提示
  }
  function loadAutosave() {
    var raw = localStorage.getItem(AUTOSAVE_KEY);
    return raw ? deserialize(raw) : null;
  }
  function clearAutosave() { localStorage.removeItem(AUTOSAVE_KEY); }

  function listTemplates() {
    try { return JSON.parse(localStorage.getItem(TEMPLATE_KEY) || "[]"); }
    catch (e) { return []; }
  }
  function saveTemplate(project) {
    var all = listTemplates();
    all = all.filter(function (t) { return t.name !== project.title; });
    all.unshift({ name: project.title, savedAt: new Date().toISOString(), project: TF.deepClone(project) });
    localStorage.setItem(TEMPLATE_KEY, JSON.stringify(all.slice(0, 20)));
  }

  // 注册自定义字体；成功返回 family 名
  function registerFont(font) {
    if (typeof document === "undefined" || !("FontFace" in self)) {
      return Promise.resolve(font.family);
    }
    return new Promise(function (resolve, reject) {
      var ff = new FontFace(font.family, "url(" + font.src + ")");
      ff.load().then(function (loaded) {
        self.fonts.add(loaded);
        resolve(font.family);
      }).catch(function () {
        reject(new Error("字体 “" + font.family + "” 加载失败。修复方法：确认文件为 woff/woff2/ttf/otf 且未损坏。"));
      });
    });
  }

  return {
    serialize: serialize, deserialize: deserialize,
    saveFile: saveFile, readTextFile: readTextFile, readDataURL: readDataURL,
    safeFilename: safeFilename,
    autosave: autosave, loadAutosave: loadAutosave, clearAutosave: clearAutosave,
    listTemplates: listTemplates, saveTemplate: saveTemplate,
    registerFont: registerFont
  };
});
