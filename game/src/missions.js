// Missions: Rafi's story in Port Azura, and the courier work that fills the
// gaps between its chapters. Five story missions run in a fixed chain — each
// giver waits at their landmark with the next job until the previous one is
// done — and each is a short list of steps the player works through: fetch a
// package, steal a particular taxi, bring the heat to a lookout and then
// lose it, beat a checkpoint clock, outrun a forced three-star escape. A
// mission the law interrupts (busted or wasted mid-job, read off the game
// state main.js keeps) fails and goes back to its giver. Between story jobs,
// courier packages spawn around the city for quick cash. This module owns
// the state machine and the world markers; main.js owns drawing the HUD
// around what objective(), dialogue and talkPrompt() report.
import { events } from './events.js';
import { mouse, pressed, wasPressed } from './input.js';
import { circleHitsBuilding, circleHitsWater, districtAt, landmarkByName } from './world.js';

/** How close the player must stand to a giver before E means "talk". */
const TALK_RADIUS = 72;
/** Default reach for a goto/pickup marker: close enough to mean it. */
const DEFAULT_RADIUS = 70;
/** Checkpoints are driven through at speed, so their reach is generous. */
const CHECKPOINT_RADIUS = 85;
/** Courier packages are grabbed by passing close, in a car or on foot. */
const COURIER_PICKUP_RADIUS = 55;
const COURIER_DELIVER_RADIUS = 65;
/** Seconds after a courier delivery before the next package appears. */
const COURIER_RESPAWN_SEC = 6;

/** The people who run Port Azura's errands, and where each of them waits. */
const GIVERS = {
  mira: { key: 'mira', name: 'Mira Solano', landmark: 'Marina Pier', color: '#ffd94d' },
  tomas: { key: 'tomas', name: 'Old Tomas', landmark: 'Old Market Square', color: '#ffb37a' },
  vega: { key: 'vega', name: 'Vega', landmark: 'Hillcrest Lookout', color: '#c9a6ff' },
};

/**
 * The nearest spot to (x, y) a person can actually stand — the point itself,
 * or a ring search outward — clear of buildings and water. Landmarks are
 * named for the place, not the pavement: the lookout point sits inside a
 * block, so givers and markers are snapped to the street beside it.
 */
function findSpot(x, y) {
  for (let r = 0; r <= 280; r += 26) {
    const tries = r === 0 ? 1 : 10;
    for (let i = 0; i < tries; i += 1) {
      const a = (i / tries) * Math.PI * 2;
      const cx = x + Math.cos(a) * r;
      const cy = y + Math.sin(a) * r;
      if (!circleHitsBuilding(cx, cy, 16) && !circleHitsWater(cx, cy, 16)) return { x: cx, y: cy };
    }
  }
  return { x, y };
}

function lm(name) {
  const mark = landmarkByName(name);
  return { x: mark.x, y: mark.y };
}

/** Where each giver actually stands: their landmark, snapped to open ground. */
const GIVER_SPOTS = {};
for (const giver of Object.values(GIVERS)) {
  const at = lm(giver.landmark);
  GIVER_SPOTS[giver.key] = findSpot(at.x, at.y);
}

