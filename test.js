// 需求场景自动化验证（Node 环境，无浏览器）
var FG = require('./game.js');

var passed = 0, failed = 0;
function assert(cond, name) {
  if (cond) { passed++; console.log('  ✔ ' + name); }
  else { failed++; console.log('  ✘ ' + name); }
}

function makeAudioSpy() {
  var spy = { engineCalls: [], events: [], resets: 0 };
  spy.setEngine = function (p) { spy.engineCalls.push(p); };
  spy.event = function (type) { spy.events.push(type); };
  spy.reset = function () { spy.resets++; };
  return spy;
}

function step(game, ms, keys) {
  (keys || []).forEach(function (k) { game.setKey(k, true); });
  var n = Math.ceil(ms / 16);
  for (var i = 0; i < n; i++) game.update(16);
  (keys || []).forEach(function (k) { game.setKey(k, false); });
}

// 将车传送到“叉尖位于 (tx,ty)”的位置，朝向 heading
function teleportTipTo(game, tx, ty, heading) {
  var d = game.CONFIG.truck.w / 2 + game.CONFIG.truck.forkLen;
  game.state.truck.x = tx - Math.cos(heading) * d;
  game.state.truck.y = ty - Math.sin(heading) * d;
  game.state.truck.heading = heading;
  game.state.truck.speed = 0;
}

function hasEvent(game, type) { return game.state.events.some(function (e) { return e.type === type; }); }

// ============ 场景 1：双人协作完成一次装卸 ============
console.log('场景1 协作装卸');
(function () {
  var audio = makeAudioSpy();
  var g = FG.createGame({ audio: audio });
  var d0 = g.getDashboards();
  assert(d0.shared.stock === 3 && d0.shared.delivered === 0, '初始共享资源: 库存3 已交付0');

  // 驾驶员开车到取货站（模拟：传送到位 + 短按 W 表示行驶输入有效）
  teleportTipTo(g, 125, 555, Math.PI);
  step(g, 100, ['KeyW']);
  assert(hasEvent(g, 'pickup'), '驾驶员到位后自动取货');
  var d1 = g.getDashboards();
  assert(d1.operator.load === 1 && d1.shared.stock === 2, '操作员仪表负载=1 且共享库存同步为2');

  // 操作员升叉（方向键），驾驶员键不能升叉
  var hBefore = g.state.fork.h;
  step(g, 300, ['KeyW']); // 驾驶员键
  assert(Math.abs(g.state.fork.h - hBefore) < 1e-9, '驾驶员按 WASD 不影响货叉');
  step(g, 500, ['ArrowUp']);
  assert(g.state.fork.h > 0.2, '操作员方向键升起货叉');
  var loaded = audio.engineCalls[audio.engineCalls.length - 1];
  assert(loaded.load > 0, '音效引擎参数随负载变化(load>0)');

  // 开到交付区，操作员降叉卸货
  teleportTipTo(g, 855, 545, 0);
  step(g, 800, ['ArrowDown']);
  step(g, 100);
  var d2 = g.getDashboards();
  assert(d2.shared.delivered === 1, '完成一次交付，任务进度同步=1');
  assert(d2.operator.load === 0 && d2.operator.boxIntegrity === null, '卸货后操作员仪表负载清零');
  var idle = audio.engineCalls[audio.engineCalls.length - 1];
  assert(idle.load === 0, '卸货后引擎负载音效回落');
})();

