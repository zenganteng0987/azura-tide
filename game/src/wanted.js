// The wanted system: how much trouble the player is in. Crimes arrive on the
// events bus from the systems that cause them — a stolen car, a hard crash, a
// pedestrian down, a shot fired — and each one pours heat into a single pot.
// The pot's level is the star count Port Azura's police answer to: nothing
// below 20 heat, then one star per threshold up to five at 100. Heat cools
// slowly, but only once the police have lost the player's trail for a few
// seconds and the crimes have stopped; while a unit has eyes on the player,
// police.js holds `seen` up and the pot does not cool at all.
import { events } from './events.js';

/** Heat each crime type pours in. A collision only counts at real speed. */
const CRIME_HEAT = {
  carTheft: 34,
  pedHit: 40,
  assault: 25,
  shooting: 20,
  pedDown: 45,
  copCarHit: 30,
};
const COLLISION_HEAT = 10;
const COLLISION_MIN_SPEED = 150;
/** Heat at which each star lights: index 0 is the first star. */
const STAR_THRESHOLDS = [20, 40, 60, 80, 100];
/** The pot never overflows past this, so a long rampage still cools in finite time. */
const HEAT_CAP = 140;
/** Cooling rate in heat per second, once the coast is clear. */
const DECAY_PER_SEC = 2.5;
/** Seconds without being seen, and without a fresh crime, before cooling starts. */
const UNSEEN_GRACE = 6;
const QUIET_GRACE = 8;
/** Gunfire is one continuous crime: its heat counts at most once a second. */
const SHOOTING_THROTTLE = 1;

function starsFor(heat) {
  let stars = 0;
  for (const threshold of STAR_THRESHOLDS) {
    if (heat >= threshold) stars += 1;
  }
  return stars;
}

/**
 * A fresh wanted state. It subscribes to 'crime' itself and keeps its own
 * clock, advanced by update(dt) once a step. police.js writes `seen` every
 * step; everything else reads `heat` and `stars`.
 */
export function createWanted() {
  const wanted = {
    heat: 0,
    stars: 0,
    /** True while at least one police unit has eyes on the player. */
    seen: false,
    /** The system's own clock, in seconds since it was created. */
    now: 0,
    lastCrimeAt: -Infinity,
    lastSeenAt: -Infinity,
    lastShootingAt: -Infinity,

    /** Pour heat in directly (a crime the bus does not carry, or a script). */
    addHeat(n) {
      if (n <= 0) return;
      wanted.heat = Math.min(HEAT_CAP, wanted.heat + n);
      wanted.lastCrimeAt = wanted.now;
      refreshStars();
    },

    /** Cool the pot right back down: a bust paid for, a hospital visit over. */
    reset() {
      wanted.heat = 0;
      wanted.seen = false;
      wanted.lastCrimeAt = -Infinity;
      wanted.lastSeenAt = -Infinity;
      refreshStars();
    },

    update(dt) {
      wanted.now += dt;
      if (wanted.seen) wanted.lastSeenAt = wanted.now;
      const unseenFor = wanted.now - wanted.lastSeenAt;
      const quietFor = wanted.now - wanted.lastCrimeAt;
      if (!wanted.seen && unseenFor > UNSEEN_GRACE && quietFor > QUIET_GRACE && wanted.heat > 0) {
        wanted.heat = Math.max(0, wanted.heat - DECAY_PER_SEC * dt);
        refreshStars();
      }
    },
  };

  function refreshStars() {
    const next = starsFor(wanted.heat);
    if (next !== wanted.stars) {
      wanted.stars = next;
      events.emit('wantedChanged', { stars: next });
    }
  }

  events.on('crime', (crime) => {
    if (!crime || typeof crime.type !== 'string') return;
    if (crime.type === 'collision') {
      // The bus hears about every hard wall hit; only a fast one is trouble.
      if ((crime.speed || 0) >= COLLISION_MIN_SPEED) {
        wanted.lastCrimeAt = wanted.now;
        wanted.addHeat(COLLISION_HEAT);
      }
      return;
    }
    const heat = CRIME_HEAT[crime.type];
    if (heat === undefined) return;
    wanted.lastCrimeAt = wanted.now;
    if (crime.type === 'shooting') {
      if (wanted.now - wanted.lastShootingAt < SHOOTING_THROTTLE) return;
      wanted.lastShootingAt = wanted.now;
    }
    wanted.addHeat(heat);
  });

  return wanted;
}
