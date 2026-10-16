// TV and anime: discovery rows, show pages (TVMaze + TMDB extras), anime pages (AniList).
import * as api from './api.js';
import { esc, icon, posterCard, wideCard, rankCard, row, skeletonRow, wireTilt, wireRows, listButton, metaLine, fmtRuntime, setAmbient, setAmbientHex, footer, ratingBadges, openTrailer } from './ui.js';
import { reg, fill, castRow, detailSkeleton, notFound } from './views.js';

let showPool;
const pool = () => (showPool ??= api.popularShows().catch(() => []));

/* ======================================================================== TV */
export async function tv(ctx) {
  ctx.el.innerHTML = `<div class="view"><div class="container"><header class="page-head"><div><div class="eyebrow">TV &amp; Anime</div>
    <h1 class="page-title">What’s on, everywhere.</h1>
    <p class="page-sub">Live schedules, trending shows, anime, cast and where to watch in your country — plus classic TV you can stream free right here.</p></div></header></div>
    <div class="rows">
      <div data-slot="trending">${skeletonRow('Trending This Week')}</div>
      <div data-slot="local">${skeletonRow('Popular in Your Country')}</div>
      <div data-slot="tonight">${skeletonRow('Airing Tonight')}</div>
      <div data-slot="anime-trending" id="anime">${skeletonRow('Trending Anime')}</div>
      <div data-slot="anime-season">${skeletonRow('This Season’s Anime')}</div>
      <div data-slot="loved">${skeletonRow('Most Loved Shows')}</div>
      <div data-slot="classic" id="classic">${skeletonRow('Classic TV — Free to Stream', 6, true)}</div>
      <div data-slot="anime-top">${skeletonRow('Top 10 Anime of All Time')}</div>
      <div data-slot="web">${skeletonRow('New on Streaming Today')}</div>
      <div data-slot="genres"></div>
    </div>${footer()}</div>`;

  const posters = (list, n = 30) => reg(list.slice(0, n)).map((x) => posterCard(x)).join('');
  api.trendingTv().then((s) => fill(ctx, '[data-slot="trending"]', s.length ? row({ title: 'Trending This Week', sub: 'Across every network and streamer', cards: posters(s) }) : '')).catch(() => fill(ctx, '[data-slot="trending"]', ''));
  api.popularInCountry().then((s) => fill(ctx, '[data-slot="local"]', s.length >= 4 ? row({ title: `Popular in ${api.countryName(s.country)}`, sub: 'Shows made here', cards: posters(s) }) : '')).catch(() => fill(ctx, '[data-slot="local"]', ''));
  api.airingTonight().then((s) => fill(ctx, '[data-slot="tonight"]', s.length ? row({ title: 'Airing Tonight', sub: `Broadcast in ${api.countryName(s.country)}`, cards: posters(s) }) : '')).catch(() => fill(ctx, '[data-slot="tonight"]', ''));
  api.streamingToday().then((s) => fill(ctx, '[data-slot="web"]', s.length ? row({ title: 'New on Streaming Today', cards: posters(s) }) : '')).catch(() => fill(ctx, '[data-slot="web"]', ''));
  api.iaSearch({ collection: 'classic_tv', rows: 30 }).then(({ items }) => fill(ctx, '[data-slot="classic"]', `<div id="classic">${row({ title: 'Classic TV — Free to Stream', sub: 'Public-domain episodes from the Internet Archive', variant: 'wide', cards: reg(items).map((f) => wideCard(f)).join('') })}</div>`)).catch(() => fill(ctx, '[data-slot="classic"]', ''));
  api.animeRows().then((a) => {
    fill(ctx, '[data-slot="anime-trending"]', `<div id="anime">${row({ title: 'Trending Anime', sub: 'From AniList', cards: posters(a.trending) })}</div>`);
    fill(ctx, '[data-slot="anime-season"]', row({ title: `${a.seasonName} Anime`, sub: 'Most popular this season', cards: posters(a.season) }));
    fill(ctx, '[data-slot="anime-top"]', row({ title: 'Top 10 Anime of All Time', variant: 'rank', cards: reg(a.top).map((x, i) => rankCard(x, i + 1)).join('') }));
    if (location.hash === '#anime') ctx.el.querySelector('#anime')?.scrollIntoView({ behavior: 'smooth' });
  }).catch(() => ['anime-trending', 'anime-season', 'anime-top'].forEach((s) => fill(ctx, `[data-slot="${s}"]`, '')));

  const shows = reg(await pool());
  const loved = shows.filter((s) => s.weight >= 90).sort((a, b) => b.score - a.score).slice(0, 10);
  fill(ctx, '[data-slot="loved"]', row({ title: 'Most Loved Shows', variant: 'rank', cards: loved.map((s, i) => rankCard(s, i + 1)).join('') }));
  const genres = ['Drama', 'Comedy', 'Science-Fiction', 'Crime', 'Thriller', 'Fantasy', 'Action', 'Romance', 'Horror', 'Mystery'];
  fill(ctx, '[data-slot="genres"]', genres.map((g) => {
    const list = shows.filter((s) => s.genres.includes(g)).sort((a, b) => b.weight - a.weight || b.score - a.score).slice(0, 24);
    return list.length > 4 ? row({ title: g.replace('-', ' '), cards: list.map((s) => posterCard(s)).join('') }) : '';
  }).join('') || null);
  if (location.hash === '#classic') ctx.el.querySelector('#classic')?.scrollIntoView({ behavior: 'smooth' });
}

