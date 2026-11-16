// 测试辅助：记录型 2D 上下文（可栅格化为位图）、极简 PNG 编码器、jsdom 应用加载器。
const zlib = require('zlib');

// ---- 记录型 2D 上下文 ----
function makeStubCtx() {
  const state = { transform: [1, 0, 0, 1, 0, 0], stack: [] };
  const ops = [];
  function multiply(m) {
    const t = state.transform;
    state.transform = [
      t[0] * m[0] + t[2] * m[1], t[1] * m[0] + t[3] * m[1],
      t[0] * m[2] + t[2] * m[3], t[1] * m[2] + t[3] * m[3],
      t[0] * m[4] + t[2] * m[5] + t[4], t[1] * m[4] + t[3] * m[5] + t[5]
    ];
  }
  const ctx = {
    fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1,
    font: '16px system-ui', textAlign: 'left', textBaseline: 'alphabetic',
    globalAlpha: 1,
    save() { state.stack.push(state.transform.slice()); },
    restore() { state.transform = state.stack.pop() || [1, 0, 0, 1, 0, 0]; },
    translate(x, y) { multiply([1, 0, 0, 1, x, y]); },
    rotate(a) { multiply([Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]); },
    scale(x, y) { multiply([x, 0, 0, y === undefined ? x : y, 0, 0]); },
    setTransform(a, b, c, d, e, f) { state.transform = [a, b, c, d, e, f]; },
    beginPath() { ctx._path = []; },
    arc(x, y, r) { ctx._path.push({ kind: 'circle', x: x, y: y, r: r }); },
    rect(x, y, w, h) { ctx._path.push({ kind: 'rect', x: x, y: y, w: w, h: h }); },
    roundRect(x, y, w, h) { ctx._path.push({ kind: 'rect', x: x, y: y, w: w, h: h }); },
    ellipse(x, y, rx, ry) { ctx._path.push({ kind: 'ellipse', x: x, y: y, rx: rx, ry: ry }); },
    moveTo() {}, lineTo() {}, closePath() {},
    fill() {
      ctx._path.forEach(function (p) {
        ops.push({ op: 'fill', shape: p, style: ctx.fillStyle, t: state.transform.slice() });
      });
    },
    stroke() {},
    setLineDash() {},
    fillRect(x, y, w, h) {
      ops.push({ op: 'fill', shape: { kind: 'rect', x: x, y: y, w: w, h: h }, style: ctx.fillStyle, t: state.transform.slice() });
    },
    strokeRect() {},
    fillText(text, x, y) {
      ops.push({ op: 'text', text: text, x: x, y: y, style: ctx.fillStyle, font: ctx.font });
    },
    drawImage() {},
    measureText(text) {
      const m = /(\d+(?:\.\d+)?)px/.exec(ctx.font);
      const fs = m ? parseFloat(m[1]) : 16;
      let w = 0;
      for (const ch of String(text)) {
        w += (ch.codePointAt(0) > 0x2e7f) ? fs : fs * 0.55;
      }
      return { width: w };
    },
    _path: [],
    _ops: ops
  };
  return ctx;
}

function parseColor(style) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(style));
  if (!m) return [0, 0, 0];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

// 把记录的 fill 操作栅格化为 RGBA 位图（文字与图片忽略）
function rasterize(ctx, width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) { data[i * 4 + 3] = 255; }
  function apply(t, x, y) {
    return [t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]];
  }
  for (const op of ctx._ops) {
    if (op.op !== 'fill') continue;
    const c = parseColor(op.style);
    const s = op.shape;
    if (s.kind === 'rect') {
      const p0 = apply(op.t, s.x, s.y);
      const p1 = apply(op.t, s.x + s.w, s.y + s.h);
      const xa = Math.max(0, Math.round(Math.min(p0[0], p1[0])));
      const xb = Math.min(width, Math.round(Math.max(p0[0], p1[0])));
      const ya = Math.max(0, Math.round(Math.min(p0[1], p1[1])));
      const yb = Math.min(height, Math.round(Math.max(p0[1], p1[1])));
      for (let y = ya; y < yb; y++) {
        for (let x = xa; x < xb; x++) {
          const i = (y * width + x) * 4;
          data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2];
        }
      }
    } else if (s.kind === 'circle') {
      const pc = apply(op.t, s.x, s.y);
      const rad = s.r * Math.abs(op.t[0]);
      for (let y = Math.max(0, Math.floor(pc[1] - rad)); y < Math.min(height, pc[1] + rad); y++) {
        for (let x = Math.max(0, Math.floor(pc[0] - rad)); x < Math.min(width, pc[0] + rad); x++) {
          const dx = x - pc[0], dy = y - pc[1];
          if (dx * dx + dy * dy <= rad * rad) {
            const i = (y * width + x) * 4;
            data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2];
          }
        }
      }
    }
  }
  return data;
}

// ---- 极简 PNG 编码器（RGBA → PNG Buffer） ----
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}

function pngEncode(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8bit RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

// ---- jsdom 中加载应用 ----
function loadApp(JSDOM, projectJson) {
  const fs = require('fs');
  const path = require('path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')
    .replace(/<script src="[^"]+"><\/script>/g, '');
  const dom = new JSDOM(html, {
    url: 'http://localhost/',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const win = dom.window;
  // canvas 2d → 记录型上下文
  win.HTMLCanvasElement.prototype.getContext = function () {
    if (!this._stubCtx) this._stubCtx = makeStubCtx();
    return this._stubCtx;
  };
  win.HTMLCanvasElement.prototype.setPointerCapture = function () {};
  win.HTMLCanvasElement.prototype.toBlob = function (cb) {
    const ctx = this.getContext('2d');
    const data = rasterize(ctx, this.width, this.height);
    cb(new win.Blob([pngEncode(this.width, this.height, data)], { type: 'image/png' }));
  };
  // 捕获下载
  const downloads = [];
  win.URL.createObjectURL = function (blob) {
    downloads.push(blob);
    return 'blob:mock-' + downloads.length;
  };
  win.URL.revokeObjectURL = function () {};
  if (projectJson) win.localStorage.setItem('qr-poster-project', projectJson);
  ['qr.js', 'model.js', 'render.js', 'validate.js', 'svg.js', 'app.js'].forEach(function (f) {
    win.eval(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'));
  });
  return { window: win, downloads: downloads };
}

module.exports = { makeStubCtx, rasterize, pngEncode, loadApp };
