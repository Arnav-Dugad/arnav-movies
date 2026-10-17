// Classic TV: whole series grouped into seasons (all free to stream), plus vintage episodes and newsreels.
import * as api from './api.js';
import { esc, icon, posterCard, wideCard, rankCard, row, skeletonRow, wireTilt, wireRows, listButton, setAmbient, footer, ratingBadges } from './ui.js';
import { reg, fill, detailSkeleton, notFound } from './views.js';
import { store } from './store.js';
import { applyTheme } from './theme.js';

/* ======================================================================== TV */
export async function tv(ctx) {
  ctx.el.innerHTML = `<div class="view"><div class="container"><header class="page-head"><div><div class="eyebrow">Classic TV</div>
    <h1 class="page-title">Golden-age television.</h1>
    <p class="page-sub">Whole seasons of 1950s and ’60s favourites in order, vintage episodes from the Internet Archive and the newsreels audiences saw at the pictures.</p></div></header></div>
    <div class="rows">
      <div data-slot="cw"></div>
      <div data-slot="series" id="series">${skeletonRow('Classic TV Series')}</div>
      <div data-slot="genres"></div>
      <div data-slot="classic" id="classic">${skeletonRow('Vintage Episodes', 6, true)}</div>
      <div data-slot="newsreels">${skeletonRow('Newsreels', 6, true)}</div>
    </div>${footer()}</div>`;

  const list = reg(await api.series());
  if (!ctx.alive()) return;
  const cw = store.continueWatching().filter((p) => p.item.series);
  fill(ctx, '[data-slot="cw"]', cw.length ? row({ title: 'Continue Watching', variant: 'wide', cards: cw.map((p) => wideCard(p.item, p)).join('') }) : '');
  fill(ctx, '[data-slot="series"]', list.length ? `<div id="series">${row({ title: 'Classic TV Series', sub: `${list.length} series · ${list.reduce((a, s) => a + s.count, 0).toLocaleString()} episodes`, variant: 'rank', cards: list.slice(0, 10).map((s, i) => rankCard(s, i + 1)).join('') })}${row({ title: 'All Series', cards: list.map((s) => posterCard(s)).join('') })}</div>` : '');
  const genres = [...new Set(list.flatMap((s) => s.genres))].filter((g) => list.filter((s) => s.genres.includes(g)).length >= 3);
  fill(ctx, '[data-slot="genres"]', genres.map((g) => row({ title: g.replace(/&/g, 'and'), cards: list.filter((s) => s.genres.includes(g)).map((s) => posterCard(s)).join('') })).join('') || null);
  if (location.hash === '#series') ctx.el.querySelector('#series')?.scrollIntoView({ behavior: 'smooth' });

  api.iaSearch({ collection: 'classic_tv', rows: 30 }).then(({ items }) => fill(ctx, '[data-slot="classic"]', `<div id="classic">${row({ title: 'Vintage Episodes', sub: 'From the Internet Archive’s classic TV collection', variant: 'wide', cards: reg(items).map((f) => wideCard(f)).join('') })}</div>`)).catch(() => fill(ctx, '[data-slot="classic"]', ''));
  api.sourceItems('newsreels', { rows: 24 }).then(({ items }) => fill(ctx, '[data-slot="newsreels"]', row({ title: 'Newsreels', sub: 'What audiences saw before the feature', more: '/movies?source=newsreels', variant: 'wide', cards: reg(items).map((f) => wideCard(f)).join('') }))).catch(() => fill(ctx, '[data-slot="newsreels"]', ''));
  if (location.hash === '#classic') ctx.el.querySelector('#classic')?.scrollIntoView({ behavior: 'smooth' });
}

