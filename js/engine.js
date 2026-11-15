// 纯逻辑引擎：不依赖 DOM / Canvas / Audio，可在 Node 中直接测试。
// 物理输入固定按"控制台侧"区分：0 = 左侧，1 = 右侧。
// swapIndex 为偶数时左侧控方向；为奇数时左侧控亮度。

export const CONFIG = {
  duration: 45,            // 演出总倒计时（秒）
  cueHoldTime: 2.5,        // 每段追光需要覆盖的累计时长（秒）
  cueCount: 5,
  coneHalfAngle: 14,       // 光锥半角（度）
  fullHitBrightness: 0.8,  // 完全命中（强光）阈值
  coverBrightness: 0.3,    // 覆盖所需最低亮度
  aimSpeed: 42,            // 转向速度（度/秒）
  aimMin: -75,
  aimMax: 75,
  brightnessSpeed: 0.6,    // 亮度变化速度（/秒）
  heatSpeed: 34,           // 持续转动升温（/秒）
  coolSpeed: 22,           // 停转散热（/秒）
  overheatAt: 100,
  resumeAt: 45,            // 过热后降到该温度才能恢复转动
  warnLimit: 3,            // 警告达到该次数即演出失败
  doubleHitCooldown: 1.2,  // 双演员完全命中警告冷却（秒）
  missGrace: 0.8,          // 进入未覆盖状态的宽限期（秒）
  holdDecay: 0.8,          // 未覆盖时保持进度的衰减速度（秒/秒）
};

// 五段追光：每段两名演员的位置角度与需要覆盖的目标演员。
export const CUES = [
  { id: 0, name: '第一段 · 定点独白', angles: [-50, 30], target: 0 },
  { id: 1, name: '第二段 · 对手戏', angles: [-25, 20], target: 1 },
  { id: 2, name: '第三段 · 双人近景', angles: [-8, 8], target: 0 },
  { id: 3, name: '第四段 · 双人近景', angles: [-8, 8], target: 1 },
  { id: 4, name: '第五段 · 谢幕定格', angles: [-40, 45], target: 1 },
];

export const ROLE = {
  DIRECTION: 'direction',
  BRIGHTNESS: 'brightness',
};

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// 方向角色由哪一侧控制台控制（swapIndex 偶数：左侧）。
export function directionSide(swapIndex) {
  return swapIndex % 2 === 0 ? 0 : 1;
}

export function brightnessSide(swapIndex) {
  return 1 - directionSide(swapIndex);
}

export class Game {
  constructor(config = CONFIG) {
    this.config = config;
    this.reset();
  }

  reset() {
    const c = this.config;
    this.phase = 'idle'; // idle | running | paused | success | failed
    this.timeLeft = c.duration;
    this.elapsed = 0;
    this.aim = 0;
    this.brightness = 0.15;
    this.heat = 0;
    this.overheated = false;
    this.warnings = 0;
    this.swapIndex = 0;
    this.debugMode = false;
    this.cueIndex = 0;
    this.cueProgress = 0;
    this.cueTouched = false;
    this.missTimer = 0;
    this.doubleHitCooldown = 0;
    this.totalHits = 0;
    this.missCount = 0;
    this.conflictCount = 0;
    // 物理输入：每侧 { left, right, up, down }，true = 按住。
    this.inputs = [
      { left: false, right: false, up: false, down: false },
      { left: false, right: false, up: false, down: false },
    ];
    this.lastCoverage = { covered: false, fullA: false, fullB: false };
    this.events = [];
    return this.getState();
  }

  start() {
    if (this.phase === 'idle' || this.phase === 'paused') {
      this.phase = 'running';
      this._emit('resume', {});
    }
  }

 togglePause() {
    if (this.phase === 'running') {
      this.phase = 'paused';
      this._emit('pause', {});
    } else if (this.phase === 'paused') {
      this.phase = 'running';
      this._emit('resume', {});
    }
  }

  restart() {
    this.reset();
    this.phase = 'running';
    this._emit('restart', {});
    this._emit('resume', {});
    return this.getState();
  }

  swapSides() {
    this.swapIndex += 1;
    this._emit('swap', { swapIndex: this.swapIndex });
  }

  toggleDebug() {
    this.debugMode = !this.debugMode;
    this._emit('debug', { debugMode: this.debugMode });
  }

  setInput(side, key, pressed) {
    if (side !== 0 && side !== 1) return;
    if (!(key in this.inputs[side])) return;
    this.inputs[side][key] = !!pressed;
  }

  _emit(type, data) {
    this.events.push({ t: Number(this.elapsed.toFixed(3)), type, ...data });
  }

  _roleInputs() {
    const dirSide = directionSide(this.swapIndex);
    const briSide = 1 - dirSide;
    const dir = this.debugMode
      ? mergeSides(this.inputs[0], this.inputs[1])
      : this.inputs[dirSide];
    const bri = this.debugMode
      ? mergeSides(this.inputs[0], this.inputs[1])
      : this.inputs[briSide];
    return { dir, bri, dirSide, briSide };
  }

  // 当前段目标演员的角度。
  targetAngle() {
    const cue = CUES[this.cueIndex];
    return cue.angles[cue.target];
  }

  _coverage() {
    const c = this.config;
    const cue = CUES[this.cueIndex];
    const targetAngle = cue.angles[cue.target];
    const targetCovered =
      Math.abs(this.aim - targetAngle) <= c.coneHalfAngle &&
      this.brightness >= c.coverBrightness;
    const full = cue.angles.map(
      (a) =>
        Math.abs(this.aim - a) <= c.coneHalfAngle &&
        this.brightness >= c.fullHitBrightness
    );
    return { targetCovered, fullA: full[0], fullB: full[1] };
  }

