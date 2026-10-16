// Recommendation logic, all on-device: similarity, taste profile, "Because you watched", nightly picks.
import { store } from './store.js';

/** Deterministic shuffle seeded by the date (and a salt), so picks change once a day. */
export function dailyShuffle(list, salt = '', date = new Date()) {
  let s = [...(date.toDateString() + salt)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  return list.map((x) => [x, rand()]).sort((a, b) => a[1] - b[1]).map(([x]) => x);
}

const quality = (f) => (f.rating?.rt != null ? f.rating.rt / 10 : f.rating?.tmdb || 5.5) + Math.log10(1 + (f.votes || 0)) * 0.4;

export function similar(film, films, n = 14) {
  const tags = new Set(film.tags || []), genres = new Set(film.genres || []), dirs = new Set(film.director || []), cast = new Set((film.cast || []).slice(0, 5));
  return films
    .filter((f) => f.key !== film.key)
    .map((f) => {
      let s = (f.tags || []).filter((t) => tags.has(t) && !['drama', 'short'].includes(t)).length * 3;
      s += (f.genres || []).filter((g) => genres.has(g)).length * 2;
      s += (f.director || []).filter((d) => dirs.has(d)).length * 6;
      s += (f.cast || []).slice(0, 5).filter((c) => cast.has(c)).length * 3;
      if (film.year && f.year) s += Math.max(0, 2 - Math.abs(film.year - f.year) / 10);
      if (!!(film.tags || []).includes('short') !== !!(f.tags || []).includes('short')) s -= 4;
      return [f, s + quality(f) * 0.25];
    })
    .filter(([, s]) => s > 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([f]) => f);
}

const seenKeys = () => new Set([...store.list().map((x) => x.key), ...Object.keys(store.allProgress())]);

export function recommend(films, n = 16) {
  const taste = store.taste();
  if (!Object.keys(taste).length) return null;
  const seen = seenKeys();
  return films
    .filter((f) => !seen.has(f.key))
    .map((f) => [f, [...f.genres, ...f.tags].reduce((s, g) => s + (taste[g] || 0), 0) + quality(f)])
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([f]) => f);
}

/** Up to `n` rows seeded by the most recently watched catalog titles. */
export function becauseYouWatched(films, n = 2) {
  const byKey = new Map(films.map((f) => [f.key, f]));
  const seen = seenKeys();
  const recent = Object.values(store.allProgress())
    .sort((a, b) => b.at - a.at)
    .map((p) => byKey.get(p.item.key))
    .filter(Boolean)
    .slice(0, n);
  return recent
    .map((seed) => ({ seed, items: similar(seed, films, 16).filter((f) => !seen.has(f.key)) }))
    .filter((r) => r.items.length >= 4);
}

/** Nightly "Lumen Picks": quality titles, nudged by taste, reshuffled each midnight. */
export function lumenPicks(films, n = 14) {
  const taste = store.taste();
  const pool = films.filter((f) => !f.tags.includes('short') && (f.rating?.rt >= 75 || f.rating?.tmdb >= 6.6));
  const order = dailyShuffle(pool, 'picks');
  const jitter = new Map(order.map((f, i) => [f.key, (order.length - i) / order.length]));
  return pool
    .map((f) => [f, quality(f) + [...f.genres, ...f.tags].reduce((s, g) => s + Math.min(2, (taste[g] || 0) / 4), 0) + jitter.get(f.key) * 4])
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([f]) => f);
}

export function hoursUntilMidnight() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return Math.max(1, Math.round((next - now) / 3600e3));
}
