// Azura Tide's boot and heartbeat: the one loop every system hangs off. This file
// only orchestrates — the city lives in world.js, drawing in render.js, keys in
// input.js, tuning in config.js. The simulation advances in fixed 1/60 s steps
// (several in a slow frame, none in a fast one) and the renderer paints whatever
// state the steps leave behind. Screens: title (a slow pan over Port Azura),
// playing (on foot or behind the wheel, with traffic and pedestrians about),
// and paused.
import { CITY, DAY_LENGTH_SEC, PLAYER, START_HOUR, WORLD } from './config.js';
import { LANDMARKS, ROAD_LINES, circleHitsBuilding, circleHitsWater, city, districtAt, landmarkByName, playerSpawn } from './world.js';
import { attachInput, endFrame, isDown, mouse, moveAxes, pressed, wasPressed } from './input.js';
import { createCamera, dayTint, drawPlayer, drawWorld } from './render.js';
import { events } from './events.js';
import { collideCarWithWorld, createCar, drawCar, modelByName, spawnParkedCars, updateCarPhysics } from './vehicles.js';
import { claimTrafficCar, createTraffic, updateTraffic } from './traffic.js';
import { createPeds, drawPed, updatePeds } from './pedestrians.js';
import { createWanted } from './wanted.js';
import { createCombat } from './combat.js';
import { createPolice } from './police.js';
import { createMissions, drawMarker } from './missions.js';
import { audio } from './audio.js';
import { clearSave, loadSave, writeSave } from './save.js';

const STEP = 1 / 60;
/** The longest frame the loop catches up on; a longer stall is dropped, not replayed. */
const MAX_FRAME = 0.25;
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const status = document.getElementById('status');

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

attachInput();
const camera = createCamera();

const game = {
  screen: 'title',
  /** Time of day in [0, 1): 0 is midnight, 0.5 is noon. */
  timeOfDay: START_HOUR / 24,
  elapsed: 0,
  cash: 0,
  showMinimap: true,
  /** How the last run-in with the law or the pavement ended: 'busted' | 'wasted' | null. */
  lastOutcome: null,
  /** The fine or bill the last outcome charged, for its overlay to quote. */
  lastFine: 0,
  /** True while a staged screenshot scene holds the day clock at its hour. */
  clockFrozen: false,
  /** True while a staged screenshot scene holds the whole world in its pose. */
  shotFrozen: false,
  /** Park the day clock at an hour of the day (0-24); scene staging sets the light with it. */
  setHour(h) {
    game.timeOfDay = (((h % 24) + 24) % 24) / 24;
  },
};

// Later sessions read the game's state by this name; it is the screen, kept
// in step by construction rather than by bookkeeping.
Object.defineProperty(game, 'state', { get: () => game.screen });

const player = {
  x: playerSpawn.x,
  y: playerSpawn.y,
  radius: PLAYER.radius,
  angle: -Math.PI / 2,
  /** 0-100. Combat and the police chip away at it; at zero the hospital takes over. */
  health: 100,
};

/** Every car in the city — parked, traffic and (while driving) the player's. */
const cars = spawnParkedCars({ ROAD_LINES, LANDMARKS });
const traffic = createTraffic();
const peds = createPeds();

/** The car the player is driving right now, or null when on foot. */
let playerCar = null;

/** The law, in the order it escalates: heat, the means to make more, the answer. */
const wanted = createWanted();
const combat = createCombat({ player, peds, cars, camera });
const police = createPolice({ cars, wanted, combat });

/** Rafi's story and the courier work between its chapters. */
const missions = createMissions({ player, cars, wanted, game, getPlayerCar: () => playerCar });

/**
 * The save found at boot, if any: the title screen offers it as Continue
 * until the player takes it up or throws it away with a new game.
 */
let pendingSave = loadSave();

/** Write the current standing — cash, story progress, street corner — down. */
function persistSave() {
  writeSave({
    cash: game.cash,
    missionIndex: missions.missionIndex,
    storyDone: missions.storyDone,
    playerX: Math.round(player.x),
    playerY: Math.round(player.y),
  });
}
events.on('missionComplete', persistSave);
events.on('missionFailed', persistSave);

/** Take up a saved game: the pocket, the story, and the corner it left on. */
function applySave(save) {
  game.cash = save.cash;
  missions.setProgress({ missionIndex: save.missionIndex, storyDone: save.storyDone });
  if (save.playerX != null && save.playerY != null) {
    const spot = findFreeSpot(save.playerX, save.playerY);
    player.x = spot.x;
    player.y = spot.y;
  }
}

/** Throw the save away and start Rafi over: broke, unknown, at the spawn. */
function newGame() {
  clearSave();
  pendingSave = null;
  game.cash = 0;
  missions.resetProgress();
  player.x = playerSpawn.x;
  player.y = playerSpawn.y;
  player.health = 100;
  wanted.reset();
}

/** Every crime the bus has carried, newest last, kept short for the test hook. */
const crimeLog = [];
events.on('crime', (crime) => {
  crimeLog.push(crime);
  if (crimeLog.length > 200) crimeLog.shift();
});

