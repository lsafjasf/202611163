import { SAFETY_LIMITS, WORLD_HALF_SIZE } from '../config.mjs';

// 限值监测：检测到越界即返回触发点信息，由运行器立即停止积分。
export function checkLimits(frame, params) {
  const checks = [
    {
      key: 'loadKg',
      value: params.massKg,
      limit: SAFETY_LIMITS.loadKg,
      triggered: params.massKg < SAFETY_LIMITS.loadKg.min || params.massKg > SAFETY_LIMITS.loadKg.max
    },
    {
      key: 'speed',
      value: frame.speed,
      limit: SAFETY_LIMITS.speed,
      triggered: frame.speed > SAFETY_LIMITS.speed.max || frame.speed < SAFETY_LIMITS.speed.min
    },
    {
      key: 'temperatureC',
      value: frame.temperatureC,
      limit: SAFETY_LIMITS.temperatureC,
      triggered:
        frame.temperatureC > SAFETY_LIMITS.temperatureC.max ||
        frame.temperatureC < SAFETY_LIMITS.temperatureC.min
    },
    {
      key: 'pressureN',
      value: frame.pressureN,
      limit: SAFETY_LIMITS.pressureN,
      // 支点反力在大角度下可能瞬时为负（杆受推），只对过载上限做保护。
      triggered: frame.pressureN > SAFETY_LIMITS.pressureN.max
    }
  ];

  const hit = checks.find((c) => c.triggered);
  if (hit) {
    return {
      reason: hit.key,
      label: hit.limit.label,
      value: hit.value,
      min: hit.limit.min,
      max: hit.limit.max,
      unit: hit.limit.unit ?? '',
      time: frame.time,
      positions: frame.positions,
      speed: frame.speed,
      pressureN: frame.pressureN,
      temperatureC: frame.temperatureC
    };
  }

  // 画布/世界边界：任一摆体超出半尺寸即停止。
  const outside = frame.positions.find(
    (p) => Math.abs(p.x) > WORLD_HALF_SIZE || Math.abs(p.y) > WORLD_HALF_SIZE
  );
  if (outside) {
    return {
      reason: 'boundary',
      label: '画布边界',
      value: Math.max(Math.abs(outside.x), Math.abs(outside.y)),
      max: WORLD_HALF_SIZE,
      unit: 'm',
      time: frame.time,
      positions: frame.positions,
      speed: frame.speed,
      pressureN: frame.pressureN,
      temperatureC: frame.temperatureC
    };
  }
  return null;
}
