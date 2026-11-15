import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://localhost:4731/');
const res = await page.evaluate(async () => {
  const resp = await fetch('/artifacts/poster.webm');
  const bin = new Uint8Array(await resp.arrayBuffer());
  const ac = new AudioContext({ sampleRate: 48000 });
  const buf = await ac.decodeAudioData(bin.buffer.slice(0));
  const ch = buf.getChannelData(0);
  let peak = 0, sum = 0, nonzero = 0;
  for (let i = 0; i < ch.length; i++) {
    const v = Math.abs(ch[i]);
    if (v > peak) peak = v;
    sum += v * v;
    if (v > 0.001) nonzero++;
  }
  // 统计节拍峰值：每 0.25s 窗口的最大值数量
  const win = Math.floor(ac.sampleRate * 0.25);
  const peaks = [];
  for (let i = 0; i < ch.length; i += win) {
    let m = 0;
    for (let j = i; j < Math.min(i + win, ch.length); j++) m = Math.max(m, Math.abs(ch[j]));
    peaks.push(m);
  }
  return {
    duration: buf.duration, channels: buf.numberOfChannels,
    sampleRate: buf.sampleRate, peak, rms: Math.sqrt(sum / ch.length),
    activeWindows: peaks.filter(p => p > 0.05).length, totalWindows: peaks.length,
  };
});
console.log(JSON.stringify(res, null, 2));
await browser.close();
