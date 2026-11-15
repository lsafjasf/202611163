/* 回放系统：录制固定频率的状态快照 + 全部事件流。
   每局结束（胜利或失败）形成一份完整回放，保留最近 N 份。
   事件中的 collision / conflict 标记就是“冲突发生的时刻”。 */
(function (root, factory) {
  const deps = [(typeof RG_BROWSER !== 'undefined' && RG_BROWSER) ? root.RG : require('./config')];
  const mod = factory(deps[0].CONFIG);
  if (typeof RG_BROWSER !== 'undefined' && RG_BROWSER) { root.RG = root.RG || {}; Object.assign(root.RG, mod); }
  else if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.RG = Object.assign(root.RG || {}, mod);
})(typeof self !== 'undefined' ? self : this, function (CONFIG) {
  'use strict';

  function snapshotRaft(raft) {
    return {
      x: raft.x, y: raft.y, vx: raft.vx, vy: raft.vy,
      heading: raft.heading, omega: raft.omega,
      hull: raft.hull,
      stamina: { left: raft.stamina.left, right: raft.stamina.right },
      strokeRate: { left: raft.strokeRate.left, right: raft.strokeRate.right },
      passengers: raft.passengers, delivered: raft.delivered
    };
  }

  class Recorder {
    constructor(meta) {
      this.record = {
        version: 1,
        startedAt: new Date(meta.now || Date.now()).toISOString(),
        seed: meta.seed,
        mode: meta.mode || 'coop',          // coop | debug
        initialSides: meta.initialSides || { p1: 'left', p2: 'right' },
        swapLog: (meta.swapLog || []).slice(),
        frames: [],
        events: [],
        result: null,
        endReason: null,
        duration: 0,
        conflicts: 0
      };
      this._frameIndex = 0;
    }

    /* 每个物理帧调用；按配置间隔存完整快照，其余帧只存精简数据。 */
    recordFrame(ctx) {
      const idx = this._frameIndex++;
      if (idx % CONFIG.REPLAY_SNAPSHOT_EVERY === 0) {
        this.record.frames.push({
          t: ctx.time, full: true,
          raft: snapshotRaft(ctx.raft),
          sync: ctx.sync.level,
          trail: ctx.trail.map((tr) => ({ x: tr.x, y: tr.y, life: tr.life, side: tr.side }))
        });
      } else {
        this.record.frames.push({
          t: ctx.time, full: false,
          x: ctx.raft.x, y: ctx.raft.y, h: ctx.raft.heading, s: ctx.sync.level
        });
      }
    }

    recordEvent(event) { this.record.events.push(Object.assign({}, event)); }

    finalize(ctx) {
      const r = this.record;
      r.result = ctx.status;
      r.endReason = ctx.endReason;
      r.duration = ctx.time;
      r.conflicts = ctx.sync.conflicts;
      return r;
    }
  }

  /* 回放中冲突/撞击事件时间点，供查看器跳转。 */
  function conflictMoments(record) {
    return record.events
      .filter((e) => e.type === 'collision' || e.conflict)
      .map((e) => ({
        t: e.t,
        kind: e.type === 'collision'
          ? '撞击-' + (e.kind === 'rock' ? '礁石' : '河岸')
          : (e.conflict === 'one-sided' ? '单侧发力' : '节奏冲撞'),
        side: e.side || null
      }));
  }

  /* 找到 t 时刻应展示的最近快照帧（二分）。 */
  function frameAt(record, t) {
    const frames = record.frames;
    let lo = 0, hi = frames.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (frames[mid].t <= t) lo = mid;
      else hi = mid - 1;
    }
    return frames[lo];
  }

  const ReplayStore = {
    save(record) {
      if (typeof localStorage === 'undefined') return [];
      const list = ReplayStore.list();
      list.unshift(record);
      while (list.length > CONFIG.REPLAY_MAX_STORE) list.pop();
      localStorage.setItem(CONFIG.REPLAY_STORAGE_KEY, JSON.stringify(list));
      return list;
    },
    list() {
      if (typeof localStorage === 'undefined') return [];
      try {
        return JSON.parse(localStorage.getItem(CONFIG.REPLAY_STORAGE_KEY) || '[]');
      } catch (err) {
        return [];
      }
    },
    clear() {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(CONFIG.REPLAY_STORAGE_KEY);
      }
    }
  };

  return { Recorder, conflictMoments, frameAt, ReplayStore, snapshotRaft };
});
