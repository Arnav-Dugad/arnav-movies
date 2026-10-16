// App shell: router, navigation chrome and global interactions.
import * as views from './views.js';
import { registry } from './views.js';
import { catalog, resolveTitle } from './api.js';
import { store } from './store.js';
import { play } from './player.js';
import { initSearch, openSearch } from './search.js';
import { icon, toast } from './ui.js';

const view = document.getElementById('view');

const routes = [
  [/^\/$/, views.home, 'home'],
  [/^\/movies\/?$/, views.movies, 'movies'],
  [/^\/tv\/?$/, views.tv, 'tv'],
  [/^\/list\/?$/, views.myList, 'list'],
  [/^\/collection\/([\w-]+)\/?$/, views.collection, 'movies'],
  [/^\/title\/(.+?)\/?$/, views.title, 'movies'],
  [/^\/show\/(\d+)\/?$/, views.show, 'tv'],
];

let token = 0;
let leaveFns = [];

async function render({ restoreScroll = 0 } = {}) {
  const my = ++token;
  leaveFns.forEach((fn) => fn());
  leaveFns = [];
  const path = location.pathname;
  const match = routes.map(([re, fn, tab]) => [path.match(re), fn, tab]).find(([m]) => m);
  const [m, fn, tab] = match || [null, views.notFound, ''];
  setActiveTab(tab);
  document.title = 'Lumen — Free classic cinema & TV';
  const ctx = {
    el: view,
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
  if (ctx.alive()) window.scrollTo({ top: restoreScroll, behavior: 'instant' });
}

export function navigate(href, { replace = false } = {}) {
  const url = new URL(href, location.origin);
  if (url.origin !== location.origin) return (location.href = href);
  if (url.pathname + url.search === location.pathname + location.search && !url.hash) return;
  history.replaceState({ ...(history.state || {}), scroll: scrollY }, '');
  history[replace ? 'replaceState' : 'pushState']({ scroll: 0 }, '', url.pathname + url.search + url.hash);
  transition(() => render());
}

function transition(fn) {
  if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.startViewTransition(fn);
  } else fn();
}

window.addEventListener('popstate', (e) => {
  if (e.state?.player) return;
  if (document.querySelector('.player')) return; // player handles its own history entry
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
    const films = await catalog();
    const pick = films[Math.floor(Math.random() * films.length)];
    toast(`Tonight: ${pick.title} (${pick.year})`, 'sparkles');
    return navigate(pick.href);
  }

  if (e.target.closest('[data-open-search]')) {
    e.preventDefault();
    return openSearch();
  }

  const a = e.target.closest('a[href]');
  if (a && a.origin === location.origin && !a.target && !a.hasAttribute('download')) {
    e.preventDefault();
    navigate(a.getAttribute('href'));
  }
});

async function share(item) {
  const url = location.origin + item.href;
  const data = { title: `${item.title} on Lumen`, text: item.kind === 'show' ? `Check out ${item.title}` : `Watch ${item.title} free on Lumen`, url };
  try {
    if (navigator.share) return await navigator.share(data);
    await navigator.clipboard.writeText(url);
    toast('Link copied');
  } catch {}
}

/* -------------------------------------------------------------------- boot */
initSearch(navigate);
document.addEventListener('player:closed', () => {
  // Refresh progress-dependent UI (Resume buttons, Continue Watching).
  if (['/', '/list'].includes(location.pathname) || location.pathname.startsWith('/title/')) render({ restoreScroll: scrollY });
});
history.replaceState({ scroll: 0 }, '');
render();

if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
