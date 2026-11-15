// 版本化本地存档管理器：
// - 信封格式 { magic, version, crc32, savedAt, payload }，payload 含 地图/进度/设置/最近回放
// - 双槽位 + 指针原子写：先写空闲槽并回读校验，通过后才切换指针，绝不覆盖唯一完整副本
// - 加载时校验失败自动回退到最近完整快照；旧版本走迁移链；更新版本明确报错提示
// - 全程记录指标与错误日志（不吞异常）
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./crc32.js"));
  } else {
    root.SaveManager = factory(root.CRC32);
  }
})(typeof self !== "undefined" ? self : globalThis, function (CRC32) {
  "use strict";

  const MAGIC = "UID748SAVE";
  const CURRENT_VERSION = 2;
  const SLOT_KEYS = ["game.save.A", "game.save.B"];
  const PTR_KEY = "game.save.ptr";

  // 迁移链：v1 -> v2（v1 无 replays 段、settings 缺 quality 字段）
  const MIGRATIONS = {
    1: function (payload) {
      const p = Object.assign({}, payload);
      p.settings = Object.assign({ quality: "high" }, p.settings);
      if (!Array.isArray(p.replays)) p.replays = [];
      return p;
    },
  };

  class SaveError extends Error {
    constructor(code, message) {
      super(message);
      this.name = "SaveError";
      this.code = code;
    }
  }

  function nowMs() {
    return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
  }

  class SaveManager {
    // storage: { getItem(k), setItem(k,v), removeItem(k) }；metrics: Metrics 实例
    constructor(storage, metrics) {
      this.storage = storage;
      this.metrics = metrics;
      this.lastRecovery = null; // 供界面展示：{state, detail, suggestion, elapsedMs}
    }

    _encode(payload, version) {
      const body = JSON.stringify(payload);
      return JSON.stringify({
        magic: MAGIC,
        version: version == null ? CURRENT_VERSION : version,
        crc32: CRC32.crc32(body),
        savedAt: new Date().toISOString(),
        payload: body,
      });
    }

    _decode(raw, slotLabel) {
      if (raw == null) throw new SaveError("EMPTY", slotLabel + " 槽位为空");
      let env;
      try {
        env = JSON.parse(raw);
      } catch (e) {
        throw new SaveError("PARSE", slotLabel + " 存档 JSON 解析失败: " + e.message);
      }
      if (!env || env.magic !== MAGIC) throw new SaveError("MAGIC", slotLabel + " 魔数不匹配");
      if (typeof env.version !== "number") throw new SaveError("VERSION", slotLabel + " 缺少版本号");
      const expect = CRC32.crc32(env.payload);
      if (env.crc32 !== expect) {
        throw new SaveError(
          "CRC",
          slotLabel + " 校验码不匹配 (期望 " + expect + ", 实际 " + env.crc32 + ")"
        );
      }
      return env;
    }

    _migrate(env) {
      let version = env.version;
      if (version > CURRENT_VERSION) {
        throw new SaveError(
          "TOO_NEW",
          "存档版本 v" + version + " 高于当前支持的 v" + CURRENT_VERSION + "，请升级游戏后再试"
        );
      }
      let payload = JSON.parse(env.payload);
      const migratedFrom = version;
      while (version < CURRENT_VERSION) {
        const step = MIGRATIONS[version];
        if (!step) throw new SaveError("NO_MIGRATION", "缺少 v" + version + " 的迁移路径");
        payload = step(payload);
        version += 1;
        this.metrics.inc("save.migrated");
      }
      return { payload, migratedFrom: migratedFrom === version ? null : migratedFrom, version };
    }

    // 原子保存：写空闲槽 -> 回读校验 -> 切换指针。任一步失败保留旧快照。
    save(payload) {
      const t0 = nowMs();
      const ptr = this.storage.getItem(PTR_KEY);
      const activeIdx = ptr === "0" || ptr === "1" ? Number(ptr) : -1;
      const targetIdx = activeIdx === 0 ? 1 : 0; // 永远写空闲槽，唯一副本不被覆盖
      const key = SLOT_KEYS[targetIdx];
      try {
        const encoded = this._encode(payload);
        this.storage.setItem(key, encoded);
        this.metrics.resources.saveBytesWritten += encoded.length;
        // 回读校验，确认落盘完整
        const env = this._decode(this.storage.getItem(key), "槽" + targetIdx);
        this._migrate(env); // 确认可迁移/可解析
        this.storage.setItem(PTR_KEY, String(targetIdx));
        this.metrics.resources.slotsUsed = SLOT_KEYS.filter((k) => this.storage.getItem(k) != null).length;
        this.metrics.resources.snapshotsKept = this.metrics.resources.slotsUsed;
        this.metrics.inc("save.ok");
        const elapsed = this.metrics.observeMs("save.writeMs", nowMs() - t0);
        this.lastRecovery = {
          state: "saved",
          detail: "已写入槽 " + targetIdx + "（v" + CURRENT_VERSION + "，校验通过）",
          suggestion: "无需恢复",
          elapsedMs: +elapsed.toFixed(2),
        };
        return { ok: true, slot: targetIdx, elapsedMs: elapsed };
      } catch (err) {
        this.metrics.logError("save", err);
        this.metrics.inc("save.failed");
        // 失败时指针未切换，旧快照仍是唯一权威副本
        try { this.storage.removeItem(key); } catch (_) { /* 清理半成品，错误已记录 */ }
        const elapsed = this.metrics.observeMs("save.writeMs", nowMs() - t0);
        this.lastRecovery = {
          state: "save_failed",
          detail: err.message,
          suggestion: "写入中断：已保留最近完整快照，可重试保存",
          elapsedMs: +elapsed.toFixed(2),
        };
        throw err; // 不隐藏异常，继续上抛
      }
    }
    // 加载：优先活动槽，校验失败回退另一槽（最近完整快照）；两槽皆坏则报错并给出建议
    load() {
      const t0 = nowMs();
      const ptr = this.storage.getItem(PTR_KEY);
      const order = ptr === "1" ? [1, 0] : ptr === "0" ? [0, 1] : [0, 1];
      const problems = [];
      for (const idx of order) {
        const raw = this.storage.getItem(SLOT_KEYS[idx]);
        if (raw == null) continue;
        this.metrics.resources.saveBytesRead += raw.length;
        try {
          const env = this._decode(raw, "槽" + idx);
          const { payload, migratedFrom, version } = this._migrate(env);
          const elapsed = this.metrics.observeMs("save.readMs", nowMs() - t0);
          const recovered = problems.length > 0;
          if (recovered) this.metrics.inc("save.recovered");
          this.metrics.inc("save.loaded");
          this.lastRecovery = {
            state: recovered ? "recovered" : migratedFrom != null ? "migrated" : "loaded",
            detail:
              "从槽 " + idx + " 加载 v" + version +
              (migratedFrom != null ? "（由 v" + migratedFrom + " 迁移）" : "") +
              (recovered ? "；已回退损坏槽: " + problems.join("; ") : ""),
            suggestion: recovered ? "检测到损坏快照，已回退到最近完整快照" : "无需恢复",
            elapsedMs: +elapsed.toFixed(2),
          };
          return { ok: true, payload, version, slot: idx, recovered, migratedFrom };
        } catch (err) {
          this.metrics.logError("load.slot" + idx, err);
          problems.push("槽" + idx + ": " + err.message);
        }
      }
      const elapsed = this.metrics.observeMs("save.readMs", nowMs() - t0);
      const err = new SaveError(
        "ALL_CORRUPT",
        problems.length ? "所有快照均损坏: " + problems.join("; ") : "未找到任何存档"
      );
      this.metrics.logError("load", err);
      this.metrics.inc("save.unrecoverable");
      this.lastRecovery = {
        state: "unrecoverable",
        detail: err.message,
        suggestion: problems.length
          ? "建议从备份目录导入存档，或开始新游戏（旧数据未覆盖）"
          : "开始新游戏以创建首个快照",
        elapsedMs: +elapsed.toFixed(2),
      };
      return { ok: false, error: err };
    }
  }

  // “修改前”基线：单槽、无版本、无校验、直接覆盖唯一副本（用于前后对比）
  class LegacySaveManager {
    constructor(storage, metrics) {
      this.storage = storage;
      this.metrics = metrics;
      this.key = "game.save";
    }
    save(payload) {
      const t0 = nowMs();
      const raw = JSON.stringify(payload);
      this.storage.setItem(this.key, raw); // 写入中断即留下半个文件，覆盖唯一副本
      this.metrics.resources.saveBytesWritten += raw.length;
      this.metrics.resources.slotsUsed = 1;
      this.metrics.resources.snapshotsKept = 1;
      this.metrics.inc("save.ok");
      this.metrics.observeMs("save.writeMs", nowMs() - t0);
      return { ok: true };
    }
    load() {
      const t0 = nowMs();
      const raw = this.storage.getItem(this.key);
      this.metrics.resources.saveBytesRead += raw ? raw.length : 0;
      this.metrics.observeMs("save.readMs", nowMs() - t0);
      if (raw == null) return { ok: false, error: new SaveError("EMPTY", "无存档") };
      try {
        return { ok: true, payload: JSON.parse(raw) };
      } catch (err) {
        this.metrics.logError("load", err);
        this.metrics.inc("save.unrecoverable");
        return { ok: false, error: err }; // 无快照可回退
      }
    }
  }

  return { SaveManager, LegacySaveManager, SaveError, CURRENT_VERSION, MAGIC, SLOT_KEYS, PTR_KEY };
});
