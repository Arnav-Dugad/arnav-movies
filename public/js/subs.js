// Subtitles: a forgiving WebVTT parser, our own cue renderer (styleable, works with the de-flicker
// canvas), remembered style preferences, and on-demand translation of English captions.
import { store } from './store.js';

/* ------------------------------------------------------------------ parsing */
const TIME = /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;
const toSec = (m) => (+(m[1] || 0)) * 3600 + +m[2] * 60 + +m[3] + +m[4].padEnd(3, '0') / 1000;

export function parseVTT(text) {
  const cues = [];
  for (const block of String(text).replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, b] = lines[i].split('-->');
    const s = TIME.exec(a || ''), e = TIME.exec(b || '');
    if (!s || !e) continue; // skip malformed cues instead of failing the whole file
    const body = lines.slice(i + 1).join('\n').replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '').trim();
    if (body) cues.push({ start: toSec(s), end: toSec(e), text: body });
  }
  return cues.sort((x, y) => x.start - y.start);
}

/* ------------------------------------------------------------------- styles */
export const SUB_SIZES = { s: 0.8, m: 1, l: 1.3, xl: 1.65 };
export const SUB_FONTS = {
  system: { label: 'System', css: 'var(--font)' },
  lexend: { label: 'Lexend · dyslexia-friendly', css: '"Lexend", var(--font)', g: 'Lexend:wght@400;600' },
  atkinson: { label: 'Atkinson Hyperlegible', css: '"Atkinson Hyperlegible", var(--font)', g: 'Atkinson+Hyperlegible:wght@400;700' },
};
export const SUB_BACKS = { box: 'Box', shadow: 'Shadow', none: 'None' };
export const SUB_COLORS = { white: '#ffffff', yellow: '#ffe14d', cyan: '#7fe7ff' };

export const subStyle = () => ({ size: 'm', font: 'system', back: 'box', color: 'white', ...store.pref('subStyle', {}) });

function loadFont(key) {
  const f = SUB_FONTS[key];
  if (!f?.g || document.querySelector(`link[data-font="${key}"]`)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.dataset.font = key;
  l.href = `https://fonts.googleapis.com/css2?family=${f.g}&display=swap`;
  document.head.appendChild(l);
}

export function applySubStyle(el, st = subStyle()) {
  loadFont(st.font);
  el.style.setProperty('--sub-scale', SUB_SIZES[st.size] || 1);
  el.style.setProperty('--sub-font', SUB_FONTS[st.font]?.css || 'var(--font)');
  el.style.setProperty('--sub-color', SUB_COLORS[st.color] || '#fff');
  el.dataset.back = st.back;
}

/* ------------------------------------------------------------- languages */
export const TRANSLATE_TO = ['es', 'fr', 'de', 'it', 'pt', 'hi', 'bn', 'ta', 'te', 'mr', 'kn', 'ml', 'gu', 'pa', 'ur', 'ar', 'ja', 'ko', 'zh', 'ru', 'tr', 'id', 'nl', 'pl'];
export const langName = (code) => {
  try {
    const n = new Intl.DisplayNames([code], { type: 'language' }).of(code);
    const en = new Intl.DisplayNames(['en'], { type: 'language' }).of(code);
    return n && en && n.toLowerCase() !== en.toLowerCase() ? `${n} · ${en}` : en || code;
  } catch {
    return code;
  }
};

/* ------------------------------------------------------------- renderer */
export class SubtitleRenderer {
  constructor(video, el) {
    this.video = video;
    this.el = el;
    this.cues = [];
    this.raf = 0;
    this.last = '';
    this.translator = null;
    applySubStyle(el);
    const loop = () => {
      this.render();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  set(cues) {
    this.cues = cues || [];
    this.last = null;
    this.render();
  }

  /** Index of the last cue starting at or before t (binary search). */
  indexAt(t) {
    let lo = 0, hi = this.cues.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.cues[mid].start <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }

  /** The last few lines spoken before `t` (used by the resume recap). */
  linesBefore(t, n = 3, window = 120) {
    const i = this.indexAt(t);
    const out = [];
    for (let k = i; k >= 0 && out.length < n; k--) {
      if (t - this.cues[k].end > window) break;
      const text = this.cues[k].text.replace(/\n/g, ' ');
      if (text.length > 3 && !/^\[.*\]$/.test(text)) out.unshift(text);
    }
    return out;
  }

  render() {
    const t = this.video.currentTime;
    const i = this.indexAt(t);
    const active = [];
    for (let k = Math.max(0, i - 3); k <= i; k++) if (this.cues[k] && this.cues[k].end > t && this.cues[k].start <= t) active.push(this.cues[k]);
    const html = active.map((c) => `<span class="cue${c.pending ? ' is-pending' : ''}">${escapeHtml(c.text).replace(/\n/g, '<br>')}</span>`).join('');
    if (html !== this.last) {
      this.el.innerHTML = html;
      this.last = html;
    }
    this.translator?.tick(t, i);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.translator?.stop();
    this.el.innerHTML = '';
  }
}

const escapeHtml = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

/* ------------------------------------------------------------ translation */
const CHUNK = 40;

/**
 * Translates English cues chunk by chunk, starting where the viewer is and working forward.
 * Untranslated lines show the English text dimmed until their chunk arrives.
 */
export class Translator {
  constructor(renderer, english, { lang, src, onStatus }) {
    this.r = renderer;
    this.src = src;
    this.lang = lang;
    this.onStatus = onStatus || (() => {});
    this.cues = english.map((c) => ({ ...c, pending: true }));
    this.done = new Set();
    this.busy = false;
    this.failed = 0;
    this.stopped = false;
    renderer.set(this.cues);
    renderer.translator = this;
  }

  tick(t, i) {
    if (this.busy || this.stopped || this.failed > 3) return;
    const here = Math.max(0, Math.floor(Math.max(0, i) / CHUNK));
    const total = Math.ceil(this.cues.length / CHUNK);
    // Current chunk first, then the next three ahead, then everything else in order.
    const order = [here, here + 1, here + 2, here + 3, ...Array.from({ length: total }, (_, k) => k)];
    const next = order.find((k) => k < total && !this.done.has(k));
    if (next == null) return this.onStatus('done');
    this.here = here;
    this.fetchChunk(next);
  }

  async fetchChunk(k) {
    this.busy = true;
    const slice = this.cues.slice(k * CHUNK, (k + 1) * CHUNK);
    // Only flag it while the lines on screen are still in English; background chunks stay silent.
    this.onStatus(k === this.here ? 'working' : 'idle', k);
    try {
      const res = await fetch('/api/subs/translate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ src: this.src, lang: this.lang, chunk: k, lines: slice.map((c) => c.text.slice(0, 300)) }),
      });
      if (res.status === 429) {
        this.stopped = true;
        this.onStatus('budget');
        return;
      }
      const out = await res.json();
      if (!Array.isArray(out) || out.length !== slice.length) throw new Error('bad');
      slice.forEach((c, j) => { c.text = out[j] || c.text; c.pending = false; });
      this.done.add(k);
      this.r.last = null;
      this.onStatus('idle');
    } catch {
      this.failed++;
      await new Promise((r) => setTimeout(r, 1500 * this.failed));
    } finally {
      this.busy = false;
    }
  }

  stop() {
    this.stopped = true;
  }
}
