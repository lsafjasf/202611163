/* 确定性自测：不依赖渲染/DOM，直接驱动物理与回放模块，
   覆盖需求中的六个验收场景。浏览器与 Node 均可运行。 */
(function (root, factory) {
  const requireDeps = !(typeof RG_BROWSER !== 'undefined' && RG_BROWSER);
  const cfg = requireDeps ? require('./config') : root.RG;
  const phy = requireDeps ? require('./physics') : root.RG;
  const rep = requireDeps ? require('./replay') : root.RG;
  const mod = factory(cfg.CONFIG, phy, rep);
  if (typeof RG_BROWSER !== 'undefined' && RG_BROWSER) { root.RG = root.RG || {}; Object.assign(root.RG, mod); }
  else if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.RG = Object.assign(root.RG || {}, mod);
})(typeof self !== 'undefined' ? self : this, function (CONFIG, Physics, Replay) {
  'use strict';

  const WIN_SEED = 755;       // 协作/恢复/轮换均可稳定获胜的种子
  const DT = CONFIG.FIXED_DT;

  /* 势场领航：根据中央吸引 + 礁石斥力返回期望航向。 */
  function desiredHeading(ctx) {
    const raft = ctx.raft;
    let fx = (CONFIG.RIVER_WIDTH / 2 - raft.x) * 0.05;
    for (const rock of ctx.world.rocks) {
      const dx = raft.x - rock.x;
      const dy = raft.y - rock.y;
      if (dy > -20 && dy < 180) {
        const d = Math.hypot(dx, dy);
        const range = rock.r + 64;
        if (d < range && d > 0.01) fx += (dx / d) * (range - d) * 0.24;
      }
    }
    return Math.max(-1, Math.min(1, Math.atan2(fx, 6)));
  }

  /* strokeEvery: 每 N 帧允许划一次；coop 双侧参与，oneSide 只允许单侧。 */
  function runScenario(opts) {
    const ctx = Physics.createRunContext(opts.seed);
    const recorder = new Replay.Recorder({
      seed: opts.seed, mode: opts.mode || 'coop',
      initialSides: opts.initialSides || { p1: 'left', p2: 'right' },
      swapLog: opts.swapLog || []
    });
    let frame = 0;
    const phases = opts.phases || [{ until: Infinity, kind: 'coop' }];
    let phaseIdx = 0;
    const conflictTimes = [];
    ctx._recordedEvents = 0;

    while (ctx.status === 'running' && frame < 60 * CONFIG.TIME_LIMIT + 60) {
      const t = frame * DT;
      while (phaseIdx < phases.length - 1 && t >= phases[phaseIdx].until) phaseIdx++;
      const phase = phases[phaseIdx];
      const dh = desiredHeading(ctx) - ctx.raft.heading;

      const strokeEvents = [];
      if (frame % 6 === 0) {
        if (phase.kind === 'coop') {
          if (dh > 0.05) strokeEvents.push(Physics.applyStroke(ctx, 'left', false, t));
          else if (dh < -0.05) strokeEvents.push(Physics.applyStroke(ctx, 'right', false, t));
          else {
            strokeEvents.push(Physics.applyStroke(ctx, 'left', false, t));
            strokeEvents.push(Physics.applyStroke(ctx, 'right', false, t));
          }
        } else if (phase.kind === 'oneSide') {
          strokeEvents.push(Physics.applyStroke(ctx, phase.side || 'left', false, t));
        } else if (phase.kind === 'idle') {
          // 失误期：该侧玩家停划，另一侧保持节奏
          strokeEvents.push(Physics.applyStroke(ctx, phase.activeSide || 'right', false, t));
        }
      }
      for (const ev of strokeEvents) {
        recorder.recordEvent(ev);
        if (ev.conflict) conflictTimes.push(ev);
      }
      Physics.step(ctx, DT);
      while (ctx._recordedEvents < ctx.events.length) {
        const ev = ctx.events[ctx._recordedEvents++];
        recorder.recordEvent(ev);
        if (ev.type === 'collision') conflictTimes.push(ev);
      }
      recorder.recordFrame(ctx);
      frame++;
    }
    const record = recorder.finalize(ctx);
    return { ctx, record, conflictTimes };
  }

  return { runScenario, desiredHeading, WIN_SEED, DT };
});
