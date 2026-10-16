// Per-viewer state kept in localStorage: My List, playback progress and viewing stats.
// Everything is wrapped so the app still works in private windows where storage throws.

const KEY = 'lumen:v1';
const listeners = new Set();

const blank = () => ({ list: [], progress: {}, days: {}, genres: {}, prefs: {} });

function load() {
  try {
    return { ...blank(), ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return blank();
  }
}

let state = load();
let saveTimer;

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
  }, 150);
  listeners.forEach((fn) => fn(state));
}

// Only keep what we need to render a card later.
const snapshot = (item) => ({
  key: item.key,
  kind: item.kind,
  id: item.id,
  title: item.title,
  year: item.year,
  poster: item.poster,
  posterHd: item.posterHd,
  genres: (item.genres || []).slice(0, 3),
  href: item.href,
  file: item.file,
  preview: item.preview,
  length: item.length,
  backdrop: item.backdrop,
  backdropSm: item.backdropSm,
  logo: item.logo,
  thumbOnly: item.thumbOnly,
  playable: item.playable,
});

const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const store = {
  on(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  inList: (key) => state.list.some((x) => x.key === key),
  list: () => state.list.slice(),
  toggleList(item) {
    if (this.inList(item.key)) {
      state.list = state.list.filter((x) => x.key !== item.key);
      save();
      return false;
    }
    state.list.unshift({ ...snapshot(item), added: Date.now() });
    save();
    return true;
  },

  progress: (key) => state.progress[key] || null,
  allProgress: () => ({ ...state.progress }),
  setProgress(item, t, d) {
    if (!d || !isFinite(d)) return;
    state.progress[item.key] = { t, d, at: Date.now(), item: snapshot(item) };
    save();
  },
  clearProgress(key) {
    delete state.progress[key];
    save();
  },
  continueWatching() {
    return Object.values(state.progress)
      .filter((p) => p.t / p.d > 0.01 && p.t / p.d < 0.95)
      .sort((a, b) => b.at - a.at)
      .slice(0, 20);
  },

  /** Adds watched seconds to today's total and to each genre's tally. */
  logWatch(item, seconds) {
    if (seconds <= 0) return;
    const k = dayKey();
    state.days[k] = (state.days[k] || 0) + seconds;
    for (const g of (item.genres || []).slice(0, 3)) state.genres[g] = (state.genres[g] || 0) + seconds;
    save();
  },

  stats() {
    const totalSec = Object.values(state.days).reduce((a, b) => a + b, 0);
    const started = Object.keys(state.progress).length;
    const finished = Object.values(state.progress).filter((p) => p.t / p.d >= 0.95).length;
    const topGenre = Object.entries(state.genres).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const last7 = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      last7.push({ date: d, sec: state.days[dayKey(d)] || 0 });
    }
    let streak = 0;
    for (let i = 0; ; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      if (state.days[dayKey(d)] > 60) streak++;
      else if (i > 0) break;
      if (i > 365) break;
    }
    return { totalSec, started, finished, topGenre, last7, streak, genres: { ...state.genres } };
  },

  /** Genres and tags weighted by what the viewer saved or watched, for "For you". */
  taste() {
    const w = {};
    const add = (g, n) => (w[g] = (w[g] || 0) + n);
    state.list.forEach((x) => (x.genres || []).forEach((g) => add(g, 3)));
    Object.values(state.progress).forEach((p) => (p.item.genres || []).forEach((g) => add(g, 2 + (p.t / p.d) * 3)));
    Object.entries(state.genres).forEach(([g, s]) => add(g, s / 600));
    return w;
  },

  pref: (k, fallback) => (k in state.prefs ? state.prefs[k] : fallback),
  setPref(k, v) {
    state.prefs[k] = v;
    save();
  },
};
