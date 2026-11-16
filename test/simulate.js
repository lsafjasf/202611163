/* Node 仿真测试:驱动核心逻辑完成各类场景,验证同步、复位与回放 */
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('../js/logic.js');
const C = L.C;

const DT = 1 / 60;
let failures = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ✓ ' + msg); }
  else { failures++; console.error('  ✗ ' + msg); }
}

function run(state, controller, maxT) {
  let frame = 0;
  while (state.time < maxT && state.phase !== 'SUCCESS' && state.phase !== 'FAILED') {
    const inputs = controller(state, frame);
    L.update(state, inputs, DT);
    frame++;
  }
  return state;
}

/* 标准协作机器人:点按式收绳保持安全速度 */
function coopInputs(state, frame, opts) {
  opts = opts || {};
  const pulse = (frame % 4 < 2) ? 1 : 0; // 50% 占空比 -> reelVel≈5 < REEL_SAFE
  const s = { left: { move: 0, reel: 0 }, right: { move: 0, reel: 0 } };
  const Ls = state.left, Rs = state.right;
  switch (state.phase) {
    case 'APPROACH':
      s.left.move = Ls.x < C.DOCK_L - 0.2 ? 1 : 0;
      s.right.move = Rs.x > C.DOCK_R + 0.2 ? -1 : 0;
      break;
    case 'ATTACH':
      if (!opts.skipRightReel) s.right.reel = Rs.attached ? 0 : -1;
      if (!opts.skipLeftReel) s.left.reel = Ls.attached ? 0 : -1;
      break;
    case 'LIFT':
      if (opts.stressTest && state.plank.lift > 0.3 && state.plank.lift < 0.7) {
        // 恢复场景:左平台偏离对接位制造位置差应力,随后回位
        s.left.move = Ls.x > C.DOCK_L - 13 ? -1 : 1;
      }
      s.left.reel = pulse; s.right.reel = pulse;
      break;
    case 'PLACE':
      s.left.reel = -pulse; s.right.reel = -pulse;
      break;
    case 'RETREAT':
      s.left.move = Ls.x > C.HOME_L + 1 ? -1 : 0;
      s.right.move = Rs.x < C.HOME_R - 1 ? 1 : 0;
      s.left.reel = Ls.hookLen > 1 ? 1 : 0;
      s.right.reel = Rs.hookLen > 1 ? 1 : 0;
      break;
  }
  if (opts.leftHoldReel && (state.phase === 'LIFT' || state.phase === 'PLACE')) {
    s.left.reel = 1; s.right.reel = 0; // 单侧失误:左侧长按猛收,右侧未准备
  }
  return s;
}

/* 面板视图:模拟 main.js 中左右面板从同一 state 读取的字段 */
function panelViews(state) {
  return {
    left: { tension: state.left.tension, stress: state.left.stress, wear: state.left.wear,
            integrity: state.integrity, progress: state.progress, countdown: state.countdown },
    right: { tension: state.right.tension, stress: state.right.stress, wear: state.right.wear,
             integrity: state.integrity, progress: state.progress, countdown: state.countdown }
  };
}
function assertSync(state, label) {
  const v = panelViews(state);
  assert(v.left.integrity === v.right.integrity, label + ': 两侧桥体完整度一致');
  assert(v.left.progress === v.right.progress, label + ': 两侧任务进度一致');
  assert(v.left.countdown === v.right.countdown, label + ': 两侧倒计时一致');
}

function saveReplay(name, state) {
  const dir = path.join(__dirname, '..', 'replays');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify(state.replay, null, 1));
}

/* ---------- 场景 1:双人协作成功 ---------- */
console.log('场景1: 双人协作完成桥板更换');
let s1 = L.createState();
run(s1, (st, f) => coopInputs(st, f), 170);
assert(s1.phase === 'SUCCESS', '协作任务成功完成,实际阶段=' + s1.phase);
assert(s1.integrity === 100, '无损伤完成,完整度=' + s1.integrity);
assert(s1.progress === 100, '任务进度 100%');
assertSync(s1, '协作场景');
assert(s1.replay.result && s1.replay.result.ok, '回放记录成功结果');
assert(s1.replay.snapshots.length > s1.time / C.SNAP_DT * 0.9, '回放采样完整(' + s1.replay.snapshots.length + ' 帧)');
saveReplay('cooperation', s1);

/* ---------- 场景 2:单侧失误(左侧猛收绳) ---------- */
console.log('场景2: 单侧收绳过快导致失败');
let s2 = L.createState();
run(s2, (st, f) => coopInputs(st, f, { leftHoldReel: true }), 170);
assert(s2.phase === 'FAILED', '任务失败,实际阶段=' + s2.phase);
assert(s2.failReason === 'integrity', '失败原因为桥体损坏,实际=' + s2.failReason);
const hits = s2.events.filter(e => e.type === 'conflict' && e.msg.indexOf('收绳过快') >= 0);
assert(hits.length >= 3, '记录到多次"收绳过快"冲突(' + hits.length + ' 次),每次均带时间戳');
assert(hits.every(e => typeof e.t === 'number'), '冲突事件均含发生时刻');
assertSync(s2, '失误场景');
saveReplay('mistake', s2);

