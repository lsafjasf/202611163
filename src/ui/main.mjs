import { PendulumApp } from './app.mjs';

// DOM 就绪后启动应用。
window.addEventListener('DOMContentLoaded', () => {
  window.pendulumApp = new PendulumApp();
});