  step(rawDt) {
    if (this.phase !== 'running') return this.getState();
    const c = this.config;
    const dt = Math.max(0, Math.min(rawDt, 0.1));
    const { dir, bri } = this._roleInputs();

    this.elapsed += dt;
    this.timeLeft = Math.max(0, c.duration - this.elapsed);
    if (this.doubleHitCooldown > 0) {
      this.doubleHitCooldown = Math.max(0, this.doubleHitCooldown - dt);
    }

    // 方向职责：灯架转动与热量。
    const rotate = (dir.right ? 1 : 0) - (dir.left ? 1 : 0);
    if (rotate !== 0 && !this.overheated) {
      this.aim = clamp(this.aim + rotate * c.aimSpeed * dt, c.aimMin, c.aimMax);
      this.heat = clamp(this.heat + c.heatSpeed * dt, 0, c.overheatAt);
      if (this.heat >= c.overheatAt && !this.overheated) {
        this.overheated = true;
        this.conflictCount += 1;
        this._emit('overheat', { heat: this.heat });
      }
    } else {
      this.heat = clamp(this.heat - c.coolSpeed * dt, 0, c.overheatAt);
      if (this.overheated && this.heat <= c.resumeAt) {
        this.overheated = false;
        this._emit('recover', { heat: this.heat });
      }
    }

    // 亮度职责。
    const bright = (bri.up ? 1 : 0) - (bri.down ? 1 : 0);
    if (bright !== 0) {
      this.brightness = clamp(
        this.brightness + bright * c.brightnessSpeed * dt,
        0,
        1
      );
    }

    // 双演员完全命中警告。
    const cov = this._coverage();
    if (
      cov.fullA &&
      cov.fullB &&
      this.doubleHitCooldown === 0
    ) {
      this.warnings += 1;
      this.conflictCount += 1;
      this.doubleHitCooldown = c.doubleHitCooldown;
      this._emit('doubleHit', { warnings: this.warnings });
      if (this.warnings >= c.warnLimit) {
        this.phase = 'failed';
        this._emit('fail', { reason: 'warnings' });
        return this.getState();
      }
    }

    // 当前段覆盖判定与保持进度。
    if (cov.targetCovered) {
      this.missTimer = 0;
      if (!this.cueTouched) {
        this.cueTouched = true;
        this.totalHits += 1;
      }
      this.cueProgress = clamp(this.cueProgress + dt, 0, c.cueHoldTime);
      if (this.cueProgress >= c.cueHoldTime) {
        this._emit('cueComplete', { cueIndex: this.cueIndex });
        this.cueIndex += 1;
        this.cueProgress = 0;
        this.cueTouched = false;
        this.missTimer = 0;
        if (this.cueIndex >= c.cueCount) {
          this.phase = 'success';
          this._emit('success', {});
          return this.getState();
        }
      }
    } else {
      if (this.cueTouched) {
        this.missTimer += dt;
        this.cueProgress = Math.max(0, this.cueProgress - c.holdDecay * dt);
      }
      if (
        this.cueTouched &&
        this.missTimer >= c.missGrace &&
        this.missTimer - dt < c.missGrace
      ) {
        this.missCount += 1;
        this._emit('miss', {
          cueIndex: this.cueIndex,
          aim: Number(this.aim.toFixed(2)),
          brightness: Number(this.brightness.toFixed(2)),
        });
      }
    }

    this.lastCoverage = cov;

    if (this.timeLeft <= 0) {
      this.phase = 'failed';
      this._emit('fail', { reason: 'timeout' });
    }
    return this.getState();
  }

  getState() {
    const c = this.config;
    return {
      phase: this.phase,
      timeLeft: this.timeLeft,
      elapsed: this.elapsed,
      aim: this.aim,
      brightness: this.brightness,
      heat: this.heat,
      overheated: this.overheated,
      warnings: this.warnings,
      warnLimit: c.warnLimit,
      swapIndex: this.swapIndex,
      debugMode: this.debugMode,
      cueIndex: this.cueIndex,
      cueCount: c.cueCount,
      cueProgress: this.cueProgress,
      cueHoldTime: c.cueHoldTime,
      missCount: this.missCount,
      conflictCount: this.conflictCount,
      targetAngle: this.cueIndex < c.cueCount ? this.targetAngle() : null,
      coverage: { ...this.lastCoverage },
      events: this.events,
      inputs: this.inputs.map((s) => ({ ...s })),
    };
  }

  // 每个控制台看到的"我的仪表 / 队友仪表"视图，验证共享状态同步。
  getRoleView() {
    const dirSide = directionSide(this.swapIndex);
    return {
      direction: {
        side: dirSide,
        aim: this.aim,
        heat: this.heat,
        overheated: this.overheated,
      },
      brightness: {
        side: 1 - dirSide,
        brightness: this.brightness,
        warnings: this.warnings,
      },
      shared: {
        phase: this.phase,
        timeLeft: this.timeLeft,
        cueIndex: this.cueIndex,
        cueProgress: this.cueProgress,
        conflictCount: this.conflictCount,
      },
    };
  }
}

function mergeSides(a, b) {
  return {
    left: a.left || b.left,
    right: a.right || b.right,
    up: a.up || b.up,
    down: a.down || b.down,
  };
}
