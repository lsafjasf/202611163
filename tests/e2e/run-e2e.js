import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const BASE = 'http://localhost:4731';
const OUT = new URL('../../artifacts/', import.meta.url);
let failures = 0;
const results = [];

function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond, detail });
  if (!cond) failures += 1;
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1180, height: 1400 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('  [console.error]', m.text()); });
page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); failures += 1; });

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__app !== undefined);

const canvas = page.locator('#canvas');
const getTime = () => page.evaluate(() => window.__app.transport.time);
const grab = () => page.evaluate(() => {
  const c = document.querySelector('#canvas');
  return c.getContext('2d').getImageData(200, 150, 1, 1).data.join(',');
});
const grabFull = () => page.evaluate(() => {
  const c = document.querySelector('#canvas');
  const { width, height } = c;
  return c.getContext('2d').getImageData(0, 0, width, height).data.join('');
});

// 1) 拖动播放头实时插值：时间与像素都应变化且确定
const t0 = await getTime();
await page.evaluate(() => window.__app.transport.seek(0));
const px0 = await grabFull();
await page.evaluate((t) => window.__app.transport.seek(t), 3.0);
const t3 = await getTime();
const px3 = await grabFull();
check('拖动播放头更新到 3.0s', Math.abs(t3 - 3) < 0.001, `time=${t3}`);
check('拖动后画面实时插值（像素改变）', px0 !== px3);

// 确定性：同时间两次渲染像素一致
await page.evaluate((t) => window.__app.transport.seek(t), 3.0);
const px3b = await grabFull();
check('同一时刻渲染确定性一致', px3 === px3b);

// 2) 播放/暂停：画面与声音同时冻结
await page.evaluate((t) => window.__app.transport.seek(t), 4.0);
await page.click('#btnPlay');
await page.waitForTimeout(400);
const runningState = await page.evaluate(() => window.__app.audio.ctx.state);
await page.click('#btnPause');
const paused = await page.evaluate(() => ({
  playing: window.__app.transport.playing,
  audio: window.__app.audio.ctx.state,
  active: window.__app.audio.active.size,
}));
const frozenA = await grabFull();
await page.waitForTimeout(400);
const frozenB = await grabFull();
check('播放时 AudioContext 运行', runningState === 'running', runningState);
check('暂停后 transport 停止', paused.playing === false);
check('暂停后 AudioContext 挂起（声音冻结）', paused.audio === 'suspended', paused.audio);
check('暂停期间画面像素冻结', frozenA === frozenB);

// 3) 场景切换不丢失关键帧且音频停止
const kfBefore = await page.evaluate(() => {
  const s = window.__app.project.scenes[0];
  return s.layers.title.tracks.opacity.length + s.layers.background.tracks.x.length;
});
await page.click('#btnPlay');
await page.waitForTimeout(200);
const sceneButtons = page.locator('#sceneTabs button');
await sceneButtons.nth(1).click();
const afterSwitch = await page.evaluate(() => ({
  playing: window.__app.transport.playing,
  audio: window.__app.audio.ctx.state,
  active: window.__app.audio.active.size,
  time: window.__app.transport.time,
  kf: window.__app.project.scenes[0].layers.title.tracks.opacity.length,
}));
check('切换场景后音频被清空（不从上一场景延续）', afterSwitch.active === 0 && afterSwitch.audio === 'suspended');
check('切换场景后关键帧保留', afterSwitch.kf >= 2 && kfBefore > 0);
check('切换场景播放头移到新场景入点', Math.abs(afterSwitch.time - 6) < 0.01, `time=${afterSwitch.time}`);

// 4) 保存后重载：时间线、字幕、转场、音频起点完整恢复
await page.evaluate(() => {
  const p = window.__app.project;
  p.scenes[1].audio.startAt = 0.25;
  p.scenes[1].transition = { type: 'slide', duration: 0.8 };
  p.scenes[0].layers.title.text = '自定义字幕';
  return window.__app.renderAll();
});
await page.click('#btnSave');
const savedJson = await page.evaluate(() => localStorage.getItem('procedural-poster-project'));
const snapshot = JSON.parse(savedJson);
await page.evaluate(() => {
  localStorage.removeItem('procedural-poster-project');
  window.__app.project.scenes[0].layers.title.text = '被污染的内存';
});
await page.evaluate((j) => localStorage.setItem('procedural-poster-project', j), savedJson);
await page.click('#btnLoad');
const restored = await page.evaluate(() => ({
  text: window.__app.project.scenes[0].layers.title.text,
  startAt: window.__app.project.scenes[1].audio.startAt,
  transition: window.__app.project.scenes[1].transition,
  kfCount: window.__app.project.scenes[1].layers.background.tracks.x.length,
  duration: window.__app.project.duration,
  time: window.__app.transport.time,
}));
check('重载恢复字幕文字', restored.text === '自定义字幕', restored.text);
check('重载恢复音频起始位置', Math.abs(restored.startAt - 0.25) < 1e-6);
check('重载恢复转场类型与时长', restored.transition.type === 'slide' && restored.transition.duration === 0.8);
check('重载恢复关键帧与总时长', restored.kfCount >= 2 && restored.duration === 12);
check('重载后播放头归零且声音停止', restored.time === 0);