/** The five chapters of Rafi's story, in the order Port Azura tells them. */
const STORY = [
  {
    id: 'first-run',
    title: 'First Run',
    giver: 'mira',
    reward: 250,
    intro: [
      { who: 'Mira Solano', text: "You must be Rafi. Tomas said you'd come — said you drive like the tide owes you money." },
      { who: 'Rafi', text: 'Tomas says a lot of things. I need work, not compliments.' },
      { who: 'Mira Solano', text: "Then work. There's a package down the pier with my name on it. Take it to Tomas at the Old Market — and don't open it." },
      { who: 'Rafi', text: "Didn't ask what's inside. That costs extra, right?" },
      { who: 'Mira Solano', text: 'Smart boy. Go.' },
    ],
    failLine: 'Heard the law got a piece of you. The job is off — come back clean.',
    steps: [
      { kind: 'pickup', at: { x: 2090, y: 2500 }, label: "Pick up Mira's package at the pier" },
      { kind: 'goto', at: lm('Old Market Square'), label: 'Deliver the package to Old Tomas' },
    ],
  },
  {
    id: 'hot-wheels',
    title: 'Hot Wheels',
    giver: 'tomas',
    reward: 400,
    intro: [
      { who: 'Old Tomas', text: "Rafi. A Sol Taxi owes me money — well, its owner does. The car's parked near the market, yellow as a guilty conscience." },
      { who: 'Old Tomas', text: "Take it. Drive it to my buyer's drop on Palm Beach. He counts the minutes, so no sightseeing." },
    ],
    failLine: 'The taxi job is off. My buyer hates waiting — and hates the PAPD more.',
    steps: [
      { kind: 'steal', model: 'Sol Taxi', near: lm('Old Market Square'), label: 'Steal the marked Sol Taxi' },
      {
        kind: 'goto',
        at: { x: 1000, y: 2440 },
        inModel: 'Sol Taxi',
        timeLimitSec: 240,
        label: 'Deliver the taxi to the Palm Beach drop',
      },
    ],
  },
  {
    id: 'shake-the-heat',
    title: 'Shake the Heat',
    giver: 'vega',
    reward: 500,
    intro: [
      { who: 'Vega', text: "So you're Mira's new runner. Cute. Everyone in this city is watched, Rafi — the trick is knowing how to be unwatched." },
      { who: 'Vega', text: 'Get the PAPD interested — two stars’ worth — then bring that heat up here to my lookout. Then make it disappear. Show me you can vanish.' },
    ],
    failLine: 'Vanishing is harder when they catch you first. Again, when you are ready.',
    steps: [{ kind: 'evade', at: lm('Hillcrest Lookout'), radius: 95, label: 'Bring two stars of heat to Hillcrest Lookout' }],
  },
  {
    id: 'night-courier',
    title: 'Night Courier',
    giver: 'vega',
    reward: 650,
    intro: [
      { who: 'Vega', text: 'Four drops, four corners of my city, one clock. The packages are already moving — you are the part that has to be fast.' },
      { who: 'Rafi', text: 'And if the clock wins?' },
      { who: 'Vega', text: 'Then the city keeps your fee. Drive.' },
    ],
    failLine: 'The clock — or the law — kept your fee. The route is still there.',
    steps: [
      {
        kind: 'checkpoints',
        points: [
          { x: 520, y: 520 },
          { x: 1480, y: 840 },
          { x: 2120, y: 1480 },
          { x: 840, y: 2120 },
        ],
        timeLimitSec: 300,
        label: 'Run the checkpoints',
      },
    ],
  },
  {
    id: 'grand-job',
    title: 'The Grand Job',
    giver: 'mira',
    reward: 1500,
    intro: [
      { who: 'Mira Solano', text: 'Last one, Rafi. My crew is waiting at the Azura Grand Hotel with something the PAPD very much wants back.' },
      { who: 'Mira Solano', text: 'Pick them up. The moment they are in your car, every badge in Port Azura will know. Get them to my pier. All of you, breathing.' },
    ],
    failLine: 'My crew scattered. They will regroup at the hotel — come back when you can.',
    steps: [
      { kind: 'goto', at: lm('Azura Grand Hotel'), radius: 85, label: "Pick up Mira's crew at the Azura Grand Hotel" },
      { kind: 'escape', at: lm('Marina Pier'), radius: 95, forceStars: 3, label: 'Escape! Get the crew to Marina Pier' },
    ],
    outro: [
      { who: 'Mira Solano', text: 'You got them out. Half the PAPD in your mirror and you still made the pier.' },
      { who: 'Rafi', text: "You said it'd be a quiet pickup." },
      { who: 'Mira Solano', text: "And you knew I was lying. That's why you're still breathing, Rafi. Port Azura looks after its own — and now you're one of its own." },
    ],
  },
];

/** Street corners and landmarks a courier package might be waiting at. */
const COURIER_SPOTS = [
  ...Object.values(GIVERS).map((g) => lm(g.landmark)),
  lm('Azura Grand Hotel'),
  { x: 520, y: 520 },
  { x: 1160, y: 1160 },
  { x: 1800, y: 1480 },
  { x: 840, y: 2120 },
  { x: 2120, y: 840 },
  { x: 1480, y: 1800 },
  { x: 1160, y: 2440 },
];

