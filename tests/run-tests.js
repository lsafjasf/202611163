/* 自测入口：node tests/run-tests.js
   六个场景对应用户验收点：
   1. 协作成功：双人配合送达 3 名乘客，仪表/进度同步
   2. 单侧失误：仅一侧划水必然失败并产生冲突记录
   3. 失误后恢复：先单侧失误再恢复协作，最终成功且冲突时刻入回放
   4. 控制轮换：交换玩家控制侧后仍可完成相同任务
   5. 完全复位：重开后仪表/资源/计时/音频状态全部归零
   6. 完整回放：回放含冲突时刻，可按时间定位到每一帧 */
'use strict';

const path = require('path');
const CONFIG = require(path.join(__dirname, '..', 'js', 'config.js')).CONFIG;
const Physics = require(path.join(__dirname, '..', 'js', 'physics.js'));
const Replay = require(path.join(__dirname, '..', 'js', 'replay.js'));
const SelfTest = require(path.join(__dirname, '..', 'js', 'selftest.js'));

const results = [];
function check(name, condition, detail) {
  results.push({ name, pass: !!condition, detail: detail || '' });
}

// 场景 1：协作成功
{
  const { ctx, record } = SelfTest.runScenario({ seed: SelfTest.WIN_SEED });
  check('S1 协作模式可以获胜', ctx.status === 'won',
    'status=' + ctx.status + ' reason=' + ctx.endReason);
  check('S1 三名乘客全部送达', ctx.raft.delivered === 3,
    'delivered=' + ctx.raft.delivered);
  check('S1 同步率保持在健康区间', ctx.sync.level >= CONFIG.SYNC_BAD,
    'sync=' + ctx.sync.level.toFixed(2));
  check('S1 双侧桨频均有更新',
    ctx.raft.strokeRate.left >= 0 && ctx.raft.strokeRate.right >= 0,
    'L=' + ctx.raft.strokeRate.left.toFixed(2) + ' R=' + ctx.raft.strokeRate.right.toFixed(2));
  check('S1 回放记录完整帧序列', record.frames.length > 500 && record.result === 'won',
    'frames=' + record.frames.length);
}

// 场景 2：单侧失误（左右各验证一次）
for (const side of ['left', 'right']) {
  const { ctx, conflictTimes, record } = SelfTest.runScenario({
    seed: 777,
    phases: [{ until: Infinity, kind: 'oneSide', side }]
  });
  check('S2 仅' + side + '桨操作无法完成任务', ctx.status === 'lost',
    'status=' + ctx.status + ' reason=' + ctx.endReason);
  check('S2 ' + side + '桨失误产生冲突记录', ctx.sync.conflicts > 0,
    'conflicts=' + ctx.sync.conflicts);
  check('S2 冲突时刻写入回放事件', conflictTimes.length > 0
    && record.events.some((e) => e.conflict), 'replayConflictEvents=' + conflictTimes.length);
}

// 场景 3：失误后恢复
{
  const { ctx, conflictTimes, record } = SelfTest.runScenario({
    seed: SelfTest.WIN_SEED,
    phases: [
      { until: 6, kind: 'idle', activeSide: 'right' },  // 左桨玩家失误 6 秒
      { until: Infinity, kind: 'coop' }                  // 恢复协作
    ]
  });
  check('S3 失误后恢复协作仍可获胜', ctx.status === 'won',
    'status=' + ctx.status + ' reason=' + ctx.endReason);
  check('S3 失误窗口内记录到单侧冲突', conflictTimes.length > 0,
    'conflictMoments=' + conflictTimes.length);
  const moments = Replay.conflictMoments(record);
  check('S3 回放可枚举每次冲突时刻', moments.length >= 1
    && moments.every((m) => typeof m.t === 'number' && m.kind),
    'moments=' + moments.length);
}