// ============ 场景 2：单侧失误（操作员高位升叉 + 驾驶员急转）============
console.log('场景2 单侧失误与状态同步');
(function () {
  var audio = makeAudioSpy();
  var g = FG.createGame({ audio: audio });
  teleportTipTo(g, 125, 555, Math.PI);
  step(g, 100);
  assert(g.state.carrying, '已取货');
  // 操作员把货叉升到高位（单侧失误），重心因子升至 1.0
  step(g, 2000, ['ArrowUp']);
  assert(g.state.fork.h > 0.9, '货叉高位');
  // 车开到空旷区
  teleportTipTo(g, 480, 480, 0);
  // 驾驶员高速急转 -> 重心偏移，后轮离地
  g.state.truck.speed = 100;
  step(g, 400, ['KeyW', 'KeyA']);
  var d = g.getDashboards();
  assert(d.driver.rearWheelsOff === true, '驾驶员仪表显示后轮离地');
  assert(d.shared.cg > 0.85, '共享重心因子超限');
  assert(g.state.carrying, '宽限期内货箱尚未掉落');
  assert(hasEvent(g, 'wheel_lift'), '记录 wheel_lift 冲突事件');
  // 持续离地 -> 掉箱
  step(g, 3500, ['KeyW', 'KeyA']);
  var d2 = g.getDashboards();
  assert(hasEvent(g, 'box_dropped'), '掉箱事件发生');
  assert(d2.shared.groundBoxes === 1 && d2.operator.load === 0, '共享资源同步: 地面散箱+1 负载清零');
  assert(d2.shared.delivered === 0, '任务进度未推进');
  var droppedIntegrity = g.state.boxes[0] && g.state.boxes[0].integrity;
  assert(droppedIntegrity === 50, '掉箱损失: 完好度 100->50');
  assert(audio.events.indexOf('box_dropped') >= 0, '掉箱触发音效');

  // ============ 场景 3：恢复（重新取回散箱并完成交付）============
  console.log('场景3 失误后恢复');
  var droppedBox = g.state.boxes[0];
  teleportTipTo(g, 700, 480, 0); // 先驶离散箱，避免降叉时误拾
  step(g, 2500, ['ArrowDown']); // 降叉
  assert(g.state.boxes.length === 1 && !g.state.carrying, '降叉过程未误拾散箱');
  teleportTipTo(g, droppedBox.x, droppedBox.y, 0);
  step(g, 100);
  assert(hasEvent(g, 'repickup'), '重新取回散箱');
  var d3 = g.getDashboards();
  assert(d3.operator.boxIntegrity === 50, '操作员仪表同步显示受损箱完好度50');
  teleportTipTo(g, 855, 545, 0);
  step(g, 100);
  var d4 = g.getDashboards();
  assert(d4.shared.delivered === 1 && d4.shared.groundBoxes === 0, '恢复后交付成功, 双侧与共享数据同步');
})();

// ============ 场景 4：职责分离 + 轮换控制侧后完成相同任务 ============
console.log('场景4 职责分离与轮换');
(function () {
  var g = FG.createGame({});
  // 任何一侧都不能代替全部操作
  step(g, 800, ['KeyW']);
  assert(g.state.truck.speed !== 0 && g.state.fork.h === 0, '驾驶员侧只能行驶, 不能升叉');
  g.state.truck.speed = 0;
  step(g, 800, ['ArrowUp']);
  assert(g.state.fork.h > 0 && g.state.truck.speed === 0, '操作员侧只能升叉, 不能行驶');
  // 轮换控制侧
  g.swapRoles();
  assert(g.state.swapped === true, '控制侧已轮换');
  g.state.fork.h = 0;
  step(g, 800, ['ArrowUp']);
  assert(g.state.truck.speed !== 0 && g.state.fork.h === 0, '轮换后方向键变为行驶');
  g.state.truck.speed = 0;
  step(g, 800, ['KeyW']);
  assert(g.state.fork.h > 0 && g.state.truck.speed === 0, '轮换后 WASD 变为货叉操作');
  // 轮换后完成一次相同任务（方向键开车 + WASD 操叉）
  g.state.fork.h = 0;
  teleportTipTo(g, 125, 555, Math.PI);
  step(g, 100, ['ArrowDown']); // 方向键=行驶(后退微调), 叉尖到位取货
  step(g, 100);
  assert(hasEvent(g, 'pickup'), '轮换后正常取货');
  step(g, 500, ['KeyW']); // WASD 升叉
  assert(g.state.fork.h > 0.2, '轮换后 WASD 升叉有效');
  teleportTipTo(g, 855, 545, 0);
  step(g, 800, ['KeyS']); // WASD 降叉
  step(g, 100);
  assert(g.getDashboards().shared.delivered === 1, '轮换后完成相同交付任务');
  // 单人调试模式：一套键完成全部操作
  var g2 = FG.createGame({});
  g2.toggleDebug();
  step(g2, 500, ['KeyW']);
  var moved = g2.state.truck.speed !== 0;
  var raised = g2.state.fork.h > 0;
  assert(moved && raised, '单人调试下 WASD 同时驱动行驶与货叉');
  g2.toggleDebug();
  g2.clearKeys(); g2.state.truck.speed = 0; g2.state.fork.h = 0;
  step(g2, 500, ['KeyW']);
  assert(g2.state.truck.speed !== 0 && g2.state.fork.h === 0, '关闭调试后恢复职责分离');
})();

