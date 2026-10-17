// Per-viewer state kept in localStorage: My List, playback progress and viewing stats.
// Everything is wrapped so the app still works in private windows where storage throws.

const KEY = 'arnav:v1';
const listeners = new Set();

const blank = () => ({ list: [], progress: {}, days: {}, genres: {}, prefs: {}, nope: {} });

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
  tags: (item.tags || []).slice(0, 8),
  still: item.still,
  series: item.series,
  seriesTitle: item.seriesTitle,
  s: item.s,
  e: item.e,
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
    const seen = new Set();
    return Object.values(state.progress)
      .filter((p) => p.t / p.d > 0.01 && p.t / p.d < 0.95 && !state.nope[p.item.key])
      .sort((a, b) => b.at - a.at)
      .filter((p) => {
        // One card per series: the episode you watched most recently.
        if (!p.item.series) return true;
        if (seen.has(p.item.series)) return false;
        seen.add(p.item.series);
        return true;
      })
      .slice(0, 20);
  },

  /** Progress for every episode of a series, keyed by episode key, plus the most recent one. */
  seriesProgress(sid) {
    const eps = Object.values(state.progress).filter((p) => p.item.series === sid);
    return { byKey: Object.fromEntries(eps.map((p) => [p.item.key, p])), last: eps.sort((a, b) => b.at - a.at)[0] || null };
  },

  /** "Not interested": hides a title from recommendations and counts against its genres. */
  dismiss(item) {
    state.nope[item.key] = { at: Date.now(), genres: (item.genres || []).slice(0, 3), tags: (item.tags || []).slice(0, 6) };
    save();
  },
  undismiss(key) {
    delete state.nope[key];
    save();
  },
  isDismissed: (key) => !!state.nope[key],

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
    const each = (x, n) => [...(x.genres || []), ...(x.tags || [])].forEach((g) => add(g, n));
    state.list.forEach((x) => each(x, 3));
    const now = Date.now();
    Object.values(state.progress).forEach((p) => {
      const f = p.t / p.d;
      // Stopped early and never came back (90s+ in, under 15%, untouched for a day and a half).
      if (f < 0.15 && p.t > 90 && now - p.at > 36 * 3600e3) return each(p.item, -2.5);
      each(p.item, 2 + f * 3 + (f > 0.9 ? 2 : 0));
    });
    Object.values(state.nope).forEach((x) => each(x, -4));
    Object.entries(state.genres).forEach(([g, s]) => add(g, s / 600));
    return w;
  },

  /** Keys the viewer has rejected or abandoned, so recommendations can skip them. */
  rejected() {
    const now = Date.now();
    const out = new Set(Object.keys(state.nope));
    Object.values(state.progress).forEach((p) => p.t / p.d < 0.15 && p.t > 90 && now - p.at > 36 * 3600e3 && out.add(p.item.key));
    return out;
  },

  pref: (k, fallback) => (k in state.prefs ? state.prefs[k] : fallback),
  setPref(k, v) {
    state.prefs[k] = v;
    save();
  },
};
