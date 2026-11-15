// 共享测试驾驶员：60Hz 步进、物理按键模拟、自动对准/调光/完成段落。
import { directionSide } from '../js/engine.js';

export const TICK = 1 / 60;

export class Driver {
  constructor(game, recorder = null) {
    this.game = game;
    this.recorder = recorder;
  }

  press(side, key) {
    if (this.game.inputs[side][key]) return;
    this.game.setInput(side, key, true);
    this.recorder?.recordInput(this.game.elapsed, side, key, true);
  }

  release(side, key) {
    if (!this.game.inputs[side][key]) return;
    this.game.setInput(side, key, false);
    this.recorder?.recordInput(this.game.elapsed, side, key, false);
  }

  releaseAll() {
    for (let side = 0; side < 2; side++) {
      for (const key of ['left', 'right', 'up', 'down']) {
        if (this.game.inputs[side][key]) this.release(side, key);
      }
    }
  }

  step(n = 1) {
    for (let i = 0; i < n; i++) this.game.step(TICK);
  }

  run(seconds) {
    this.step(Math.round(seconds / TICK));
  }

  aimTo(target) {
    const side = directionSide(this.game.swapIndex);
    let guard = 0;
    while (Math.abs(this.game.aim - target) > 2 && guard++ < 6000) {
      if (!this.game.overheated) {
        this.press(side, this.game.aim < target ? 'right' : 'left');
      }
      this.step();
      if (this.game.phase !== 'running') return;
    }
    this.release(side, 'left');
    this.release(side, 'right');
  }

  brightnessTo(target) {
    const side = 1 - directionSide(this.game.swapIndex);
    let guard = 0;
    while (Math.abs(this.game.brightness - target) > 0.05 && guard++ < 1200) {
      if (this.game.brightness < target) {
        this.press(side, 'up');
        this.release(side, 'down');
      } else {
        this.press(side, 'down');
        this.release(side, 'up');
      }
      this.step();
      if (this.game.phase !== 'running') return;
    }
    this.release(side, 'up');
    this.release(side, 'down');
  }

  completeCue() {
    const target = this.game.targetAngle();
    const from = this.game.cueIndex;
    let guard = 0;
    while (this.game.cueIndex === from && guard++ < 400) {
      this.aimTo(target);
      this.brightnessTo(0.6);
      this.step();
      if (this.game.phase !== 'running') return;
    }
  }
}
