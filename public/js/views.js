// Page views. Each view renders synchronously what it can, then streams in live rows.
import * as api from './api.js';
import { store } from './store.js';
import {
  esc, icon, posterCard, wideCard, rankCard, row, skeletonRow, wireRows, wireTilt, listButton,
  metaLine, fmtRuntime, fmtHours, setAmbient, emptyState, footer,
} from './ui.js';

/* Item registry so global click handlers (play, My List) can find the full item for a card. */
export const registry = new Map();
const reg = (list) => (list.forEach((x) => x && registry.set(x.key, x)), list);

/* ---------------------------------------------------------------- collections */
export const COLLECTIONS = {
  horror: { title: 'Midnight Horror', sub: 'Vampires, ghouls and haunted halls', tile: 'linear-gradient(135deg,#43061d,#b3123d)', ia: 'subject:horror' },
  noir: { title: 'Film Noir', sub: 'Shadows, sin and cigarette smoke', tile: 'linear-gradient(135deg,#0f0f12,#5b5f6b)', ia: 'subject:(noir OR "film noir")' },
  hitchcock: { title: 'Hitchcock', sub: 'The master of suspense', tile: 'linear-gradient(135deg,#1d2b64,#a33b5b)', ia: 'creator:hitchcock OR subject:hitchcock OR title:hitchcock' },
  silent: { title: 'The Silent Era', sub: 'Where cinema learned to dream', tile: 'linear-gradient(135deg,#5e4b2d,#c2a36b)', ia: '', collection: 'silent_films' },
  keaton: { title: 'Buster Keaton', sub: 'The Great Stone Face', tile: 'linear-gradient(135deg,#2c3e50,#bdc3c7)', ia: 'creator:keaton OR subject:keaton OR title:keaton' },
  scifi: { title: 'Retro Sci-Fi', sub: 'Saucers, robots and moon shots', tile: 'linear-gradient(135deg,#0b486b,#3bb2b8)', ia: 'subject:("science fiction" OR sci-fi OR scifi)' },
  cult: { title: 'Cult Classics', sub: 'So strange they became legends', tile: 'linear-gradient(135deg,#4a00e0,#e05297)', ia: 'subject:(cult OR "b-movie" OR exploitation)' },
  comedy: { title: 'Screwball & Slapstick', sub: 'Pratfalls and rapid-fire wit', tile: 'linear-gradient(135deg,#f7971e,#d4145a)', ia: 'subject:comedy' },
  thriller: { title: 'Thrillers', sub: 'Edge-of-your-seat suspense', tile: 'linear-gradient(135deg,#232526,#8e2de2)', ia: 'subject:(thriller OR suspense OR mystery)' },
  romance: { title: 'Golden-Age Romance', sub: 'Swoon-worthy classics', tile: 'linear-gradient(135deg,#8e2b4f,#ff8fa3)', ia: 'subject:romance' },
  drama: { title: 'Timeless Drama', sub: 'Stories that still hit', tile: 'linear-gradient(135deg,#3a3a52,#7f6a93)', ia: 'subject:drama' },
  western: { title: 'Westerns', sub: 'Dust, duels and open skies', tile: 'linear-gradient(135deg,#7b4397,#dc8743)', ia: 'subject:western' },
  animation: { title: 'Vintage Animation', sub: 'Hand-drawn wonders', tile: 'linear-gradient(135deg,#11998e,#38ef7d)', ia: 'subject:(animation OR cartoon)' },
};

const MOODS = [
  { tag: 'horror', label: 'Spooky', c: '#b3123d' },
  { tag: 'comedy', label: 'Make me laugh', c: '#f7971e' },
  { tag: 'thriller', label: 'Edge of my seat', c: '#8e2de2' },
  { tag: 'romance', label: 'Romantic', c: '#ff8fa3' },
  { tag: 'scifi', label: 'Mind-bending', c: '#3bb2b8' },
  { tag: 'noir', label: 'Moody & dark', c: '#8a8f9c' },
  { tag: 'silent', label: 'Silent magic', c: '#c2a36b' },
];

const byTag = (films, tag) => films.filter((f) => f.tags.includes(tag));

/* Deterministic daily shuffle so the hero changes once a day, not on every reload. */
function dailyShuffle(list, salt = '') {
  const seed = [...(new Date().toDateString() + salt)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  let s = seed;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  return list.map((x) => [x, rand()]).sort((a, b) => a[1] - b[1]).map(([x]) => x);
}

function timeContext() {
  const h = new Date().getHours();
  if (h >= 21 || h < 5) return { greet: 'Late-night pick', boost: ['horror', 'noir', 'thriller'] };
  if (h >= 17) return { greet: 'Tonight’s pick', boost: ['noir', 'thriller', 'romance', 'drama'] };
  if (h >= 12) return { greet: 'Afternoon matinée', boost: ['comedy', 'keaton', 'musical', 'western'] };
  return { greet: 'Morning reel', boost: ['comedy', 'silent', 'family', 'animation'] };
}

function recommend(films, n = 16) {
  const taste = store.taste();
  if (!Object.keys(taste).length) return null;
  const seen = new Set([...store.list().map((x) => x.key), ...store.continueWatching().map((p) => p.item.key)]);
  return films
    .filter((f) => !seen.has(f.key))
    .map((f) => [f, [...f.genres, ...f.tags].reduce((s, g) => s + (taste[g] || 0), 0)])
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([f]) => f);
}

