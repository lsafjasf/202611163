// 入口：Canvas 渲染地图 + 存档状态面板（当前模式 / 恢复状态 / 耗时 / 资源统计 / 恢复建议）。
(function () {
  "use strict";
  const metrics = new Metrics.Metrics();
  const saveMgr = new SaveManager.SaveManager(window.localStorage, metrics);
  const state = Game.createInitialState();
  let mode = "versioned-v" + SaveManager.CURRENT_VERSION; // 当前存档模式
  let moveCount = 0;

  const canvas = document.getElementById("hud");
  const ctx = canvas.getContext("2d");

  function doSave() {
    try {
      saveMgr.save(Game.toPayload(state));
    } catch (err) {
      // 异常已记录到 metrics.errors，这里仅刷新界面，不吞掉
      console.error("保存失败:", err);
    }
    render();
  }

  function doLoad() {
    const res = saveMgr.load();
    if (res.ok) Game.applyPayload(state, res.payload);
    render();
  }

  function doStep() {
    const p = state.progress.player;
    const nx = Math.min(Game.MAP_W - 2, p.x + 1);
    if (state.map[p.y][nx] === 0) p.x = nx;
    state.progress.score += 10;
    moveCount += 1;
    if (moveCount % 5 === 0) {
      Game.recordReplay(state, { seed: 42, moves: ["R".repeat(1)], score: state.progress.score });
    }
    render();
  }

  // 模拟写入中断：直接往活动槽写半截数据（故障注入），再读取验证回退
  function doCorrupt() {
    const ptr = window.localStorage.getItem(SaveManager.PTR_KEY) || "0";
    const key = SaveManager.SLOT_KEYS[Number(ptr)];
    const raw = window.localStorage.getItem(key);
    if (raw) window.localStorage.setItem(key, raw.slice(0, Math.floor(raw.length / 2)));
    doLoad();
  }

  function drawMap() {
    const cell = 24;
    for (let y = 0; y < Game.MAP_H; y++) {
      for (let x = 0; x < Game.MAP_W; x++) {
        ctx.fillStyle = state.map[y][x] === 1 ? "#3a4550" : "#1b222b";
        ctx.fillRect(x * cell, y * cell, cell - 1, cell - 1);
      }
    }
    ctx.fillStyle = "#ffd54f";
    ctx.fillRect(state.progress.player.x * cell + 6, state.progress.player.y * cell + 6, 12, 12);
  }

  function drawPanel() {
    const rec = saveMgr.lastRecovery || { state: "idle", detail: "尚未保存/读取", suggestion: "-", elapsedMs: 0 };
    const res = metrics.resourceSnapshot();
    const s = metrics.summary();
    const writeAvg = s.timings["save.writeMs"] ? s.timings["save.writeMs"].avgMs : 0;
    const lines = [
      "模式: " + mode + "    恢复状态: " + rec.state,
      "摘要: " + rec.detail,
      "建议: " + rec.suggestion,
      "耗时: 上次 " + rec.elapsedMs + "ms / 平均写入 " + writeAvg + "ms",
      "资源: 写入 " + res.saveBytesWritten + "B, 读取 " + res.saveBytesRead + "B, 快照 " + res.snapshotsKept + " 份",
      "指标: 保存成功 " + (s.counters["save.ok"] || 0) + ", 回退恢复 " + (s.counters["save.recovered"] || 0) +
        ", 错误 " + s.errorCount + " 条",
      "关卡 " + state.progress.level + "  分数 " + state.progress.score + "  回放 " + state.replays.length + " 条",
    ];
    ctx.fillStyle = "#0d1117";
    ctx.fillRect(0, Game.MAP_H * 24 + 4, canvas.width, canvas.height - Game.MAP_H * 24 - 4);
    ctx.fillStyle = rec.state === "unrecoverable" || rec.state === "save_failed" ? "#ff6b6b" : "#8be9a8";
    ctx.font = "13px monospace";
    lines.forEach((line, i) => ctx.fillText(line, 10, Game.MAP_H * 24 + 24 + i * 20));
  }

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawMap();
    drawPanel();
  }

  document.getElementById("btnSave").addEventListener("click", doSave);
  document.getElementById("btnLoad").addEventListener("click", doLoad);
  document.getElementById("btnStep").addEventListener("click", doStep);
  document.getElementById("btnCorrupt").addEventListener("click", doCorrupt);
  render();
})();
