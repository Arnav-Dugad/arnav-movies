// Core page views: home, movies, collections, title detail, My List, 404.
// Each view renders what it can synchronously, then streams live rows in.
import * as api from './api.js';
import { store } from './store.js';
import {
  esc, icon, posterCard, wideCard, rankCard, row, skeletonRow, wireRows, wireTilt, listButton,
  metaLine, fmtRuntime, fmtHours, setAmbient, emptyState, footer, ratingBadges, openTrailer, ytEmbed, kenBurns,
} from './ui.js';
import { similar, recommend, becauseYouWatched, becauseYouLikedActor, lumenPicks, dailyShuffle, hoursUntilMidnight } from './recs.js';
import { currentSeason, applySeason, daysUntil, particles } from './seasons.js';

/* Item registry so global click handlers (play, My List) can find the full item for a card. */
export const registry = new Map();
export const reg = (list) => (list.forEach((x) => x && registry.set(x.key, x)), list);

/* ---------------------------------------------------------------- collections */
const any = (...tags) => (f) => tags.some((t) => f.tags.includes(t));
const all = (...tags) => (f) => tags.every((t) => f.tags.includes(t));

export const COLLECTIONS = {
  horror: { title: 'Midnight Horror', sub: 'Vampires, ghouls and haunted halls', tile: 'linear-gradient(135deg,#43061d,#b3123d)', ia: 'subject:horror' },
  noir: { title: 'Film Noir', sub: 'Shadows, sin and cigarette smoke', tile: 'linear-gradient(135deg,#0f0f12,#5b5f6b)', ia: 'subject:(noir OR "film noir")' },
  hitchcock: { title: 'Hitchcock', sub: 'The master of suspense', tile: 'linear-gradient(135deg,#1d2b64,#a33b5b)', ia: 'creator:hitchcock OR subject:hitchcock OR title:hitchcock' },
  clowns: { title: 'Silent Clowns', sub: 'Chaplin, Keaton and Lloyd', tile: 'linear-gradient(135deg,#2c3e50,#bdc3c7)', match: any('chaplin', 'keaton', 'lloyd'), ia: 'creator:(chaplin OR keaton OR lloyd) OR title:(chaplin OR keaton)' },
  silent: { title: 'The Silent Era', sub: 'Where cinema learned to dream', tile: 'linear-gradient(135deg,#5e4b2d,#c2a36b)', ia: '', collection: 'silent_films' },
  silentshorts: { title: 'Silent Shorts', sub: 'Big laughs in two reels', tile: 'linear-gradient(135deg,#6b5b3e,#e0c58f)', match: all('silent', 'short'), ia: 'collection:short_films', collection: 'silent_films' },
  cartoons: { title: 'Classic Cartoons', sub: 'Fleischer, Popeye and pre-war ink', tile: 'linear-gradient(135deg,#11998e,#38ef7d)', match: all('animation', 'short'), ia: '', collection: 'classic_cartoons' },
  scifi: { title: 'Retro Sci-Fi', sub: 'Saucers, robots and moon shots', tile: 'linear-gradient(135deg,#0b486b,#3bb2b8)', ia: 'subject:("science fiction" OR sci-fi OR scifi)' },
  cult: { title: 'Cult Classics', sub: 'So strange they became legends', tile: 'linear-gradient(135deg,#4a00e0,#e05297)', ia: 'subject:(cult OR "b-movie" OR exploitation)' },
  comedy: { title: 'Screwball & Slapstick', sub: 'Pratfalls and rapid-fire wit', tile: 'linear-gradient(135deg,#f7971e,#d4145a)', ia: 'subject:comedy' },
  thriller: { title: 'Thrillers', sub: 'Edge-of-your-seat suspense', tile: 'linear-gradient(135deg,#232526,#8e2de2)', ia: 'subject:(thriller OR suspense OR mystery)' },
  crime: { title: 'Crime & Gangsters', sub: 'Heists, hoods and hard-boiled cops', tile: 'linear-gradient(135deg,#1e130c,#9a8478)', ia: 'subject:(crime OR gangster)' },
  romance: { title: 'Golden-Age Romance', sub: 'Swoon-worthy classics', tile: 'linear-gradient(135deg,#8e2b4f,#ff8fa3)', ia: 'subject:romance' },
  drama: { title: 'Timeless Drama', sub: 'Stories that still hit', tile: 'linear-gradient(135deg,#3a3a52,#7f6a93)', ia: 'subject:drama' },
  western: { title: 'Westerns', sub: 'Dust, duels and open skies', tile: 'linear-gradient(135deg,#7b4397,#dc8743)', ia: 'subject:western' },
  war: { title: 'War Stories', sub: 'Courage under fire', tile: 'linear-gradient(135deg,#3c3b3f,#605c3c)', ia: 'subject:war' },
  adventure: { title: 'Adventure', sub: 'Swashbucklers and lost worlds', tile: 'linear-gradient(135deg,#0f2027,#2c5364)', ia: 'subject:adventure' },
  fantasy: { title: 'Fantasy', sub: 'Magic, myth and monsters', tile: 'linear-gradient(135deg,#41295a,#2f0743)', ia: 'subject:fantasy' },
  musical: { title: 'Musicals', sub: 'Song, dance and spectacle', tile: 'linear-gradient(135deg,#c94b4b,#4b134f)', ia: 'subject:musical' },
  family: { title: 'Family Night', sub: 'Something for everyone', tile: 'linear-gradient(135deg,#56ab2f,#a8e063)', ia: 'subject:family' },
  documentary: { title: 'Documentaries', sub: 'History on film', tile: 'linear-gradient(135deg,#283c86,#45a247)', ia: 'subject:documentary' },
  capra: { title: 'Frank Capra', sub: 'Big-hearted Americana', tile: 'linear-gradient(135deg,#355c7d,#c06c84)', ia: 'creator:capra' },
  welles: { title: 'Orson Welles', sub: 'The boy wonder', tile: 'linear-gradient(135deg,#232526,#414345)', ia: 'creator:welles' },
  chaplin: { title: 'Charlie Chaplin', sub: 'The Little Tramp, from Keystone to Mutual', tile: 'linear-gradient(135deg,#1f1c18,#8e6f4a)', ia: 'creator:chaplin OR title:chaplin', collection: 'silent_films OR feature_films' },
  keaton: { title: 'Buster Keaton', sub: 'The Great Stone Face and his impossible stunts', tile: 'linear-gradient(135deg,#283048,#859398)', ia: 'creator:keaton OR title:keaton', collection: 'silent_films OR feature_films' },
  lloyd: { title: 'Harold Lloyd', sub: 'The glasses, the clock, the thrill comedies', tile: 'linear-gradient(135deg,#3e2723,#bcaaa4)', ia: 'creator:lloyd OR title:"harold lloyd"', collection: 'silent_films OR feature_films' },
  halloween: { title: 'Halloween Frights', sub: 'Ghosts, witches and things that go bump', tile: 'linear-gradient(135deg,#ff7a1a,#3b0a45)', match: any('halloween', 'horror'), ia: 'subject:(horror OR halloween OR ghost)' },
  christmas: { title: 'Holiday Classics', sub: 'Cosy, festive and free', tile: 'linear-gradient(135deg,#b31217,#1e5631)', match: any('christmas'), ia: 'subject:(christmas OR holiday)' },
};

