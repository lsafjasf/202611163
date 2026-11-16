// 最小 WebM(EBML) 解析器：读取 TimecodeScale 与 Duration，返回媒体秒数。
import { readFile } from 'node:fs/promises';

const ID_TIMECODE_SCALE = 0x2ad7b1;
const ID_DURATION = 0x4489;
const ID_CLUSTER = 0x1f43b675;
const ID_CLUSTER_TIMECODE = 0xe7;
const ID_SIMPLE_BLOCK = 0xa3;
const ID_CODEC_ID = 0x86;

function readVint(buf, off, asId = false) {
  const first = buf[off];
  let len = 1;
  if (first === 0) {
    // 罕见的全零首字节，退化为最长 8 字节
    len = 8;
  } else {
    let probe = first;
    while ((probe & 0x80) === 0) { len += 1; probe <<= 1; }
  }
  const keepMask = 0xff >> len;
  // ID 保留首字节标记位（形成完整元素 ID），data-size 需清除标记位
  let value = asId ? first : (first & keepMask);
  let unknown = false;
  for (let i = 1; i < len; i += 1) value = value * 256 + buf[off + i];
  if (!asId) {
    // 未知长度：长度字段去掉首字节标记位后，剩余 7*len 位全为 1
    unknown = true;
    if ((first & keepMask) !== keepMask) unknown = false;
    for (let i = 1; i < len && unknown; i += 1) {
      if (buf[off + i] !== 0xff) unknown = false;
    }
  }
  return { value, len, unknown };
}

function uintAt(bytes, offset, length) {
  let value = 0;
  for (let i = 0; i < length; i += 1) value = value * 256 + bytes[offset + i];
  return value;
}

function floatAt(bytes, offset, length) {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset + offset, length);
  return length === 4 ? buf.readFloatBE(0) : buf.readDoubleBE(0);
}

export function webmInfo(bytes) {
  let scale = 1_000_000;
  let durationRaw = null;
  let lastClusterTimecode = null;
  let maxBlockTimecode = null; // 相对所在 Cluster 的毫秒时间码
  const codecIds = [];
  let offset = 0;
  const containers = new Set([
    0x18538067, 0x1549a966, ID_CLUSTER, 0x1654ae6b, 0x1043a770, 0xbb, 0x8e,
    0xae, // TrackEntry
  ]);
  const walk = (end, depth) => {
    if (depth > 12) return;
    while (offset < end) {
      const id = readVint(bytes, offset, true);
      const size = readVint(bytes, offset + id.len, false);
      const body = offset + id.len + size.len;
      const contentEnd = size.unknown ? end : body + size.value;
      if (body > end || (!size.unknown && (contentEnd > end || contentEnd <= offset))) break;
      if (id.value === ID_TIMECODE_SCALE) {
        scale = uintAt(bytes, body, size.value);
      } else if (id.value === ID_DURATION) {
        durationRaw = floatAt(bytes, body, size.value);
      } else if (id.value === ID_CLUSTER_TIMECODE) {
        lastClusterTimecode = uintAt(bytes, body, size.value);
      } else if (id.value === ID_SIMPLE_BLOCK && size.value >= 3) {
        // SimpleBlock：track VINT 后紧跟 2 字节有符号相对时间码
        const track = readVint(bytes, body, true);
        const rel = bytes.readInt16BE(body + track.len);
        maxBlockTimecode = maxBlockTimecode == null ? rel : Math.max(maxBlockTimecode, rel);
      } else if (id.value === ID_CODEC_ID) {
        codecIds.push(bytes.slice(body, body + size.value).toString('ascii'));
      } else if (containers.has(id.value)) {
        const saved = offset;
        offset = body;
        walk(contentEnd, depth + 1);
        offset = size.unknown ? contentEnd : saved + (body - saved) + size.value;
        continue;
      }
      offset = contentEnd;
    }
  };
  walk(bytes.length, 0);
  const clusterSeconds = lastClusterTimecode == null
    ? null
    : (lastClusterTimecode * scale) / 1e9;
  const lastBlockMs = (lastClusterTimecode || 0) + (maxBlockTimecode || 0);
  return {
    timecodeScale: scale,
    durationRaw,
    durationSeconds: durationRaw == null ? null : (durationRaw * scale) / 1e9,
    lastClusterTimecode,
    clusterSeconds,
    maxBlockRelativeMs: maxBlockTimecode,
    lastBlockSeconds: (lastBlockMs * scale) / 1e9,
    codecIds,
    hasVideo: codecIds.some((c) => c.startsWith('V_')),
    hasAudio: codecIds.some((c) => c.startsWith('A_')),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  const bytes = await readFile(file);
  console.log(JSON.stringify(webmInfo(bytes), null, 2));
}
