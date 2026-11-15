// 键盘输入：两套物理控制台各自独立，允许同时按键。
// 左侧：W/A/S/D；右侧：方向键。动作键：P 暂停、R 重开、T 轮换、G 单人调试。

export const KEY_BINDINGS = {
  side0: {
    KeyA: 'left',
    KeyD: 'right',
    KeyW: 'up',
    KeyS: 'down',
  },
  side1: {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'up',
    ArrowDown: 'down',
  },
};

const ACTION_KEYS = {
  KeyP: 'pause',
  Space: 'pause',
  KeyR: 'restart',
  KeyT: 'swap',
  KeyG: 'debug',
};

const PREVENT_CODES = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space',
]);

export class KeyboardInput {
  constructor() {
    this.pressed = [
      { left: false, right: false, up: false, down: false },
      { left: false, right: false, up: false, down: false },
    ];
    this._onAction = () => {};
    this._onPhysical = () => {};
    this._downHandler = (e) => this._handleDown(e);
    this._upHandler = (e) => this._handleUp(e);
  }

  attach() {
    window.addEventListener('keydown', this._downHandler);
    window.addEventListener('keyup', this._upHandler);
  }

  detach() {
    window.removeEventListener('keydown', this._downHandler);
    window.removeEventListener('keyup', this._upHandler);
  }

  onAction(fn) {
    this._onAction = fn;
  }

  // 物理按键变化回调（用于录制回放）：(side, key, pressed)
  onPhysical(fn) {
    this._onPhysical = fn;
  }

  _lookup(code) {
    if (code in KEY_BINDINGS.side0) return { side: 0, key: KEY_BINDINGS.side0[code] };
    if (code in KEY_BINDINGS.side1) return { side: 1, key: KEY_BINDINGS.side1[code] };
    return null;
  }

  _handleDown(e) {
    if (PREVENT_CODES.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    const bound = this._lookup(e.code);
    if (bound) {
      this.pressed[bound.side][bound.key] = true;
      this._onPhysical(bound.side, bound.key, true);
      return;
    }
    const action = ACTION_KEYS[e.code];
    if (action) this._onAction(action);
  }

  _handleUp(e) {
    if (PREVENT_CODES.has(e.code)) e.preventDefault();
    const bound = this._lookup(e.code);
    if (bound) {
      this.pressed[bound.side][bound.key] = false;
      this._onPhysical(bound.side, bound.key, false);
    }
  }

  reset() {
    this.pressed.forEach((side) => {
      side.left = side.right = side.up = side.down = false;
    });
  }
}
