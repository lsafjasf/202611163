/* 全局可调配置：物理、地图、计时、资源阈值。
   浏览器与 Node（自测）共用，采用 UMD 风格挂载。 */
(function (root, factory) {
  const cfg = factory();
  if (typeof RG_BROWSER !== 'undefined' && RG_BROWSER) { root.RG = root.RG || {}; Object.assign(root.RG, cfg); }
  else if (typeof module === 'object' && module.exports) module.exports = cfg;
  else root.RG = Object.assign(root.RG || {}, cfg);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CONFIG = {
    // 世界坐标：y 从 0（出发岸）向下游递增到 RIVER_LENGTH（对岸）
    RIVER_WIDTH: 280,
    RIVER_LENGTH: 1200,
    BANK: 18,                 // 河岸厚度，进入即触损

    // 筏体
    RAFT_HALF_WIDTH: 13,
    RAFT_HALF_LENGTH: 20,
    PASSENGER_TOTAL_MASS: 90, // 三名乘客总质量
    RAFT_BASE_MASS: 30,

    // 划桨：每次按键触发一次划水冲量
    STROKE_IMPULSE: 340,
    STROKE_TORQUE: 1150,      // 单侧划水产生的转向力矩
    REVERSE_FACTOR: 0.7,      // 反划的力度比例
    STAMINA_COST: 11,
    STAMINA_REGEN: 13,        // 每秒恢复
    STAMINA_LOW: 25,          // 低于该值划水效率打折
    STAMINA_MAX: 100,

    // 水阻（线性 + 二次）
    DRAG_LINEAR: 0.55,
    DRAG_QUAD: 0.012,
    ANG_DRAG: 1.0,
    HEADING_CORRECTION: 0.55, // 船身自动回正力矩系数（抑制微小不对称累积）

    // 水流
    CURRENT_DOWNSTREAM: 24,   // 基础顺流速度 px/s
    CURRENT_LATERAL: 17,      // 横向推力峰值（把筏子推向礁石，可被划桨抵消）

    // 礁石与损伤
    ROCK_COUNT: 9,
    ROCK_RADIUS: 11,
    HULL_MAX: 3,              // 撞击 3 次即失败
    COLLISION_PUSH: 170,
    COLLISION_INVULN: 1.4,   // 撞击后无敌秒数，防止连续瞬伤
    BANK_GROUND_LIMIT: 1.8,   // 持续搁浅超过该秒数即失败

    // 节奏与同步
    RHYTHM_WINDOW: 0.22,      // 双侧划水间隔小于该秒数视为同步
    RHYTHM_SPAM: 0.16,        // 同侧两次划水间隔过短视为乱划
    SYNC_DECAY: 0.55,         // 同步率每秒回落
    SYNC_GOOD: 0.85,
    SYNC_BAD: 0.45,

    // 计时
    TIME_LIMIT: 95,

    // 模拟
    FIXED_DT: 1 / 60,

    // 回放
    REPLAY_MAX_STORE: 5,
    REPLAY_SNAPSHOT_EVERY: 3, // 每 3 个物理帧存一次完整快照
    REPLAY_STORAGE_KEY: 'rg.replays.v1'
  };

  return { CONFIG };
});
