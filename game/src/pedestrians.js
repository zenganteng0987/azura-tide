// Pedestrians: the people of Port Azura, strolling the sidewalks and the
// beach promenade. Each one walks a segment — along one road's sidewalk
// between two crossings, or along the sand — and turns around at its ends.
// They have three states beyond walking: 'flee' (scarePeds sends everyone
// near a point running from it for a few seconds, then they walk back to
// their segment), and 'down' (the player's car put them there: a 'crime'
// event, a few seconds on the ground, then they get up somewhere else).
// The module remembers the live crowd, so scarePeds(x, y, radius) needs no
// list — Session C calls it when something loud or violent happens nearby.
import { CITY, SEED } from './config.js';
import { mulberry32, pick, range } from './random.js';
import { ROAD_LINES, circleHitsBuilding, circleHitsWater } from './world.js';
import { events } from './events.js';

const MAX_PEDS = 24;
/** Sidewalk centre: just outside the road's edge, inside the sidewalk band. */
const WALK_OFFSET = CITY.roadWidth / 2 + 8;

const SHIRTS = ['#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#f78c6b', '#c3a6f2', '#f2f2f2', '#84cc16'];
const PANTS = ['#2b2d42', '#5a4a3a', '#3d5a80', '#6b705c', '#22223b'];
const SKINS = ['#f2c79b', '#c68863', '#8d5524', '#ffdbac'];

// The spawn stream runs for the whole session: createPeds draws the first
// crowd from it and later respawns keep drawing, so the sequence never
// repeats a person exactly.
const spawnStream = mulberry32(SEED + 3);
const runtimeStream = mulberry32(SEED + 11);

/** The live crowd, registered by createPeds so scarePeds can find it. */
let active = [];

/** A fresh pedestrian at a seeded spot: mostly sidewalks, some on the sand. */
function spawnPed() {
  const rng = spawnStream;
  let axis;
  let lane;
  let min;
  let max;
  if (rng() < 0.28) {
    // The beach promenade: a stroll along the sand south of the shore road.
    axis = 'x';
    lane = CITY.beachY + range(rng, 52, 120);
    min = 140;
    max = CITY.bay.x - 140;
  } else if (rng() < 0.5) {
    axis = 'y';
    const line = pick(rng, ROAD_LINES.vertical);
    lane = line + (rng() < 0.5 ? -WALK_OFFSET : WALK_OFFSET);
    const j = Math.floor(rng() * (ROAD_LINES.horizontal.length - 1));
    min = ROAD_LINES.horizontal[j] + 12;
    max = ROAD_LINES.horizontal[j + 1] - 12;
  } else {
    axis = 'x';
    const line = pick(rng, ROAD_LINES.horizontal);
    lane = line + (rng() < 0.5 ? -WALK_OFFSET : WALK_OFFSET);
    const i = Math.floor(rng() * (ROAD_LINES.vertical.length - 1));
    min = ROAD_LINES.vertical[i] + 12;
    max = ROAD_LINES.vertical[i + 1] - 12;
    if (line === CITY.beachY) max = Math.min(max, CITY.bay.x - 30);
  }
  const pos = range(rng, min + 16, max - 16);
  return {
    x: axis === 'x' ? pos : lane,
    y: axis === 'x' ? lane : pos,
    axis,
    lane,
    min,
    max,
    pos,
    dir: rng() < 0.5 ? 1 : -1,
    speed: range(rng, 52, 88),
    angle: 0,
    phase: range(rng, 0, Math.PI * 2),
    state: 'walk',
    timer: 0,
    alpha: 1,
    fleeX: 0,
    fleeY: 0,
    shirt: pick(rng, SHIRTS),
    pants: pick(rng, PANTS),
    skin: pick(rng, SKINS),
  };
}

/** The crowd: up to MAX_PEDS fresh pedestrians, registered for scarePeds. */
export function createPeds() {
  active = [];
  for (let i = 0; i < MAX_PEDS; i += 1) active.push(spawnPed());
  return active;
}

/**
 * Put one pedestrian on the ground: the same 'down' state a car hit causes —
 * a few seconds lying where they fell, fading at the end, then they get up
 * somewhere else as somebody new. Combat calls this for fists and bullets;
 * the car-hit code below calls it too, so there is only one way to fall.
 */
export function knockDownPed(ped) {
  if (ped.state === 'down') return;
  ped.state = 'down';
  ped.timer = 4.5;
  ped.alpha = 1;
}

/**
 * Send every walking pedestrian within `radius` of (x, y) fleeing from that
 * point for a few seconds. Downed pedestrians stay down. Session C calls
 * this for gunfire, crashes and explosions.
 */
export function scarePeds(x, y, radius) {
  for (const ped of active) {
    if (ped.state === 'down') continue;
    if (Math.hypot(ped.x - x, ped.y - y) <= radius) {
      ped.state = 'flee';
      ped.fleeX = x;
      ped.fleeY = y;
      ped.timer = range(runtimeStream, 2.2, 3.8);
    }
  }
}

