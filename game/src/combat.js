// Combat on foot: fists and a pistol, and the projectiles both the player
// and (from Session C's police) anyone else fires. The player swings with
// Space or a click at whoever stands in front of them, and shoots with a
// click toward the mouse; a pistol holds six rounds and takes a second to
// reload with R. Every violent act is announced on the events bus as a
// 'crime', and harm to the player travels back the other way as 'playerHurt'
// — this module never touches the player's health itself. Projectiles live
// here so police units can fire through the same spawnProjectile the player
// uses; theirs fly slower and only ever test the player.
import { events } from './events.js';
import { mouse, pressed, wasPressed } from './input.js';
import { screenToWorld } from './render.js';
import { knockDownPed, scarePeds } from './pedestrians.js';
import { circleHitsBuilding, pointInWater } from './world.js';

const MAG_SIZE = 6;
const RELOAD_SEC = 1;
const PISTOL_SPEED = 950;
const FIST_RANGE = 46;
const FIST_ARC = 1.15;
const ATTACK_COOLDOWN = 0.35;
const FIRE_COOLDOWN = 0.18;
const PROJECTILE_LIFE = 1.1;

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** True when the world point sits inside the car's body rectangle. */
function pointInCar(x, y, car) {
  const c = Math.cos(car.angle);
  const s = Math.sin(car.angle);
  const dx = x - car.x;
  const dy = y - car.y;
  const lx = dx * c + dy * s;
  const ly = -dx * s + dy * c;
  return Math.abs(lx) < car.model.length / 2 && Math.abs(ly) < car.model.width / 2;
}

/**
 * A fresh combat state for the player. `player`, `peds` and `cars` are the
 * shared live objects from main.js; `camera` is the renderer's, so a click
 * can be turned into the world point it aimed at. update(dt, playerCar)
 * wants the car the player is driving (or null) so police projectiles know
 * what they can hit; main only calls it while the player is on foot anyway.
 */
