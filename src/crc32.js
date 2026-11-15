// CRC32 (IEEE) 校验码，浏览器/Node 双端可用。
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CRC32 = factory();
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const TABLE = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    TABLE[n] = c >>> 0;
  }

  function crc32(str) {
    let crc = 0xffffffff;
    for (let i = 0; i < str.length; i++) {
      let code = str.charCodeAt(i);
      // 按 UTF-8 字节展开，避免中文等多字节字符校验失真
      if (code < 0x80) {
        crc = TABLE[(crc ^ code) & 0xff] ^ (crc >>> 8);
      } else if (code < 0x800) {
        crc = TABLE[(crc ^ (0xc0 | (code >> 6))) & 0xff] ^ (crc >>> 8);
        crc = TABLE[(crc ^ (0x80 | (code & 0x3f))) & 0xff] ^ (crc >>> 8);
      } else {
        crc = TABLE[(crc ^ (0xe0 | (code >> 12))) & 0xff] ^ (crc >>> 8);
        crc = TABLE[(crc ^ (0x80 | ((code >> 6) & 0x3f))) & 0xff] ^ (crc >>> 8);
        crc = TABLE[(crc ^ (0x80 | (code & 0x3f))) & 0xff] ^ (crc >>> 8);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  return { crc32 };
});
