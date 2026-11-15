import { CONFIG } from '../engine/config.js';
import { mapInput, withEdges } from '../engine/input.js';

// 基于 Set 的并发键盘：同时按下任意数量按键都保留，
// preventDefault 阻止 Tab/方向键滚动页面。
export class InputController {
  constructor(target = globalThis) {
    this.keys = new Set();
    this.prevInput = null;
    this.actions = [];
    this.target = target;
    this._onDown = (event) => this.handleDown(event);
    this._onUp = (event) => this.keys.delete(event.code);
    this._onBlur = () => this.keys.clear();
  }

  attach() {
    this.target.addEventListener('keydown', this._onDown);
    this.target.addEventListener('keyup', this._onUp);
    this.target.addEventListener('blur', this._onBlur);
  }

  detach() {
    this.target.removeEventListener('keydown', this._onDown);
    this.target.removeEventListener('keyup', this._onUp);
    this.target.removeEventListener('blur', this._onBlur);
  }

  handleDown(event) {
    const sys = CONFIG.keymap.system;
    if (event.code === sys.swap ||
        event.code.startsWith('Arrow') ||
        event.code === 'Space' ||
        event.code === 'Enter') {
      event.preventDefault();
    }
    if (sys.pause.includes(event.code)) this.actions.push('pause');
    if (event.code === sys.restart) this.actions.push('restart');
    if (event.code === sys.swap) this.actions.push('swap');
    if (event.code === sys.debug) this.actions.push('debug');
    if (event.code === sys.replay) this.actions.push('replay');
    this.keys.add(event.code);
  }

  drainActions() {
    const queued = this.actions;
    this.actions = [];
    return queued;
  }

  sample(state) {
    const debug = state.mode === 'debug';
    const base = mapInput(this.keys, state.swapped, debug);
    const input = withEdges(base, this.prevInput);
    this.prevInput = { ...base };
    return input;
  }
}
