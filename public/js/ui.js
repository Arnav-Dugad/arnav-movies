// Shared UI: icons, safe templating, cards, rows, previews, trailers, toasts and ambient color.
import { store } from './store.js';
import { iaStream, iaItem } from './api.js';

export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const P = {
  play: '<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1.2" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" rx="1.2" fill="currentColor" stroke="none"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.6v.1"/>',
  left: '<path d="m15 5-7 7 7 7"/>',
  right: '<path d="m9 5 7 7-7 7"/>',
  down: '<path d="m5 9 7 7 7-7"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  volume: '<path d="M4 9.5h3.5L12 5v14l-4.5-4.5H4Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12"/>',
  mute: '<path d="M4 9.5h3.5L12 5v14l-4.5-4.5H4Z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
  pip: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><rect x="12" y="11.5" width="6.5" height="5" rx="1" fill="currentColor"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  airplay: '<path d="M6 17H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-1"/><path d="m12 15 5 6H7Z" fill="currentColor"/>',
  back10: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3 4v4.5h4.5"/><text x="12" y="15.3" font-size="7.5" font-weight="700" text-anchor="middle" fill="currentColor" stroke="none" font-family="system-ui">10</text>',
  fwd10: '<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1"/><path d="M21 4v4.5h-4.5"/><text x="12" y="15.3" font-size="7.5" font-weight="700" text-anchor="middle" fill="currentColor" stroke="none" font-family="system-ui">10</text>',
  sparkles: '<path d="M12 3.5 13.8 9l5.7 1.9-5.7 1.9L12 18.5l-1.8-5.7L4.5 11l5.7-1.9Z" fill="currentColor" stroke="none"/><path d="M19 3v4M17 5h4"/>',
  shuffle: '<path d="M3 7h3.5c2.5 0 3.7 1.2 5.5 5s3 5 5.5 5H21M3 17h3.5c1.4 0 2.4-.4 3.2-1.2M14.3 8.2C15.1 7.4 16.1 7 17.5 7H21M18 4l3 3-3 3M18 14l3 3-3 3"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18"/>',
  share: '<path d="M12 15V3.5M7.5 8 12 3.5 16.5 8"/><path d="M5 12v6.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V12"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7M9 7V4h6v3"/>',
  bookmark: '<path d="M6 4h12v16l-6-4-6 4Z"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  cc: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10.5 10.2a2.3 2.3 0 1 0 0 3.6M17 10.2a2.3 2.3 0 1 0 0 3.6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  scenes: '<rect x="3" y="4" width="8" height="7" rx="1.5"/><rect x="13" y="4" width="8" height="7" rx="1.5"/><rect x="3" y="13" width="8" height="7" rx="1.5"/><rect x="13" y="13" width="8" height="7" rx="1.5"/>',
  theater: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6 21h12"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>',
  cast: '<path d="M3 17a4 4 0 0 1 4 4M3 13a8 8 0 0 1 8 8M3 9a12 12 0 0 1 12 12"/><path d="M3 6V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3"/>',
  next: '<path d="M5 5v14l10-7Z" fill="currentColor" stroke="none"/><path d="M19 5v14"/>',
  trailer: '<rect x="2.5" y="5" width="19" height="14" rx="3.5"/><path d="M10 9.2v5.6l4.8-2.8Z" fill="currentColor" stroke="none"/>',
  pulse: '<path d="M3 12h4l2.5-6 4 12 2.5-6H21"/>',
};

export const icon = (name, cls = '') =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;

export const haptic = (pattern = 8) => {
  try { navigator.vibrate?.(pattern); } catch {}
};

