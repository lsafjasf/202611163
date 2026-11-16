import { test, expect } from '@playwright/test';

const gotoApp = () => test.info().page.goto('/index.html');

test.describe('火柴人定格动画工作室', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => !!window.__studio);
  });

  test('默认工程包含 12 帧、两个场景，舞台与帧条均为 Canvas 绘制', async ({ page }) => {
    const state = await page.evaluate(() => window.__studio.getState());
    expect(state.project.scenes).toHaveLength(2);
    expect(state.project.scenes[0].frames).toHaveLength(12);
    expect(await page.locator('#stage').evaluate((el) => el.tagName)).toBe('CANVAS');
    expect(await page.locator('#strip').evaluate((el) => el.tagName)).toBe('CANVAS');
    expect(state.project.fps).toBe(12);
  });

  test('可拖动关节修改姿态并持久化到当前帧', async ({ page }) => {
    await page.evaluate(() => window.__studio.clock.seekToFrame(2));
    const before = await page.evaluate(() =>
      structuredClone(window.__studio.getState().project.scenes[0].frames[2].pose.head));
    const target = await page.evaluate(() => {
      const c = document.getElementById('stage');
      const r = c.getBoundingClientRect();
      const head = window.__studio.getState().project.scenes[0].frames[2].pose.head;
      return {
        startX: r.x + head.x / c.width * r.width,
        startY: r.y + head.y / c.height * r.height,
      };
    });
    await page.mouse.move(target.startX, target.startY);
    await page.mouse.down();
    await page.mouse.move(target.startX + 40, target.startY - 24, { steps: 4 });
    await page.mouse.up();
    const after = await page.evaluate(() =>
      structuredClone(window.__studio.getState().project.scenes[0].frames[2].pose.head));
    expect(after.x === before.x && after.y === before.y).toBe(false);

    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('stickframe.project.v1')));
    expect(stored.scenes[0].frames[2].pose.head).toEqual(after);
  });

  test('复制上一帧、删除帧与 12 帧上限', async ({ page }) => {
    // 显式重置，避免其他用例写入 localStorage 的姿态干扰本断言
    await page.evaluate(async () => {
      localStorage.clear();
      const { createDefaultProject } = await import('/src/model.js');
      const st = window.__studio.getState();
      st.project = createDefaultProject();
      window.__studio.clock.seekToFrame(0);
      window.__studio.renderAll();
    });
    await page.selectOption('#fpsSelect', '12');
    await page.evaluate(() => window.__studio.clock.seekToFrame(0));
    page.on('dialog', (d) => d.accept());
    // 默认工程为满 12 帧，先删一帧腾出位置
    await page.click('#deleteFrameBtn');
    // 跳到帧 3 再复制“上一帧”（帧 2），契约清晰
    await page.evaluate(() => window.__studio.clock.seekToFrame(3));
    const prevPose = await page.evaluate(() =>
      JSON.stringify(window.__studio.getState().project.scenes[0].frames[2].pose));
    await page.click('#duplicateBtn');
    let state = await page.evaluate(() => window.__studio.getState());
    expect(state.project.scenes[0].frames).toHaveLength(12);

    // 复制后当前帧即新插入帧，其姿态必须等于复制前的上一帧
    const frames = await page.evaluate(() =>
      window.__studio.getState().project.scenes[0].frames.map((f) => ({
        id: f.id, pose: JSON.stringify(f.pose),
      })));
    const current = state.currentFrame;
    expect(frames[current].pose).toBe(prevPose);
    expect(frames[current + 1].pose).not.toBe(prevPose);
    const ids = new Set(frames.map((f) => f.id));
    expect(ids.size).toBe(12);

    // 已经是 12 帧，新增必须被拒绝
    await page.evaluate(async () => {
      const st = window.__studio.getState();
      window.__studio.renderAll();
    });
    await page.click('#addFrameBtn');
    state = await page.evaluate(() => window.__studio.getState());
    expect(state.project.scenes[0].frames).toHaveLength(12);

    await page.click('#deleteFrameBtn');
    state = await page.evaluate(() => window.__studio.getState());
    expect(state.project.scenes[0].frames).toHaveLength(11);
  });

  test('8/12/24 fps 切换会同步改变总时长', async ({ page }) => {
    for (const fps of [8, 12, 24]) {
      await page.selectOption('#fpsSelect', String(fps));
      const label = await page.locator('#rangeLabel').textContent();
      const expected = (12 / fps).toFixed(2);
      expect(label).toContain(`时长 ${expected}s`);
    }
  });

  test('拖动帧条缩略图可逐帧擦洗，画面帧与时钟同步', async ({ page }) => {
    const box = await page.locator('#strip').boundingBox();
    // 点击第 7 个缩略图（索引 6）
    const cellW = box.width / 12;
    await page.mouse.click(box.x + cellW * 6.5, box.y + box.height / 2);
    const st = await page.evaluate(() => window.__studio.getState());
    expect(st.currentFrame).toBe(6);
    expect(st.clockTime).toBeCloseTo(6 / 12, 2);
    // 拖拽到第 3 个缩略图（索引 2）
    await page.mouse.move(box.x + cellW * 6.5, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + cellW * 2.5, box.y + box.height / 2, { steps: 4 });
    await page.mouse.up();
    const st2 = await page.evaluate(() => window.__studio.getState());
    expect(st2.currentFrame).toBe(2);
    expect(st2.clockTime).toBeCloseTo(2 / 12, 2);
  });

  test('入点/出点决定播放区间与总时长', async ({ page }) => {
    await page.evaluate(() => {
      const c = window.__studio.clock;
      c.seekToFrame(3);
    });
    await page.click('#setInBtn');
    await page.evaluate(() => window.__studio.clock.seekToFrame(8));
    await page.click('#setOutBtn');
    const state = await page.evaluate(() => window.__studio.getState());
    const scene = state.project.scenes[0];
    expect(scene.inPoint).toBe(3);
    expect(scene.outPoint).toBe(8);
    const label = await page.locator('#rangeLabel').textContent();
    expect(label).toContain('时长 0.50s'); // 6 帧 / 12fps
  });

  test('播放、暂停、拖动与循环共用同一时钟，脚步声与帧同步', async ({ page }) => {
    await page.evaluate(() => window.__studio.clock.seekToFrame(0));
    await page.click('#playBtn');
    await page.waitForFunction(() => {
      const st = window.__studio.getState();
      return st.events.some((e) => e.type === 'footstep' && e.frame === 0);
    }, { timeout: 8000 });
    await page.waitForTimeout(300);
    await page.click('#pauseBtn');
    const paused = await page.evaluate(() => window.__studio.getState());
    expect(paused.playing).toBe(false);
    await page.waitForFunction(() =>
      ['suspended', 'running'].includes(window.__studio.getState().audioState));
    expect(paused.playing).toBe(false);

    // 拖动：画面帧索引 == 时钟换算帧索引
    await page.evaluate(() => window.__studio.clock.seekToFrame(6));
    const dragged = await page.evaluate(() => window.__studio.getState());
    expect(dragged.currentFrame).toBe(6);
    expect(dragged.clockTime).toBeCloseTo(6 / 12, 1);

    // 循环：播放超过一轮后出现 loop 事件且时间被归零
    await page.check('#loopChk');
    await page.click('#playBtn');
    await page.waitForFunction(() =>
      window.__studio.getState().events.some((e) => e.type === 'loop'), { timeout: 8000 });
    const looped = await page.evaluate(() => window.__studio.getState());
    expect(looped.clockTime).toBeLessThan(0.5);
    await page.click('#pauseBtn');

    // 脚步声严格落在帧边界上
    const steps = looped.events.filter((e) => e.type === 'footstep');
    expect(steps.length).toBeGreaterThan(4);
    for (const ev of steps) {
      const expected = (ev.frame - looped.project.scenes[0].inPoint) / looped.project.fps;
      expect(Math.abs(ev.time - expected)).toBeLessThan(0.001);
    }
  });

  test('暂停截图与从头播放到同一时刻画面一致（确定性渲染 + 音频事件一致）', async ({ page }) => {
    await page.selectOption('#fpsSelect', '12');
    await page.evaluate(() => window.__studio.clock.seekToFrame(5));
    const shotA = await page.evaluate(() => Array.from(window.__studio.snapshotStage()));
    const frameAAudio = await page.evaluate(() => {
      const st = window.__studio.getState();
      return st.project.scenes[0].frames[5].footstep;
    });

    await page.evaluate(() => window.__studio.clock.seekToFrame(0));
    await page.evaluate(() => window.__studio.clock.seekToFrame(5));
    const shotB = await page.evaluate(() => Array.from(window.__studio.snapshotStage()));
    expect(shotA).toEqual(shotB);

    // 真实播放到第 5 帧时刻，画面仍应与静态截图一致
    await page.evaluate(() => window.__studio.clock.seekToFrame(0));
    await page.click('#playBtn');
    await page.waitForFunction(() =>
      window.__studio.getState().currentFrame === 5 &&
      window.__studio.getState().clockTime >= 5 / 12, { timeout: 8000 });
    await page.click('#pauseBtn');
    await page.waitForFunction(() => window.__studio.getState().playing === false);
    const shotC = await page.evaluate(() => Array.from(window.__studio.snapshotStage()));
    expect(shotC).toEqual(shotA);
    const state = await page.evaluate(() => window.__studio.getState());
    const atFrame = state.events.filter((e) => e.type === 'footstep' && e.frame === 5);
    expect(atFrame.length).toBe(frameAAudio === 'none' ? 0 : 1);
    // 已发生的脚步都严格落在各自帧边界上
    for (const ev of state.events.filter((e) => e.type === 'footstep')) {
      expect(ev.time).toBe((ev.frame - state.project.scenes[0].inPoint) / state.project.fps);
    }
  });
});