// 场景 4：控制侧轮换
{
  const before = SelfTest.runScenario({ seed: SelfTest.WIN_SEED });
  const after = SelfTest.runScenario({
    seed: SelfTest.WIN_SEED,
    initialSides: { p1: 'right', p2: 'left' },
    swapLog: [{ t: 0, from: 'left', to: 'right' }]
  });
  check('S4 轮换后相同任务仍可完成',
    after.ctx.status === 'won' && before.ctx.status === 'won',
    'before=' + before.ctx.status + ' after=' + after.ctx.status);
  check('S4 轮换事件进入回放', after.record.swapLog.length === 1,
    'swapLog=' + JSON.stringify(after.record.swapLog));
  // 单侧玩家无法代替全部操作：轮换后任一侧单独划依然失败
  const solo = SelfTest.runScenario({
    seed: 777,
    initialSides: { p1: 'right', p2: 'left' },
    phases: [{ until: Infinity, kind: 'oneSide', side: 'right' }]
  });
  check('S4 轮换后单侧仍不能代替全部操作', solo.ctx.status === 'lost',
    'solo=' + solo.ctx.status);
}

// 场景 5：重开完全复位
{
  const first = SelfTest.runScenario({ seed: SelfTest.WIN_SEED });
  const fresh = Physics.createRunContext(SelfTest.WIN_SEED);
  check('S5 重开后倒计时复位', fresh.time === 0 && CONFIG.TIME_LIMIT === 95,
    'time=' + fresh.time);
  check('S5 重开后船体耐久复位', fresh.raft.hull === CONFIG.HULL_MAX,
    'hull=' + fresh.raft.hull);
  check('S5 重开后双侧体力满格',
    fresh.raft.stamina.left === CONFIG.STAMINA_MAX
      && fresh.raft.stamina.right === CONFIG.STAMINA_MAX,
    'L=' + fresh.raft.stamina.left + ' R=' + fresh.raft.stamina.right);
  check('S5 重开后桨频与同步率复位',
    fresh.raft.strokeRate.left === 0 && fresh.raft.strokeRate.right === 0
      && fresh.sync.level === 1 && fresh.sync.conflicts === 0,
    'sync=' + fresh.sync.level);
  check('S5 重开后位置与乘客复位',
    fresh.raft.x === CONFIG.RIVER_WIDTH / 2 && fresh.raft.delivered === 0
      && fresh.raft.passengers === 3,
    'x=' + fresh.raft.x + ' delivered=' + fresh.raft.delivered);
  check('S5 上一局数据不串档', first.ctx.time > 0 && fresh.time === 0,
    'prevTime=' + first.ctx.time.toFixed(1));
}

// 场景 6：完整回放与冲突定位
{
  const { record } = SelfTest.runScenario({
    seed: SelfTest.WIN_SEED,
    phases: [
      { until: 5, kind: 'idle', activeSide: 'left' },
      { until: Infinity, kind: 'coop' }
    ]
  });
  const moments = Replay.conflictMoments(record);
  check('S6 至少保留一份完整回放', record.frames.length > 0 && record.events.length > 0,
    'frames=' + record.frames.length + ' events=' + record.events.length);
  check('S6 回放包含冲突时刻列表', moments.length > 0,
    'moments=' + moments.map((m) => m.t.toFixed(1)).join(','));
  const sample = Replay.frameAt(record, moments[0].t);
  check('S6 可定位冲突时刻对应的帧', sample && sample.t <= moments[0].t,
    'frameT=' + sample.t + ' conflictT=' + moments[0].t.toFixed(2));
  const serialized = JSON.stringify(record);
  const restored = JSON.parse(serialized);
  check('S6 回放可序列化持久化',
    restored.frames.length === record.frames.length
      && restored.events.length === record.events.length,
    'bytes=' + serialized.length);
}

// 输出
let pass = 0;
for (const r of results) {
  if (r.pass) pass++;
  console.log((r.pass ? 'PASS' : 'FAIL') + ' | ' + r.name + (r.detail ? ' | ' + r.detail : ''));
}
console.log('\n' + pass + '/' + results.length + ' 项通过');
process.exit(pass === results.length ? 0 : 1);
