// Port Azura itself: the city generated once from the seed in config.js, plus the
// questions the rest of the game asks about it — does this circle hit a building,
// is this point water, which district is this. Generation is pure data: no canvas,
// no browser, and the same seed always builds the same streets, so traffic,
// missions and the renderer can all trust the layout they are handed.
import { CITY, PALETTE, SEED, WORLD } from './config.js';
import { intRange, mulberry32, pick, range } from './random.js';

/** Road centre lines, split by orientation. Later traffic drives along these. */
function roadLines() {
  const vertical = [];
  for (let x = CITY.margin; x <= WORLD.width - CITY.margin; x += CITY.blockPitch) vertical.push(x);
  const horizontal = [];
  for (let y = CITY.margin; y <= CITY.beachY; y += CITY.blockPitch) horizontal.push(y);
  return { vertical, horizontal };
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * Fill the blocks between the roads with buildings. Each block's interior (inside
 * the sidewalks) is cut into a 1-2 by 1-2 grid; most cells get a pastel tower with
 * a floor count, a few are left empty so the city breathes — plazas, car parks,
 * the odd courtyard. One block in twelve is skipped whole.
 */
function buildBlocks(rng, lines) {
  const buildings = [];
  const halfRoad = CITY.roadWidth / 2;
  const inset0 = halfRoad + CITY.sidewalk;
  for (let i = 0; i < lines.vertical.length - 1; i += 1) {
    for (let j = 0; j < lines.horizontal.length - 1; j += 1) {
      const x0 = lines.vertical[i] + inset0;
      const x1 = lines.vertical[i + 1] - inset0;
      const y0 = lines.horizontal[j] + inset0;
      const y1 = lines.horizontal[j + 1] - inset0;
      if (x1 - x0 < 60 || y1 - y0 < 60) continue;
      if (rng() < 0.08) continue; // an open plaza block
      const cols = intRange(rng, 1, 2);
      const rows = intRange(rng, 1, 2);
      const gap = 12;
      const cellW = (x1 - x0 - gap * (cols - 1)) / cols;
      const cellH = (y1 - y0 - gap * (rows - 1)) / rows;
      for (let c = 0; c < cols; c += 1) {
        for (let r = 0; r < rows; r += 1) {
          if (rng() < 0.12) continue; // an empty lot inside the block
          const inset = range(rng, 2, 9);
          const b = {
            x: x0 + c * (cellW + gap) + inset,
            y: y0 + r * (cellH + gap) + inset,
            w: cellW - inset * 2,
            h: cellH - inset * 2,
            color: pick(rng, PALETTE.buildings),
            floors: intRange(rng, 2, 14),
          };
          if (!rectsOverlap(b, CITY.bay)) buildings.push(b);
        }
      }
    }
  }
  return buildings;
}

/**
 * Palms: a double row along the promenade and the beach west of the bay, plus a
 * scatter at street corners all over the city. Pure decoration — nothing collides
 * with a palm.
 */
function plantPalms(rng, lines) {
  const palms = [];
  const halfRoad = CITY.roadWidth / 2;
  for (let x = 280; x < CITY.bay.x - 40; x += 108) {
    palms.push({ x: x + range(rng, -22, 22), y: CITY.beachY - halfRoad - CITY.sidewalk - 10 });
    if (rng() < 0.8) palms.push({ x: x + range(rng, -30, 30), y: CITY.waterY - range(rng, 24, 90) });
  }
  for (let n = 0; n < 42; n += 1) {
    const vx = pick(rng, lines.vertical);
    const vy = pick(rng, lines.horizontal);
    const sx = rng() < 0.5 ? -1 : 1;
    const sy = rng() < 0.5 ? -1 : 1;
    palms.push({ x: vx + sx * (halfRoad + 8), y: vy + sy * (halfRoad + 8) });
  }
  return palms;
}

/**
 * Props: street lamps at intersections (every other crossing, alternating
 * corners) and wooden crates stacked around the Marina and the Old Market, where
 * the city's goods change hands. Props are scenery for now; later systems may
 * give the crates something to hide.
 */