/**
 * A fresh missions state machine. It reads the shared world through the
 * objects main.js hands it — the player, the car list, the wanted system,
 * the game object (cash, screen, lastOutcome) — and a getter for the car
 * the player is driving, since that binding changes as cars are swapped.
 */
export function createMissions({ player, cars, wanted, game, getPlayerCar }) {
  /** The dialogue currently on screen: { lines, i, onDone } or null. */
  let dlg = null;
  /** The courier job on offer or in hand, or null between packages. */
  let courier = null;
  let courierTimer = 2.5;

  const missions = {
    /** Story chapters completed: also the index of the next one to offer. */
    missionIndex: 0,
    storyDone: false,
    /** The running mission: { def, stepIndex, rt } or null. */
    active: null,
    /** The current dialogue line as { who, text }, or null. */
    dialogue: null,
    /** A centre-screen notice: { text, t } with t counting down, or null. */
    banner: null,

    /** The next story chapter waiting for the player, or null. */
    availableDef() {
      if (missions.storyDone || missions.active) return null;
      return STORY[missions.missionIndex] || null;
    },

    /** The giver of the available mission and where they stand. */
    giverSpot(def) {
      const giver = GIVERS[def.giver];
      return { giver, spot: GIVER_SPOTS[def.giver] };
    },

    /** Adopt saved progress (Continue) or wipe it (New game). */
    setProgress({ missionIndex, storyDone }) {
      missions.missionIndex = missionIndex;
      missions.storyDone = storyDone;
      missions.active = null;
      dlg = null;
      missions.dialogue = null;
    },

    resetProgress() {
      missions.setProgress({ missionIndex: 0, storyDone: false });
      missions.banner = null;
      courier = null;
      courierTimer = 2.5;
    },

    /**
     * E beside a giver: start their mission's conversation. Returns true
     * when the press was spent talking, so main.js does not also try to
     * put the player into a car with the same keystroke.
     */
    tryTalk() {
      const def = missions.availableDef();
      if (!def || dlg || getPlayerCar()) return false;
      const { spot } = missions.giverSpot(def);
      if (Math.hypot(player.x - spot.x, player.y - spot.y) > TALK_RADIUS) return false;
      openDialogue(def.intro, () => startMission(def));
      return true;
    },

    /** The "E — Talk to …" prompt when the player stands beside a giver. */
    talkPrompt() {
      const def = missions.availableDef();
      if (!def || dlg || getPlayerCar()) return null;
      const { giver, spot } = missions.giverSpot(def);
      if (Math.hypot(player.x - spot.x, player.y - spot.y) > TALK_RADIUS) return null;
      return `E — Talk to ${giver.name}`;
    },

    /** The HUD's objective line: { text, timer } or null when there is none. */
    objective() {
      if (dlg) return null;
      const active = missions.active;
      if (active) {
        const rt = active.rt;
        let text = rt.step.label;
        if (rt.step.kind === 'evade') {
          text =
            rt.phase === 'reach'
              ? wanted.stars >= 2
                ? 'Get to Hillcrest Lookout — and bring the heat with you'
                : 'Make some noise: reach 2 wanted stars, then head for Hillcrest Lookout'
              : 'Now lose them: hide until your stars are gone';
        } else if (rt.step.kind === 'checkpoints') {
          const pt = rt.step.points[rt.cpIndex];
          text = `Checkpoint ${rt.cpIndex + 1} of ${rt.step.points.length} — ${districtAt(pt.x, pt.y)}`;
        }
        return { text, timer: rt.timeLeft };
      }
      if (courier && courier.phase === 'deliver') {
        return { text: `Deliver the courier package — $${courier.reward} waiting`, timer: null };
      }
      const def = missions.availableDef();
      if (def) {
        const { giver } = missions.giverSpot(def);
        return { text: `Talk to ${giver.name} at ${giver.landmark} — “${def.title}”`, timer: null };
      }
      if (courier && courier.phase === 'pickup') {
        return { text: 'Courier work: pick up the gold package', timer: null };
      }
      return null;
    },

    /** Every world marker worth a beacon right now, story first. */
    markers() {
      const list = [];
      const active = missions.active;
      if (active) {
        const rt = active.rt;
        const step = rt.step;
        if (step.kind === 'steal') {
          if (rt.targetCar) list.push({ kind: 'steal', x: rt.targetCar.x, y: rt.targetCar.y });
        } else if (step.kind === 'checkpoints') {
          const pt = step.points[rt.cpIndex];
          list.push({ kind: 'checkpoint', x: pt.x, y: pt.y, n: rt.cpIndex + 1 });
        } else if (step.kind === 'pickup') {
          list.push({ kind: 'pickup', x: rt.point.x, y: rt.point.y });
        } else {
          list.push({ kind: 'goto', x: rt.point.x, y: rt.point.y });
        }
      } else {
        const def = missions.availableDef();
        if (def) {
          const { giver, spot } = missions.giverSpot(def);
          list.push({ kind: 'giver', x: spot.x, y: spot.y, name: giver.name, color: giver.color });
        }
      }
      if (courier) {
        if (courier.phase === 'pickup') list.push({ kind: 'courierPickup', x: courier.px, y: courier.py });
        else list.push({ kind: 'courierDeliver', x: courier.dx, y: courier.dy });
      }
      return list;
    },

    /**
     * Advance the whole machine one fixed step. main.js calls this on the
     * playing screen and on the busted/wasted overlays — the overlays are
     * where a run-in with the law fails the running mission.
     */
    update(dt) {
      if (game.screen === 'busted' || game.screen === 'wasted') {
        if (missions.active && game.lastOutcome) failMission(game.lastOutcome);
        return;
      }
      if (game.screen !== 'playing') return;
      if (missions.banner) {
        missions.banner.t -= dt;
        if (missions.banner.t <= 0) missions.banner = null;
      }
      if (dlg) {
        if (wasPressed('KeyE', 'Enter') || mouse.clicked) {
          pressed.delete('KeyE');
          pressed.delete('Enter');
          mouse.clicked = false;
          advanceDialogue();
        }
        return;
      }
      stepCourier(dt);
      if (missions.active) stepMission(dt);
    },
  };

  function openDialogue(lines, onDone) {
    dlg = { lines, i: 0, onDone };
    missions.dialogue = lines[0];
  }

  function advanceDialogue() {
    dlg.i += 1;
    if (dlg.i >= dlg.lines.length) {
      const done = dlg.onDone;
      dlg = null;
      missions.dialogue = null;
      if (done) done();
    } else {
      missions.dialogue = dlg.lines[dlg.i];
    }
  }

  function startMission(def) {
    missions.active = { def, stepIndex: 0, rt: null };
    events.emit('missionStarted', { id: def.id });
    startStep();
  }

  /** Prepare the runtime state for the active mission's current step. */
  function startStep() {
    const active = missions.active;
    const step = active.def.steps[active.stepIndex];
    const rt = { step, timeLeft: step.timeLimitSec != null ? step.timeLimitSec : null, phase: 'reach', cpIndex: 0, point: null, targetCar: null };
    if (step.at) {
      // Road-centre points (the hotel, the promenade drop) pass the search
      // unchanged; block-interior ones (the lookout) snap to the street.
      rt.point = findSpot(step.at.x, step.at.y);
    }
    if (step.kind === 'steal') {
      let best = null;
      let bestDist = Infinity;
      for (const car of cars) {
        if (!car.parked || car.model.name !== step.model) continue;
        const d = Math.hypot(car.x - step.near.x, car.y - step.near.y);
        if (d < bestDist) {
          bestDist = d;
          best = car;
        }
      }
      rt.targetCar = best;
    }
    if (step.kind === 'escape') {
      // The pickup is blown the moment it happens: force the wanted level
      // up to the step's star count, whatever Rafi was carrying before.
      const thresholds = [20, 40, 60, 80, 100];
      const target = thresholds[step.forceStars - 1] || 60;
      if (wanted.heat < target) wanted.addHeat(target - wanted.heat);
      else wanted.addHeat(1);
    }
    active.rt = rt;
  }

  function completeStep() {
    const active = missions.active;
    active.stepIndex += 1;
    if (active.stepIndex < active.def.steps.length) {
      startStep();
      return;
    }
    if (active.def.outro) {
      const def = active.def;
      openDialogue(def.outro, () => finishMission(def));
    } else {
      finishMission(active.def);
    }
    missions.active = null;
  }

  function finishMission(def) {
    game.cash += def.reward;
    missions.missionIndex += 1;
    events.emit('missionComplete', { id: def.id, reward: def.reward });
    if (missions.missionIndex >= STORY.length) {
      missions.storyDone = true;
      missions.banner = { text: 'STORY COMPLETE — Port Azura is yours. Free roam, courier work continues.', t: 6 };
    } else {
      missions.banner = { text: `Mission complete — ${def.title} · +$${def.reward}`, t: 5 };
    }
  }

  function failMission(reason) {
    const def = missions.active.def;
    missions.active = null;
    events.emit('missionFailed', { id: def.id, reason });
    const giver = GIVERS[def.giver];
    missions.banner = { text: `${giver.name}: “${def.failLine}”`, t: 6 };
  }

  /** One step of the running story mission: timers, reaches, completions. */
  function stepMission(dt) {
    const active = missions.active;
    const rt = active.rt;
    const step = rt.step;
    if (rt.timeLeft != null) {
      rt.timeLeft -= dt;
      if (rt.timeLeft <= 0) {
        failMission('time');
        return;
      }
    }
    const car = getPlayerCar();
    const dist = rt.point ? Math.hypot(player.x - rt.point.x, player.y - rt.point.y) : Infinity;
    const radius = step.radius || DEFAULT_RADIUS;
    switch (step.kind) {
      case 'goto':
      case 'pickup': {
        if (step.inModel && (!car || car.model.name !== step.inModel)) break;
        if (dist <= radius) {
          if (step.kind === 'pickup') events.emit('pickup', { x: rt.point.x, y: rt.point.y });
          completeStep();
        }
        break;
      }
      case 'steal': {
        if (rt.targetCar && car === rt.targetCar) completeStep();
        break;
      }
      case 'evade': {
        if (rt.phase === 'reach') {
          if (dist <= radius && wanted.stars >= 2) rt.phase = 'lose';
        } else if (wanted.stars === 0) {
          completeStep();
        }
        break;
      }
      case 'checkpoints': {
        const pt = step.points[rt.cpIndex];
        if (Math.hypot(player.x - pt.x, player.y - pt.y) <= CHECKPOINT_RADIUS) {
          rt.cpIndex += 1;
          events.emit('pickup', { x: pt.x, y: pt.y });
          if (rt.cpIndex >= step.points.length) completeStep();
        }
        break;
      }
      case 'escape': {
        if (dist <= radius) completeStep();
        break;
      }
      default:
        break;
    }
  }

  /** Courier work: spawn packages, notice pickups and deliveries. */
  function stepCourier(dt) {
    if (!courier) {
      if (!missions.active) {
        courierTimer -= dt;
        if (courierTimer <= 0) spawnCourier();
      }
      return;
    }
    if (courier.phase === 'pickup') {
      if (Math.hypot(player.x - courier.px, player.y - courier.py) <= COURIER_PICKUP_RADIUS) {
        courier.phase = 'deliver';
        events.emit('pickup', { x: courier.px, y: courier.py });
      }
    } else if (Math.hypot(player.x - courier.dx, player.y - courier.dy) <= COURIER_DELIVER_RADIUS) {
      const reward = courier.reward;
      courier = null;
      courierTimer = COURIER_RESPAWN_SEC;
      game.cash += reward;
      events.emit('courierComplete', { reward });
      missions.banner = { text: `Courier delivered · +$${reward}`, t: 3.5 };
    }
  }

  function spawnCourier() {
    const pickSpot = COURIER_SPOTS[Math.floor(Math.random() * COURIER_SPOTS.length)];
    let dropSpot = pickSpot;
    for (let tries = 0; tries < 8 && dropSpot === pickSpot; tries += 1) {
      const candidate = COURIER_SPOTS[Math.floor(Math.random() * COURIER_SPOTS.length)];
      if (Math.hypot(candidate.x - pickSpot.x, candidate.y - pickSpot.y) > 600) dropSpot = candidate;
    }
    const p = findSpot(pickSpot.x, pickSpot.y);
    const d = findSpot(dropSpot.x, dropSpot.y);
    courier = {
      phase: 'pickup',
      px: p.x,
      py: p.y,
      dx: d.x,
      dy: d.y,
      reward: 80 + Math.floor(Math.random() * 71),
    };
  }

  return missions;
}