// A ram the police report ('carHit' naming both cars) becomes the copCarHit
// crime only when it was the player's fault — the player hit them.
events.on('carHit', (hit) => {
  if (hit && hit.other && hit.playerFault && hit.car && hit.car.model && hit.car.model.police) {
    events.emit('crime', { type: 'copCarHit', x: hit.x, y: hit.y });
  }
});

// Harm arrives as an event so combat never touches health itself. At zero
// the run ends the hospital's way.
events.on('playerHurt', (hurt) => {
  if (game.screen !== 'playing') return;
  player.health = Math.max(0, player.health - (hurt.amount || 0));
  if (player.health <= 0) {
    game.cash = Math.max(0, game.cash - 100);
    game.lastFine = 100;
    game.lastOutcome = 'wasted';
    game.screen = 'wasted';
    announce('Wasted. The hospital bill was $100. Press Enter.');
  }
});

// A full bust meter ends the chase here: the fine is 150 per star, the car
// (if any) stays where it was stopped, and Enter walks the player out of
// the Police HQ once respawn runs.
events.on('busted', (payload) => {
  if (game.screen !== 'playing') return;
  const stars = payload && payload.stars ? payload.stars : wanted.stars;
  const fine = 150 * stars;
  game.cash = Math.max(0, game.cash - fine);
  game.lastFine = fine;
  game.lastOutcome = 'busted';
  game.screen = 'busted';
  announce(`Busted. The PAPD fined you $${fine}. Press Enter.`);
});

function announce(message) {
  status.textContent = message;
}

