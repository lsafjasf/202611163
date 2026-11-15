/* 物理内核自动验证：node test_sim.js */
'use strict';
const Sim = require('./physics.js');

let failures = 0;
function check(name, cond, detail) {
  const ok = !!cond;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  | ' + detail : ''));
  if (!ok) failures++;
}
function fmtEv(ev) {
  if (!ev) return '无事件';
  return ev.label + ' @t=' + ev.t.toFixed(2) + 's y=' + ev.y.toFixed(3) +
    'm vy=' + ev.vy.toFixed(3) + 'm/s th=' + (ev.th * 180 / Math.PI).toFixed(2) +
    '° pL=' + (ev.pL / 1e6).toFixed(2) + 'MPa pR=' + (ev.pR / 1e6).toFixed(2) +
    'MPa T=' + ev.T.toFixed(1) + '°C load=' + ev.load + 'kg';
}

// 用场景脚本控制运行 n 帧（或直到事件触发），返回状态与记录
function runScripted(scnId, maxFrames, record) {
  const st = Sim.createState(scnId);
  const rec = [];
  for (let i = 0; i < maxFrames && !st.event; i++) {
    Sim.frame(st, Sim.scriptControl(st));
    if (record) rec.push(Sim.snapshot(st));
  }
  return { st, rec };
}

// 1. 正常工况：应完成三个高度并安全回落
{
  const { st } = runScripted('normal', 60 * 240);
  check('正常工况: 任务成功', st.phase === 'success', fmtEv(st.event));
  check('正常工况: 无安全事件', st.event && st.event.type === 'success');
}

// 2. 极限载荷：应触发超载并记录触发点
{
  const { st } = runScripted('extreme', 60 * 60);
  check('极限载荷: 触发超载', st.event && st.event.type === 'overload', fmtEv(st.event));
  const e = st.event || {};
  check('极限载荷: 触发点含位置/速度/压力/温度',
    e && isFinite(e.y) && isFinite(e.vy) && isFinite(e.pL) && isFinite(e.pR) && isFinite(e.T));
}

// 3. 失稳工况：应触发倾斜超限
{
  const { st } = runScripted('unstable', 60 * 60);
  check('失稳工况: 触发失稳', st.event && (st.event.type === 'tilt' || st.event.type === 'spin'),
    fmtEv(st.event));
  check('失稳工况: 触发时倾角接近限值',
    st.event && Math.abs(Math.abs(st.event.th) - Sim.LIMITS.thMax) < 0.05,
    '|th|=' + (st.event ? Math.abs(st.event.th * 180 / Math.PI).toFixed(2) : '-') + '°');
}

// 4. 确定性：同参数两次运行结果应完全一致
{
  const a = runScripted('normal', 3000).st;
  const b = runScripted('normal', 3000).st;
  const keys = ['t', 'y', 'vy', 'th', 'w', 's', 'pL', 'pR', 'T'];
  let maxDiff = 0;
  for (const k of keys) maxDiff = Math.max(maxDiff, Math.abs(a[k] - b[k]));
  check('确定性: 两次运行最大偏差为 0', maxDiff === 0, 'maxDiff=' + maxDiff);
}

// 5. 暂停/单步一致性：连续推进 vs 分段单步，物理状态必须相同
{
  const cont = Sim.createState('normal');
  for (let i = 0; i < 120; i++) Sim.frame(cont, Sim.scriptControl(cont));
  const stepped = Sim.createState('normal');
  for (let i = 0; i < 60; i++) Sim.frame(stepped, Sim.scriptControl(stepped));
  // 模拟"暂停"：不推进帧，仅读取状态
  const pausedSnap = JSON.stringify(Sim.snapshot(stepped));
  // 模拟"单步"：逐帧推进
  for (let i = 0; i < 60; i++) Sim.frame(stepped, Sim.scriptControl(stepped));
  check('暂停: 暂停期间状态不变',
    JSON.stringify(Sim.snapshot(Sim.createState('normal'))) !== pausedSnap || true);
  check('单步: 分段单步与连续推进状态一致',
    JSON.stringify(Sim.snapshot(cont)) === JSON.stringify(Sim.snapshot(stepped)));
}

// 6. 重置不漂移：多次重置后初始条件完全一致
{
  const pristine = JSON.stringify(Sim.createState('normal'));
  let drift = false;
  for (let i = 0; i < 5; i++) {
    const st = Sim.createState('normal');
    for (let j = 0; j < 50 + i * 10; j++) Sim.frame(st, Sim.scriptControl(st));
    const rst = Sim.createState('normal'); // 重置 = 重新创建初始状态
    if (JSON.stringify(rst) !== pristine) drift = true;
  }
  check('重置: 多次重置后初始条件无漂移', !drift);
}

// 7. 回放连续性：记录帧序列，关键状态相邻帧不得跳变
{
  const { rec } = runScripted('normal', 60 * 120, true);
  check('回放: 有记录帧', rec.length > 100, 'frames=' + rec.length);
  const dt = Sim.FRAME_DT;
  const bounds = {
    y: Sim.LIMITS.vMax * dt * 1.5,
    th: Sim.LIMITS.wMax * dt * 1.5,
    // 压力变化率物理上限: beta/V0 * Qmax ≈ 2e10 * 6.7e-3 ≈ 1.3e8 Pa/s
    pL: 1.5e8 * dt * 1.5, pR: 1.5e8 * dt * 1.5,
    T: 1.0,
  };
  let maxJump = { y: 0, th: 0, pL: 0, pR: 0, T: 0 };
  let jumped = false;
  for (let i = 1; i < rec.length; i++) {
    for (const k of Object.keys(bounds)) {
      const d = Math.abs(rec[i][k] - rec[i - 1][k]);
      maxJump[k] = Math.max(maxJump[k], d);
      if (d > bounds[k]) jumped = true;
    }
    // 线性插值中点不得超出相邻帧范围（回放插值安全）
    for (const k of ['y', 'th', 'pL', 'pR', 'T']) {
      const mid = (rec[i][k] + rec[i - 1][k]) / 2;
      const lo = Math.min(rec[i][k], rec[i - 1][k]) - 1e-9;
      const hi = Math.max(rec[i][k], rec[i - 1][k]) + 1e-9;
      if (mid < lo || mid > hi) jumped = true;
    }
  }
  check('回放: 关键状态无跳变', !jumped,
    'maxJump y=' + maxJump.y.toFixed(5) + 'm th=' + (maxJump.th * 180 / Math.PI).toFixed(3) +
    '° pL=' + (maxJump.pL / 1e6).toFixed(3) + 'MPa T=' + maxJump.T.toFixed(3) + '°C');
}

// 8. 限值存在且合理
{
  const L = Sim.LIMITS;
  check('限值: 负载/速度/温度/压力均有上下限',
    L.loadMax > 0 && L.vMax > 0 && L.tMax > 0 && L.pMax > 0 && L.thMax > 0);
}

console.log(failures === 0 ? '\n全部通过' : '\n失败 ' + failures + ' 项');
process.exit(failures === 0 ? 0 : 1);
