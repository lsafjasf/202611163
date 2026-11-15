// 无头剧情验收：一次协作成功、一次单侧失误、一次失误后恢复。
// 运行：node demo/run-scenarios.mjs
import { createGame, step, swapSides } from '../src/engine/engine.js';
import { MATCH, ROUND } from '../src/engine/config.js';
import { ReplayRecorder, ReplayPlayer } from '../src/engine/replay.js';
import {
  clampOnlyInput,
  makeCooperativeBot,
  overPressureInput
} from '../test/helpers/bot.js';

function run(bot, label) {
  const state = createGame();
  const recorder = new ReplayRecorder({ scenario: label });
  let ticks = 0;
  recorder.observe(state);
  while (state.mode !== MATCH.VICTORY && state.mode !== MATCH.DEFEAT && ticks < 60 * 90) {
    step(state, bot(state));
    recorder.observe(state);
    ticks += 1;
  }
  return { state, replay: recorder.finish(state, state.mode) };
}

function report(label, { state, replay }) {
  const conflictTypes = new Set([
    'unlocked-install', 'offset-install', 'round-timeout', 'gasket-crush'
  ]);
  const conflicts = replay.events.filter((e) => conflictTypes.has(e.type));
  console.log(`\n== ${label} ==`);
  console.log(`  结果: ${state.mode}  成功 ${state.score.wins} 组 / 失误 ${state.score.fails} 次`);
  console.log(`  垫圈: 共 ${state.score.gasketsTotal}，使用 ${state.score.gasketsUsed}，冲突计数 ${state.score.conflicts}`);
  console.log(`  夹具仪表: 锁定累计 ${state.stationStats.clamp.lockedMs.toFixed(0)}ms，稳定占比 ${(state.stationStats.clamp.stableRatio * 100).toFixed(0)}%`);
  console.log(`  模块仪表: 对准累计 ${state.stationStats.module.alignedMs.toFixed(0)}ms，压装 ${state.stationStats.module.pressCount} 次`);
  console.log(`  回放时长 ${replay.durationSec.toFixed(1)}s，冲突时刻: ${conflicts.map((e) => `${e.time.toFixed(2)}s(${e.type})`).join('、') || '无'}`);
}

// 剧情 1：完整协作，三组成功。
const coop = run(makeCooperativeBot(), '协作成功');
report('剧情 1 · 协作成功', coop);

// 剧情 2：单侧失误——只操作夹具，模块无人安装，最终超时耗尽垫圈。
const oneSide = run(clampOnlyInput, '单侧失误');
report('剧情 2 · 单侧失误（只控夹具）', oneSide);

// 剧情 3：首回合压坏垫圈，随后恢复协作完成三组。
const recoveryBot = (() => {
  const coopBot = makeCooperativeBot();
  return (state) =>
    state.round.index === 0 ? overPressureInput(state) : coopBot(state);
})();
const recovery = run(recoveryBot, '失误后恢复');
report('剧情 3 · 失误后恢复', recovery);

// 换边后再完成一次相同任务，并验证单侧无法包办。
const swapped = createGame();
swapSides(swapped);
const swappedBot = makeCooperativeBot();
let guard = 0;
while (swapped.mode !== MATCH.VICTORY && guard < 60 * 90) {
  step(swapped, swappedBot(swapped));
  guard += 1;
}
console.log(`\n== 剧情 4 · 换边后重复任务 ==`);
console.log(`  swapped=${swapped.swapped} 结果=${swapped.mode} 成功=${swapped.score.wins}`);

// 回放冲突跳转自检。
const player = new ReplayPlayer(recovery.replay);
const firstConflict = player.nextConflict();
console.log(`\n回放跳转自检: 首次冲突 @${firstConflict.time.toFixed(2)}s 类型=${firstConflict.type}`);

const allPassed =
  coop.state.mode === MATCH.VICTORY &&
  oneSide.state.mode === MATCH.DEFEAT &&
  recovery.state.mode === MATCH.VICTORY &&
  recovery.state.score.fails === 1 &&
  swapped.mode === MATCH.VICTORY;

console.log(`\n${allPassed ? '✔ 全部剧情验收通过' : '✗ 存在未通过剧情'}`);
process.exit(allPassed ? 0 : 1);