/* ---------------------------------------------------------- shared pieces */
function countdown(ctx, el, target) {
  if (!el) return;
  const tick = () => {
    if (!ctx.alive()) return clearInterval(t);
    let d = Math.max(0, target - Date.now()) / 1000;
    el.innerHTML = [['days', 86400], ['hrs', 3600], ['min', 60], ['sec', 1]]
      .map(([l, n]) => { const v = Math.floor(d / n); d -= v * n; return `<div><b>${v}</b><span>${l}</span></div>`; })
      .join('');
  };
  const t = setInterval(tick, 1000);
  tick();
}

function providersPanel(extras, title) {
  const p = extras.providers;
  const q = encodeURIComponent(title);
  const group = (label, list) =>
    list?.length ? `<div class="providers__group"><small>${label}</small><div class="providers__logos">${list.slice(0, 8).map((x) => `<a href="${esc(p.link)}" target="_blank" rel="noopener" title="${esc(x.provider_name)}"><img src="${esc(api.tmdbImg(x.logo_path, 'w92'))}" alt="${esc(x.provider_name)}" loading="lazy"></a>`).join('')}</div></div>` : '';
  const body = p ? group('Stream', p.flatrate) + group('Free with ads', p.ads || p.free) + group('Rent', p.rent) + group('Buy', p.buy) : '';
  return `<div class="panel glass"><div class="eyebrow" style="margin-bottom:12px">Where to watch${p ? ` · ${esc(api.countryName(extras.providerCountry))}` : ''}</div>
    ${body || '<p class="page-sub" style="margin:0 0 12px;font-size:14px">No streaming offers listed for your country yet.</p>'}
    <a class="watch-card" style="margin-top:12px" href="https://www.justwatch.com/us/search?q=${q}" target="_blank" rel="noopener"><span class="watch-card__logo">${icon('globe')}</span><span><strong>All streaming options</strong><small>Data by JustWatch</small></span></a>
  </div>`;
}

const loadSeason = async (ctx, box, sid) => {
  box.innerHTML = Array.from({ length: 3 }, () => '<div class="skel" style="height:110px"></div>').join('');
  const eps = await api.seasonEpisodes(sid).catch(() => []);
  if (!ctx.alive()) return;
  box.innerHTML = eps.length
    ? eps.map((e) => `<div class="ep">
      <div class="ep__img">${e.image ? `<img src="${esc(e.image.medium.replace('http://', 'https://'))}" alt="" loading="lazy">` : ''}</div>
      <div><div class="ep__num">EPISODE ${e.number ?? 'SPECIAL'}${e.airdate ? ' · ' + new Date(e.airdate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''}${e.rating?.average ? ` · ★ ${e.rating.average}` : ''}</div>
      <div class="ep__title">${esc(e.name)}</div><p class="ep__text">${esc(api.stripHtml(e.summary || ''))}</p></div></div>`).join('')
    : '<p class="page-sub">No episode guide yet.</p>';
};

