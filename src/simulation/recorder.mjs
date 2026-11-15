// 轨迹/状态记录器：按显示帧采样，支持 CSV/JSON 导出与回放连续性校验。
export class Recorder {
  constructor() {
    this.clear();
  }

  clear() {
    this.samples = [];
  }

  record(frame) {
    // 深拷贝坐标数组，避免后续积分复用同一引用。
    this.samples.push({
      ...frame,
      positions: frame.positions.map((p) => ({ ...p })),
      speeds: frame.speeds ? [...frame.speeds] : undefined
    });
  }

  get count() {
    return this.samples.length;
  }

  at(index) {
    return this.samples[index];
  }

  // 回放连续性：相邻关键状态不得出现超出物理合理范围的跳变。
  verifyContinuity(maxSpeedJump = 2.0, maxAngleJump = 0.5) {
    const violations = [];
    for (let i = 1; i < this.samples.length; i++) {
      const prev = this.samples[i - 1];
      const cur = this.samples[i];
      if (Math.abs(cur.speed - prev.speed) > maxSpeedJump) {
        violations.push({ index: i, field: 'speed', from: prev.speed, to: cur.speed });
      }
      const angleJump = Math.abs(
        Math.atan2(Math.sin(cur.theta - prev.theta), Math.cos(cur.theta - prev.theta))
      );
      if (angleJump > maxAngleJump) {
        violations.push({ index: i, field: 'theta', from: prev.theta, to: cur.theta });
      }
    }
    return { ok: violations.length === 0, violations };
  }

  toCSV() {
    const header = [
      'time_s',
      'theta_rad',
      'omega_rad_s',
      'x_m',
      'y_m',
      'speed_m_s',
      'kinetic_J',
      'potential_J',
      'total_J',
      'pressure_N',
      'temp_C',
      'dissipated_J'
    ];
    const rows = this.samples.map((s) =>
      [
        s.time.toFixed(5),
        s.theta.toFixed(6),
        s.omega.toFixed(6),
        s.positions[0].x.toFixed(6),
        s.positions[0].y.toFixed(6),
        s.speed.toFixed(6),
        s.kineticJ.toFixed(6),
        s.potentialJ.toFixed(6),
        s.totalEnergyJ.toFixed(6),
        s.pressureN.toFixed(4),
        s.temperatureC.toFixed(5),
        s.dissipatedJ.toFixed(6)
      ].join(',')
    );
    return [header.join(','), ...rows].join('\n');
  }

  toJSON(meta) {
    return JSON.stringify({ meta, samples: this.samples }, null, 2);
  }
}
