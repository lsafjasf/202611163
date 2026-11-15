// 关键帧插值：纯函数，不依赖 DOM，可在 Node 中独立测试。

export function sortKeys(keys) {
  return [...keys].sort((a, b) => a.t - b.t);
}

// 在关键帧数组 keys=[{t,v},...] 上取 time 处的值（线性插值，首尾钳制）。
export function sampleKeys(keys, time) {
  if (!keys || keys.length === 0) return 0;
  const sorted = sortKeys(keys);
  if (time <= sorted[0].t) return sorted[0].v;
  const last = sorted[sorted.length - 1];
  if (time >= last.t) return last.v;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1];
    if (time >= a.t && time <= b.t) {
      const span = b.t - a.t;
      const k = span === 0 ? 0 : (time - a.t) / span;
      return a.v + (b.v - a.v) * k;
    }
  }
  return last.v;
}

// 写入（或替换）time 处的关键帧，返回新数组。eps 内视为同一帧。
export function setKey(keys, time, value, eps = 1e-4) {
  const next = keys.filter((k) => Math.abs(k.t - time) > eps);
  next.push({ t: time, v: value });
  return sortKeys(next);
}

export function removeKey(keys, time, eps = 1e-4) {
  return keys.filter((k) => Math.abs(k.t - time) > eps);
}

// 对 layer.keyframes = { prop: [{t,v}] } 的所有属性采样。
export function sampleLayer(layer, time) {
  const out = {};
  for (const [prop, keys] of Object.entries(layer.keyframes)) {
    out[prop] = sampleKeys(keys, time);
  }
  return out;
}