/* ---------- 场景 3:应力超限后恢复并成功 ---------- */
console.log('场景3: 位置差应力超限后恢复');
let s3 = L.createState();
run(s3, (st, f) => coopInputs(st, f, { stressTest: true }), 170);
const warns = s3.events.filter(e => e.type === 'conflict' && e.msg.indexOf('应力超限') >= 0);
const recovers = s3.events.filter(e => e.type === 'recover');
assert(warns.length >= 1, '出现应力超限冲突(' + warns.length + ' 次)');
assert(recovers.length >= 1, '应力回落后记录恢复事件(' + recovers.length + ' 次)');
assert(s3.phase === 'SUCCESS', '恢复后任务仍成功,实际=' + s3.phase);
assert(s3.left.wear > 0, '高应力期间缆绳产生磨损(' + s3.left.wear.toFixed(1) + ')');
assertSync(s3, '恢复场景');
saveReplay('recovery', s3);

/* ---------- 场景 4:轮换控制侧后完成相同任务 ---------- */
console.log('场景4: 轮换控制侧(按键映射对调)');
let s4 = L.createState();
let frame4 = 0;
run(s4, (st, f) => {
  // 机器人产出"期望的左右侧输入",经 mapKeys 轮换映射转换为按键再解析回来
  const want = coopInputs(st, f);
  const keys = {};
  // swapped=true: WASD 控制右侧,方向键控制左侧
  if (want.right.move > 0) keys.KeyD = true;
  if (want.right.move < 0) keys.KeyA = true;
  if (want.right.reel > 0) keys.KeyW = true;
  if (want.right.reel < 0) keys.KeyS = true;
  if (want.left.move > 0) keys.ArrowRight = true;
  if (want.left.move < 0) keys.ArrowLeft = true;
  if (want.left.reel > 0) keys.ArrowUp = true;
  if (want.left.reel < 0) keys.ArrowDown = true;
  const mapped = L.mapKeys(keys, true, false);
  frame4++;
  return mapped;
}, 170);
assert(s4.phase === 'SUCCESS', '轮换后两名玩家完成相同任务,实际=' + s4.phase);
const mapCheck = L.mapKeys({ KeyD: true, ArrowUp: true }, true, false);
assert(mapCheck.right.move === 1 && mapCheck.left.reel === 1, '轮换映射:WASD→右侧,方向键→左侧');
const mapCheck2 = L.mapKeys({ KeyD: true, ArrowUp: true }, false, false);
assert(mapCheck2.left.move === 1 && mapCheck2.right.reel === 1, '默认映射:WASD→左侧,方向键→右侧');

/* ---------- 场景 5:单侧无法代替全部操作 ---------- */
console.log('场景5: 仅一侧操作无法完成任务');
let s5 = L.createState();
run(s5, (st, f) => {
  const inp = coopInputs(st, f, { skipRightReel: true }); // 右侧只就位,绝不放绳
  return inp;
}, 60);
assert(s5.phase === 'ATTACH', '60s 后仍停在挂钩阶段,实际=' + s5.phase);
assert(s5.left.attached && !s5.right.attached, '左侧已挂接、右侧未挂接(挂接必须双侧各自完成)');
assert(s5.plank.lift === 0, '单侧无法起吊桥板');
assert(s5.progress <= 30, '任务进度受限(' + Math.round(s5.progress) + '%)');

/* ---------- 场景 6:重开后全部复位 ---------- */
console.log('场景6: 重开复位');
let s6 = L.createState();
run(s6, (st, f) => coopInputs(st, f, { leftHoldReel: true }), 170);
assert(s6.phase === 'FAILED', '前提:上一局已失败');
let fresh = L.createState(); // main.js restart() 即重新 createState + 音频复位
assert(fresh.countdown === C.COUNTDOWN, '倒计时复位为 ' + C.COUNTDOWN);
assert(fresh.integrity === 100 && fresh.progress === 0, '共享资源(完整度/进度)复位');
assert(fresh.left.wear === 0 && fresh.right.wear === 0, '双方缆绳磨损复位');
assert(fresh.left.stress === 0 && fresh.right.stress === 0, '双方应力仪表复位');
assert(fresh.events.length === 0 && fresh.replay.snapshots.length === 0, '事件与回放缓冲清空');
assert(fresh.left.x === C.HOME_L && fresh.right.x === C.HOME_R, '平台回到两端初始位');

/* ---------- 回放内容校验 ---------- */
console.log('回放校验');
const rec = s3.replay;
const conflictSnaps = rec.events.filter(e => e.type === 'conflict');
assert(conflictSnaps.every(e => rec.snapshots.some(sn => Math.abs(sn.t - e.t) < 0.2)),
  '每个冲突时刻都能在回放帧中定位');
assert(rec.snapshots[0].phase === 'APPROACH' && rec.snapshots[rec.snapshots.length - 1].phase === 'SUCCESS',
  '回放覆盖从开局到成功的完整过程');

console.log(failures === 0 ? '\n全部测试通过' : '\n' + failures + ' 项断言失败');
process.exit(failures === 0 ? 0 : 1);