function similar(film, films, n = 14) {
  const tags = new Set(film.tags), genres = new Set(film.genres), dirs = new Set(film.director);
  return films
    .filter((f) => f.key !== film.key)
    .map((f) => {
      let s = f.tags.filter((t) => tags.has(t)).length * 3 + f.genres.filter((g) => genres.has(g)).length * 2;
      s += f.director.filter((d) => dirs.has(d)).length * 5;
      if (film.year && f.year) s += Math.max(0, 2 - Math.abs(film.year - f.year) / 10);
      return [f, s];
    })
    .filter(([, s]) => s > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([f]) => f);
}

/** Replace a placeholder with HTML once the view is still current. */
function fill(ctx, sel, html) {
  if (!ctx.alive()) return;
  const slot = ctx.el.querySelector(sel);
  if (!slot) return;
  if (!html) return slot.remove();
  slot.outerHTML = html;
  wireRows(ctx.el);
}

const tileHtml = (tag, films) => {
  const c = COLLECTIONS[tag];
  const cover = byTag(films, tag)[0];
  return `<a class="tile" href="/collection/${tag}" style="--tile:${c.tile}">
    ${cover ? `<div class="tile__img"><img src="${esc(cover.poster)}" alt="" loading="lazy"></div>` : ''}
    <strong>${esc(c.title)}</strong><span>${esc(c.sub)}</span></a>`;
};

/* ======================================================================= HOME */
export async function home(ctx) {
  const films = reg(await api.catalog());
  const { greet, boost } = timeContext();
  const ranked = dailyShuffle(films, 'hero').sort((a, b) => boost.filter((t) => b.tags.includes(t)).length - boost.filter((t) => a.tags.includes(t)).length);
  const heroItems = ranked.filter((f) => f.posterHd && f.overview).slice(0, 6);
  const cw = store.continueWatching();
  const forYou = recommend(films);
  const top10 = films.slice(0, 10);

  ctx.el.innerHTML = `<div class="view view--flush">
    ${hero(heroItems, greet)}
    <div class="rows">
      <div class="container"><div class="moods" role="list">
        <button class="mood mood--surprise" data-surprise role="listitem"><i>${icon('shuffle')}</i>Surprise me</button>
        ${MOODS.map((m) => `<a class="mood glass" href="/collection/${m.tag}" role="listitem"><i style="background:${m.c}33;color:${m.c}">●</i>${esc(m.label)}</a>`).join('')}
      </div></div>
      ${cw.length ? row({ title: 'Continue Watching', variant: 'wide', cards: cw.map((p) => wideCard(reg([p.item])[0], p)).join('') }) : ''}
      ${forYou?.length ? row({ title: 'For You', sub: 'Based on what you watch and save', cards: forYou.map((f) => posterCard(f)).join('') }) : ''}
      ${row({ title: 'Top 10 Free Classics', variant: 'rank', cards: top10.map((f, i) => rankCard(f, i + 1)).join('') })}
      ${row({ title: 'Browse Collections', variant: 'tiles', cards: Object.keys(COLLECTIONS).filter((t) => byTag(films, t).length).map((t) => tileHtml(t, films)).join('') })}
      <div data-slot="tonight">${skeletonRow('Airing Tonight')}</div>
      ${row({ title: COLLECTIONS.horror.title, more: '/collection/horror', cards: byTag(films, 'horror').map((f) => posterCard(f)).join('') })}
      ${row({ title: 'Hitchcock in the Public Domain', more: '/collection/hitchcock', cards: byTag(films, 'hitchcock').map((f) => posterCard(f)).join('') })}
      <div data-slot="vault">${skeletonRow('Most Streamed in the Vault', 6, true)}</div>
      ${row({ title: COLLECTIONS.noir.title, more: '/collection/noir', cards: byTag(films, 'noir').map((f) => posterCard(f)).join('') })}
      <div data-slot="classictv">${skeletonRow('Classic TV — Free', 6, true)}</div>
      ${row({ title: 'Silent Masterpieces', more: '/collection/silent', cards: byTag(films, 'silent').map((f) => posterCard(f)).join('') })}
      <div data-slot="streaming">${skeletonRow('New on Streaming Today')}</div>
      ${row({ title: 'Laugh Out Loud', more: '/collection/comedy', cards: byTag(films, 'comedy').map((f) => posterCard(f)).join('') })}
    </div>
    ${footer()}
  </div>`;
  wireRows(ctx.el);
  wireHero(ctx);

  api.airingTonight().then((shows) =>
    fill(ctx, '[data-slot="tonight"]', shows.length ? row({ title: 'Airing Tonight', sub: new Date().toLocaleDateString(undefined, { weekday: 'long' }), more: '/tv', cards: reg(shows.slice(0, 24)).map((s) => posterCard(s)).join('') }) : '')
  ).catch(() => fill(ctx, '[data-slot="tonight"]', ''));

  api.iaSearch({ rows: 24 }).then(({ items }) =>
    fill(ctx, '[data-slot="vault"]', row({ title: 'Most Streamed in the Vault', sub: '28,000+ films on the Internet Archive', more: '/movies?tab=vault', variant: 'wide', cards: reg(items).map((f) => wideCard(f)).join('') }))
  ).catch(() => fill(ctx, '[data-slot="vault"]', ''));

  api.iaSearch({ collection: 'classic_tv', rows: 24 }).then(({ items }) =>
    fill(ctx, '[data-slot="classictv"]', row({ title: 'Classic TV — Free', sub: 'Vintage episodes, ready to stream', more: '/tv#classic', variant: 'wide', cards: reg(items).map((f) => wideCard(f)).join('') }))
  ).catch(() => fill(ctx, '[data-slot="classictv"]', ''));

  api.streamingToday().then((shows) =>
    fill(ctx, '[data-slot="streaming"]', shows.length ? row({ title: 'New on Streaming Today', sub: 'Episodes dropping on Netflix, Prime, Disney+ and more', more: '/tv', cards: reg(shows.slice(0, 24)).map((s) => posterCard(s)).join('') }) : '')
  ).catch(() => fill(ctx, '[data-slot="streaming"]', ''));
}

