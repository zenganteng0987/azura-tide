// The Port Azura Police Department: Interceptors that answer the wanted
// stars. The system keeps as many units on the street as the player has
// stars — none at zero, up to five — spawning them on roads far enough away
// to arrive as a response rather than materialise. A unit drives at the
// player's last seen position: it steers down the road network's grain by
// aiming its nose, the same waypoint steering traffic uses, and it only
// knows where the player is while it can actually see them (near, and no
// building in the way), which is also what holds the wanted system's `seen`
// flag up. At three stars and up, a unit that has pulled up close with a
// clear shot fires slow pistol rounds through combat.js. And a unit that
// corners a slow player — on foot beside the car, or boxed in behind the
// wheel — fills the bust meter; a full meter ends the chase the legal way.
import { CITY, SEED } from './config.js';
import { mulberry32, range } from './random.js';
import { ROAD_LINES, city, circleHitsBuilding, pointInWater } from './world.js';
import { collideCarWithWorld, createCar, modelByName, updateCarPhysics } from './vehicles.js';
import { events } from './events.js';

/** How far a unit can see, in world units, when no building blocks the view. */
const SIGHT_RANGE = 520;
/** Seconds without a sighting before a unit falls back to searching the last seen spot. */
const SEARCH_AFTER = 8;
/** The lane centre offset from a road's centre line, traffic's convention. */
const LANE = CITY.roadWidth / 4;
const SPAWN_MIN = 700;
const SPAWN_MAX = 1000;

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/** True when a building stands anywhere along the segment (x1, y1)-(x2, y2). */
function segmentBlocked(x1, y1, x2, y2) {
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.max(1, Math.floor(dist / 55));
  for (let i = 1; i < steps; i += 1) {
    const px = x1 + ((x2 - x1) * i) / steps;
    const py = y1 + ((y2 - y1) * i) / steps;
    for (const b of city.buildings) {
      if (px > b.x && px < b.x + b.w && py > b.y && py < b.y + b.h) return true;
    }
  }
  return false;
}

/**
 * A fresh police system. `cars` is the shared array every car in the city
 * lives in — units are ordinary vehicles.js cars with driver 'police',
 * pushed into it and spliced back out. `wanted` is read for the star count
 * and written for its `seen` flag; `combat` lends its projectile system for
 * the units' pistols.
 */