/* ====================================================================== SHOW */
export async function show(ctx, rawId) {
  ctx.el.innerHTML = detailSkeleton();
  let id = rawId;
  if (/^t\d+$/.test(rawId)) {
    id = await api.tvmazeFromTmdb(rawId.slice(1)).catch(() => null);
    if (!ctx.alive()) return;
    if (!id) return tmdbOnlyShow(ctx, rawId.slice(1));
    history.replaceState(history.state, '', `/show/${id}`);
  }
  let s;
  try {
    s = await api.showDetail(id);
  } catch {
    return ctx.alive() && notFound(ctx);
  }
  if (!ctx.alive()) return;
  // TMDB extras (backdrop, logo, trailer, providers) — don't hold the page for more than ~2.5s.
  const extras = await Promise.race([api.showExtras(s).catch(() => ({})), new Promise((r) => setTimeout(() => r({}), 2500))]);
  if (!ctx.alive()) return;
  if (extras.logo) s.logo = extras.logo;
  if (extras.backdrop) s.backdrop = extras.backdrop;
  if (extras.vote) s.rating = { ...s.rating, tmdb: Math.round(extras.vote * 10) / 10 };
  reg([s]);
  document.title = `${s.title} — Lumen`;
  const sched = s.schedule?.days?.length ? `${s.schedule.days.join(', ')}${s.schedule.time ? ' at ' + s.schedule.time : ''}` : '';
  const facts = [
    s.network && [s.networkKind || 'Network', esc(s.network) + (s.country ? ` · ${esc(s.country)}` : '')],
    ['Status', esc(s.status) + (s.ended ? ` · ended ${esc(s.ended.slice(0, 4))}` : '')],
    sched && ['Schedule', esc(sched)],
    s.runtime && ['Episode length', fmtRuntime(s.runtime)],
    s.genres.length && ['Genres', s.genres.map(esc).join(', ')],
    s.language && ['Language', esc(s.language)],
  ].filter(Boolean);

  ctx.el.innerHTML = `<div class="view view--flush detail">
    <div class="detail__backdrop ${s.backdrop ? 'detail__backdrop--sharp' : ''}"><img src="${esc(s.backdrop || s.posterHd || s.poster || '')}" alt=""></div>
    <div class="container">
      <div class="detail__hero">
        <div class="detail__poster" data-tilt><div class="tilt">${s.poster ? `<img src="${esc(s.posterHd || s.poster)}" alt="${esc(s.title)} poster" data-morph>` : `<div class="card__fallback">${esc(s.title)}</div>`}<div class="tilt__glare"></div></div></div>
        <div class="detail__info">
          <div class="eyebrow">TV Series${s.network ? ' · ' + esc(s.network) : ''}</div>
          <h1 class="detail__title ${s.logo ? 'has-logo' : ''}">${s.logo ? `<img class="detail__logo" src="${esc(s.logo)}" alt="${esc(s.title)}">` : esc(s.title)}</h1>
          <div class="chips">${metaLine(s, { max: 4 })}${s.seasons.length ? `<span class="dot"></span>${s.seasons.length} season${s.seasons.length > 1 ? 's' : ''}` : ''}</div>
          ${Object.keys(s.rating).length ? `<div class="scores">${ratingBadges(s.rating)}</div>` : ''}
          <div class="detail__actions">
            <a class="btn btn--primary" href="#where" data-scroll-where>${icon('play')} Where to watch</a>
            ${extras.trailer ? `<button class="btn btn--glass" data-trailer-open="${esc(extras.trailer)}">${icon('trailer')} Trailer</button>` : ''}
            ${listButton(s)}
            <button class="btn btn--glass btn--round" data-share aria-label="Share">${icon('share')}</button>
          </div>
        </div>
      </div>
      <div class="detail__body">
        <div>
          <h2 class="section-title">About</h2>
          <p class="prose">${esc(s.overview || 'No synopsis yet.')}</p>
          ${s.people.length ? `<h2 class="section-title" style="margin-top:36px">Cast</h2>${castRow(s.people)}` : ''}
          ${s.seasons.length ? `<h2 class="section-title" style="margin-top:36px">Episodes</h2>
            <div class="pills" data-seasons style="margin-bottom:12px">${s.seasons.map((x, i) => `<button class="pill ${i === s.seasons.length - 1 ? 'is-active' : ''}" data-season="${x.id}">Season ${x.number}</button>`).join('')}</div>
            <div class="episodes" data-episodes></div>` : ''}
        </div>
        <aside style="display:grid;gap:14px;align-content:start" id="where">
          ${s.next ? `<div class="panel glass"><div class="eyebrow">Next episode</div><div style="font-weight:650;margin-top:6px">S${s.next.season} · E${s.next.number ?? '–'} — ${esc(s.next.name)}</div><div class="countdown" data-countdown></div></div>` : ''}
          ${providersPanel(extras, s.title)}
          <div class="panel glass"><dl class="facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
            <div class="links">${s.imdb ? `<a class="btn btn--glass btn--sm" href="https://www.imdb.com/title/${esc(s.imdb)}/" target="_blank" rel="noopener">IMDb ${icon('external')}</a>` : ''}${s.officialSite ? `<a class="btn btn--glass btn--sm" href="${esc(s.officialSite)}" target="_blank" rel="noopener">Official site ${icon('external')}</a>` : ''}<a class="btn btn--glass btn--sm" href="https://www.tvmaze.com/shows/${s.id}" target="_blank" rel="noopener">TVMaze ${icon('external')}</a></div>
          </div>
        </aside>
      </div>
    </div>
    <div class="rows" style="margin-top:56px"><div data-slot="similar"></div></div>
    ${footer()}
  </div>`;
  if (ctx.morph) ctx.el.querySelector('[data-morph]')?.style.setProperty('view-transition-name', 'poster-morph');
  setAmbient(s.poster);
  wireTilt(ctx.el);
  ctx.el.querySelector('[data-share]').addEventListener('click', () => ctx.share(s));
  ctx.el.querySelector('[data-trailer-open]')?.addEventListener('click', (e) => openTrailer(e.currentTarget.dataset.trailerOpen, s.title));
  ctx.el.querySelector('[data-scroll-where]').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    ctx.el.querySelector('#where').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  if (s.next) countdown(ctx, ctx.el.querySelector('[data-countdown]'), new Date(s.next.airstamp).getTime());

  const epBox = ctx.el.querySelector('[data-episodes]');
  if (epBox) {
    loadSeason(ctx, epBox, s.seasons[s.seasons.length - 1].id);
    ctx.el.querySelector('[data-seasons]').addEventListener('click', (e) => {
      const b = e.target.closest('[data-season]');
      if (!b) return;
      ctx.el.querySelectorAll('[data-season]').forEach((x) => x.classList.toggle('is-active', x === b));
      loadSeason(ctx, epBox, b.dataset.season);
    });
  }
  const sim = reg(await api.similarShows(s, await pool()));
  fill(ctx, '[data-slot="similar"]', sim.length ? row({ title: 'You Might Also Like', cards: sim.map((x) => posterCard(x)).join('') }) : '');
}