/** Move a pedestrian, sliding along whatever blocks one axis, or not at all. */
function slideMove(ped, dx, dy) {
  const r = 6;
  if (!circleHitsBuilding(ped.x + dx, ped.y, r) && !circleHitsWater(ped.x + dx, ped.y, r)) ped.x += dx;
  if (!circleHitsBuilding(ped.x, ped.y + dy, r) && !circleHitsWater(ped.x, ped.y + dy, r)) ped.y += dy;
}

function updatePed(ped, dt) {
  if (ped.state === 'down') {
    ped.timer -= dt;
    ped.alpha = ped.timer < 1.6 ? Math.max(0, ped.timer / 1.6) : 1;
    if (ped.timer <= 0) Object.assign(ped, spawnPed());
    return;
  }
  if (ped.state === 'flee') {
    ped.timer -= dt;
    const away = Math.atan2(ped.y - ped.fleeY, ped.x - ped.fleeX);
    ped.angle = away;
    const step = 245 * dt;
    slideMove(ped, Math.cos(away) * step, Math.sin(away) * step);
    ped.phase += dt * 16;
    if (ped.timer <= 0) ped.state = 'return';
    return;
  }
  if (ped.state === 'return') {
    // Head back to the nearest point of the home segment, then resume it.
    const tx = ped.axis === 'x' ? Math.max(ped.min, Math.min(ped.pos, ped.max)) : ped.lane;
    const ty = ped.axis === 'x' ? ped.lane : Math.max(ped.min, Math.min(ped.pos, ped.max));
    const dx = tx - ped.x;
    const dy = ty - ped.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 7) {
      ped.x = tx;
      ped.y = ty;
      ped.pos = ped.axis === 'x' ? tx : ty;
      ped.state = 'walk';
    } else {
      ped.angle = Math.atan2(dy, dx);
      const step = Math.min(dist, ped.speed * 1.4 * dt);
      slideMove(ped, (dx / dist) * step, (dy / dist) * step);
      ped.phase += dt * 9;
    }
    return;
  }
  // Walking the segment: advance, and turn around at either end.
  ped.pos += ped.dir * ped.speed * dt;
  if (ped.pos > ped.max) {
    ped.pos = ped.max;
    ped.dir = -1;
  } else if (ped.pos < ped.min) {
    ped.pos = ped.min;
    ped.dir = 1;
  }
  if (ped.axis === 'x') {
    ped.x = ped.pos;
    ped.y = ped.lane;
    ped.angle = ped.dir > 0 ? 0 : Math.PI;
  } else {
    ped.x = ped.lane;
    ped.y = ped.pos;
    ped.angle = ped.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  }
  ped.phase += dt * ped.speed * 0.055;
}

/**
 * Advance the whole crowd. When the player's car is moving and touches a
 * pedestrian, that is a hit: a 'crime' event with type 'pedHit', the
 * pedestrian goes down, and the neighbours scatter.
 */
export function updatePeds(peds, dt, playerCar) {
  if (playerCar && playerCar.driver === 'player' && Math.abs(playerCar.speed) > 26) {
    const c = Math.cos(playerCar.angle);
    const s = Math.sin(playerCar.angle);
    for (const ped of peds) {
      if (ped.state === 'down') continue;
      const dx = ped.x - playerCar.x;
      const dy = ped.y - playerCar.y;
      const lx = dx * c + dy * s;
      const ly = -dx * s + dy * c;
      if (Math.abs(lx) < playerCar.model.length / 2 + 5 && Math.abs(ly) < playerCar.model.width / 2 + 5) {
        knockDownPed(ped);
        events.emit('crime', { type: 'pedHit', x: ped.x, y: ped.y });
        scarePeds(ped.x, ped.y, 140);
      }
    }
  }
  for (const ped of peds) updatePed(ped, dt);
}

/**
 * Paint one pedestrian in world space: a shadow, two legs swinging against
 * each other as they walk, a shirt, a head. A downed pedestrian lies along
 * their facing, fading out at the end of their time on the ground.
 */
export function drawPed(ctx, ped) {
  ctx.save();
  if (ped.alpha < 1) ctx.globalAlpha = ped.alpha;
  ctx.fillStyle = 'rgba(30, 25, 15, 0.28)';
  ctx.beginPath();
  ctx.ellipse(ped.x + 2, ped.y + 3, 6.4, 4.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.translate(ped.x, ped.y);
  ctx.rotate(ped.angle);
  if (ped.state === 'down') {
    ctx.fillStyle = ped.pants;
    ctx.fillRect(-13, -2.4, 8, 4.8);
    ctx.fillStyle = ped.shirt;
    ctx.beginPath();
    ctx.ellipse(0, 0, 7.5, 4.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = ped.skin;
    ctx.beginPath();
    ctx.arc(10, 0, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  // Legs: two short strokes swinging in opposite phase along the facing.
  const swing = Math.sin(ped.phase) * 4.6;
  ctx.strokeStyle = ped.pants;
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, -2.2);
  ctx.lineTo(swing, -2.6);
  ctx.moveTo(0, 2.2);
  ctx.lineTo(-swing, 2.6);
  ctx.stroke();
  ctx.fillStyle = ped.shirt;
  ctx.beginPath();
  ctx.arc(0, 0, 6.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = ped.skin;
  ctx.beginPath();
  ctx.arc(1.6, 0, 3.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
