// Keyboard and mouse state for the game loop. Two views of the keyboard: `keysDown`
// for anything held (movement, sprint) and `pressed` for one-shot actions (enter a
// car, pause), which the loop reads once per frame and then clears with endFrame(),
// so a tap between frames is never lost and never counted twice. Mouse position is
// kept in screen (canvas pixel) space; the renderer owns the camera that turns it
// into a world position for aiming.

/** Codes currently held down, as KeyboardEvent.code strings. */
export const keysDown = new Set();

/** Codes that went down since the last endFrame() call. */
export const pressed = new Set();

/** Mouse in screen space; `clicked` is the one-shot twin of `pressed` for the button. */
export const mouse = { x: 0, y: 0, down: false, clicked: false };

// Browsers scroll or zoom on some of these; the game wants every one of them itself.
const CAPTURED = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'ShiftLeft', 'ShiftRight', 'Space', 'KeyE', 'KeyP', 'KeyM', 'Enter',
]);

let attached = false;

function onKeyDown(event) {
  if (!keysDown.has(event.code)) pressed.add(event.code);
  keysDown.add(event.code);
  if (CAPTURED.has(event.code)) event.preventDefault();
}

function onKeyUp(event) {
  keysDown.delete(event.code);
}

function onBlur() {
  // A key released while the tab is hidden never sends keyup: let go of everything.
  keysDown.clear();
}

function onMouseMove(event) {
  mouse.x = event.clientX;
  mouse.y = event.clientY;
}

function onMouseDown(event) {
  if (event.button === 0) {
    mouse.down = true;
    mouse.clicked = true;
  }
}

function onMouseUp(event) {
  if (event.button === 0) mouse.down = false;
}

/** Start listening on the window. Safe to call once at boot. */
export function attachInput() {
  if (attached) return;
  attached = true;
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
}

/** Stop listening and forget every held key and pending press. */
export function detachInput() {
  if (!attached) return;
  attached = false;
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('keyup', onKeyUp);
  window.removeEventListener('blur', onBlur);
  window.removeEventListener('mousemove', onMouseMove);
  window.removeEventListener('mousedown', onMouseDown);
  window.removeEventListener('mouseup', onMouseUp);
  keysDown.clear();
  pressed.clear();
  mouse.down = false;
  mouse.clicked = false;
}

/** True while any of the given codes is held. */
export function isDown(...codes) {
  return codes.some((code) => keysDown.has(code));
}

/** True when any of the given codes went down since the last endFrame(). */
export function wasPressed(...codes) {
  return codes.some((code) => pressed.has(code));
}

/** Movement axes from the held keys: x is -1/0/1 rightward, y is -1/0/1 downward. */
export function moveAxes() {
  const x = (isDown('KeyD', 'ArrowRight') ? 1 : 0) - (isDown('KeyA', 'ArrowLeft') ? 1 : 0);
  const y = (isDown('KeyS', 'ArrowDown') ? 1 : 0) - (isDown('KeyW', 'ArrowUp') ? 1 : 0);
  return { x, y };
}

/** Clear the one-shot sets. The loop calls this at the end of every frame. */
export function endFrame() {
  pressed.clear();
  mouse.clicked = false;
}