const MOODS = [
  { tag: 'shorts', label: 'Shorts', c: '#ffb340', href: '/shorts' },
  { tag: 'horror', label: 'Spooky', c: '#b3123d' },
  { tag: 'comedy', label: 'Make me laugh', c: '#f7971e' },
  { tag: 'thriller', label: 'Edge of my seat', c: '#8e2de2' },
  { tag: 'romance', label: 'Romantic', c: '#ff8fa3' },
  { tag: 'scifi', label: 'Mind-bending', c: '#3bb2b8' },
  { tag: 'noir', label: 'Moody & dark', c: '#8a8f9c' },
  { tag: 'cartoons', label: 'Cartoons', c: '#38ef7d' },
  { tag: 'silent', label: 'Silent magic', c: '#c2a36b' },
];

export const byTag = (films, tag) => {
  const c = COLLECTIONS[tag];
  return films.filter(c?.match || ((f) => f.tags.includes(tag)));
};

function timeContext() {
  const h = new Date().getHours();
  if (h >= 21 || h < 5) return { greet: 'Late-night pick', boost: ['horror', 'noir', 'thriller'] };
  if (h >= 17) return { greet: 'Tonight’s pick', boost: ['noir', 'thriller', 'romance', 'drama'] };
  if (h >= 12) return { greet: 'Afternoon matinée', boost: ['comedy', 'clowns', 'musical', 'western'] };
  return { greet: 'Morning reel', boost: ['comedy', 'silent', 'family', 'animation'] };
}

/** Replace a placeholder with HTML while the view is still current. */
export function fill(ctx, sel, html) {
  if (!ctx.alive()) return;
  const slot = ctx.el.querySelector(sel);
  if (!slot) return;
  if (!html) return slot.remove();
  slot.outerHTML = html;
  wireRows(ctx.el);
}

/** Render a long grid in chunks as the viewer scrolls. */
export function chunkedGrid(ctx, container, list, render, { size = 48, cls = 'grid' } = {}) {
  container.innerHTML = `<div class="${cls}"></div><div class="load-more" aria-hidden="true"></div>`;
  const grid = container.firstElementChild;
  const sentinel = container.lastElementChild;
  let i = 0;
  const io = new IntersectionObserver((e) => e[0].isIntersecting && more(), { rootMargin: '1400px' });
  const more = () => {
    grid.insertAdjacentHTML('beforeend', list.slice(i, i + size).map(render).join(''));
    i += size;
    if (i >= list.length) {
      io.disconnect();
      sentinel.remove();
    }
  };
  more();
  if (i < list.length) io.observe(sentinel);
  ctx.onLeave(() => io.disconnect());
}

const tileHtml = (tag, films) => {
  const c = COLLECTIONS[tag];
  const cover = byTag(films, tag)[0];
  return `<a class="tile" href="/collection/${tag}" style="--tile:${c.tile}">
    ${cover ? `<div class="tile__img"><img src="${esc(cover.poster)}" alt="" loading="lazy"></div>` : ''}
    <strong>${esc(c.title)}</strong><span>${esc(c.sub)}</span></a>`;
};

