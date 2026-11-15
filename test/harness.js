// 测试基座：带故障注入与字节统计的存储适配器 + 确定性 PRNG（保证失败场景可重复）。
"use strict";

// mulberry32：种子固定 => 损坏位置固定 => 场景可重复
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class FaultyStorage {
  constructor() {
    this.map = new Map();
    this.fault = null; // {type:"truncate",atBytes} | {type:"flip",rng,count} | {type:"throwOnSet"}
    this.setCount = 0;
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    this.setCount += 1;
    let value = String(v);
    if (this.fault && this.fault.type === "throwOnSet") {
      throw new Error("注入故障: 存储写入抛错（模拟磁盘满/崩溃）");
    }
    if (this.fault && this.fault.type === "truncate" && k.indexOf("game.save.") === 0 && k !== "game.save.ptr") {
      value = value.slice(0, this.fault.atBytes); // 写入中断：只落盘前半截
    }
    if (this.fault && this.fault.type === "flip" && k.indexOf("game.save.") === 0 && k !== "game.save.ptr") {
      const chars = value.split("");
      for (let i = 0; i < this.fault.count; i++) {
        const pos = Math.floor(this.fault.rng() * chars.length);
        chars[pos] = chars[pos] === "0" ? "1" : "0"; // 位翻转
      }
      value = chars.join("");
    }
    this.map.set(k, value);
  }
  removeItem(k) {
    this.map.delete(k);
  }
  totalBytes() {
    let n = 0;
    for (const v of this.map.values()) n += v.length;
    return n;
  }
}

module.exports = { FaultyStorage, makeRng };