function clockText() {
  const totalMinutes = Math.floor(game.timeOfDay * 24 * 60);
  const hh = String(Math.floor(totalMinutes / 60) % 24).padStart(2, '0');
  const mm = String(totalMinutes % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

function stepPlayer(dt) {
  const axes = moveAxes();
  if (axes.x === 0 && axes.y === 0) return;
  const speed = isDown('ShiftLeft', 'ShiftRight') ? PLAYER.runSpeed : PLAYER.walkSpeed;
  const length = Math.hypot(axes.x, axes.y);
  const dx = (axes.x / length) * speed * dt;
  const dy = (axes.y / length) * speed * dt;
  player.angle = Math.atan2(dy, dx);
  // Axis-separated movement: slide along whatever blocks the other axis.
  const nextX = player.x + dx;
  if (!circleHitsBuilding(nextX, player.y, player.radius) && !circleHitsWater(nextX, player.y, player.radius)) {
    player.x = nextX;
  }
  const nextY = player.y + dy;
  if (!circleHitsBuilding(player.x, nextY, player.radius) && !circleHitsWater(player.x, nextY, player.radius)) {
    player.y = nextY;
  }
  player.x = Math.max(player.radius, Math.min(WORLD.width - player.radius, player.x));
  player.y = Math.max(player.radius, Math.min(WORLD.height - player.radius, player.y));
}

/** The car whose flank the player is standing beside, nearest first, or null. */
function carBesidePlayer() {
  let best = null;
  let bestDist = Infinity;
  for (const car of cars) {
    const c = Math.cos(car.angle);
    const s = Math.sin(car.angle);
    const dx = player.x - car.x;
    const dy = player.y - car.y;
    const lx = dx * c + dy * s;
    const ly = -dx * s + dy * c;
    if (Math.abs(lx) > car.model.length / 2 + 34 || Math.abs(ly) > car.model.width / 2 + 32) continue;
    const d = Math.hypot(dx, dy);
    if (d < bestDist) {
      bestDist = d;
      best = car;
    }
  }
  return best;
}

/**
 * Get into a car. Taking a parked one is theft, and the whole city hears
 * about it through the events bus; taking a traffic car just retires its
 * driver. Either way the player token vanishes into the driver's seat.
 */
function enterCar(car) {
  if (car.driver === 'traffic') claimTrafficCar(traffic, car);
  else if (car.parked) events.emit('crime', { type: 'carTheft', x: car.x, y: car.y });
  car.parked = false;
  car.driver = 'player';
  playerCar = car;
  player.x = car.x;
  player.y = car.y;
  player.angle = car.angle;
  announce(`Driving the ${car.model.name}. WASD to drive, E to get out.`);
}

/** Step out onto the car's left side, or the right when the left is blocked. */
function exitCar() {
  const car = playerCar;
  for (const sideSign of [1, -1]) {
    // The heading's left hand points along (sin, -cos); right is its mirror.
    const ox = Math.sin(car.angle) * sideSign;
    const oy = -Math.cos(car.angle) * sideSign;
    const dist = car.model.width / 2 + player.radius + 7;
    const x = car.x + ox * dist;
    const y = car.y + oy * dist;
    if (!circleHitsBuilding(x, y, player.radius) && !circleHitsWater(x, y, player.radius)) {
      player.x = x;
      player.y = y;
      car.speed = 0;
      car.braking = false;
      car.parked = true;
      car.driver = null;
      playerCar = null;
      announce('On foot. WASD to move, E to enter a car.');
      return;
    }
  }
  announce('No room to get out here.');
}

/**
 * The nearest spot to (x, y) where the player can stand — the point itself,
 * or a ring search outward — clear of buildings and water. Respawns aim at
 * a landmark's door and land wherever the street actually allows.
 */
function findFreeSpot(x, y) {
  for (let r = 0; r <= 260; r += 26) {
    const tries = r === 0 ? 1 : 10;
    for (let i = 0; i < tries; i += 1) {
      const a = (i / tries) * Math.PI * 2;
      const cx = x + Math.cos(a) * r;
      const cy = y + Math.sin(a) * r;
      if (!circleHitsBuilding(cx, cy, player.radius) && !circleHitsWater(cx, cy, player.radius)) {
        return { x: cx, y: cy };
      }
    }
  }
  return { x: playerSpawn.x, y: playerSpawn.y };
}

/**
 * Put the player back on the street outside a civic landmark after a bust
 * or a wasting: out of whatever car they were in (it stays where it
 * stopped, parked and driverless), health restored, the heat forgotten.
 * lastOutcome clears here, so it names the overlay that is still up.
 */
function respawnAt(markName) {
  if (playerCar) {
    playerCar.driver = null;
    playerCar.parked = true;
    playerCar.speed = 0;
    playerCar.braking = false;
    playerCar = null;
  }
  const mark = landmarkByName(markName);
  const spot = findFreeSpot(mark.x, mark.y);
  player.x = spot.x;
  player.y = spot.y;
  player.angle = -Math.PI / 2;
  player.health = 100;
  wanted.reset();
  police.bust = 0;
  game.lastOutcome = null;
  game.screen = 'playing';
}

/** Seconds of play since the last autosave; the save lands every ten. */
let saveTimer = 0;

function step(dt) {
  game.elapsed += dt;
  if (!game.clockFrozen) game.timeOfDay = (game.timeOfDay + dt / DAY_LENGTH_SEC) % 1;
  if (wasPressed('KeyV')) {
    pressed.delete('KeyV');
    announce(audio.toggleMute() ? 'Sound off (V).' : 'Sound on (V).');
  }
  audio.update(dt, {
    driving: game.screen === 'playing' && !!playerCar,
    speedRatio: playerCar ? Math.min(1, Math.abs(playerCar.speed) / playerCar.model.topSpeed) : 0,
    sirenNear:
      game.screen === 'playing' &&
      wanted.stars > 0 &&
      police.units.some((u) => Math.hypot(u.car.x - player.x, u.car.y - player.y) < 700),
    playing: game.screen === 'playing',
  });
  if (game.screen === 'title') {
    if (wasPressed('Enter')) {
      // One-shot presses are spent as they are used: a slow frame runs
      // several fixed steps, and an unspent press would fire in each.
      pressed.delete('Enter');
      audio.init();
      if (pendingSave) {
        applySave(pendingSave);
        pendingSave = null;
        announce('Welcome back to Port Azura. Your story picks up where it left off.');
      } else {
        announce('Playing Azura Tide. WASD to move, Shift to sprint, E to talk or enter a car, P to pause.');
      }
      game.screen = 'playing';
    } else if (pendingSave && wasPressed('KeyN')) {
      pressed.delete('KeyN');
      audio.init();
      newGame();
      game.screen = 'playing';
      announce('A new story. Rafi steps into Port Azura with empty pockets.');
    }
    return;
  }
  if (game.screen === 'playing') {
    if (game.shotFrozen) {
      // A staged screenshot scene holds its pose: the dialogue machine
      // still ticks (a conversation on screen must not drift), but nothing
      // walks, drives, chases or cools off underneath the frame.
      if (missions.dialogue) missions.update(dt);
      return;
    }
    if (wasPressed('KeyP')) {
      pressed.delete('KeyP');
      game.screen = 'paused';
      announce('Paused.');
      return;
    }
    if (wasPressed('KeyM')) {
      pressed.delete('KeyM');
      game.showMinimap = !game.showMinimap;
    }
    missions.update(dt);
    if (missions.dialogue) {
      // Mid-conversation the city holds its breath: no walking, no driving,
      // no law — the dialogue box owns the step until it closes.
      return;
    }
    if (playerCar) {
      const driveInput = {
        throttle: isDown('KeyW', 'ArrowUp') ? 1 : 0,
        brake: isDown('KeyS', 'ArrowDown') ? 1 : 0,
        steer: (isDown('KeyA', 'ArrowLeft') ? -1 : 0) + (isDown('KeyD', 'ArrowRight') ? 1 : 0),
      };
      updateCarPhysics(playerCar, driveInput, dt);
      collideCarWithWorld(playerCar);
      player.x = playerCar.x;
      player.y = playerCar.y;
      player.angle = playerCar.angle;
      if (wasPressed('KeyE')) {
        pressed.delete('KeyE');
        exitCar();
      }
    } else {
      stepPlayer(dt);
      if (wasPressed('KeyE')) {
        pressed.delete('KeyE');
        // A giver beside the player gets the press first; a car gets it
        // only when nobody is waiting to talk.
        if (!missions.tryTalk()) {
          const car = carBesidePlayer();
          if (car) enterCar(car);
        }
      }
    }
    updateTraffic(traffic, cars, dt, player);
    updatePeds(peds, dt, playerCar);
    combat.update(dt, playerCar, !playerCar);
    police.update(dt, player, playerCar);
    wanted.update(dt);
    saveTimer += dt;
    if (saveTimer >= 10) {
      saveTimer = 0;
      persistSave();
    }
    return;
  }
  if (game.screen === 'paused') {
    if (wasPressed('KeyP', 'Enter')) {
      pressed.delete('KeyP');
      pressed.delete('Enter');
      game.screen = 'playing';
      announce('Playing.');
    }
  }
  if (game.screen === 'busted' || game.screen === 'wasted') {
    // The missions machine watches this screen too: a job that was running
    // when the law or the pavement intervened is failed here, once.
    missions.update(dt);
    // The world waits under the overlay; Enter walks the player out of the
    // Police HQ or the hospital, whichever the outcome earned.
    if (wasPressed('Enter')) {
      pressed.delete('Enter');
      if (game.screen === 'busted') {
        respawnAt('Port Azura Police HQ');
        announce('Released from the Police HQ. The slate is clean — keep it that way.');
      } else {
        respawnAt('St. Azura Hospital');
        announce('Discharged from St. Azura Hospital. The slate is clean.');
      }
    }
  }
}

function drawTitle() {
  // A slow orbit over the middle of the city while the title waits.
  const cx = WORLD.width / 2 + Math.cos(game.elapsed * 0.07) * 430;
  const cy = WORLD.height / 2 + Math.sin(game.elapsed * 0.05) * 330;
  camera.centreOn(cx, cy, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(-camera.x, -camera.y);
  drawWorld(ctx, camera);
  ctx.restore();
  ctx.fillStyle = dayTint(game.timeOfDay);
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(5, 12, 20, 0.38)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffe9a8';
  ctx.font = `700 96px ${FONT}`;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = 18;
  ctx.fillText('AZURA TIDE', canvas.width / 2, canvas.height / 2 - 40);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#bfeef2';
  ctx.font = `400 34px ${FONT}`;
  ctx.fillText('P o r t   A z u r a', canvas.width / 2, canvas.height / 2 + 16);
  // Rafi's story in three lines, so the first job offer lands with context.
  ctx.fillStyle = '#e8f4f6';
  ctx.font = `400 19px ${FONT}`;
  ctx.fillText('Rafi is new in Port Azura — broke, unknown, and owing the wrong people.', canvas.width / 2, canvas.height / 2 + 58);
  ctx.fillText('Mira Solano at the Marina Pier has work for anyone who can drive.', canvas.width / 2, canvas.height / 2 + 86);
  ctx.fillText('Five jobs stand between Rafi and a life of his own.', canvas.width / 2, canvas.height / 2 + 114);
  if (Math.floor(game.elapsed * 1.6) % 2 === 0) {
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 24px ${FONT}`;
    ctx.fillText(pendingSave ? 'Enter — Continue' : 'Press Enter', canvas.width / 2, canvas.height / 2 + 162);
  }
  if (pendingSave) {
    ctx.fillStyle = '#bfeef2';
    ctx.font = `400 18px ${FONT}`;
    ctx.fillText('N — New game', canvas.width / 2, canvas.height / 2 + 194);
  }
  ctx.textAlign = 'left';
}

function pill(x, y, w, h) {
  ctx.fillStyle = 'rgba(8, 16, 24, 0.55)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 8);
  ctx.fill();
}

function drawMinimap() {
  const size = 184;
  const x0 = canvas.width - size - 16;
  const y0 = 64;
  const scale = size / WORLD.width;
  ctx.fillStyle = 'rgba(8, 16, 24, 0.6)';
  ctx.fillRect(x0 - 4, y0 - 4, size + 8, size + 8);
  ctx.fillStyle = '#1b9aaa';
  ctx.fillRect(x0, y0, size, size);
  ctx.fillStyle = '#cfc8b8';
  ctx.fillRect(x0, y0, size, (2840 / WORLD.height) * size);
  // The bay cuts up into the city from the south-east, well past the sea
  // band's top edge: paint its rectangle as water too, or the map shows
  // dry land where the marina wraps the real thing.
  ctx.fillStyle = '#1b9aaa';
  ctx.fillRect(x0 + CITY.bay.x * scale, y0 + CITY.bay.y * scale, CITY.bay.w * scale, CITY.bay.h * scale);
  ctx.fillStyle = '#4a4a52';
  for (const b of city.buildings) {
    ctx.fillRect(x0 + b.x * scale, y0 + b.y * scale, Math.max(1.6, b.w * scale), Math.max(1.6, b.h * scale));
  }
  // Every car is a small grey fleck; the one being driven rings the player dot.
  ctx.fillStyle = '#9aa3ad';
  for (const car of cars) {
    ctx.fillRect(x0 + car.x * scale - 1, y0 + car.y * scale - 1, 2.2, 2.2);
  }
  // Police units are blue dots, big enough to plan an escape around.
  ctx.fillStyle = '#2e7bff';
  for (const unit of police.units) {
    ctx.beginPath();
    ctx.arc(x0 + unit.car.x * scale, y0 + unit.car.y * scale, 2.7, 0, Math.PI * 2);
    ctx.fill();
  }
  // Mission markers: gold dots for work waiting, pale blue for a giver.
  for (const marker of missions.markers()) {
    ctx.fillStyle = marker.kind === 'giver' ? '#a0e6ff' : '#ffd94d';
    ctx.beginPath();
    ctx.arc(x0 + marker.x * scale, y0 + marker.y * scale, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  if (playerCar) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x0 + playerCar.x * scale, y0 + playerCar.y * scale, 4.1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#ffe9a8';
  ctx.beginPath();
  ctx.arc(x0 + player.x * scale, y0 + player.y * scale, 3.4, 0, Math.PI * 2);
  ctx.fill();
}

function drawHud() {
  ctx.font = `600 20px ${FONT}`;
  ctx.textBaseline = 'middle';
  pill(16, 14, 118, 34);
  ctx.fillStyle = '#8be08b';
  ctx.textAlign = 'left';
  ctx.fillText(`$${game.cash}`, 28, 32);
  if (playerCar) {
    // The speedometer: world units are roughly metres, halved into a
    // believable city pace.
    const kmh = Math.round(playerCar.speed * 0.5);
    pill(16, 56, 132, 34);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`${kmh} km/h`, 28, 74);
  }
  const clock = clockText();
  pill(canvas.width - 104, 14, 88, 34);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.fillText(clock, canvas.width - 60, 32);
  if (wanted.stars > 0) {
    // The wanted stars sit left of the clock: amber for the ones earned,
    // grey for the ones still available.
    ctx.font = `600 20px ${FONT}`;
    const full = '★'.repeat(wanted.stars);
    const empty = '☆'.repeat(5 - wanted.stars);
    const starsW = ctx.measureText(full + empty).width + 24;
    const sx = canvas.width - 104 - 10 - starsW;
    pill(sx, 14, starsW, 34);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffb400';
    ctx.fillText(full, sx + 12, 32);
    ctx.fillStyle = '#5a626c';
    ctx.fillText(empty, sx + 12 + ctx.measureText(full).width, 32);
    ctx.textAlign = 'center';
  }
  // Health, bottom-left: a bar that runs green, amber, then red as it empties.
  const healthW = 176;
  pill(16, canvas.height - 46, healthW, 20);
  ctx.fillStyle = player.health > 50 ? '#57cc5e' : player.health > 25 ? '#ffb400' : '#ff5340';
  const inner = (healthW - 8) * Math.max(0, player.health / 100);
  if (inner > 0) {
    ctx.beginPath();
    ctx.roundRect(20, canvas.height - 42, inner, 12, 5);
    ctx.fill();
  }
  const district = districtAt(player.x, player.y);
  ctx.font = `600 17px ${FONT}`;
  const w = ctx.measureText(district).width + 28;
  pill((canvas.width - w) / 2, canvas.height - 46, w, 32);
  ctx.fillStyle = '#ffe9a8';
  ctx.fillText(district, canvas.width / 2, canvas.height - 29);
  ctx.textAlign = 'left';
  if (game.showMinimap) drawMinimap();
  drawObjective();
  if (missions.banner) drawBanner();
  const prompt = missions.talkPrompt();
  if (prompt && !missions.dialogue) drawTalkPrompt(prompt);
  if (missions.dialogue) drawDialogue(missions.dialogue);
}

/** A countdown as m:ss, for timed mission steps. */
function timerText(seconds) {
  const total = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** The current objective, top-centre: what to do, and the clock if it runs. */
function drawObjective() {
  const obj = missions.objective();
  if (!obj) return;
  ctx.font = `600 18px ${FONT}`;
  let text = obj.text;
  if (obj.timer != null) text += ` · ${timerText(obj.timer)}`;
  const w = ctx.measureText(text).width + 30;
  const x = (canvas.width - w) / 2;
  pill(x, 14, w, 34);
  ctx.fillStyle = obj.timer != null && obj.timer < 30 ? '#ff8a75' : '#ffe9a8';
  ctx.textAlign = 'center';
  ctx.fillText(text, canvas.width / 2, 32);
  ctx.textAlign = 'left';
}

/** A centre-screen notice: a mission paid out, a job lost, a story ended. */
function drawBanner() {
  const banner = missions.banner;
  ctx.font = `700 21px ${FONT}`;
  const w = Math.min(canvas.width - 60, ctx.measureText(banner.text).width + 44);
  const x = (canvas.width - w) / 2;
  ctx.fillStyle = 'rgba(8, 16, 24, 0.72)';
  ctx.beginPath();
  ctx.roundRect(x, 108, w, 44, 10);
  ctx.fill();
  ctx.fillStyle = '#ffd94d';
  ctx.textAlign = 'center';
  ctx.fillText(banner.text, canvas.width / 2, 131, w - 24);
  ctx.textAlign = 'left';
}

/** The small prompt over the district pill: somebody is waiting to talk. */
function drawTalkPrompt(text) {
  ctx.font = `600 17px ${FONT}`;
  const w = ctx.measureText(text).width + 28;
  const x = (canvas.width - w) / 2;
  pill(x, canvas.height - 92, w, 32);
  ctx.fillStyle = '#a0e6ff';
  ctx.textAlign = 'center';
  ctx.fillText(text, canvas.width / 2, canvas.height - 75);
  ctx.textAlign = 'left';
}

/** Split a dialogue line into rows that fit the box. */
function wrapText(text, maxWidth, font) {
  ctx.font = font;
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** The conversation box: speaker in gold, their words under it, E to go on. */
function drawDialogue(line) {
  const boxW = Math.min(700, canvas.width - 64);
  const x = (canvas.width - boxW) / 2;
  const bodyFont = `400 19px ${FONT}`;
  const lines = wrapText(line.text, boxW - 44, bodyFont);
  const boxH = 58 + lines.length * 25;
  const y = canvas.height - boxH - 58;
  ctx.fillStyle = 'rgba(6, 12, 20, 0.82)';
  ctx.beginPath();
  ctx.roundRect(x, y, boxW, boxH, 10);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 217, 77, 0.5)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffd94d';
  ctx.font = `700 17px ${FONT}`;
  ctx.fillText(line.who, x + 22, y + 24);
  ctx.fillStyle = '#f2f7f8';
  ctx.font = bodyFont;
  lines.forEach((row, i) => ctx.fillText(row, x + 22, y + 52 + i * 25));
  ctx.fillStyle = '#8fa3ad';
  ctx.font = `600 14px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.fillText('E ▸', x + boxW - 16, y + boxH - 14);
  ctx.textAlign = 'left';
}

/** True when the day tint is dark enough that headlights earn their keep. */
function isNight() {
  return game.timeOfDay > 0.78 || game.timeOfDay < 0.26;
}

function drawPlaying() {
  camera.follow(player, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(-camera.x, -camera.y);
  drawWorld(ctx, camera);
  const night = isNight();
  for (const ped of peds) {
    if (ped.x < camera.x - 40 || ped.x > camera.x + camera.w + 40) continue;
    if (ped.y < camera.y - 40 || ped.y > camera.y + camera.h + 40) continue;
    drawPed(ctx, ped);
  }
  for (const car of cars) {
    if (car.x < camera.x - 170 || car.x > camera.x + camera.w + 170) continue;
    if (car.y < camera.y - 170 || car.y > camera.y + camera.h + 170) continue;
    // Parked cars sit dark; only cars in use burn their headlights.
    drawCar(ctx, car, night && !car.parked);
  }
  // Mission beacons over the world: givers, packages, drops, checkpoints.
  for (const marker of missions.markers()) {
    if (marker.x < camera.x - 60 || marker.x > camera.x + camera.w + 60) continue;
    if (marker.y < camera.y - 180 || marker.y > camera.y + camera.h + 60) continue;
    drawMarker(ctx, marker, game.elapsed);
  }
  combat.draw(ctx);
  if (!playerCar) drawPlayer(ctx, player);
  ctx.restore();
  ctx.fillStyle = dayTint(game.timeOfDay);
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (game.screen === 'playing' && police.bust > 0) drawBustMeter();
  drawHud();
  if (game.screen === 'paused') {
    ctx.fillStyle = 'rgba(5, 12, 20, 0.45)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 44px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('Paused', canvas.width / 2, canvas.height / 2 - 64);
    ctx.font = `600 20px ${FONT}`;
    ctx.fillStyle = '#ffe9a8';
    ctx.fillText(`Missions ${missions.missionIndex}/5 · Cash $${game.cash}`, canvas.width / 2, canvas.height / 2 - 24);
    ctx.font = `400 18px ${FONT}`;
    ctx.fillStyle = '#e8f4f6';
    ctx.fillText('WASD / arrows — move and drive · Shift — sprint', canvas.width / 2, canvas.height / 2 + 12);
    ctx.fillText('E — talk / enter or exit a car · Mouse — aim · Click — shoot', canvas.width / 2, canvas.height / 2 + 38);
    ctx.fillText('Q or 1 / 2 — fists / pistol · R — reload · V — sound on/off', canvas.width / 2, canvas.height / 2 + 64);
    ctx.fillText('M — minimap · P — resume', canvas.width / 2, canvas.height / 2 + 90);
    ctx.textAlign = 'left';
  }
  if (game.screen === 'busted' || game.screen === 'wasted') {
    const busted = game.screen === 'busted';
    ctx.fillStyle = busted ? 'rgba(20, 8, 30, 0.5)' : 'rgba(30, 5, 5, 0.52)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center';
    ctx.fillStyle = busted ? '#c9a6ff' : '#ff5340';
    ctx.font = `700 72px ${FONT}`;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 16;
    ctx.fillText(busted ? 'BUSTED' : 'WASTED', canvas.width / 2, canvas.height / 2 - 18);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.font = `400 22px ${FONT}`;
    ctx.fillText(
      busted
        ? `The PAPD fined you $${game.lastFine}. Press Enter to walk out of the Police HQ.`
        : `The hospital bill was $${game.lastFine}. Press Enter to leave St. Azura Hospital.`,
      canvas.width / 2,
      canvas.height / 2 + 34,
    );
    ctx.textAlign = 'left';
  }
}

/**
 * The bust meter as a ring over the player's head: amber while it fills,
 * red once it is nearly done, with the word itself when the law is a
 * breath away.
 */
function drawBustMeter() {
  const sx = player.x - camera.x;
  const sy = player.y - camera.y - 38;
  ctx.lineWidth = 4.5;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
  ctx.beginPath();
  ctx.arc(sx, sy, 15, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = police.bust > 0.66 ? '#ff5340' : '#ffb400';
  ctx.beginPath();
  ctx.arc(sx, sy, 15, -Math.PI / 2, -Math.PI / 2 + police.bust * Math.PI * 2);
  ctx.stroke();
  if (police.bust > 0.7) {
    ctx.fillStyle = '#ff5340';
    ctx.font = `700 13px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('BUSTED', sx, sy - 24);
    ctx.textAlign = 'left';
  }
}

function draw() {
  ctx.fillStyle = '#0b1620';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (game.screen === 'title') drawTitle();
  else drawPlaying();
}

let last = performance.now();
let accumulator = 0;

function frame(now) {
  requestAnimationFrame(frame);
  accumulator += Math.min((now - last) / 1000, MAX_FRAME);
  last = now;
  while (accumulator >= STEP) {
    step(STEP);
    accumulator -= STEP;
  }
  draw();
  endFrame();
}

announce('Azura Tide. Press Enter to play.');
requestAnimationFrame(frame);

// Test hook: with ?dev=1 in the URL, the smoke tests can reach the game's
// state directly — teleport the player, count the traffic, climb into the
// nearest car — instead of playing twenty questions with the keyboard. It
// changes nothing about how the game itself plays.
if (new URLSearchParams(window.location.search).get('dev') === '1') {
  window.__game = {
    game,
    player,
    cars,
    traffic,
    peds,
    wanted,
    police,
    combat,
    missions,
    audio,
    city,
    camera,
    crimeLog,
    get save() {
      return loadSave();
    },
    get crimes() {
      return crimeLog.length;
    },
    get playerCar() {
      return playerCar;
    },
    teleport(x, y) {
      player.x = x;
      player.y = y;
      if (playerCar) {
        playerCar.x = x;
        playerCar.y = y;
      }
    },
    enterNearestCar() {
      let best = null;
      let bestDist = Infinity;
      for (const car of cars) {
        const d = Math.hypot(car.x - player.x, car.y - player.y);
        if (d < bestDist) {
          bestDist = d;
          best = car;
        }
      }
      if (!best || playerCar) return best;
      // Stand at the car's left door, then go in the ordinary way.
      player.x = best.x + Math.sin(best.angle) * (best.model.width / 2 + 10);
      player.y = best.y - Math.cos(best.angle) * (best.model.width / 2 + 10);
      enterCar(best);
      return best;
    },
  };
}

// ---------------------------------------------------------------------------
// Staged scenes for the hand-in screenshots. With ?shot=<name> in the URL
// the game skips its title screen, parks the day clock at the scene's hour
// and arranges Port Azura through the same systems a player would — a
// mission accepted at the pier, a car taken on the avenue, Interceptors
// placed on its tail — then holds the world still (game.shotFrozen) so the
// frame the camera takes is the frame that was built. Without the parameter
// nothing below runs, and the game plays exactly as it always has.
// (The staging call itself sits at the very bottom of this block: the scene
// builders lean on consts declared here, and those must exist first.)
function stageShot(name) {
  const scenes = { cover: stageCover, market: stageMarket, pier: stagePier, night: stageNight };
  const scene = scenes[name];
  if (!scene) {
    window.__shotError = `unknown shot scene: ${name}`;
    return;
  }
  newGame();
  game.screen = 'playing';
  game.clockFrozen = true;
  game.shotFrozen = true;
  scene();
  window.__shotReady = true;
}

/**
 * Stand the player beside the waiting mission giver (offset from their
 * spot, facing them) and take the talk: their intro dialogue opens.
 * Returns the giver's spot.
 */
function talkToGiver(offsetX, offsetY) {
  const def = missions.availableDef();
  const { spot } = missions.giverSpot(def);
  player.x = spot.x + offsetX;
  player.y = spot.y + offsetY;
  player.angle = Math.atan2(spot.y - player.y, spot.x - player.x);
  missions.tryTalk();
  return spot;
}

/** Click through an open dialogue to its end, one line per update. */
function walkDialogue() {
  let guard = 0;
  while (missions.dialogue && guard < 60) {
    mouse.clicked = true;
    missions.update(STEP);
    guard += 1;
  }
}

/**
 * The parked car nearest a point. Models named in `prefer` win unless a
 * plainer car is dramatically closer — a chase reads better in a sedan
 * than in a cargo van.
 */
function parkedCarNear(x, y, prefer) {
  let best = null;
  let bestScore = Infinity;
  for (const car of cars) {
    if (!car.parked || car.driver) continue;
    const d = Math.hypot(car.x - x, car.y - y);
    const score = prefer && !prefer.includes(car.model.name) ? d + 1000 : d;
    if (score < bestScore) {
      bestScore = score;
      best = car;
    }
  }
  return best;
}

/**
 * Take a parked car near (x, y) the ordinary way — theft and all — then
 * park it precisely where the scene wants it, at the scene's speed.
 * Returns the car, now the player's.
 */
function takeCarAt(x, y, angle, speed, prefer) {
  const car = parkedCarNear(x, y, prefer);
  if (!car) return null;
  player.x = car.x;
  player.y = car.y;
  enterCar(car);
  car.x = x;
  car.y = y;
  car.angle = angle;
  car.speed = speed;
  car.braking = false;
  player.x = x;
  player.y = y;
  player.angle = angle;
  return car;
}

/** Put an Interceptor on the street as a live police unit, held mid-chase. */
function placeInterceptor(x, y, angle, speed) {
  const car = createCar(modelByName('PAPD Interceptor'), x, y, angle, null);
  car.driver = 'police';
  car.speed = speed;
  cars.push(car);
  police.units.push({
    car,
    lastSeenX: player.x,
    lastSeenY: player.y,
    unseenFor: 0,
    fireTimer: 1,
    ramCd: 0,
    leaving: undefined,
    recycled: false,
  });
  return car;
}

/** Put a civilian car on the street as live traffic, held mid-drive. */
function placeTrafficCar(model, x, y, angle, speed, kind, line, dir) {
  const car = createCar(modelByName(model), x, y, angle, null);
  car.driver = 'traffic';
  car.speed = speed;
  cars.push(car);
  traffic.entries.push({ car, kind, line, dir, cruise: speed, turn: null, decidedFor: null });
  return car;
}

/** Half a driving lane from a road's centre line: where a car in traffic sits. */
const SHOT_LANE = 19;

/**
 * The cover: Rafi northbound on the 1160 avenue in a taken sedan, mission
 * 1 on the clock, two stars of fresh heat and two Interceptors already on
 * his tail, traffic ahead to chase down.
 */
function stageCover() {
  game.setHour(11);
  game.cash = 250;
  // Mission 1, accepted the ordinary way: walk up to Mira and hear her out.
  talkToGiver(-30, 14);
  walkDialogue();
  takeCarAt(1160 + SHOT_LANE, 1500, -Math.PI / 2, 118, ['Marina Sedan', 'Comet Hatch']);
  // The theft's heat is yesterday's news; the chase carries exactly two stars.
  wanted.reset();
  wanted.addHeat(45);
  placeInterceptor(1160 + SHOT_LANE, 1500 + 175, -Math.PI / 2, 118);
  placeInterceptor(1160 + SHOT_LANE, 1500 + 335, -Math.PI / 2, 106);
  placeTrafficCar('Comet Hatch', 1160 + SHOT_LANE, 1120, -Math.PI / 2, 96, 'v', 1160, -1);
  placeTrafficCar('Cargo Van', 1160 - SHOT_LANE, 1235, Math.PI / 2, 88, 'v', 1160, 1);
  placeTrafficCar('Marina Sedan', 930, 1480 + SHOT_LANE, 0, 92, 'h', 1480, 1);
}

/**
 * On foot at the Old Market: mission 1 delivered, Rafi standing in front
 * of Old Tomas with the talk prompt up, neighbours on the sidewalks and
 * traffic rolling through the square.
 */
function stageMarket() {
  game.setHour(11.5);
  game.cash = 250;
  missions.setProgress({ missionIndex: 1, storyDone: false });
  const def = missions.availableDef();
  const { spot } = missions.giverSpot(def);
  player.x = spot.x - 42;
  player.y = spot.y + 32;
  player.angle = Math.atan2(spot.y - player.y, spot.x - player.x);
  // Three neighbours, stood on the market's sidewalks where the crowd walks.
  const neighbours = [
    { x: spot.x - 46, y: spot.y - 130, angle: Math.PI / 2 },
    { x: spot.x + 46, y: spot.y + 120, angle: -Math.PI / 2 },
    { x: spot.x - 150, y: spot.y + 46, angle: 0 },
  ];
  neighbours.forEach((pose, i) => {
    const ped = peds[i];
    if (!ped) return;
    ped.x = pose.x;
    ped.y = pose.y;
    ped.angle = pose.angle;
  });
  placeTrafficCar('Sol Taxi', spot.x - 210, spot.y + SHOT_LANE, 0, 84, 'h', 2120, 1);
  placeTrafficCar('Dune Pickup', spot.x - SHOT_LANE, spot.y - 190, Math.PI / 2, 80, 'v', 520, 1);
}

/**
 * The pier: Rafi beside Mira Solano at the Marina, her first line still
 * on screen, the water and the palms around them.
 */
function stagePier() {
  game.setHour(10.75);
  talkToGiver(-36, 8);
}

/**
 * Night on Palm Beach: a taken car eastbound on the promenade with its
 * headlights burning, traffic around it, the dark over the bay — and one
 * star of attention already earned.
 */
function stageNight() {
  game.setHour(21.5);
  takeCarAt(1160, CITY.beachY + SHOT_LANE, 0, 96, ['Marina Sedan', 'Comet Hatch', 'Dune Pickup']);
  wanted.reset();
  wanted.addHeat(25);
  placeTrafficCar('Sol Taxi', 1620, CITY.beachY + SHOT_LANE, 0, 84, 'h', CITY.beachY, 1);
  placeTrafficCar('Comet Hatch', 760, CITY.beachY - SHOT_LANE, Math.PI, 88, 'h', CITY.beachY, -1);
}

const shotName = new URLSearchParams(window.location.search).get('shot');
if (shotName) stageShot(shotName);
