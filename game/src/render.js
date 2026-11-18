// Drawing only: the generated city and a camera go in, pixels come out. Everything
// is flat canvas shapes — shaded rectangles for towers, arcs for palms, dashed
// centrelines on the avenues — drawn in world coordinates under a camera
// translation, and culled to the camera's view so the far side of the city costs
// nothing. The day tint is a single translucent wash laid over the world at the
// end, so noon, dusk and night are the same drawing under different light.
import { CITY, PALETTE, WORLD } from './config.js';
import { city } from './world.js';

/**
 * A camera: the world-space rectangle currently on screen. follow() centres it on
 * a target and clamps it inside the world; when the window is larger than the
 * world on an axis, the camera centres on that axis instead.
 */
export function createCamera() {
  const cam = { x: 0, y: 0, w: 0, h: 0 };
  cam.centreOn = function centreOn(tx, ty, viewW, viewH) {
    cam.w = viewW;
    cam.h = viewH;
    cam.x = viewW >= WORLD.width ? (WORLD.width - viewW) / 2 : Math.max(0, Math.min(tx - viewW / 2, WORLD.width - viewW));
    cam.y = viewH >= WORLD.height ? (WORLD.height - viewH) / 2 : Math.max(0, Math.min(ty - viewH / 2, WORLD.height - viewH));
  };
  cam.follow = function follow(target, viewW, viewH) {
    cam.centreOn(target.x, target.y, viewW, viewH);
  };
  return cam;
}

/** Turn a screen-space point (mouse) into a world-space one under this camera. */
export function screenToWorld(cam, sx, sy) {
  return { x: cam.x + sx, y: cam.y + sy };
}

function inView(cam, x, y, w, h) {
  return x + w >= cam.x && x <= cam.x + cam.w && y + h >= cam.y && y <= cam.y + cam.h;
}

function drawGround(ctx, cam) {
  ctx.fillStyle = PALETTE.cityGround;
  ctx.fillRect(cam.x, cam.y, cam.w, cam.h);
  // Parkland bands along the north and west edges, where the city runs out.
  ctx.fillStyle = PALETTE.grass;
  if (cam.y < 84) ctx.fillRect(cam.x, cam.y, cam.w, 84 - cam.y);
  if (cam.x < 84) ctx.fillRect(cam.x, cam.y, 84 - cam.x, cam.h);
  // The beach: sand from the promenade to the waterline, west of the bay, and a
  // narrow shore strip down the bay's west side.
  ctx.fillStyle = PALETTE.sand;
  ctx.fillRect(cam.x, Math.max(cam.y, CITY.beachY), cam.w, CITY.waterY - CITY.beachY);
  ctx.fillRect(CITY.bay.x - 38, CITY.bay.y, 38, WORLD.height - CITY.bay.y);
}

function drawWater(ctx) {
  const b = CITY.bay;
  // A pale shoreline rim first, slightly larger than the water it edges.
  ctx.fillStyle = PALETTE.shoreline;
  ctx.fillRect(0, CITY.waterY - 10, WORLD.width, 12);
  ctx.fillRect(b.x - 10, b.y - 10, b.w + 20, b.h + 12);
  // The sea proper: the southern band and the bay cutting up into the city.
  ctx.fillStyle = PALETTE.water;
  ctx.fillRect(0, CITY.waterY, WORLD.width, WORLD.height - CITY.waterY);
  ctx.fillRect(b.x, b.y, b.w, b.h);
  // Deeper water at the bay mouth.
  ctx.fillStyle = PALETTE.waterDeep;
  ctx.fillRect(b.x + 260, CITY.waterY - 60, b.w - 260, WORLD.height - CITY.waterY + 60);
}

