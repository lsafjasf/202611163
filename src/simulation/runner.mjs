import { PHYSICS_DT, SUBSTEPS_PER_FRAME, AMBIENT_TEMP_C } from '../config.mjs';
import { checkLimits } from './monitor.mjs';
import { Recorder } from './recorder.mjs';

// 仿真运行器：固定步长积分、暂停/单步/重置、限值触发与轨迹记录。
// 暂停与单步走的是同一个 advanceFrame()，因此物理状态完全一致。
export class SimulationRunner {
  constructor(model, params) {
    this.model = model;
    this.params = params;
    this.recorder = new Recorder();
    this.time = 0;
    this.running = false;
    this.trigger = null;
    this.recordInitial();
  }

  recordInitial() {
    this.recorder.clear();
    this.recorder.record(this.buildFrame());
  }

  buildFrame() {
    const frame = this.model.snapshot(this.time);
    frame.temperatureC = this.model.temperatureC(AMBIENT_TEMP_C);
    return frame;
  }

  get currentFrame() {
    return this.buildFrame();
  }

  play() {
    if (!this.trigger) this.running = true;
  }

  pause() {
    this.running = false;
  }

  // 单步：推进恰好一个显示帧（SUBSTEPS_PER_FRAME 个物理步）。
  stepOnce() {
    if (this.running || this.trigger) return null;
    return this.advanceFrame();
  }

  // 实时循环每帧调用；未运行或已触发时返回当前帧。
  tick() {
    if (this.running && !this.trigger) this.advanceFrame();
    return this.currentFrame;
  }

  advanceFrame() {
    let lastFrame = null;
    for (let i = 0; i < SUBSTEPS_PER_FRAME; i++) {
      this.model.step(PHYSICS_DT);
      this.time += PHYSICS_DT;
      const frame = this.buildFrame();
      const trigger = checkLimits(frame, this.params);
      if (trigger) {
        this.trigger = trigger;
        this.running = false;
        this.recorder.record(frame);
        return frame;
      }
      lastFrame = frame;
    }
    this.recorder.record(lastFrame);
    return lastFrame;
  }

  reset() {
    this.time = 0;
    this.running = false;
    this.trigger = null;
    this.model.reset();
    this.recordInitial();
    return this.currentFrame;
  }

  // 无显示的快速推进，供自动化验证与确定性比对使用。
  runSeconds(durationSec) {
    const frames = Math.round(durationSec / (PHYSICS_DT * SUBSTEPS_PER_FRAME));
    for (let i = 0; i < frames && !this.trigger; i++) this.advanceFrame();
    return this.currentFrame;
  }
}
