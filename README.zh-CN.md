# 双人追光控制台（Spotlight Duet）

舞台侧幕两套灯控台的双人协作小游戏：一人控制主灯**方向**，另一人控制**亮度**，
为两名演员完成五段追光。纯原生实现，零运行时依赖：

- Canvas 绘制舞台、演员、光锥与灯架热量环
- Web Audio 提供节拍、警报、成功/失败音效
- 纯逻辑引擎与 DOM 解耦，可在 Node 中完整自动化测试
- 确定性输入回放，自动保存并支持跳转到每次冲突时刻

## 运行

```bash
# 任选一种静态服务器（ES Module 需要 http 协议，不能直接 file:// 打开）
python3 -m http.server 8080
# 或
npx serve .
```

浏览器打开 `http://localhost:8080/index.html`。

浏览器冒烟页：`http://localhost:8080/tests/browser-smoke.html`

## 操作

| 物理控制台 | 按键 | 说明 |
| --- | --- | --- |
| 左侧 | `W` / `S` | 亮度升 / 降（仅当左侧负责亮度时） |
| 左侧 | `A` / `D` | 灯架左转 / 右转（仅当左侧负责方向时） |
| 右侧 | `↑` / `↓` | 亮度升 / 降（仅当右侧负责亮度时） |
| 右侧 | `←` / `→` | 灯架左转 / 右转（仅当右侧负责方向时） |
| 全局 | `P` 或 `Space` | 暂停 / 继续 |
| 全局 | `R` | 重开（全部仪表、资源、倒计时、音效同时复位） |
| 全局 | `T` | 轮换两名玩家的控制职责 |
| 全局 | `G` | 单人调试模式（一侧键盘接管全部职责） |

两套键盘独立维护按键状态，允许两侧同时按键（不依赖按键弹起顺序）。

## 规则

- 每段有一名金色标记的目标演员：光锥罩住且亮度 ≥ 30% 即**覆盖**，累计保持 2.5 秒完成该段。
- 亮度 ≥ 80% 且光锥同时**完全罩住两名演员**会触发警告，累计 3 次演出失败。
- 灯架持续转动会升温，到 100% 过热锁死；必须停转散热到 45% 以下才能恢复。
- 倒计时 45 秒内完成 5 段即成功；超时或警告超限即失败。
- 成功与失败都有全屏反馈、专属音效，并自动保存回放。

## 架构

```
js/
  engine.js        纯逻辑引擎（状态、热量、覆盖、警告、段进度、成败判定）
  renderer.js      Canvas 渲染（舞台/演员/光锥/热量/横幅/闪烁反馈）
  audio.js         Web Audio（节拍调度、警报、成败音效、复位）
  input.js         双物理侧并发键盘 + 动作键
  replay.js        输入/动作录制、确定性重放、冲突提取、可注入存储
  main/core.js     游戏循环与接线
  main/hud.js      两侧仪表与共享 HUD（同一份状态渲染）
  main/replay-ui.js 回放面板（播放/拖动/冲突跳转/导出）
test/
  engine.test.js   12 项引擎与回放断言
  scenarios.js     四类验收场景，产出回放与证据 JSON
  dom-smoke.test.js jsdom 真实页面接线冒烟
  driver.js        共享测试驾驶员
tests/
  browser-smoke.html / .js  浏览器内 Canvas/Audio/键盘/回放冒烟
```

## 自动化验证与验收对照

```bash
node test/engine.test.js     # 12 项单元/回放断言
node test/scenarios.js       # 生成 artifacts/ 下的场景回放与证据
node test/dom-smoke.test.js  # jsdom 真实 DOM 接线（需 npm i --no-save jsdom）
```

`node test/scenarios.js` 产出（每次运行先清空重建）：

| 文件 | 对应验收点 |
| --- | --- |
| `artifacts/replays/scenario-1-coop-success.json` | 一次完整协作，五段全完成；证据含每段两侧仪表同步采样 |
| `artifacts/replays/scenario-2-miss-recover.json` | 亮度侧单侧失误（miss 时刻/角度/亮度）后恢复并成功；证据含失误前后共享状态 |
| `artifacts/replays/scenario-3-conflicts.json` | 过热 + 双演员强光警告，证据列出每次冲突发生时刻，可在回放面板一键跳转 |
| `artifacts/replays/scenario-4-a/b-*.json` | 两种控制侧各完整完成一次相同任务，且证明非方向侧无法代替转向 |
| `artifacts/scenario-report.json` | 汇总报告 |

所有回放都会被 `ReplayPlayer` 重新模拟一遍并断言结果与现场一致（确定性校验）。

关键验收点与测试对应：

- 共享状态、不同职责、键盘同时输入：`engine.test.js` 的「两侧仪表同步」「单侧无法代劳」+ `dom-smoke.test.js` 并发按键
- 暂停/重开/单人调试：`engine.test.js` 重开复位、`dom-smoke.test.js` 动作键
- 成功与失败反馈：引擎事件 + 主控 `finishRound` 全屏遮罩与音效
- 一次协作、一次单侧失误、一次恢复且另一侧同步：场景 1、2 及证据 JSON
- 轮换两侧各完成一次、任一侧不能代劳：场景 4 两份回放
- 重开后仪表/资源/倒计时/音效同时复位：`restartAll`（含 `AudioManager.reset` 重建 AudioContext）
- 至少一份完整回放与冲突时刻：每场自动存档，场景 3 证据含冲突时刻数组
