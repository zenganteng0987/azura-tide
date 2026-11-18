// The save file: one localStorage entry holding where Rafi's story stands —
// cash in pocket, missions done, and the corner he was standing on. It is
// written by main.js whenever a mission ends and every few seconds while
// playing, and read once at boot so the title screen can offer Continue.
// Everything is wrapped so a browser that refuses storage (private mode,
// quota, plain http quirks) just means "no save", never a crash.

const SAVE_KEY = 'azura-tide-save-v1';

/** The stored save {cash, missionIndex, storyDone, playerX, playerY}, or null. */
export function loadSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    return {
      cash: Number.isFinite(data.cash) ? data.cash : 0,
      missionIndex: Number.isFinite(data.missionIndex) ? data.missionIndex : 0,
      storyDone: !!data.storyDone,
      playerX: Number.isFinite(data.playerX) ? data.playerX : null,
      playerY: Number.isFinite(data.playerY) ? data.playerY : null,
    };
  } catch (err) {
    return null;
  }
}

/** Store the save object under the one key. Failures are swallowed on purpose. */
export function writeSave(data) {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch (err) {
    // No storage, no save — the game plays on regardless.
  }
}

/** Forget the save entirely: a new game starts from an empty pocket. */
export function clearSave() {
  try {
    window.localStorage.removeItem(SAVE_KEY);
  } catch (err) {
    // Nothing to forget if storage itself is unavailable.
  }
}