function placeProps(rng, lines, buildings) {
  const props = [];
  const halfRoad = CITY.roadWidth / 2;
  lines.vertical.forEach((vx, i) => {
    lines.horizontal.forEach((vy, j) => {
      if ((i + j) % 2 !== 0) return;
      const sx = (i + j) % 4 === 0 ? 1 : -1;
      props.push({ kind: 'lamp', x: vx + sx * (halfRoad + 7), y: vy - (halfRoad + 7) });
    });
  });
  const crateZones = [
    { x: 1880, y: 2240, w: 420, h: 150 }, // Marina quayside
    { x: 240, y: 1900, w: 560, h: 200 }, // Old Market yards
  ];
  for (const zone of crateZones) {
    for (let n = 0; n < 14; n += 1) {
      for (let tries = 0; tries < 6; tries += 1) {
        const crate = { kind: 'crate', x: range(rng, zone.x, zone.x + zone.w), y: range(rng, zone.y, zone.y + zone.h), size: range(rng, 14, 24) };
        const asRect = { x: crate.x, y: crate.y, w: crate.size, h: crate.size };
        if (!buildings.some((b) => rectsOverlap(asRect, b))) {
          props.push(crate);
          break;
        }
      }
    }
  }
  return props;
}

function generateCity() {
  const rng = mulberry32(SEED);
  const lines = roadLines();
  const buildings = buildBlocks(rng, lines);
  const palms = plantPalms(rng, lines);
  const props = placeProps(rng, lines, buildings);
  return { roadLines: lines, buildings, palms, props };
}

/** The generated city: { roadLines, buildings, palms, props }. */
export const city = generateCity();

/** Road centre lines for traffic and the renderer: { vertical: [...], horizontal: [...] }. */
export const ROAD_LINES = city.roadLines;

/** Where a fresh player steps into the city: on the promenade, facing the marina. */
export const playerSpawn = { x: 1160, y: CITY.beachY };

/** Named places later missions will send the player to. */
export const LANDMARKS = [
  { name: 'Marina Pier', x: 2260, y: 2560 },
  { name: 'Old Market Square', x: 520, y: 2120 },
  { name: 'Hillcrest Lookout', x: 360, y: 360 },
  { name: 'Azura Grand Hotel', x: 1480, y: 1160 },
  { name: 'Port Azura Police HQ', x: 660, y: 1980 },
  { name: 'St. Azura Hospital', x: 680, y: 380 },
];

/** One landmark by its exact name, or null when Port Azura has no such place. */
export function landmarkByName(name) {
  return LANDMARKS.find((mark) => mark.name === name) || null;
}

// The two civic landmarks are not just points on the map: each one is a real
// building in its district — the police headquarters a few streets north of
// Old Market Square, the hospital up in Hillcrest below the lookout. Tag the
// tower nearest each point with the landmark's name, so the renderer can
// tint it and hang a label on it, and the law can send people to its door.
for (const name of ['Port Azura Police HQ', 'St. Azura Hospital']) {
  const mark = landmarkByName(name);
  let best = null;
  let bestDist = Infinity;
  for (const b of city.buildings) {
    const d = Math.hypot(b.x + b.w / 2 - mark.x, b.y + b.h / 2 - mark.y);
    if (d < bestDist) {
      bestDist = d;
      best = b;
    }
  }
  if (best) best.landmark = name;
}

/** Districts, checked in order; anything outside them is greater Port Azura. */
export const DISTRICTS = [
  { name: 'Hillcrest', x: 0, y: 0, w: 1020, h: 1020 },
  { name: 'Downtown Azura', x: 1020, y: 700, w: 1300, h: 1100 },
  { name: 'Old Market', x: 0, y: 1500, w: 1020, h: 940 },
  { name: 'Marina', x: 1800, y: 1500, w: 550, h: 940 },
  { name: 'Palm Beach', x: 0, y: CITY.beachY, w: CITY.bay.x, h: CITY.waterY - CITY.beachY },
];

/** True when the point is open water: the southern sea, or inside the bay. */
export function pointInWater(x, y) {
  if (y >= CITY.waterY) return true;
  const b = CITY.bay;
  return x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
}

/** True when any part of the circle touches water (centre and four rim points). */
export function circleHitsWater(x, y, r) {
  return (
    pointInWater(x, y) ||
    pointInWater(x - r, y) ||
    pointInWater(x + r, y) ||
    pointInWater(x, y - r) ||
    pointInWater(x, y + r)
  );
}

/** True when the circle overlaps any building in the city. */
export function circleHitsBuilding(x, y, r) {
  for (const b of city.buildings) {
    const nx = Math.max(b.x, Math.min(x, b.x + b.w));
    const ny = Math.max(b.y, Math.min(y, b.y + b.h));
    const dx = x - nx;
    const dy = y - ny;
    if (dx * dx + dy * dy < r * r) return true;
  }
  return false;
}

/** The district a point stands in — 'Azura Bay' for open water. */
export function districtAt(x, y) {
  if (pointInWater(x, y)) return 'Azura Bay';
  for (const d of DISTRICTS) {
    if (x >= d.x && x < d.x + d.w && y >= d.y && y < d.y + d.h) return d.name;
  }
  return 'Port Azura';
}
