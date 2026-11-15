// Browser controller: keyboard for two seats, game modes, replay viewer.
import { CONFIG, createGame, resetGame, rotateSeats, applyInput, step } from './sim.js';
import { createRenderer } from './render.js';
import { createAudio } from './audio.js';

const canvas = document.getElementById('game');
const renderer = createRenderer(canvas);
const audio = createAudio();

let state = createGame(Date.now() % 100000);
let mode = 'play'; // play | replay
let replays = loadReplays();
let replay = null; // { data, clock, playing }
let lastEventIdx = 0;

const KEYMAP = {
  KeyW: { seat: 'L', axis: 'hoist', action: 'dec' }, // up = shorten cable
  KeyS: { seat: 'L', axis: 'hoist', action: 'inc' },
  KeyA: { seat: 'L', axis: 'swing', action: 'dec' },
  KeyD: { seat: 'L', axis: 'swing', action: 'inc' },
  ArrowUp: { seat: 'R', axis: 'hoist', action: 'dec' },
  ArrowDown: { seat: 'R', axis: 'hoist', action: 'inc' },
  ArrowLeft: { seat: 'R', axis: 'swing', action: 'dec' },
  ArrowRight: { seat: 'R', axis: 'swing', action: 'inc' },
  KeyF: { seat: 'L', action: 'estop' },
  Enter: { seat: 'R', action: 'estop' },
};

window.addEventListener('keydown', (e) => {
  audio.unlock();
  if (e.repeat) return;
  if (mode === 'replay') return replayKey(e.code, true);
  const m = KEYMAP[e.code];
  if (m) {
    e.preventDefault();
    dispatch(m, true);
    return;
  }
  if (e.code === 'KeyP') togglePause();
  if (e.code === 'KeyR') restart();
  if (e.code === 'KeyT') toggleSolo();
  if (e.code === 'KeyQ') rotate();
  if (e.code === 'KeyV') openReplay();
});

window.addEventListener('keyup', (e) => {
  if (mode === 'replay') return;
  const m = KEYMAP[e.code];
  if (m) dispatch(m, false);
});

function dispatch(m, pressed) {
  if (m.action === 'estop') {
    if (state.solo && pressed) {
      applyInput(state, 'L', 'estop', true);
      applyInput(state, 'R', 'estop', true);
    } else if (state.solo) {
      applyInput(state, 'L', 'estop', false);
      applyInput(state, 'R', 'estop', false);
    } else {
      applyInput(state, m.seat, 'estop', pressed);
    }
    return;
  }
  if (state.solo) {
    const soloAction =
      (m.axis === 'hoist' ? 'hoist' : 'swing') + (m.action === 'inc' ? 'Inc' : 'Dec');
    applyInput(state, m.seat, soloAction, pressed);
    return;
  }
  // Co-op: a key only works if its seat currently owns that axis.
  if (state.seats[m.seat] !== m.axis) return;
  applyInput(state, m.seat, m.action, pressed);
}

function togglePause() {
  if (state.status === 'running') state.status = 'paused';
  else if (state.status === 'paused') state.status = 'running';
}

function restart() {
  state = resetGame(state);
  lastEventIdx = state.events.length;
  audio.reset();
}

function toggleSolo() {
  state.solo = !state.solo;
  restart();
}

function rotate() {
  rotateSeats(state);
  restart();
}

function loadReplays() {
  try {
    return JSON.parse(localStorage.getItem('gondola_replays') || '[]');
  } catch {
    return [];
  }
}

function saveReplay() {
  replays.unshift({
    when: new Date().toISOString(),
    result: state.status,
    reason: state.loseReason,
    seats: { ...state.seats },
    solo: state.solo,
    repairs: state.repairs.map((r) => ({ x: r.x, y: r.y })),
    events: state.events,
    frames: state.frames,
    conflicts: state.conflicts,
  });
  replays = replays.slice(0, 3);
  localStorage.setItem('gondola_replays', JSON.stringify(replays));
}