const titleArt = (item, cls) =>
  item.logo ? `<img class="${cls}" src="${esc(item.logo)}" alt="${esc(item.title)}" fetchpriority="high">` : esc(item.title);

/* ======================================================================= HOME */
export async function home(ctx) {
  const films = reg(await api.catalog());
  const { greet, boost } = timeContext();
  const features = films.filter((f) => !f.tags.includes('short'));
  const score = (f) => (f.backdrop && f.logo ? 2 : 0) + boost.filter((t) => f.tags.includes(t)).length;
  const ranked = dailyShuffle(features.slice(0, 120), 'hero').sort((a, b) => score(b) - score(a));
  const season = currentSeason();
  applySeason(season);
  ctx.onLeave(() => applySeason(null));
  const seasonal = season ? films.filter((f) => !f.tags.includes('short') && season.tags.some((t) => f.tags.includes(t))) : [];
  const heroPool = season && seasonal.length >= 6 ? dailyShuffle(seasonal.filter((f) => f.backdrop && f.overview), season.id).concat(ranked) : ranked;
  const heroItems = [...new Map(heroPool.filter((f) => (f.backdrop || f.posterHd) && f.overview).map((f) => [f.key, f])).values()].slice(0, 6);
  const cw = store.continueWatching();
  const picks = lumenPicks(films);
  const because = becauseYouWatched(films);
  const forYou = recommend(films);
  const actorRow = becauseYouLikedActor(films);
  const top10 = features.slice(0, 10);
  const r = (tag, title = COLLECTIONS[tag].title) => {
    const list = byTag(films, tag);
    return list.length >= 4 ? row({ title, more: `/collection/${tag}`, cards: list.slice(0, 24).map((f) => posterCard(f)).join('') }) : '';
  };

  ctx.el.innerHTML = `<div class="view view--flush">
    ${hero(heroItems, season ? season.eyebrow : greet)}
    <div class="rows">
      <div class="container"><div class="moods" role="list">
        <button class="mood mood--surprise" data-surprise role="listitem"><i>${icon('shuffle')}</i>Surprise me</button>
        ${MOODS.map((m) => `<a class="mood glass" href="${m.href || '/collection/' + m.tag}" role="listitem"><i style="background:${m.c}33;color:${m.c}">●</i>${esc(m.label)}</a>`).join('')}
      </div></div>
      ${season && seasonal.length >= 6 ? row({ title: season.title, sub: (() => { const d = daysUntil(season); return d > 0 ? `${d} day${d > 1 ? 's' : ''} to ${season.countdownLabel} · ${season.sub}` : d === 0 ? `Happy ${season.countdownLabel}!` : season.sub; })(), more: `/collection/${season.id === 'holidays' ? 'christmas' : season.id === 'valentines' ? 'romance' : 'halloween'}`, variant: 'wide', cards: dailyShuffle(seasonal, season.id).slice(0, 24).map((f) => wideCard(f)).join('') }) : ''}
      ${cw.length ? row({ title: 'Continue Watching', variant: 'wide', cards: cw.map((p) => wideCard(reg([registry.get(p.item.key) || p.item])[0], p)).join('') }) : ''}
      ${row({ title: 'Lumen Picks', sub: `Tonight’s selection · refreshes in ${hoursUntilMidnight()}h`, variant: 'wide', cards: picks.map((f) => wideCard(f)).join('') })}
      ${because.map((b) => row({ title: `Because you watched ${b.seed.title}`, cards: b.items.map((f) => posterCard(f)).join('') })).join('')}
      ${actorRow ? row({ title: `Because you liked ${actorRow.actor.name}`, sub: 'More with them, free', more: actorRow.actor.qid ? `/person/${actorRow.actor.qid}` : '', cards: actorRow.items.map((f) => posterCard(f)).join('') }) : ''}
      ${forYou?.length ? row({ title: 'For You', sub: 'Based on what you watch and save', cards: forYou.map((f) => posterCard(f)).join('') }) : ''}
      ${row({ title: 'Top 10 Free Classics', variant: 'rank', cards: top10.map((f, i) => rankCard(f, i + 1)).join('') })}
      ${row({ title: 'Browse Collections', variant: 'tiles', cards: Object.keys(COLLECTIONS).filter((t) => byTag(films, t).length >= 3).map((t) => tileHtml(t, films)).join('') })}
      <div data-slot="tonight">${skeletonRow('Airing Tonight')}</div>
      ${r('horror')}
      <div data-slot="cartoons">${skeletonRow('Classic Cartoons', 6, true)}</div>
      ${r('hitchcock', 'Hitchcock in the Public Domain')}
      <div data-slot="vault">${skeletonRow('Most Streamed in the Vault', 6, true)}</div>
      ${r('noir')}
      ${r('chaplin', 'Charlie Chaplin')}
      ${r('keaton', 'Buster Keaton')}
      <div data-slot="anime">${skeletonRow('Trending Anime')}</div>
      ${r('silentshorts')}
      <div data-slot="series">${skeletonRow('Classic TV Series — Free')}</div>
      ${r('cult', 'Cult Classics')}
      ${r('scifi')}
      <div data-slot="streaming">${skeletonRow('New on Streaming Today')}</div>
      ${r('comedy', 'Laugh Out Loud')}
      ${r('western')}
      ${r('war')}
      ${r('musical')}
    </div>
    ${footer()}
  </div>`;
  wireRows(ctx.el);
  wireHero(ctx);
  if (season) ctx.onLeave(particles(ctx.el.querySelector('.hero'), season.particles));

  api.airingTonight().then((shows) =>
    fill(ctx, '[data-slot="tonight"]', shows.length ? row({ title: 'Airing Tonight', sub: `${new Date().toLocaleDateString(undefined, { weekday: 'long' })} · ${api.countryName(shows.country)}`, more: '/tv', cards: reg(shows.slice(0, 24)).map((s) => posterCard(s)).join('') }) : '')
  ).catch(() => fill(ctx, '[data-slot="tonight"]', ''));

  const toons = byTag(films, 'cartoons');
  (toons.length >= 6 ? Promise.resolve({ items: toons }) : api.iaSearch({ collection: 'classic_cartoons', rows: 24 })).then(({ items }) =>
    fill(ctx, '[data-slot="cartoons"]', row({ title: 'Classic Cartoons', sub: 'Fleischer, Popeye and pre-war ink', more: '/collection/cartoons', variant: 'wide', cards: reg(items.slice(0, 24)).map((f) => wideCard(f)).join('') }))
  ).catch(() => fill(ctx, '[data-slot="cartoons"]', ''));

  api.iaSearch({ rows: 24 }).then(({ items }) =>
    fill(ctx, '[data-slot="vault"]', row({ title: 'Most Streamed in the Vault', sub: '28,000+ films on the Internet Archive', more: '/movies?tab=vault', variant: 'wide', cards: reg(items).map((f) => wideCard(f)).join('') }))
  ).catch(() => fill(ctx, '[data-slot="vault"]', ''));

  api.animeRows().then(({ trending }) =>
    fill(ctx, '[data-slot="anime"]', row({ title: 'Trending Anime', sub: 'From AniList', more: '/tv#anime', cards: reg(trending).map((a) => posterCard(a)).join('') }))
  ).catch(() => fill(ctx, '[data-slot="anime"]', ''));

  api.iaSearch({ collection: 'classic_tv', rows: 24 }).then(({ items }) =>
    fill(ctx, '[data-slot="classictv"]', row({ title: 'Classic TV — Free', sub: 'Vintage episodes, ready to stream', more: '/tv#classic', variant: 'wide', cards: reg(items).map((f) => wideCard(f)).join('') }))
  ).catch(() => fill(ctx, '[data-slot="classictv"]', ''));

  api.series().then((list) =>
    fill(ctx, '[data-slot="series"]', list.length ? row({ title: 'Classic TV Series — Free', sub: 'Whole seasons, in order', more: '/tv#series', cards: reg(list).map((s) => posterCard({ ...s, playable: false })).join('') }) : '')
  );

  api.streamingToday().then((shows) =>
    fill(ctx, '[data-slot="streaming"]', shows.length ? row({ title: 'New on Streaming Today', sub: 'Episodes dropping on Netflix, Prime, Disney+ and more', more: '/tv', cards: reg(shows.slice(0, 24)).map((s) => posterCard(s)).join('') }) : '')
  ).catch(() => fill(ctx, '[data-slot="streaming"]', ''));
}

