// 生成可交付的示例 GIF / WebM 与界面截图，写入 artifacts/。
import { chromium } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
import { webmInfo } from './webm-info.mjs';

await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
const root = new URL('../artifacts/', import.meta.url);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', (e) => { throw e; });
await page.goto('http://127.0.0.1:4321/index.html');
await page.waitForFunction(() => !!window.__studio);

const gif = await page.evaluate(async () => {
  const mod = await import('/src/exporter.js');
  const gifMod = await import('/src/gif.js');
  const st = window.__studio.getState();
  const scene = st.project.scenes[0];
  scene.inPoint = 0;
  scene.outPoint = 11;
  const blob = await mod.exportGif(scene, 12, 320, 180);
  return { bytes: new Uint8Array(await blob.arrayBuffer()),
    info: gifMod.parseGifInfo(await blob.arrayBuffer()) };
});
await writeFile(new URL('sample-12frames.gif', root), Buffer.from(gif.bytes));

const webm = await page.evaluate(async () => {
  const mod = await import('/src/exporter.js');
  const { MasterClock, FootstepAudio } = await import('/src/clock.js');
  const st = window.__studio.getState();
  const scene = st.project.scenes[0];
  scene.inPoint = 0;
  scene.outPoint = 11;
  const engine = new FootstepAudio();
  const blob = await mod.exportWebm({
    scene, fps: 12, width: 320, height: 180, audio: engine,
    clockFactory: (a, sc, f, onFrame) => new MasterClock({
      audio: a, fpsRef: () => f, sceneRef: () => sc, onFrame,
    }),
  });
  return new Uint8Array(await blob.arrayBuffer());
});
await writeFile(new URL('sample-12frames.webm', root), Buffer.from(webm));

await page.evaluate(() => window.__studio.clock.seekToFrame(4));
await page.screenshot({ path: new URL('studio-screenshot.png', root).pathname });

console.log('GIF', JSON.stringify(gif.info));
console.log('WEBM', JSON.stringify(webmInfo(Buffer.from(webm)), null, 1));
await browser.close();
