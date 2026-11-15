// 纯 Node 自动化验证：node test/engine.test.js
import assert from 'node:assert/strict';
import { Game, CONFIG, CUES, directionSide } from '../js/engine.js';
import {
  ReplayRecorder,
  ReplayPlayer,
  conflictMoments,
  makeStore,
  memoryStorage,
} from '../js/replay.js';
import { Driver, TICK } from './driver.js';
let passed = 0;

function test(name, fn) {
  return Promise.resolve().then(fn).then(
    () => {
      passed += 1;
      console.log(`  ✓ ${name}`);
    },
    (err) => {
      console.error(`  ✗ ${name}`);
      console.error(err);
      process.exitCode = 1;
    }
  );
}


async function main() {
  console.log('引擎与回放自动化测试');

  await test('初始状态：倒计时/段数/热量/警告均为默认值', () => {
    const g = new Game();
    const s = g.getState();
    assert.equal(s.phase, 'idle');
    assert.equal(s.timeLeft, CONFIG.duration);
    assert.equal(s.cueIndex, 0);
    assert.equal(s.heat, 0);
    assert.equal(s.warnings, 0);
    assert.equal(directionSide(0), 0);
    assert.equal(directionSide(1), 1);
  });

  await test('完整协作：两侧配合完成 5 段，演出成功', () => {
    const g = new Game();
    g.start();
    const d = new Driver(g);
    while (g.phase === 'running' && g.cueIndex < CUES.length) d.completeCue();
    assert.equal(g.phase, 'success');
    assert.equal(g.cueIndex, 5);
    assert.ok(g.elapsed < CONFIG.duration);
    assert.ok(g.events.some((e) => e.type === 'success'));
  });

  await test('单侧失误后恢复：亮度侧撤出触发 miss，恢复后段进度继续增长并成功', () => {
    const g = new Game();
    g.start();
    const d = new Driver(g);
    d.aimTo(g.targetAngle());
    d.brightnessTo(0.6);
    // 先覆盖半秒，建立保持进度。
    d.run(0.5);
    const progressBefore = g.cueProgress;
    assert.ok(progressBefore > 0.3);
    // 亮度侧失误：把亮度压到覆盖阈值以下并持续超过宽限期。
    d.brightnessTo(0.1);
    d.run(1.2);
    const missEvents = g.events.filter((e) => e.type === 'miss');
    assert.ok(missEvents.length >= 1, '应记录至少一次单侧失误');
    assert.ok(g.cueProgress < progressBefore, '失误时段进度应衰减');
    // 恢复：亮度侧重新推高，两侧仪表读数来自同一共享状态。
    d.brightnessTo(0.6);
    const view = g.getRoleView();
    assert.equal(view.brightness.brightness, g.brightness);
    assert.equal(view.direction.aim, g.aim);
    assert.equal(view.shared.cueIndex, g.cueIndex);
    while (g.phase === 'running' && g.cueIndex < CUES.length) d.completeCue();
    assert.equal(g.phase, 'success');
    assert.ok(g.totalHits >= 2, '恢复后应再次命中目标');
  });

  await test('任何一侧都不能代替全部操作：只有方向侧或只有亮度侧均无法完成段落', () => {
    // 只有方向侧：亮度永远停在初始 0.15，低于覆盖阈值。
    const g1 = new Game();
    g1.start();
    const d1 = new Driver(g1);
    d1.aimTo(g1.targetAngle());
    d1.run(4);
    assert.equal(g1.cueIndex, 0);
    assert.equal(g1.cueProgress, 0);
    assert.equal(g1.phase, 'running');

    // 只有亮度侧：方向角停在 0，无法覆盖偏离中心的第一段目标。
    const g2 = new Game();
    g2.start();
    const d2 = new Driver(g2);
    d2.brightnessTo(0.9);
    d2.run(4);
    assert.equal(g2.cueIndex, 0);
    assert.equal(g2.cueProgress, 0);
  });

  await test('轮换控制侧：交换后原方向按键不再驱动方向，另一侧接管并可成功', () => {
    const g = new Game();
    g.start();
    g.swapSides();
    assert.equal(directionSide(g.swapIndex), 1);
    // 此时左侧是亮度职责：按左键不应改变方向角。
    const aimBefore = g.aim;
    g.setInput(0, 'left', true);
    g.step(TICK * 10);
    assert.equal(g.aim, aimBefore, '轮换后左侧左键不能再控制方向');
    g.setInput(0, 'left', false);
    // 右侧现在是方向职责，可以转动。
    g.setInput(1, 'right', true);
    g.step(TICK * 10);
    assert.ok(g.aim > aimBefore, '右侧接管方向职责');
    g.setInput(1, 'right', false);
    const d = new Driver(g);
    while (g.phase === 'running' && g.cueIndex < CUES.length) d.completeCue();
    assert.equal(g.phase, 'success');
  });

  await test('过热：连续转动触发热锁定，停转散热到阈值后恢复', () => {
    const g = new Game();
    g.start();
    const d = new Driver(g);
    d.press(0, 'right');
    d.run(3.5);
    assert.equal(g.overheated, true);
    assert.ok(g.events.some((e) => e.type === 'overheat'));
    d.release(0, 'right');
    // 过热期间按方向键无效。
    const aimLocked = g.aim;
    d.press(0, 'left');
    d.run(0.5);
    assert.equal(g.aim, aimLocked, '过热锁定期间方向不响应');
    d.release(0, 'left');
    d.run(4);
    assert.equal(g.overheated, false);
    assert.ok(g.events.some((e) => e.type === 'recover'));
  });

  await test('双演员完全命中：第三段强光罩住两人触发警告，累计 3 次失败', () => {
    const g = new Game();
    g.start();
    const d = new Driver(g);
    // 快速完成前两段（亮度 0.6 不会触发完全命中）。
    d.completeCue();
    d.completeCue();
    assert.equal(g.cueIndex, 2);
    // 第三段两人位于 -8/+8：亮度推过 0.8，居中即可同时完全命中。
    d.aimTo(0);
    d.brightnessTo(0.95);
    let warns = 0;
    let guard = 0;
    while (g.phase === 'running' && warns < 3 && guard++ < 4000) {
      d.run(0.2);
      warns = g.warnings;
    }
    assert.ok(g.warnings >= 3);
    assert.equal(g.phase, 'failed');
    const fail = g.events.find((e) => e.type === 'fail');
    assert.equal(fail.reason, 'warnings');
    assert.equal(conflictMoments({ events: g.events }).length, g.conflictCount);
  });

  await test('重开复位：仪表、共享资源、倒计时、警告与输入同时归零', () => {
    const g = new Game();
    g.start();
    const d = new Driver(g);
    d.press(0, 'right');
    d.run(2);
    d.release(0, 'right');
    d.brightnessTo(0.7);
    g.swapSides();
    assert.ok(g.heat > 0 || g.aim !== 0 || g.brightness !== 0.15);
    g.restart();
    const s = g.getState();
    assert.equal(s.phase, 'running');
    assert.equal(s.timeLeft, CONFIG.duration);
    assert.equal(s.heat, 0);
    assert.equal(s.aim, 0);
    assert.equal(s.brightness, 0.15);
    assert.equal(s.warnings, 0);
    assert.equal(s.cueIndex, 0);
    assert.equal(s.swapIndex, 0);
    assert.deepEqual(s.inputs, [
      { left: false, right: false, up: false, down: false },
      { left: false, right: false, up: false, down: false },
    ]);
  });

  await test('回放：录制 -> 确定性重放结果一致，冲突时刻可定位', async () => {
    const g = new Game();
    const recorder = new ReplayRecorder();
    g.start();
    const d = new Driver(g, recorder);
    d.completeCue();
    d.completeCue();
    // 制造一次过热冲突。
    d.press(0, 'right');
    d.run(3.5);
    d.release(0, 'right');
    d.run(4);
    while (g.phase === 'running' && g.cueIndex < CUES.length) d.completeCue();
    assert.equal(g.phase, 'success');
    const replay = recorder.finish(g);
    assert.ok(replay.inputLog.length > 10);
    const conflicts = conflictMoments(replay);
    assert.ok(conflicts.some((c) => c.type === 'overheat'));

    // 完整重放。
    const player = new ReplayPlayer(replay);
    const endState = player.seek(replay.duration);
    assert.equal(endState.phase, 'success');
    assert.equal(endState.cueIndex, 5);

    // 跳到冲突时刻前，状态与时刻正确。
    const t = conflicts[0].t;
    const p2 = new ReplayPlayer(replay);
    const at = p2.seek(Math.max(0, t - 0.1));
    assert.ok(at.elapsed <= t + 0.05);

    // 存储层：保存与列表。
    const store = makeStore(memoryStorage());
    store.save(replay);
    assert.equal(store.list().length, 1);
    assert.equal(store.list()[0].result.phase, 'success');

    // 写入文件供人工查看冲突时刻。
    const { writeFile, mkdir } = await import('node:fs/promises');
    await mkdir('artifacts/replays', { recursive: true });
    await writeFile(
      'artifacts/replays/smoke-replay.json',
      JSON.stringify(replay, null, 2)
    );
  });

  await test('两侧仪表同步：任一侧操作后两个角色视图与共享状态一致', () => {
    const g = new Game();
    g.start();
    const d = new Driver(g);
    d.aimTo(-30);
    d.brightnessTo(0.55);
    const view = g.getRoleView();
    const s = g.getState();
    assert.equal(view.direction.aim, s.aim);
    assert.equal(view.direction.heat, s.heat);
    assert.equal(view.brightness.brightness, s.brightness);
    assert.equal(view.brightness.warnings, s.warnings);
    assert.equal(view.shared.timeLeft, s.timeLeft);
    assert.equal(view.shared.cueProgress, s.cueProgress);
    assert.equal(view.shared.conflictCount, s.conflictCount);
  });

  await test('回放含中途轮换：动作流重建角色映射，重放结果一致', () => {
    const g = new Game();
    const rec = new ReplayRecorder();
    g.start();
    const d = new Driver(g, rec);
    d.completeCue();
    d.completeCue();
    g.swapSides();
    rec.recordAction(g.elapsed, 'swap');
    while (g.phase === 'running' && g.cueIndex < CUES.length) d.completeCue();
    assert.equal(g.phase, 'success');
    const replay = rec.finish(g);
    assert.equal(replay.actions.length, 1);
    const player = new ReplayPlayer(replay);
    const end = player.seek(replay.duration);
    assert.equal(end.phase, 'success');
    assert.equal(end.swapIndex, 1);
    assert.equal(end.cueIndex, 5);
  });

  await test('倒计时耗尽：不操作时超时失败', () => {
    const g = new Game();
    g.start();
    const d = new Driver(g);
    d.run(CONFIG.duration + 0.2);
    assert.equal(g.phase, 'failed');
    assert.equal(g.events.at(-1).reason, 'timeout');
  });

  console.log(`\n通过 ${passed} 项测试`);
}

main();
