import { EVENT } from './config.js';

export function emit(state, type, detail = {}) {
  const event = {
    id: state.events.length + 1,
    tick: state.tick,
    time: Number(state.time.toFixed(3)),
    round: state.round.index + 1,
    type,
    detail
  };
  state.events.push(event);
  return event;
}

export const CONFLICT_EVENTS = new Set([
  EVENT.CONFLICT_UNLOCKED_INSTALL,
  EVENT.CONFLICT_OFFSET_INSTALL,
  EVENT.CONFLICT_TIMEOUT,
  EVENT.GASKET_CRUSH
]);

export function isConflict(type) {
  return CONFLICT_EVENTS.has(type);
}
