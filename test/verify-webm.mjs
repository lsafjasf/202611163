// 校验导出的 WebM：视频轨 + 音频轨同时存在，时长 ≈ 10s
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
const buf = await readFile("artifacts/intro-export.webm");
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage();
await page.goto("about:blank");
const result = await page.evaluate(async (b64) => {
  const blob = new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: "video/webm" });
  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.src = url; video.muted = false; video.preload = "auto";
  await new Promise((res, rej) => { video.onloadedmetadata = res; video.onerror = rej; });
  if (video.duration === Infinity) {
    video.currentTime = Number.MAX_SAFE_INTEGER;
    await new Promise((res) => { video.ontimeupdate = res; });
  }
  const duration = video.duration;
  video.currentTime = 0;
  await video.play();
  await new Promise((res) => setTimeout(res, 800));
  const stream = video.captureStream();
  const tracks = {
    video: stream.getVideoTracks().length,
    audio: stream.getAudioTracks().length,
    width: video.videoWidth, height: video.videoHeight, duration,
  };
  video.pause(); URL.revokeObjectURL(url);
  return tracks;
}, buf.toString("base64"));
console.log(JSON.stringify(result, null, 2));
const ok = result.video === 1 && result.audio === 1 && Math.abs(result.duration - 10) < 0.5
  && result.width === 960 && result.height === 540;
console.log(ok ? "WEBM 校验通过：视频+音频双流，时长≈10s" : "WEBM 校验失败");
await browser.close();
process.exit(ok ? 0 : 1);
