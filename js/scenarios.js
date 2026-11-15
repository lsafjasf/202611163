/* Canonical verification scenarios shared by the UI and Node tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.GyroScenarios = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const SCENARIOS = [
    {
      id: "normal",
      name: "正常工况",
      description: "标准负载与转速，PD 控制 + 三轴偏置，应稳定保持 10 秒成功",
      params: {
        m: 1.0,
        wsCmd: 320,
        biasX: 0,
        biasY: 0,
        biasZ: 0,
        kp: 8,
        kd: 4,
        seed: 20261116
      },
      expect: "success"
    },
    {
      id: "extreme",
      name: "极限载荷",
      description: "最大负载与最高转速，姿态受控但轴承压力越限，应记录压力触发点",
      params: {
        m: 2.0,
        wsCmd: 420,
        biasX: 0,
        biasY: 0,
        biasZ: 0,
        kp: 8,
        kd: 4,
        seed: 20261116
      },
      expect: "tripped",
      expectKey: "pressure"
    },
    {
      id: "unstable",
      name: "失稳工况",
      description: "低转速且关闭校正，陀螺低于临界稳定转速，扰动下发散并倾角越限",
      params: {
        m: 1.0,
        wsCmd: 60,
        biasX: 0,
        biasY: 0,
        biasZ: 0,
        kp: 0,
        kd: 0,
        seed: 20261116
      },
      expect: "tripped",
      expectKey: "tilt"
    }
  ];

  return { SCENARIOS };
});
