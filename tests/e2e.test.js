import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".webm": "video/webm",
};

let server;
let browser;
let baseUrl;

before(async () => {
  server = createServer(async (request, response) => {
    try {
      const requestPath = decodeURIComponent(
        new URL(request.url, "http://127.0.0.1").pathname,
      );
      const relative = requestPath === "/" ? "index.html" : requestPath.slice(1);
      const filePath = normalize(join(root, relative));
      if (!filePath.startsWith(root)) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      const body = await readFile(filePath);
      response.writeHead(200, {
        "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      response.end(body);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
});

after(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
});

async function openPage() {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__beatboard));
  return { context, page, errors };
}

async function loadShortProject(page) {
  await page.evaluate(async () => {
    const project = window.__beatboard.getProject();
    project.title = "自动验证 · 短版";
    project.audio.start = 0.1;
    project.scenes.forEach((scene, index) => {
      scene.sourceIn = roundNumber(0.5 + index * 0.1);
      scene.sourceOut = roundNumber(scene.sourceIn + 0.6);
      scene.transition = {
        type: index === 0 ? "cut" : "dissolve",
        duration: index === 0 ? 0 : 0.08,
      };
      scene.subtitle = {
        text: `验证字幕 ${index + 1}`,
        in: 0.05,
        out: 0.55,
      };
    });
    await window.__beatboard.loadProject(project, { persist: false });
    function roundNumber(value) {
      return Math.round(value * 1000) / 1000;
    }
  });
}

test("dragging OUT pushes later shots and keyframes survive save/reload", { timeout: 30000 }, async () => {
  const { context, page, errors } = await openPage();
  const initial = await page.evaluate(() => window.__beatboard.getState());
  assert.equal(initial.total, 28);
  assert.equal((await page.evaluate(() => window.__beatboard.getProject())).scenes.length, 6);

  const box = await page.locator("#timelineCanvas").boundingBox();
  const pps = (1440 - 94 - 22) / 28;
  const firstOutX = 94 + 4 * pps;
  await page.mouse.move(box.x + firstOutX, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + firstOutX + pps, box.y + 80, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);

  const trimmed = await page.evaluate(() => {
    const project = window.__beatboard.getProject();
    const layout = window.__beatboard.validateTimeline();
    return {
      durations: project.scenes.map(
        (scene) => Math.round((scene.sourceOut - scene.sourceIn) * 100) / 100,
      ),
      starts: layout.snapshot.scenes.map((scene) => scene.start),
      total: layout.total,
      keyframes: project.scenes.map((scene) => scene.keyframes.length),
    };
  });
  assert.deepEqual(trimmed.durations, [5, 4, 5, 4, 5, 6]);
  assert.deepEqual(trimmed.starts, [0, 5, 9, 14, 18, 23]);
  assert.equal(trimmed.total, 29);
  assert.deepEqual(trimmed.keyframes, [2, 2, 2, 2, 2, 2]);

  await page.locator('[data-scene-id="rain-alley"]').click();
  await page.locator("#durationInput").fill("5.4");
  await page.locator("#durationInput").press("Enter");
  await page.locator("#subtitleInput").fill("雨声把拍点推近。");
  await page.locator("#transitionSelect").selectOption("flash");
  await page.locator("#audioStartInput").fill("0.8");
  await page.locator("#audioStartInput").press("Enter");
  await page.evaluate(async () => {
    await window.__beatboard.seek(5 + 2.5);
    document.querySelector("#addKeyframeBtn").click();
  });
  await page.waitForTimeout(200);
  await page.locator("#saveProjectBtn").click();
  await page.waitForTimeout(250);
  const saved = await page.evaluate(() => window.__beatboard.getProject());
  assert.equal(saved.scenes[1].subtitle.text, "雨声把拍点推近。");
  assert.equal(saved.scenes[1].transition.type, "flash");
  assert.equal(saved.audio.start, 0.8);
  assert.ok(saved.scenes[1].keyframes.length >= 3);

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__beatboard));
  const restored = await page.evaluate(() => ({
    project: window.__beatboard.getProject(),
    state: window.__beatboard.getState(),
  }));
  assert.equal(restored.state.total, 30.4);
  assert.equal(restored.project.scenes[1].subtitle.text, "雨声把拍点推近。");
  assert.equal(restored.project.scenes[1].transition.type, "flash");
  assert.equal(restored.project.audio.start, 0.8);
  assert.deepEqual(
    restored.project.scenes.map((scene) => scene.keyframes.length),
    saved.scenes.map((scene) => scene.keyframes.length),
  );
  assert.deepEqual(errors, []);
  await context.close();
});

