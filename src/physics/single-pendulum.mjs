import { G, SPECIFIC_HEAT } from '../config.mjs';
import { rk4Step } from './rk4.mjs';

// 单摆：state = [theta(rad), omega(rad/s)]。
// 阻尼项 c*omega（c 为每秒衰减系数，量纲 1/s）。
function derivative([theta, omega], c) {
  return [omega, -G * Math.sin(theta) - c * omega];
}

export class SinglePendulum {
  constructor({ massKg, lengthM, angleDeg, dampingPerSec = 0 }) {
    this.massKg = massKg;
    this.lengthM = lengthM;
    this.dampingPerSec = dampingPerSec;
    this.initialAngleRad = (angleDeg * Math.PI) / 180;
    this.reset();
  }

  reset() {
    this.state = [this.initialAngleRad, 0];
    this.dissipatedJ = 0;
    return this.snapshot(0);
  }

  step(dt) {
    const [, omegaBefore] = this.state;
    this.state = rk4Step(this.state, dt, this.dampingPerSec, derivative);
    // 线性阻尼耗散功率 P = m * L^2 * c * omega^2（梯形近似）。
    const inertia = this.massKg * this.lengthM ** 2;
    const omegaAfter = this.state[1];
    const avgOmegaSq = (omegaBefore ** 2 + omegaAfter ** 2) / 2;
    this.dissipatedJ += inertia * this.dampingPerSec * avgOmegaSq * dt;
  }

  get theta() {
    return this.state[0];
  }

  get omega() {
    return this.state[1];
  }

  // 摆球相对支点的笛卡尔坐标（y 向下为正，便于 Canvas 绘制）。
  positions() {
    const x = this.lengthM * Math.sin(this.theta);
    const y = this.lengthM * Math.cos(this.theta);
    return [{ x, y }];
  }

  speed() {
    return Math.abs(this.omega) * this.lengthM;
  }

  kineticJ() {
    return 0.5 * this.massKg * this.lengthM ** 2 * this.omega ** 2;
  }

  potentialJ() {
    // 以最低点（theta=0）为势能零点；y 向下，高度 h = L(cos theta - 1) 取负。
    return this.massKg * G * this.lengthM * (1 - Math.cos(this.theta));
  }

  totalEnergyJ() {
    return this.kineticJ() + this.potentialJ();
  }

  // 支点反力大小（作为“压力”监测量）：T = m(g cosθ + Lω²)。
  pressureN() {
    return this.massKg * (G * Math.cos(this.theta) + this.lengthM * this.omega ** 2);
  }

  temperatureC(ambientC) {
    return ambientC + this.dissipatedJ / (this.massKg * SPECIFIC_HEAT);
  }

  // 角加速度，供受力方向箭头使用。
  angularAccel() {
    return derivative(this.state, this.dampingPerSec)[1];
  }

  snapshot(time = 0) {
    return {
      time,
      theta: this.theta,
      omega: this.omega,
      positions: this.positions(),
      speed: this.speed(),
      kineticJ: this.kineticJ(),
      potentialJ: this.potentialJ(),
      totalEnergyJ: this.totalEnergyJ(),
      pressureN: this.pressureN(),
      dissipatedJ: this.dissipatedJ
    };
  }
}