/** Shows TVMaze doesn't know (common outside the US/UK): render straight from TMDB. */
async function tmdbOnlyShow(ctx, tmdbId) {
  let t;
  try {
    t = await api.tmdb(`tv/${tmdbId}`, { append_to_response: 'credits,videos,watch/providers,images', include_image_language: 'en,null' });
  } catch {
    return ctx.alive() && notFound(ctx);
  }
  if (!ctx.alive()) return;
  const { country } = await api.config();
  const prov = t['watch/providers']?.results || {};
  const extras = { providers: prov[country] || prov.US || null, providerCountry: prov[country] ? country : 'US' };
  const trailer = (t.videos?.results || []).find((v) => v.site === 'YouTube' && v.type === 'Trailer');
  const logo = (t.images?.logos || []).find((l) => l.iso_639_1 === 'en') || t.images?.logos?.[0];
  const item = {
    key: 'tmdbtv:' + t.id, kind: 'show', id: t.id, title: t.name, year: t.first_air_date ? +t.first_air_date.slice(0, 4) : null,
    poster: api.tmdbImg(t.poster_path, 'w342'), posterHd: api.tmdbImg(t.poster_path, 'w780'), backdrop: api.tmdbImg(t.backdrop_path, 'w1280'),
    genres: (t.genres || []).map((g) => g.name), runtime: t.episode_run_time?.[0], overview: t.overview, rating: t.vote_average ? { tmdb: Math.round(t.vote_average * 10) / 10 } : {},
    href: '/show/t' + t.id, playable: false,
  };
  reg([item]);
  document.title = `${item.title} — Lumen`;
  const people = (t.credits?.cast || []).slice(0, 16).map((c) => ({ name: c.name, role: c.character, photo: api.tmdbImg(c.profile_path, 'w185') }));
  ctx.el.innerHTML = `<div class="view view--flush detail">
    <div class="detail__backdrop detail__backdrop--sharp"><img src="${esc(item.backdrop || item.posterHd || '')}" alt=""></div>
    <div class="container">
      <div class="detail__hero">
        <div class="detail__poster" data-tilt><div class="tilt"><img src="${esc(item.posterHd)}" alt="${esc(item.title)} poster" data-morph><div class="tilt__glare"></div></div></div>
        <div class="detail__info">
          <div class="eyebrow">TV Series${t.networks?.[0] ? ' · ' + esc(t.networks[0].name) : ''}</div>
          <h1 class="detail__title ${logo ? 'has-logo' : ''}">${logo ? `<img class="detail__logo" src="${esc(api.tmdbImg(logo.file_path, 'w500'))}" alt="${esc(item.title)}">` : esc(item.title)}</h1>
          <div class="chips">${metaLine(item, { max: 4 })}${t.number_of_seasons ? `<span class="dot"></span>${t.number_of_seasons} season${t.number_of_seasons > 1 ? 's' : ''}` : ''}</div>
          ${Object.keys(item.rating).length ? `<div class="scores">${ratingBadges(item.rating)}</div>` : ''}
          <div class="detail__actions">
            ${trailer ? `<button class="btn btn--primary" data-trailer-open="${esc(trailer.key)}">${icon('trailer')} Trailer</button>` : ''}
            ${listButton(item)}
            <button class="btn btn--glass btn--round" data-share aria-label="Share">${icon('share')}</button>
          </div>
        </div>
      </div>
      <div class="detail__body">
        <div><h2 class="section-title">About</h2><p class="prose">${esc(item.overview || 'No synopsis yet.')}</p>
          ${people.length ? `<h2 class="section-title" style="margin-top:36px">Cast</h2>${castRow(people)}` : ''}</div>
        <aside style="display:grid;gap:14px;align-content:start">${providersPanel(extras, item.title)}</aside>
      </div>
    </div>${footer()}</div>`;
  if (ctx.morph) ctx.el.querySelector('[data-morph]')?.style.setProperty('view-transition-name', 'poster-morph');
  setAmbient(item.poster);
  wireTilt(ctx.el);
  ctx.el.querySelector('[data-share]').addEventListener('click', () => ctx.share(item));
  ctx.el.querySelector('[data-trailer-open]')?.addEventListener('click', (e) => openTrailer(e.currentTarget.dataset.trailerOpen, item.title));
}

