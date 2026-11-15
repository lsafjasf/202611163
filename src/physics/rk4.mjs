// 通用定步长 RK4 积分器。f(state, params) -> 状态导数数组。
// 纯函数式实现，不依赖 Date/Math.random，保证同参数结果完全确定。
export function rk4Step(state, dt, params, f) {
  const n = state.length;
  const addScaled = (base, k, scale) => base.map((v, i) => v + k[i] * scale);

  const k1 = f(state, params);
  const k2 = f(addScaled(state, k1, dt / 2), params);
  const k3 = f(addScaled(state, k2, dt / 2), params);
  const k4 = f(addScaled(state, k3, dt), params);

  const next = new Array(n);
  for (let i = 0; i < n; i++) {
    next[i] = state[i] + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
  }
  return next;
}