function hero(items, greet) {
  return `<section class="hero" aria-roledescription="carousel" aria-label="Featured">
    <div class="hero__slides">
    ${items.map((f, i) => `<article class="hero__slide ${i === 0 ? 'is-active' : ''}" data-i="${i}" aria-hidden="${i !== 0}" data-src="${esc(f.poster)}">
      <div class="hero__bg"><img src="${esc(f.posterHd)}" alt="" ${i === 0 ? 'fetchpriority="high"' : 'loading="lazy"'}></div>
      <div class="container hero__inner">
        <div class="hero__content">
          <div class="hero__eyebrow">${icon('sparkles')} ${esc(greet)} · Free &amp; public domain</div>
          <h1 class="hero__title">${esc(f.title)}</h1>
          <div class="chips">${metaLine(f, { max: 4 })}${f.director[0] ? `<span class="dot"></span>${esc(f.director[0])}` : ''}</div>
          <p class="hero__overview">${esc(f.overview)}</p>
          <div class="hero__actions">
            <button class="btn btn--primary" data-play="${esc(f.id)}">${icon('play')} ${store.progress(f.key) ? 'Resume' : 'Play'}</button>
            <a class="btn btn--glass" href="${esc(f.href)}">${icon('info')} Details</a>
            ${listButton(f)}
          </div>
        </div>
        <div class="hero__poster" data-tilt><div class="tilt"><img src="${esc(f.poster)}" alt="${esc(f.title)} poster" ${i === 0 ? '' : 'loading="lazy"'}><div class="tilt__glare"></div></div></div>
      </div>
    </article>`).join('')}
    </div>
    <div class="hero__dots" role="tablist">${items.map((f, i) => `<button class="hero__dot ${i === 0 ? 'is-active' : ''}" data-go="${i}" role="tab" aria-label="Show ${esc(f.title)}"><i></i></button>`).join('')}</div>
    <div class="hero__arrows"><button class="btn btn--glass btn--round btn--sm" data-step="-1" aria-label="Previous">${icon('left')}</button><button class="btn btn--glass btn--round btn--sm" data-step="1" aria-label="Next">${icon('right')}</button></div>
  </section>`;
}

function wireHero(ctx) {
  const heroEl = ctx.el.querySelector('.hero');
  if (!heroEl) return;
  const slides = [...heroEl.querySelectorAll('.hero__slide')];
  const dots = [...heroEl.querySelectorAll('.hero__dot')];
  const DUR = 9000;
  heroEl.style.setProperty('--dur', DUR + 'ms');
  let i = 0, timer, remaining = DUR, started = Date.now();
  const show = (n) => {
    i = (n + slides.length) % slides.length;
    slides.forEach((s, k) => { s.classList.toggle('is-active', k === i); s.setAttribute('aria-hidden', k !== i); });
    dots.forEach((d, k) => {
      d.classList.toggle('is-active', k === i);
      const bar = d.querySelector('i');
      bar.style.animation = 'none';
      void bar.offsetWidth;
      bar.style.animation = '';
    });
    setAmbient(slides[i].dataset.src);
    remaining = DUR;
    schedule();
  };
  const schedule = () => {
    clearTimeout(timer);
    started = Date.now();
    timer = setTimeout(() => ctx.alive() && show(i + 1), remaining);
  };
  heroEl.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    const step = e.target.closest('[data-step]');
    if (go) show(+go.dataset.go);
    if (step) show(i + +step.dataset.step);
  });
  heroEl.addEventListener('pointerenter', (e) => {
    if (e.pointerType !== 'mouse') return;
    heroEl.classList.add('is-paused');
    clearTimeout(timer);
    remaining -= Date.now() - started;
  });
  heroEl.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'mouse') return;
    heroEl.classList.remove('is-paused');
    schedule();
  });
  // swipe on touch
  let x0 = null;
  heroEl.addEventListener('touchstart', (e) => (x0 = e.touches[0].clientX), { passive: true });
  heroEl.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 50) show(i + (dx < 0 ? 1 : -1));
    x0 = null;
  });
  document.addEventListener('visibilitychange', () => (document.hidden ? clearTimeout(timer) : ctx.alive() && schedule()));
  setAmbient(slides[0]?.dataset.src);
  schedule();
  wireTilt(heroEl);
}

/* ===================================================================== MOVIES */
const DECADES = ['1900', '1910', '1920', '1930', '1940', '1950', '1960', '1970'];
const SORTS = { downloads: 'Most streamed', avg_rating: 'Highest rated', 'year-desc': 'Newest', 'year-asc': 'Oldest' };

