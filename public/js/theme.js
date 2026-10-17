// Page colours that follow the film: sample the poster, derive a readable accent and re-tint the UI
// (buttons, focus rings, progress, glow). Returns a function that restores the house colours.
import { sampleColors } from './ui.js';
import { store } from './store.js';

/** House accents for Settings → Appearance (hue; null = the original amber). */
export const ACCENTS = { amber: null, red: 2, pink: 330, purple: 268, blue: 212, teal: 178, green: 140 };

const root = document.documentElement.style;
const VARS = ['--accent', '--accent-2', '--accent-grad', '--focus', '--tint', '--tint-rgb'];
let token = 0;

function toHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}
const hsl = (h, s, l) => `hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
function hslToRgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return [f(0), f(8), f(4)];
}

// Only hosts that send CORS headers can be read back from a canvas.
const READABLE = /^(\/|https:\/\/(image\.tmdb\.org|archive\.org|[\w-]+\.archive\.org)\/)/;

export function applyTheme(src) {
  const my = ++token;
  if (!src || !READABLE.test(src) || !store.pref('posterColors', true)) {
    reset();
    return reset;
  }
  sampleColors(src).then((c) => {
    if (!c || my !== token) return;
    // Pick the more colourful of the two samples; black-and-white posters keep the house amber.
    const [a, b] = c.map(toHsl);
    const [h, s] = a[1] >= b[1] ? a : b;
    if (s < 0.18) return reset();
    setVars(h, Math.max(0.6, Math.min(0.9, s + 0.2)));
    document.documentElement.dataset.tinted = '1';
  });
  return () => {
    if (my === token) reset();
  };
}

function setVars(h, sat) {
  root.setProperty('--accent', hsl(h, sat, 0.68));
  root.setProperty('--accent-2', hsl(h + 28, sat, 0.6));
  root.setProperty('--accent-grad', `linear-gradient(135deg, ${hsl(h - 12, sat, 0.76)} 0%, ${hsl(h, sat, 0.66)} 45%, ${hsl(h + 28, sat, 0.58)} 100%)`);
  root.setProperty('--focus', hsl(h, sat, 0.72));
  root.setProperty('--tint', hsl(h, sat, 0.62));
  root.setProperty('--tint-rgb', hslToRgb(h, sat, 0.62).join(', '));
}

/** Back to the house colours: amber, or the accent picked in Settings. */
export function reset() {
  token++;
  VARS.forEach((v) => root.removeProperty(v));
  delete document.documentElement.dataset.tinted;
  const hue = ACCENTS[store.pref('accent', 'amber')];
  if (hue != null) setVars(hue, 0.78);
}
