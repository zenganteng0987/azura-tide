// Cars: the five models Port Azura drives, one shared arcade physics step, the
// collision a car has with the solid city, the deterministic scatter of parked
// cars, and the drawing. A car is plain data — { x, y, angle, speed, model,
// color, parked, driver, health } — where driver is null (nobody), 'player' or
// 'traffic'. Physics moves a car and remembers where it came from
// (prevX/prevY); collideCarWithWorld then decides what the city does to it, so
// the two are always called as a pair, physics first.
import { CITY, SEED } from './config.js';
import { mulberry32, pick } from './random.js';
import { circleHitsBuilding, circleHitsWater, pointInWater } from './world.js';
import { events } from './events.js';

/**
 * The models. Lengths and widths are world units (the road is 76 wide, a lane
 * 38); topSpeed and accel are units per second and per second squared. Colors
 * are the factory paints a model can wear.
 */
export const MODELS = [
  { name: 'Comet Hatch', length: 40, width: 21, topSpeed: 305, accel: 195, corner: 8, colors: ['#e4572e', '#3e9e4f', '#eef0ea', '#26547c'] },
  { name: 'Marina Sedan', length: 48, width: 23, topSpeed: 335, accel: 178, corner: 8, colors: ['#a8d8ea', '#5b7a99', '#e8e3d9', '#843b62'] },
  { name: 'Sol Taxi', length: 48, width: 23, topSpeed: 320, accel: 185, corner: 8, taxi: true, colors: ['#ffc61a', '#ffb400'] },
  { name: 'Dune Pickup', length: 52, width: 25, topSpeed: 292, accel: 168, corner: 6, pickup: true, colors: ['#c96f2e', '#7a8b5a', '#4a4a52'] },
  { name: 'Cargo Van', length: 57, width: 26, topSpeed: 262, accel: 142, corner: 4, colors: ['#e8e3d9', '#9fb4c7', '#d95f43'] },
  { name: 'PAPD Interceptor', length: 50, width: 24, topSpeed: 345, accel: 205, corner: 8, police: true, colors: ['#f4f6f8'] },
];

/** Every model a civilian can own: the Interceptor is police issue only. */
export const CIVILIAN_MODELS = MODELS.filter((m) => !m.police);

/** Look a model up by name; the traffic and parked spawners pick from MODELS. */
export function modelByName(name) {
  return MODELS.find((m) => m.name === name) || MODELS[0];
}

/**
 * A fresh car standing still. Color comes from the model's paints, chosen by
 * the caller's rng stream when one is passed (so spawns stay seeded), else the
 * first paint.
 */
export function createCar(model, x, y, angle, rng) {
  return {
    x,
    y,
    prevX: x,
    prevY: y,
    angle,
    speed: 0,
    model,
    color: rng ? pick(rng, model.colors) : model.colors[0],
    parked: false,
    driver: null,
    health: 100,
    braking: false,
  };
}

/** How far a parked car's centre sits from its road's centre line: at the curb. */
const PARK_OFFSET = CITY.roadWidth / 2 + 4;

/** True when either of the car's two body circles touches building or water. */
function hitsAt(x, y, angle, car) {
  const f = car.model.length * 0.28;
  const r = car.model.width / 2 + 1;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return (
    circleHitsBuilding(x + c * f, y + s * f, r) ||
    circleHitsWater(x + c * f, y + s * f, r) ||
    circleHitsBuilding(x - c * f, y - s * f, r) ||
    circleHitsWater(x - c * f, y - s * f, r)
  );
}

/**
 * The parked cars of Port Azura, placed by a seeded stream (SEED + 1, its own
 * stream so the city generator's sequence is untouched): parallel at the curb
 * along both road orientations, clear of the crossings, plus a couple near
 * each landmark where a visitor would leave one. Deterministic — same cars,
 * same places, every load.
 */
