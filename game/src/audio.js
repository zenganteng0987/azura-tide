// Sound, synthesised: Azura Tide ships no audio assets, so every noise the
// city makes is built from oscillators and one buffer of white noise at
// runtime — an engine that rises with the car's speed, a two-tone siren
// when the PAPD is close, the crack of the player's pistol, and the small
// chimes of work done well or badly. The context is created lazily on the
// first user gesture (main.js calls audio.init() from the title screen's
// Enter), because browsers refuse one any earlier; every entry point is
// guarded, so a machine with no WebAudio at all simply plays in silence.
import { events } from './events.js';

let ctx = null;
let master = null;
let noiseBuffer = null;
let engine = null; // { osc, gain }
let siren = null; // { osc, gain, flipAt, high }
let ambientStep = 0;
let ambientAt = 0;
let muted = false;

/** The ambient bass pattern: A1, A1, C2, G1 — a slow four-note loop. */
const AMBIENT_NOTES = [55, 55, 65.41, 49];
const AMBIENT_GAP = 1.9;

function ensure() {
  if (ctx) return ctx;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    master.connect(ctx.destination);
    // One second of white noise, reused by every gunshot.
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    // The engine: a sawtooth through a lowpass, silent until driven.
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 55;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    osc.start();
    engine = { osc, gain };
    // The siren: a square wave that will flip between two tones.
    const sOsc = ctx.createOscillator();
    sOsc.type = 'square';
    sOsc.frequency.value = 700;
    const sGain = ctx.createGain();
    sGain.gain.value = 0;
    sOsc.connect(sGain);
    sGain.connect(master);
    sOsc.start();
    siren = { osc: sOsc, gain: sGain, flipAt: 0, high: false };
  } catch (err) {
    ctx = null;
  }
  return ctx;
}

/** A short tone with an envelope: the building block for blips and jingles. */
function tone(freq, { type = 'triangle', at = 0, dur = 0.18, gain = 0.14, slideTo = null } = {}) {
  if (!ensure()) return;
  try {
    const t0 = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  } catch (err) {
    // A failed note is just silence.
  }
}

export const audio = {
  /** Create (or wake) the context. Call from a user gesture. */
  init() {
    if (!ensure()) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  },

  get muted() {
    return muted;
  },

  /** Flip the master mute (key V in main.js). Returns the new state. */
  toggleMute() {
    muted = !muted;
    if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.02);
    return muted;
  },

  /** The pistol's crack: a filtered noise burst, gone in a tenth of a second. */
  shot() {
    if (!ensure()) return;
    try {
      const t0 = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1700;
      filter.Q.value = 0.7;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.22, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.11);
      src.connect(filter);
      filter.connect(g);
      g.connect(master);
      src.start(t0);
      src.stop(t0 + 0.13);
    } catch (err) {
      // Silence.
    }
  },

  /** A package in hand: two quick rising notes. */
  pickup() {
    tone(880, { type: 'square', dur: 0.07, gain: 0.07 });
    tone(1318, { type: 'square', at: 0.06, dur: 0.1, gain: 0.07 });
  },

  /** Mission complete: a four-note success jingle. */
  jingle() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => tone(freq, { at: i * 0.09, dur: 0.22, gain: 0.13 }));
  },

  /** Mission failed: one low tone sliding down. */
  failTone() {
    tone(160, { type: 'sawtooth', dur: 0.5, gain: 0.1, slideTo: 68 });
  },

  /**
   * Per-step ambience, called by main.js with the world as it stands:
   * { driving, speedRatio (0..1), sirenNear, playing }. The engine tracks
   * the car's speed, the siren sounds while a unit is close under stars,
   * and the bass loop ticks over quietly underneath the playing screen.
   */
  update(dt, env) {
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (engine) {
      const targetGain = env.driving ? 0.05 : 0;
      engine.gain.gain.setTargetAtTime(targetGain, now, 0.09);
      if (env.driving) engine.osc.frequency.setTargetAtTime(52 + env.speedRatio * 150, now, 0.06);
    }
    if (siren) {
      siren.gain.gain.setTargetAtTime(env.sirenNear ? 0.022 : 0, now, 0.08);
      if (env.sirenNear && now >= siren.flipAt) {
        siren.high = !siren.high;
        siren.osc.frequency.setValueAtTime(siren.high ? 940 : 700, now);
        siren.flipAt = now + 0.34;
      }
    }
    if (env.playing) {
      ambientAt -= dt;
      if (ambientAt <= 0) {
        tone(AMBIENT_NOTES[ambientStep % AMBIENT_NOTES.length], { type: 'sine', dur: 1.7, gain: 0.045 });
        ambientStep += 1;
        ambientAt = AMBIENT_GAP;
      }
    }
  },
};

// The bus carries the moments worth a noise. Gunfire is the one
// approximation: combat announces every trigger pull as a 'shooting' crime
// (and a bullet striking a car announces one too), so the crack is wired to
// the crime rather than to the trigger finger itself.
events.on('crime', (crime) => {
  if (crime && crime.type === 'shooting') audio.shot();
});
events.on('pickup', () => audio.pickup());
events.on('missionComplete', () => audio.jingle());
events.on('missionFailed', () => audio.failTone());
