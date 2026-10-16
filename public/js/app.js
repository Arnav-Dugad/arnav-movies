// App shell: router, view transitions (incl. poster morph), navigation chrome and global interactions.
import * as views from './views.js';
import { registry } from './views.js';
import { tv, show, anime } from './tv.js';
import { personView } from './people.js';
import { statusView } from './status.js';
import { catalog, resolveTitle } from './api.js';
import { store } from './store.js';
import { play } from './player.js';
import { initSearch, openSearch } from './search.js';
import { icon, toast, haptic, initPreviews } from './ui.js';
import { dragDismiss } from './gestures.js';

const view = document.getElementById('view');

const routes = [
  [/^\/$/, views.home, 'home'],
  [/^\/movies\/?$/, views.movies, 'movies'],
  [/^\/tv\/?$/, tv, 'tv'],
  [/^\/list\/?$/, views.myList, 'list'],
  [/^\/collection\/([\w-]+)\/?$/, views.collection, 'movies'],
  [/^\/title\/(.+?)\/?$/, views.title, 'movies', true],
  [/^\/show\/(t?\d+)\/?$/, show, 'tv', true],
  [/^\/anime\/(\d+)\/?$/, anime, 'tv', true],
  [/^\/person\/(Q\d+)\/?$/, personView, ''],
  [/^\/status\/?$/, statusView, ''],
];

let token = 0;
let leaveFns = [];

async function render({ restoreScroll = 0, morph = false } = {}) {
  const my = ++token;
  leaveFns.forEach((fn) => fn());
  leaveFns = [];
  const path = location.pathname;
  const match = routes.map(([re, fn, tab, detail]) => [path.match(re), fn, tab, detail]).find(([m]) => m);
  const [m, fn, tab, detail] = match || [null, views.notFound, '', false];
  setActiveTab(tab);
  document.title = 'Lumen — Free classic cinema & TV';
  const ctx = {
    el: view,
    morph,
    alive: () => my === token,
    onLeave: (f) => leaveFns.push(f),
    play: (item) => play(item),
    share,
    refresh: () => render({ restoreScroll: scrollY }),
  };
  const args = m ? m.slice(1).map(decodeURIComponent) : [];
  try {
    await fn(ctx, ...args);
  } catch (err) {
    console.error(err);
    if (ctx.alive()) views.notFound(ctx);
  }
  if (!ctx.alive()) return;
  window.scrollTo({ top: restoreScroll, behavior: 'instant' });
  if (detail) {
    // Pull down from the top of a detail page to go back, like an iOS sheet.
    const page = view.querySelector('.detail');
    leaveFns.push(dragDismiss(page, { canStart: () => scrollY <= 0, onDismiss: goBack, threshold: 160 }));
  }
  hideSplash();
}

function goBack() {
  if (history.state?.idx > 0) history.back();
  else navigate('/', { replace: true });
}

let navIdx = 0;
export function navigate(href, { replace = false, from = null } = {}) {
  const url = new URL(href, location.origin);
  if (url.origin !== location.origin) return (location.href = href);
  if (url.pathname + url.search === location.pathname + location.search && !url.hash) return;
  history.replaceState({ ...(history.state || {}), scroll: scrollY }, '');
  if (!replace) navIdx++;
  history[replace ? 'replaceState' : 'pushState']({ scroll: 0, idx: navIdx }, '', url.pathname + url.search + url.hash);
  // Morph the clicked poster into the detail page when the destination renders quickly.
  const poster = from?.querySelector('.card__media img.is-loaded, .tile__img img');
  const key = from?.dataset.key;
  const fast = key && (registry.get(key)?.source === 'catalog' || /^(tv|anime|tmdbtv):/.test(key));
  transition(() => render({ morph: !!(poster && fast) }), poster && fast ? poster : null);
}

function transition(fn, morphEl) {
  if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return fn();
  document.querySelectorAll('[style*="poster-morph"]').forEach((e) => e.style.removeProperty('view-transition-name'));
  if (morphEl) morphEl.style.setProperty('view-transition-name', 'poster-morph');
  const vt = document.startViewTransition(fn);
  vt.finished.finally(() => document.querySelectorAll('[style*="poster-morph"]').forEach((e) => e.style.removeProperty('view-transition-name')));
}