test("paused frame and drums reproduce after replaying from zero", { timeout: 25000 }, async () => {
  const { context, page, errors } = await openPage();
  await loadShortProject(page);
  const target = 1.25;
  await page.evaluate((time) => window.__beatboard.seek(time), target);
  const paused = await page.evaluate(() => window.__beatboard.getSnapshot());
  await page.locator("#previewCanvas").screenshot({
    path: "artifacts/check-paused.png",
  });

  await page.evaluate(() => window.__beatboard.seek(0));
  await page.evaluate(() => window.__beatboard.play());
  await page.waitForFunction(
    (destination) => window.__beatboard.getState().currentTime >= destination,
    target,
    { timeout: 6000 },
  );
  await page.evaluate(() => window.__beatboard.pause());
  await page.evaluate((time) => window.__beatboard.seek(time), target);
  const replayed = await page.evaluate(() => window.__beatboard.getSnapshot());
  await page.locator("#previewCanvas").screenshot({
    path: "artifacts/check-replayed.png",
  });

  assert.equal(paused.hash, replayed.hash);
  assert.equal(paused.sceneId, replayed.sceneId);
  assert.equal(paused.localTime, replayed.localTime);
  assert.equal(paused.caption, replayed.caption);
  assert.deepEqual(paused.event, replayed.event);
  assert.ok(paused.event, "the target should resolve to a drum event");

  await page.evaluate(() => window.__beatboard.validateConsistency());
  await page.waitForSelector("#modal h2");
  const modalText = await page.locator("#modal").innerText();
  assert.match(modalText, /完全可复现/);
  assert.match(modalText, /Canvas 像素一致\s+PASS/);
  assert.match(modalText, /音频事件一致\s+PASS/);
  assert.match(modalText, /关键帧 \/ 转场未变化\s+PASS/);
  assert.deepEqual(errors, []);
  await context.close();
});

test("PNG and WebM exports keep in/out and total consistent", { timeout: 45000 }, async () => {
  const { context, page, errors } = await openPage();
  await loadShortProject(page);
  const before = await page.evaluate(() => JSON.stringify(window.__beatboard.getProject()));

  const sheetDownload = page.waitForEvent("download", { timeout: 15000 });
  await page.evaluate(() => window.__beatboard.exportStoryboard());
  const sheet = await sheetDownload;
  await sheet.saveAs("artifacts/test-storyboard.png");
  assert.match(sheet.suggestedFilename(), /storyboard\.png$/);
  let modalText = await page.locator("#modal").innerText();
  assert.match(modalText, /导出总时长\s+3\.60s/);
  assert.match(modalText, /镜头时长合计\s+3\.60s/);
  assert.match(modalText, /入 \/ 出点\s+一致/);
  assert.match(modalText, /总时长 = 六格时长之和\s+PASS/);

  const videoDownload = page.waitForEvent("download", { timeout: 30000 });
  await page.evaluate(() => window.__beatboard.exportMovie());
  const video = await videoDownload;
  const videoPath = await video.path();
  await video.saveAs("artifacts/test-export.webm");
  assert.match(video.suggestedFilename(), /film\.webm$/);
  const { stat } = await import("node:fs/promises");
  assert.ok((await stat("artifacts/test-export.webm")).size > 1000);
  modalText = await page.locator("#modal").innerText();
  assert.match(modalText, /导出完成 · 时间线已核验/);
  assert.match(modalText, /导出总时长\s+3\.60s/);
  assert.match(modalText, /WebM/);
  assert.match(modalText, /TOTAL\s+3\.60/);
  const after = await page.evaluate(() => JSON.stringify(window.__beatboard.getProject()));
  assert.equal(after, before);
  assert.deepEqual(errors, []);
  await context.close();
});

