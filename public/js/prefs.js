// Viewer preferences that change the whole app (appearance, motion, data use, content filters).
// The Settings page writes them through store.setPref; this module reads and applies them.
import { store } from './store.js';

const os = (q) => matchMedia(q).matches;

/** Respect both the system setting and the in-app switch. */
export const reducedMotion = () => store.pref('reduceMotion', false) || os('(prefers-reduced-motion: reduce)');
/** Data saver: the in-app switch, or the browser's Save-Data signal. */
export const dataSaver = () => store.pref('dataSaver', false) || !!navigator.connection?.saveData;
export const previewsOn = () => store.pref('hoverPreviews', true) && !dataSaver();
export const heroTrailersOn = () => store.pref('heroTrailers', true) && !dataSaver();

/** Tags the viewer chose to hide from browsing rows (e.g. horror). */
export const hiddenTags = () => new Set(store.pref('hideTags', []));
export function visible(films) {
  const hide = hiddenTags();
  const hideWatched = store.pref('hideWatched', false);
  if (!hide.size && !hideWatched) return films;
  return films.filter((f) => {
    if (hide.size && (f.tags || []).some((t) => hide.has(t))) return false;
    if (hideWatched) {
      const p = store.progress(f.key);
      if (p && p.t / p.d >= 0.95) return false;
    }
    return true;
  });
}

export const UI_SIZES = { compact: 'Compact', default: 'Default', large: 'Large' };

/** Applies appearance switches to <html>; call at boot and whenever a setting changes. */
export function applyAppearance() {
  const html = document.documentElement;
  html.classList.toggle('reduce-motion', store.pref('reduceMotion', false));
  html.classList.toggle('solid', store.pref('reduceTransparency', false));
  html.classList.toggle('no-grain', !store.pref('filmGrain', true));
  html.dataset.size = store.pref('uiSize', 'default');
}