export async function movies(ctx) {
  const films = reg(await api.catalog());
  const params = new URLSearchParams(location.search);
  const state = {
    tab: params.get('tab') === 'vault' ? 'vault' : 'curated',
    g: params.get('g') || '',
    d: params.get('d') || '',
    sort: SORTS[params.get('sort')] ? params.get('sort') : 'downloads',
  };
  const tags = Object.keys(COLLECTIONS);

  ctx.el.innerHTML = `<div class="view"><div class="container">
    <header class="page-head">
      <div><div class="eyebrow">Movies</div><h1 class="page-title">Free films, forever.</h1>
      <p class="page-sub">Hand-picked public-domain classics, plus the entire Internet Archive feature film vault. No accounts, no ads, no catch.</p></div>
      <div class="segmented" data-seg><span class="segmented__thumb"></span>
        <button data-tab="curated">Curated</button><button data-tab="vault">The Vault</button></div>
    </header>
    <div class="pills" data-genres style="margin-bottom:14px">
      <button class="pill" data-g="">All</button>${tags.map((t) => `<button class="pill" data-g="${t}">${esc(COLLECTIONS[t].title)}</button>`).join('')}
    </div>
    <div data-vault-filters style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:26px">
      <select class="select" data-d aria-label="Decade"><option value="">Any decade</option>${DECADES.map((d) => `<option value="${d}">${d}s</option>`).join('')}</select>
      <select class="select" data-sort aria-label="Sort">${Object.entries(SORTS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
    </div>
    <div data-results></div>
  </div>${footer()}</div>`;

  const out = ctx.el.querySelector('[data-results]');
  const seg = ctx.el.querySelector('[data-seg]');
  const vaultFilters = ctx.el.querySelector('[data-vault-filters]');
  let io;

  const syncUrl = () => {
    const p = new URLSearchParams();
    if (state.tab === 'vault') p.set('tab', 'vault');
    if (state.g) p.set('g', state.g);
    if (state.tab === 'vault' && state.d) p.set('d', state.d);
    if (state.tab === 'vault' && state.sort !== 'downloads') p.set('sort', state.sort);
    history.replaceState(history.state, '', '/movies' + (p.toString() ? '?' + p : ''));
  };

  const paintControls = () => {
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === state.tab));
    const active = seg.querySelector('.is-active');
    const thumb = seg.querySelector('.segmented__thumb');
    thumb.style.width = active.offsetWidth + 'px';
    thumb.style.transform = `translateX(${active.offsetLeft - 4}px)`;
    ctx.el.querySelectorAll('[data-g]').forEach((b) => b.classList.toggle('is-active', b.dataset.g === state.g));
    vaultFilters.style.display = state.tab === 'vault' ? 'flex' : 'none';
    vaultFilters.querySelector('[data-d]').value = state.d;
    vaultFilters.querySelector('[data-sort]').value = state.sort;
  };

  const renderCurated = () => {
    const list = state.g ? byTag(films, state.g) : films;
    out.innerHTML = list.length
      ? `<div class="grid">${list.map((f) => posterCard(f)).join('')}</div>`
      : emptyState({ title: 'Nothing curated here yet', text: 'Switch to The Vault to explore thousands more films in this genre.' });
  };

  const renderVault = () => {
    io?.disconnect();
    out.innerHTML = `<div class="grid grid--wide" data-grid></div><div class="load-more"><div class="spinner"></div></div><p class="page-sub" data-count style="text-align:center;margin:0 auto"></p>`;
    const grid = out.querySelector('[data-grid]');
    const sentinel = out.querySelector('.load-more');
    const c = COLLECTIONS[state.g];
    const filter = [c?.ia, state.d ? `year:[${state.d} TO ${+state.d + 9}]` : ''].filter(Boolean).join(' AND ');
    const sort = { downloads: 'downloads desc', avg_rating: 'avg_rating desc', 'year-desc': 'year desc', 'year-asc': 'year asc' }[state.sort];
    let page = 1, total = Infinity, loading = false, loaded = 0;
    const token = {};
    out._token = token;
    const more = async () => {
      if (loading || loaded >= total) return;
      loading = true;
      try {
        const res = await api.iaSearch({ collection: c?.collection || 'feature_films', filter, sort, rows: 36, page });
        if (!ctx.alive() || out._token !== token) return;
        total = res.total;
        loaded += res.items.length;
        grid.insertAdjacentHTML('beforeend', reg(res.items).map((f) => wideCard(f)).join(''));
        out.querySelector('[data-count]').textContent = `${total.toLocaleString()} films`;
        page++;
        if (loaded >= total || !res.items.length) sentinel.remove();
      } catch {
        sentinel.innerHTML = '<button class="btn btn--glass btn--sm">Retry</button>';
        sentinel.onclick = () => { sentinel.innerHTML = '<div class="spinner"></div>'; more(); };
      } finally {
        loading = false;
      }
    };
    io = new IntersectionObserver((e) => e[0].isIntersecting && more(), { rootMargin: '800px' });
    io.observe(sentinel);
    ctx.onLeave(() => io.disconnect());
  };

  const render = () => {
    syncUrl();
    paintControls();
    state.tab === 'vault' ? renderVault() : renderCurated();
  };

  seg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b && b.dataset.tab !== state.tab) { state.tab = b.dataset.tab; render(); }
  });
  ctx.el.querySelector('[data-genres]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-g]');
    if (b) { state.g = b.dataset.g; render(); }
  });
  vaultFilters.addEventListener('change', (e) => {
    if (e.target.matches('[data-d]')) state.d = e.target.value;
    if (e.target.matches('[data-sort]')) state.sort = e.target.value;
    render();
  });
  requestAnimationFrame(render);
}

