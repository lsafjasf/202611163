/* 浏览器版自测：复用与 Node 完全相同的 selftest 场景，
   在抽屉中渲染通过/失败报告，并把生成的回放加入回放库。 */
(function (root, factory) {
  const mod = factory();
  if (typeof RG_BROWSER !== 'undefined' && RG_BROWSER) { root.RG = root.RG || {}; Object.assign(root.RG, mod); }
  else if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.RG = Object.assign(root.RG || {}, mod);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SelfTestUi = {
    run(container, drawer) {
      drawer.hidden = false;
      document.getElementById('drawer-title').textContent = '协作验收自测';
      container.innerHTML = '<p class="empty">正在运行确定性场景，请稍候…</p>';

      // 让浏览器先渲染提示，再执行同步计算
      setTimeout(() => {
        const reports = SelfTestUi._collect();
        SelfTestUi._render(container, reports);
      }, 30);
    },

    _collect() {
      const C = RG.CONFIG;
      const ST = RG;
      const reports = [];
      const assert = (scenario, name, cond, detail) =>
        reports.push({ scenario, name, pass: !!cond, detail: detail || '' });

      const s1 = ST.runScenario({ seed: ST.WIN_SEED });
      assert('S1 协作成功', '双人配合送达 3 名乘客', s1.ctx.status === 'won',
        'status=' + s1.ctx.status);
      assert('S1 协作成功', '双侧仪表与任务进度同步',
        s1.ctx.raft.delivered === 3 && s1.ctx.sync.level >= C.SYNC_BAD,
        'delivered=' + s1.ctx.raft.delivered + ' sync=' + s1.ctx.sync.level.toFixed(2));

      const s2l = ST.runScenario({ seed: 777, phases: [{ until: Infinity, kind: 'oneSide', side: 'left' }] });
      const s2r = ST.runScenario({ seed: 777, phases: [{ until: Infinity, kind: 'oneSide', side: 'right' }] });
      assert('S2 单侧失误', '左桨独占操作失败且记录冲突',
        s2l.ctx.status === 'lost' && s2l.ctx.sync.conflicts > 0,
        'conflicts=' + s2l.ctx.sync.conflicts);
      assert('S2 单侧失误', '右桨独占操作失败且记录冲突',
        s2r.ctx.status === 'lost' && s2r.ctx.sync.conflicts > 0,
        'conflicts=' + s2r.ctx.sync.conflicts);

      const s3 = ST.runScenario({
        seed: ST.WIN_SEED,
        phases: [{ until: 6, kind: 'idle', activeSide: 'right' },
          { until: Infinity, kind: 'coop' }]
      });
      assert('S3 失误恢复', '单侧停划 6 秒后恢复协作并成功',
        s3.ctx.status === 'won' && s3.conflictTimes.length > 0,
        'conflictMoments=' + s3.conflictTimes.length);

      const s4 = ST.runScenario({
        seed: ST.WIN_SEED,
        initialSides: { p1: 'right', p2: 'left' },
        swapLog: [{ t: 0, from: 'left', to: 'right' }]
      });
      assert('S4 控制轮换', '交换控制侧后相同任务仍完成', s4.ctx.status === 'won',
        'status=' + s4.ctx.status);

      const fresh = RG.createRunContext(ST.WIN_SEED);
      assert('S5 完全复位', '倒计时/耐久/体力/桨频/同步全部归零',
        fresh.time === 0 && fresh.raft.hull === C.HULL_MAX
          && fresh.raft.stamina.left === C.STAMINA_MAX
          && fresh.raft.strokeRate.left === 0 && fresh.sync.conflicts === 0,
        'timer=0 hull=' + fresh.raft.hull);

      assert('S6 完整回放', '回放含帧序列与冲突时刻',
        s3.record.frames.length > 0 && RG.conflictMoments(s3.record).length > 0,
        'frames=' + s3.record.frames.length);

      // 持久化一份恢复场景的完整回放
      RG.ReplayStore.save(s3.record);
      return reports;
    },

    _render(container, reports) {
      container.innerHTML = '';
      const passed = reports.filter((r) => r.pass).length;
      const summary = document.createElement('div');
      summary.className = 'test-summary ' + (passed === reports.length ? 'all-pass' : 'has-fail');
      summary.textContent = passed + '/' + reports.length + ' 项通过';
      container.appendChild(summary);
      for (const r of reports) {
        const row = document.createElement('div');
        row.className = 'test-row ' + (r.pass ? 'pass' : 'fail');
        row.innerHTML = '<b>' + (r.pass ? 'PASS' : 'FAIL') + '</b> '
          + r.scenario + ' · ' + r.name
          + (r.detail ? ' <span class="test-detail">' + r.detail + '</span>' : '');
        container.appendChild(row);
      }
      const hint = document.createElement('p');
      hint.className = 'empty';
      hint.textContent = '恢复场景的完整回放已存入回放库，可在“回放”中查看每次冲突时刻。';
      container.appendChild(hint);
    }
  };

  return { SelfTestUi };
});