test("failed export preserves project, saved project and autosave draft", { timeout: 20000 }, async () => {
  const { context, page, errors } = await openPage();
  await page.evaluate(() => {
    const duration = document.querySelector("#durationInput");
    duration.value = "4.6";
    duration.dispatchEvent(new Event("change", { bubbles: true }));
    window.__beatboard.save();
  });
  await page.waitForTimeout(300);
  const before = await page.evaluate(() => ({
    project: JSON.stringify(window.__beatboard.getProject()),
    storage: localStorage.getItem("beatboard.project.night-flight.v1"),
    draft: localStorage.getItem("beatboard.project.night-flight.draft.v1"),
  }));
  await page.evaluate(() => {
    window.__beatboard.setForceExportFailure(true);
    return window.__beatboard.exportMovie();
  });
  await page.waitForSelector("#modal h2");
  const modalText = await page.locator("#modal").innerText();
  assert.match(modalText, /导出失败 · 原工程已保留/);
  assert.match(modalText, /完整保留/);
  const after = await page.evaluate(() => ({
    project: JSON.stringify(window.__beatboard.getProject()),
    storage: localStorage.getItem("beatboard.project.night-flight.v1"),
    draft: localStorage.getItem("beatboard.project.night-flight.draft.v1"),
  }));
  assert.deepEqual(after, before);
  const state = await page.evaluate(() => window.__beatboard.getState());
  assert.equal(state.exporting, false);
  assert.equal(state.playing, false);
  assert.deepEqual(errors, []);
  await context.close();
});

test("scene switch restarts the shared clock and abandons prior audio nodes", { timeout: 20000 }, async () => {
  const { context, page, errors } = await openPage();
  await page.evaluate(() => window.__beatboard.play());
  await page.waitForTimeout(700);
  const before = await page.evaluate(() => window.__beatboard.getAudioState());
  assert.equal(before.running, true);
  assert.ok(before.scheduledNodes > 0);

  await page.evaluate(() => window.__beatboard.selectScene("signal"));
  await page.waitForTimeout(250);
  const switched = await page.evaluate(() => ({
    state: window.__beatboard.getState(),
    audio: window.__beatboard.getAudioState(),
  }));
  assert.equal(switched.state.playing, true);
  assert.ok(Math.abs(switched.state.currentTime - 17) < 0.35);
  assert.equal(switched.audio.running, true);
  assert.ok(Math.abs(switched.audio.anchorTimelineTime - 17) < 0.35);
  assert.ok(switched.audio.scheduledNodes > 0);
  await page.evaluate(() => window.__beatboard.pause());
  assert.deepEqual(errors, []);
  await context.close();
});

test("loop wraps the shared clock and reschedules its drums", { timeout: 15000 }, async () => {
  const { context, page, errors } = await openPage();
  await page.evaluate(async () => {
    await window.__beatboard.seek(27.7);
    window.__beatboard.setLoop(true);
    await window.__beatboard.play();
  });
  await page.waitForTimeout(1000);
  const looped = await page.evaluate(() => ({
    state: window.__beatboard.getState(),
    audio: window.__beatboard.getAudioState(),
  }));
  assert.equal(looped.state.playing, true);
  assert.ok(looped.state.currentTime < 1.5);
  assert.equal(looped.audio.running, true);
  assert.ok(looped.audio.anchorTimelineTime < 1.5);
  await page.evaluate(async () => {
    window.__beatboard.pause();
    await new Promise((resolve) => setTimeout(resolve, 10));
    window.__beatboard.play();
    await new Promise((resolve) => setTimeout(resolve, 8));
    window.__beatboard.pause();
  });
  await page.waitForTimeout(300);
  const paused = await page.evaluate(() => ({
    state: window.__beatboard.getState(),
    audio: window.__beatboard.getAudioState(),
  }));
  assert.equal(paused.state.playing, false);
  assert.equal(paused.audio.running, false);
  assert.deepEqual(errors, []);
  await context.close();
});
