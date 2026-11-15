// 可复现场景：生成完整回放 JSON 与汇总报告到 artifacts/。
// node test/scenarios.js
import { writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { Game, CUES, CONFIG, directionSide } from '../js/engine.js';
import {
  ReplayRecorder,
  ReplayPlayer,
  conflictMoments,
} from '../js/replay.js';
import { Driver, TICK } from './driver.js';

const OUT = 'artifacts/replays';
const report = [];

async function save(name, replay, extra = {}) {
  await mkdir(OUT, { recursive: true });
  await writeFile(`${OUT}/${name}.json`, JSON.stringify(replay, null, 2));
  if (Object.keys(extra).length) {
    await writeFile(
      `${OUT}/${name}-evidence.json`,
      JSON.stringify(extra, null, 2)
    );
  }
  return replay;
}

// 场景 1：完整双人协作成功（含一次真实协作、共享状态检查）。
async function scenarioCoop() {
  const g = new Game();
  const rec = new ReplayRecorder();
  rec.setMeta({ mode: 'coop', swapStart: 0 });
  g.start();
  const d = new Driver(g, rec);
  const syncSamples = [];
  while (g.phase === 'running' && g.cueIndex < CUES.length) {
    d.completeCue();
    const view = g.getRoleView();
    syncSamples.push({
      cueIndex: view.shared.cueIndex,
      aim: view.direction.aim,
      brightness: view.brightness.brightness,
      heat: view.direction.heat,
      conflict: view.shared.conflictCount,
    });
  }
  assert.equal(g.phase, 'success');
  const replay = rec.finish(g);
  await save('scenario-1-coop-success', replay, { syncSamples });
  report.push({
    scenario: '1-协作成功',
    result: g.phase,
    duration: replay.duration,
    conflicts: replay.result.conflicts,
    replay: `${OUT}/scenario-1-coop-success.json`,
  });
}

// 场景 2：单侧（亮度侧）失误 -> 恢复，验证另一侧仪表/资源/进度同步。
async function scenarioMissRecover() {
  const g = new Game();
  const rec = new ReplayRecorder();
  g.start();
  const d = new Driver(g, rec);
  d.aimTo(g.targetAngle());
  d.brightnessTo(0.6);
  d.run(0.5);
  const progressBefore = g.cueProgress;
  // 亮度侧失误。
  d.brightnessTo(0.1);
  d.run(1.2);
  const atMiss = g.getRoleView();
  assert.ok(g.events.some((e) => e.type === 'miss'));
  // 恢复并完成演出。
  d.brightnessTo(0.6);
  const atRecover = g.getRoleView();
  while (g.phase === 'running' && g.cueIndex < CUES.length) d.completeCue();
  assert.equal(g.phase, 'success');
  const replay = rec.finish(g);
  await save('scenario-2-miss-recover', replay, {
    progressBefore,
    atMiss: atMiss.shared,
    atRecover: atRecover.shared,
    missEvents: replay.events.filter((e) => e.type === 'miss'),
  });
  report.push({
    scenario: '2-单侧失误与恢复',
    result: g.phase,
    misses: replay.result.misses,
    duration: replay.duration,
    replay: `${OUT}/scenario-2-miss-recover.json`,
  });
}

// 场景 3：冲突合集 —— 过热恢复 + 双演员强光警告，记录每次冲突时刻。
async function scenarioConflicts() {
  const g = new Game();
  const rec = new ReplayRecorder();
  g.start();
  const d = new Driver(g, rec);
  // 过热冲突：持续同向转动。
  d.press(0, 'right');
  d.run(3.5);
  d.release(0, 'right');
  assert.equal(g.overheated, true);
  d.run(4); // 散热恢复
  assert.equal(g.overheated, false);
  // 完成前两段后，在双人近景制造一次强光警告，随后正常完成演出。
  d.completeCue();
  d.completeCue();
  d.aimTo(0);
  d.brightnessTo(0.95);
  d.run(0.1);
  assert.ok(g.events.some((e) => e.type === 'doubleHit'));
  d.brightnessTo(0.6);
  while (g.phase === 'running' && g.cueIndex < CUES.length) d.completeCue();
  assert.equal(g.phase, 'success');
  const replay = rec.finish(g);
  const conflicts = conflictMoments(replay);
  await save('scenario-3-conflicts', replay, { conflicts });
  report.push({
    scenario: '3-冲突时刻（过热+强光警告）',
    result: g.phase,
    conflictCount: conflicts.length,
    moments: conflicts.map((c) => ({ t: c.t, type: c.type })),
    replay: `${OUT}/scenario-3-conflicts.json`,
  });
}

// 场景 4：两种侧别各完整完成一次相同任务，并验证任何一侧都不能代劳。
async function scenarioSwap() {
  const summaries = [];
  for (const swapStart of [0, 1]) {
    const g = new Game();
    const rec = new ReplayRecorder();
    g.start();
    for (let i = 0; i < swapStart; i++) {
      g.swapSides();
      rec.recordAction(g.elapsed, 'swap');
    }
    rec.setMeta({ mode: 'coop', swapStart });
    const d = new Driver(g, rec);
    // 非方向侧按转向键不应改变灯架角度（不能代劳）。
    const wrongSide = 1 - directionSide(g.swapIndex);
    const aimBefore = g.aim;
    g.setInput(wrongSide, 'left', true);
    g.step(TICK * 10);
    g.setInput(wrongSide, 'left', false);
    const wrongSideCannotSteer = g.aim === aimBefore;
    while (g.phase === 'running' && g.cueIndex < CUES.length) d.completeCue();
    assert.equal(g.phase, 'success');
    assert.ok(wrongSideCannotSteer);
    const replay = rec.finish(g);
    const tag = swapStart === 0 ? 'a-left-direction' : 'b-right-direction';
    await save(`scenario-4-${tag}`, replay, {
      swapStart,
      directionSide: directionSide(g.swapIndex),
      wrongSideCannotSteer,
    });
    summaries.push({
      swapStart,
      directionSide: directionSide(g.swapIndex),
      wrongSideCannotSteer,
      duration: replay.duration,
      replay: `${OUT}/scenario-4-${tag}.json`,
    });
  }
  report.push({
    scenario: '4-两种侧别各完成一次相同任务',
    result: 'success',
    runs: summaries,
  });
}

async function main() {
  const { rm } = await import('node:fs/promises');
  await rm(OUT, { recursive: true, force: true });
  await scenarioCoop();
  await scenarioMissRecover();
  await scenarioConflicts();
  await scenarioSwap();
  await verifyReplaysSafe();
  await writeFile(
    'artifacts/scenario-report.json',
    JSON.stringify({ generatedAt: new Date().toISOString(), report }, null, 2)
  );
  console.log('场景执行完成：');
  for (const row of report) console.log(' -', row.scenario, '=>', row.result);
  console.log('\n回放存档目录：', OUT);
}

async function verifyReplaysSafe() {
  const { readdir, readFile } = await import('node:fs/promises');
  const files = (await readdir(OUT)).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    if (file.endsWith('-evidence.json')) continue;
    const replay = JSON.parse(await readFile(`${OUT}/${file}`, 'utf8'));
    const player = new ReplayPlayer(replay);
    const end = player.seek(replay.duration);
    assert.equal(end.phase, replay.result.phase, `${file} 重放结果不一致`);
    assert.equal(end.cueIndex, replay.result.cuesDone);
  }
  console.log(`回放确定性校验通过（${files.length} 份）`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