export function createCombat({ player, peds, cars, camera }) {
  const combat = {
    weapon: 'fists',
    ammo: MAG_SIZE,
    reloading: 0,
    projectiles: [],
    effects: [],
    attackCd: 0,
    fireCd: 0,

    /**
     * Put a bullet in the world. `from` is {x, y}; it flies along `angle`
     * at `speed` units per second. fromPolice marks whose it is: police
     * rounds test only the player, the player's rounds test everyone else.
     */
    spawnProjectile(from, angle, speed, fromPolice) {
      const shot = {
        x: from.x,
        y: from.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        fromPolice: !!fromPolice,
        life: PROJECTILE_LIFE,
      };
      combat.projectiles.push(shot);
      return shot;
    },

    update(dt, playerCar, canAct = true) {
      combat.attackCd = Math.max(0, combat.attackCd - dt);
      combat.fireCd = Math.max(0, combat.fireCd - dt);
      if (combat.reloading > 0) {
        combat.reloading -= dt;
        if (combat.reloading <= 0) combat.ammo = MAG_SIZE;
      }
      // canAct is false behind the wheel: the weapons stay holstered, but
      // rounds already in the air (the police's, mostly) still land.
      if (canAct) stepWeapons(dt);
      stepProjectiles(dt, playerCar);
      stepEffects(dt);
    },

    /** Paint the bullets and the brief violence around them, in world space. */
    draw(ctx) {
      for (const fx of combat.effects) {
        const fade = Math.max(0, fx.ttl / fx.max);
        if (fx.kind === 'tracer') {
          ctx.strokeStyle = `rgba(255, 240, 180, ${0.75 * fade})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(fx.x, fx.y);
          ctx.lineTo(fx.x2, fx.y2);
          ctx.stroke();
        } else if (fx.kind === 'flash') {
          ctx.fillStyle = `rgba(255, 214, 90, ${0.9 * fade})`;
          ctx.beginPath();
          ctx.arc(fx.x, fx.y, 4 + 9 * (1 - fade), 0, Math.PI * 2);
          ctx.fill();
        } else if (fx.kind === 'spark') {
          ctx.strokeStyle = `rgba(255, 190, 80, ${fade})`;
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          for (const a of fx.angles) {
            ctx.moveTo(fx.x, fx.y);
            ctx.lineTo(fx.x + Math.cos(a) * 11 * fade + Math.cos(a) * 3, fx.y + Math.sin(a) * 11 * fade + Math.sin(a) * 3);
          }
          ctx.stroke();
        } else {
          // 'puff' for masonry dust, 'splash' for water: a soft ring growing out.
          ctx.strokeStyle = fx.kind === 'splash' ? `rgba(127, 212, 201, ${0.8 * fade})` : `rgba(200, 192, 175, ${0.7 * fade})`;
          ctx.lineWidth = 2.4;
          ctx.beginPath();
          ctx.arc(fx.x, fx.y, 3 + 13 * (1 - fade), 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      for (const shot of combat.projectiles) {
        ctx.strokeStyle = shot.fromPolice ? 'rgba(255, 160, 120, 0.65)' : 'rgba(255, 244, 190, 0.65)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(shot.x - shot.vx * 0.016, shot.y - shot.vy * 0.016);
        ctx.lineTo(shot.x, shot.y);
        ctx.stroke();
        ctx.fillStyle = '#fff6c9';
        ctx.beginPath();
        ctx.arc(shot.x, shot.y, 2.1, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  };

  function addEffect(fx) {
    fx.max = fx.ttl;
    combat.effects.push(fx);
  }

  function spark(x, y) {
    const angles = [];
    for (let i = 0; i < 5; i += 1) angles.push(Math.random() * Math.PI * 2);
    addEffect({ kind: 'spark', x, y, angles, ttl: 0.16 });
  }

  function setWeapon(next) {
    if (combat.weapon === next) return;
    combat.weapon = next;
    events.emit('weaponChanged', { weapon: next });
  }

  function stepWeapons() {
    if (wasPressed('KeyQ')) {
      pressed.delete('KeyQ');
      setWeapon(combat.weapon === 'fists' ? 'pistol' : 'fists');
    }
    if (wasPressed('Digit1')) {
      pressed.delete('Digit1');
      setWeapon('fists');
    }
    if (wasPressed('Digit2')) {
      pressed.delete('Digit2');
      setWeapon('pistol');
    }
    if (wasPressed('KeyR')) {
      pressed.delete('KeyR');
      if (combat.ammo < MAG_SIZE && combat.reloading <= 0) combat.reloading = RELOAD_SEC;
    }
    if (combat.weapon === 'fists') {
      if ((wasPressed('Space') || mouse.clicked) && combat.attackCd <= 0) {
        mouse.clicked = false;
        combat.attackCd = ATTACK_COOLDOWN;
        swingFists();
      }
    } else if (mouse.clicked) {
      mouse.clicked = false;
      if (combat.reloading <= 0 && combat.fireCd <= 0) firePistol();
    }
  }

  function swingFists() {
    let best = null;
    let bestDist = Infinity;
    for (const ped of peds) {
      if (ped.state === 'down') continue;
      const d = Math.hypot(ped.x - player.x, ped.y - player.y);
      if (d > FIST_RANGE) continue;
      const facing = Math.abs(wrapAngle(Math.atan2(ped.y - player.y, ped.x - player.x) - player.angle));
      if (facing > FIST_ARC && d > 26) continue;
      if (d < bestDist) {
        bestDist = d;
        best = ped;
      }
    }
    if (!best) return;
    knockDownPed(best);
    scarePeds(best.x, best.y, 130);
    events.emit('crime', { type: 'assault', x: best.x, y: best.y });
  }

  function firePistol() {
    if (combat.ammo <= 0) {
      // An empty click is just the start of the reload.
      combat.reloading = RELOAD_SEC;
      return;
    }
    combat.ammo -= 1;
    combat.fireCd = FIRE_COOLDOWN;
    const target = screenToWorld(camera, mouse.x, mouse.y);
    const angle = Math.atan2(target.y - player.y, target.x - player.x);
    player.angle = angle;
    const mx = player.x + Math.cos(angle) * (player.radius + 7);
    const my = player.y + Math.sin(angle) * (player.radius + 7);
    combat.spawnProjectile({ x: mx, y: my }, angle, PISTOL_SPEED, false);
    addEffect({ kind: 'flash', x: mx, y: my, ttl: 0.07 });
    addEffect({
      kind: 'tracer',
      x: mx,
      y: my,
      x2: player.x + Math.cos(angle) * Math.min(320, Math.hypot(target.x - player.x, target.y - player.y)),
      y2: player.y + Math.sin(angle) * Math.min(320, Math.hypot(target.x - player.x, target.y - player.y)),
      ttl: 0.08,
    });
    scarePeds(player.x, player.y, 220);
    events.emit('crime', { type: 'shooting', x: player.x, y: player.y });
    if (combat.ammo === 0) combat.reloading = RELOAD_SEC;
  }

  function stepProjectiles(dt, playerCar) {
    for (let i = combat.projectiles.length - 1; i >= 0; i -= 1) {
      const shot = combat.projectiles[i];
      shot.x += shot.vx * dt;
      shot.y += shot.vy * dt;
      shot.life -= dt;
      let dead = shot.life <= 0;
      if (!dead && circleHitsBuilding(shot.x, shot.y, 2)) {
        addEffect({ kind: 'puff', x: shot.x, y: shot.y, ttl: 0.3 });
        dead = true;
      } else if (!dead && pointInWater(shot.x, shot.y)) {
        addEffect({ kind: 'splash', x: shot.x, y: shot.y, ttl: 0.3 });
        dead = true;
      }
      if (!dead && shot.fromPolice) {
        if (playerCar && pointInCar(shot.x, shot.y, playerCar)) {
          spark(shot.x, shot.y);
          events.emit('playerHurt', { amount: 6 });
          dead = true;
        } else if (!playerCar && Math.hypot(shot.x - player.x, shot.y - player.y) < player.radius + 3) {
          events.emit('playerHurt', { amount: 6 });
          dead = true;
        }
      } else if (!dead) {
        for (const ped of peds) {
          if (ped.state === 'down') continue;
          if (Math.hypot(shot.x - ped.x, shot.y - ped.y) < 10) {
            knockDownPed(ped);
            scarePeds(ped.x, ped.y, 150);
            events.emit('crime', { type: 'pedDown', x: ped.x, y: ped.y });
            dead = true;
            break;
          }
        }
        if (!dead) {
          for (const car of cars) {
            if (pointInCar(shot.x, shot.y, car)) {
              car.health = Math.max(0, car.health - 4);
              spark(shot.x, shot.y);
              events.emit('crime', { type: 'shooting', x: shot.x, y: shot.y });
              dead = true;
              break;
            }
          }
        }
      }
      if (dead) combat.projectiles.splice(i, 1);
    }
  }

  function stepEffects(dt) {
    for (let i = combat.effects.length - 1; i >= 0; i -= 1) {
      combat.effects[i].ttl -= dt;
      if (combat.effects[i].ttl <= 0) combat.effects.splice(i, 1);
    }
  }

  return combat;
}
