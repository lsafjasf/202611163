import { AssemblyApp } from './app.js';

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const app = new AssemblyApp(canvas);
app.start();

const labels = {
  coop: '协作模式',
  debug: '单人调试模式',
  victory: '任务成功',
  defeat: '任务失败'
};

function refreshStatus() {
  const s = app.state;
  const side = s.swapped ? '玩家1→右侧模块 / 玩家2→左侧夹具' : '玩家1→左侧夹具 / 玩家2→右侧模块';
  status.textContent =
    `${labels[s.mode] || s.mode} · ${side} · 音频 ${app.audio.enabled ? '开' : '关'}${s.paused ? ' · 已暂停' : ''}`;
  requestAnimationFrame(refreshStatus);
}
refreshStatus();

globalThis.__assemblyApp = app;
