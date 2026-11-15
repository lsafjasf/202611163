/* Calibration persistence with safe localStorage fallback. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.GyroStorage = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const KEY = "gyro.calibration.v1";
  const memory = new Map();

  function store() {
    try {
      if (typeof localStorage !== "undefined") return localStorage;
    } catch (e) {
      /* restricted context */
    }
    return {
      getItem: (k) => (memory.has(k) ? memory.get(k) : null),
      setItem: (k, v) => memory.set(k, String(v))
    };
  }

  return {
    save(record) {
      const payload = {
        params: record.params,
        savedAt: new Date().toISOString(),
        note: record.note || ""
      };
      store().setItem(KEY, JSON.stringify(payload));
      return payload;
    },
    load() {
      const raw = store().getItem(KEY);
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch (e) {
        return null;
      }
    },
    clear() {
      store().setItem(KEY, "");
    }
  };
});
