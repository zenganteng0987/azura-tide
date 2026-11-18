// Every tuning number and colour for Azura Tide in one place, so the world's shape
// can be rebalanced without hunting through the systems that use it. The world is a
// square of world-units (roughly metres); the renderer scales nothing — one unit is
// one pixel at zoom 1, and the camera simply shows a window into the square.

/** The whole playable square: Port Azura and the bay around its south-east shore. */
export const WORLD = { width: 3200, height: 3200 };

/** The fixed seed the city is generated from. Same seed, same streets, every load. */
export const SEED = 20261118;

/** How long one full in-game day lasts, in real seconds (four minutes). */
export const DAY_LENGTH_SEC = 240;

/** The hour the game clock starts at on a fresh entry (0-24): late morning. */
export const START_HOUR = 10.75;

export const CITY = {
  // Road centre lines sit on a grid: the first line is this far from the world edge,
  // and each next line is one block pitch further along.
  margin: 200,
  blockPitch: 320,
  // Full width of a road including both driving lanes, and of the sidewalk band
  // drawn around every block between the road edge and the buildings.
  roadWidth: 76,
  sidewalk: 16,
  // Where the built city stops and the beach begins (a y coordinate). The last
  // horizontal road, the promenade, runs along this line.
  beachY: 2440,
  // Open water starts this far south; between beachY and waterY is sand.
  waterY: 2840,
  // The bay: a rectangle of water reaching north into the city from the south-east
  // corner, so the marina district wraps around real water instead of a straight shore.
  bay: { x: 2350, y: 2480, w: 850, h: 720 },
};

export const PLAYER = {
  radius: 14,
  walkSpeed: 165, // world-units per second on foot
  runSpeed: 300, // with Shift held
};

export const PALETTE = {
  water: '#1b9aaa',
  waterDeep: '#14707f',
  shoreline: '#7fd4c9',
  sand: '#f2dfa7',
  grass: '#8fce6e',
  cityGround: '#cfc8b8',
  sidewalk: '#b8b2a4',
  asphalt: '#4a4a52',
  roadLine: '#f7f3e3',
  promenade: '#e8c98a',
  // Pastel tower tones, sun-bleached: picked per building from the city seed.
  buildings: ['#f6d8a8', '#f2b8c6', '#a8d8ea', '#f9f1c9', '#ffc9a3', '#c3e6c0', '#e6c9f2', '#f5efe0', '#ffd1dc', '#bfe3dd'],
  roofShade: 'rgba(60, 40, 30, 0.18)',
  buildingShadow: 'rgba(40, 35, 25, 0.25)',
  palmTrunk: '#8a6b45',
  palmFrond: '#3e9e4f',
  crate: '#a9805a',
  lamp: '#5a5f6b',
};
