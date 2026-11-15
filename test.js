/* 验收测试：用模拟按键驱动引擎，覆盖需求场景 */
'use strict';
const Engine = require('./engine.js');

let failures = 0;
function check(name, cond) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name);
  if (!cond) failures++;
}

const DT = 16;
function step(game, ms) {
  for (let t = 0; t < ms; t += DT) game.tick(DT);
}

// 模拟玩家：根据职责自动跟踪目标（只通过 setHeld 按键，不直接改状态）
function track(game, side) {
  const s = game.getState();
  const dom = game.domainOf(side);
  if (dom === 'gimbal') {
    game.setHeld(side, 'panRight', s.subject.x > s.gimbal.x + 6);
    game.setHeld(side, 'panLeft', s.subject.x < s.gimbal.x - 6);
    game.setHeld(side, 'panDown', s.subject.y > s.gimbal.y + 6);
    game.setHeld(side, 'panUp', s.subject.y < s.gimbal.y - 6);
  } else {
    game.setHeld(side, 'focusFar', s.subject.dist > s.focus + 0.1);
    game.setHeld(side, 'focusNear', s.subject.dist < s.focus - 0.1);
    game.setHeld(side, 'expoUp', s.subject.brightness > s.exposure + 0.05);
    game.setHeld(side, 'expoDown', s.subject.brightness < s.exposure - 0.05);
  }
}

// 双侧协同跟踪直到三项全就绪（或超时）
function trackUntilReady(game, maxMs) {
  for (let t = 0; t < maxMs; t += DT) {
    track(game, 'left');
    track(game, 'right');
    game.tick(DT);
    const r = game.getState().ready;
    if (r.comp && r.focus && r.expo) return true;
  }
  return false;
}

console.log('场景1：双人协作完成三张照片');
{
  const g = Engine.createGame();
  let shots = 0;
  for (let i = 0; i < 3; i++) {
    const ok = trackUntilReady(g, 20000);
    check(`第${i + 1}次三项就绪`, ok);
    g.pressShutter(i % 2 === 0 ? 'left' : 'right'); // 两侧轮流按快门
    shots++;
  }
  const s = g.getState();
  check('状态为 won', s.status === 'won');
  check('得分 3', s.score === 3);
  check('胶片 6->3', s.film === 3);
  check('事件含 3 次 shot_ok',
    s.events.filter(e => e.type === 'shot_ok').length === 3);
}

console.log('场景2：单侧失误（右侧曝光错误）+ 双方仪表/资源同步');
{
  const g = Engine.createGame();
  trackUntilReady(g, 20000);
  // 右侧（optics）故意把曝光拉偏，左侧构图保持
  g.setHeld('right', 'expoUp', true);
  step(g, 1500);
  g.setHeld('right', 'expoUp', false);
  const before = g.getState();
  check('曝光未就绪', !before.ready.expo);
  const filmBefore = before.film;
  const shot = g.pressShutter('right');
  const after = g.getState();
  check('拍摄失败', shot && !shot.ok && shot.reasons.indexOf('expo') >= 0);
  check('胶片 -1', after.film === filmBefore - 1);
  check('记录 conflict 事件（含时刻与原因）',
    after.events.some(e => e.type === 'conflict' && e.reasons.indexOf('expo') >= 0 && typeof e.t === 'number'));
  // 同步：共享状态只有一份，两侧读取一致
  const viewL = g.getState(), viewR = g.getState();
  check('两侧看到相同胶片/得分/倒计时',
    viewL.film === viewR.film && viewL.score === viewR.score && viewL.timeLeft === viewR.timeLeft);

  console.log('场景3：失误后恢复并成功拍摄');
  const ok = trackUntilReady(g, 20000);
  check('恢复后三项就绪', ok);
  const shot2 = g.pressShutter('left');
  check('恢复后拍摄成功', shot2 && shot2.ok);
  check('得分 +1', g.getState().score === 1);
}

console.log('场景4：轮换控制侧，双方各完成一次相同任务');
{
  const g = Engine.createGame();
  // 默认：left=云台 right=光学
  check('默认 left=云台', g.domainOf('left') === 'gimbal');
  check('默认 right=光学', g.domainOf('right') === 'optics');
  // 单侧不能代替全部操作：left 按对焦键无效
  const f0 = g.getState().focus;
  g.setHeld('left', 'focusFar', true);
  step(g, 500);
  g.setHeld('left', 'focusFar', false);
  check('left 无法控制对焦', g.getState().focus === f0);
  const gx0 = g.getState().gimbal.x;
  g.setHeld('right', 'panRight', true);
  step(g, 500);
  g.setHeld('right', 'panRight', false);
  check('right 无法控制云台', g.getState().gimbal.x === gx0);

  // 轮换
  g.swapSides();
  check('轮换后 left=光学', g.domainOf('left') === 'optics');
  check('轮换后 right=云台', g.domainOf('right') === 'gimbal');
  // 换侧后单侧仍不能代替全部
  const f1 = g.getState().focus;
  g.setHeld('right', 'focusFar', true);
  step(g, 500);
  g.setHeld('right', 'focusFar', false);
  check('轮换后 right 无法控制对焦', g.getState().focus === f1);

  // 轮换后双侧各完成一次拍摄任务
  const okA = trackUntilReady(g, 20000);
  check('轮换后三项就绪', okA);
  const shotA = g.pressShutter('left');
  check('轮换后协作拍摄成功', shotA && shotA.ok);
}

console.log('场景5：暂停 / 重开复位 / 回放保留');
{
  const g = Engine.createGame();
  trackUntilReady(g, 20000);
  g.pressShutter('left');
  // 制造一次冲突用于回放检索
  g.setHeld('right', 'expoDown', true);
  step(g, 1200);
  g.setHeld('right', 'expoDown', false);
  g.pressShutter('right');
  check('已产生 conflict 事件', g.getState().events.some(e => e.type === 'conflict'));

  // 暂停：时间冻结
  g.pause();
  const tPause = g.getState().time;
  step(g, 1000);
  check('暂停时时间不前进', g.getState().time === tPause);
  g.resume();
  step(g, 100);
  check('恢复后时间前进', g.getState().time > tPause);

  // 重开：全部复位
  g.restart();
  const s = g.getState();
  check('重开后状态 running', s.status === 'running');
  check('重开后胶片复位', s.film === 6);
  check('重开后得分复位', s.score === 0);
  check('重开后倒计时复位', s.timeLeft === 120000);
  check('重开后仪表复位', s.focus === 10 && s.exposure === 0);
  // 回放保留：归档中含完整一局的冲突时刻
  const arch = g.getArchivedReplays();
  check('保留至少一份完整回放', arch.length >= 1 && arch[0].replay.length > 0);
  check('回放中可查到冲突时刻',
    arch[0].events.some(e => e.type === 'conflict' && typeof e.t === 'number'));
}

console.log('场景6：单人调试模式可控制全部职责');
{
  const g = Engine.createGame();
  g.toggleDebug();
  check('调试模式开启', g.isDebugSolo());
  const f0 = g.getState().focus, x0 = g.getState().gimbal.x;
  g.setHeld('left', 'focusFar', true);
  g.setHeld('left', 'panRight', true);
  step(g, 500);
  g.setHeld('left', 'focusFar', false);
  g.setHeld('left', 'panRight', false);
  check('调试模式单侧可控制对焦', g.getState().focus > f0);
  check('调试模式单侧可控制云台', g.getState().gimbal.x > x0);
}

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