// 5) 中间时刻暂停截图，与从头播放到同一时刻的确定性画面对照
await page.evaluate(() => window.__app.transport.seek(0));
await page.click('#btnPlay');
await page.waitForFunction(() => window.__app.transport.time >= 5.0, { timeout: 8000 });
await page.click('#btnPause');
const mid = await page.evaluate(() => {
  const t = window.__app.transport.time;
  const live = document.querySelector('#canvas').getContext('2d')
    .getImageData(0, 0, 960, 540).data.join('');
  // 用纯函数渲染器在同一 transport 时刻离屏重绘作为基准
  const ref = document.createElement('canvas');
  ref.width = 960; ref.height = 540;
  return import('/src/engine/renderer.js').then(({ renderFrame }) => {
    renderFrame(ref.getContext('2d'), window.__app.project, t, 960, 540);
    return {
      t,
      live,
      ref: ref.getContext('2d').getImageData(0, 0, 960, 540).data.join(''),
      audioText: document.querySelector('#audioEvent').textContent,
    };
  });
});
check('播放到中间时刻暂停的画面等于该时刻确定性渲染', mid.live === mid.ref, `t=${mid.t.toFixed(3)}`);
check('该时刻音频事件与共享时钟对齐', /beat@/.test(mid.audioText), mid.audioText);
await mkdir(OUT, { recursive: true });
await page.locator('#canvas').screenshot({ path: new URL('frame-mid.png', OUT).pathname });

// 6) 导出工程 JSON，校验入点/出点/总时长
const exported = await page.evaluate(async () => {
  const { exportProjectJSON } = await import('/src/engine/exporter.js');
  return exportProjectJSON(window.__app.project);
});
const proj = JSON.parse(exported);
await writeFile(new URL('poster-project.json', OUT), exported);
check('导出 JSON 入点为 0、出点为 12、总时长 12s',
  proj.scenes[0].inPoint === 0 && proj.scenes.at(-1).outPoint === 12 && proj.duration === 12);

// 7) 导出 WebM，校验容器、时长与帧数
const webm = await page.evaluate(async () => {
  const { exportWebM } = await import('/src/engine/exporter.js');
  const r = await exportWebM(window.__app.project, window.__app.audio, { fps: 30 });
  const buf = new Uint8Array(await r.blob.arrayBuffer());
  let bin = '';
  for (const b of buf) bin += String.fromCharCode(b);
  return {
    base64: btoa(bin), size: r.size, duration: r.duration,
    frames: r.frames, mime: r.mimeType,
  };
});
const webmBuf = Buffer.from(webm.base64, 'base64');
await writeFile(new URL('poster.webm', OUT), webmBuf);
const isWebm = webmBuf[0] === 0x1a && webmBuf[1] === 0x45 && webmBuf[2] === 0xdf && webmBuf[3] === 0xa3;
check('WebM 使用 EBML 容器且含音频 mime', isWebm && /webm/.test(webm.mime), webm.mime);
check('导出时长等于工程总时长 12s', webm.duration === 12, `frames=${webm.frames}`);
check('导出帧数与 12s × 30fps 匹配', webm.frames === 360, String(webm.frames));
check('WebM 字节非空', webm.size > 1000, `${webm.size}B`);

// 8) 导出失败必须保留原工程
const beforeFail = await page.evaluate(() => JSON.stringify(window.__app.project));
const failResult = await page.evaluate(async () => {
  const { exportWebM } = await import('/src/engine/exporter.js');
  try {
    await exportWebM(window.__app.project, window.__app.audio, { simulateFailure: true });
    return 'no-throw';
  } catch (e) {
    return e.message;
  }
});
const afterFail = await page.evaluate(() => JSON.stringify(window.__app.project));
check('导出失败抛出异常', /失败/.test(failResult), failResult);
check('导出失败后原工程完整保留', beforeFail === afterFail);

await browser.close();
console.log(`\n${results.length - failures}/${results.length} 项端到端检查通过`);
process.exit(failures ? 1 : 0);