function drawRoads(ctx, cam) {
  const half = CITY.roadWidth / 2;
  const slab = CITY.sidewalk;
  const { vertical, horizontal } = city.roadLines;
  ctx.fillStyle = PALETTE.sidewalk;
  for (const x of vertical) {
    if (!inView(cam, x - half - slab, 0, CITY.roadWidth + slab * 2, CITY.beachY + half)) continue;
    ctx.fillRect(x - half - slab, 0, CITY.roadWidth + slab * 2, CITY.beachY + half + slab);
  }
  for (const y of horizontal) {
    const span = y === CITY.beachY ? CITY.bay.x : WORLD.width;
    if (!inView(cam, 0, y - half - slab, span, CITY.roadWidth + slab * 2)) continue;
    ctx.fillRect(0, y - half - slab, span, CITY.roadWidth + slab * 2);
  }
  ctx.fillStyle = PALETTE.asphalt;
  for (const x of vertical) {
    if (!inView(cam, x - half, 0, CITY.roadWidth, CITY.beachY + half)) continue;
    ctx.fillRect(x - half, 0, CITY.roadWidth, CITY.beachY + half);
  }
  for (const y of horizontal) {
    const span = y === CITY.beachY ? CITY.bay.x : WORLD.width;
    if (!inView(cam, 0, y - half, span, CITY.roadWidth)) continue;
    // The promenade along the beach gets its own sun-baked tone.
    ctx.fillStyle = y === CITY.beachY ? PALETTE.promenade : PALETTE.asphalt;
    ctx.fillRect(0, y - half, span, CITY.roadWidth);
    ctx.fillStyle = PALETTE.asphalt;
  }
  // Dashed centrelines.
  ctx.strokeStyle = PALETTE.roadLine;
  ctx.lineWidth = 3;
  ctx.setLineDash([26, 22]);
  ctx.beginPath();
  for (const x of vertical) {
    if (x < cam.x - 60 || x > cam.x + cam.w + 60) continue;
    ctx.moveTo(x, Math.max(0, cam.y - 40));
    ctx.lineTo(x, Math.min(CITY.beachY, cam.y + cam.h + 40));
  }
  for (const y of horizontal) {
    if (y < cam.y - 60 || y > cam.y + cam.h + 60) continue;
    const span = y === CITY.beachY ? CITY.bay.x : WORLD.width;
    ctx.moveTo(Math.max(0, cam.x - 40), y);
    ctx.lineTo(Math.min(span, cam.x + cam.w + 40), y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawProps(ctx, cam) {
  for (const p of city.props) {
    if (p.kind === 'lamp') {
      if (!inView(cam, p.x - 6, p.y - 6, 12, 12)) continue;
      ctx.fillStyle = PALETTE.lamp;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // A crate: a wooden square with a darker cross brace.
      if (!inView(cam, p.x, p.y, p.size, p.size)) continue;
      ctx.fillStyle = PALETTE.crate;
      ctx.fillRect(p.x, p.y, p.size, p.size);
      ctx.strokeStyle = 'rgba(70, 45, 20, 0.55)';
      ctx.lineWidth = 2;
      ctx.strokeRect(p.x + 1, p.y + 1, p.size - 2, p.size - 2);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + p.size, p.y + p.size);
      ctx.moveTo(p.x + p.size, p.y);
      ctx.lineTo(p.x, p.y + p.size);
      ctx.stroke();
    }
  }
}

function drawBuildings(ctx, cam) {
  for (const b of city.buildings) {
    if (!inView(cam, b.x - 10, b.y - 6, b.w + 16, b.h + 16)) continue;
    // Soft shadow thrown to the south-east, then the tower, then its roof inset.
    ctx.fillStyle = PALETTE.buildingShadow;
    ctx.fillRect(b.x + 7, b.y + 9, b.w, b.h);
    ctx.fillStyle = b.color;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    const inset = 6 + Math.min(10, b.floors);
    ctx.fillStyle = PALETTE.roofShade;
    ctx.fillRect(b.x + inset, b.y + inset, b.w - inset * 2, b.h - inset * 2);
    // A parapet line so neighbouring towers of the same tone stay separate.
    ctx.strokeStyle = 'rgba(60, 45, 30, 0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);
    if (b.landmark) drawCivicMark(ctx, b, inset);
  }
}

/**
 * The badge a civic landmark wears on its roof: the police headquarters gets
 * a steel-blue roof and a darker cap, the hospital a pale roof with a red
 * cross, so both read at a glance from anywhere in their district.
 */
function drawCivicMark(ctx, b, inset) {
  const rx = b.x + inset;
  const ry = b.y + inset;
  const rw = b.w - inset * 2;
  const rh = b.h - inset * 2;
  if (b.landmark === 'Port Azura Police HQ') {
    ctx.fillStyle = 'rgba(43, 84, 150, 0.5)';
    ctx.fillRect(rx, ry, rw, rh);
    ctx.fillStyle = '#2b5496';
    ctx.fillRect(rx, ry, rw, 7);
  } else if (b.landmark === 'St. Azura Hospital') {
    ctx.fillStyle = 'rgba(238, 244, 242, 0.75)';
    ctx.fillRect(rx, ry, rw, rh);
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    ctx.fillStyle = '#d23b2e';
    ctx.fillRect(cx - 3.4, cy - 11, 6.8, 22);
    ctx.fillRect(cx - 11, cy - 3.4, 22, 6.8);
  }
}

/**
 * Name plates for the civic landmarks, drawn last so nothing covers them: a
 * small dark pill with the building's name, centred over its roof.
 */
function drawLandmarkLabels(ctx, cam) {
  ctx.font = '600 13px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const b of city.buildings) {
    if (!b.landmark) continue;
    if (!inView(cam, b.x - 30, b.y - 30, b.w + 60, b.h + 40)) continue;
    const cx = b.x + b.w / 2;
    const cy = b.y - 13;
    const w = ctx.measureText(b.landmark).width + 16;
    ctx.fillStyle = 'rgba(8, 16, 24, 0.68)';
    ctx.beginPath();
    ctx.roundRect(cx - w / 2, cy - 10, w, 20, 6);
    ctx.fill();
    ctx.fillStyle = '#ffe9a8';
    ctx.fillText(b.landmark, cx, cy + 1);
  }
  ctx.textAlign = 'left';
}

function drawPalms(ctx, cam) {
  ctx.lineCap = 'round';
  for (const p of city.palms) {
    if (!inView(cam, p.x - 26, p.y - 26, 52, 52)) continue;
    // A short curved trunk leaning out of its base point.
    ctx.strokeStyle = PALETTE.palmTrunk;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.quadraticCurveTo(p.x + 3, p.y - 9, p.x + 7, p.y - 16);
    ctx.stroke();
    // Five fronds arcing out and down from the crown.
    ctx.strokeStyle = PALETTE.palmFrond;
    ctx.lineWidth = 3;
    const cx = p.x + 7;
    const cy = p.y - 16;
    for (let k = 0; k < 5; k += 1) {
      const a = -Math.PI * 0.92 + k * (Math.PI * 0.42);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.quadraticCurveTo(cx + Math.cos(a) * 13, cy + Math.sin(a) * 10 - 4, cx + Math.cos(a) * 21, cy + Math.sin(a) * 15 + 5);
      ctx.stroke();
    }
  }
}

/** Paint the whole city as seen by the camera. The caller sets the transform. */
export function drawWorld(ctx, cam) {
  drawGround(ctx, cam);
  drawWater(ctx);
  drawRoads(ctx, cam);
  drawProps(ctx, cam);
  drawBuildings(ctx, cam);
  drawPalms(ctx, cam);
  drawLandmarkLabels(ctx, cam);
}

/**
 * The player on foot: a soft shadow, a two-tone body (jacket over a lighter
 * centre) and a short tick pointing the way they face.
 */
export function drawPlayer(ctx, player) {
  ctx.fillStyle = 'rgba(30, 25, 15, 0.3)';
  ctx.beginPath();
  ctx.ellipse(player.x + 3, player.y + 5, player.radius, player.radius * 0.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#274156';
  ctx.beginPath();
  ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f2c94c';
  ctx.beginPath();
  ctx.arc(player.x, player.y, player.radius * 0.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff7e0';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(player.x, player.y);
  ctx.lineTo(player.x + Math.cos(player.angle) * (player.radius + 7), player.y + Math.sin(player.angle) * (player.radius + 7));
  ctx.stroke();
}

// The day's light as a translucent wash: [timeOfDay, [r, g, b, alpha]] stops from
// midnight (0) through dawn, a clear noon, an orange dusk and back to night (1).
const TINT_STOPS = [
  [0.0, [10, 14, 48, 0.42]],
  [0.21, [10, 14, 48, 0.42]],
  [0.29, [255, 150, 70, 0.16]],
  [0.38, [255, 244, 214, 0.0]],
  [0.62, [255, 244, 214, 0.0]],
  [0.73, [255, 120, 40, 0.22]],
  [0.83, [16, 20, 60, 0.4]],
  [1.0, [10, 14, 48, 0.42]],
];

/** The rgba() tint string for a time of day in [0, 1): 0 is midnight, 0.5 noon. */
export function dayTint(timeOfDay) {
  const t = ((timeOfDay % 1) + 1) % 1;
  for (let i = 0; i < TINT_STOPS.length - 1; i += 1) {
    const [t0, c0] = TINT_STOPS[i];
    const [t1, c1] = TINT_STOPS[i + 1];
    if (t >= t0 && t <= t1) {
      const f = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
      const r = Math.round(c0[0] + (c1[0] - c0[0]) * f);
      const g = Math.round(c0[1] + (c1[1] - c0[1]) * f);
      const b = Math.round(c0[2] + (c1[2] - c0[2]) * f);
      const a = (c0[3] + (c1[3] - c0[3]) * f).toFixed(3);
      return `rgba(${r}, ${g}, ${b}, ${a})`;
    }
  }
  return 'rgba(10, 14, 48, 0.42)';
}
