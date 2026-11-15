// 主控：游戏循环、输入接线、事件 -> 音效/画面反馈、重开复位。
import { Game, CONFIG, directionSide } from '../engine.js';
import { AudioManager } from '../audio.js';
import { Renderer } from '../renderer.js';
import { KeyboardInput } from '../input.js';
import { ReplayRecorder, makeStore } from '../replay.js';
import { syncHud, logEvent } from './hud.js';
import { initReplays } from './replay-ui.js';

export function boot() {
  const canvas = document.getElementById('stage');
  const renderer = new Renderer(canvas);
  renderer.resize();
  window.addEventListener('resize', () => renderer.resize());

  const game = new Game();
  const audio = new AudioManager();
  const keyboard = new KeyboardInput();
  const recorder = new ReplayRecorder();
  const store = makeStore();

  const ctx = {
    game, audio, renderer, keyboard, recorder, store,
    rafId: 0, lastTs: 0, savedThisRound: false,
  };

  keyboard.attach();
  keyboard.onPhysical((side, key, pressed) => {
    if (game.phase === 'running') {
      game.setInput(side, key, pressed);
      recorder.recordInput(game.elapsed, side, key, pressed);
    }
  });
  keyboard.onAction((action) => handleAction(ctx, action));

  document.getElementById('btn-start').onclick = () => startGame(ctx);
  document.getElementById('btn-pause').onclick = () => handleAction(ctx, 'pause');
  document.getElementById('btn-restart').onclick = () => handleAction(ctx, 'restart');
  document.getElementById('btn-swap').onclick = () => handleAction(ctx, 'swap');
  document.getElementById('btn-debug').onclick = () => handleAction(ctx, 'debug');
  document.getElementById('btn-replays').onclick = () =>
    document.getElementById('replay-modal').classList.remove('hidden');
  document.getElementById('overlay-restart').onclick = () =>
    handleAction(ctx, 'restart');
  document.getElementById('overlay-replay').onclick = () => {
    document.getElementById('overlay').classList.add('hidden');
    document.getElementById('replay-modal').classList.remove('hidden');
  };

  initReplays(store);

  const loop = (ts) => {
    ctx.rafId = requestAnimationFrame(loop);
    if (!ctx.lastTs) ctx.lastTs = ts;
    const dt = Math.min(0.1, (ts - ctx.lastTs) / 1000);
    ctx.lastTs = ts;
    if (game.phase === 'running') {
      const before = game.events.length;
      game.step(dt);
      handleNewEvents(ctx, before);
    }
    renderer.draw(game.getState());
    syncHud(game.getState());
  };
  ctx.rafId = requestAnimationFrame(loop);

  syncHud(game.getState());
  logEvent('info', '等待开始：点击「开始」或按任意控制键');
  return ctx;
}

function startGame(ctx) {
  const { game, audio, recorder } = ctx;
  audio.ensure();
  if (game.phase === 'success' || game.phase === 'failed') {
    restartAll(ctx);
    return;
  }
  if (game.phase === 'idle') game.start();
  if (game.phase === 'running') {
    audio.startBeat();
    recorder.clear();
    recorder.setMeta({
      mode: game.debugMode ? 'debug' : 'coop',
      swapStart: game.swapIndex,
    });
  }
}

function handleAction(ctx, action) {
  const { game, audio, keyboard, recorder } = ctx;
  if (action === 'pause') {
    if (game.phase === 'running') {
      releaseAllInputs(ctx);
      audio.pause();
    }
    game.togglePause();
    if (game.phase === 'running') audio.resume();
  }
  if (action === 'restart') {
    restartAll(ctx);
  }
  if (action === 'swap' && game.phase !== 'success' && game.phase !== 'failed') {
    game.swapSides();
    recorder.recordAction(game.elapsed, 'swap');
    logEvent('info', `职责轮换 #${game.swapIndex}：方向改由${
      directionSide(game.swapIndex) === 0 ? '左' : '右'
    }侧控制`);
  }
  if (action === 'debug' && game.phase !== 'success' && game.phase !== 'failed') {
    game.toggleDebug();
    recorder.recordAction(game.elapsed, 'debug');
    recorder.setMeta({ mode: game.debugMode ? 'debug' : 'coop' });
    document.getElementById('btn-debug').classList.toggle('active', game.debugMode);
    logEvent('info', game.debugMode ? '进入单人调试模式' : '退出单人调试模式');
  }
}