function hero(items, greet) {
  return `<section class="hero" aria-roledescription="carousel" aria-label="Featured">
    <div class="hero__slides">
    ${items.map((f, i) => {
      const wide = !!f.backdrop;
      return `<article class="hero__slide ${wide ? 'hero__slide--wide' : ''} ${i === 0 ? 'is-active' : ''}" data-i="${i}" aria-hidden="${i !== 0}" data-src="${esc(f.poster)}" ${f.trailer ? `data-trailer="${esc(f.trailer)}"` : ''}>
      <div class="hero__bg"><img src="${esc(f.backdrop || f.posterHd)}" alt="" ${i === 0 ? 'fetchpriority="high"' : 'loading="lazy"'}></div>
      <div class="hero__video" aria-hidden="true"></div>
      <div class="container hero__inner">
        <div class="hero__content">
          <div class="hero__eyebrow">${icon('sparkles')} ${esc(greet)} · Free &amp; public domain</div>
          <h1 class="hero__title ${f.logo ? 'has-logo' : ''}">${titleArt(f, 'hero__logo')}</h1>
          <div class="chips">${ratingBadges(f.rating, { small: true })}${metaLine(f, { max: 3 })}${f.director[0] ? `<span class="dot"></span>${esc(f.director[0])}` : ''}</div>
          <p class="hero__overview">${esc(f.overview)}</p>
          <div class="hero__actions">
            <button class="btn btn--primary" data-play="${esc(f.id)}">${icon('play')} ${store.progress(f.key) ? 'Resume' : 'Play'}</button>
            ${f.trailer ? `<button class="btn btn--glass btn--trailer" data-trailer-open="${esc(f.trailer)}" data-title="${esc(f.title)}" aria-label="Trailer">${icon('trailer')} <span class="btn__label">Trailer</span></button>` : ''}
            <a class="btn btn--glass btn--round" href="${esc(f.href)}" aria-label="Details">${icon('info')}</a>
            ${listButton(f)}
          </div>
        </div>
        ${wide ? '' : `<div class="hero__poster" data-tilt><div class="tilt"><img src="${esc(f.posterHd)}" alt="${esc(f.title)} poster" ${i === 0 ? '' : 'loading="lazy"'}><div class="tilt__glare"></div></div></div>`}
      </div>
    </article>`;
    }).join('')}
    </div>
    <button class="hero__mute glass" data-hero-mute hidden aria-label="Unmute trailer">${icon('mute')}</button>
    <div class="hero__dots" role="tablist">${items.map((f, i) => `<button class="hero__dot ${i === 0 ? 'is-active' : ''}" data-go="${i}" role="tab" aria-label="Show ${esc(f.title)}"><i></i></button>`).join('')}</div>
    <div class="hero__arrows"><button class="btn btn--glass btn--round btn--sm" data-step="-1" aria-label="Previous">${icon('left')}</button><button class="btn btn--glass btn--round btn--sm" data-step="1" aria-label="Next">${icon('right')}</button></div>
  </section>`;
}

