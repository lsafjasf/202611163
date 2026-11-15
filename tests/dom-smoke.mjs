// 浏览器接口桩：在无浏览器环境验证 UI 控制器的交互链路。
const handlers = new Map();
const elements = {};

function makeEl(id, value = '0') {
  return {
    id,
    value,
    checked: false,
    hidden: false,
    innerHTML: '',
    textContent: '',
    width: 640,
    height: 640,
    getContext: () =>
      new Proxy(
        {},
        {
          get: (t, prop) => {
            if (prop === 'canvas') return {};
            return typeof prop === 'string' ? () => {} : undefined;
          },
          set: () => true
        }
      ),
    addEventListener: (evt, fn) => handlers.set(`${id}:${evt}`, fn),
    click: () => {}
  };
}

const ids = [
  'mode', 'mass', 'secondMass', 'length', 'secondLength', 'angle', 'secondAngle',
  'damping', 'friction', 'play', 'pause', 'step', 'reset', 'audioToggle',
  'exportCsv', 'exportJson', 'replay', 'canvas', 'readouts', 'lastChange',
  'triggerBox', 'triggerMsg', 'status', 'sampleCount'
];
for (const id of ids) elements[id] = makeEl(id);
elements.mode.value = 'single';
elements.mass.value = '1';
elements.length.value = '1';
elements.angle.value = '45';
elements.damping.value = '0.2';

globalThis.window = { addEventListener: (e, fn) => handlers.set(`window:${e}`, fn) };
globalThis.document = {
  getElementById: (id) => elements[id],
  createElement: () => ({ click() {} })
};
globalThis.requestAnimationFrame = () => {};
globalThis.Blob = class {
  constructor(parts) {
    this.parts = parts;
  }
};
globalThis.URL = { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} };

const { PendulumApp } = await import('../src/ui/app.mjs');
const app = new PendulumApp();

let assertCount = 0;
const check = (cond, msg) => {
  if (!cond) throw new Error(msg);
  assertCount++;
};

handlers.get('play:click')();
check(app.runner.running === true, '运行后应为 running');
app.runner.tick();
const t1 = app.runner.time;
check(t1 > 0, 'tick 后时间应推进');

handlers.get('pause:click')();
check(app.runner.running === false, '暂停后应停止');
const framePaused = app.runner.currentFrame;
handlers.get('step:click')();
check(app.runner.running === false, '单步后仍应处于暂停');
check(app.runner.time > t1, '单步应推进一个显示帧');
check(app.runner.currentFrame !== framePaused, '单步后状态应更新');

handlers.get('replay:click')();
check(app.replay !== null, '回放应启动');

handlers.get('reset:click')();
check(app.runner.time === 0 && app.replay === null, '重置应归零并退出回放');
check(Math.abs(app.runner.currentFrame.theta - (45 * Math.PI) / 180) < 1e-15, '初始角不漂移');

// 极限工况触发并验证面板与导出。
elements.mass.value = '50';
elements.length.value = '1';
elements.angle.value = '150';
handlers.get('mass:change')();
app.runner.play();
app.runner.runSeconds(20);
check(app.runner.trigger !== null, '极限工况应触发限值');
app.updatePanel();
check(elements.triggerBox.hidden === false, '触发面板应显示');
const csv = app.runner.recorder.toCSV();
check(csv.split('\n')[0].startsWith('time_s'), 'CSV 表头正确');
check(app.runner.recorder.verifyContinuity().ok, '回放连续性通过');

console.log(`DOM 冒烟测试 ${assertCount} 项断言全部通过`);
