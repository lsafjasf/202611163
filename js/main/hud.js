// HUD：两台灯控台的仪表都从同一份共享状态渲染，天然保持同步。
import { directionSide } from '../engine.js';

const PHASE_TEXT = {
  idle: '待开始',
  running: '演出中',
  paused: '已暂停',
  success: '成功',
  failed: '失败',
};

const $ = (id) => document.getElementById(id);

export function syncHud(s) {
  $('hud-time').textContent = `${s.timeLeft.toFixed(1)}s`;
  $('hud-cue').textContent = `${s.cueIndex}/${s.cueCount}`;
  $('hud-warn').textContent = `${s.warnings}/${s.warnLimit}`;
  $('hud-conflict').textContent = String(s.conflictCount);
  $('hud-phase').textContent = PHASE_TEXT[s.phase] || s.phase;

  const dirSide = directionSide(s.swapIndex);
  const roleText = (side) => {
    if (s.debugMode) return '调试：全职责';
    return dirSide === side ? '职责：方向' : '职责：亮度';
  };
  $('role-0').textContent = roleText(0);
  $('role-1').textContent = roleText(1);
  $('console-0').classList.toggle(
    'active-role',
    s.debugMode || dirSide === 0
  );
  $('console-1').classList.toggle(
    'active-role',
    s.debugMode || dirSide === 1
  );
  $('btn-debug')?.classList.toggle('active', s.debugMode);
  $('btn-pause')?.classList.toggle('active', s.phase === 'paused');

  // 两台控制台显示完全相同的共享读数（各自标注职责）。
  for (const prefix of ['m0', 'm1']) {
    $(`${prefix}-aim`).textContent = `${s.aim.toFixed(0)}°`;
    $(`${prefix}-heat`).style.width = `${s.heat}%`;
    $(`${prefix}-bri`).style.width = `${s.brightness * 100}%`;
    $(`${prefix}-warn`).textContent = `${s.warnings}/${s.warnLimit}`;
  }
  // 过热时热量仪表转红。
  for (const id of ['m0-heat', 'm1-heat']) {
    $(id).style.background = s.overheated
      ? '#ff4433'
      : 'linear-gradient(90deg, #46b6ff, #ffd45e, #ff5a5a)';
  }
}

export function logEvent(kind, text) {
  const ul = $('event-log');
  if (!ul) return;
  const li = document.createElement('li');
  li.className =
    kind === 'conflict' ? 'ev-conflict'
    : kind === 'miss' ? 'ev-miss'
    : kind === 'good' ? 'ev-good'
    : '';
  li.textContent = text;
  ul.prepend(li);
  while (ul.children.length > 80) ul.lastChild.remove();
}
