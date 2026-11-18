// Traffic: the other drivers of Port Azura. Each traffic car follows a route —
// one road line from world.ROAD_LINES, one direction — holding the right-hand
// lane, slowing for whoever is ahead in its corridor, and sometimes turning
// onto the crossing road at an intersection (always turning at the last
// crossing, so nobody drives off the end of the world onto the sand). Cars
// are ordinary vehicles.js cars with driver 'traffic', steered by feeding
// the shared physics gentle throttle/brake/steer inputs aimed at a target
// point down the lane. The system keeps about fourteen cars alive near the
// player: spawn off-screen a few blocks away, despawn past 900 units.
import { CITY, SEED } from './config.js';
import { mulberry32, pick, range } from './random.js';
import { ROAD_LINES } from './world.js';
import { CIVILIAN_MODELS, collideCarWithWorld, createCar, updateCarPhysics } from './vehicles.js';

/** Lane centre offset from the road's centre line: half of a driving lane. */
const LANE = CITY.roadWidth / 4;
const MAX_TRAFFIC = 14;
const DESPAWN_DIST = 900;
const SPAWN_MIN = 500;
const SPAWN_MAX = 880;

/** Fresh traffic state: the live route entries plus this system's rng stream. */
export function createTraffic() {
  return { entries: [], rng: mulberry32(SEED + 7), spawnTimer: 0 };
}

/** How many cars the traffic system is currently driving. */
export function trafficCount(state) {
  return state.entries.length;
}

/**
 * Take a car out of traffic control — the player just got in. The car stays
 * in the shared cars array; it simply stops receiving traffic inputs.
 */
export function claimTrafficCar(state, car) {
  const i = state.entries.findIndex((e) => e.car === car);
  if (i >= 0) state.entries.splice(i, 1);
}

function headingFor(kind, dir) {
  if (kind === 'v') return dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  return dir > 0 ? 0 : Math.PI;
}