/**
 * Paint one mission marker in world space: a pillar of light over the
 * point, a pulsing ring at its base, and a glyph for the kind — a person
 * for a giver, a parcel for a pickup, a gold $ for a delivery, a wide ring
 * for a checkpoint, a targeting ring for the car to steal.
 */
export function drawMarker(ctx, marker, t) {
  const pulse = 0.5 + 0.5 * Math.sin(t * 3.2);
  const gold = '#ffd94d';
  ctx.save();
  // The pillar: a soft column of light so the goal reads across rooftops —
  // gold for work, pale blue over a person who is waiting to talk.
  const grad = ctx.createLinearGradient(0, marker.y - 150, 0, marker.y);
  if (marker.kind === 'giver') {
    grad.addColorStop(0, 'rgba(160, 230, 255, 0)');
    grad.addColorStop(1, 'rgba(160, 230, 255, 0.30)');
  } else {
    grad.addColorStop(0, 'rgba(255, 217, 77, 0)');
    grad.addColorStop(1, 'rgba(255, 217, 77, 0.34)');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(marker.x - 5, marker.y - 150, 10, 150);
  // The base ring, breathing with the pulse.
  ctx.strokeStyle = marker.kind === 'giver' ? marker.color || '#a0e6ff' : gold;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(marker.x, marker.y, (marker.kind === 'checkpoint' ? 30 : 17) + pulse * 5, 0, Math.PI * 2);
  ctx.stroke();

  if (marker.kind === 'giver') {
    // A person waiting: shadow, coat, head, and their name overhead.
    ctx.fillStyle = 'rgba(30, 25, 15, 0.28)';
    ctx.beginPath();
    ctx.ellipse(marker.x + 2, marker.y + 3, 6.4, 4.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = marker.color || '#ffd94d';
    ctx.beginPath();
    ctx.arc(marker.x, marker.y, 6.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f2c79b';
    ctx.beginPath();
    ctx.arc(marker.x + 1.6, marker.y, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 3.4;
    ctx.strokeStyle = 'rgba(5, 12, 20, 0.65)';
    const label = marker.name || '';
    ctx.strokeText(label, marker.x, marker.y - 24);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, marker.x, marker.y - 24);
  } else if (marker.kind === 'pickup' || marker.kind === 'courierPickup') {
    // A parcel: brown board, tape cross, gold bow.
    ctx.fillStyle = 'rgba(30, 25, 15, 0.25)';
    ctx.fillRect(marker.x - 9, marker.y - 4, 19, 6);
    ctx.fillStyle = '#a9805a';
    ctx.fillRect(marker.x - 10, marker.y - 9, 20, 14);
    ctx.strokeStyle = '#ffd94d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(marker.x, marker.y - 9);
    ctx.lineTo(marker.x, marker.y + 5);
    ctx.moveTo(marker.x - 10, marker.y - 2);
    ctx.lineTo(marker.x + 10, marker.y - 2);
    ctx.stroke();
  } else if (marker.kind === 'courierDeliver' || marker.kind === 'goto') {
    if (marker.kind === 'courierDeliver') {
      ctx.font = '700 26px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(5, 12, 20, 0.6)';
      ctx.strokeText('$', marker.x, marker.y - 14);
      ctx.fillStyle = gold;
      ctx.fillText('$', marker.x, marker.y - 14);
    }
  } else if (marker.kind === 'checkpoint') {
    ctx.font = '700 20px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(5, 12, 20, 0.6)';
    const label = String(marker.n || '');
    ctx.strokeText(label, marker.x, marker.y + 7);
    ctx.fillStyle = gold;
    ctx.fillText(label, marker.x, marker.y + 7);
  } else if (marker.kind === 'steal') {
    ctx.strokeStyle = `rgba(255, 180, 0, ${0.55 + pulse * 0.4})`;
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.arc(marker.x, marker.y, 36 + pulse * 4, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}