function openReplay() {
  if (!replays.length) return;
  replay = { data: replays[0], clock: 0, playing: true };
  mode = 'replay';
}

function replayKey(code) {
  if (code === 'Escape' || code === 'KeyV') mode = 'play';
  if (code === 'Space' && replay) replay.playing = !replay.playing;
  if (code === 'ArrowLeft' && replay) replay.clock = Math.max(0, replay.clock - 2);
  if (code === 'ArrowRight' && replay) replay.clock += 2;
}

// Rebuild a renderable pseudo-state from a replay frame.
function replayState(data, frame) {
  return {
    t: frame.t,
    status: 'running',
    seats: data.seats,
    solo: data.solo,
    arm: { x: frame.armX },
    hoist: { len: frame.len },
    pend: { theta: frame.theta },
    tension: frame.tension,
    resource: frame.resource,
    timeLeft: frame.timeLeft,
    wind: { force: frame.wind },
    repairs: data.repairs.map((r, i) => ({
      ...r,
      done: i < frame.done,
      progress: 0,
    })),
  };
}

function replayUI(data, clock) {
  const marks = data.conflicts.map((c) => `${c.kind}@${c.t}s`).join('  ');
  const near = data.conflicts.find((c) => Math.abs(c.t - clock) < 0.4);
  return {
    hint: near ? `⚠ 冲突 ${near.kind}` : '回放中',
    mode: 'replay',
    replayInfo: `回放 ${data.result} | t=${clock.toFixed(1)}s | 冲突: ${marks || '无'} | Space 暂停 ←/→ 快退快进 Esc 退出`,
    overlay: null,
  };
}

function playUI() {
  const ui = {
    hint: state.solo
      ? '单人调试 | W/S 升降 A/D 摆臂 F 急停 | P 暂停 R 重开 T 双人 V 回放'
      : '双人协作 | P 暂停 R 重开 Q 轮换控制侧 T 单人调试 V 回放',
    mode: 'play',
    overlay: null,
    overlaySub: '',
  };
  if (state.status === 'paused') {
    ui.overlay = '已暂停';
    ui.overlaySub = '按 P 继续';
  } else if (state.status === 'won') {
    ui.overlay = '✔ 三处窗框维修完成！';
    ui.overlaySub = '按 R 再来一局 · 按 V 查看回放';
  } else if (state.status === 'lost') {
    ui.overlay = state.loseReason === 'cable-snap' ? '✘ 缆绳过载断裂！' : '✘ 倒计时结束！';
    ui.overlaySub = '按 R 重新开始 · 按 V 查看回放';
  }
  return ui;
}

function consumeEvents() {
  for (; lastEventIdx < state.events.length; lastEventIdx++) {
    const e = state.events[lastEventIdx];
    if (e.type === 'estop') audio.estop();
    if (e.type === 'gust') audio.gust();
    if (e.type === 'repair-done') audio.repair();
    if (e.type === 'won') {
      audio.win();
      saveReplay();
    }
    if (e.type === 'lost') {
      audio.lose();
      saveReplay();
    }
  }
}

let acc = 0;
let lastTs = 0;
const DT = 1 / 60;

function loop(ts) {
  const elapsed = Math.min(0.1, (ts - lastTs) / 1000 || 0);
  lastTs = ts;
  if (mode === 'replay' && replay) {
    if (replay.playing) replay.clock += elapsed;
    const frames = replay.data.frames;
    const last = frames[frames.length - 1];
    if (replay.clock > last.t) replay.clock = 0;
    let frame = frames[0];
    for (const f of frames) {
      if (f.t <= replay.clock) frame = f;
      else break;
    }
    renderer.draw(replayState(replay.data, frame), replayUI(replay.data, replay.clock));
  } else {
    acc += elapsed;
    while (acc >= DT) {
      step(state, DT);
      acc -= DT;
    }
    consumeEvents();
    audio.update(state, CONFIG.tensionMax);
    renderer.draw(state, playUI());
  }
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
