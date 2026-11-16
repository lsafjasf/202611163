// 用 jsQR 解码自建矩阵，验证 QRGen 输出可被标准解码器识别。
const assert = require('assert');
const jsQR = require('jsqr');
const QRGen = require('../js/qr.js');

function renderToPixels(matrix, scale) {
  const q = QRGen.QUIET;
  const n = matrix.size + q * 2;
  const w = n * scale;
  const data = new Uint8ClampedArray(w * w * 4).fill(255);
  for (let r = 0; r < matrix.size; r++) {
    for (let c = 0; c < matrix.size; c++) {
      if (matrix.modules[r][c] !== 1) continue;
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) {
          const px = ((r + q) * scale + y) * w + (c + q) * scale + x;
          data.fill(0, px * 4, px * 4 + 3);
        }
      }
    }
  }
  return { data, width: w, height: w };
}

function roundtrip(text) {
  const matrix = QRGen.makeMatrix(text);
  const img = renderToPixels(matrix, 4);
  const res = jsQR(img.data, img.width, img.height);
  assert.ok(res, '解码失败: ' + text.slice(0, 30));
  assert.strictEqual(res.data, text, '内容不一致');
  return matrix;
}

// 短内容（v1）、URL、中文、长内容（触发高版本）
roundtrip('HELLO');
roundtrip('https://example.com/event/2026?invite=uid730');
roundtrip('https://活动.example.com/夏日音乐节?票=A区12排');
const long = 'https://example.com/e?' + 'x'.repeat(150);
const m = roundtrip(long);
assert.ok(m.version >= 5, '长内容应使用更高版本, 实际 v' + m.version);

// 超长内容应抛出带修复提示的错误
assert.throws(() => QRGen.makeMatrix('y'.repeat(500)), /缩短/);

console.log('qr.test.js 全部通过（含 v' + m.version + ' 长内容用例）');
