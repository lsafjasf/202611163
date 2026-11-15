// 全局物理常数与安全限值（SI 单位）。
export const G = 9.81;
export const AMBIENT_TEMP_C = 20;
// 摆体等效比热容，用于把摩擦耗散功换算成温升（J/(kg·K)）。
export const SPECIFIC_HEAT = 500;

// 固定积分步长与渲染帧步长，保证结果可重复、与设备刷新率解耦。
export const PHYSICS_DT = 1 / 240;
export const DISPLAY_DT = 1 / 60;
export const SUBSTEPS_PER_FRAME = Math.round(DISPLAY_DT / PHYSICS_DT); // 4

// 参数可调范围（负载、摆长、角度）。
export const PARAM_LIMITS = Object.freeze({
  massKg: { min: 0.1, max: 50, step: 0.1 },
  lengthM: { min: 0.2, max: 4, step: 0.05 },
  angleDeg: { min: -180, max: 180, step: 1 },
  dampingPerSec: { min: 0, max: 1.5, step: 0.01 }
});

// 安全监测上下限：超出即停止，不再继续积分。
export const SAFETY_LIMITS = Object.freeze({
  loadKg: { min: 0.1, max: 50, label: '负载(质量)' },
  speed: { min: 0, max: 5.5, unit: 'm/s', label: '速度' },
  temperatureC: { min: AMBIENT_TEMP_C - 1, max: 80, unit: '°C', label: '温度' },
  pressureN: { min: 0, max: 1500, unit: 'N', label: '支点压力' }
});

// 画布世界坐标半尺寸（米）。摆体越界即触发 boundary 停止。
export const WORLD_HALF_SIZE = 4.5;

// 回放与导出采样间隔（秒）。
export const SAMPLE_DT = DISPLAY_DT;
