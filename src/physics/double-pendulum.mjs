import { G, SPECIFIC_HEAT } from '../config.mjs';
import { rk4Step } from './rk4.mjs';

// 双摆：state = [a1, a2, w1, w2]，阻尼 c1、c2（1/s）。
function derivative(s, p) {
  const [a1, a2, w1, w2] = s;
  const { m1, m2, l1, l2, c1, c2 } = p;
  const delta = a1 - a2;
  const den = 2 * m1 + m2 - m2 * Math.cos(2 * a1 - 2 * a2);

  const alpha1 =
    (-G * (2 * m1 + m2) * Math.sin(a1) -
      m2 * G * Math.sin(a1 - 2 * a2) -
      2 * Math.sin(delta) * m2 * (w2 ** 2 * l2 + w1 ** 2 * l1 * Math.cos(delta))) /
      (l1 * den) -
    c1 * w1;

  const alpha2 =
    (2 *
      Math.sin(delta) *
      (w1 ** 2 * l1 * (m1 + m2) +
        G * (m1 + m2) * Math.cos(a1) +
        w2 ** 2 * l2 * m2 * Math.cos(delta))) /
      (l2 * den) -
    c2 * w2;

  return [w1, w2, alpha1, alpha2];
}

export class DoublePendulum {
  constructor({ massKg, secondMassKg, lengthM, secondLengthM, angleDeg, secondAngleDeg, dampingPerSec = 0 }) {
    this.m1 = massKg;
    this.m2 = secondMassKg;
    this.l1 = lengthM;
    this.l2 = secondLengthM;
    this.c1 = dampingPerSec;
    this.c2 = dampingPerSec;
    this.a1Init = (angleDeg * Math.PI) / 180;
    this.a2Init = (secondAngleDeg * Math.PI) / 180;
    this.reset();
  }

  reset() {
    this.state = [this.a1Init, this.a2Init, 0, 0];
    this.dissipatedJ = 0;
    return this.snapshot(0);
  }

  get params() {
    return { m1: this.m1, m2: this.m2, l1: this.l1, l2: this.l2, c1: this.c1, c2: this.c2 };
  }

  step(dt) {
    const [, , w1Before, w2Before] = this.state;
    this.state = rk4Step(this.state, dt, this.params, derivative);
    const [, , w1After, w2After] = this.state;
    // 两个铰链处线性阻尼的耗散功率（按各自摆球转动惯量折算）。
    const p1 = this.c1 * this.m1 * this.l1 ** 2 * ((w1Before ** 2 + w1After ** 2) / 2);
    const p2 = this.c2 * this.m2 * this.l2 ** 2 * ((w2Before ** 2 + w2After ** 2) / 2);
    this.dissipatedJ += (p1 + p2) * dt;
  }

  get a1() {
    return this.state[0];
  }

  get a2() {
    return this.state[1];
  }

  get w1() {
    return this.state[2];
  }

  get w2() {
    return this.state[3];
  }

  positions() {
    const x1 = this.l1 * Math.sin(this.a1);
    const y1 = this.l1 * Math.cos(this.a1);
    return [
      { x: x1, y: y1 },
      { x: x1 + this.l2 * Math.sin(this.a2), y: y1 + this.l2 * Math.cos(this.a2) }
    ];
  }

  speeds() {
    const vx2 = this.l1 * this.w1 * Math.cos(this.a1) + this.l2 * this.w2 * Math.cos(this.a2);
    const vy2 = -this.l1 * this.w1 * Math.sin(this.a1) - this.l2 * this.w2 * Math.sin(this.a2);
    return [Math.abs(this.w1) * this.l1, Math.hypot(vx2, vy2)];
  }

  speed() {
    return Math.max(...this.speeds());
  }

  kineticJ() {
    return (
      0.5 * (this.m1 + this.m2) * this.l1 ** 2 * this.w1 ** 2 +
      0.5 * this.m2 * this.l2 ** 2 * this.w2 ** 2 +
      this.m2 * this.l1 * this.l2 * this.w1 * this.w2 * Math.cos(this.a1 - this.a2)
    );
  }

  potentialJ() {
    // 以静止竖直状态为势能零点。
    return (
      (this.m1 + this.m2) * G * this.l1 * (1 - Math.cos(this.a1)) +
      this.m2 * G * this.l2 * (1 - Math.cos(this.a2))
    );
  }

  totalEnergyJ() {
    return this.kineticJ() + this.potentialJ();
  }

  // 支点总反力：对两摆球应用牛顿第二定律后求矢量模长。
  pressureN() {
    const alpha = derivative(this.state, this.params);
    const a1x = this.l1 * (alpha[2] * Math.cos(this.a1) - this.w1 ** 2 * Math.sin(this.a1));
    const a1y = this.l1 * (-alpha[2] * Math.sin(this.a1) - this.w1 ** 2 * Math.cos(this.a1));
    const x2 = this.positions()[1];
    const a2x =
      a1x + this.l2 * (alpha[3] * Math.cos(this.a2) - this.w2 ** 2 * Math.sin(this.a2));
    const a2y =
      a1y + this.l2 * (-alpha[3] * Math.sin(this.a2) - this.w2 ** 2 * Math.cos(this.a2));
    const rx = this.m1 * a1x + this.m2 * a2x;
    const ry = this.m1 * (a1y - G) + this.m2 * (a2y - G);
    return Math.hypot(rx, ry);
  }

  temperatureC(ambientC) {
    const totalMass = this.m1 + this.m2;
    return ambientC + this.dissipatedJ / (totalMass * SPECIFIC_HEAT);
  }

  angularAccels() {
    const a = derivative(this.state, this.params);
    return [a[2], a[3]];
  }

  snapshot(time = 0) {
    return {
      time,
      theta: this.a1,
      theta2: this.a2,
      omega: this.w1,
      omega2: this.w2,
      positions: this.positions(),
      speeds: this.speeds(),
      speed: this.speed(),
      kineticJ: this.kineticJ(),
      potentialJ: this.potentialJ(),
      totalEnergyJ: this.totalEnergyJ(),
      pressureN: this.pressureN(),
      dissipatedJ: this.dissipatedJ
    };
  }
}