export const fmtRuntime = (m) => (m ? (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`) : '');
export const fmtTime = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};
export const fmtHours = (sec) => (sec < 3600 ? `${Math.round(sec / 60)}m` : `${(sec / 3600).toFixed(1)}h`);

export function metaLine(item, { max = 3 } = {}) {
  const bits = [];
  if (item.year) bits.push(item.year);
  if (item.runtime) bits.push(fmtRuntime(item.runtime));
  (item.genres || []).slice(0, max - 1).forEach((g) => bits.push(g));
  return bits.map(esc).join('<span class="dot"></span>');
}

/** Score badges: TMDB, Rotten Tomatoes, Metacritic, AniList, TVMaze. */
export function ratingBadges(r = {}, { small = false } = {}) {
  const out = [];
  if (r.rt != null) out.push(`<span class="score score--rt ${r.rt >= 60 ? 'is-fresh' : 'is-rotten'}" title="Rotten Tomatoes (Tomatometer)"><i></i>${r.rt}%</span>`);
  if (r.mc != null) out.push(`<span class="score score--mc ${r.mc >= 61 ? 'is-good' : r.mc >= 40 ? 'is-mixed' : 'is-bad'}" title="Metacritic Metascore"><b>${r.mc}</b>${small ? '' : 'Metacritic'}</span>`);
  if (r.tmdb != null) out.push(`<span class="score" title="TMDB user score"><em>★</em>${(+r.tmdb).toFixed(1)}${small ? '' : '<small>TMDB</small>'}</span>`);
  if (r.anilist != null) out.push(`<span class="score" title="AniList average score"><em>★</em>${r.anilist}%${small ? '' : '<small>AniList</small>'}</span>`);
  if (r.tvmaze != null) out.push(`<span class="score" title="TVMaze rating"><em>★</em>${(+r.tvmaze).toFixed(1)}</span>`);
  return out.join('');
}

const img = (src, alt, { eager = false, cls = '' } = {}) =>
  src ? `<img class="${cls}" src="${esc(src)}" alt="${esc(alt)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">` : '';

// Fade images in once decoded, drop broken ones so the title fallback shows. Delegated, so no inline handlers.
document.addEventListener('load', (e) => e.target.tagName === 'IMG' && e.target.classList.add('is-loaded'), true);
document.addEventListener('error', (e) => e.target.tagName === 'IMG' && !e.target.closest('.player') && e.target.remove(), true);

const fallback = (item) => `<div class="card__fallback">${esc(item.title)}</div>`;

const previewAttr = (item) => {
  if (!item.playable || item.kind === 'show' || item.kind === 'anime') return '';
  const start = item.length ? Math.round(item.length * 0.2) : 240;
  return `data-pv="${esc(item.id)}|${esc(item.preview || item.file || '')}|${start}"`;
};

export function posterCard(item, { badge = true } = {}) {
  const sub = [item.year, item.genres?.[0]].filter(Boolean).join(' · ');
  return `<a class="card" href="${esc(item.href)}" data-key="${esc(item.key)}" ${previewAttr(item)}>
    <div class="card__media">
      ${fallback(item)}
      ${img(item.poster, item.title)}
      ${badge && item.playable ? `<span class="card__badge badge badge--free">Free</span>` : ''}
      ${item.playable ? `<span class="card__play" data-play="${esc(item.id)}" aria-label="Play ${esc(item.title)}">${icon('play')}</span>` : ''}
    </div>
    <div class="card__meta"><div class="card__title">${esc(item.title)}</div><div class="card__sub">${esc(sub)}</div></div>
  </a>`;
}

export function wideCard(item, progress) {
  const pct = progress ? Math.min(100, (progress.t / progress.d) * 100) : 0;
  const left = progress ? Math.max(1, Math.round((progress.d - progress.t) / 60)) : 0;
  const art = item.backdropSm || item.backdrop || item.posterHd || item.poster;
  return `<a class="card card--wide" href="${esc(item.href)}" data-key="${esc(item.key)}" ${progress ? `data-play="${esc(item.id)}"` : ''} ${previewAttr(item)}>
    <div class="card__media">
      ${fallback(item)}
      ${img(art, item.title)}
      ${item.logo ? `<img class="card__logo" src="${esc(item.logo)}" alt="" loading="lazy">` : `<div class="card__overlay-title">${esc(item.title)}</div>`}
      ${progress ? `<div class="card__progress"><i style="width:${pct.toFixed(1)}%"></i></div>` : ''}
    </div>
    <div class="card__meta"><div class="card__sub">${progress ? `${left} min left` : esc([item.year, item.genres?.[0]].filter(Boolean).join(' · '))}</div></div>
  </a>`;
}

export function rankCard(item, n) {
  return `<a class="card card--rank" href="${esc(item.href)}" data-key="${esc(item.key)}" ${previewAttr(item)}><span class="rank" aria-hidden="true">${n}</span>
    <div class="card__media">${fallback(item)}${img(item.poster, item.title)}</div></a>`;
}

export function row({ title, sub = '', more = '', cards, variant = '' }) {
  return `<section class="row ${variant ? 'row--' + variant : ''}">
    <div class="container"><header class="row__head"><h2 class="row__title">${esc(title)}${sub ? ` <small>${esc(sub)}</small>` : ''}</h2>
    ${more ? `<a class="row__more" href="${esc(more)}">See all ${icon('right')}</a>` : ''}</header></div>
    <div class="row__wrap">
      <button class="row__nav row__nav--prev" aria-label="Scroll left" disabled><span class="glass">${icon('left')}</span></button>
      <div class="row__track">${cards}</div>
      <button class="row__nav row__nav--next" aria-label="Scroll right"><span class="glass">${icon('right')}</span></button>
    </div>
  </section>`;
}

export const skeletonRow = (title, n = 8, wide = false) =>
  row({
    title,
    variant: wide ? 'wide' : '',
    cards: Array.from({ length: n }, () => `<div><div class="skel ${wide ? 'skel--wide' : 'skel--poster'}"></div><div class="skel skel--line"></div></div>`).join(''),
  });

export function wireRows(root) {
  root.querySelectorAll('.row__wrap').forEach((wrap) => {
    if (wrap.dataset.wired) return;
    wrap.dataset.wired = '1';
    const track = wrap.querySelector('.row__track');
    const prev = wrap.querySelector('.row__nav--prev');
    const next = wrap.querySelector('.row__nav--next');
    const ranks = [...track.querySelectorAll('.rank')];
    let raf = 0;
    const update = () => {
      raf = 0;
      prev.disabled = track.scrollLeft < 8;
      next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 8;
      // Parallax: rank numerals drift against the scroll direction.
      for (const r of ranks) {
        const b = r.parentElement.getBoundingClientRect();
        const offset = (b.left + b.width / 2) / innerWidth - 0.5;
        r.style.transform = `translate3d(${offset * -36}px, 0, 0)`;
      }
    };
    const go = (dir) => track.scrollBy({ left: dir * track.clientWidth * 0.85, behavior: 'smooth' });
    prev.addEventListener('click', () => go(-1));
    next.addEventListener('click', () => go(1));
    track.addEventListener('scroll', () => (raf ||= requestAnimationFrame(update)), { passive: true });
    requestAnimationFrame(update);
  });
}

/* ---------------------------------------------------------- hover previews */
export function initPreviews() {
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  let timer = 0, active = null;
  const stop = () => {
    clearTimeout(timer);
    if (!active) return;
    const { v, end } = active;
    clearTimeout(end);
    v.classList.remove('is-on');
    setTimeout(() => { v.pause(); v.removeAttribute('src'); v.load(); v.remove(); }, 350);
    active = null;
  };
  const start = async (card) => {
    let [id, file, t] = card.dataset.pv.split('|');
    if (!file) {
      const full = await iaItem(id).catch(() => null);
      if (!full?.preview) return;
      file = full.preview;
      t = full.length ? Math.round(full.length * 0.2) : 240;
    }
    if (!card.matches(':hover')) return;
    const v = document.createElement('video');
    v.className = 'card__preview';
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.src = iaStream(id, file);
    v.addEventListener('loadedmetadata', () => (v.currentTime = Math.min(+t || 0, (v.duration || 1) * 0.6)), { once: true });
    v.addEventListener('playing', () => v.classList.add('is-on'), { once: true });
    card.querySelector('.card__media').appendChild(v);
    v.play().catch(() => {});
    active = { card, v, end: setTimeout(stop, 15000) };
  };
  document.addEventListener('pointerover', (e) => {
    const card = e.target.closest?.('.card[data-pv]');
    if (!card || active?.card === card) return;
    stop();
    timer = setTimeout(() => start(card), 850);
  });
  document.addEventListener('pointerout', (e) => {
    const card = e.target.closest?.('.card[data-pv]');
    if (card && !card.contains(e.relatedTarget)) stop();
  });
  document.addEventListener('click', stop, true);
}

/* ---------------------------------------------------------------- trailers */
export const ytEmbed = (key, { muted = false, controls = true } = {}) =>
  `https://www.youtube-nocookie.com/embed/${encodeURIComponent(key)}?autoplay=1&mute=${muted ? 1 : 0}&controls=${controls ? 1 : 0}&rel=0&modestbranding=1&playsinline=1&iv_load_policy=3` +
  (controls ? '' : '&disablekb=1&fs=0&cc_load_policy=0'); // background trailers: no playlist chrome

export function openTrailer(key, title, { onClose } = {}) {
  const m = document.createElement('div');
  m.className = 'modal';
  m.setAttribute('role', 'dialog');
  m.setAttribute('aria-label', `${title} trailer`);
  m.innerHTML = `<div class="modal__scrim" data-close></div>
    <div class="modal__box"><div class="modal__grab" aria-hidden="true"></div>
      <button class="icon-btn modal__close glass" data-close aria-label="Close trailer">${icon('x')}</button>
      <div class="modal__video"><iframe src="${esc(ytEmbed(key))}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen title="${esc(title)} trailer"></iframe></div>
    </div>`;
  document.body.appendChild(m);
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => m.classList.add('is-open'));
  haptic();
  const close = () => {
    m.classList.remove('is-open');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => m.remove(), 400);
    document.body.style.overflow = '';
    onClose?.();
  };
  const onKey = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', onKey);
  m.addEventListener('click', (e) => e.target.closest('[data-close]') && close());
  import('./gestures.js').then(({ dragDismiss }) => dragDismiss(m.querySelector('.modal__box'), { onDismiss: close }));
  return close;
}

