// Spatial audio cues for touch screens: tiny synthesized sounds panned to where you tapped
// (left of the screen sounds left, right sounds right). Off with one switch in My List.
import { store } from './store.js';

let ctx = null;
const touch = matchMedia('(hover: none) and (pointer: coarse)').matches;

const enabled = () => store.pref('uiSounds', touch) && !matchMedia('(prefers-reduced-motion: reduce)').matches;

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// Each cue: a few short notes [frequency, start offset, duration], soft attack, quick decay.
const CUES = {
  tap: [[880, 0, 0.05]],
  tab: [[660, 0, 0.05]],
  play: [[523, 0, 0.07], [784, 0.06, 0.12]],
  add: [[659, 0, 0.06], [988, 0.07, 0.1]],
  remove: [[784, 0, 0.06], [523, 0.07, 0.1]],
  close: [[587, 0, 0.06], [392, 0.06, 0.1]],
  tick: [[1400, 0, 0.02]],
  error: [[220, 0, 0.12]],
};

/** Play cue `name`, panned to the horizontal position of `el` (or an x coordinate). */
export function cue(name, el) {
  if (!enabled()) return;
  const ac = audio();
  if (!ac) return;
  const x = typeof el === 'number' ? el : el?.getBoundingClientRect ? (() => { const r = el.getBoundingClientRect(); return r.left + r.width / 2; })() : innerWidth / 2;
  const pan = Math.max(-1, Math.min(1, (x / innerWidth) * 2 - 1));
  const out = ac.createStereoPanner ? ac.createStereoPanner() : ac.createGain();
  if (out.pan) out.pan.value = pan * 0.85;
  out.connect(ac.destination);
  const now = ac.currentTime;
  for (const [f, at, dur] of CUES[name] || CUES.tap) {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(f, now + at);
    g.gain.setValueAtTime(0, now + at);
    g.gain.linearRampToValueAtTime(0.06, now + at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, now + at + dur);
    o.connect(g).connect(out);
    o.start(now + at);
    o.stop(now + at + dur + 0.02);
  }
}

export const soundsOn = enabled;
export function setSounds(on) {
  store.setPref('uiSounds', on);
}