/** The fixed-axis coordinate of the right-hand lane centre on a road. */
function laneCoord(kind, line, dir) {
  // Facing along travel, the right-hand lane sits a quarter road-width to the
  // right: west of the line going south, east going north, and mirrored for
  // the horizontal streets.
  return kind === 'v' ? line - dir * LANE : line + dir * LANE;
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * The last crossing a route may use in its direction. The promenade does not
 * reach the bay, so routes that would end on it turn one street earlier.
 */
function lastCrossing(kind, line, dir) {
  if (kind === 'v') {
    const usable = ROAD_LINES.horizontal.filter((y) => !(y === CITY.beachY && line >= CITY.bay.x));
    return dir > 0 ? usable[usable.length - 1] : usable[0];
  }
  const usable = ROAD_LINES.vertical.filter((x) => !(line === CITY.beachY && x >= CITY.bay.x));
  return dir > 0 ? usable[usable.length - 1] : usable[0];
}

/** The next crossing ahead of a route's car, or null when the road runs out. */
function nextCrossing(entry) {
  const lines = entry.kind === 'v' ? ROAD_LINES.horizontal : ROAD_LINES.vertical;
  const pos = entry.kind === 'v' ? entry.car.y : entry.car.x;
  let best = null;
  for (const c of lines) {
    const d = (c - pos) * entry.dir;
    if (d > 6 && (best === null || d < best.dist)) best = { coord: c, dist: d };
  }
  return best;
}

function spawnOne(state, cars, focus) {
  const rng = state.rng;
  for (let tries = 0; tries < 9; tries += 1) {
    const kind = rng() < 0.5 ? 'v' : 'h';
    const line = pick(rng, kind === 'v' ? ROAD_LINES.vertical : ROAD_LINES.horizontal);
    const dir = rng() < 0.5 ? 1 : -1;
    const along =
      kind === 'v'
        ? range(rng, 150, CITY.beachY - 60)
        : range(rng, 150, line === CITY.beachY ? CITY.bay.x - 120 : 2920);
    const lane = laneCoord(kind, line, dir);
    const x = kind === 'v' ? lane : along;
    const y = kind === 'v' ? along : lane;
    const dist = Math.hypot(x - focus.x, y - focus.y);
    if (dist < SPAWN_MIN || dist > SPAWN_MAX) continue;
    if (cars.some((c) => Math.hypot(c.x - x, c.y - y) < 58)) continue;
    const car = createCar(pick(rng, CIVILIAN_MODELS), x, y, headingFor(kind, dir), rng);
    car.driver = 'traffic';
    const cruise = range(rng, 105, 185);
    car.speed = cruise * 0.7;
    cars.push(car);
    state.entries.push({ car, kind, line, dir, cruise, turn: null, decidedFor: null });
    return;
  }
}

/** Steer one traffic car for a step: pick inputs, run physics, settle it. */
function driveEntry(state, entry, cars, dt) {
  const car = entry.car;
  let tx;
  let ty;
  if (entry.turn) {
    tx = entry.turn.tx;
    ty = entry.turn.ty;
  } else if (entry.kind === 'v') {
    tx = laneCoord('v', entry.line, entry.dir);
    ty = car.y + entry.dir * 150;
  } else {
    tx = car.x + entry.dir * 150;
    ty = laneCoord('h', entry.line, entry.dir);
  }
  const diff = wrapAngle(Math.atan2(ty - car.y, tx - car.x) - car.angle);
  const steer = Math.max(-1, Math.min(1, diff * 2.4));

  if (!entry.turn) {
    const next = nextCrossing(entry);
    if (next && next.dist < 58 && entry.decidedFor !== next.coord) {
      entry.decidedFor = next.coord;
      const forced = next.coord === lastCrossing(entry.kind, entry.line, entry.dir);
      if (forced || state.rng() < 0.36) {
        const newDir = state.rng() < 0.5 ? 1 : -1;
        let ttx;
        let tty;
        if (entry.kind === 'v') {
          ttx = entry.line + newDir * 115;
          tty = laneCoord('h', next.coord, newDir);
        } else {
          ttx = laneCoord('v', next.coord, newDir);
          tty = entry.line + newDir * 115;
        }
        entry.turn = { kind: entry.kind === 'v' ? 'h' : 'v', line: next.coord, dir: newDir, tx: ttx, ty: tty };
      }
    }
  } else {
    const settled = Math.abs(wrapAngle(headingFor(entry.turn.kind, entry.turn.dir) - car.angle)) < 0.38;
    const pastCorner = Math.hypot(entry.turn.tx - car.x, entry.turn.ty - car.y) < 120;
    if (settled && pastCorner) {
      entry.kind = entry.turn.kind;
      entry.line = entry.turn.line;
      entry.dir = entry.turn.dir;
      entry.turn = null;
      entry.decidedFor = null;
    }
  }

  // Cruise speed, eased into corners, and capped by whoever is ahead.
  let desired = entry.cruise * (1 - Math.min(Math.abs(diff), 1.1) / 3);
  for (const other of cars) {
    if (other === car) continue;
    const dx = other.x - car.x;
    const dy = other.y - car.y;
    const fwd = dx * Math.cos(car.angle) + dy * Math.sin(car.angle);
    const lat = -dx * Math.sin(car.angle) + dy * Math.cos(car.angle);
    if (fwd > 0 && fwd < 92 && Math.abs(lat) < 14) {
      const gap = fwd - (car.model.length + other.model.length) / 2;
      if (gap < 30) desired = Math.min(desired, Math.max(0, other.speed - 14));
      else if (gap < 58) desired = Math.min(desired, other.speed);
    }
  }

  const input = { throttle: 0, brake: 0, steer };
  if (car.speed < desired - 3) input.throttle = 1;
  else if (car.speed > desired + 3 && car.speed > 5) input.brake = 1;
  if (desired <= 1 && car.speed > -0.1 && car.speed < 8) {
    // Holding still behind someone: settle to a stop instead of creeping
    // into reverse through the brake pedal.
    input.throttle = 0;
    input.brake = 0;
    car.speed = Math.max(0, car.speed - 260 * dt);
  }
  updateCarPhysics(car, input, dt);
  collideCarWithWorld(car);
}

/**
 * Advance every traffic car and keep the population topped up around the
 * focus point (the player). `cars` is the shared array every car lives in;
 * spawns are pushed into it and despawns spliced out of it.
 */
export function updateTraffic(state, cars, dt, focus) {
  state.spawnTimer -= dt;
  if (state.entries.length < MAX_TRAFFIC && state.spawnTimer <= 0) {
    state.spawnTimer = 0.35;
    spawnOne(state, cars, focus);
  }
  for (let i = state.entries.length - 1; i >= 0; i -= 1) {
    const entry = state.entries[i];
    const car = entry.car;
    if (car.driver !== 'traffic' || Math.hypot(car.x - focus.x, car.y - focus.y) > DESPAWN_DIST) {
      const at = cars.indexOf(car);
      if (at >= 0 && car.driver === 'traffic') cars.splice(at, 1);
      state.entries.splice(i, 1);
      continue;
    }
    driveEntry(state, entry, cars, dt);
  }
}