export function spawnParkedCars(world) {
  const rng = mulberry32(SEED + 1);
  const cars = [];
  const { vertical, horizontal } = world.ROAD_LINES;
  const clearOfOthers = (x, y) => cars.every((c) => Math.hypot(c.x - x, c.y - y) > 44);
  const place = (model, x, y, angle) => {
    if (pointInWater(x, y) || !clearOfOthers(x, y)) return;
    const car = createCar(model, x, y, angle, rng);
    car.parked = true;
    cars.push(car);
  };
  // Along the vertical avenues: a car or two in most block segments.
  for (const line of vertical) {
    for (let j = 0; j < horizontal.length - 1; j += 1) {
      if (rng() < 0.48) continue;
      const y0 = horizontal[j];
      const y1 = horizontal[j + 1];
      const count = rng() < 0.3 ? 2 : 1;
      for (let n = 0; n < count; n += 1) {
        const side = rng() < 0.5 ? -1 : 1;
        const x = line + side * PARK_OFFSET;
        const y = y0 + 70 + rng() * (y1 - y0 - 140);
        place(pick(rng, CIVILIAN_MODELS), x, y, rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
      }
    }
  }
  // Along the horizontal streets the same way; the promenade only west of the
  // bay, where its asphalt actually runs.
  for (const line of horizontal) {
    for (let i = 0; i < vertical.length - 1; i += 1) {
      const x0 = vertical[i];
      const x1 = vertical[i + 1];
      if (line === CITY.beachY && (x0 + x1) / 2 > CITY.bay.x - 60) continue;
      if (rng() < 0.48) continue;
      const count = rng() < 0.3 ? 2 : 1;
      for (let n = 0; n < count; n += 1) {
        const side = rng() < 0.5 ? -1 : 1;
        const x = x0 + 70 + rng() * (x1 - x0 - 140);
        const y = line + side * PARK_OFFSET;
        place(pick(rng, CIVILIAN_MODELS), x, y, rng() < 0.5 ? 0 : Math.PI);
      }
    }
  }
  // Near the landmarks: one on the nearest avenue, one on the nearest street.
  for (const mark of world.LANDMARKS) {
    const vx = vertical.reduce((a, b) => (Math.abs(b - mark.x) < Math.abs(a - mark.x) ? b : a));
    const hy = horizontal.reduce((a, b) => (Math.abs(b - mark.y) < Math.abs(a - mark.y) ? b : a));
    const sideA = rng() < 0.5 ? -1 : 1;
    place(pick(rng, CIVILIAN_MODELS), vx + sideA * PARK_OFFSET, Math.max(120, Math.min(CITY.beachY - 90, mark.y + (rng() * 70 - 35))), rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
    const sideB = rng() < 0.5 ? -1 : 1;
    place(pick(rng, CIVILIAN_MODELS), Math.max(120, Math.min(2920, mark.x + (rng() * 70 - 35))), hy + sideB * PARK_OFFSET, rng() < 0.5 ? 0 : Math.PI);
  }
  return cars;
}

const BRAKE_DECEL = 350;
/** The impact speed (units/s) above which a wall hit is a crime-scene crash. */
const HARD_HIT = 175;

/**
 * Advance one car by dt under an input of { throttle, brake, steer }, each
 * 0/1 (steer -1..1). Arcade rules: throttle pulls toward the model's top
 * speed, brake scrubs speed and then reverses at a third of top speed,
 * steering bites harder the faster the car rolls (and not at all standing
 * still), and drag always bleeds a little. The car's position integrates
 * here; call collideCarWithWorld right after to settle it against the city.
 */
export function updateCarPhysics(car, input, dt) {
  const m = car.model;
  car.prevX = car.x;
  car.prevY = car.y;
  car.braking = !!input.brake && car.speed > -8;
  if (input.throttle) {
    car.speed = Math.min(m.topSpeed, car.speed + m.accel * dt);
  } else if (input.brake) {
    if (car.speed > 6) car.speed = Math.max(0, car.speed - BRAKE_DECEL * dt);
    else car.speed = Math.max(-m.topSpeed * 0.32, car.speed - m.accel * 0.55 * dt);
  } else {
    // Coasting: engine braking and drag ease the car toward a stop.
    const ease = 46 * dt + Math.abs(car.speed) * 0.35 * dt;
    car.speed = Math.abs(car.speed) <= ease ? 0 : car.speed - Math.sign(car.speed) * ease;
  }
  if (input.steer && car.speed !== 0) {
    const rolling = Math.min(Math.abs(car.speed) / 95, 1);
    const faded = Math.abs(car.speed) > m.topSpeed * 0.78 ? 0.72 : 1;
    car.angle += input.steer * 2.55 * rolling * faded * dt * (car.speed < 0 ? -1 : 1);
  }
  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;
}

/** A graze along a wall: keep the clean axis of the move, bleed speed. */
function scrape(car, impact) {
  car.speed *= 0.5;
  if (impact > 115) {
    car.health = Math.max(0, car.health - 2);
    events.emit('carHit', { car, x: car.x, y: car.y, speed: impact, hard: false });
  }
}

/**
 * Settle a car against buildings and water after physics moved it. A clean
 * move passes untouched; a blocked one first tries to slide along each axis;
 * a fully blocked one stops where it was, and if it arrived faster than
 * HARD_HIT it dents the car's health, bounces it gently, and reports the
 * crash: 'carHit' for any solid hit worth hearing, and a 'crime' event when
 * the player was driving. Returns true when the car touched anything.
 */
export function collideCarWithWorld(car) {
  if (!hitsAt(car.x, car.y, car.angle, car)) return false;
  const impact = Math.abs(car.speed);
  if (!hitsAt(car.x, car.prevY, car.angle, car)) {
    car.y = car.prevY;
    scrape(car, impact);
    return true;
  }
  if (!hitsAt(car.prevX, car.y, car.angle, car)) {
    car.x = car.prevX;
    scrape(car, impact);
    return true;
  }
  car.x = car.prevX;
  car.y = car.prevY;
  if (impact > HARD_HIT) {
    car.health = Math.max(0, car.health - Math.min(22, 6 + (impact - HARD_HIT) / 14));
    car.speed = -car.speed * 0.22;
    if (car.driver === 'player') {
      events.emit('crime', { type: 'collision', x: car.x, y: car.y, speed: impact });
    }
    events.emit('carHit', { car, x: car.x, y: car.y, speed: impact, hard: true });
  } else {
    car.speed *= 0.2;
    if (impact > 60) events.emit('carHit', { car, x: car.x, y: car.y, speed: impact, hard: false });
  }
  return true;
}

/** Lighten (positive amount) or darken a #rrggbb colour, for roofs and beds. */
function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const cl = (v) => Math.max(0, Math.min(255, v));
  const r = cl((n >> 16) + amount);
  const g = cl(((n >> 8) & 0xff) + amount);
  const b = cl((n & 0xff) + amount);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Paint one car in world space (the caller holds the camera transform).
 * `night` asks for the headlight cones; brake lights flare whenever the
 * car's braking flag is set, and a well-dented car wears its scuffs.
 */
export function drawCar(ctx, car, night) {
  const { length: L, width: W } = car.model;
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);
  // Headlight cones first, so the body sits over their roots. Two passes —
  // a wide faint wash and a brighter core inside it — because the day tint
  // is laid over the whole world afterwards and eats half their light; a
  // single faint cone all but vanishes under the night wash.
  if (night) {
    for (const side of [-1, 1]) {
      ctx.fillStyle = 'rgba(255, 240, 190, 0.17)';
      ctx.beginPath();
      ctx.moveTo(L / 2 - 2, side * (W / 2 - 5));
      ctx.lineTo(L / 2 + 118, side * (W / 2 + 18));
      ctx.lineTo(L / 2 + 118, side * (W / 2 - 30));
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 246, 205, 0.16)';
      ctx.beginPath();
      ctx.moveTo(L / 2 - 2, side * (W / 2 - 5));
      ctx.lineTo(L / 2 + 74, side * (W / 2 + 4));
      ctx.lineTo(L / 2 + 74, side * (W / 2 - 16));
      ctx.closePath();
      ctx.fill();
    }
  }
  // Shadow, then wheels peeking out at the corners.
  ctx.fillStyle = 'rgba(30, 25, 15, 0.3)';
  ctx.beginPath();
  ctx.ellipse(3, 5, L / 2, W / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1d1d22';
  for (const wx of [-L * 0.33, L * 0.33]) {
    for (const wy of [-W / 2 - 1, W / 2 - 3]) {
      ctx.fillRect(wx - 6, wy, 13, 4);
    }
  }
  // Body and its outline.
  ctx.fillStyle = car.color;
  ctx.beginPath();
  ctx.roundRect(-L / 2, -W / 2, L, W, car.model.corner);
  ctx.fill();
  ctx.strokeStyle = 'rgba(30, 25, 20, 0.4)';
  ctx.lineWidth = 1.6;
  ctx.stroke();
  if (car.model.pickup) {
    // The open bed: a darker tray over the rear half.
    ctx.fillStyle = shade(car.color, -34);
    ctx.fillRect(-L / 2 + 4, -W / 2 + 4, L * 0.4, W - 8);
  }
  // Roof, windshield band across its front, rear glass behind.
  ctx.fillStyle = shade(car.color, -16);
  ctx.beginPath();
  ctx.roundRect(-L * 0.16, -W * 0.34, L * 0.4, W * 0.68, 5);
  ctx.fill();
  ctx.fillStyle = 'rgba(168, 216, 230, 0.92)';
  ctx.fillRect(L * 0.15, -W * 0.34, L * 0.08, W * 0.68);
  ctx.fillStyle = 'rgba(90, 130, 150, 0.85)';
  ctx.fillRect(-L * 0.23, -W * 0.3, L * 0.06, W * 0.6);
  if (car.model.taxi) {
    ctx.fillStyle = '#fff7e0';
    ctx.fillRect(-L * 0.03, -W * 0.14, L * 0.11, W * 0.28);
    ctx.strokeStyle = 'rgba(30, 25, 20, 0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(-L * 0.03, -W * 0.14, L * 0.11, W * 0.28);
  }
  if (car.model.police) {
    // The PAPD livery: a blue band down each flank, and across the roof a
    // light bar whose red and blue halves trade the flash while the car is
    // on duty (driver 'police'); off duty both halves sit dim.
    ctx.fillStyle = '#2456c8';
    ctx.fillRect(-L / 2 + 3, -W / 2 + 2.2, L - 6, 3.4);
    ctx.fillRect(-L / 2 + 3, W / 2 - 5.6, L - 6, 3.4);
    const active = car.driver === 'police';
    const phase = Math.floor(performance.now() / 240 + car.x * 0.017 + car.y * 0.011) % 2 === 0;
    ctx.fillStyle = '#20242c';
    ctx.fillRect(-3.4, -W * 0.38, 6.8, W * 0.76);
    for (const side of [-1, 1]) {
      const redHalf = side < 0;
      const lit = active && (phase === redHalf);
      ctx.save();
      if (lit) {
        ctx.shadowColor = redHalf ? '#ff3524' : '#2e7bff';
        ctx.shadowBlur = 13;
      }
      ctx.fillStyle = redHalf
        ? lit ? '#ff3524' : 'rgba(255, 53, 36, 0.4)'
        : lit ? '#2e7bff' : 'rgba(46, 123, 255, 0.4)';
      ctx.fillRect(-2.6, side < 0 ? -W * 0.36 : 1, 5.2, W * 0.35);
      ctx.restore();
    }
  }
  // Headlights, with a glow at night.
  for (const side of [-1, 1]) {
    if (night) {
      ctx.fillStyle = 'rgba(255, 246, 201, 0.35)';
      ctx.beginPath();
      ctx.arc(L / 2 - 1, side * (W / 2 - 5), 5.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#fff6c9';
    ctx.beginPath();
    ctx.arc(L / 2 - 1, side * (W / 2 - 5), 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  // Brake lights: dim red at rest, flaring while the brake is on.
  for (const side of [-1, 1]) {
    if (car.braking) {
      ctx.save();
      ctx.shadowColor = '#ff2a1e';
      ctx.shadowBlur = 9;
      ctx.fillStyle = '#ff2a1e';
      ctx.fillRect(-L / 2 - 1, side * (W / 2 - 5) - 2, 3.4, 4.4);
      ctx.restore();
    } else {
      ctx.fillStyle = '#8c1f1a';
      ctx.fillRect(-L / 2 - 1, side * (W / 2 - 5) - 1.6, 3, 3.6);
    }
  }
  // Scuffs once the car has taken real knocks.
  if (car.health < 65) {
    ctx.fillStyle = `rgba(35, 30, 25, ${(0.65 - car.health / 100) * 0.8})`;
    ctx.beginPath();
    ctx.ellipse(L * 0.3, -W * 0.28, L * 0.13, W * 0.16, 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-L * 0.22, W * 0.3, L * 0.1, W * 0.13, -0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
