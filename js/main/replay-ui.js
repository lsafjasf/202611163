// 回放面板：列表、播放控制、冲突跳转、JSON 导出。
import { Renderer } from '../renderer.js';
import { ReplayPlayer, conflictMoments } from '../replay.js';

const $ = (id) => document.getElementById(id);

export function initReplays(store) {
  const canvas = $('replay-canvas');
  const renderer = new Renderer(canvas);
  renderer.resize();

  const session = {
    player: null,
    replay: null,
    playing: false,
    raf: 0,
    lastTs: 0,
  };

  $('replay-close').onclick = () => {
    $('replay-modal').classList.add('hidden');
    session.playing = false;
  };

  $('rp-play').onclick = () => {
    if (!session.player) return;
    session.playing = true;
    session.lastTs = 0;
  };
  $('rp-pause').onclick = () => {
    session.playing = false;
  };

  $('rp-seek').oninput = (e) => {
    if (!session.player || !session.replay) return;
    session.playing = false;
    const t = (e.target.value / 1000) * session.replay.duration;
    renderAt(session, renderer, t);
  };

  $('replay-export').onclick = () => {
    if (!session.replay) return;
    const blob = new Blob([JSON.stringify(session.replay, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `replay-${session.replay.startedAt.replace(/[:.]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const tick = (ts) => {
    requestAnimationFrame(tick);
    if (!session.playing || !session.player) return;
    if (!session.lastTs) session.lastTs = ts;
    const dt = (ts - session.lastTs) / 1000;
    session.lastTs = ts;
    const t = Math.min(
      session.replay.duration,
      session.player.playTime + dt
    );
    renderAt(session, renderer, t);
    if (t >= session.replay.duration) session.playing = false;
  };
  requestAnimationFrame(tick);

  const btn = $('btn-replays');
  btn?.addEventListener('click', () => renderList(store, session, renderer));
  if (btn) renderList(store, session, renderer);
}

function renderList(store, session, renderer) {
  const ul = $('replay-list');
  ul.innerHTML = '';
  const replays = store.list();
  if (replays.length === 0) {
    ul.innerHTML = '<li>暂无回放，完成或失败一场演出后自动保存。</li>';
    return;
  }
  replays.forEach((replay, i) => {
    const li = document.createElement('li');
    if (session.replay === replay) li.classList.add('selected');
    const r = replay.result;
    li.innerHTML =
      `<strong>#${i + 1} ${r.phase === 'success' ? '成功' : '失败'}</strong><br>` +
      `${replay.mode === 'debug' ? '单人调试' : '双人协作'} · 段落 ${r.cuesDone}/5<br>` +
      `用时 ${replay.duration.toFixed(1)}s · 冲突 ${r.conflicts} · 失误 ${r.misses}<br>` +
      `<small>${new Date(replay.startedAt).toLocaleString()}</small>`;
    li.onclick = () => selectReplay(session, renderer, replay);
    ul.appendChild(li);
  });
}

function selectReplay(session, renderer, replay) {
  session.replay = replay;
  session.player = new ReplayPlayer(replay);
  session.playing = false;
  $('replay-title').textContent =
    `${replay.result.phase === 'success' ? '成功' : '失败'}回放 · ${replay.duration.toFixed(1)}s`;
  renderAt(session, renderer, 0);
  renderConflicts(session, renderer, replay);
  // 刷新选中高亮。
  document.querySelectorAll('#replay-list li').forEach((li) =>
    li.classList.remove('selected')
  );
}

function renderAt(session, renderer, time) {
  const state = session.player.seek(time);
  renderer.draw(state);
  $('rp-time').textContent =
    `${time.toFixed(1)}s / ${session.replay.duration.toFixed(1)}s`;
  $('rp-seek').value = Math.round(
    (time / session.replay.duration) * 1000
  );
}

function renderConflicts(session, renderer, replay) {
  const box = $('rp-conflicts');
  const moments = conflictMoments(replay);
  if (moments.length === 0) {
    box.innerHTML = '<span style="color:#46e08a">本场无冲突记录。</span>';
    return;
  }
  box.innerHTML = '<strong>冲突时刻（点击跳转）：</strong><br>';
  moments.forEach((m) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = `${m.label} @${m.t.toFixed(2)}s`;
    btn.onclick = () => {
      session.playing = false;
      // 冲突前 0.4 秒跳转，便于看到触发过程。
      renderAt(session, renderer, Math.max(0, m.t - 0.4));
    };
    box.appendChild(btn);
  });
}
