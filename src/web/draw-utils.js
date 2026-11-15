export const COLORS = {
  bg: '#10141d',
  panel: '#1b2230',
  grid: '#2a3346',
  text: '#e8edf7',
  muted: '#8b97ad',
  ok: '#3ddc97',
  warn: '#ffd166',
  bad: '#ef476f',
  accent: '#4cc9f0',
  metal: '#9aa7bd'
};

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export function conflictLabel(type) {
  return {
    'unlocked-install': '夹具未锁稳就压装',
    'offset-install': '偏移超差强行压装',
    'round-timeout': '动作窗口超时',
    'gasket-crush': '压力过大压坏垫圈'
  }[type] || '未知冲突';
}
