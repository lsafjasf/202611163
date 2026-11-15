function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = new TextEncoder().encode(type);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);
  const result = new Uint8Array(12 + data.length);
  const view = new DataView(result.buffer);
  view.setUint32(0, data.length, false);
  result.set(body, 4);
  view.setUint32(8 + data.length, crc32(body), false);
  return result;
}

function itxtChunk(keyword, text) {
  const encoder = new TextEncoder();
  const keywordBytes = encoder.encode(keyword);
  const textBytes = encoder.encode(text);
  const data = new Uint8Array(keywordBytes.length + 5 + textBytes.length);
  let offset = 0;
  data.set(keywordBytes, offset);
  offset += keywordBytes.length;
  data[offset] = 0;
  offset += 1;
  data[offset] = 0;
  offset += 1;
  data[offset] = 0;
  offset += 1;
  data[offset] = 0;
  offset += 1;
  data[offset] = 0;
  offset += 1;
  data.set(textBytes, offset);
  return pngChunk("iTXt", data);
}

function withPngMetadata(arrayBuffer, metadata) {
  const source = new Uint8Array(arrayBuffer);
  const signature = source.subarray(0, 8);
  const ihdrLength = new DataView(arrayBuffer).getUint32(8, false);
  const insertAt = 8 + 12 + ihdrLength;
  const chunk = itxtChunk("Fieldnote", JSON.stringify(metadata));
  const result = new Uint8Array(source.length + chunk.length);
  result.set(signature, 0);
  result.set(source.subarray(8, insertAt), 8);
  result.set(chunk, insertAt);
  result.set(source.subarray(insertAt), insertAt + chunk.length);
  return result;
}

export function canvasToPngBlob(canvas, metadata) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error("PNG 编码失败"));
        return;
      }
      try {
        const buffer = await blob.arrayBuffer();
        const annotated = withPngMetadata(buffer, metadata);
        resolve(new Blob([annotated], { type: "image/png" }));
      } catch (error) {
        reject(error);
      }
    }, "image/png");
  });
}

export function safeFilename(name, extension) {
  const base = String(name || "fieldnote")
    .replace(/[\\/:*?"<>|\s]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "fieldnote";
  return `${base}.${extension}`;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
