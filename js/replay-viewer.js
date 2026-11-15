/* 回放查看器：时间轴播放、冲突时刻列表跳转。
   用 Renderer 以“虚拟筏体”重放快照帧，画面与实时游戏一致。 */
(function (root, factory) {
  const mod = factory();
  if (typeof RG_BROWSER !== 'undefined' && RG_BROWSER) { root.RG = root.RG || {}; Object.assign(root.RG, mod); }
  else if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.RG = Object.assign(root.RG || {}, mod);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ReplayViewer = {
    mountLibrary(container, records, renderer) {
      container.innerHTML = '';
      if (!records.length) {
        container.innerHTML = '<p class="empty">暂无回放。完成一局（成功或失败）后会自动保存。</p>';
        return;
      }
      records.forEach((record, idx) => {
        const row = document.createElement('div');
        row.className = 'replay-row';
        const moments = RG.conflictMoments(record);
        row.innerHTML =
          '<span class="replay-title">#' + (idx + 1) + ' '
          + (record.result === 'won' ? '成功' : '失败') + ' · ' + record.mode
          + '</span><span class="replay-meta">' + record.duration.toFixed(1) + 's · '
          + moments.length + ' 个冲突时刻 · ' + record.startedAt.replace('T', ' ').slice(0, 19)
          + '</span>';
        const btn = document.createElement('button');
        btn.className = 'btn btn-primary';
        btn.textContent = '查看';
        btn.addEventListener('click', () => ReplayViewer.mount(container, record, renderer));
        row.appendChild(btn);
        container.appendChild(row);
      });
    },

    mount(container, record, renderer) {
      container.innerHTML = '';
      const moments = RG.conflictMoments(record);
      const wrap = document.createElement('div');
      wrap.className = 'replay-player';
      wrap.innerHTML =
        '<div class="replay-summary">'
        + (record.result === 'won' ? '✅ 成功' : '❌ 失败')
        + ' · 用时 ' + record.duration.toFixed(1) + 's · 冲突 ' + moments.length
        + ' 次 · 种子 ' + record.seed + '</div>'
        + '<div class="replay-controls">'
        + '<button class="btn" data-act="play">播放</button>'
        + '<button class="btn" data-act="pause">暂停</button>'
        + '<input class="scrub" type="range" min="0" max="' + record.duration.toFixed(2)
        + '" step="0.05" value="0" />'
        + '<span class="scrub-time">0.00 / ' + record.duration.toFixed(2) + ' s</span></div>'
        + '<div class="moment-list"></div>';
      container.appendChild(wrap);

      const scrub = wrap.querySelector('.scrub');
      const timeLabel = wrap.querySelector('.scrub-time');
      const list = wrap.querySelector('.moment-list');
      moments.slice(0, 40).forEach((m) => {
        const chip = document.createElement('button');
        chip.className = 'moment-chip ' + (m.kind.indexOf('撞击') >= 0 ? 'chip-hit' : 'chip-conflict');
        chip.textContent = m.t.toFixed(1) + 's ' + m.kind + (m.side ? '·' + (m.side === 'left' ? '左' : '右') : '');
        chip.addEventListener('click', () => {
          playing = false;
          showAt(m.t);
          scrub.value = m.t;
        });
        list.appendChild(chip);
      });

      // 用与实时游戏相同的世界重建上下文
      const world = RG.createWorld(record.seed);
      let playing = true;
      let clock = 0;
      let last = performance.now();

      function showAt(t) {
        const frame = RG.frameAt(record, Math.min(t, record.duration));
        const raft = frame.full ? frame.raft : {
          x: frame.x, y: frame.y, heading: frame.h,
          vx: 0, vy: 0, omega: 0, hull: 3,
          stamina: { left: 100, right: 100 },
          strokeRate: { left: 0, right: 0 },
          passengers: 3, delivered: record.result === 'won' ? 3 : 0,
          invuln: 0
        };
        const fakeSync = { level: typeof frame.s === 'number' ? frame.s : (frame.sync || 1) };
        renderer.draw(world, raft, fakeSync, frame.trail || [], 0);
        timeLabel.textContent = t.toFixed(2) + ' / ' + record.duration.toFixed(2) + ' s';
      }

      function tick(now) {
        if (!document.body.contains(wrap) || !container.contains(wrap)) return;
        const dt = (now - last) / 1000;
        last = now;
        if (playing) {
          clock = Math.min(record.duration, clock + dt);
          scrub.value = clock;
          showAt(clock);
          if (clock >= record.duration) playing = false;
        }
        requestAnimationFrame(tick);
      }
      scrub.addEventListener('input', () => { playing = false; showAt(parseFloat(scrub.value)); });
      wrap.querySelector('[data-act="play"]').addEventListener('click', () => {
        if (clock >= record.duration) clock = 0;
        playing = true; last = performance.now();
      });
      wrap.querySelector('[data-act="pause"]').addEventListener('click', () => { playing = false; });
      showAt(0);
      requestAnimationFrame(tick);
    }
  };

  return { ReplayViewer };
});