// ============ 场景 5：暂停与重开复位（含回放保留）============
console.log('场景5 暂停/重开/回放');
(function () {
  var audio = makeAudioSpy();
  var g = FG.createGame({ audio: audio });
  // 制造一些进度与冲突
  teleportTipTo(g, 125, 555, Math.PI);
  step(g, 100);
  step(g, 2000, ['ArrowUp']);
  teleportTipTo(g, 480, 480, 0);
  g.state.truck.speed = 100;
  step(g, 400, ['KeyW', 'KeyA']);
  assert(hasEvent(g, 'wheel_lift'), '重开前已产生冲突事件');
  // 暂停：时间与状态冻结
  g.togglePause();
  var t1 = g.state.time, tl1 = g.state.timeLeft;
  step(g, 500, ['KeyW']);
  assert(g.state.time === t1 && g.state.timeLeft === tl1, '暂停时倒计时与物理冻结');
  g.togglePause();
  step(g, 100);
  assert(g.state.time > t1, '恢复后继续推进');
  // 重开：仪表/资源/倒计时/音效全部复位
  var framesBefore = g.state.replay.length;
  g.restart();
  var d = g.getDashboards();
  assert(d.shared.delivered === 0 && d.shared.stock === 3 && d.shared.lost === 0, '重开后共享资源复位');
  assert(d.shared.timeLeft === FG.CONFIG.task.timeLimitMs, '重开后倒计时复位');
  assert(d.driver.speed === 0 && d.operator.forkHeight === 0 && d.operator.load === 0, '重开后双侧仪表复位');
  assert(audio.resets === 1, '重开后音效复位');
  assert(g.state.events.length === 1 && g.state.events[0].type === 'restart', '重开后事件流重新记录');
  // 回放保留：上一份完整回放可查，含冲突时刻
  var replay = g.getLastReplay();
  assert(replay && replay.frames.length === framesBefore, '重开后保留上一份完整回放');
  var conflictEvents = replay.events.filter(function (e) {
    return ['collision', 'box_dropped', 'box_destroyed', 'wheel_lift'].indexOf(e.type) >= 0;
  });
  assert(conflictEvents.length > 0 && typeof conflictEvents[0].t === 'number', '回放中可定位每次冲突发生时刻');
})();

// ============ 场景 6：成功与失败反馈 ============
console.log('场景6 成功/失败反馈');
(function () {
  var audio = makeAudioSpy();
  var g = FG.createGame({ audio: audio });
  for (var i = 0; i < 3; i++) {
    teleportTipTo(g, 125, 555, Math.PI);
    step(g, 100);
    teleportTipTo(g, 855, 545, 0);
    step(g, 100);
  }
  assert(g.state.phase === 'won' && hasEvent(g, 'win'), '三次装卸后判定成功');
  assert(audio.events.indexOf('win') >= 0 && audio.events.indexOf('delivered') >= 0, '成功有音效反馈');
  var g2 = FG.createGame({});
  g2.state.timeLeft = 200;
  step(g2, 400);
  assert(g2.state.phase === 'lost' && hasEvent(g2, 'timeout'), '超时判定失败');
  var g3 = FG.createGame({});
  g3.state.stock = 0;
  teleportTipTo(g3, 125, 555, Math.PI);
  step(g3, 100);
  g3.state.carrying = { id: 99, integrity: 1 };
  g3.state.fork.h = 1; g3.state.fork.tilt = 1;
  g3.state.truck.speed = 100;
  step(g3, 2000, ['KeyW', 'KeyA']);
  assert(hasEvent(g3, 'box_destroyed') && g3.state.phase === 'lost', '货物全部损毁判定失败');
})();

// ============ 场景 7：转弯时货叉扫到货架 ============
console.log('场景7 货叉扫掠货架');
(function () {
  var audio = makeAudioSpy();
  var g = FG.createGame({ audio: audio });
  g.state.truck.x = 300; g.state.truck.y = 190;
  g.state.truck.heading = -Math.PI / 2; g.state.truck.speed = 80;
  step(g, 1500, ['KeyA']);
  var sweeps = g.state.events.filter(function (e) { return e.type === 'collision' && e.forkSweep; });
  assert(sweeps.length > 0, '转弯时叉尖扫到货架产生碰撞事件');
  assert(audio.events.indexOf('collision') >= 0, '碰撞触发音效');
  // 载货且在货架高度带内碰撞 -> 箱被碰落
  var g2 = FG.createGame({});
  g2.state.carrying = { id: 1, integrity: 100 };
  g2.state.fork.h = 0.5;
  g2.state.truck.x = 300; g2.state.truck.y = 190;
  g2.state.truck.heading = -Math.PI / 2; g2.state.truck.speed = 80;
  step(g2, 1500, ['KeyA']);
  assert(hasEvent(g2, 'box_dropped'), '载货扫架导致货箱被碰落');
})();

console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败');
process.exit(failed ? 1 : 0);
