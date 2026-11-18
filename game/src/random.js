// A tiny seeded random number generator (mulberry32) plus the helpers the city
// generator reaches for. The city must come out identical on every load — same
// buildings, same palms, same crates — so nothing in the game may call Math.random()
// for world content; it all flows through one of these streams instead.

/**
 * Create a mulberry32 stream from a numeric seed. Each call returns a float in
 * [0, 1); the sequence is fully determined by the seed.
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Float in [min, max) drawn from the given stream. */
export function range(rng, min, max) {
  return min + rng() * (max - min);
}

/** Integer in [min, max] (both ends included) drawn from the given stream. */
export function intRange(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

/** One element of the array, chosen by the given stream. */
export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}