/* ------------------------------------------------------------------ toasts */
export function toast(msg, iconName = 'check') {
  const host = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast glass';
  el.innerHTML = `${icon(iconName)}<span>${esc(msg)}</span>`;
  host.appendChild(el);
  setTimeout(() => {
    el.classList.add('is-out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, 2400);
}

export function listButton(item, { small = false } = {}) {
  const on = store.inList(item.key);
  return `<button class="btn btn--glass btn--round ${small ? 'btn--sm' : ''} ${on ? 'is-on' : ''}" data-list="${esc(item.key)}" aria-pressed="${on}" aria-label="${on ? 'Remove from' : 'Add to'} My List" title="My List">${icon(on ? 'check' : 'plus')}</button>`;
}

/* ----------------------------------------------------------- ambient color */
const colorCache = new Map();

export function sampleColors(src) {
  if (!src) return Promise.resolve(null);
  if (colorCache.has(src)) return colorCache.get(src);
  const p = new Promise((resolve) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.decoding = 'async';
    im.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = 24; c.height = 36;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(im, 0, 0, 24, 36);
        resolve([vivid(avg(ctx.getImageData(0, 0, 24, 18).data)), vivid(avg(ctx.getImageData(0, 18, 24, 18).data))]);
      } catch {
        resolve(null);
      }
    };
    im.onerror = () => resolve(null);
    // CDNs like TMDB only send CORS headers when asked and don't `Vary: Origin`, so a poster already
    // cached by a plain <img> would fail here. A distinct query string gives the CORS fetch its own cache entry.
    im.src = src + (src.includes('?') ? '&' : '?') + 'cors=1';
  });
  colorCache.set(src, p);
  return p;
}

