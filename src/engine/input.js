import { CONFIG } from './config.js';

// 物理按键集合 -> 逻辑工位输入。工位固定在左右，玩家通过 swapped 换边。
// 调试模式下单人可同时操作两个工位；协作模式下每人只能动自己的工位。
export function mapInput(keys, swapped = false, debug = false) {
  const k = CONFIG.keymap;
  const has = (code) => keys.has(code);
  const input = {
    clampUp: false,
    clampDown: false,
    moduleLeft: false,
    moduleRight: false,
    modulePressHeld: false
  };

  const readClamp = (group) => {
    input.clampUp = input.clampUp || has(group.up);
    input.clampDown = input.clampDown || has(group.down);
  };
  const readModule = (group) => {
    input.moduleLeft = input.moduleLeft || has(group.left);
    input.moduleRight = input.moduleRight || has(group.right);
    input.modulePressHeld = input.modulePressHeld || has(group.press);
  };

  if (debug) {
    readClamp(k.p1Clamp);
    readModule(k.p1Module);
    return input;
  }

  if (!swapped) {
    readClamp(k.p1Clamp);   // 玩家 1 -> 左：夹具
    readModule(k.p2Module); // 玩家 2 -> 右：模块
  } else {
    readModule(k.p1Module); // 玩家 1 -> 右：模块
    readClamp(k.p2Clamp);   // 玩家 2 -> 左：夹具
  }
  return input;
}

// 基于上一帧按键集合计算压装按钮的“按下沿”，避免长按重复触发。
export function withEdges(input, prevInput) {
  input.modulePressPressed =
    input.modulePressHeld && !(prevInput && prevInput.modulePressHeld);
  return input;
}
