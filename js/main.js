import { PHYS, LIMITS, SCENARIOS } from './constants.js';
import { createState, stepOnce, snapshot, checkLoadEnvelope, logEvent } from './engine.js';
import { makeAutoPilot, sliderPilot } from './pilot.js';
import { Renderer } from './renderer.js';
import { HeightAudio } from './audio.js';
import { Replay } from './replay.js';
import { celsius } from './util.js';

const $ = (id) => document.getElementById(id);

export class App {
  constructor() {
    this.renderer = new Renderer($('scene'));
    this.audio = new HeightAudio();
    this.replayStore = new Replay(10);
    this.scenarioName = 'normal';
    this.auto = true;
    this.manualLevel = 0;
    this.replayMode = false;
    this.accumulator = 0;
    this.lastTs = 0;
    this.resetAll();
    this.bindUi();
    this.renderLimits();
    this.refreshHud();
    this.renderer.draw(this.state);
    requestAnimationFrame((ts) => this.loop(ts));
  }

  resetAll() {
    const cfg = SCENARIOS[this.scenarioName];
    this.state = createState(cfg);
    this.auto = cfg.auto;
    $('autoToggle').checked = cfg.auto;
    this.manualLevel = cfg.command ?? 0;
    this.autoPilot = makeAutoPilot(cfg.gain);
    this.replayStore.reset();
    this.replayStore.record(this.state);
    this.initialSnapshot = snapshot(this.state);
    this.replayMode = false;
    this.accumulator = 0;
    this.setStatus('idle', '就绪');
    const box = $('triggerBox');
    if (box) box.classList.remove('show');
    $('btnReplay').disabled = true;
    $('replayScrub').disabled = true;
  }

  activePilot() {
    if (this.auto) return this.autoPilot;
    return sliderPilot(this.manualLevel);
  }

  setStatus(status, label) {
    const badge = $('statusBadge');
    badge.textContent = label;
    badge.className = `status ${status === 'idle' ? '' : status}`;
    $('btnPause').disabled = this.replayMode ||
      !(this.state.status === 'running' || this.state.status === 'paused');
    $('btnStep').disabled = this.replayMode || this.state.status === 'triggered'
      || this.state.status === 'success';
  }

  isLive() {
    return !this.replayMode && (this.state.status === 'running' || this.state.status === 'paused');
  }

  bindUi() {
    $('btnStart').addEventListener('click', () => this.start());
    $('btnPause').addEventListener('click', () => this.togglePause());
    $('btnStep').addEventListener('click', () => this.singleStep());
    $('btnReset').addEventListener('click', () => { this.resetAll(); this.refreshHud(); this.renderer.draw(this.state); });
    $('btnReplay').addEventListener('click', () => this.enterReplay());

    document.querySelectorAll('[data-scenario]').forEach((btn) => {
      btn.addEventListener('click', () => this.chooseScenario(btn.dataset.scenario, btn));
    });

    $('curSlider').addEventListener('input', (e) => {
      this.manualLevel = parseFloat(e.target.value);
      $('curVal').textContent = this.manualLevel.toFixed(2);
      this.noteChange(`手动电流 → ${this.manualLevel.toFixed(2)} A`);
    });
    $('dampSlider').addEventListener('input', (e) => {
      this.state.damping = parseFloat(e.target.value);
      $('dampVal').textContent = this.state.damping.toFixed(2);
      this.noteChange(`阻尼 → ${this.state.damping.toFixed(2)} N·s/m`);
    });
    $('massSlider').addEventListener('input', (e) => {
      this.state.mass = parseFloat(e.target.value);
      $('massVal').textContent = this.state.mass.toFixed(3);
      this.noteChange(`负载 → ${this.state.mass.toFixed(3)} kg`);
      if (this.isLive()) {
        checkLoadEnvelope(this.state);
        if (this.state.status === 'triggered') {
          this.showTrigger();
          this.setStatus('triggered', '已触发保护');
        }
      }
    });
    $('autoToggle').addEventListener('change', (e) => {
      this.auto = e.target.checked;
      this.noteChange(this.auto ? '切换为自动驾驶' : '切换为手动控制');
    });
    $('audioToggle').addEventListener('change', async (e) => {
      if (e.target.checked) await this.audio.enable();
      else this.audio.disable();
    });
    $('replayScrub').addEventListener('input', (e) => {
      if (!this.replayMode) return;
      const frac = e.target.value / Math.max(1, this.replayStore.length - 1);
      const frame = this.replayStore.at(frac);
      $('replayTime').textContent = `${frame.t.toFixed(2)} s`;
      this.renderer.draw(this.state, frame);
    });
  }

