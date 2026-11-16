// 最小自包含 GIF89a 编码器（256 色调色板 + 可变 LZW），无第三方依赖。
// 每帧延迟以百分之一秒计，导出区间帧数 × 单帧时长即为 GIF 总时长。

class ByteWriter {
  constructor() { this.bytes = []; }
  u8(v) { this.bytes.push(v & 0xff); }
  u16(v) { this.u8(v & 0xff); this.u8((v >> 8) & 0xff); }
  push(arr) { for (const v of arr) this.bytes.push(v & 0xff); }
  string(s) { for (let i = 0; i < s.length; i += 1) this.u8(s.charCodeAt(i)); }
}

// 中位切分量化为最多 256 色
function quantize(rgba) {
  const all = [];
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] > 0) all.push([rgba[i], rgba[i + 1], rgba[i + 2]]);
  }
  if (all.length === 0) all.push([0, 0, 0]);
  // 等距采样，避免对数十万像素反复排序
  const sampleStep = Math.max(1, Math.floor(all.length / 12000));
  const pixels = all.filter((_, i) => i % sampleStep === 0);
  if (pixels.length === 0) pixels.push(all[0]);
  let boxes = [pixels];
  while (boxes.length < 256) {
    let target = -1;
    let widest = 0;
    for (let b = 0; b < boxes.length; b += 1) {
      if (boxes[b].length < 2) continue;
      const ranges = [0, 1, 2].map((c) => channelRange(boxes[b], c));
      const w = Math.max(ranges[0], ranges[1], ranges[2]);
      if (w > widest) { widest = w; target = b; }
    }
    if (target < 0) break;
    const box = boxes[target];
    const ranges = [0, 1, 2].map((c) => [c, channelRange(box, c)]);
    const channel = ranges.sort((a, b) => b[1] - a[1])[0][0];
    box.sort((a, b) => a[channel] - b[channel]);
    const mid = box.length >> 1;
    boxes = boxes
      .slice(0, target)
      .concat([box.slice(0, mid), box.slice(mid)])
      .concat(boxes.slice(target + 1));
  }
  const palette = boxes.map((box) => {
    const sum = [0, 0, 0];
    for (const p of box) { sum[0] += p[0]; sum[1] += p[1]; sum[2] += p[2]; }
    return [
      Math.round(sum[0] / box.length),
      Math.round(sum[1] / box.length),
      Math.round(sum[2] / box.length),
    ];
  });
  while (palette.length < 256) palette.push([0, 0, 0]);
  return palette;
}

function channelRange(box, channel) {
  let min = 255;
  let max = 0;
  for (const p of box) {
    const v = p[channel];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return max - min;
}

function nearestIndex(palette, r, g, b) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < palette.length; i += 1) {
    const p = palette[i];
    const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function lzwEncode(minCodeSize, indices) {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = endCode + 1;
  const dict = new Map();
  const reset = () => {
    dict.clear();
    for (let i = 0; i < clearCode; i += 1) dict.set(String(i), i);
    codeSize = minCodeSize + 1;
    nextCode = endCode + 1;
  };
  reset();

  const out = new ByteWriter();
  let bitBuffer = 0;
  let bitCount = 0;
  const emit = (code) => {
    bitBuffer |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      out.u8(bitBuffer & 0xff);
      bitBuffer >>= 8;
      bitCount -= 8;
    }
  };

  emit(clearCode);
  let prefix = String(indices[0]);
  for (let i = 1; i < indices.length; i += 1) {
    const k = indices[i];
    const combined = `${prefix},${k}`;
    if (dict.has(combined)) {
      prefix = combined;
    } else {
      emit(dict.get(prefix));
      dict.set(combined, nextCode);
      nextCode += 1;
      if (nextCode === (1 << codeSize) && codeSize < 12) codeSize += 1;
      if (nextCode >= 4096) {
        emit(clearCode);
        reset();
      }
      prefix = String(k);
    }
  }
  emit(dict.get(prefix));
  emit(endCode);
  if (bitCount > 0) out.u8(bitBuffer & 0xff);
  return out.bytes;
}

