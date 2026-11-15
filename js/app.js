/* 主控制器：装配模块、UI 绑定、导出流程、自检 */
(function () {
  "use strict";

  function App() {
    this.project = TF.defaultCase();
    this.history = new TF.History(120);
    this.history.reset(this.project);
    this.selectedId = null;
    this.statusTimer = null;
    this.cacheDom();
    this.view = new TF.CanvasView(this.dom.stage, {
      getGeometry: () => this.project.geometry,
      getElements: () => this.project.elements,
      getAngle: () => this.project.foldAngle,
      select: (id) => this.select(id),
      liveEdit: () => this.renderAll(false),
      commit: (msg) => this.commit(msg),
      editText: (id) => this.openTextEditor(id),
      requestRender: () => this.renderAll(false)
    });
    TF.setMeasureContext(this.view.ctx);
    this.bindGlobal();
    this.bindTopbar();
    this.bindSidebar();
    this.renderAll(true);
    this.setStatus("已载入默认案例，可直接编辑或点击“边界案例”查看压力场景。");
  }

  App.prototype.cacheDom = function () {
    var $ = (id) => document.getElementById(id);
    this.dom = {
      stage: $("stage"), foldAngle: $("fold-angle"), foldAngleVal: $("fold-angle-val"),
      kfName: $("kf-name"), kfList: $("kf-list"), elementList: $("element-list"),
      propsEmpty: $("props-empty"), propsForm: $("props-form"),
      checkList: $("check-list"), fontList: $("font-list"),
      status: $("status-text"), zoom: $("status-zoom"),
      textEditor: $("text-editor"), textArea: $("text-editor").querySelector("textarea"),
      fileLoad: $("file-load"), fileImage: $("file-image"), fileFont: $("file-font")
    };
  };

  App.prototype.renderAll = function (full) {
    this.view.setSelected(this.selectedId);
    this.view.render(this.project);
    if (full !== false) {
      this.renderAngle();
      this.renderKeyframes();
      this.renderElementList();
      this.renderProps();
      this.renderFonts();
      this.renderChecks();
    }
    this.dom.zoom.textContent = "缩放 " + Math.round(this.view.view.scale * 100) + "%";
    document.getElementById("btn-undo").disabled = !this.history.canUndo();
    document.getElementById("btn-redo").disabled = !this.history.canRedo();
  };

  App.prototype.commit = function (msg) {
    this.history.push(this.project);
    this.renderAll(true);
    if (msg) this.setStatus(msg + "（已记录，可撤销）");
  };

  App.prototype.undo = function () {
    var p = this.history.undo();
    if (!p) return this.setStatus("没有可撤销的操作。");
    this.project = p;
    if (!this.project.elements.some((el) => el.id === this.selectedId)) this.selectedId = null;
    this.view.resetFit();
    this.closeTextEditor();
    this.renderAll(true);
    this.setStatus("已撤销。");
  };

  App.prototype.redo = function () {
    var p = this.history.redo();
    if (!p) return this.setStatus("没有可重做的操作。");
    this.project = p;
    if (!this.project.elements.some((el) => el.id === this.selectedId)) this.selectedId = null;
    this.view.resetFit();
    this.closeTextEditor();
    this.renderAll(true);
    this.setStatus("已重做。");
  };

  App.prototype.setStatus = function (text) {
    this.dom.status.textContent = text;
    clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(() => { this.dom.status.textContent = "就绪"; }, 5000);
  };

  App.prototype.select = function (id) {
    this.selectedId = id;
    this.closeTextEditor();
    this.renderAll(true);
  };

  App.prototype.selected = function () {
    return this.project.elements.find((el) => el.id === this.selectedId) || null;
  };

  App.prototype.loadProject = function (project, message) {
    this.project = project;
    this.selectedId = null;
    this.history.reset(this.project);
    this.view.resetFit();
    this.closeTextEditor();
    (project.fonts || []).forEach((f) => TF.registerFont(f).catch(() => {}));
    this.renderAll(true);
    this.setStatus(message || "工程已载入。");
  };

  App.prototype.renderAngle = function () {
    this.dom.foldAngle.value = this.project.foldAngle;
    this.dom.foldAngleVal.textContent = this.project.foldAngle + "°";
  };

  App.prototype.renderKeyframes = function () {
    this.dom.kfList.innerHTML = "";
    this.project.keyframes.forEach((kf) => {
      var li = document.createElement("li");
      var name = document.createElement("span");
      name.className = "name";
      name.textContent = kf.name + " · " + kf.angle + "°";
      var go = document.createElement("button");
      go.className = "mini"; go.textContent = "跳转";
      go.onclick = () => {
        this.project.foldAngle = kf.angle;
        this.renderAll(true);
        this.setStatus("已切换到关键帧 “" + kf.name + "”（" + kf.angle + "°），元素保持世界坐标。");
      };
      var del = document.createElement("button");
      del.className = "del"; del.textContent = "×";
      del.onclick = () => {
        this.project.keyframes = this.project.keyframes.filter((k) => k.id !== kf.id);
        this.commit("删除关键帧");
      };
      li.append(name, go, del);
      this.dom.kfList.appendChild(li);
    });
  };

  App.prototype.renderFonts = function () {
    this.dom.fontList.innerHTML = "";
    this.project.fonts.forEach((f) => {
      var li = document.createElement("li");
      li.textContent = f.family + "（" + (f.name || "自定义") + "）";
      this.dom.fontList.appendChild(li);
    });
  };

  App.prototype.renderElementList = function () {
    var list = this.dom.elementList;
    list.innerHTML = "";
    this.project.elements.forEach((el, idx) => {
      var li = document.createElement("li");
      if (el.id === this.selectedId) li.className = "selected";
      var name = document.createElement("span");
      name.className = "name";
      var title = el.type === "text" ? String(el.text).split("\n")[0]
        : el.type === "image" ? (el.name || "图片")
        : (el.shape === "ellipse" ? "椭圆" : "矩形");
      name.textContent = (idx + 1) + ". [" + (el.panel + 1) + "] " +
        (title || el.type).slice(0, 16);
      name.onclick = () => this.select(el.id);
      var del = document.createElement("button");
      del.className = "del"; del.textContent = "×";
      del.onclick = () => {
        this.project.elements = this.project.elements.filter((e) => e.id !== el.id);
        if (this.selectedId === el.id) this.selectedId = null;
        this.commit("删除元素");
      };
      li.append(name, del);
      list.appendChild(li);
    });
  };

  App.prototype.renderProps = function () {
    var el = this.selected();
    this.dom.propsEmpty.hidden = !!el;
    this.dom.propsForm.hidden = !el;
    if (!el) { this.dom.propsForm.innerHTML = ""; return; }
    var g = this.project.geometry;
    var fields = [];
    fields.push(field("所属面板", selectHtml("panel", [0, 1, 2], el.panel,
      ["面板1", "面板2", "面板3"])));
    fields.push(twoCol(field("x", numberHtml("x", el.x)), field("y", numberHtml("y", el.y))));
    fields.push(twoCol(field("宽 w", numberHtml("w", el.w)),
      field("高 h", numberHtml("h", el.h))));
    if (el.type === "text") {
      fields.push(field("文字",
        '<textarea data-key="text" rows="4">' + TF.escapeXml(el.text) + "</textarea>"));
      fields.push(twoCol(field("字号", numberHtml("fontSize", el.fontSize, 4, 200)),
        field("行高倍数", numberHtml("lineHeight", el.lineHeight, 0.8, 3, 0.05))));
      var fontOptions = ["sans-serif", "serif", "monospace"]
        .concat(this.project.fonts.map((f) => f.family));
      fields.push(field("字体", selectHtml("fontFamily", fontOptions, el.fontFamily, fontOptions)));
      fields.push(twoCol(field("颜色", '<input type="color" data-key="color" value="' + el.color + '">'),
        field("对齐", selectHtml("align", ["left", "center", "right"], el.align,
          ["左", "中", "右"]))));
      fields.push(twoCol(
        field("粗体", '<input type="checkbox" data-key="bold" ' + (el.bold ? "checked" : "") + ">"),
        field("斜体", '<input type="checkbox" data-key="italic" ' + (el.italic ? "checked" : "") + ">")));
    }
    if (el.type === "image") {
      fields.push(field("适配方式", selectHtml("objectFit", ["cover", "contain", "fill"],
        el.objectFit, ["裁切填满", "完整包含", "拉伸填充"])));
      fields.push('<div class="field"><button id="prop-replace-img" class="mini">替换图片…</button></div>');
    }
    if (el.type === "shape") {
      fields.push(field("形状", selectHtml("shape", ["rect", "ellipse"], el.shape,
        ["圆角矩形", "椭圆"])));
      fields.push(twoCol(
        field("填充", '<input type="color" data-key="fill" value="' + el.fill + '">'),
        field("描边", '<input type="color" data-key="stroke" value="' + el.stroke + '">')));
      fields.push(twoCol(field("描边宽", numberHtml("strokeWidth", el.strokeWidth, 0, 30)),
        field("圆角", numberHtml("radius", el.radius, 0, Math.min(g.width, g.height)))));
    }
    this.dom.propsForm.innerHTML = fields.join("");
    var self = this;
    this.dom.propsForm.querySelectorAll("[data-key]").forEach((input) => {
      input.addEventListener("change", () => {
        var key = input.dataset.key;
        if (input.type === "checkbox") el[key] = input.checked;
        else if (input.type === "number" || ["panel", "fontSize", "lineHeight",
          "strokeWidth", "radius"].indexOf(key) >= 0) {
          el[key] = Number(input.value);
        } else el[key] = input.value;
        if (key === "panel") {
          var pr = TF.panelRect(this.project.geometry, el.panel);
          el.x = pr.x + this.project.geometry.margin;
          el.y = pr.y + this.project.geometry.margin;
        }
        self.commit("修改属性");
      });
    });
    var btn = document.getElementById("prop-replace-img");
    if (btn) btn.onclick = () => this.dom.fileImage.click();
  };

  function field(labelText, inner) {
    return '<div class="field"><label>' + labelText + "</label>" + inner + "</div>";
  }
  function twoCol(a, b) { return '<div class="field-2col">' + a + b + "</div>"; }
  function numberHtml(key, val, min, max, step) {
    return '<input type="number" data-key="' + key + '" value="' + val + '"' +
      (min != null ? ' min="' + min + '"' : "") +
      (max != null ? ' max="' + max + '"' : "") +
      (step != null ? ' step="' + step + '"' : "") + ">";
  }
  function selectHtml(key, values, current, labels) {
    return '<select data-key="' + key + '">' + values.map((v, i) =>
      '<option value="' + v + '"' +
      (String(v) === String(current) ? " selected" : "") + ">" +
      labels[i] + "</option>").join("") + "</select>";
  }

  App.prototype.openTextEditor = function (id) {
    var el = this.project.elements.find((e) => e.id === id);
    if (!el || el.type !== "text") return;
    this.select(id);
    var matrix = TF.elementScreenMatrix(this.project.geometry, el,
      this.project.foldAngle, this.view.view);
    var r = TF.normalizeRect(el);
    var tl = TF.applyPoint(matrix, { x: r.x, y: r.y });
    var br = TF.applyPoint(matrix, {
      x: r.x + r.w, y: r.y + Math.max(r.h, TF.textMetrics(el).height)
    });
    var editor = this.dom.textEditor;
    editor.hidden = false;
    editor.style.left = Math.min(tl.x, br.x) + "px";
    editor.style.top = Math.min(tl.y, br.y) + "px";
    editor.style.width = Math.abs(br.x - tl.x) + "px";
    editor.style.height = Math.abs(br.y - tl.y) + "px";
    var ta = this.dom.textArea;
    ta.value = el.text;
    ta.style.font = TF.fontString(el);
    ta.style.color = el.color;
    ta.style.textAlign = el.align;
    ta.focus();
    ta.onchange = () => {
      el.text = ta.value;
      this.commit("编辑文字");
      this.closeTextEditor();
    };
  };

  App.prototype.closeTextEditor = function () {
    this.dom.textEditor.hidden = true;
  };

  App.prototype.renderChecks = function () {
    var issues = TF.validate(this.project);
    var list = this.dom.checkList;
    list.innerHTML = "";
    if (!issues.length) {
      list.innerHTML = '<li class="ok">全部元素位于安全区内，文字无裁切。</li>';
      return issues;
    }
    issues.forEach((it) => {
      var li = document.createElement("li");
      li.className = it.level === "error" ? "error" : "warn";
      li.textContent = (it.level === "error" ? "✕ " : "⚠ ") + it.message +
        (it.fix ? " 修复：" + it.fix : "");
      if (it.elementId) li.onclick = () => this.select(it.elementId);
      list.appendChild(li);
    });
    return issues;
  };

  App.prototype.bindGlobal = function () {
    document.addEventListener("keydown", (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault(); this.undo();
      } else if ((e.ctrlKey || e.metaKey) &&
                 (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) {
        e.preventDefault(); this.redo();
      }
      if (e.key === "Delete" && this.selectedId) {
        this.project.elements = this.project.elements
          .filter((el) => el.id !== this.selectedId);
        this.selectedId = null;
        this.commit("删除元素");
      }
    });
    window.addEventListener("resize", () => this.renderAll(false));
  };

  App.prototype.bindTopbar = function () {
    var $ = (id) => document.getElementById(id);
    $("btn-undo").onclick = () => this.undo();
    $("btn-redo").onclick = () => this.redo();
    $("btn-new").onclick = () => this.loadProject(TF.createProject("新建三折页"), "已新建空白工程。");
    $("btn-default-case").onclick = () => this.loadProject(TF.defaultCase(), "已载入默认案例。");
    $("btn-edge-case").onclick = () => this.loadProject(TF.edgeCase(),
      "已载入边界案例：包含极端长文本、越界元素、缺失图片与负尺寸，请运行安全检查。");

    $("btn-save").onclick = () => {
      TF.saveFile(this.project);
      this.setStatus("工程已保存为 JSON（含模板、字体、图片 data URI、关键帧）。");
    };
    $("btn-load").onclick = () => this.dom.fileLoad.click();
    this.dom.fileLoad.onchange = async (e) => {
      try {
        var text = await TF.readTextFile(e.target.files[0]);
        this.loadProject(TF.deserialize(text),
          "工程已重新载入，模板/字体/图片/关键帧按文件恢复。");
      } catch (err) { this.modal("载入失败", err.message); }
      e.target.value = "";
    };
    $("btn-autosave").onclick = () => {
      var ok = TF.autosave(this.project);
      this.setStatus(ok
        ? "已暂存到浏览器 localStorage，刷新后可恢复。"
        : "暂存失败：存储空间不足，请改用“保存 JSON”下载文件。");
    };

    $("btn-svg").onclick = () => this.runExport("svg");
    $("btn-png").onclick = () => this.runExport("png");
    $("btn-selftest").onclick = () => this.runSelfTest();
  };

  App.prototype.bindSidebar = function () {
    var $ = (id) => document.getElementById(id);
    this.dom.foldAngle.addEventListener("input", (e) => {
      this.project.foldAngle = Number(e.target.value);
      this.renderAngle();
      this.renderAll(false);
    });
    this.dom.foldAngle.addEventListener("change", () => this.commit("调整折叠角度"));
    $("btn-angle-flat").onclick = () => this.setAngle(0);
    $("btn-angle-folded").onclick = () => this.setAngle(180);

    $("btn-kf-add").onclick = () => {
      var name = this.dom.kfName.value.trim() ||
        ("关键帧 " + (this.project.keyframes.length + 1));
      this.project.keyframes.push({
        id: TF.uid("kf"), name: name, angle: this.project.foldAngle
      });
      this.dom.kfName.value = "";
      this.commit("记录关键帧");
    };

    $("btn-add-text").onclick = () => this.addElement("text");
    $("btn-add-shape").onclick = () => this.addElement("shape");
    $("btn-add-image").onclick = () => this.dom.fileImage.click();
    this.dom.fileImage.onchange = async (e) => {
      var file = e.target.files[0];
      if (!file) return;
      try {
        var src = await TF.readDataURL(file);
        var el = this.selected() && this.selected().type === "image"
          ? this.selected() : TF.createImage(0, this.project.geometry);
        el.src = src; el.name = file.name;
        if (!this.project.elements.includes(el)) this.project.elements.push(el);
        this.selectedId = el.id;
        this.commit("导入图片");
      } catch (err) { this.modal("图片导入失败", err.message); }
      e.target.value = "";
    };

    $("btn-validate").onclick = () => {
      var issues = this.renderChecks();
      this.setStatus(issues.length
        ? "检查发现 " + issues.length + " 项问题，详见列表与修复建议。"
        : "检查通过：安全边距与文字裁切均正常。");
    };
    $("btn-autofix").onclick = () => {
      var report = TF.autoFix(this.project);
      this.commit("自动修复");
      this.modal("自动修复报告",
        report.length ? report.join("\n") : "未发现需要修复的问题。");
    };

    $("btn-save-template").onclick = () => {
      TF.saveTemplate(this.project);
      this.setStatus("模板已保存（本地），包含当前几何、元素、字体与关键帧。");
    };
    $("btn-apply-template").onclick = () => {
      var all = TF.listTemplates();
      if (!all.length) return this.setStatus("暂无已保存模板。");
      this.loadProject(TF.deepClone(all[0].project),
        "已套用模板 “" + all[0].name + "”。");
    };
    $("btn-add-font").onclick = () => this.dom.fileFont.click();
    this.dom.fileFont.onchange = async (e) => {
      var file = e.target.files[0];
      if (!file) return;
      try {
        var src = await TF.readDataURL(file);
        var family = "自定义_" +
          file.name.replace(/\.[^.]+$/, "").replace(/[^\w一-龥]/g, "");
        var font = { id: TF.uid("font"), family: family, name: file.name, src: src };
        await TF.registerFont(font);
        this.project.fonts.push(font);
        this.commit("添加字体");
      } catch (err) { this.modal("字体加载失败", err.message); }
      e.target.value = "";
    };
  };

  App.prototype.setAngle = function (a) {
    this.project.foldAngle = a;
    this.commit("切换折叠角度到 " + a + "°");
  };

  App.prototype.addElement = function (type) {
    var g = this.project.geometry;
    var el = type === "text" ? TF.createText(0, g) : TF.createShape(0, g);
    this.project.elements.push(el);
    this.selectedId = el.id;
    this.commit("添加" + (type === "text" ? "文字" : "图形"));
  };

  App.prototype.runExport = async function (kind) {
    var issues = TF.validate(this.project);
    var errors = issues.filter((i) => i.level === "error");
    if (errors.length) {
      var text = errors.map((i) =>
        "• " + i.message + "\n  修复：" + i.fix).join("\n");
      var proceed = await this.confirmModal(
        (kind === "svg" ? "SVG" : "PNG") + " 导出被安全检查拦截",
        "以下问题会导致内容被裁切或丢失：\n\n" + text +
        "\n\n建议先点击“自动修复”。是否仍要强制导出？");
      if (!proceed) { this.renderChecks(); return; }
    }
    var exportParams = {
      foldAngle: this.project.foldAngle,
      zoom: Math.round(this.view.view.scale * 100) / 100,
      view: Object.assign({}, this.view.view),
      exportedAt: new Date().toISOString(),
      forced: errors.length > 0
    };
    try {
      if (kind === "svg") {
        var svg = TF.buildSvg(this.project, { exportParams: exportParams });
        TF.download(TF.safeFilename(this.project.title) + ".svg", TF.svgBlob(svg));
        this.setStatus("SVG 已导出：文字/图片/图形均为可编辑矢量元素，当前角度与视图参数写入 metadata。");
      } else {
        var res = await TF.exportPng(this.project,
          { exportParams: exportParams, pixelScale: 2 });
        TF.download(TF.safeFilename(this.project.title) + ".png", res.blob);
        this.setStatus("PNG 已导出（" + res.width + "×" + res.height +
          "），由同一份可编辑 SVG 栅格化，与预览一致。");
      }
      if (issues.length) this.renderChecks();
    } catch (err) {
      this.modal("导出失败", err.message);
    }
  };

  App.prototype.modal = function (title, body) {
    return new Promise((resolve) => {
      var mask = document.createElement("div");
      mask.id = "modal-mask";
      mask.innerHTML = '<div class="modal"><h3></h3><pre></pre>' +
        '<div class="actions"><button class="btn-ok">知道了</button></div></div>';
      mask.querySelector("h3").textContent = title;
      mask.querySelector("pre").textContent = body;
      mask.querySelector(".btn-ok").onclick = () => { mask.remove(); resolve(true); };
      document.body.appendChild(mask);
    });
  };

  App.prototype.confirmModal = function (title, body) {
    return new Promise((resolve) => {
      var mask = document.createElement("div");
      mask.id = "modal-mask";
      mask.innerHTML = '<div class="modal"><h3></h3><pre></pre><div class="actions">' +
        '<button class="btn-cancel">取消并修复</button>' +
        '<button class="btn-force">强制导出</button></div></div>';
      mask.querySelector("h3").textContent = title;
      mask.querySelector("pre").textContent = body;
      mask.querySelector(".btn-cancel").onclick = () => { mask.remove(); resolve(false); };
      mask.querySelector(".btn-force").onclick = () => { mask.remove(); resolve(true); };
      document.body.appendChild(mask);
    });
  };

  App.prototype.runSelfTest = function () {
    var results = [];
    function check(name, fn) {
      try { fn(); results.push({ ok: true, name: name }); }
      catch (e) { results.push({ ok: false, name: name, error: e.message }); }
    }
    function assert(cond, msg) { if (!cond) throw new Error(msg || "断言失败"); }

    check("默认案例通过安全检查", () => {
      var d = TF.defaultCase();
      assert(!TF.hasErrors(TF.validate(d)), "默认案例存在错误项");
    });

    check("边界案例检出问题且含修复建议", () => {
      var e = TF.edgeCase();
      var codes = TF.validate(e).map((i) => i.code);
      ["TEXT_CLIP", "OUT_OF_PANEL", "IMAGE_MISSING", "NEGATIVE_SIZE"].forEach((c) =>
        assert(codes.indexOf(c) >= 0, "缺少问题类型 " + c));
      assert(TF.validate(e).every((i) => i.fix), "存在没有修复建议的问题");
    });

    check("自动修复后无错误且内容未丢失", () => {
      var e = TF.edgeCase();
      var before = e.elements.length;
      TF.autoFix(e);
      var codes = new Set(TF.validate(e).map((i) => i.code));
      assert(!codes.has("OUT_OF_PANEL"), "仍有元素越出面板/折线");
      assert(!codes.has("NEGATIVE_SIZE"), "仍有负尺寸");
      TF.validate(e).forEach((i) => assert(i.fix, "存在无修复建议的问题"));
      assert(e.elements.length === before, "元素数量变化，内容被静默删除");
      e.elements.forEach((el) => {
        assert(TF.rectContainsRect(TF.panelRect(e.geometry, el.panel),
          TF.normalizeRect(el), 1), "元素仍越出面板");
      });
    });

    check("切换角度元素保持世界坐标", () => {
      var d = TF.defaultCase();
      var snap = JSON.stringify(d.elements.map((el) =>
        ({ x: el.x, y: el.y, w: el.w, h: el.h })));
      [0, 45, 90, 135, 180].forEach((a) => {
        d.foldAngle = a;
        TF.panelDrawOrder(a);
        TF.panelFoldMatrix(d.geometry, 0, a);
      });
      assert(JSON.stringify(d.elements.map((el) =>
        ({ x: el.x, y: el.y, w: el.w, h: el.h }))) === snap,
        "元素世界坐标被折叠操作修改");
    });

    check("缩放/平移后元素仍在安全区", () => {
      var d = TF.defaultCase();
      var el = d.elements[0];
      [0.2, 1, 4].forEach((s) => {
        var view = { scale: s, panX: 123, panY: -45 };
        var m = TF.elementScreenMatrix(d.geometry, el, d.foldAngle, view);
        var worldPoint = { x: el.x + 17, y: el.y + 29 };
        var back = TF.applyPoint(TF.invert(m),
          TF.applyPoint(m, worldPoint));
        assert(Math.abs(back.x - worldPoint.x) < 1e-6 &&
          Math.abs(back.y - worldPoint.y) < 1e-6,
          "视图往返误差过大");
      });
      assert(!TF.hasErrors(TF.validate(d)), "默认案例在视图变化后出现错误");
    });

    check("几何重排后元素重新收敛到面板内", () => {
      var e = TF.edgeCase();
      TF.autoFix(e);
      e.geometry = { width: 120, height: 160, margin: 8 };
      TF.autoFix(e);
      e.elements.forEach((el) => {
        assert(TF.rectContainsRect(TF.panelRect(e.geometry, el.panel),
          TF.normalizeRect(el), 1), "重排后越界");
      });
    });

    check("JSON 保存/重载完全一致", () => {
      var d = TF.defaultCase();
      d.fonts.push({ id: "f1", family: "测试字体", name: "x.woff2",
        src: "data:font/woff2;base64,AAAA" });
      var restored = TF.deserialize(TF.serialize(d));
      assert(TF.serialize(restored) === TF.serialize(d), "往返序列化不一致");
      assert(restored.fonts[0].src === d.fonts[0].src, "字体数据丢失");
      assert(restored.keyframes.length === d.keyframes.length, "关键帧丢失");
      assert(restored.elements.some((el) =>
        el.type === "image" && el.src.indexOf("data:") === 0), "图片 data URI 丢失");
    });

    check("损坏 JSON 抛出带修复建议的错误", () => {
      var threw = false;
      try { TF.deserialize("{broken"); }
      catch (err) {
        threw = true;
        assert(err.message.indexOf("修复") >= 0, "错误信息缺少修复建议");
      }
      assert(threw, "损坏文件未报错");
    });

    check("SVG 为可编辑结构并保留参数", () => {
      var d = TF.defaultCase();
      var svg = TF.buildSvg(d, { exportParams: { foldAngle: d.foldAngle } });
      assert(svg.indexOf("<text") >= 0 && svg.indexOf("<image") >= 0 &&
        svg.indexOf("<rect") >= 0, "缺少可编辑矢量元素");
      assert(svg.indexOf("foreignObject") < 0, "出现位图/foreignObject 烧录");
      assert(svg.indexOf("&quot;foldAngle&quot;:0") >= 0, "导出未保留当前参数");
      var folded = TF.deepClone(d);
      folded.foldAngle = 120;
      var svg2 = TF.buildSvg(folded, {});
      assert(svg2 !== svg && svg2.indexOf("matrix(") >= 0, "折叠矩阵未作用于导出");
    });

    check("极端长文本在极小尺寸下给出可执行修复", () => {
      var e = TF.edgeCase();
      var txt = e.elements[0];
      var clips = TF.validate(e).filter((i) => i.code === "TEXT_CLIP");
      assert(clips.length >= 1, "未检出文字裁切");
      var fit = TF.fitFontSize(txt);
      assert(fit >= 4, "自适应字号越界");
      TF.autoFix(e);
      var left = TF.validate(e).filter((i) => i.code === "TEXT_CLIP");
      if (left.length) assert(left[0].fix.indexOf("文案") >= 0 ||
        left[0].fix.indexOf("面板") >= 0, "残留问题缺少修复建议");
      assert(txt.text.length > 100, "长文本内容被截断删除");
    });

    check("撤销/重做栈正确", () => {
      var h = new TF.History();
      var p = TF.defaultCase();
      h.reset(p);
      var a = TF.deepClone(p); a.title = "A"; h.push(a);
      var b = TF.deepClone(a); b.title = "B"; h.push(b);
      assert(h.undo().title === "A", "撤销顺序错误");
      assert(h.undo().title === TF.defaultCase().title, "撤销到初始状态错误");
      assert(h.redo().title === "A", "重做错误");
      assert(h.redo().title === "B", "重做应到达最新状态");
    });

    check("Canvas 渲染与命中检测有效", () => {
      this.view.render(this.project);
      var el = this.project.elements[0];
      var r = TF.normalizeRect(el);
      var center = TF.applyPoint(
        TF.elementScreenMatrix(this.project.geometry, el,
          this.project.foldAngle, this.view.view),
        { x: r.x + r.w / 2, y: r.y + r.h / 2 });
      var hit = TF.hitTest(this.project.geometry, this.project.elements,
        this.project.foldAngle, this.view.view, center);
      assert(hit && hit.id === el.id, "中心点命中检测失败");
    });

    var failed = results.filter((r) => !r.ok);
    var body = results.map((r) =>
      (r.ok ? "✓ " : "✕ ") + r.name + (r.error ? " — " + r.error : "")).join("\n");
    this.modal("自检结果：" + (results.length - failed.length) +
      "/" + results.length + " 通过", body);
    this.setStatus(failed.length ? "自检发现失败项，请查看报告。" : "全部自检通过。");
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => new App());
  } else {
    new App();
  }
})();
