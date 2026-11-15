// 无头自动玩家：操作“逻辑工位输入”，不依赖键盘/DOM。
// 机器人故意保留简单的反馈控制，方便构造成功与各类失误。
function blank() {
  return {
    clampUp: false,
    clampDown: false,
    moduleLeft: false,
    moduleRight: false,
    modulePressHeld: false,
    modulePressPressed: false
  };
}

// 每个工厂实例自带压装沿锁存，避免 node:test 并发用例互相串扰。
export function makeCooperativeBot(opts = {}) {
  let pressLatch = false;
  return function cooperativeInput(state) {
    const input = blank();
    const c = state.clamp;
    const m = state.module;
    const target = opts.pressureTarget ?? 0.585;
    if (c.pressure < target - 0.01) input.clampUp = true;
    if (c.pressure > target + 0.01) input.clampDown = true;
    if (m.offset > 0.03) input.moduleLeft = true;
    if (m.offset < -0.03) input.moduleRight = true;
    const wantPress =
      c.locked && Math.abs(m.offset) <= 0.2 && !opts.noPress &&
      state.round.phase === 'playing';
    input.modulePressHeld = wantPress;
    input.modulePressPressed = wantPress && !pressLatch;
    pressLatch = wantPress;
    return input;
  };
}

export function cooperativeInput(state, opts = {}) {
  const input = blank();
  const c = state.clamp;
  const m = state.module;

  // 夹具：把压力推向稳定区中部 0.585。
  const target = opts.pressureTarget ?? 0.585;
  if (c.pressure < target - 0.01) input.clampUp = true;
  if (c.pressure > target + 0.01) input.clampDown = true;

  // 模块：把偏移推回 0。
  if (m.offset > 0.03) input.moduleLeft = true;
  if (m.offset < -0.03) input.moduleRight = true;

  // 夹具锁稳且对准时压装。
  const wantPress =
    c.locked && Math.abs(m.offset) <= 0.2 && !opts.noPress &&
    state.round.phase === 'playing';
  input.modulePressHeld = wantPress;
  input.modulePressPressed = wantPress;
  return input;
}

export function clampOnlyInput(state) {
  const input = {
    clampUp: false,
    clampDown: false,
    moduleLeft: false,
    moduleRight: false,
    modulePressHeld: false,
    modulePressPressed: false
  };
  if (state.clamp.pressure < 0.58) input.clampUp = true;
  if (state.clamp.pressure > 0.6) input.clampDown = true;
  return input;
}

export function moduleOnlyInput(state) {
  const input = blank();
  if (state.module.offset > 0.03) input.moduleLeft = true;
  if (state.module.offset < -0.03) input.moduleRight = true;
  const wantPress = state.round.phase === 'playing';
  input.modulePressHeld = wantPress;
  input.modulePressPressed = wantPress;
  return input;
}

// 一直加压到压坏垫圈。
export function overPressureInput(state) {
  const input = blank();
  input.clampUp = true;
  return input;
}

// 制造“未锁稳就压装”的单侧失误：只动模块，夹具完全没人管。
export function makeModuleOnlyBot() {
  let pressLatch = false;
  return function moduleOnlyBot(state) {
    const input = blank();
    if (state.module.offset > 0.03) input.moduleLeft = true;
    if (state.module.offset < -0.03) input.moduleRight = true;
    const wantPress = state.round.phase === 'playing';
    input.modulePressHeld = wantPress;
    input.modulePressPressed = wantPress && !pressLatch;
    pressLatch = wantPress;
    return input;
  };
}