window.addEventListener('popstate', (e) => {
  if (e.state?.player) return;
  if (document.querySelector('.player')) return; // the player handles its own history entry
  navIdx = e.state?.idx || 0;
  transition(() => render({ restoreScroll: e.state?.scroll || 0 }));
});

/* ------------------------------------------------------------ navigation chrome */
function setActiveTab(tab) {
  document.querySelectorAll('[data-tab-link]').forEach((a) => {
    const on = a.dataset.tabLink === tab;
    a.classList.toggle('is-active', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  movePill();
}

function movePill() {
  const nav = document.querySelector('.nav');
  const pill = nav?.querySelector('.nav__pill');
  const active = nav?.querySelector('a.is-active');
  if (!pill) return;
  if (!active) return (pill.style.opacity = 0);
  pill.style.opacity = 1;
  pill.style.width = active.offsetWidth + 'px';
  pill.style.transform = `translateX(${active.offsetLeft}px)`;
}

const topbar = document.querySelector('.topbar');
const onScroll = () => topbar.classList.toggle('is-top', scrollY < 12);
addEventListener('scroll', onScroll, { passive: true });
addEventListener('resize', movePill);
onScroll();

function hideSplash() {
  const s = document.querySelector('.splash');
  if (!s) return;
  s.classList.add('is-done');
  setTimeout(() => s.remove(), 700);
}

/* ------------------------------------------------------------- global clicks */
async function findItem(key) {
  if (registry.has(key)) return registry.get(key);
  if (key.startsWith('ia:')) {
    const item = await resolveTitle(key.slice(3));
    registry.set(key, item);
    return item;
  }
  return null;
}

document.addEventListener('click', async (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

  const playEl = e.target.closest('[data-play]');
  if (playEl) {
    e.preventDefault();
    e.stopPropagation();
    const item = await findItem('ia:' + playEl.dataset.play);
    if (item) play(item);
    return;
  }

  const listEl = e.target.closest('[data-list]');
  if (listEl) {
    e.preventDefault();
    const item = await findItem(listEl.dataset.list);
    if (!item) return;
    const added = store.toggleList(item);
    haptic(added ? [8, 40, 8] : 8);
    document.querySelectorAll(`[data-list="${CSS.escape(item.key)}"]`).forEach((b) => {
      b.classList.toggle('is-on', added);
      b.setAttribute('aria-pressed', added);
      b.innerHTML = icon(added ? 'check' : 'plus');
    });
    toast(added ? `Added “${item.title}” to My List` : `Removed from My List`, added ? 'check' : 'x');
    if (location.pathname === '/list') render({ restoreScroll: scrollY });
    return;
  }

  if (e.target.closest('[data-surprise]')) {
    e.preventDefault();
    haptic([6, 30, 6, 30, 6]);
    const films = (await catalog()).filter((f) => !f.tags.includes('short'));
    const pick = films[Math.floor(Math.random() * Math.min(films.length, 300))];
    toast(`Tonight: ${pick.title} (${pick.year})`, 'sparkles');
    return navigate(pick.href);
  }

  if (e.target.closest('[data-open-search]')) {
    e.preventDefault();
    haptic();
    return openSearch();
  }

  const a = e.target.closest('a[href]');
  if (a && a.origin === location.origin && !a.target && !a.hasAttribute('download') && !a.getAttribute('href').startsWith('#')) {
    e.preventDefault();
    if (a.closest('.tabbar')) haptic(6);
    navigate(a.getAttribute('href'), { from: a.closest('.card') });
  }
});

async function share(item) {
  const url = location.origin + item.href;
  const data = { title: `${item.title} on Lumen`, text: item.playable ? `Watch ${item.title} free on Lumen` : `Check out ${item.title}`, url };
  try {
    if (navigator.share) return await navigator.share(data);
    await navigator.clipboard.writeText(url);
    toast('Link copied');
  } catch {}
}

/* -------------------------------------------------------------------- boot */
initSearch(navigate);
initPreviews();
document.addEventListener('player:closed', () => {
  // Refresh progress-dependent UI (Resume buttons, Continue Watching, Because you watched).
  if (['/', '/list'].includes(location.pathname) || location.pathname.startsWith('/title/')) render({ restoreScroll: scrollY });
});
history.replaceState({ scroll: 0, idx: 0 }, '');
render();
setTimeout(hideSplash, 1200); // never hold the splash for slow APIs; skeletons take over

if ('serviceWorker' in navigator && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
