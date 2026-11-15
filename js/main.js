/* 入口：装配所有模块，负责 HUD、覆盖层、抽屉式回放查看器与快捷键。 */
(function () {
  'use strict';
  const C = RG.CONFIG;

  const canvas = document.getElementById('game-canvas');
  const renderer = new RG.Renderer(canvas);
  const input = new RG.InputManager(window);
  const audio = new RG.AudioEngine();

  const el = (id) => document.getElementById(id);
  const ui = {
    flash(text, color) {
      const rgba = color.startsWith('#')
        ? 'rgba(' + parseInt(color.slice(1, 3), 16) + ','
          + parseInt(color.slice(3, 5), 16) + ',' + parseInt(color.slice(5, 7), 16) + ',ALPHA)'
        : color.replace(')', ',ALPHA)').replace('rgb', 'rgba');
      renderer.triggerFlash(text, rgba);
    },
    setOverlay(spec) {
      const overlay = el('overlay');
      if (!spec) { overlay.hidden = true; return; }
      overlay.hidden = false;
      el('ov-title').textContent = spec.title;
      el('ov-body').innerHTML = spec.body;
      const actions = el('ov-actions');
      actions.innerHTML = '';
      for (const action of spec.actions) {
        const btn = document.createElement('button');
        btn.className = 'btn btn-primary';
        btn.textContent = action.label;
        btn.addEventListener('click', () => action.fn());
        actions.appendChild(btn);
      }
    },
    updateSideTags(sides) {
      el('p1-side').textContent = sides.p1 === 'left' ? '左桨' : '右桨';
      el('p2-side').textContent = sides.p2 === 'left' ? '左桨' : '右桨';
      el('p1-keys').textContent = 'W 前进划 / S 反向划（负责'
        + (sides.p1 === 'left' ? '左桨' : '右桨') + '）';
      el('p2-keys').textContent = '↑ 前进划 / ↓ 反向划（负责'
        + (sides.p2 === 'left' ? '左桨' : '右桨') + '）';
    },
    updateHud(ctx, inputMgr, paused) {
      const r = ctx.raft;
      const p1Side = inputMgr.p1Side;
      const p2Side = inputMgr.otherSide(p1Side);
      el('p1-rate').textContent = r.strokeRate[p1Side].toFixed(2) + ' 次/秒';
      el('p2-rate').textContent = r.strokeRate[p2Side].toFixed(2) + ' 次/秒';
      el('p1-stamina').style.width = r.stamina[p1Side] + '%';
      el('p2-stamina').style.width = r.stamina[p2Side] + '%';
      el('sh-timer').textContent = Math.max(0, C.TIME_LIMIT - ctx.time).toFixed(1) + ' s';
      el('sh-hull').style.width = (r.hull / C.HULL_MAX * 100) + '%';
      el('sh-sync').style.width = (ctx.sync.level * 100) + '%';
      const progress = Math.max(0, Math.min(1,
        (r.y - ctx.world.startY) / (ctx.world.goalY - ctx.world.startY)));
      el('sh-progress').textContent = Math.round(progress * 100) + '%';
      el('sh-passengers').textContent = r.delivered + ' / 3 已送达';
      el('sh-status').textContent = paused ? '暂停中'
        : ctx.status === 'won' ? '成功'
          : ctx.status === 'lost' ? '失败' : (inputMgr.debugMode ? '单人调试' : '航行中');
      el('btn-debug').classList.toggle('btn-on', inputMgr.debugMode);
      el('btn-pause').classList.toggle('btn-on', paused);
    },
    openReplay(record) {
      el('drawer').hidden = false;
      RG.ReplayViewer.mount(el('drawer-body'), record, renderer);
    }
  };

  const game = new RG.Game({
    CONFIG: C, Physics: RG, renderer, input, audio, ui,
    Recorder: RG.Recorder, ReplayStore: RG.ReplayStore
  });

  // 快捷键
  window.addEventListener('keydown', (e) => {
    audio.ensure();
    if (e.code === 'Space') game.togglePause();
    else if (e.code === 'KeyR') game.restart();
    else if (e.code === 'KeyT') game.swapSides();
    else if (e.code === 'KeyD') game.toggleDebug();
    else if (e.code === 'KeyF') renderer.setDebug(!renderer.debug);
    else if (e.code === 'KeyM') el('btn-mute').textContent = audio.toggleMute() ? '音效关 (M)' : '音效 (M)';
  });
  el('btn-pause').addEventListener('click', () => game.togglePause());
  el('btn-restart').addEventListener('click', () => game.restart());
  el('btn-swap').addEventListener('click', () => game.swapSides());
  el('btn-debug').addEventListener('click', () => game.toggleDebug());
  el('btn-mute').addEventListener('click', function () {
    audio.ensure();
    this.textContent = audio.toggleMute() ? '音效关 (M)' : '音效 (M)';
  });
  el('btn-drawer-close').addEventListener('click', () => { el('drawer').hidden = true; });
  el('btn-replay').addEventListener('click', () => {
    const list = RG.ReplayStore.list();
    el('drawer').hidden = false;
    el('drawer-title').textContent = '回放库（最近 ' + list.length + ' 份完整回放）';
    RG.ReplayViewer.mountLibrary(el('drawer-body'), list, renderer);
  });
  el('btn-selftest').addEventListener('click', () => RG.SelfTestUi.run(el('drawer-body'), el('drawer')));

  ui.setOverlay({
    title: '双人皮筏协作渡河',
    body: '两人各控一侧船桨，节奏一致才能直行。水流会把筏子推向礁石，'
      + '三名乘客全部送达对岸即胜利。<br/>玩家1：W/S · 玩家2：↑/↓（可按 T 交换左右职责）',
    actions: [{
      label: '开始航行',
      fn: () => { audio.ensure(); ui.setOverlay(null); game.paused = false; }
    }]
  });
  window.addEventListener('resize', () => {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 900;
    const h = canvas.clientHeight || 600;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const g = canvas.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.scale(dpr, dpr);
    renderer.width = w;
    renderer.height = h;
  });
  requestAnimationFrame((t) => { game.lastTs = t; game.frame(t); });
})();