function wireHero(ctx) {
  const heroEl = ctx.el.querySelector('.hero');
  if (!heroEl) return;
  const slides = [...heroEl.querySelectorAll('.hero__slide')];
  if (!slides.length) return heroEl.remove();
  const dots = [...heroEl.querySelectorAll('.hero__dot')];
  const muteBtn = heroEl.querySelector('[data-hero-mute]');
  const DUR = 9000;
  heroEl.style.setProperty('--dur', DUR + 'ms');
  let i = 0, timer, remaining = DUR, started = Date.now(), trailerTimer, trailerOn = false, muted = true;

  const stopTrailer = () => {
    clearTimeout(trailerTimer);
    trailerOn = false;
    muteBtn.hidden = true;
    heroEl.classList.remove('is-trailer');
    slides.forEach((s) => {
      const box = s.querySelector('.hero__video');
      if (box.firstChild) setTimeout(() => !trailerOn && (box.innerHTML = ''), 600);
    });
  };
  const startTrailer = () => {
    const slide = slides[i];
    const key = slide.dataset.trailer;
    if (!key || !ctx.alive() || document.querySelector('.player, .modal')) return;
    const box = slide.querySelector('.hero__video');
    muted = true;
    box.innerHTML = `<iframe src="${esc(ytEmbed(key, { muted: true, controls: false }))}&enablejsapi=1" allow="autoplay; encrypted-media" tabindex="-1" title=""></iframe>`;
    trailerOn = true;
    // Give YouTube a moment to get past its loading UI before fading in.
    setTimeout(() => trailerOn && heroEl.classList.add('is-trailer'), 1800);
    muteBtn.hidden = false;
    muteBtn.innerHTML = icon('mute');
  };

  const show = (n) => {
    stopTrailer();
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
    if (heroEl.classList.contains('is-paused')) trailerTimer = setTimeout(startTrailer, 1400);
    else schedule();
  };
  const schedule = () => {
    clearTimeout(timer);
    started = Date.now();
    timer = setTimeout(() => ctx.alive() && show(i + 1), remaining);
  };
  heroEl.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    const step = e.target.closest('[data-step]');
    const tr = e.target.closest('[data-trailer-open]');
    if (go) show(+go.dataset.go);
    if (step) show(i + +step.dataset.step);
    if (tr) {
      stopTrailer();
      openTrailer(tr.dataset.trailerOpen, tr.dataset.title);
    }
    if (e.target.closest('[data-hero-mute]')) {
      muted = !muted;
      const frame = slides[i].querySelector('iframe');
      frame?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: muted ? 'mute' : 'unMute', args: [] }), '*');
      muteBtn.innerHTML = icon(muted ? 'mute' : 'volume');
      muteBtn.setAttribute('aria-label', muted ? 'Unmute trailer' : 'Mute trailer');
    }
  });
  heroEl.addEventListener('pointerenter', (e) => {
    if (e.pointerType !== 'mouse') return;
    heroEl.classList.add('is-paused');
    clearTimeout(timer);
    remaining -= Date.now() - started;
    trailerTimer = setTimeout(startTrailer, 1400);
  });
  heroEl.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'mouse') return;
    heroEl.classList.remove('is-paused');
    stopTrailer();
    schedule();
  });
  let x0 = null;
  heroEl.addEventListener('touchstart', (e) => (x0 = e.touches[0].clientX), { passive: true });
  heroEl.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 50) show(i + (dx < 0 ? 1 : -1));
    x0 = null;
  });
  const onVis = () => (document.hidden ? (clearTimeout(timer), stopTrailer()) : ctx.alive() && schedule());
  document.addEventListener('visibilitychange', onVis);
  ctx.onLeave(() => { clearTimeout(timer); stopTrailer(); document.removeEventListener('visibilitychange', onVis); });
  setAmbient(slides[0]?.dataset.src);
  schedule();
  wireTilt(heroEl);
}

/* ===================================================================== MOVIES */
const DECADES = ['1900', '1910', '1920', '1930', '1940', '1950', '1960', '1970'];
const SORTS = { downloads: 'Most popular', avg_rating: 'Highest rated', 'year-desc': 'Newest', 'year-asc': 'Oldest', title: 'A–Z' };