export function encodeGif(frames, width, height, fps) {
  // 用第一帧建立调色板（示例画面颜色简单，量化误差小）
  const palette = quantize(frames[0]);
  const writer = new ByteWriter();
  writer.string('GIF89a');
  writer.u16(width);
  writer.u16(height);
  writer.u8(0xf7); // 全局调色板，256 色
  writer.u8(0);
  writer.u8(0);
  for (const [r, g, b] of palette) {
    writer.u8(r); writer.u8(g); writer.u8(b);
  }

  // Netscape 循环扩展
  writer.push([0x21, 0xff, 0x0b]);
  writer.string('NETSCAPE2.0');
  writer.push([0x03, 0x01, 0x00, 0x00, 0x00]);

  const delayCs = Math.round(100 / fps); // 百分之一秒每帧

  for (const rgba of frames) {
    // 图形控制扩展
    writer.push([0x21, 0xf9, 0x04, 0x00]);
    writer.u16(delayCs);
    writer.push([0x00, 0x00]);

    writer.u8(0x2c);
    writer.u16(0); writer.u16(0);
    writer.u16(width); writer.u16(height);
    writer.u8(0x00);

    const indices = new Uint8Array(width * height);
    for (let p = 0, i = 0; p < rgba.length; p += 4, i += 1) {
      indices[i] = rgba[p + 3] === 0
        ? nearestIndex(palette, 244, 241, 232)
        : nearestIndex(palette, rgba[p], rgba[p + 1], rgba[p + 2]);
    }
    const minCodeSize = 8;
    const lzw = lzwEncode(minCodeSize, indices);
    writer.u8(minCodeSize);
    let offset = 0;
    while (offset < lzw.length) {
      const chunk = lzw.slice(offset, offset + 255);
      writer.u8(chunk.length);
      writer.push(chunk);
      offset += 255;
    }
    writer.u8(0); // 图像数据结束
  }
  writer.u8(0x3b); // 拖车
  return new Blob([new Uint8Array(writer.bytes)], { type: 'image/gif' });
}

// 供测试使用的解析器：返回帧延迟（cs）与总时长（秒）
export function parseGifInfo(buffer) {
  const view = new DataView(buffer);
  let offset = 6;
  const packed = view.getUint8(10);
  const gctSize = 2 ** ((packed & 0x07) + 1);
  offset = 13 + gctSize * 3;
  const delays = [];
  const width = view.getUint16(6, true);
  const height = view.getUint16(8, true);
  const skipSubBlocks = () => {
    while (offset < buffer.byteLength) {
      const blockSize = view.getUint8(offset);
      offset += 1;
      if (blockSize === 0) return;
      offset += blockSize;
    }
  };
  while (offset < buffer.byteLength) {
    const intro = view.getUint8(offset);
    if (intro === 0x3b) break;
    if (intro === 0x21) {
      offset += 1;
      const label = view.getUint8(offset);
      offset += 1;
      if (label === 0xf9) {
        const blockSize = view.getUint8(offset); // 固定为 4
        // offset 指向块大小；其后 packed(1) + delay(2) + 透明索引(1)
        const delay = view.getUint16(offset + 2, true);
        delays.push(delay);
        offset += 1 + blockSize + 1; // 块大小 + 数据 + 终结符
      } else {
        skipSubBlocks();
      }
    } else if (intro === 0x2c) {
      // 图像描述符：分隔符(1) + 左(2)+上(2)+宽(2)+高(2)+packed(1)
      const localPacked = view.getUint8(offset + 9);
      offset += 10;
      if (localPacked & 0x80) {
        const size = 2 ** ((localPacked & 0x07) + 1);
        offset += size * 3;
      }
      offset += 1; // LZW 最小码长
      skipSubBlocks();
    } else {
      break;
    }
  }
  return { width, height, delays, totalSeconds: delays.reduce((a, b) => a + b, 0) / 100, frameCount: delays.length };
}
