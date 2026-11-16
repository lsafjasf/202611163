import { test, expect } from '@playwright/test';
import { webmInfo as parseWebm } from '../scripts/webm-info.mjs';

test.describe('持久化、场景隔离与导出', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => !!window.__studio);
  });

  test('工程保存后重载：时间线、字幕、转场、音频起点全部恢复', async ({ page }) => {
    await page.selectOption('#fpsSelect', '24');
    await page.evaluate(() => {
      const st = window.__studio.getState();
      const scene = st.project.scenes[0];
      scene.inPoint = 2;
      scene.outPoint = 9;
      scene.audioStartFrame = 4;
      scene.fadeInFrames = 3;
      scene.fadeOutFrames = 2;
      scene.subtitles = [{ id: 'sub_x1', startFrame: 1, endFrame: 4, text: '重载测试字幕' }];
      scene.frames[3].footstep = 'both';
      window.__studio.renderAll();
      window.__studio.clock.seekToFrame(3);
    });
    await page.click('#saveBtn');

    await page.reload();
    const st = await page.evaluate(() => window.__studio.getState());
    const scene = st.project.scenes[0];
    expect(st.project.fps).toBe(24);
    expect(scene.inPoint).toBe(2);
    expect(scene.outPoint).toBe(9);
    expect(scene.audioStartFrame).toBe(4);
    expect(scene.fadeInFrames).toBe(3);
    expect(scene.fadeOutFrames).toBe(2);
    expect(scene.subtitles[0].text).toBe('重载测试字幕');
    expect(scene.frames[3].footstep).toBe('both');
    expect(st.currentFrame).toBe(2);
  });

  test('切换场景不丢失关键帧，且上一场景的音频立即停止', async ({ page }) => {
    // 在场景 1 制造独特关键帧数据
    await page.evaluate(() => {
      const st = window.__studio.getState();
      st.project.scenes[0].frames[4].pose.head.x = 111;
      st.project.scenes[0].frames[4].footstep = 'right';
      window.__studio.renderAll();
    });
    await page.evaluate(() => window.__studio.clock.seekToFrame(0));
    await page.click('#playBtn');
    await page.waitForFunction(() =>
      window.__studio.getState().events.some((e) => e.type === 'footstep'), { timeout: 8000 });

    const secondId = await page.evaluate(() =>
      window.__studio.getState().project.scenes[1].id);
    await page.selectOption('#sceneSelect', secondId);

    const st = await page.evaluate(() => window.__studio.getState());
    expect(st.playing).toBe(false);
    expect(st.clockTime).toBe(0);
    expect(['suspended', 'running', 'none']).toContain(st.audioState);
    // 上一场景已排程的音源必须被显式停止，不能继续播放
    const activeCount = await page.evaluate(() => window.__studio.audio.activeSources.size);
    expect(activeCount).toBe(0);
    // 场景 1 关键帧保留
    expect(st.project.scenes[0].frames[4].pose.head.x).toBe(111);
    expect(st.project.scenes[0].frames[4].footstep).toBe('right');
    // 当前已是场景 2，事件序列中场景切换后没有新脚步
    const eventsAfterSwitch = st.events.filter((e) => e.type === 'footstep');
    const last = eventsAfterSwitch[eventsAfterSwitch.length - 1];
    await page.waitForTimeout(400);
    const st2 = await page.evaluate(() => window.__studio.getState());
    const stepsNow = st2.events.filter((e) => e.type === 'footstep');
    expect(stepsNow.length).toBe(eventsAfterSwitch.length);
    expect(last.frame).toBeLessThan(12);

    // 切回场景 1，关键帧仍在
    const firstId = await page.evaluate(() =>
      window.__studio.getState().project.scenes[0].id);
    await page.selectOption('#sceneSelect', firstId);
    const back = await page.evaluate(() => window.__studio.getState());
    expect(back.project.scenes[0].frames[4].pose.head.x).toBe(111);
  });

  test('GIF 导出入点、出点、帧数与总时长精确一致', async ({ page }) => {
    await page.selectOption('#fpsSelect', '12');
    await page.evaluate(() => {
      const st = window.__studio.getState();
      const scene = st.project.scenes[0];
      scene.inPoint = 2;
      scene.outPoint = 7;
      window.__studio.renderAll();
    });
    const info = await page.evaluate(async () => {
      const mod = await import('/src/exporter.js');
      const gifMod = await import('/src/gif.js');
      const st = window.__studio.getState();
      const scene = st.project.scenes[0];
      const blob = await mod.exportGif(scene, 12, 640, 360);
      const buf = await blob.arrayBuffer();
      return gifMod.parseGifInfo(buf);
    });
    expect(info.frameCount).toBe(6);
    expect(info.delays.every((d) => d === 8)).toBe(true); // 100/12 ≈ 8cs
    // GIF 时间粒度为 1/100s：总时长 = 帧数 × round(100/fps)/100
    expect(info.totalSeconds).toBe(6 * Math.round(100 / 12) / 100);
    expect(Math.abs(info.totalSeconds - 6 / 12)).toBeLessThan(0.03 * 6 / 6);
    expect(info.width).toBe(640);
    expect(info.height).toBe(360);
  });

  test('三种帧率下 GIF 总时长都等于帧数/fps', async ({ page }) => {
    for (const fps of [8, 12, 24]) {
      const info = await page.evaluate(async (useFps) => {
        const mod = await import('/src/exporter.js');
        const gifMod = await import('/src/gif.js');
        const st = window.__studio.getState();
        const scene = st.project.scenes[0];
        scene.inPoint = 0;
        scene.outPoint = 11;
        const blob = await mod.exportGif(scene, useFps, 320, 180);
        return gifMod.parseGifInfo(await blob.arrayBuffer());
      }, fps);
      expect(info.frameCount).toBe(12);
      const expectedCs = Math.round(100 / fps);
      expect(info.delays[0]).toBe(expectedCs);
      expect(info.totalSeconds).toBeCloseTo(12 * expectedCs / 100, 1);
    }
  });

  test('WebM 导出包含视频与音频轨，时长覆盖入点到出点', async ({ page }) => {
    await page.evaluate(() => window.__studio.clock.seekToFrame(0));
    const result = await page.evaluate(async () => {
      const mod = await import('/src/exporter.js');
      const { MasterClock, FootstepAudio } = await import('/src/clock.js');
      const st = window.__studio.getState();
      const scene = st.project.scenes[0];
      scene.inPoint = 0;
      scene.outPoint = 5;
      const engine = new FootstepAudio();
      const events = [];
      const blob = await mod.exportWebm({
        scene,
        fps: 12,
        width: 320,
        height: 180,
        audio: engine,
        clockFactory: (audioEngine, sc, useFps, onFrame) => new MasterClock({
          audio: audioEngine,
          fpsRef: () => useFps,
          sceneRef: () => sc,
          onFrame,
          onEvent: (ev) => events.push(ev),
        }),
      });
      return {
        bytes: blob.size,
        type: blob.type,
        buffer: new Uint8Array(await blob.arrayBuffer()),
        expectedSeconds: mod.expectedExportSeconds(scene, 12),
      };
    });
    expect(result.type).toBe('video/webm');
    expect(result.bytes).toBeGreaterThan(2000);
    expect(result.expectedSeconds).toBeCloseTo(0.5, 3);

    // 用 EBML 解析器实测媒体时长，并检查是否含音频（Opus）与视频（VP*）编解码标识
    const info = parseWebm(Buffer.from(result.buffer));
    expect(info.hasVideo).toBe(true);
    expect(info.hasAudio).toBe(true);
    // MediaRecorder 存在固定编码启动开销，允许实测时长在目标的 0.8~1.4 倍内
    expect(info.lastBlockSeconds).toBeGreaterThan(result.expectedSeconds * 0.8);
    expect(info.lastBlockSeconds).toBeLessThan(result.expectedSeconds * 1.4 + 0.2);
  });

  test('导出失败时原工程完整保留', async ({ page }) => {
    page.on('dialog', (d) => d.accept());
    const before = await page.evaluate(() =>
      JSON.stringify(window.__studio.getState().project));
    await page.evaluate(() => window.__studio.setExportHook('failNext', true));
    await page.click('#exportGifBtn');
    const after = await page.evaluate(() =>
      JSON.stringify(window.__studio.getState().project));
    expect(after).toBe(before);

    await page.evaluate(() => window.__studio.setExportHook('failNext', true));
    await page.click('#exportWebmBtn');
    const after2 = await page.evaluate(() =>
      JSON.stringify(window.__studio.getState().project));
    expect(after2).toBe(before);
  });

  test('重新载入后再导出，关键帧与入出点仍与保存时一致', async ({ page }) => {
    await page.evaluate(() => {
      const st = window.__studio.getState();
      const scene = st.project.scenes[0];
      scene.inPoint = 4;
      scene.outPoint = 10;
      scene.frames[6].pose.head.x = 222;
      window.__studio.renderAll();
    });
    await page.click('#saveBtn');
    await page.reload();
    const info = await page.evaluate(async () => {
      const mod = await import('/src/exporter.js');
      const gifMod = await import('/src/gif.js');
      const st = window.__studio.getState();
      const scene = st.project.scenes[0];
      if (scene.frames[6].pose.head.x !== 222) throw new Error('关键帧未恢复');
      const blob = await mod.exportGif(scene, st.project.fps, 320, 180);
      return gifMod.parseGifInfo(await blob.arrayBuffer());
    });
    expect(info.frameCount).toBe(7);
    expect(info.totalSeconds).toBeCloseTo(7 / 12, 1);
  });
});
