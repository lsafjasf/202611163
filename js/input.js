/* 键盘输入：Set 跟踪按下状态，天然支持两人同时按键（无 ghosting 时）。
   维护“玩家 -> 控制侧”映射，支持 T 键轮换左右职责。
   划水是离散事件：keydown 且非重复时触发一次。 */
(function (root, factory) {
  const mod = factory();
  if (typeof RG_BROWSER !== 'undefined' && RG_BROWSER) { root.RG = root.RG || {}; Object.assign(root.RG, mod); }
  else if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.RG = Object.assign(root.RG || {}, mod);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_BINDINGS = {
    p1: { forward: 'KeyW', reverse: 'KeyS' },
    p2: { forward: 'ArrowUp', reverse: 'ArrowDown' },
    debug: { both: 'KeyB', leftOnly: 'KeyQ', rightOnly: 'KeyE' }
  };

  class InputManager {
    constructor(target) {
      this.held = new Set();
      this.queue = [];                 // 本帧待处理的离散划水事件
      this.bindings = DEFAULT_BINDINGS;
      // p1Side / p2Side：玩家实际负责的桨侧
      this.p1Side = 'left';
      this.debugMode = false;
      this._onKeyDown = (e) => this._handleDown(e);
      this._onKeyUp = (e) => this._handleUp(e);
      if (target) this.attach(target);
    }

    attach(target) {
      target.addEventListener('keydown', this._onKeyDown);
      target.addEventListener('keyup', this._onKeyUp);
    }

    detach(target) {
      target.removeEventListener('keydown', this._onKeyDown);
      target.removeEventListener('keyup', this._onKeyUp);
    }

    _handleDown(e) {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault();
      }
      if (e.repeat) return;
      this.held.add(e.code);
      this._routeKey(e.code, false);
    }

    _handleUp(e) {
      this.held.delete(e.code);
    }

    /* 将物理键映射为 {player, side, reverse} 划水意图并入队。
       调试模式下一个人可通过 B/Q/E 控制双侧。 */
    _routeKey(code, reverse) {
      const b = this.bindings;
      if (!this.debugMode) {
        if (code === b.p1.forward) this.queue.push({ player: 1, side: this.p1Side, reverse: false });
        else if (code === b.p1.reverse) this.queue.push({ player: 1, side: this.p1Side, reverse: true });
        else if (code === b.p2.forward) this.queue.push({ player: 2, side: this.otherSide(this.p1Side), reverse: false });
        else if (code === b.p2.reverse) this.queue.push({ player: 2, side: this.otherSide(this.p1Side), reverse: true });
      } else {
        if (code === b.debug.both) {
          this.queue.push({ player: 0, side: 'left', reverse: false });
          this.queue.push({ player: 0, side: 'right', reverse: false });
        } else if (code === b.debug.leftOnly) this.queue.push({ player: 0, side: 'left', reverse: false });
        else if (code === b.debug.rightOnly) this.queue.push({ player: 0, side: 'right', reverse: false });
        else if (code === b.p1.forward) this.queue.push({ player: 0, side: this.p1Side, reverse: false });
        else if (code === b.p2.forward) this.queue.push({ player: 0, side: this.otherSide(this.p1Side), reverse: false });
      }
    }

    otherSide(side) { return side === 'left' ? 'right' : 'left'; }

    /* 轮换：两个玩家交换控制侧，任何一侧玩家都无法单独控制两支桨。 */
    swapSides() {
      this.p1Side = this.otherSide(this.p1Side);
      return { p1: this.p1Side, p2: this.otherSide(this.p1Side) };
    }

    setDebugMode(on) { this.debugMode = !!on; }

    clear() {
      this.held.clear();
      this.queue.length = 0;
    }

    drainQueue() {
      const q = this.queue;
      this.queue = [];
      return q;
    }

    isHeld(code) { return this.held.has(code); }
  }

  return { InputManager, DEFAULT_BINDINGS };
});