const sortCurated = (list, sort) => {
  const q = (f) => (f.rating?.rt != null ? f.rating.rt / 10 : f.rating?.tmdb || 0);
  const by = {
    downloads: null,
    avg_rating: (a, b) => q(b) - q(a),
    'year-desc': (a, b) => (b.year || 0) - (a.year || 0),
    'year-asc': (a, b) => (a.year || 9999) - (b.year || 9999),
    title: (a, b) => a.title.localeCompare(b.title),
  }[sort];
  return by ? list.slice().sort(by) : list;
};

export async function movies(ctx) {
  const films = reg(await api.catalog());
  const params = new URLSearchParams(location.search);
  const state = {
    tab: params.get('tab') === 'vault' ? 'vault' : 'curated',
    g: COLLECTIONS[params.get('g')] ? params.get('g') : '',
    d: params.get('d') || '',
    sort: SORTS[params.get('sort')] ? params.get('sort') : 'downloads',
  };
  const tags = Object.keys(COLLECTIONS).filter((t) => byTag(films, t).length >= 3 || COLLECTIONS[t].collection);

  ctx.el.innerHTML = `<div class="view"><div class="container">
    <header class="page-head">
      <div><div class="eyebrow">Movies</div><h1 class="page-title">Free films, forever.</h1>
      <p class="page-sub">${films.length.toLocaleString()} verified public-domain films, plus the Internet Archive’s 28,000-film vault. No accounts, no ads, no catch.</p></div>
      <div class="segmented" data-seg><span class="segmented__thumb"></span>
        <button data-tab="curated">Curated</button><button data-tab="vault">The Vault</button></div>
    </header>
    <div class="pills" data-genres style="margin-bottom:14px">
      <button class="pill" data-g="">All</button>${tags.map((t) => `<button class="pill" data-g="${t}">${esc(COLLECTIONS[t].title)}</button>`).join('')}
    </div>
    <div data-filters style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:26px">
      <select class="select" data-d aria-label="Decade"><option value="">Any decade</option>${DECADES.map((d) => `<option value="${d}">${d}s</option>`).join('')}</select>
      <select class="select" data-sort aria-label="Sort">${Object.entries(SORTS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
      <span class="page-sub" data-count style="margin:0 0 0 6px;font-size:14px"></span>
    </div>
    <div data-results></div>
  </div>${footer()}</div>`;

  const out = ctx.el.querySelector('[data-results]');
  const seg = ctx.el.querySelector('[data-seg]');
  const filters = ctx.el.querySelector('[data-filters]');
  const count = ctx.el.querySelector('[data-count]');
  let io;

  const syncUrl = () => {
    const p = new URLSearchParams();
    if (state.tab === 'vault') p.set('tab', 'vault');
    if (state.g) p.set('g', state.g);
    if (state.d) p.set('d', state.d);
    if (state.sort !== 'downloads') p.set('sort', state.sort);
    history.replaceState(history.state, '', '/movies' + (p.toString() ? '?' + p : ''));
  };

  const paintControls = () => {
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === state.tab));
    const active = seg.querySelector('.is-active');
    const thumb = seg.querySelector('.segmented__thumb');
    thumb.style.width = active.offsetWidth + 'px';
    thumb.style.transform = `translateX(${active.offsetLeft - 4}px)`;
    ctx.el.querySelectorAll('[data-g]').forEach((b) => b.classList.toggle('is-active', b.dataset.g === state.g));
    filters.querySelector('[data-d]').value = state.d;
    filters.querySelector('[data-sort]').value = state.sort;
  };

  const renderCurated = () => {
    io?.disconnect();
    let list = state.g ? byTag(films, state.g) : films;
    if (state.d) list = list.filter((f) => f.year >= +state.d && f.year < +state.d + 10);
    list = sortCurated(list, state.sort);
    count.textContent = `${list.length.toLocaleString()} films`;
    if (!list.length) {
      out.innerHTML = emptyState({ title: 'Nothing curated here yet', text: 'Switch to The Vault to explore thousands more films with these filters.' });
      return;
    }
    chunkedGrid(ctx, out, list, (f) => posterCard(f));
  };

  const renderVault = () => {
    io?.disconnect();
    out.innerHTML = `<div class="grid grid--wide" data-grid></div><div class="load-more"><div class="spinner"></div></div>`;
    const grid = out.querySelector('[data-grid]');
    const sentinel = out.querySelector('.load-more');
    const c = COLLECTIONS[state.g];
    const filter = [c?.ia, state.d ? `year:[${state.d} TO ${+state.d + 9}]` : ''].filter(Boolean).join(' AND ');
    const sort = { downloads: 'downloads desc', avg_rating: 'avg_rating desc', 'year-desc': 'year desc', 'year-asc': 'year asc', title: 'titleSorter asc' }[state.sort];
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
        count.textContent = `${total.toLocaleString()} films`;
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
  filters.addEventListener('change', (e) => {
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
    <header class="page-head"><div><div class="eyebrow">Collection</div><h1 class="page-title">${esc(c.title)}</h1><p class="page-sub">${esc(c.sub)}. ${list.length ? `${list.length} curated film${list.length > 1 ? 's' : ''}.` : ''}</p></div>
    ${list.length ? `<button class="btn btn--primary" data-play-random>${icon('shuffle')} Shuffle play</button>` : ''}</header>
    ${list.length ? `<h2 class="section-title">Curated</h2><div data-curated></div>` : ''}
    <h2 class="section-title" style="margin-top:48px">More from the Vault</h2>
    <div data-vault><div class="grid grid--wide">${Array.from({ length: 8 }, () => '<div class="skel skel--wide"></div>').join('')}</div></div>
    <div style="display:flex;justify-content:center;margin-top:28px"><a class="btn btn--glass" href="/movies?tab=vault&g=${tag}">Explore all ${esc(c.title)} ${icon('right')}</a></div>
  </div>${footer()}</div>`;
  if (list[0]) setAmbient(list[0].poster);
  if (list.length) chunkedGrid(ctx, ctx.el.querySelector('[data-curated]'), list, (f) => posterCard(f));
  ctx.el.querySelector('[data-play-random]')?.addEventListener('click', () => ctx.play(list[Math.floor(Math.random() * list.length)]));
  const ids = new Set(list.map((f) => f.id));
  api.iaSearch({ collection: c.collection || 'feature_films', filter: c.ia, rows: 24 })
    .then(({ items }) => {
      if (!ctx.alive()) return;
      const rest = reg(items.filter((x) => !ids.has(x.id)));
      ctx.el.querySelector('[data-vault]').innerHTML = rest.length ? `<div class="grid grid--wide">${rest.map((f) => wideCard(f)).join('')}</div>` : '';
    })
    .catch(() => ctx.alive() && (ctx.el.querySelector('[data-vault]').innerHTML = ''));
}

/* ===================================================================== TITLE */
export const personLink = (p, cls = '') =>
  p.qid ? `<a class="${cls}" href="/person/${esc(p.qid)}">${esc(p.name)}</a>` : `<span class="${cls}">${esc(p.name)}</span>`;

export function castRow(people) {
  return `<div class="cast">${people.filter((c) => c.name).map((c) => {
    const inner = `<div class="cast__img">${c.photo ? `<img src="${esc(c.photo)}" alt="" loading="lazy">` : `<span>${esc(c.name.split(' ').map((w) => w[0]).slice(0, 2).join(''))}</span>`}</div>
      <div class="cast__name">${esc(c.name)}</div><div class="cast__role">${esc(c.role || '')}</div>`;
    return c.qid ? `<a class="cast__item" href="/person/${esc(c.qid)}">${inner}</a>` : `<div class="cast__item">${inner}</div>`;
  }).join('')}</div>`;
}

export function detailSkeleton() {
  return `<div class="view view--flush"><div class="container" style="padding-top:140px"><div class="detail__hero"><div class="skel skel--poster"></div><div><div class="skel skel--line" style="width:30%"></div><div class="skel" style="height:64px;margin:14px 0;width:70%"></div><div class="skel skel--line"></div><div class="skel skel--line" style="width:50%"></div></div></div></div></div>`;
}

export async function title(ctx, id) {
  ctx.el.innerHTML = detailSkeleton();
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
  const directors = item.directors?.length ? item.directors.map((d) => personLink({ name: d.n, qid: d.q })).join(', ') : (item.director || []).map(esc).join(', ');

  const rel = curated ? await api.releaseFor(item) : null;
  const relText = rel?.date ? `${new Date(rel.date + 'T00:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}${rel.local ? '' : ` · ${api.countryName(rel.country)}`}` : '';
  const facts = [
    directors && ['Directed by', directors],
    relText && ['Released', esc(relText)],
    rel?.cert && ['Certificate', `${esc(rel.cert)} <small style="color:var(--text-3)">(${esc(api.countryName(rel.country))})</small>`],
    item.genres?.length && ['Genres', item.genres.map(esc).join(', ')],
    item.runtime && ['Runtime', fmtRuntime(item.runtime)],
    item.country?.length && ['Country', item.country.map(esc).join(', ')],
    item.language?.length && ['Language', item.language.map(esc).join(', ')],
    ['Rights', item.license
      ? `<a href="${esc(item.license)}" target="_blank" rel="noopener">Open license</a>`
      : curated ? 'Public domain (U.S.), per Wikidata' : `As listed on the <a href="https://archive.org/details/${encodeURIComponent(item.id)}" target="_blank" rel="noopener">Internet Archive</a>`],
    ['Streaming from', `<a href="https://archive.org/details/${encodeURIComponent(item.id)}" target="_blank" rel="noopener">Internet Archive</a>`],
  ].filter(Boolean);

  const sameDirector = curated && item.director[0] ? films.filter((f) => f.key !== item.key && f.director.includes(item.director[0])) : [];

  ctx.el.innerHTML = `<div class="view view--flush detail">
    <div class="detail__backdrop ${item.backdrop ? 'detail__backdrop--sharp' : ''}"><img src="${esc(item.backdrop || item.posterHd || item.poster)}" alt=""></div>
    <div class="container">
      <div class="detail__hero">
        <div class="detail__poster" data-tilt><div class="tilt">${item.posterHd || item.poster ? `<img src="${esc(item.posterHd || item.poster)}" alt="${esc(item.title)} poster" data-morph data-launch-key="${esc(item.key)}">` : `<div class="card__fallback">${esc(item.title)}</div>`}<div class="tilt__glare"></div></div></div>
        <div class="detail__info">
          <div class="eyebrow">${isEp ? 'Classic TV' : 'Film'} · <span style="color:#7ee2a0">Free to watch</span></div>
          <h1 class="detail__title ${item.logo ? 'has-logo' : ''}">${titleArt(item, 'detail__logo')}</h1>
          ${item.tagline ? `<p class="detail__tagline">${esc(item.tagline)}</p>` : ''}
          <div class="chips">${rel?.cert ? `<span class="cert" title="Certificate in ${esc(api.countryName(rel.country))}">${esc(rel.cert)}</span>` : ''}${metaLine(item, { max: 4 })}</div>
          ${Object.keys(item.rating || {}).length ? `<div class="scores">${ratingBadges(item.rating)}</div>` : ''}
          <div class="detail__actions">
            ${item.playable ? `<button class="btn btn--primary" data-play="${esc(item.id)}">${icon('play')} ${p && pct < 95 ? `Resume · ${pct}%` : 'Play'}</button>` : `<span class="btn btn--glass" aria-disabled="true">Not streamable</span>`}
            ${item.trailer ? `<button class="btn btn--glass" data-trailer-open="${esc(item.trailer)}">${icon('trailer')} Trailer</button>` : ''}
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
          ${item.people?.length ? `<h2 class="section-title" style="margin-top:36px">Cast</h2>${castRow(item.people)}` : ''}
        </div>
        <aside class="panel glass">
          <dl class="facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
          <div class="links">
            ${item.imdb ? `<a class="btn btn--glass btn--sm" href="https://www.imdb.com/title/${esc(item.imdb)}/" target="_blank" rel="noopener">IMDb ${icon('external')}</a>` : ''}
            ${item.tmdb ? `<a class="btn btn--glass btn--sm" href="https://www.themoviedb.org/movie/${esc(item.tmdb)}" target="_blank" rel="noopener">TMDB ${icon('external')}</a>` : ''}
            ${item.wiki ? `<a class="btn btn--glass btn--sm" href="${esc(item.wiki)}" target="_blank" rel="noopener">Wikipedia ${icon('external')}</a>` : ''}
            <a class="btn btn--glass btn--sm" href="https://archive.org/details/${encodeURIComponent(item.id)}" target="_blank" rel="noopener">Archive ${icon('external')}</a>
          </div>
        </aside>
      </div>
    </div>
    <div class="rows" style="margin-top:56px">
      <div data-slot="similar">${skeletonRow('More Like This')}</div>
      ${sameDirector.length >= 2 ? row({ title: `More from ${item.director[0]}`, cards: reg(sameDirector).slice(0, 20).map((f) => posterCard(f)).join('') }) : ''}
    </div>
    ${footer()}
  </div>`;
  if (ctx.morph) ctx.el.querySelector('[data-morph]')?.style.setProperty('view-transition-name', 'poster-morph');
  setAmbient(item.poster);
  // No trailer? Let the backdrop breathe with a slow Ken Burns slideshow of stills.
  if (!item.trailer && item.slides?.length > 1) {
    const bd = ctx.el.querySelector('.detail__backdrop');
    bd.classList.add('detail__backdrop--sharp');
    ctx.onLeave(kenBurns(bd, item.slides));
  }
  wireTilt(ctx.el);
  wireRows(ctx.el);

  ctx.el.querySelector('[data-share]').addEventListener('click', () => ctx.share(item));
  ctx.el.querySelector('[data-trailer-open]')?.addEventListener('click', (e) => openTrailer(e.currentTarget.dataset.trailerOpen, item.title));
  ctx.el.querySelector('[data-reset]')?.addEventListener('click', () => {
    store.clearProgress(item.key);
    ctx.refresh();
  });

  if (curated) {
    const sim = reg(similar(item, films, 18));
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

/* =================================================================== MY LIST */
export async function myList(ctx) {
  const films = await api.catalog();
  const byKey = new Map(films.map((f) => [f.key, f]));
  const list = reg(store.list().map((x) => byKey.get(x.key) || x));
  const cw = store.continueWatching();
  const st = store.stats();
  const max = Math.max(...st.last7.map((d) => d.sec), 60);
  const niceMax = Math.ceil(max / 60 / 10) * 10 || 10;
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
    ${cw.length ? row({ title: 'Continue Watching', variant: 'wide', cards: cw.map((p) => wideCard(byKey.get(p.item.key) || p.item, p)).join('') }) : ''}
    <div class="container">
      <h2 class="section-title">Saved</h2>
      ${list.length
        ? `<div class="grid">${list.map((x) => posterCard({ ...x, playable: x.playable ?? (x.kind !== 'show' && x.kind !== 'anime') })).join('')}</div>`
        : emptyState({ iconName: 'bookmark', title: 'Nothing saved yet', text: 'Tap + on any film, show or anime to keep it here for later.', action: '<a class="btn btn--primary" href="/movies">Browse movies</a>' })}
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
