/* Canvas 视图：折面、安全区、元素预览与指针交互 */
(function (root, factory) {
  var api = factory(root.TF);
  if (typeof module === "object" && module.exports) module.exports = api;
  Object.assign(root.TF, api);
})(typeof self !== "undefined" ? self : this, function (TF) {
  "use strict";

  function CanvasView(canvas, callbacks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.cb = callbacks || {};
    this.view = { scale: 1, panX: 40, panY: 40 };
    this.imageCache = {};
    this.selectedId = null;
    this.drag = null;
    this.spaceDown = false;
    this.showSafe = true;
    this.showFoldLines = true;
    this.fitNext = true;
    this.bindEvents();
  }

  CanvasView.prototype.ensureDpr = function () {
    var dpr = self.devicePixelRatio || 1;
    var rect = this.canvas.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width));
    var h = Math.max(1, Math.round(rect.height));
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cssW = w; this.cssH = h;
  };

  CanvasView.prototype.fitView = function (geometry, angleDeg) {
    this.ensureDpr();
    var span = this.foldedSpan(geometry, angleDeg);
    var pad = 60;
    var sx = (this.cssW - pad * 2) / span.w;
    var sy = (this.cssH - pad * 2) / span.h;
    this.view.scale = Math.min(sx, sy);
    this.view.panX = (this.cssW - span.w * this.view.scale) / 2 - span.x * this.view.scale;
    this.view.panY = (this.cssH - span.h * this.view.scale) / 2 - span.y * this.view.scale;
  };

  CanvasView.prototype.foldedSpan = function (geometry, angleDeg) {
    var bounds = [];
    for (var p = 0; p < TF.PANEL_COUNT; p++) {
      var m = TF.panelFoldMatrix(geometry, p, angleDeg);
      bounds.push(TF.transformRect(m, { x: 0, y: 0, w: geometry.width, h: geometry.height }));
    }
    var xs = bounds.map(function (b) { return b.x; });
    var ys = bounds.map(function (b) { return b.y; });
    var x2 = bounds.map(function (b) { return b.x + b.w; });
    var y2 = bounds.map(function (b) { return b.y + b.h; });
    var x = Math.min.apply(null, xs), y = Math.min.apply(null, ys);
    return { x: x, y: y, w: Math.max.apply(null, x2) - x, h: Math.max.apply(null, y2) - y };
  };

  CanvasView.prototype.getImage = function (src) {
    if (!src) return null;
    if (!this.imageCache[src]) {
      var img = new Image();
      img.src = src;
      this.imageCache[src] = { img: img, ready: img.complete };
      var self = this;
      img.onload = function () {
        self.imageCache[src].ready = true;
        self.cb.requestRender && self.cb.requestRender();
      };
      img.onerror = function () {
        self.imageCache[src].error = true;
        self.cb.requestRender && self.cb.requestRender();
      };
    }
    return this.imageCache[src];
  };

  CanvasView.prototype.render = function (project) {
    this.ensureDpr();
    var ctx = this.ctx;
    ctx.clearRect(0, 0, this.cssW, this.cssH);
    ctx.fillStyle = "#d9dee5";
    ctx.fillRect(0, 0, this.cssW, this.cssH);
    if (this.fitNext) {
      this.fitView(project.geometry, project.foldAngle);
      this.fitNext = false;
    }
    var order = TF.panelDrawOrder(project.foldAngle);
    for (var i = 0; i < order.length; i++) {
      this.drawPanel(project.geometry, order[i], project.foldAngle);
    }
    for (var j = 0; j < order.length; j++) {
      this.drawPanelElements(project, order[j]);
    }
    if (this.showFoldLines) this.drawFoldLines(project.geometry);
  };

  CanvasView.prototype.withMatrix = function (m, fn) {
    var ctx = this.ctx;
    ctx.save();
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    fn();
    ctx.restore();
  };

  CanvasView.prototype.drawPanel = function (geometry, panel, angleDeg) {
    var ctx = this.ctx;
    var self = this;
    var m = TF.multiply(TF.viewMatrix(this.view),
      TF.panelFoldMatrix(geometry, panel, angleDeg));
    this.withMatrix(m, function () {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, geometry.width, geometry.height);
      ctx.strokeStyle = "#9aa5b1";
      ctx.lineWidth = 1 / self.view.scale;
      ctx.strokeRect(0, 0, geometry.width, geometry.height);
      if (self.showSafe) {
        var mg = geometry.margin;
        ctx.save();
        ctx.setLineDash([6 / self.view.scale, 4 / self.view.scale]);
        ctx.strokeStyle = "#2563eb";
        ctx.strokeRect(mg, mg, geometry.width - mg * 2, geometry.height - mg * 2);
        ctx.restore();
      }
      var shade = TF.panelShading(angleDeg);
      if (shade > 0.01) {
        ctx.fillStyle = "rgba(15,23,42," + shade.toFixed(3) + ")";
        ctx.fillRect(0, 0, geometry.width, geometry.height);
      }
      ctx.fillStyle = "rgba(123,135,148,.55)";
      ctx.font = "11px sans-serif";
      ctx.fillText("面板 " + (panel + 1), 6, geometry.height - 8);
    });
  };

  CanvasView.prototype.drawPanelElements = function (project, panel) {
    var self = this;
    project.elements.filter(function (el) { return el.panel === panel; }).forEach(function (el) {
      self.drawElement(project, el);
    });
  };

  CanvasView.prototype.drawElement = function (project, el) {
    var ctx = this.ctx;
    var m = TF.elementScreenMatrix(project.geometry, el, project.foldAngle, this.view);
    var r = TF.normalizeRect(el);
    var translate = [1, 0, 0, 1, r.x, r.y];
    var self = this;
    this.withMatrix(TF.multiply(m, translate), function () {
      if (el.type === "shape") self.drawShape(el, r);
      if (el.type === "image") self.drawImage(el, r);
      if (el.type === "text") self.drawText(el);
      if (el.id === self.selectedId) {
        ctx.save();
        ctx.strokeStyle = "#2563eb";
        ctx.lineWidth = 1.5 / self.view.scale;
        ctx.strokeRect(0, 0, r.w, r.h);
        ctx.restore();
      }
    });
    if (el.id === this.selectedId) this.drawHandles(project, el);
  };

  CanvasView.prototype.drawShape = function (el, r) {
    var ctx = this.ctx;
    ctx.beginPath();
    var rad = Math.min(el.radius || 0, r.w / 2, r.h / 2);
    if (el.shape === "ellipse") {
      ctx.ellipse(r.w / 2, r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
    } else {
      roundRectPath(ctx, 0, 0, r.w, r.h, rad);
    }
    if (el.fill) { ctx.fillStyle = el.fill; ctx.fill(); }
    if (el.strokeWidth > 0) {
      ctx.strokeStyle = el.stroke;
      ctx.lineWidth = el.strokeWidth / this.view.scale;
      ctx.stroke();
    }
  };

  CanvasView.prototype.drawImage = function (el, r) {
    var ctx = this.ctx;
    var entry = this.getImage(el.src);
    if (!el.src || !entry || entry.error || !entry.ready) {
      ctx.fillStyle = "#f1f5f9";
      ctx.fillRect(0, 0, r.w, r.h);
      ctx.strokeStyle = "#b91c1c";
      ctx.lineWidth = 1 / this.view.scale;
      ctx.setLineDash([4 / this.view.scale, 3 / this.view.scale]);
      ctx.strokeRect(0, 0, r.w, r.h);
      ctx.setLineDash([]);
      ctx.fillStyle = "#b91c1c";
      ctx.font = (10 / this.view.scale) + "px sans-serif";
      ctx.fillText("图片缺失", 4 / this.view.scale, 14 / this.view.scale);
      return;
    }
    var img = entry.img;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, r.w, r.h);
    ctx.clip();
    if (el.objectFit === "fill") {
      ctx.drawImage(img, 0, 0, r.w, r.h);
    } else {
      var ir = img.width / img.height, br = r.w / r.h;
      var dw, dh, dx, dy;
      if (el.objectFit === "contain") {
        if (ir > br) { dw = r.w; dh = r.w / ir; dx = 0; dy = (r.h - dh) / 2; }
        else { dh = r.h; dw = r.h * ir; dy = 0; dx = (r.w - dw) / 2; }
      } else if (ir > br) {
        dh = r.h; dw = r.h * ir; dy = 0; dx = (r.w - dw) / 2;
      } else {
        dw = r.w; dh = r.w / ir; dx = 0; dy = (r.h - dh) / 2;
      }
      ctx.drawImage(img, dx, dy, dw, dh);
    }
    ctx.restore();
    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 1 / this.view.scale;
    ctx.strokeRect(0, 0, r.w, r.h);
  };

  CanvasView.prototype.drawText = function (el) {
    var ctx = this.ctx;
    var metrics = TF.textMetrics(el);
    ctx.font = TF.fontString(el);
    ctx.fillStyle = el.color;
    ctx.textBaseline = "top";
    var lh = metrics.lineHeight;
    metrics.lines.forEach(function (line, i) {
      var x = 0;
      if (el.align === "center") x = (el.w - TF.measureText(line, el)) / 2;
      if (el.align === "right") x = el.w - TF.measureText(line, el);
      ctx.fillText(line, x, i * lh);
    });
  };

  CanvasView.prototype.drawHandles = function (project, el) {
    var ctx = this.ctx;
    var hs = TF.handlePositions(project.geometry, el, project.foldAngle, this.view);
    var size = 5;
    Object.keys(hs).forEach(function (k) {
      var p = hs[k];
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "#2563eb";
      ctx.lineWidth = 1;
      ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
      ctx.strokeRect(p.x - size / 2, p.y - size / 2, size, size);
    });
  };

  CanvasView.prototype.drawFoldLines = function (geometry) {
    var ctx = this.ctx;
    var m = TF.viewMatrix(this.view);
    TF.foldLines(geometry).forEach(function (line) {
      var top = TF.applyPoint(m, { x: line.x, y: line.y });
      var bottom = TF.applyPoint(m, { x: line.x, y: line.y + line.h });
      ctx.save();
      ctx.strokeStyle = "rgba(217,45,32,.85)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([8, 5]);
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(bottom.x, bottom.y);
      ctx.stroke();
      ctx.restore();
    });
  };

  function roundRectPath(ctx, x, y, w, h, r) {
    r = Math.max(0, r);
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  CanvasView.prototype.bindEvents = function () {
    var canvas = this.canvas;
    var self = this;
    canvas.addEventListener("wheel", function (e) {
      e.preventDefault();
      var factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      var rect = canvas.getBoundingClientRect();
      var px = e.clientX - rect.left, py = e.clientY - rect.top;
      var before = TF.screenToWorld(self.view, { x: px, y: py });
      self.view.scale = TF.clamp(self.view.scale * factor, 0.05, 12);
      self.view.panX = px - before.x * self.view.scale;
      self.view.panY = py - before.y * self.view.scale;
      self.cb.requestRender && self.cb.requestRender();
    }, { passive: false });

    canvas.addEventListener("pointerdown", function (e) { self.onPointerDown(e); });
    window.addEventListener("pointermove", function (e) { self.onPointerMove(e); });
    window.addEventListener("pointerup", function () { self.onPointerUp(); });
    canvas.addEventListener("dblclick", function (e) {
      var p = self.eventPoint(e);
      var el = TF.hitTest(self.cb.getGeometry(), self.cb.getElements(),
        self.cb.getAngle(), self.view, p);
      if (el && el.type === "text") self.cb.editText && self.cb.editText(el.id);
    });
    window.addEventListener("keydown", function (e) {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.code === "Space") self.spaceDown = true;
    });
    window.addEventListener("keyup", function (e) {
      if (e.code === "Space") self.spaceDown = false;
    });
    canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  };

  CanvasView.prototype.eventPoint = function (e) {
    var rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  CanvasView.prototype.onPointerDown = function (e) {
    var p = this.eventPoint(e);
    if (this.canvas.setPointerCapture) this.canvas.setPointerCapture(e.pointerId);
    if (e.button === 1 || e.button === 2 || this.spaceDown) {
      this.drag = { mode: "pan", start: p, pan: Object.assign({}, this.view) };
      return;
    }
    var geometry = this.cb.getGeometry();
    var angle = this.cb.getAngle();
    if (this.selectedId) {
      var selectedId = this.selectedId;
      var sel = this.cb.getElements().find(function (el) { return el.id === selectedId; });
      if (sel) {
        var handles = TF.handlePositions(geometry, sel, angle, this.view);
        var hitHandle = Object.keys(handles).find(function (k) {
          return Math.abs(handles[k].x - p.x) <= 6 && Math.abs(handles[k].y - p.y) <= 6;
        });
        if (hitHandle) {
          this.drag = {
            mode: "resize", handle: hitHandle, start: p, elementId: sel.id,
            orig: { x: sel.x, y: sel.y, w: sel.w, h: sel.h }
          };
          return;
        }
      }
    }
    var el = TF.hitTest(geometry, this.cb.getElements(), angle, this.view, p);
    this.cb.select && this.cb.select(el ? el.id : null);
    if (el) {
      this.drag = { mode: "move", start: p, elementId: el.id,
        orig: { x: el.x, y: el.y }, moved: false };
    } else {
      this.drag = { mode: "pan", start: p, pan: Object.assign({}, this.view) };
    }
  };

  CanvasView.prototype.onPointerMove = function (e) {
    if (!this.drag) {
      if (e.target === this.canvas) {
        var p = this.eventPoint(e);
        var el = TF.hitTest(this.cb.getGeometry(), this.cb.getElements(),
          this.cb.getAngle(), this.view, p);
        this.canvas.style.cursor = el ? "move" : "default";
      }
      return;
    }
    var p = this.eventPoint(e);
    var d = this.drag;
    if (d.mode === "pan") {
      this.view.panX = d.pan.panX + (p.x - d.start.x);
      this.view.panY = d.pan.panY + (p.y - d.start.y);
      this.cb.requestRender && this.cb.requestRender();
      return;
    }
    var el = this.cb.getElements().find(function (it) { return it.id === d.elementId; });
    if (!el) return;
    var m = TF.elementScreenMatrix(this.cb.getGeometry(), el, this.cb.getAngle(), this.view);
    var inv = TF.invert(m);
    if (d.mode === "move") {
      var deltaLocal = TF.applyPoint(inv, p);
      var startLocal = TF.applyPoint(inv, d.start);
      el.x = d.orig.x + (deltaLocal.x - startLocal.x);
      el.y = d.orig.y + (deltaLocal.y - startLocal.y);
      d.moved = true;
    } else if (d.mode === "resize") {
      var lp = TF.applyPoint(inv, p);
      var lp0 = TF.applyPoint(inv, d.start);
      var o = d.orig;
      var x1 = o.x, y1 = o.y, x2 = o.x + o.w, y2 = o.y + o.h;
      var dx = lp.x - lp0.x, dy = lp.y - lp0.y;
      if (d.handle.indexOf("w") >= 0) x1 = o.x + dx;
      if (d.handle.indexOf("e") >= 0) x2 = o.x + o.w + dx;
      if (d.handle.indexOf("n") >= 0) y1 = o.y + dy;
      if (d.handle.indexOf("s") >= 0) y2 = o.y + o.h + dy;
      el.x = Math.min(x1, x2); el.y = Math.min(y1, y2);
      el.w = Math.abs(x2 - x1); el.h = Math.abs(y2 - y1);
      d.moved = true;
    }
    this.cb.liveEdit && this.cb.liveEdit(el);
  };

  CanvasView.prototype.onPointerUp = function () {
    if (this.drag && this.drag.moved) this.cb.commit && this.cb.commit("移动/缩放元素");
    this.drag = null;
  };

  CanvasView.prototype.setSelected = function (id) { this.selectedId = id; };
  CanvasView.prototype.zoomBy = function (factor) {
    this.view.scale = TF.clamp(this.view.scale * factor, 0.05, 12);
  };
  CanvasView.prototype.resetFit = function () { this.fitNext = true; };

  return { CanvasView: CanvasView };
});