/* ================================================================= COLLECTION */
export async function collection(ctx, tag) {
  const c = COLLECTIONS[tag];
  if (!c) return notFound(ctx);
  const films = reg(await api.catalog());
  const list = byTag(films, tag);
  ctx.el.innerHTML = `<div class="view"><div class="container">
    <header class="page-head"><div><div class="eyebrow">Collection</div><h1 class="page-title">${esc(c.title)}</h1><p class="page-sub">${esc(c.sub)}.</p></div>
    ${list.length ? `<button class="btn btn--primary" data-play-random>${icon('shuffle')} Shuffle play</button>` : ''}</header>
    ${list.length ? `<h2 class="section-title">Curated</h2><div class="grid">${list.map((f) => posterCard(f)).join('')}</div>` : ''}
    <h2 class="section-title" style="margin-top:48px">More from the Vault</h2>
    <div data-vault><div class="grid grid--wide">${Array.from({ length: 8 }, () => '<div class="skel skel--wide"></div>').join('')}</div></div>
    <div style="display:flex;justify-content:center;margin-top:28px"><a class="btn btn--glass" href="/movies?tab=vault&g=${tag}">Explore all ${esc(c.title)} ${icon('right')}</a></div>
  </div>${footer()}</div>`;
  if (list[0]) setAmbient(list[0].poster);
  ctx.el.querySelector('[data-play-random]')?.addEventListener('click', () => {
    const f = list[Math.floor(Math.random() * list.length)];
    ctx.play(f);
  });
  const ids = new Set(list.map((f) => f.id));
  api.iaSearch({ collection: c.collection || 'feature_films', filter: c.ia, rows: 24 })
    .then(({ items }) => {
      if (!ctx.alive()) return;
      const rest = reg(items.filter((x) => !ids.has(x.id)));
      ctx.el.querySelector('[data-vault]').innerHTML = `<div class="grid grid--wide">${rest.map((f) => wideCard(f)).join('')}</div>`;
    })
    .catch(() => ctx.alive() && (ctx.el.querySelector('[data-vault]').innerHTML = ''));
}

/* ===================================================================== TITLE */
export async function title(ctx, id) {
  ctx.el.innerHTML = `<div class="view view--flush"><div class="container" style="padding-top:140px"><div class="detail__hero"><div class="skel skel--poster"></div><div><div class="skel skel--line" style="width:30%"></div><div class="skel" style="height:64px;margin:14px 0;width:70%"></div><div class="skel skel--line"></div><div class="skel skel--line" style="width:50%"></div></div></div></div></div>`;
  let item;
  try {
    item = await api.resolveTitle(id);
  } catch {
    return ctx.alive() && notFound(ctx);
  }
  if (!ctx.alive()) return;
  reg([item]);
  document.title = `${item.title} — Lumen`;
  const p = store.progress(item.key);
  const pct = p ? Math.round((p.t / p.d) * 100) : 0;
  const films = await api.catalog();
  const curated = item.source === 'catalog';
  const isEp = item.kind === 'episode';

  const facts = [
    item.director?.length && ['Directed by', item.director.map(esc).join(', ')],
    item.cast?.length && ['Starring', item.cast.slice(0, 5).map(esc).join(', ')],
    item.genres?.length && ['Genres', item.genres.map(esc).join(', ')],
    item.runtime && ['Runtime', fmtRuntime(item.runtime)],
    item.country?.length && ['Country', item.country.map(esc).join(', ')],
    item.language?.length && ['Language', item.language.map(esc).join(', ')],
    ['Rights', item.license
      ? `<a href="${esc(item.license)}" target="_blank" rel="noopener">Open license</a>`
      : curated ? 'Public domain (U.S.)' : `As listed on the <a href="https://archive.org/details/${encodeURIComponent(item.id)}" target="_blank" rel="noopener">Internet Archive</a>`],
    ['Streaming from', `<a href="https://archive.org/details/${encodeURIComponent(item.id)}" target="_blank" rel="noopener">Internet Archive</a>`],
  ].filter(Boolean);

  ctx.el.innerHTML = `<div class="view view--flush detail">
    <div class="detail__backdrop"><img src="${esc(item.posterHd || item.poster)}" alt=""></div>
    <div class="container">
      <div class="detail__hero">
        <div class="detail__poster" data-tilt><div class="tilt">${item.poster ? `<img src="${esc(item.poster)}" alt="${esc(item.title)} poster">` : `<div class="card__fallback">${esc(item.title)}</div>`}<div class="tilt__glare"></div></div></div>
        <div class="detail__info">
          <div class="eyebrow">${isEp ? 'Classic TV' : 'Film'} · <span style="color:#7ee2a0">Free to watch</span></div>
          <h1 class="detail__title">${esc(item.title)}</h1>
          ${item.tagline ? `<p class="detail__tagline">${esc(item.tagline)}</p>` : ''}
          <div class="chips">${metaLine(item, { max: 4 })}${item.rating ? `<span class="dot"></span>★ ${item.rating.toFixed(1)}` : ''}</div>
          <div class="detail__actions">
            ${item.playable ? `<button class="btn btn--primary" data-play="${esc(item.id)}">${icon('play')} ${p && pct < 95 ? `Resume · ${pct}%` : 'Play'}</button>` : `<span class="btn btn--glass" aria-disabled="true">Not streamable</span>`}
            ${listButton(item)}
            <button class="btn btn--glass btn--round" data-share aria-label="Share">${icon('share')}</button>
            ${p ? `<button class="btn btn--glass btn--round" data-reset aria-label="Remove from Continue Watching" title="Clear progress">${icon('trash')}</button>` : ''}
          </div>
        </div>
      </div>
      <div class="detail__body">
        <div>
          <h2 class="section-title">About</h2>
          <p class="prose">${esc(item.overview || 'No description available yet.')}</p>
          ${item.cast?.length ? `<h2 class="section-title" style="margin-top:32px">Cast</h2><div class="people">${item.cast.map((n) => `<span class="person"><span class="person__av">${esc(n.split(' ').map((w) => w[0]).slice(0, 2).join(''))}</span>${esc(n)}</span>`).join('')}</div>` : ''}
        </div>
        <aside class="panel glass">
          <dl class="facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
          <div class="links">
            ${item.imdb ? `<a class="btn btn--glass btn--sm" href="https://www.imdb.com/title/${esc(item.imdb)}/" target="_blank" rel="noopener">IMDb ${icon('external')}</a>` : ''}
            ${item.wiki ? `<a class="btn btn--glass btn--sm" href="${esc(item.wiki)}" target="_blank" rel="noopener">Wikipedia ${icon('external')}</a>` : ''}
            <a class="btn btn--glass btn--sm" href="https://archive.org/details/${encodeURIComponent(item.id)}" target="_blank" rel="noopener">Archive ${icon('external')}</a>
          </div>
        </aside>
      </div>
    </div>
    <div class="rows" style="margin-top:56px"><div data-slot="similar">${skeletonRow('More Like This')}</div></div>
    ${footer()}
  </div>`;
  if (item.thumbOnly) ctx.el.querySelector('.detail__backdrop').style.setProperty('--bd-blur', '60px');
  setAmbient(item.poster);
  wireTilt(ctx.el);

  ctx.el.querySelector('[data-share]').addEventListener('click', () => ctx.share(item));
  ctx.el.querySelector('[data-reset]')?.addEventListener('click', () => {
    store.clearProgress(item.key);
    ctx.refresh();
  });

  if (curated) {
    const sim = reg(similar(item, films));
    fill(ctx, '[data-slot="similar"]', sim.length ? row({ title: 'More Like This', cards: sim.map((f) => posterCard(f)).join('') }) : '');
  } else {
    const g = item.genres?.[0];
    api.iaSearch({ collection: isEp ? 'classic_tv' : 'feature_films', filter: g ? `subject:"${g.replace(/"/g, '')}"` : '', rows: 20 })
      .then(({ items }) => {
        const list = reg(items.filter((x) => x.id !== item.id));
        fill(ctx, '[data-slot="similar"]', list.length ? row({ title: 'More Like This', variant: 'wide', cards: list.map((f) => wideCard(f)).join('') }) : '');
      })
      .catch(() => fill(ctx, '[data-slot="similar"]', ''));
  }
}

