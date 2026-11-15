import { EVENT, MATCH, TICK_SEC } from '../engine/config.js';
import { createGame, restart, setMode, step, swapSides, togglePause } from '../engine/engine.js';
import { ReplayRecorder, listReplays, saveReplay } from '../engine/replay.js';
import { render } from './renderer.js';
import { AudioEngine, soundForEvent } from './audio.js';
import { InputController } from './input-controller.js';
import { ReplayView } from './replay-view.js';

export class AssemblyApp {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.state = createGame(MATCH.COOP);
    this.input = new InputController(globalThis);
    this.audio = new AudioEngine();
    this.recorder = new ReplayRecorder({ mode: 'coop' });
    this.recorder.observe(this.state);
    this.accumulator = 0;
    this.lastFrame = 0;
    this.replayView = null;
    this.savedThisMatch = false;
    this.input.attach();
  }

  start() {
    this.recorder.observe(this.state);
    const loop = (now) => {
      if (!this.lastFrame) this.lastFrame = now;
      const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
      this.lastFrame = now;
      this.frame(dt);
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  frame(dt) {
    const tickBefore = this.state.tick;
    for (const action of this.input.drainActions()) this.handleAction(action);
    const restarted = this.state.tick === 0 && tickBefore > 0;

    if (this.replayView) {
      this.replayView.update(dt);
      return;
    }

    if (this.state.paused) {
      this.accumulator = 0;
      return;
    }
    if (restarted) {
      this.accumulator = 0;
      return;
    }

    this.accumulator += dt;
    while (this.accumulator >= TICK_SEC) {
      this.accumulator -= TICK_SEC;
      const before = this.state.events.length;
      const input = this.input.sample(this.state);
      this.stepEngine(input);
      this.recorder.observe(this.state);
      this.playNewSounds(before);
      if (this.state.mode === MATCH.VICTORY || this.state.mode === MATCH.DEFEAT) {
        this.persistReplay();
        break;
      }
    }
    if (!this.state.paused) {
      this.audio.updateClamp(this.state);
      this.audio.updateModule(this.state);
    }
  }

  stepEngine(input) {
    step(this.state, input);
  }

  playNewSounds(before) {
    for (const event of this.state.events.slice(before)) {
      if (event.type === EVENT.MATCH_VICTORY) this.audio.victory();
      else if (event.type === EVENT.MATCH_DEFEAT) this.audio.defeat();
      else soundForEvent(this.audio, event.type);
    }
  }

  persistReplay() {
    if (this.savedThisMatch) return;
    this.savedThisMatch = true;
    const replay = this.recorder.finish(this.state, this.state.mode);
    saveReplay(replay);
  }

  handleAction(action) {
    this.audio.ensureContext();
    if (action === 'replay') {
      const stored = listReplays();
      if (this.replayView) {
        this.replayView = null;
      } else if (stored.length) {
        this.replayView = new ReplayView(stored[0], render);
      }
      return;
    }
    if (this.replayView) {
      this.replayView.handleAction(action);
      return;
    }
    if (action === 'pause') togglePause(this.state);
    if (action === 'swap') swapSides(this.state);
    if (action === 'debug') {
      const next = this.state.mode === MATCH.DEBUG ? MATCH.COOP : MATCH.DEBUG;
      if (next !== MATCH.VICTORY && next !== MATCH.DEFEAT) setMode(this.state, next);
    }
    if (action === 'restart') this.doRestart();
  }

  doRestart() {
    const mode = this.state.mode === MATCH.DEBUG ? MATCH.DEBUG : MATCH.COOP;
    this.state = restart(this.state, mode);
    this.audio.reset();
    this.recorder = new ReplayRecorder({ mode });
    this.recorder.observe(this.state);
    this.accumulator = 0;
    this.savedThisMatch = false;
  }

  draw() {
    const width = this.canvas.width;
    const height = this.canvas.height;
    if (this.replayView) {
      this.replayView.draw(this.ctx, width, height);
      return;
    }
    render(this.ctx, this.state, { width, height });
  }
}