function avg(d) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    const w = Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) + 20; // favour saturated pixels
    r += d[i] * w; g += d[i + 1] * w; b += d[i + 2] * w; n += w;
  }
  return [r / n, g / n, b / n];
}

function vivid([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const boost = max - min < 30 ? 1.25 : 1.6;
  const mid = (max + min) / 2;
  const f = (v) => Math.round(Math.min(255, Math.max(0, mid + (v - mid) * boost) * (220 / Math.max(max, 1)) ** 0.5));
  return [f(r), f(g), f(b)];
}

const setAmb = (a, b) => {
  const root = document.documentElement.style;
  root.setProperty('--amb-1', a.join(', '));
  root.setProperty('--amb-2', b.join(', '));
};

export async function setAmbient(src) {
  const c = await sampleColors(src);
  if (c) setAmb(c[0], c[1]);
}

export function setAmbientHex(hex) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex || '');
  if (!m) return;
  const rgb = m.slice(1).map((x) => parseInt(x, 16));
  setAmb(vivid(rgb), vivid(rgb.map((v, i) => Math.round(v * (i === 2 ? 1.1 : 0.6)))));
}

/* --------------------------------------------------------------- 3D tilt */
export function wireTilt(root) {
  if (matchMedia('(hover: none)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  root.querySelectorAll('[data-tilt]').forEach((el) => {
    const card = el.querySelector('.tilt');
    if (!card) return;
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      card.style.transform = `rotateY(${(x - 0.5) * 18}deg) rotateX(${(0.5 - y) * 14}deg) scale(1.02)`;
      card.style.setProperty('--gx', `${x * 100}%`);
      card.style.setProperty('--gy', `${y * 100}%`);
    });
    el.addEventListener('pointerleave', () => (card.style.transform = ''));
  });
}

export function emptyState({ iconName = 'film', title, text, action = '' }) {
  return `<div class="empty glass"><div class="empty__icon">${icon(iconName)}</div><h3>${esc(title)}</h3><p>${esc(text)}</p>${action}</div>`;
}

export const footer = () => `<footer class="footer"><div class="footer__inner">
  <div>Lumen hosts no video. Curated titles are U.S. public domain; everything plays straight from the <a href="https://archive.org/details/feature_films" target="_blank" rel="noopener">Internet Archive</a>, which handles rights and takedowns.</div>
  <div>Metadata: <a href="https://www.themoviedb.org" target="_blank" rel="noopener">TMDB</a> (not endorsed or certified by TMDB) · <a href="https://www.tvmaze.com" target="_blank" rel="noopener">TVMaze</a> · <a href="https://anilist.co" target="_blank" rel="noopener">AniList</a> · <a href="https://www.wikidata.org" target="_blank" rel="noopener">Wikidata</a> · Where-to-watch by JustWatch · <a href="/status">Stream status</a></div>
</div></footer>`;
