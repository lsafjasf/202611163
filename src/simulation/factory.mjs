import { SinglePendulum } from '../physics/single-pendulum.mjs';
import { DoublePendulum } from '../physics/double-pendulum.mjs';

// 根据界面配置创建模型，并统一暴露质量字段给限值监测。
export function createModel(config) {
  const frictionOn = config.frictionOn;
  const damping = frictionOn ? config.dampingPerSec : 0;

  if (config.mode === 'double') {
    const model = new DoublePendulum({
      massKg: config.massKg,
      secondMassKg: config.secondMassKg ?? config.massKg,
      lengthM: config.lengthM,
      secondLengthM: config.secondLengthM ?? config.lengthM,
      angleDeg: config.angleDeg,
      secondAngleDeg: config.secondAngleDeg ?? config.angleDeg * 0.7,
      dampingPerSec: damping
    });
    return { model, params: { massKg: config.massKg } };
  }

  const model = new SinglePendulum({
    massKg: config.massKg,
    lengthM: config.lengthM,
    angleDeg: config.angleDeg,
    dampingPerSec: damping
  });
  return { model, params: { massKg: config.massKg } };
}