/* ======================================================================== TV */
let showPool;
const pool = () => (showPool ??= api.popularShows().catch(() => []));

export async function tv(ctx) {
  ctx.el.innerHTML = `<div class="view"><div class="container"><header class="page-head"><div><div class="eyebrow">TV</div>
    <h1 class="page-title">What’s on, everywhere.</h1>
    <p class="page-sub">Live schedules, cast and where to watch for 70,000+ shows — plus classic TV episodes you can stream free right here.</p></div></header></div>
    <div class="rows">
      <div data-slot="tonight">${skeletonRow('Airing Tonight')}</div>
      <div data-slot="loved">${skeletonRow('Most Loved Shows')}</div>
      <div data-slot="classic" id="classic">${skeletonRow('Classic TV — Free to Stream', 6, true)}</div>
      <div data-slot="web">${skeletonRow('New on Streaming Today')}</div>
      <div data-slot="genres"></div>
    </div>${footer()}</div>`;

  api.airingTonight().then((s) => fill(ctx, '[data-slot="tonight"]', s.length ? row({ title: 'Airing Tonight', sub: `Broadcast in ${api.userCountry()}`, cards: reg(s.slice(0, 30)).map((x) => posterCard(x)).join('') }) : '')).catch(() => fill(ctx, '[data-slot="tonight"]', ''));
  api.streamingToday().then((s) => fill(ctx, '[data-slot="web"]', s.length ? row({ title: 'New on Streaming Today', cards: reg(s.slice(0, 30)).map((x) => posterCard(x)).join('') }) : '')).catch(() => fill(ctx, '[data-slot="web"]', ''));
  api.iaSearch({ collection: 'classic_tv', rows: 30 }).then(({ items }) => fill(ctx, '[data-slot="classic"]', `<div id="classic">${row({ title: 'Classic TV — Free to Stream', sub: 'Public-domain episodes from the Internet Archive', variant: 'wide', cards: reg(items).map((f) => wideCard(f)).join('') })}</div>`)).catch(() => fill(ctx, '[data-slot="classic"]', ''));

  const shows = reg(await pool());
  const loved = shows.filter((s) => s.weight >= 90).sort((a, b) => b.rating - a.rating).slice(0, 10);
  fill(ctx, '[data-slot="loved"]', row({ title: 'Most Loved Shows', variant: 'rank', cards: loved.map((s, i) => rankCard(s, i + 1)).join('') }));
  const genres = ['Drama', 'Comedy', 'Science-Fiction', 'Crime', 'Thriller', 'Fantasy', 'Action', 'Romance', 'Horror', 'Mystery'];
  fill(ctx, '[data-slot="genres"]', genres.map((g) => {
    const list = shows.filter((s) => s.genres.includes(g)).sort((a, b) => b.weight - a.weight || b.rating - a.rating).slice(0, 24);
    return list.length > 4 ? row({ title: g.replace('-', ' '), cards: list.map((s) => posterCard(s)).join('') }) : '';
  }).join('') || null);
  if (location.hash === '#classic') ctx.el.querySelector('#classic')?.scrollIntoView({ behavior: 'smooth' });
}

