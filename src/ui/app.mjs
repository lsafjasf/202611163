import { SAFETY_LIMITS } from '../config.mjs';
import { createModel } from '../simulation/factory.mjs';
import { SimulationRunner } from '../simulation/runner.mjs';
import { Renderer } from './renderer.mjs';
import { SpeedAudio } from './audio.mjs';
import { exportCSV, exportJSON } from './exporter.mjs';

const $ = (id) => document.getElementById(id);

export class PendulumApp {
  constructor() {
    this.renderer = new Renderer($('canvas'));
    this.audio = new SpeedAudio();
    this.config = this.readConfig();
    this.lastChange = { field: '初始化', value: this.summary(), at: this.now() };
    this.replay = null;
    this.buildRunner();
    this.bindControls();
    this.loop();
  }

  readConfig() {
    return {
      mode: $('mode').value,
      massKg: parseFloat($('mass').value),
      secondMassKg: parseFloat($('secondMass').value),
      lengthM: parseFloat($('length').value),
      secondLengthM: parseFloat($('secondLength').value),
      angleDeg: parseFloat($('angle').value),
      secondAngleDeg: parseFloat($('secondAngle').value),
      dampingPerSec: parseFloat($('damping').value),
      frictionOn: $('friction').checked
    };
  }

  summary() {
    const c = this.config;
    return `${c.mode === 'single' ? '单摆' : '双摆'} m=${c.massKg}kg L=${c.lengthM}m θ=${c.angleDeg}° 摩擦=${c.frictionOn ? '开' : '关'}`;
  }

  now() {
    return new Date().toLocaleTimeString('zh-CN', { hour12: false });
  }

  buildRunner() {
    const { model, params } = createModel(this.config);
    this.runner = new SimulationRunner(model, params);
    this.runner.pause();
  }

  bindControls() {
    const record = (field) => {
      this.config = this.readConfig();
      this.lastChange = { field, value: this.summary(), at: this.now() };
      this.buildRunner();
      this.updatePanel();
    };
    ['mode', 'mass', 'secondMass', 'length', 'secondLength', 'angle', 'secondAngle', 'damping', 'friction'].forEach(
      (id) => $(id).addEventListener('change', () => record(id))
    );

    $('play').addEventListener('click', () => {
      this.stopReplay();
      this.runner.play();
    });
    $('pause').addEventListener('click', () => this.runner.pause());
    $('step').addEventListener('click', () => {
      this.runner.pause();
      this.runner.stepOnce();
      this.updatePanel();
    });
    $('reset').addEventListener('click', () => {
      this.stopReplay();
      this.runner.reset();
      this.updatePanel();
    });

    $('audioToggle').addEventListener('change', async (e) => {
      e.target.checked ? await this.audio.enable() : this.audio.disable();
    });
    $('exportCsv').addEventListener('click', () => exportCSV(this.runner.recorder));
    $('exportJson').addEventListener('click', () =>
      exportJSON(this.runner.recorder, this.config, this.runner.trigger)
    );
    $('replay').addEventListener('click', () => this.startReplay());
  }

  startReplay() {
    this.runner.pause();
    this.replay = { index: 0 };
  }

  stopReplay() {
    this.replay = null;
  }

  forceInfo(frame) {
    // 暂停/单步/回放时显示：红色=切向受力（角加速度），绿色=速度方向（变化趋势）。
    const model = this.runner.model;
    const accels = model.angularAccel ? model.angularAccel() : [model.angularAccel()];
    return frame.positions.map((pos, i) => {
      const theta = i === 0 ? frame.theta : frame.theta2;
      const tangent = { x: Math.cos(theta), y: -Math.sin(theta) };
      const scale = 0.8;
      return {
        end: { x: pos.x + tangent.x * accels[i] * scale, y: pos.y + tangent.y * accels[i] * scale },
        type: 'force'
      };
    });
  }

  loop() {
    let frame;
    if (this.replay) {
      frame = this.runner.recorder.at(this.replay.index);
      if (this.replay.index >= this.runner.recorder.count - 1) {
        this.stopReplay();
      } else {
        this.replay.index++;
      }
    } else {
      frame = this.runner.tick();
    }

    const showForce = !this.runner.running || this.replay;
    this.renderer.draw(
      frame,
      this.runner.recorder.samples,
      this.config.mode,
      showForce ? this.forceInfo(frame) : null,
      this.runner.trigger
    );
    this.audio.update(frame.speed, SAFETY_LIMITS.speed.max);
    this.updatePanel(frame);
    requestAnimationFrame(() => this.loop());
  }

  updatePanel(frame = this.runner.currentFrame) {
    const fmt = (v, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : '—');
    $('readouts').innerHTML = `
      <li>时间 t：<b>${fmt(frame.time, 2)} s</b></li>
      <li>角度 θ：<b>${fmt((frame.theta * 180) / Math.PI, 1)}°</b></li>
      <li>角速度 ω：<b>${fmt(frame.omega, 2)} rad/s</b></li>
      <li>最大速度：<b>${fmt(frame.speed, 3)} m/s</b>（限 ${SAFETY_LIMITS.speed.max}）</li>
      <li>动能：<b>${fmt(frame.kineticJ, 3)} J</b></li>
      <li>势能：<b>${fmt(frame.potentialJ, 3)} J</b></li>
      <li>总机械能：<b>${fmt(frame.totalEnergyJ, 3)} J</b></li>
      <li>支点压力：<b>${fmt(frame.pressureN, 1)} N</b>（限 ${SAFETY_LIMITS.pressureN.max}）</li>
      <li>温度：<b>${fmt(frame.temperatureC, 2)} °C</b>（限 ${SAFETY_LIMITS.temperatureC.max}）</li>
      <li>摩擦耗散：<b>${fmt(frame.dissipatedJ, 3)} J</b></li>`;

    $('lastChange').textContent = `[${this.lastChange.at}] ${this.lastChange.field} → ${this.lastChange.value}`;

    const t = this.runner.trigger;
    const box = $('triggerBox');
    if (t) {
      box.hidden = false;
      $('triggerMsg').textContent =
        `触发 ${t.label}（${t.reason}）于 t=${t.time.toFixed(2)}s：` +
        `数值 ${fmt(t.value, 2)}${t.unit ?? ''}，限值 ${t.min ?? '—'}~${t.max}${t.unit ?? ''}。` +
        `位置 (${t.positions.map((p) => `(${p.x.toFixed(2)},${p.y.toFixed(2)})`).join(' ')})，` +
        `速度 ${fmt(t.speed, 2)} m/s，压力 ${fmt(t.pressureN, 1)} N，温度 ${fmt(t.temperatureC, 2)} °C。` +
        `停止时总机械能 ${fmt(frame.totalEnergyJ, 2)} J（动能 ${fmt(frame.kineticJ, 2)} J / 势能 ${fmt(frame.potentialJ, 2)} J）。仿真已停止。`;
    } else {
      box.hidden = true;
    }
    $('status').textContent = this.runner.running ? '运行中' : this.replay ? '回放中' : '已暂停';
    $('sampleCount').textContent = `${this.runner.recorder.count} 帧`;
  }
}