  noteChange(text) {
    $('lastChange').textContent = `最近变化：t=${this.state.t.toFixed(2)}s · ${text}`;
  }

  chooseScenario(name, btn) {
    this.scenarioName = name;
    document.querySelectorAll('[data-scenario]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const cfg = SCENARIOS[name];
    $('dampSlider').value = cfg.damping;
    $('dampVal').textContent = cfg.damping.toFixed(2);
    $('massSlider').value = cfg.mass;
    $('massVal').textContent = cfg.mass.toFixed(3);
    $('curSlider').value = cfg.command ?? 0;
    $('curVal').textContent = (cfg.command ?? 0).toFixed(2);
    $('autoToggle').checked = cfg.auto;
    this.resetAll();
    this.refreshHud();
    this.renderer.draw(this.state);
    this.noteChange(`载入场景：${cfg.label}`);
  }

  start() {
    if (this.replayMode) this.leaveReplay();
    if (this.state.status === 'triggered' || this.state.status === 'success') {
      this.resetAll();
    }
    if (!checkLoadEnvelope(this.state)) {
      this.showTrigger();
      this.setStatus('triggered', '已触发保护');
      return;
    }
    this.state.status = 'running';
    this.setStatus('running', '运行中');
    logEvent(this.state, '仿真启动');
    this.accumulator = 0;
  }

  togglePause() {
    if (this.state.status === 'running') {
      this.state.status = 'paused';
      this.setStatus('paused', '已暂停');
      logEvent(this.state, '手动暂停');
    } else if (this.state.status === 'paused') {
      this.state.status = 'running';
      this.setStatus('running', '运行中');
      logEvent(this.state, '恢复运行');
    }
  }

  // Pause and single-step share exactly this code path, guaranteeing that
  // stepping once and resuming after one frame yield identical physics state.
  singleStep() {
    if (this.state.status === 'idle' || this.state.status === 'running') {
      this.state.status = 'paused';
    }
    if (this.state.status !== 'paused') return;
    const before = snapshot(this.state);
    stepOnce(this.state, this.activePilot());
    // Guard: a single step must advance exactly one fixed DT.
    if (this.state.step - before.step !== 1) throw new Error('单步步长异常');
    this.replayStore.record(this.state);
    this.setStatus('paused', `单步 · 第 ${this.state.step} 步`);
    this.afterStep();
  }

  enterReplay() {
    if (this.replayStore.length < 2) return;
    this.replayMode = true;
    const slider = $('replayScrub');
    slider.disabled = false;
    slider.max = this.replayStore.length - 1;
    slider.value = this.replayStore.length - 1;
    this.setStatus('paused', '回放中');
    const frame = this.replayStore.at(1);
    $('replayTime').textContent = `${frame.t.toFixed(2)} s`;
    this.renderer.draw(this.state, frame);
  }

  leaveReplay() {
    this.replayMode = false;
    $('replayScrub').disabled = true;
    this.setStatus(this.state.status,
      this.state.status === 'success' ? '成功落座' : '已暂停');
  }

  loop(ts) {
    if (!this.lastTs) this.lastTs = ts;
    let frameMs = ts - this.lastTs;
    this.lastTs = ts;
    frameMs = Math.min(frameMs, 100);

    if (this.state.status === 'running' && !this.replayMode) {
      this.accumulator += frameMs / 1000;
      let guard = 0;
      while (this.accumulator >= PHYS.DT && guard < 400) {
        stepOnce(this.state, this.activePilot());
        this.replayStore.record(this.state);
        this.accumulator -= PHYS.DT;
        guard += 1;
        if (this.state.status !== 'running') break;
      }
      this.afterStep();
    }
    if (!this.replayMode) this.renderer.draw(this.state);
    this.audio.update(this.state.y, this.state.vy);
    requestAnimationFrame((t) => this.loop(t));
  }

  afterStep() {
    this.refreshHud();
    if (this.state.status === 'triggered') {
      this.showTrigger();
      this.setStatus('triggered', '已触发保护');
      $('btnReplay').disabled = false;
    } else if (this.state.status === 'success') {
      this.setStatus('success', '成功落座');
      $('btnReplay').disabled = false;
    }
  }

  renderLimits() {
    const rows = [
      ['负载质量', `${LIMITS.loadMin} – ${LIMITS.loadMax}`, 'kg'],
      ['运动速度', `≤ ${LIMITS.speedMax}`, 'm/s'],
      ['线圈温度', `≤ 80`, '°C'],
      ['接触压力', `≤ ${LIMITS.pressureMax / 1000}`, 'kPa']
    ];
    $('limitBody').innerHTML = rows.map(([k, v, u]) =>
      `<tr><td>${k}</td><td>${v} ${u}</td></tr>`).join('');
  }

  refreshHud() {
    const s = this.state;
    const set = (id, v, cls) => {
      const el = $(id);
      el.textContent = v;
      el.className = cls ? `v ${cls}` : 'v';
    };
    set('mY', `${s.y.toFixed(3)} m`);
    set('mVy', `${s.vy.toFixed(3)} m/s`, Math.abs(s.vy) > LIMITS.speedMax * 0.85 ? 'warn' : '');
    set('mX', `${s.x.toFixed(3)} m`);
    set('mVx', `${s.vx.toFixed(3)} m/s`);
    set('mFz', `${s.forceZ.toFixed(3)} N`);
    set('mFx', `${s.forceX.toFixed(3)} N`);
    const maxTemp = Math.max(...s.temp);
    set('mTemp', `${celsius(maxTemp).toFixed(1)} °C`, maxTemp > LIMITS.tempMax - 15 ? 'warn' : '');
    set('mPress', `${(s.maxPressure / 1000).toFixed(1)} kPa`,
      s.maxPressure > LIMITS.pressureMax * 0.85 ? 'warn' : '');
    set('mScore', String(s.score), s.score >= 85 ? 'good' : s.score >= 60 ? 'warn' : 'bad');
    set('mTime', `${s.t.toFixed(2)} s`);

    const log = $('eventLog');
    log.innerHTML = s.events.slice(-12).reverse().map((ev) =>
      `<div class="ev"><span class="time">${ev.t.toFixed(2)}s</span>${ev.text}</div>`).join('');
    if (s.lastEvent && !s.lastEvent.text.startsWith('系统')) {
      $('lastChange').textContent = `最近变化：t=${s.lastEvent.t.toFixed(2)}s · ${s.lastEvent.text}`;
    }
  }

  showTrigger() {
    const tr = this.state.trigger;
    if (!tr) return;
    const box = $('triggerBox');
    box.classList.add('show');
    $('triggerTitle').textContent = `保护已触发（${tr.type}）— 计算已停止`;
    const rows = [
      ['原因', tr.message],
      ['触发时间', `${tr.t.toFixed(3)} s（第 ${tr.step} 步）`],
      ['位置 y / x', `${tr.y.toFixed(4)} m / ${tr.x.toFixed(4)} m`],
      ['速度 vy / vx', `${tr.vy.toFixed(4)} / ${tr.vx.toFixed(4)} m/s`],
      ['最高温度', `${celsius(tr.temp).toFixed(2)} °C`],
      ['峰值压力', `${(tr.pressure / 1000).toFixed(2)} kPa`]
    ];
    $('triggerBody').innerHTML = rows.map(([k, v]) =>
      `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
    $('btnReplay').disabled = this.replayStore.length < 2;
  }
}

if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('DOMContentLoaded', () => new App());
}
