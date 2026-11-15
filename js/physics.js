/* 物理与世界模拟（无 DOM 依赖，可直接在 Node 中自测）。
   坐标系：x 横向（0..RIVER_WIDTH），y 纵向（0 出发岸 .. RIVER_LENGTH 对岸）。
   筏体朝向 heading=0 时指向 +y（顺流），左右桨分别施加反向力矩。 */
(function (root, factory) {
  const deps = [
    (typeof RG_BROWSER !== 'undefined' && RG_BROWSER) ? root.RG : require('./config'),
    (typeof RG_BROWSER !== 'undefined' && RG_BROWSER) ? root.RG : require('./rng')
  ];
  const mod = factory(deps[0].CONFIG, deps[1].mulberry32);
  if (typeof RG_BROWSER !== 'undefined' && RG_BROWSER) { root.RG = root.RG || {}; Object.assign(root.RG, mod); }
  else if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.RG = Object.assign(root.RG || {}, mod);
})(typeof self !== 'undefined' ? self : this, function (CONFIG, mulberry32) {
  'use strict';

  function createWorld(seed) {
    const rand = mulberry32(seed >>> 0);
    const rocks = [];
    for (let i = 0; i < CONFIG.ROCK_COUNT; i++) {
      const y = 120 + (CONFIG.RIVER_LENGTH - 240) * ((i + 0.5) / CONFIG.ROCK_COUNT)
        + (rand() - 0.5) * 40;
      // 礁石偏向两侧 1/4 与 3/4 处，中央始终保留协作可通过的航道；
      // 横向水流会把筏子从中央推向这些礁石。
      const sideBias = i % 2 === 0 ? 0.26 : 0.74;
      const x = CONFIG.RIVER_WIDTH * sideBias + (rand() - 0.5) * 46;
      const r = CONFIG.ROCK_RADIUS * (0.8 + rand() * 0.5);
      rocks.push({ id: 'rock' + i, x, y, r });
    }
    return {
      seed: seed >>> 0,
      rocks,
      startY: 60,
      goalY: CONFIG.RIVER_LENGTH - 60
    };
  }

  function createRaft() {
    return {
      x: CONFIG.RIVER_WIDTH / 2,
      y: 60,
      vx: 0,
      vy: 0,
      heading: 0,            // 弧度，0 朝下游
      omega: 0,
      hull: CONFIG.HULL_MAX,
      stamina: { left: CONFIG.STAMINA_MAX, right: CONFIG.STAMINA_MAX },
      strokeRate: { left: 0, right: 0 },   // EMA 桨频 次/秒
      lastStrokeAt: { left: -99, right: -99 },
      invuln: 0,             // 撞击后的短暂无敌时间
      bankTimer: 0,          // 持续贴岸/搁浅计时
      passengers: 3,
      delivered: 0,
      strokeGaps: { left: [], right: [] }   // 最近划水间隔，用于滚动桨频
    };
  }

  function raftMass(raft) {
    return CONFIG.RAFT_BASE_MASS + raft.passengers * (CONFIG.PASSENGER_TOTAL_MASS / 3);
  }

  /* 水流场：顺流分量 + 横向分量。横向流在礁石附近增强，
     方向随航程交替，持续把筏体推向礁石/岸边。 */
  function currentAt(x, y) {
    const t = y / CONFIG.RIVER_LENGTH;
    const down = CONFIG.CURRENT_DOWNSTREAM * (0.85 + 0.3 * Math.sin(t * Math.PI * 3));
    // 横向流随航程缓慢换向：需要两人持续微调航向，而不是一次划正就一路直行
    const lateral = CONFIG.CURRENT_LATERAL
      * Math.sin(t * Math.PI * 4 + 0.7);
    return { x: lateral, y: down };
  }

  function createSyncState() {
    return {
      level: 1,                 // 0..1，1 表示完全同步
      lastPairAt: -99,
      conflicts: 0,
      spamStrokes: 0,
      lastConflictAt: -99      // 冲突事件冷却，避免同一失误刷屏
    };
  }

  /* 一次划水。side: 'left' | 'right'，reverse: 反划。
     返回事件描述（含冲突标记），供回放/音效/自测使用。 */
  function applyStroke(ctx, side, reverse, now) {
    const raft = ctx.raft;
    const sync = ctx.sync;
    const other = side === 'left' ? 'right' : 'left';
    const stamina = raft.stamina[side];
    const event = {
      type: 'stroke', t: now, side, reverse,
      conflict: null, spam: false, weak: stamina < CONFIG.STAMINA_LOW
    };

    const gap = now - raft.lastStrokeAt[side];
    if (gap < CONFIG.RHYTHM_SPAM) {
      event.spam = true;
      sync.spamStrokes++;
    }
    const pairGap = now - raft.lastStrokeAt[other];
    if (pairGap > 0.6 && now > 1) {
      // 另一侧已两次划水周期未配合：单侧发力冲突
      sync.level = Math.max(0, sync.level - 0.12);
      if (now - sync.lastConflictAt > 0.8) {
        event.conflict = 'one-sided';
        sync.conflicts++;
        sync.lastConflictAt = now;
      }
    } else if (gap < CONFIG.RHYTHM_SPAM && pairGap > CONFIG.RHYTHM_WINDOW) {
      // 同侧疯狂连划而另一侧没跟上：节奏冲撞
      sync.level = Math.max(0, sync.level - 0.08);
      if (now - sync.lastConflictAt > 0.4) {
        event.conflict = 'clash';
        sync.conflicts++;
        sync.lastConflictAt = now;
      }
    } else if (pairGap <= CONFIG.RHYTHM_WINDOW && pairGap >= 0) {
      sync.level = Math.min(1, sync.level + 0.18);
      sync.lastPairAt = now;
    }

    let power = reverse ? CONFIG.STROKE_IMPULSE * CONFIG.REVERSE_FACTOR : CONFIG.STROKE_IMPULSE;
    if (stamina < CONFIG.STAMINA_LOW) power *= 0.55;
    raft.stamina[side] = Math.max(0, stamina - CONFIG.STAMINA_COST);

    // 朝 heading 方向推进；左桨划水让船头右转（正力矩），右桨反之
    const dir = reverse ? -1 : 1;
    const hx = Math.sin(raft.heading);
    const hy = Math.cos(raft.heading);
    raft.vx += (hx * power * dir) / raftMass(raft);
    raft.vy += (hy * power * dir) / raftMass(raft);
    const torqueSign = side === 'left' ? 1 : -1;
    raft.omega += (torqueSign * CONFIG.STROKE_TORQUE * dir) / raftMass(raft);

    // 滚动桨频：最近 6 次划水间隔的倒数平均，闲置时由步进逻辑衰减到 0
    if (gap > 0 && gap < 2) {
      const gaps = raft.strokeGaps[side];
      gaps.push(gap);
      if (gaps.length > 6) gaps.shift();
      const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      raft.strokeRate[side] = 1 / avgGap;
    }
    raft.lastStrokeAt[side] = now;
    ctx.trail.push({
      x: raft.x + (side === 'left' ? -1 : 1) * CONFIG.RAFT_HALF_WIDTH,
      y: raft.y - CONFIG.RAFT_HALF_LENGTH * 0.6,
      life: 1.2, side
    });
    return event;
  }

  function stepPhysics(ctx, dt) {
    if (ctx.status !== 'running') return;
    const raft = ctx.raft;
    const world = ctx.world;
    ctx.time += dt;

    // 水流（受乘客载重影响：越重越容易被推偏）。
    // 横向流采用加速度模型，与水阻形成可被划桨抵消的平衡速度。
    const cur = currentAt(raft.x, raft.y);
    const loadFactor = 1 + (raft.passengers * 0.06);
    raft.vx += cur.x * loadFactor * dt;
    raft.vy += cur.y * dt;

    // 水阻
    const sp = Math.hypot(raft.vx, raft.vy);
    const drag = CONFIG.DRAG_LINEAR + CONFIG.DRAG_QUAD * sp;
    raft.vx -= raft.vx * drag * dt;
    raft.vy -= raft.vy * drag * dt;
    raft.omega -= raft.omega * CONFIG.ANG_DRAG * dt;
    raft.omega -= raft.heading * CONFIG.HEADING_CORRECTION * dt;

    raft.x += raft.vx * dt;
    raft.y += raft.vy * dt;
    raft.heading += raft.omega * dt;
    raft.heading = Math.atan2(Math.sin(raft.heading), Math.cos(raft.heading));

    // 体力恢复与桨频回落
    ['left', 'right'].forEach((side) => {
      raft.stamina[side] = Math.min(
        CONFIG.STAMINA_MAX, raft.stamina[side] + CONFIG.STAMINA_REGEN * dt
      );
      if (ctx.time - raft.lastStrokeAt[side] > 0.8) {
        raft.strokeRate[side] = Math.max(0, raft.strokeRate[side] - dt * 3);
        if (raft.strokeRate[side] === 0) raft.strokeGaps[side].length = 0;
      }
    });
    ctx.sync.level = Math.max(0, ctx.sync.level - CONFIG.SYNC_DECAY * dt * 0.25);

    // 桨迹衰减
    for (let i = ctx.trail.length - 1; i >= 0; i--) {
      ctx.trail[i].life -= dt;
      if (ctx.trail[i].life <= 0) ctx.trail.splice(i, 1);
    }
    if (raft.invuln > 0) raft.invuln -= dt;

    // 河岸：弹回并累计搁浅时间，持续无法脱浅则失败
    const halfW = CONFIG.RAFT_HALF_WIDTH;
    const atBank = raft.x < CONFIG.BANK + halfW
      || raft.x > CONFIG.RIVER_WIDTH - CONFIG.BANK - halfW;
    if (atBank) {
      raft.x = Math.max(CONFIG.BANK + halfW,
        Math.min(CONFIG.RIVER_WIDTH - CONFIG.BANK - halfW, raft.x));
      raft.vx *= -0.35;
      raft.bankTimer += dt;
      if (raft.bankTimer >= CONFIG.BANK_GROUND_LIMIT) {
        ctx.status = 'lost';
        ctx.endReason = 'grounded';
        emit(ctx, { type: 'end', t: ctx.time, result: 'lost', reason: 'grounded' });
        return;
      }
      if (raft.invuln <= 0) damage(ctx, 'bank', raft.x, raft.y);
    } else {
      raft.bankTimer = Math.max(0, raft.bankTimer - dt * 2);
    }

    // 礁石碰撞（圆-圆）
    for (const rock of world.rocks) {
      const dx = raft.x - rock.x;
      const dy = raft.y - rock.y;
      const dist = Math.hypot(dx, dy);
      const minDist = rock.r + halfW * 0.8;
      if (dist < minDist) {
        const nx = dist > 0.001 ? dx / dist : 1;
        const ny = dist > 0.001 ? dy / dist : 0;
        raft.x = rock.x + nx * minDist;
        raft.y = rock.y + ny * minDist;
        const push = CONFIG.COLLISION_PUSH / raftMass(raft);
        raft.vx += nx * push;
        raft.vy += ny * push * 0.5;
        raft.omega += (ctx.rng() - 0.5) * 2;
        damage(ctx, 'rock', rock.x, rock.y, rock.id);
      }
    }

    // 胜负
    if (raft.hull <= 0) {
      ctx.status = 'lost';
      ctx.endReason = 'hull';
      emit(ctx, { type: 'end', t: ctx.time, result: 'lost', reason: 'hull' });
    } else if (ctx.time >= CONFIG.TIME_LIMIT) {
      ctx.status = 'lost';
      ctx.endReason = 'timeout';
      emit(ctx, { type: 'end', t: ctx.time, result: 'lost', reason: 'timeout' });
    } else if (raft.y >= world.goalY) {
      ctx.status = 'won';
      raft.delivered = raft.passengers;
      ctx.endReason = 'goal';
      emit(ctx, { type: 'end', t: ctx.time, result: 'won', reason: 'goal',
        conflicts: ctx.sync.conflicts });
    }
  }

  function damage(ctx, kind, x, y, rockId) {
    const raft = ctx.raft;
    if (raft.invuln > 0) return;
    raft.hull -= 1;
    raft.invuln = CONFIG.COLLISION_INVULN;
    emit(ctx, { type: 'collision', t: ctx.time, kind, x, y, rockId: rockId || null,
      hull: raft.hull });
  }

  function createRunContext(seed) {
    const ctx = {
      world: createWorld(seed),
      raft: createRaft(),
      sync: createSyncState(),
      trail: [],
      time: 0,
      events: [],
      status: 'running',       // running | won | lost
      rng: mulberry32((seed >>> 0) ^ 0x9e3779b9)
    };
    ctx.endReason = null;
    return ctx;
  }

  function emit(ctx, event) {
    ctx.events.push(event);
  }

  return {
    createWorld, createRaft, raftMass, currentAt,
    createSyncState, applyStroke, createRunContext, step: stepPhysics
  };
});
