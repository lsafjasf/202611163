// 离线小游戏状态：地图网格、进度、设置、最近回放（供存档系统持久化）。
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Game = factory();
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const MAP_W = 16;
  const MAP_H = 12;
  const MAX_REPLAYS = 3; // 只保留最近 3 条回放

  function createInitialState() {
    const map = [];
    for (let y = 0; y < MAP_H; y++) {
      const row = [];
      for (let x = 0; x < MAP_W; x++) row.push(x === 0 || y === 0 || x === MAP_W - 1 || y === MAP_H - 1 ? 1 : 0);
      map.push(row);
    }
    return {
      map, // 0=空地 1=墙 2=金币
      progress: { level: 1, score: 0, player: { x: 1, y: 1 } },
      settings: { volume: 0.8, quality: "high", showFps: true },
      replays: [], // 最近回放：[{seed, moves:[...], score}]
    };
  }

  // 采集当前存档 payload（地图/进度/设置/最近回放）
  function toPayload(state) {
    return {
      map: state.map,
      progress: state.progress,
      settings: state.settings,
      replays: state.replays.slice(-MAX_REPLAYS),
    };
  }

  function applyPayload(state, payload) {
    state.map = payload.map;
    state.progress = payload.progress;
    state.settings = payload.settings;
    state.replays = Array.isArray(payload.replays) ? payload.replays : [];
    return state;
  }

  function recordReplay(state, replay) {
    state.replays.push(replay);
    if (state.replays.length > MAX_REPLAYS) state.replays.splice(0, state.replays.length - MAX_REPLAYS);
  }

  return { createInitialState, toPayload, applyPayload, recordReplay, MAP_W, MAP_H, MAX_REPLAYS };
});