/* ====================================================================== SHOW */
export async function show(ctx, id) {
  ctx.el.innerHTML = `<div class="view view--flush"><div class="container" style="padding-top:140px"><div class="detail__hero"><div class="skel skel--poster"></div><div><div class="skel" style="height:64px;width:60%"></div><div class="skel skel--line"></div></div></div></div></div>`;
  let s;
  try {
    [s] = await Promise.all([api.showDetail(id)]);
  } catch {
    return ctx.alive() && notFound(ctx);
  }
  if (!ctx.alive()) return;
  reg([s]);
  document.title = `${s.title} — Lumen`;
  const backdrop = await api.showBackdrop(id);
  if (!ctx.alive()) return;
  const sched = s.schedule?.days?.length ? `${s.schedule.days.join(', ')}${s.schedule.time ? ' at ' + s.schedule.time : ''}` : '';
  const watchQ = encodeURIComponent(s.title);
  const facts = [
    s.network && [s.networkKind || 'Network', esc(s.network) + (s.country ? ` · ${esc(s.country)}` : '')],
    ['Status', esc(s.status) + (s.ended ? ` · ended ${esc(s.ended.slice(0, 4))}` : '')],
    sched && ['Schedule', esc(sched)],
    s.runtime && ['Episode length', fmtRuntime(s.runtime)],
    s.genres.length && ['Genres', s.genres.map(esc).join(', ')],
    s.language && ['Language', esc(s.language)],
  ].filter(Boolean);

  ctx.el.innerHTML = `<div class="view view--flush detail">
    <div class="detail__backdrop ${backdrop ? 'detail__backdrop--sharp' : ''}"><img src="${esc(backdrop || s.posterHd || s.poster || '')}" alt=""></div>
    <div class="container">
      <div class="detail__hero">
        <div class="detail__poster" data-tilt><div class="tilt">${s.poster ? `<img src="${esc(s.posterHd || s.poster)}" alt="${esc(s.title)} poster">` : `<div class="card__fallback">${esc(s.title)}</div>`}<div class="tilt__glare"></div></div></div>
        <div class="detail__info">
          <div class="eyebrow">TV Series${s.network ? ' · ' + esc(s.network) : ''}</div>
          <h1 class="detail__title">${esc(s.title)}</h1>
          <div class="chips">${metaLine(s, { max: 4 })}${s.rating ? `<span class="dot"></span><span style="color:var(--accent)">★</span>&nbsp;${s.rating.toFixed(1)}` : ''}${s.seasons.length ? `<span class="dot"></span>${s.seasons.length} season${s.seasons.length > 1 ? 's' : ''}` : ''}</div>
          <div class="detail__actions">
            <a class="btn btn--primary" href="https://www.justwatch.com/us/search?q=${watchQ}" target="_blank" rel="noopener">${icon('play')} Where to watch</a>
            ${listButton(s)}
            <button class="btn btn--glass btn--round" data-share aria-label="Share">${icon('share')}</button>
          </div>
        </div>
      </div>
      <div class="detail__body">
        <div>
          <h2 class="section-title">About</h2>
          <p class="prose">${esc(s.overview || 'No synopsis yet.')}</p>
          ${s.cast.length ? `<h2 class="section-title" style="margin-top:36px">Cast</h2><div class="cast">${s.cast.map((c) => `<div class="cast__item"><div class="cast__img">${c.image ? `<img src="${esc(c.image.replace('http://', 'https://'))}" alt="" loading="lazy">` : ''}</div><div class="cast__name">${esc(c.name)}</div><div class="cast__role">${esc(c.role || '')}</div></div>`).join('')}</div>` : ''}
          ${s.seasons.length ? `<h2 class="section-title" style="margin-top:36px">Episodes</h2>
            <div class="pills" data-seasons style="margin-bottom:12px">${s.seasons.map((x, i) => `<button class="pill ${i === s.seasons.length - 1 ? 'is-active' : ''}" data-season="${x.id}">Season ${x.number}</button>`).join('')}</div>
            <div class="episodes" data-episodes></div>` : ''}
        </div>
        <aside style="display:grid;gap:14px;align-content:start">
          ${s.next ? `<div class="panel glass"><div class="eyebrow">Next episode</div><div style="font-weight:650;margin-top:6px">S${s.next.season} · E${s.next.number ?? '–'} — ${esc(s.next.name)}</div>
            <div class="countdown" data-countdown="${esc(s.next.airstamp)}"></div></div>` : ''}
          <div class="panel glass">
            <div class="eyebrow" style="margin-bottom:12px">Where to watch</div>
            ${s.network ? `<a class="watch-card" href="${esc(s.officialSite || `https://www.google.com/search?q=${watchQ}+watch`)}" target="_blank" rel="noopener"><span class="watch-card__logo">${esc(s.network[0])}</span><span><strong>${esc(s.network)}</strong><small>${esc(s.networkKind || '')} · official</small></span></a>` : ''}
            <a class="watch-card" style="margin-top:10px" href="https://www.justwatch.com/us/search?q=${watchQ}" target="_blank" rel="noopener"><span class="watch-card__logo">${icon('globe')}</span><span><strong>All streaming options</strong><small>Compare services on JustWatch</small></span></a>
          </div>
          <div class="panel glass"><dl class="facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
            <div class="links">${s.imdb ? `<a class="btn btn--glass btn--sm" href="https://www.imdb.com/title/${esc(s.imdb)}/" target="_blank" rel="noopener">IMDb ${icon('external')}</a>` : ''}<a class="btn btn--glass btn--sm" href="https://www.tvmaze.com/shows/${s.id}" target="_blank" rel="noopener">TVMaze ${icon('external')}</a></div>
          </div>
        </aside>
      </div>
    </div>
    <div class="rows" style="margin-top:56px"><div data-slot="similar"></div></div>
    ${footer()}
  </div>`;
  setAmbient(s.poster);
  wireTilt(ctx.el);
  ctx.el.querySelector('[data-share]').addEventListener('click', () => ctx.share(s));

  // countdown
  const cd = ctx.el.querySelector('[data-countdown]');
  if (cd) {
    const target = new Date(cd.dataset.countdown).getTime();
    const tick = () => {
      if (!ctx.alive()) return clearInterval(t);
      let d = Math.max(0, target - Date.now()) / 1000;
      const parts = [['days', 86400], ['hrs', 3600], ['min', 60], ['sec', 1]].map(([l, n]) => { const v = Math.floor(d / n); d -= v * n; return `<div><b>${v}</b><span>${l}</span></div>`; });
      cd.innerHTML = parts.join('');
    };
    const t = setInterval(tick, 1000);
    tick();
  }

  // episodes
  const epBox = ctx.el.querySelector('[data-episodes]');
  const loadSeason = async (sid) => {
    epBox.innerHTML = Array.from({ length: 3 }, () => '<div class="skel" style="height:110px"></div>').join('');
    const eps = await api.seasonEpisodes(sid).catch(() => []);
    if (!ctx.alive()) return;
    epBox.innerHTML = eps.length ? eps.map((e) => `<div class="ep">
      <div class="ep__img">${e.image ? `<img src="${esc(e.image.medium.replace('http://', 'https://'))}" alt="" loading="lazy">` : ''}</div>
      <div><div class="ep__num">EPISODE ${e.number ?? 'SPECIAL'}${e.airdate ? ' · ' + new Date(e.airdate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''}${e.rating?.average ? ` · ★ ${e.rating.average}` : ''}</div>
      <div class="ep__title">${esc(e.name)}</div><p class="ep__text">${esc(api.stripHtml(e.summary || ''))}</p></div></div>`).join('') : '<p class="page-sub">No episode guide yet.</p>';
  };
  if (epBox) {
    loadSeason(s.seasons[s.seasons.length - 1].id);
    ctx.el.querySelector('[data-seasons]').addEventListener('click', (e) => {
      const b = e.target.closest('[data-season]');
      if (!b) return;
      ctx.el.querySelectorAll('[data-season]').forEach((x) => x.classList.toggle('is-active', x === b));
      loadSeason(b.dataset.season);
    });
    const active = ctx.el.querySelector('[data-season].is-active');
    active?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }

  const sim = reg(await api.similarShows(s, await pool()));
  fill(ctx, '[data-slot="similar"]', sim.length ? row({ title: 'You Might Also Like', cards: sim.map((x) => posterCard(x)).join('') }) : '');
}