/* ===================================================================== ANIME */
export async function anime(ctx, id) {
  ctx.el.innerHTML = detailSkeleton();
  let a;
  try {
    a = await api.animeDetail(id);
  } catch {
    return ctx.alive() && notFound(ctx);
  }
  if (!ctx.alive()) return;
  reg([a, ...a.recs]);
  document.title = `${a.title} — Lumen`;
  const fmt = { TV: 'TV Series', TV_SHORT: 'TV Short', MOVIE: 'Movie', OVA: 'OVA', ONA: 'ONA', SPECIAL: 'Special' }[a.format] || 'Anime';
  const facts = [
    a.studios.length && ['Studio', a.studios.map(esc).join(', ')],
    a.episodes && ['Episodes', String(a.episodes)],
    a.runtime && ['Episode length', fmtRuntime(a.runtime)],
    a.season && ['Season', `${a.season[0]}${a.season.slice(1).toLowerCase()} ${a.year || ''}`],
    a.status && ['Status', a.status[0] + a.status.slice(1).toLowerCase().replace(/_/g, ' ')],
    a.source && ['Source', a.source[0] + a.source.slice(1).toLowerCase().replace(/_/g, ' ')],
    a.genres.length && ['Genres', a.genres.map(esc).join(', ')],
  ].filter(Boolean);
  const first = a.streaming[0];

  ctx.el.innerHTML = `<div class="view view--flush detail">
    <div class="detail__backdrop ${a.backdrop ? 'detail__backdrop--sharp' : ''}"><img src="${esc(a.backdrop || a.posterHd)}" alt=""></div>
    <div class="container">
      <div class="detail__hero">
        <div class="detail__poster" data-tilt><div class="tilt"><img src="${esc(a.posterHd)}" alt="${esc(a.title)} cover" data-morph><div class="tilt__glare"></div></div></div>
        <div class="detail__info">
          <div class="eyebrow">Anime · ${esc(fmt)}</div>
          <h1 class="detail__title">${esc(a.title)}</h1>
          <div class="chips">${metaLine(a, { max: 4 })}</div>
          ${Object.keys(a.rating).length ? `<div class="scores">${ratingBadges(a.rating)}</div>` : ''}
          <div class="detail__actions">
            ${first ? `<a class="btn btn--primary" href="${esc(first.url)}" target="_blank" rel="noopener">${icon('play')} Watch on ${esc(first.site)}</a>` : ''}
            ${a.trailer ? `<button class="btn btn--glass" data-trailer-open="${esc(a.trailer)}">${icon('trailer')} Trailer</button>` : ''}
            ${listButton(a)}
            <button class="btn btn--glass btn--round" data-share aria-label="Share">${icon('share')}</button>
          </div>
        </div>
      </div>
      <div class="detail__body">
        <div>
          <h2 class="section-title">About</h2>
          <p class="prose">${esc(a.overview || 'No synopsis yet.')}</p>
          ${a.people.length ? `<h2 class="section-title" style="margin-top:36px">Characters</h2>${castRow(a.people)}` : ''}
        </div>
        <aside style="display:grid;gap:14px;align-content:start">
          ${a.next ? `<div class="panel glass"><div class="eyebrow">Episode ${a.next.episode} airs in</div><div class="countdown" data-countdown></div></div>` : ''}
          <div class="panel glass"><div class="eyebrow" style="margin-bottom:12px">Official streaming</div>
            ${a.streaming.length ? a.streaming.map((l) => `<a class="watch-card" style="margin-top:8px" href="${esc(l.url)}" target="_blank" rel="noopener"><span class="watch-card__logo" style="${l.color ? `background:${esc(l.color)}` : ''}">${l.icon ? `<img src="${esc(l.icon)}" alt="" width="22" height="22">` : esc(l.site[0])}</span><span><strong>${esc(l.site)}</strong><small>${esc(l.language || 'Official')}</small></span></a>`).join('') : '<p class="page-sub" style="margin:0;font-size:14px">No official streams listed yet.</p>'}
          </div>
          <div class="panel glass"><dl class="facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
            <div class="links"><a class="btn btn--glass btn--sm" href="https://anilist.co/anime/${a.id}" target="_blank" rel="noopener">AniList ${icon('external')}</a>${a.links.map((l) => `<a class="btn btn--glass btn--sm" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.site)} ${icon('external')}</a>`).join('')}</div>
          </div>
        </aside>
      </div>
    </div>
    <div class="rows" style="margin-top:56px">${a.recs.length ? row({ title: 'Fans Also Watch', cards: a.recs.map((x) => posterCard(x)).join('') }) : ''}</div>
    ${footer()}
  </div>`;
  if (ctx.morph) ctx.el.querySelector('[data-morph]')?.style.setProperty('view-transition-name', 'poster-morph');
  a.color ? setAmbientHex(a.color) : setAmbient(a.poster);
  wireTilt(ctx.el);
  ctx.el.querySelector('[data-share]').addEventListener('click', () => ctx.share(a));
  ctx.el.querySelector('[data-trailer-open]')?.addEventListener('click', (e) => openTrailer(e.currentTarget.dataset.trailerOpen, a.title));
  if (a.next) countdown(ctx, ctx.el.querySelector('[data-countdown]'), a.next.airingAt * 1000);
  wireRows(ctx.el);
}
