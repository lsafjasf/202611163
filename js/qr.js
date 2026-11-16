/* QR 码生成器：字节模式，纠错级别 H（中心图标需要高纠错），版本 1-10 自动选择。
 * 同时可在浏览器（window.QRGen）与 Node（module.exports）中使用，便于自动化测试。 */
(function (global) {
  'use strict';

  // ---- GF(256) ----
  var EXP = new Uint8Array(512);
  var LOG = new Uint8Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();

  function gmul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  function rsGenPoly(deg) {
    var poly = [1];
    for (var i = 0; i < deg; i++) {
      var next = new Array(poly.length + 1).fill(0);
      for (var j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gmul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly;
  }

  function rsEncode(data, ecLen) {
    var gen = rsGenPoly(ecLen);
    var res = new Array(ecLen).fill(0);
    for (var i = 0; i < data.length; i++) {
      var factor = data[i] ^ res.shift();
      res.push(0);
      for (var j = 0; j < ecLen; j++) res[j] ^= gmul(gen[j + 1], factor);
    }
    return res;
  }

  // ---- 版本参数表（纠错级别 H，版本 1-20）----
  // 每块结构 [块数量, 每块总码字数, 每块数据码字数]
  var RS_BLOCKS_H = [
    null,
    [[1, 26, 9]],
    [[1, 44, 16]],
    [[2, 35, 13]],
    [[4, 25, 9]],
    [[2, 33, 11], [2, 34, 12]],
    [[4, 43, 15]],
    [[4, 39, 13], [1, 40, 14]],
    [[4, 40, 14], [2, 41, 15]],
    [[4, 36, 12], [4, 37, 13]],
    [[6, 43, 15], [2, 44, 16]],
    [[3, 36, 12], [8, 37, 13]],
    [[7, 42, 14], [4, 43, 15]],
    [[12, 33, 11], [4, 34, 12]],
    [[11, 36, 12], [5, 37, 13]],
    [[11, 36, 12], [7, 37, 13]],
    [[3, 45, 15], [13, 46, 16]],
    [[2, 42, 14], [17, 43, 15]],
    [[2, 42, 14], [19, 43, 15]],
    [[9, 39, 13], [16, 40, 14]],
    [[15, 43, 15], [10, 44, 16]]
  ];
  var ALIGN_POS = [
    null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
    [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
    [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66],
    [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82],
    [6, 30, 58, 86], [6, 34, 62, 90]
  ];

  function dataCapacity(version) {
    var total = 0;
    RS_BLOCKS_H[version].forEach(function (g) { total += g[0] * g[2]; });
    return total;
  }

  // ---- 位流 ----
  function BitBuffer() {
    this.bits = [];
  }
  BitBuffer.prototype.put = function (val, len) {
    for (var i = len - 1; i >= 0; i--) this.bits.push((val >>> i) & 1);
  };
  BitBuffer.prototype.toBytes = function () {
    var out = [];
    for (var i = 0; i < this.bits.length; i += 8) {
      var b = 0;
      for (var j = 0; j < 8; j++) b = (b << 1) | (this.bits[i + j] || 0);
      out.push(b);
    }
    return out;
  };

  function utf8Bytes(str) {
    if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(str));
    var s = unescape(encodeURIComponent(str));
    var out = [];
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
    return out;
  }

  function pickVersion(byteLen) {
    var maxV = RS_BLOCKS_H.length - 1;
    for (var v = 1; v <= maxV; v++) {
      var lenBits = v <= 9 ? 8 : 16;
      var needBits = 4 + lenBits + byteLen * 8;
      if (needBits <= dataCapacity(v) * 8) return v;
    }
    throw new Error('内容过长：超过版本 ' + maxV + '-H 容量（约 ' + dataCapacity(maxV) + ' 字节），请缩短二维码内容');
  }

  // ---- 数据码字 ----
  function buildDataCodewords(bytes, version) {
    var cap = dataCapacity(version);
    var buf = new BitBuffer();
    buf.put(4, 4); // 字节模式
    buf.put(bytes.length, version <= 9 ? 8 : 16);
    bytes.forEach(function (b) { buf.put(b, 8); });
    var remaining = cap * 8 - buf.bits.length;
    buf.put(0, Math.min(4, remaining)); // 终止符
    while (buf.bits.length % 8 !== 0) buf.bits.push(0);
    var data = buf.toBytes();
    var pads = [0xec, 0x11];
    for (var i = 0; data.length < cap; i++) data.push(pads[i % 2]);
    return data;
  }

  function buildFinalCodewords(data, version) {
    var groups = RS_BLOCKS_H[version];
    var blocks = [];
    var offset = 0;
    groups.forEach(function (g) {
      var count = g[0], total = g[1], dc = g[2];
      for (var i = 0; i < count; i++) {
        var d = data.slice(offset, offset + dc);
        offset += dc;
        blocks.push({ data: d, ec: rsEncode(d, total - dc) });
      }
    });
    var out = [];
    var maxData = Math.max.apply(null, blocks.map(function (b) { return b.data.length; }));
    var maxEc = blocks[0].ec.length;
    for (var i = 0; i < maxData; i++) {
      blocks.forEach(function (b) { if (i < b.data.length) out.push(b.data[i]); });
    }
    for (var j = 0; j < maxEc; j++) {
      blocks.forEach(function (b) { out.push(b.ec[j]); });
    }
    return out;
  }

  // ---- 矩阵 ----
  function Matrix(size) {
    this.size = size;
    this.m = new Array(size);
    this.fn = new Array(size);
    for (var i = 0; i < size; i++) this.m[i] = new Array(size).fill(null);
    for (var j = 0; j < size; j++) this.fn[j] = new Array(size).fill(false);
  }
  Matrix.prototype.set = function (r, c, v) { this.m[r][c] = v; };
  Matrix.prototype.setFn = function (r, c, v) { this.m[r][c] = v; this.fn[r][c] = true; };
  Matrix.prototype.get = function (r, c) {
    if (r < 0 || c < 0 || r >= this.size || c >= this.size) return null;
    return this.m[r][c];
  };

  function placeFinder(mx, r, c) {
    for (var dr = -1; dr <= 7; dr++) {
      for (var dc = -1; dc <= 7; dc++) {
        var rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= mx.size || cc >= mx.size) continue;
        var dark = (dr >= 0 && dr <= 6 && (dc === 0 || dc === 6)) ||
                   (dc >= 0 && dc <= 6 && (dr === 0 || dr === 6)) ||
                   (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4);
        mx.setFn(rr, cc, dark ? 1 : 0);
      }
    }
  }

  function placeAlign(mx, positions) {
    positions.forEach(function (r) {
      positions.forEach(function (c) {
        if (mx.get(r, c) !== null) return; // 跳过与定位图形重叠处
        for (var dr = -2; dr <= 2; dr++) {
          for (var dc = -2; dc <= 2; dc++) {
            var dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
            mx.setFn(r + dr, c + dc, dark ? 1 : 0);
          }
        }
      });
    });
  }

  function placeTiming(mx) {
    for (var i = 8; i < mx.size - 8; i++) {
      var v = i % 2 === 0 ? 1 : 0;
      if (mx.get(6, i) === null) mx.setFn(6, i, v);
      if (mx.get(i, 6) === null) mx.setFn(i, 6, v);
    }
  }

  // 格式信息：纠错 H = 10，掩码 3 位，BCH(15,5)，掩码 0x5412
  function formatBits(mask) {
    var data = (2 << 3) | mask; // H=10
    var rem = data << 10;
    var gen = 0x537;
    for (var i = 14; i >= 10; i--) {
      if ((rem >>> i) & 1) rem ^= gen << (i - 10);
    }
    return (((data << 10) | rem) ^ 0x5412) & 0x7fff;
  }

  // 版本信息（v>=7）：BCH(18,6)，生成多项式 0x1F25
  function versionBits(version) {
    var rem = version << 12;
    var gen = 0x1f25;
    for (var i = 17; i >= 12; i--) {
      if ((rem >>> i) & 1) rem ^= gen << (i - 12);
    }
    return ((version << 12) | rem) & 0x3ffff;
  }

  function placeFormat(mx, mask) {
    var bits = formatBits(mask);
    var size = mx.size;
    for (var i = 0; i < 15; i++) {
      var bit = (bits >>> i) & 1;
      // 左上
      if (i < 6) mx.setFn(i, 8, bit);
      else if (i < 8) mx.setFn(i + 1, 8, bit);
      else if (i === 8) mx.setFn(8, 7, bit);
      else mx.setFn(8, 14 - i, bit);
      // 拆分处
      if (i < 8) mx.setFn(8, size - 1 - i, bit);
      else mx.setFn(size - 15 + i, 8, bit);
    }
    mx.setFn(size - 8, 8, 1); // 固定暗模块
  }

  function placeVersion(mx, version) {
    if (version < 7) return;
    var bits = versionBits(version);
    var size = mx.size;
    for (var i = 0; i < 18; i++) {
      var bit = (bits >>> i) & 1;
      var r = Math.floor(i / 3), c = i % 3;
      mx.setFn(r, size - 11 + c, bit);
      mx.setFn(size - 11 + c, r, bit);
    }
  }

  function maskBit(mask, r, c) {
    switch (mask) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
      case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
      case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    }
    return false;
  }

  function placeData(mx, codewords, mask) {
    var size = mx.size;
    var bits = [];
    codewords.forEach(function (b) {
      for (var i = 7; i >= 0; i--) bits.push((b >>> i) & 1);
    });
    var idx = 0;
    var upward = true;
    for (var col = size - 1; col > 0; col -= 2) {
      if (col === 6) col = 5;
      for (var step = 0; step < size; step++) {
        var r = upward ? size - 1 - step : step;
        for (var dc = 0; dc < 2; dc++) {
          var c = col - dc;
          if (mx.get(r, c) !== null) continue;
          var bit = idx < bits.length ? bits[idx] : 0;
          idx++;
          if (maskBit(mask, r, c)) bit ^= 1;
          mx.set(r, c, bit);
        }
      }
      upward = !upward;
    }
  }

  // 罚分评估（ISO/IEC 18004 规则 1-4）
  function penalty(mx) {
    var size = mx.size, score = 0, r, c, run;
    for (r = 0; r < size; r++) {
      run = 1;
      for (c = 1; c <= size; c++) {
        if (c < size && mx.m[r][c] === mx.m[r][c - 1]) run++;
        else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
    }
    for (c = 0; c < size; c++) {
      run = 1;
      for (r = 1; r <= size; r++) {
        if (r < size && mx.m[r][c] === mx.m[r - 1][c]) run++;
        else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
    }
    for (r = 0; r < size - 1; r++) {
      for (c = 0; c < size - 1; c++) {
        var v = mx.m[r][c];
        if (v === mx.m[r][c + 1] && v === mx.m[r + 1][c] && v === mx.m[r + 1][c + 1]) score += 3;
      }
    }
    var pat1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    var pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    function matchLine(line) {
      for (var i = 0; i + 11 <= line.length; i++) {
        var ok1 = true, ok2 = true;
        for (var j = 0; j < 11; j++) {
          if (line[i + j] !== pat1[j]) ok1 = false;
          if (line[i + j] !== pat2[j]) ok2 = false;
        }
        if (ok1 || ok2) score += 40;
      }
    }
    for (r = 0; r < size; r++) matchLine(mx.m[r]);
    for (c = 0; c < size; c++) matchLine(mx.m.map(function (row) { return row[c]; }));
    var dark = 0;
    for (r = 0; r < size; r++) for (c = 0; c < size; c++) if (mx.m[r][c] === 1) dark++;
    var ratio = (dark * 100) / (size * size);
    score += Math.floor(Math.abs(ratio - 50) / 5) * 10;
    return score;
  }

  // ---- 公开 API ----
  // 返回 { version, size, modules }，modules[r][c] === 1 表示暗模块。
  function makeMatrix(text, forcedMask) {
    var bytes = utf8Bytes(text);
    var version = pickVersion(bytes.length);
    var data = buildDataCodewords(bytes, version);
    var codewords = buildFinalCodewords(data, version);
    var size = 17 + version * 4;
    var best = null, bestScore = Infinity;
    for (var mask = 0; mask < 8; mask++) {
      if (forcedMask !== undefined && forcedMask !== null && mask !== forcedMask) continue;
      var mx = new Matrix(size);
      placeFinder(mx, 0, 0);
      placeFinder(mx, 0, size - 7);
      placeFinder(mx, size - 7, 0);
      placeAlign(mx, ALIGN_POS[version]);
      placeTiming(mx);
      placeVersion(mx, version);
      placeFormat(mx, mask);
      placeData(mx, codewords, mask);
      var score = penalty(mx);
      if (score < bestScore) { bestScore = score; best = mx; }
    }
    return { version: version, size: size, modules: best.m, fn: best.fn };
  }

  var api = {
    makeMatrix: makeMatrix,
    QUIET: 4,
    _debug: { buildDataCodewords: buildDataCodewords, buildFinalCodewords: buildFinalCodewords }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.QRGen = api;
})(typeof window !== 'undefined' ? window : globalThis);