/* =================================================================== MY LIST */
export async function myList(ctx) {
  const list = reg(store.list());
  const cw = store.continueWatching();
  cw.forEach((p) => reg([p.item]));
  const st = store.stats();
  const max = Math.max(...st.last7.map((d) => d.sec), 60);
  const niceMax = Math.ceil(max / 60 / 10) * 10 || 10; // minutes, rounded up to 10
  const fmtDay = (d) => d.toLocaleDateString(undefined, { weekday: 'short' });
  const fmtLong = (d) => d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

  ctx.el.innerHTML = `<div class="view"><div class="container">
    <header class="page-head"><div><div class="eyebrow">My Lumen</div><h1 class="page-title">Your screening room.</h1>
      <p class="page-sub">Saved titles, progress and viewing stats live privately in this browser.</p></div></header>

    <section class="stats" aria-label="Viewing stats">
      <div class="stat glass"><div class="stat__label">Watch time</div><div class="stat__value">${fmtHours(st.totalSec)}</div><div class="stat__note">all time</div></div>
      <div class="stat glass"><div class="stat__label">Titles started</div><div class="stat__value">${st.started}</div><div class="stat__note">${st.finished} finished</div></div>
      <div class="stat glass"><div class="stat__label">Day streak</div><div class="stat__value">${st.streak}</div><div class="stat__note">${st.streak ? 'keep it going' : 'watch a minute to start'}</div></div>
      <div class="stat glass"><div class="stat__label">Top genre</div><div class="stat__value" style="font-size:clamp(22px,2.4vw,30px)">${esc(st.topGenre || '—')}</div><div class="stat__note">by minutes watched</div></div>
    </section>

    <figure class="chart glass" style="margin:14px 0 0">
      <figcaption class="chart__head"><span class="chart__title">Minutes watched, last 7 days</span><span class="chart__sub">${Math.round(st.last7.reduce((a, d) => a + d.sec, 0) / 60)} min total</span></figcaption>
      <div class="bars" role="list">
        <div class="bars__grid" aria-hidden="true">${[1, 0.5].map((f) => `<span style="top:${(1 - f) * 100}%"><em style="font-style:normal;position:relative;top:-16px">${Math.round(niceMax * f)}m</em></span>`).join('')}</div>
        ${st.last7.map((d) => {
          const m = Math.round(d.sec / 60);
          return `<div class="bar" role="listitem" tabindex="0" style="--h:${Math.max(0, (m / niceMax) * 100)}%" aria-label="${esc(fmtLong(d.date))}: ${m} minutes">
            <i></i><b>${esc(fmtDay(d.date))}</b><span class="bar__tip"><strong>${m} min</strong> · ${esc(fmtLong(d.date))}</span></div>`;
        }).join('')}
      </div>
    </figure>
  </div>

  <div class="rows" style="margin-top:48px">
    ${cw.length ? row({ title: 'Continue Watching', variant: 'wide', cards: cw.map((p) => wideCard(p.item, p)).join('') }) : ''}
    <div class="container">
      <h2 class="section-title">Saved</h2>
      ${list.length
        ? `<div class="grid">${list.map((x) => posterCard({ ...x, playable: x.kind !== 'show' })).join('')}</div>`
        : emptyState({ iconName: 'bookmark', title: 'Nothing saved yet', text: 'Tap + on any film or show to keep it here for later.', action: '<a class="btn btn--primary" href="/movies">Browse movies</a>' })}
    </div>
  </div>${footer()}</div>`;
  wireRows(ctx.el);
}

/* ================================================================== 404 */
export function notFound(ctx) {
  ctx.el.innerHTML = `<div class="view"><div class="container" style="max-width:640px;padding-top:8vh">
    ${emptyState({ iconName: 'film', title: 'This reel is missing', text: 'The page you’re looking for isn’t here. It may have moved, or the source is temporarily unavailable.', action: '<a class="btn btn--primary" href="/">Back to Home</a>' })}
  </div></div>`;
}