function restartAll(ctx) {
  const { game, audio, keyboard, recorder } = ctx;
  audio.reset();
  keyboard.reset();
  game.restart();
  recorder.clear();
  recorder.setMeta({
    mode: game.debugMode ? 'debug' : 'coop',
    swapStart: game.swapIndex,
  });
  ctx.savedThisRound = false;
  document.getElementById('overlay').classList.add('hidden');
  document.getElementById('event-log').innerHTML = '';
  logEvent('info', '全部复位：仪表、资源、倒计时与音效已重置');
  audio.ensure();
  audio.startBeat();
}

function releaseAllInputs(ctx) {
  const { game, keyboard, recorder } = ctx;
  for (let side = 0; side < 2; side++) {
    for (const key of ['left', 'right', 'up', 'down']) {
      if (game.inputs[side][key]) {
        game.setInput(side, key, false);
        recorder.recordInput(game.elapsed, side, key, false);
      }
    }
  }
  keyboard.reset();
}

function handleNewEvents(ctx, before) {
  const { game, audio, renderer } = ctx;
  for (const ev of game.events.slice(before)) {
    switch (ev.type) {
      case 'doubleHit':
        audio.warn();
        renderer.setFlash('警告：双演员强光!', '#ff5a5a');
        logEvent('conflict', `[${ev.t.toFixed(2)}s] 双演员完全命中，警告 ${ev.warnings}/${CONFIG.warnLimit}`);
        break;
      case 'overheat':
        audio.overheat();
        renderer.setFlash('灯架过热，停转散热!', '#ff9d3c');
        logEvent('conflict', `[${ev.t.toFixed(2)}s] 灯架连续转动过热，方向锁定`);
        break;
      case 'recover':
        renderer.setFlash('温度恢复，可转动', '#46e08a');
        logEvent('good', `[${ev.t.toFixed(2)}s] 散热完成，灯架恢复转动`);
        break;
      case 'cueComplete':
        audio.cue();
        renderer.setFlash(`第 ${ev.cueIndex + 1} 段完成`, '#46e08a');
        logEvent('good', `[${ev.t.toFixed(2)}s] 第 ${ev.cueIndex + 1} 段追光完成`);
        break;
      case 'miss':
        audio.miss();
        logEvent('miss', `[${ev.t.toFixed(2)}s] 第 ${ev.cueIndex + 1} 段光斑丢失（方向 ${ev.aim}° / 亮度 ${ev.brightness}）`);
        break;
      case 'success':
        audio.success();
        finishRound(ctx, true);
        break;
      case 'fail':
        audio.fail();
        finishRound(ctx, false, ev.reason);
        break;
      default:
        break;
    }
  }
}

function finishRound(ctx, ok, reason) {
  const { game, recorder, store, renderer } = ctx;
  if (!ctx.savedThisRound) {
    const replay = recorder.finish(game);
    store.save(replay);
    ctx.savedThisRound = true;
    ctx.lastReplay = replay;
  }
  const overlay = document.getElementById('overlay');
  const card = overlay.querySelector('.overlay-card');
  card.classList.toggle('success', ok);
  card.classList.toggle('fail', !ok);
  document.getElementById('overlay-title').textContent = ok
    ? '演出成功'
    : reason === 'warnings' ? '演出失败：警告超限' : '演出失败：倒计时耗尽';
  const s = game.getState();
  document.getElementById('overlay-text').textContent =
    `完成段落 ${s.cueIndex}/${s.cueCount} · 冲突 ${s.conflictCount} 次 · 失误 ${s.missCount} 次 · 用时 ${s.elapsed.toFixed(1)}s（回放已自动保存）`;
  overlay.classList.remove('hidden');
  renderer.setFlash(ok ? '成功!' : '失败!', ok ? '#46e08a' : '#ff5a5a', 1600);
  logEvent(ok ? 'good' : 'conflict',
    ok ? '演出成功，回放已保存' : `演出失败（${reason}），回放已保存`);
}