export function createPolice({ cars, wanted, combat }) {
  const police = {
    units: [],
    /** How close the law is to ending the chase: 0 calm, 1 busted. */
    bust: 0,
    rng: mulberry32(SEED + 21),
    spawnTimer: 0,
    bustFired: false,
    prevPlayerX: null,
    prevPlayerY: null,
    footSpeed: 0,

    update(dt, player, playerCar) {
      stepPopulation(dt, player);
      let anySight = false;
      for (let i = police.units.length - 1; i >= 0; i -= 1) {
        const unit = police.units[i];
        if (unit.car.driver !== 'police') {
          // Somebody stole the Interceptor. The unit is simply over.
          police.units.splice(i, 1);
          continue;
        }
        if (stepUnit(unit, dt, player, playerCar)) anySight = true;
        if (unit.recycled) {
          removeCar(unit.car);
          police.units.splice(i, 1);
        }
      }
      wanted.seen = anySight;
      stepBust(dt, player, playerCar);
    },
  };

  function removeCar(car) {
    const at = cars.indexOf(car);
    if (at >= 0) cars.splice(at, 1);
  }

  /** Keep the unit count matched to the stars: spawn answers, leavers go. */
  function stepPopulation(dt, player) {
    police.spawnTimer -= dt;
    const active = police.units.filter((u) => !u.leaving);
    if (active.length > wanted.stars) {
      // The heat is off: the farthest spare units break off and drive away.
      const spare = active.sort(
        (a, b) => Math.hypot(b.car.x - player.x, b.car.y - player.y) - Math.hypot(a.car.x - player.x, a.car.y - player.y),
      );
      for (let i = 0; i < active.length - wanted.stars; i += 1) spare[i].leaving = 0;
    }
    const staying = police.units.filter((u) => !u.leaving).length;
    if (staying < wanted.stars && police.spawnTimer <= 0) {
      police.spawnTimer = 0.8;
      spawnUnit(player);
    }
    for (let i = police.units.length - 1; i >= 0; i -= 1) {
      const unit = police.units[i];
      if (unit.leaving === undefined) continue;
      unit.leaving += dt;
      const away = Math.hypot(unit.car.x - player.x, unit.car.y - player.y);
      if (away > 760 || unit.leaving > 6) {
        removeCar(unit.car);
        police.units.splice(i, 1);
      }
    }
  }

  /** Bring one Interceptor onto a road 700-1000 units from the player. */
  function spawnUnit(player) {
    const rng = police.rng;
    for (let tries = 0; tries < 10; tries += 1) {
      const ang = rng() * Math.PI * 2;
      const dist = range(rng, SPAWN_MIN, SPAWN_MAX);
      const cx = player.x + Math.cos(ang) * dist;
      const cy = player.y + Math.sin(ang) * dist;
      const kind = rng() < 0.5 ? 'v' : 'h';
      const lines = kind === 'v' ? ROAD_LINES.vertical : ROAD_LINES.horizontal;
      const probe = kind === 'v' ? cx : cy;
      const line = lines.reduce((a, b) => (Math.abs(b - probe) < Math.abs(a - probe) ? b : a));
      const side = (kind === 'v' ? cx - line : cy - line) >= 0 ? 1 : -1;
      const laneCoord = line + side * LANE;
      const along =
        kind === 'v'
          ? clamp(cy, 160, CITY.beachY - 60)
          : clamp(cx, 160, line === CITY.beachY ? CITY.bay.x - 120 : 2920);
      const x = kind === 'v' ? laneCoord : along;
      const y = kind === 'v' ? along : laneCoord;
      const finalDist = Math.hypot(x - player.x, y - player.y);
      if (finalDist < 600 || finalDist > 1120) continue;
      if (pointInWater(x, y) || circleHitsBuilding(x, y, 30)) continue;
      if (cars.some((c) => Math.hypot(c.x - x, c.y - y) < 58)) continue;
      const dir = kind === 'v' ? Math.sign(player.y - y) || 1 : Math.sign(player.x - x) || 1;
      const angle = kind === 'v' ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : dir > 0 ? 0 : Math.PI;
      const car = createCar(modelByName('PAPD Interceptor'), x, y, angle, rng);
      car.driver = 'police';
      cars.push(car);
      police.units.push({
        car,
        lastSeenX: player.x,
        lastSeenY: player.y,
        unseenFor: 0,
        fireTimer: range(rng, 0.6, 1.3),
        ramCd: 0,
        leaving: undefined,
        recycled: false,
      });
      return;
    }
  }

  /** One unit's step. Returns true when it has eyes on the player. */
  function stepUnit(unit, dt, player, playerCar) {
    const car = unit.car;
    unit.ramCd = Math.max(0, unit.ramCd - dt);
    const distToPlayer = Math.hypot(player.x - car.x, player.y - car.y);
    let sight =
      distToPlayer <= SIGHT_RANGE && !segmentBlocked(car.x, car.y, player.x, player.y);
    if (sight) {
      unit.lastSeenX = player.x;
      unit.lastSeenY = player.y;
      unit.unseenFor = 0;
    } else {
      unit.unseenFor += dt;
    }
    // A unit that lost the trail long ago and ended up on the far side of
    // the city is quietly recycled; the spawner will answer nearer.
    if (unit.unseenFor > 10 && distToPlayer > 1300 && unit.leaving === undefined) {
      unit.recycled = true;
      return sight;
    }

    let tx;
    let ty;
    let desired;
    if (unit.leaving !== undefined) {
      // Break off: aim away from the player and keep driving until gone.
      const away = Math.atan2(car.y - player.y, car.x - player.x);
      tx = car.x + Math.cos(away) * 420;
      ty = car.y + Math.sin(away) * 420;
      desired = 235;
    } else {
      tx = unit.lastSeenX;
      ty = unit.lastSeenY;
      const toTarget = Math.hypot(tx - car.x, ty - car.y);
      if (!sight && unit.unseenFor > SEARCH_AFTER && toTarget < 55) {
        desired = 0; // at the last seen spot with nothing to show for it: wait
      } else if (toTarget > 300) {
        desired = car.model.topSpeed;
      } else if (toTarget > 140) {
        desired = 248;
      } else if (toTarget > 62) {
        desired = 148;
      } else {
        desired = 118;
      }
    }
    const diff = wrapAngle(Math.atan2(ty - car.y, tx - car.x) - car.angle);
    const steer = clamp(diff * 2.4, -1, 1);
    const input = { throttle: 0, brake: 0, steer };
    if (car.speed < desired - 3) input.throttle = 1;
    else if (car.speed > desired + 3 && car.speed > 5) input.brake = 1;
    if (desired <= 1 && car.speed > -0.1 && car.speed < 8) {
      input.throttle = 0;
      input.brake = 0;
      car.speed = Math.max(0, car.speed - 260 * dt);
    }
    updateCarPhysics(car, input, dt);
    collideCarWithWorld(car);
    // A unit breaking off no longer counts as eyes on the player.
    if (unit.leaving !== undefined) sight = false;

    if (playerCar) stepRam(unit, playerCar);
    if (
      wanted.stars >= 3 &&
      sight &&
      distToPlayer <= 300 &&
      Math.abs(car.speed) < 45 &&
      unit.leaving === undefined
    ) {
      unit.fireTimer -= dt;
      if (unit.fireTimer <= 0) {
        unit.fireTimer = 1.15;
        const aim = Math.atan2(player.y - car.y, player.x - car.x) + range(police.rng, -0.05, 0.05);
        combat.spawnProjectile(
          { x: car.x + Math.cos(aim) * (car.model.length / 2 + 6), y: car.y + Math.sin(aim) * (car.model.length / 2 + 6) },
          aim,
          520,
          true,
        );
      }
    }
    return sight;
  }

  /**
   * The shove when an Interceptor and the player's car meet. There is no
   * car-to-car physics anywhere else in Port Azura, so the law provides its
   * own: overlap pushes the two cars apart, and a fast meeting is reported
   * as a 'carHit' whose payload names both cars and says whose fault it was
   * — main.js turns a player-fault one into the 'copCarHit' crime.
   */
  function stepRam(unit, playerCar) {
    const car = unit.car;
    if (car === playerCar) return;
    const dx = car.x - playerCar.x;
    const dy = car.y - playerCar.y;
    const dist = Math.hypot(dx, dy);
    const reach = car.model.length * 0.46 + playerCar.model.length * 0.46;
    if (dist >= reach || dist < 0.01) return;
    const nx = dx / dist;
    const ny = dy / dist;
    const push = (reach - dist) / 2;
    car.x += nx * push;
    car.y += ny * push;
    playerCar.x -= nx * push;
    playerCar.y -= ny * push;
    const unitVx = Math.cos(car.angle) * car.speed;
    const unitVy = Math.sin(car.angle) * car.speed;
    const playerVx = Math.cos(playerCar.angle) * playerCar.speed;
    const playerVy = Math.sin(playerCar.angle) * playerCar.speed;
    // Closing speeds along the line between the cars, one per driver.
    const playerClosing = (playerVx - unitVx) * nx + (playerVy - unitVy) * ny;
    const unitClosing = -playerClosing;
    const impact = Math.max(playerClosing, unitClosing);
    if (impact > 60 && unit.ramCd <= 0) {
      unit.ramCd = 0.9;
      events.emit('carHit', {
        car,
        other: playerCar,
        x: (car.x + playerCar.x) / 2,
        y: (car.y + playerCar.y) / 2,
        speed: impact,
        hard: impact > 175,
        playerFault: playerClosing > unitClosing,
      });
      car.speed *= 0.55;
      playerCar.speed *= 0.65;
    } else if (impact > 0) {
      car.speed *= 0.92;
      playerCar.speed *= 0.92;
    }
  }

  /**
   * The bust meter. It fills in two seconds while the player is cornered —
   * on foot with a unit's bumper within reach and barely moving, or behind
   * the wheel, nearly stopped, with a unit close alongside — and drains in
   * three once the player breaks away. Full means 'busted'.
   */
  function stepBust(dt, player, playerCar) {
    if (police.prevPlayerX === null) {
      police.prevPlayerX = player.x;
      police.prevPlayerY = player.y;
    }
    const moved = Math.hypot(player.x - police.prevPlayerX, player.y - police.prevPlayerY);
    police.prevPlayerX = player.x;
    police.prevPlayerY = player.y;
    const instant = dt > 0 ? moved / dt : 0;
    police.footSpeed += (instant - police.footSpeed) * 0.45;

    let cornered = false;
    for (const unit of police.units) {
      if (unit.leaving !== undefined) continue;
      const car = unit.car;
      const centre = Math.hypot(car.x - player.x, car.y - player.y);
      if (!playerCar) {
        const gap = centre - car.model.length / 2 - player.radius;
        if (gap < 46 && police.footSpeed < 30) cornered = true;
      } else {
        const gap = centre - (car.model.length + playerCar.model.length) / 2;
        if (gap < 70 && Math.abs(playerCar.speed) < 12) cornered = true;
      }
      if (cornered) break;
    }
    if (cornered) {
      police.bust = Math.min(1, police.bust + dt / 2);
      if (police.bust >= 1 && !police.bustFired) {
        police.bustFired = true;
        events.emit('busted', { stars: wanted.stars });
      }
    } else {
      police.bust = Math.max(0, police.bust - dt / 3);
      if (police.bust < 0.4) police.bustFired = false;
    }
  }

  return police;
}