/* ==================================================================== SERIES */
export async function seriesView(ctx, sid) {
  ctx.el.innerHTML = detailSkeleton();
  const sr = await api.seriesById(sid);
  if (!ctx.alive()) return;
  if (!sr) return notFound(ctx);
  reg([sr, ...sr.episodes]);
  document.title = `${sr.title} — Arnav Movies`;
  const { byKey, last } = store.seriesProgress(sid);
  const eps = sr.episodes;
  // Resume where you left off; if you finished that one, start the next.
  let resume = last ? eps.find((e) => e.key === last.item.key) : null;
  if (resume && last.t / last.d >= 0.95) resume = eps[eps.indexOf(resume) + 1] || resume;
  const start = resume || eps[0];
  const epLabel = (e) => (e.s && e.e ? `S${e.s} · E${e.e}` : 'Episode');
  const watched = eps.filter((e) => byKey[e.key] && byKey[e.key].t / byKey[e.key].d >= 0.95).length;
  const seasonIdx = Math.max(0, sr.seasons.findIndex((x) => x.eps.includes(start)));

  ctx.el.innerHTML = `<div class="view view--flush detail">
    <div class="detail__backdrop ${sr.backdrop ? 'detail__backdrop--sharp' : ''}"><img src="${esc(sr.backdrop || sr.posterHd || '')}" alt=""></div>
    <div class="container">
      <div class="detail__hero">
        <div class="detail__poster" data-tilt><div class="tilt">${sr.posterHd ? `<img src="${esc(sr.posterHd)}" alt="${esc(sr.title)} poster" data-morph>` : `<div class="card__fallback">${esc(sr.title)}</div>`}<div class="tilt__glare"></div></div></div>
        <div class="detail__info">
          <div class="eyebrow">Classic TV</div>
          <h1 class="detail__title ${sr.logo ? 'has-logo' : ''}">${sr.logo ? `<img class="detail__logo" src="${esc(sr.logo)}" alt="${esc(sr.title)}">` : esc(sr.title)}</h1>
          <div class="chips">${[sr.year, sr.network, `${eps.length} episodes`, sr.nseasons ? `${sr.nseasons} season${sr.nseasons > 1 ? 's' : ''}` : ''].filter(Boolean).map(esc).join('<span class="dot"></span>')}${sr.genres.length ? `<span class="dot"></span>${esc(sr.genres.join(', '))}` : ''}</div>
          ${Object.keys(sr.rating).length ? `<div class="scores">${ratingBadges(sr.rating)}</div>` : ''}
          <div class="detail__actions">
            <button class="btn btn--primary" data-ep-play="${esc(start.key)}">${icon('play')} ${resume ? `Resume ${epLabel(start)}` : `Play ${epLabel(start)}`}</button>
            ${listButton(sr)}
            <button class="btn btn--glass btn--round" data-share aria-label="Share">${icon('share')}</button>
          </div>
          ${watched ? `<div class="series-progress"><i style="width:${(watched / eps.length) * 100}%"></i></div><small class="series-progress__label">${watched} of ${eps.length} watched</small>` : ''}
        </div>
      </div>
      <div class="detail__body detail__body--wide">
        <div>
          <h2 class="section-title">About</h2>
          <p class="prose">${esc(sr.overview || 'Vintage episodes from the Internet Archive.')}</p>
          <h2 class="section-title" style="margin-top:36px">Episodes</h2>
          <div class="pills" data-seasons style="margin-bottom:12px">${sr.seasons.map((x, i) => `<button class="pill ${i === seasonIdx ? 'is-active' : ''}" data-season="${i}">${esc(x.label)} <small>${x.eps.length}</small></button>`).join('')}</div>
          <div class="episodes" data-episodes></div>
          <p class="page-sub" style="font-size:13px;margin-top:20px">Episodes stream from the Internet Archive’s classic TV collection; many episodes of this series are in the U.S. public domain. Rights are as listed on each Archive item.</p>
        </div>
      </div>
    </div>
    ${footer()}
  </div>`;
  if (ctx.morph) ctx.el.querySelector('[data-morph]')?.style.setProperty('view-transition-name', 'poster-morph');
  setAmbient(sr.poster);
  ctx.onLeave(applyTheme(sr.poster));
  wireTilt(ctx.el);

  const box = ctx.el.querySelector('[data-episodes]');
  const renderSeason = (i) => {
    box.innerHTML = sr.seasons[i].eps.map((e) => {
      const p = byKey[e.key];
      const pct = p ? Math.min(100, (p.t / p.d) * 100) : 0;
      const done = pct >= 95;
      return `<button class="ep ep--play ${e.key === start.key ? 'is-next' : ''}" data-ep-play="${esc(e.key)}" data-launch-key="${esc(e.key)}">
        <div class="ep__img">${e.still ? `<img src="${esc(e.still)}" alt="" loading="lazy">` : ''}<span class="ep__playicon">${icon(done ? 'check' : 'play')}</span>
          ${p && !done ? `<span class="ep__bar"><i style="width:${pct}%"></i></span>` : ''}</div>
        <div><div class="ep__num">${esc(epLabel(e))}${e.air ? ' · ' + new Date(e.air).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''}${e.length ? ` · ${Math.round(e.length / 60)} min` : ''}${p && !done ? ` · ${Math.max(1, Math.round((p.d - p.t) / 60))} min left` : done ? ' · Watched' : ''}</div>
        <div class="ep__title">${esc(e.title)}</div>${e.overview ? `<p class="ep__text">${esc(e.overview)}</p>` : ''}</div>
      </button>`;
    }).join('');
  };
  renderSeason(seasonIdx);
  ctx.el.querySelector('[data-seasons]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-season]');
    if (!b) return;
    ctx.el.querySelectorAll('[data-season]').forEach((x) => x.classList.toggle('is-active', x === b));
    renderSeason(+b.dataset.season);
  });
  ctx.el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ep-play]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    const ep = eps.find((x) => x.key === b.dataset.epPlay);
    if (ep) ctx.play(ep, { from: b.querySelector('.ep__img') || b, queue: eps });
  });
  ctx.el.querySelector('[data-share]').addEventListener('click', () => ctx.share(sr));
}
