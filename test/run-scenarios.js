// 三组场景 × 修改前(Legacy)/修改后(Versioned) 对比：
// 正常输入 / 边界输入 / 损坏输入。记录最终结果、异常日志、资源计数。
// 运行: node test/run-scenarios.js  （输出文本报告并写 artifacts/report.json）
"use strict";
const fs = require("fs");
const path = require("path");
const { Metrics } = require("../src/metrics.js");
const { SaveManager, LegacySaveManager, SaveError, CURRENT_VERSION, SLOT_KEYS, PTR_KEY } = require("../src/saveManager.js");
const Game = require("../src/game.js");
const { FaultyStorage, makeRng } = require("./harness.js");

const MODES = {
  before: (storage, metrics) => new LegacySaveManager(storage, metrics),
  after: (storage, metrics) => new SaveManager(storage, metrics),
};

function makePayload(overrides) {
  const state = Game.createInitialState();
  state.progress.score = 120;
  state.progress.level = 3;
  Game.recordReplay(state, { seed: 7, moves: ["R", "R", "U"], score: 120 });
  return Object.assign(Game.toPayload(state), overrides || {});
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---------- 场景 1：正常输入 ----------
function scenarioNormal(mgr) {
  const payload = makePayload();
  mgr.save(payload);
  const res = mgr.load();
  return {
    finalResult: res.ok && deepEqual(res.payload, payload) ? "数据一致" : "数据不一致/加载失败",
    ok: res.ok && deepEqual(res.payload, payload),
  };
}

// ---------- 场景 2：边界输入 ----------
function scenarioBoundary(mgr, storage, mode) {
  const notes = [];
  // 2a. 空回放 + 极限关卡值 + 最大回放条数
  const edge = makePayload({ replays: [], progress: { level: 999, score: 0, player: { x: 1, y: 1 } } });
  mgr.save(edge);
  const r1 = mgr.load();
  notes.push(r1.ok && r1.payload.replays.length === 0 ? "空回放OK" : "空回放失败");
  // 2b. 回放超过上限时裁剪到 MAX_REPLAYS
  const many = makePayload({ replays: Array.from({ length: 10 }, (_, i) => ({ seed: i, moves: [], score: i })) });
  mgr.save(many);
  const r2 = mgr.load();
  notes.push(r2.ok ? "回放保留 " + r2.payload.replays.length + " 条" : "回放加载失败");
  // 2c. 旧版本 v1 存档：after 应迁移，before 无版本概念按原样读
  if (mode === "after") {
    const v1 = JSON.stringify({
      magic: "UID748SAVE", version: 1, crc32: 0, savedAt: "2026-01-01T00:00:00Z",
      payload: JSON.stringify({ map: edge.map, progress: edge.progress, settings: { volume: 0.5 } }),
    });
    const env = JSON.parse(v1);
    env.crc32 = require("../src/crc32.js").crc32(env.payload);
    storage.setItem(SLOT_KEYS[0], JSON.stringify(env));
    storage.setItem(SLOT_KEYS[1], JSON.stringify(env));
    const r3 = mgr.load();
    notes.push(r3.ok && r3.migratedFrom === 1 && r3.payload.settings.quality === "high" ? "v1迁移OK" : "v1迁移失败");
    // 2d. 更高版本存档：必须提示而不是静默覆盖
    const vNew = JSON.parse(v1);
    vNew.version = CURRENT_VERSION + 1;
    vNew.crc32 = require("../src/crc32.js").crc32(vNew.payload);
    storage.setItem(SLOT_KEYS[0], JSON.stringify(vNew));
    storage.setItem(SLOT_KEYS[1], JSON.stringify(vNew));
    const r4 = mgr.load();
    notes.push(!r4.ok && r4.error && r4.error.code === "ALL_CORRUPT" ? "高版本已提示" : "高版本处理异常");
  }
  const ok = notes.every((n) => n.indexOf("失败") < 0 && n.indexOf("异常") < 0);
  return { finalResult: notes.join("；"), ok };
}

// ---------- 场景 3：损坏输入（种子固定，可重复） ----------
function scenarioCorrupted(mgr, storage, mode) {
  const notes = [];
  const payload = makePayload();
  // 3a. 写入中断：落盘半截数据
  mgr.save(payload); // 先有一份好存档
  storage.fault = { type: "truncate", atBytes: 40 };
  let threw = false;
  try { mgr.save(makePayload({ progress: { level: 9, score: 999, player: { x: 2, y: 2 } } })); }
  catch (e) { threw = true; }
  storage.fault = null;
  const r1 = mgr.load();
  const kept = r1.ok && r1.payload.progress.score === 120;
  notes.push(
    (mode === "after"
      ? threw && kept
        ? "写入中断被保存时回读校验拦截,完整快照保留(槽" + r1.slot + ")"
        : "回退失败"
      : kept ? "旧数据幸存(偶然)" : "唯一副本被截断覆盖,数据丢失")
  );
  // 3b. 位翻转损坏（种子 20261116 固定）
  storage.fault = { type: "flip", rng: makeRng(20261116), count: 6 };
  try { mgr.save(payload); } catch (e) { /* after 模式会校验失败并上抛，符合预期 */ }
  storage.fault = null;
  const r2 = mgr.load();
  notes.push(
    mode === "after"
      ? r2.ok && r2.recovered ? "位翻转后回退到最近完整快照" : (r2.ok ? "位翻转被校验拦截" : "位翻转未恢复")
      : r2.ok ? "损坏数据被原样加载(无校验)" : "损坏后无法加载且无快照可回退"
  );
  // 3b2. 磁盘腐蚀：直接破坏活动槽内容，加载应回退到另一槽的完整快照
  if (mode === "after") {
    mgr.save(makePayload({ progress: { level: 4, score: 456, player: { x: 3, y: 3 } } })); // 写入槽1,ptr=1
    const activeKey = SLOT_KEYS[Number(storage.getItem(PTR_KEY))];
    const raw = storage.getItem(activeKey);
    storage.fault = null;
    storage.setItem(activeKey, raw.slice(0, raw.length - 30)); // 截尾损坏活动槽
    const r2b = mgr.load();
    notes.push(
      r2b.ok && r2b.recovered && r2b.payload.progress.score === 120
        ? "活动槽腐蚀后回退到槽" + r2b.slot + "完整快照"
        : "活动槽腐蚀回退失败"
    );
  }
  // 3c. 全部副本损坏
  for (const k of SLOT_KEYS.concat(["game.save"])) {
    if (storage.getItem(k) != null) storage.setItem(k, "{broken");
  }
  const r3 = mgr.load();
  notes.push(!r3.ok ? "全部损坏时明确报错并给出恢复建议" : "全部损坏却误报成功");
  const ok =
    mode === "after"
      ? r1.ok && kept && r2.ok && !r3.ok
      : true; // before 仅如实记录表现
  return { finalResult: notes.join("；"), ok };
}
// ---------- 驱动：每场景独立存储与指标，输出对比 ----------
const SCENARIOS = [
  ["正常输入", scenarioNormal],
  ["边界输入", scenarioBoundary],
  ["损坏输入", scenarioCorrupted],
];

const report = { generatedAt: new Date().toISOString(), runs: [] };

for (const [name, fn] of SCENARIOS) {
  for (const mode of ["before", "after"]) {
    const storage = new FaultyStorage();
    const metrics = new Metrics();
    const mgr = MODES[mode](storage, metrics);
    let outcome, crashed = null;
    try {
      outcome = fn(mgr, storage, mode);
    } catch (err) {
      crashed = { name: err.name, message: err.message };
      metrics.logError("scenario", err);
      outcome = { finalResult: "场景异常终止: " + err.message, ok: false };
    }
    metrics.resources.storageBytes = storage.totalBytes();
    const summary = metrics.summary();
    report.runs.push({
      scenario: name,
      mode,
      ok: outcome.ok,
      finalResult: outcome.finalResult,
      crashed,
      errorLog: metrics.errors,
      counters: summary.counters,
      timings: summary.timings,
      resources: summary.resources,
    });
  }
}

// 文本对比报告
console.log("======== 存档系统 修改前(before) vs 修改后(after) 对比 ========");
for (const [name] of SCENARIOS) {
  console.log("\n【场景】" + name);
  for (const mode of ["before", "after"]) {
    const r = report.runs.find((x) => x.scenario === name && x.mode === mode);
    console.log("  [" + mode + "] 结果: " + (r.ok ? "通过" : "未通过") + " | " + r.finalResult);
    console.log("        异常日志 " + r.errorLog.length + " 条" +
      (r.errorLog.length ? " -> " + r.errorLog.map((e) => e.context + ":" + e.message).join(" | ") : ""));
    console.log("        资源: " + JSON.stringify(r.resources) +
      " 写入耗时avg=" + (r.timings["save.writeMs"] ? r.timings["save.writeMs"].avgMs : "-") + "ms");
  }
}

const outPath = path.join(__dirname, "..", "artifacts", "report.json");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log("\n报告已写入 artifacts/report.json");

// 修改后(after)的全部场景必须通过；失败以非零码退出（不伪造成功）
const afterAllOk = report.runs.filter((r) => r.mode === "after").every((r) => r.ok);
process.exit(afterAllOk ? 0 : 1);
