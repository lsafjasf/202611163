// 可观测指标与错误日志：计数器、耗时统计、资源统计、环形错误日志。
// 浏览器与 Node 双端可用（无依赖）。
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Metrics = factory();
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const ERROR_LOG_CAPACITY = 200;

  class Metrics {
    constructor() {
      this.counters = Object.create(null); // name -> number
      this.timings = Object.create(null); // name -> {count,totalMs,maxMs}
      this.errors = []; // 环形错误日志（只记录，不吞异常）
      this.resources = {
        saveBytesWritten: 0,
        saveBytesRead: 0,
        slotsUsed: 0,
        storageBytes: 0,
        snapshotsKept: 0,
      };
    }

    inc(name, delta) {
      this.counters[name] = (this.counters[name] || 0) + (delta == null ? 1 : delta);
    }

    observeMs(name, ms) {
      const t = this.timings[name] || (this.timings[name] = { count: 0, totalMs: 0, maxMs: 0 });
      t.count += 1;
      t.totalMs += ms;
      t.maxMs = Math.max(t.maxMs, ms);
      return ms;
    }

    // 记录错误并返回条目；调用方决定继续抛出或降级，绝不静默吞掉
    logError(context, err) {
      const entry = {
        at: new Date().toISOString(),
        context,
        name: err && err.name ? err.name : "Error",
        message: err && err.message ? err.message : String(err),
      };
      this.errors.push(entry);
      if (this.errors.length > ERROR_LOG_CAPACITY) this.errors.shift();
      this.inc("errors." + context);
      return entry;
    }

    resourceSnapshot() {
      return Object.assign({}, this.resources);
    }

    summary() {
      const timings = {};
      for (const k of Object.keys(this.timings)) {
        const t = this.timings[k];
        timings[k] = {
          count: t.count,
          avgMs: t.count ? +(t.totalMs / t.count).toFixed(3) : 0,
          maxMs: +t.maxMs.toFixed(3),
        };
      }
      return {
        counters: Object.assign({}, this.counters),
        timings,
        errorCount: this.errors.length,
        resources: this.resourceSnapshot(),
      };
    }
  }

  return { Metrics };
});
