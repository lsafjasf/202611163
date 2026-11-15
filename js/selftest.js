// 一致性自检：
// A. 帧确定性 —— 对每个采样时刻 t：
//    1) 直接 seek 到 t 渲染并取画面指纹（"暂停截图"）；
//    2) 从头播放，时钟到达 t 时暂停再取指纹（"重放截图"）；
//    两者必须一致，且该时刻的音频事件集合必须与调度计划一致。
// B. 时钟/循环 —— 主时钟 seek、播放推进、循环回绕的基本断言。
// 渲染是纯函数，所以 A 理论上恒成立；自检用于回归验证与向用户展示。

import { renderFrame, frameHash } from "./renderer.js";
import { activeEventsAt, planEvents } from "./audioEngine.js";

function waitFrame() {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

export async function runSelfTest({ project, scene, clock, canvas, audio, onLog }) {
  const ctx = canvas.getContext("2d");
  const w = project.width, h = project.height;
  const results = [];
  const log = (msg) => onLog?.(msg);

  const wasPlaying = clock.playing;
  const savedTime = clock.time;
  clock.pause();
  audio.stopAll();

  const duration = scene.out - scene.in;
  const samples = [duration * 0.25, duration * 0.5, duration * 0.83];

  for (const t of samples) {
    // 1) 直接定位渲染（等价于"拖到 t 暂停并截图"）
    clock.seek(t);
    renderFrame(ctx, project, scene, t);
    const hashSeek = frameHash(ctx, w, h);
    const eventsExpected = activeEventsAt(scene, t);

    // 2) 从头播放到 t（等价于"从头播放到同一时刻"）
    clock.seek(0);
    const plan = audio.play(scene, 0); // 真实调度，验证音频事件一致性
    clock.play();
    while (clock.time < t) {
      await waitFrame();
      renderFrame(ctx, project, scene, clock.time);
    }
    clock.pause();
    audio.stopAll();
    renderFrame(ctx, project, scene, t);
    const hashReplay = frameHash(ctx, w, h);

    // 音频事件一致性：t 时刻应发声的事件 ⊆ 从头调度的计划
    const plannedIds = plan
      .filter((p) => p.offset <= t && t < p.offset + p.duration)
      .map((p) => p.id)
      .sort();
    const framesMatch = hashSeek === hashReplay;
    const audioMatch = JSON.stringify(plannedIds) === JSON.stringify(eventsExpected);
    results.push({
      t, framesMatch, audioMatch, hashSeek, hashReplay,
      events: eventsExpected, planned: plannedIds,
    });
    log(
      `t=${t.toFixed(3)}s  画面${framesMatch ? "一致" : "不一致"} ` +
      `(${hashSeek} vs ${hashReplay})  音频事件${audioMatch ? "一致" : "不一致"} ` +
      `[${eventsExpected.join(",") || "无"}]`
    );
  }

  // B. 时钟行为
  clock.setDuration(duration);
  clock.seek(1.234);
  const seekOk = Math.abs(clock.time - 1.234) < 1e-9;
  clock.loop = true;
  clock.seek(duration - 0.05);
  clock.play();
  await new Promise((r) => setTimeout(r, 180));
  const loopOk = clock.time < duration && clock.playing;
  clock.pause();
  clock.loop = false;
  log(`时钟 seek ${seekOk ? "通过" : "失败"}，循环回绕 ${loopOk ? "通过" : "失败"}`);

  // 恢复现场
  clock.seek(Math.min(savedTime, duration));
  if (wasPlaying) { audio.play(scene, clock.time); clock.play(); }
  renderFrame(ctx, project, scene, clock.time);

  const pass =
    results.every((r) => r.framesMatch && r.audioMatch) && seekOk && loopOk;
  return { pass, results, seekOk, loopOk };
}
