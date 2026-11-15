import { STATION_BY_ID, edgeKey } from "./data.js";
import { reachableStations } from "./pipeline.js";

class MinHeap {
  constructor(compare) {
    this.items = [];
    this.compare = compare;
  }

  push(item) {
    this.items.push(item);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.compare(this.items[parent], item) <= 0) break;
      this.items[index] = this.items[parent];
      index = parent;
    }
    this.items[index] = item;
  }

  pop() {
    if (!this.items.length) return null;
    const root = this.items[0];
    const last = this.items.pop();
    if (this.items.length && last) {
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        if (left >= this.items.length) break;
        let child = left;
        if (
          right < this.items.length &&
          this.compare(this.items[right], this.items[left]) < 0
        ) {
          child = right;
        }
        if (this.compare(this.items[child], last) >= 0) break;
        this.items[index] = this.items[child];
        index = child;
      }
      this.items[index] = last;
    }
    return root;
  }

  get size() {
    return this.items.length;
  }
}

function stateKey(stationId, lineId) {
  return `${stationId}::${lineId}`;
}

function routeCompare(mode, a, b) {
  if (mode === "transfers") {
    return a.transfers - b.transfers || a.minutes - b.minutes;
  }
  return a.minutes - b.minutes || a.transfers - b.transfers;
}

function routeCost(mode, state) {
  return mode === "transfers"
    ? [state.transfers, state.minutes]
    : [state.minutes, state.transfers];
}

function betterThan(mode, candidate, current) {
  if (!current) return true;
  const left = routeCost(mode, candidate);
  const right = routeCost(mode, current);
  return left[0] < right[0] || (left[0] === right[0] && left[1] < right[1]);
}

function buildLegs(segments) {
  const legs = [];
  segments.forEach((segment) => {
    const current = legs[legs.length - 1];
    if (!current || current.lineId !== segment.lineId) {
      legs.push({
        lineId: segment.lineId,
        stations: [segment.from, segment.to],
        rideMinutes: segment.minutes,
        segmentCount: 1
      });
      return;
    }
    current.stations.push(segment.to);
    current.rideMinutes += segment.minutes;
    current.segmentCount += 1;
  });
  return legs.map((leg) => ({
    ...leg,
    rideMinutes: Number(leg.rideMinutes.toFixed(1))
  }));
}

function finalizeRoute(mode, state, originId, destinationId, window) {
  const segments = state.segments;
  const rideMinutes = Number(
    segments.reduce((total, segment) => total + segment.minutes, 0).toFixed(1)
  );
  const transferMinutes = Number(
    (state.transfers * window.transferMinutes).toFixed(1)
  );
  const legs = buildLegs(segments);

  return {
    mode,
    originId,
    destinationId,
    totalMinutes: Number((rideMinutes + transferMinutes).toFixed(1)),
    rideMinutes,
    transferMinutes,
    transfers: state.transfers,
    stops: segments.length,
    segments,
    legs,
    edgeKeys: [...new Set(segments.map((segment) => edgeKey(segment.lineId, segment.from, segment.to)))],
    stationIds: segments.length
      ? [segments[0].from, ...segments.map((segment) => segment.to)]
      : [originId],
    label: mode === "time" ? "最短时间" : "最少换乘"
  };
}

function findRoute(mode, originId, destinationId, window, network) {
  if (!STATION_BY_ID.has(originId) || !STATION_BY_ID.has(destinationId)) return null;
  if (originId === destinationId) {
    return {
      mode,
      originId,
      destinationId,
      totalMinutes: 0,
      rideMinutes: 0,
      transferMinutes: 0,
      transfers: 0,
      stops: 0,
      segments: [],
      legs: [],
      edgeKeys: [],
      stationIds: [originId],
      label: mode === "time" ? "最短时间" : "最少换乘"
    };
  }

  const queue = new MinHeap((a, b) => routeCompare(mode, a, b));
  const best = new Map();
  const originEdges = network.adjacency.get(originId) || [];
  const initialLines = new Set(originEdges.map((edge) => edge.lineId));

  initialLines.forEach((lineId) => {
    const state = {
      stationId: originId,
      lineId,
      minutes: 0,
      transfers: 0,
      segments: []
    };
    best.set(stateKey(originId, lineId), state);
    queue.push(state);
  });

  let destinationState = null;
  while (queue.size) {
    const state = queue.pop();
    const key = stateKey(state.stationId, state.lineId);
    if (best.get(key) !== state) continue;
    if (state.stationId === destinationId && betterThan(mode, state, destinationState)) {
      destinationState = state;
    }

    const edges = network.adjacency.get(state.stationId) || [];
    edges.forEach((edge) => {
      const changingLine = edge.lineId !== state.lineId;
      const next = {
        stationId: edge.to,
        lineId: edge.lineId,
        minutes:
          state.minutes +
          edge.minutes +
          (changingLine ? window.transferMinutes : 0),
        transfers: state.transfers + (changingLine ? 1 : 0),
        segments: [
          ...state.segments,
          {
            from: state.stationId,
            to: edge.to,
            lineId: edge.lineId,
            minutes: edge.minutes,
            transfer: changingLine
          }
        ]
      };
      next.minutes = Number(next.minutes.toFixed(1));
      const nextKey = stateKey(next.stationId, next.lineId);
      if (betterThan(mode, next, best.get(nextKey))) {
        best.set(nextKey, next);
        queue.push(next);
      }
    });
  }

  return destinationState
    ? finalizeRoute(mode, destinationState, originId, destinationId, window)
    : null;
}

export function calculateRoutes(originId, destinationId, window, network) {
  const reachable = reachableStations(originId, network);
  const shortest = findRoute("time", originId, destinationId, window, network);
  const fewest = findRoute("transfers", originId, destinationId, window, network);
  const disconnected = STATION_BY_ID.has(destinationId) && !reachable.has(destinationId)
    ? [...reachable].length
      ? [...new Set([...network.adjacency.keys()])].filter((id) => !reachable.has(id))
      : [...network.adjacency.keys()]
    : [];

  const routeEdgeKeys = new Set();
  [shortest, fewest].filter(Boolean).forEach((route) => {
    route.edgeKeys.forEach((key) => routeEdgeKeys.add(key));
  });

  return {
    originId,
    destinationId,
    reachable,
    disconnected,
    shortest,
    fewest,
    routeEdgeKeys: [...routeEdgeKeys],
    samePath:
      Boolean(shortest && fewest) &&
      shortest.edgeKeys.join("|") === fewest.edgeKeys.join("|")
  };
}
