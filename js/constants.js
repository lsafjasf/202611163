// Physical layout and safety-limit constants shared by engine, UI and tests.
// SI-ish units: metres, seconds, kilograms, amperes, kelvin, pascals.

export const PHYS = {
  DT: 0.002,              // fixed integration step (500 Hz)
  G: 9.81,
  BALL_RADIUS: 0.025,     // 5 cm diameter
  BALL_MASS: 0.05,        // 50 g nominal payload
  RING_CLEAR: 0.045,      // ring inner edge radius (m); > ball radius
  SPRING_K: 1.6,          // magnetic force coefficient K
  SIGMA: 0.14,            // axial spread of a coil's magnetic field
  RADIAL_K: 140,          // magnetic centering stiffness (N/m)
  CURRENT_MAX: 2.0,       // hard per-coil current ceiling (A)
  CURRENT_TAU: 0.08,      // first-order actuator lag (s)
  T_AMBIENT: 293.15,      // 20 C
  COIL_R: 4.0,            // winding resistance (ohm)
  THERM_R: 4.0,           // thermal resistance K/W
  THERM_TAU: 50.0,        // thermal time constant (s)
  BALL_AREA: Math.PI * 0.025 * 0.025,
  CONTACT_K: 4000,        // ring-contact spring (N/m)
  CONTACT_D: 4.0,         // ring-contact damping
  WALL_K: 6000,           // soft side-wall stiffness
  RESTITUTION: 0.35,      // base/ring bounce restitution
  SEAT_Y: 0.04,           // ball centre height when seated on the base
  START_Y: 0.10,
  START_X: 0.0,
  MAX_R: 0.12,            // tube half-width (soft wall)
  RAND_SEED: 20261116
};

// Coil / ring centre heights. Coils straddle the rings.
export const COIL_Y = [0.22, 0.48, 0.74, 1.0];
export const RING_Y = [0.35, 0.61, 0.87];

// Safety envelope. Crossing any bound stops the engine and records a trigger.
export const LIMITS = {
  loadMin: 0.02,   // kg
  loadMax: 0.10,
  speedMax: 3.5,   // m/s
  tempMax: 353.15, // 80 C
  pressureMax: 2.5e4 // 25 kPa
};

export const SCENARIOS = {
  normal: {
    label: '正常工况',
    mass: 0.05, damping: 1.6, disturb: 0.012,
    auto: true, gain: { kp: 2.2, kd: 0.12 }
  },
  load: {
    label: '极限载荷',
    mass: 0.12, damping: 1.6, disturb: 0.012,
    auto: true, gain: { kp: 2.2, kd: 0.12 }
  },
  instability: {
    label: '失稳工况',
    mass: 0.05, damping: 0.0, disturb: 0.06,
    auto: false, command: 2.0, gain: { kp: 0.4, kd: 0.0 }
  }
};
