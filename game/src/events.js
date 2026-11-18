// A tiny event bus the whole game shares. Systems that cause things (a stolen
// car, a hard crash, a pedestrian knocked down) emit named events here instead
// of reaching into each other's state; systems that react (wanted level and
// police, missions, sound) subscribe. One shared instance, exported as
// `events`: events.on('crime', fn), events.emit('crime', { type: 'carTheft' }).

const listeners = new Map();

export const events = {
  /**
   * Subscribe to an event name. Returns an unsubscribe function. The handler
   * receives the payload object the emitter passed, untouched.
   */
  on(name, fn) {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(fn);
    return () => events.off(name, fn);
  },

  /** Unsubscribe one handler from an event name. */
  off(name, fn) {
    const set = listeners.get(name);
    if (set) set.delete(fn);
  },

  /**
   * Send an event to every subscriber. Handlers run in subscription order; a
   * handler that throws is reported but never stops the others or the game.
   */
  emit(name, payload) {
    const set = listeners.get(name);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`events: handler for "${name}" failed`, err);
      }
    }
  },

  /** Drop every subscription for one name, or for all names when omitted. */
  clear(name) {
    if (name === undefined) listeners.clear();
    else listeners.delete(name);
  },
};
