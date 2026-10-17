// Space: NASA's live broadcast, launch countdowns (Launch Library 2) and the NASA video library.
import * as api from './api.js';
import { esc, icon, row, wideCard, wireRows, footer, skeletonRow, emptyState } from './ui.js';
import { reg } from './views.js';
import { dataSaver } from './prefs.js';

const pad = (n) => String(n).padStart(2, '0');
function countdown(ms) {
  const past = ms < 0;
  let s = Math.abs(Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  return { sign: past ? 'T+' : 'T−', d, h: pad(h), m: pad(m), s: pad(s) };
}
const STATUS = { Go: 'go', TBC: 'tbc', TBD: 'tbd', Hold: 'hold', 'In Flight': 'live', Success: 'go' };
const when = (net, precision) => {
  const d = new Date(net);
  const opts = precision && /MON|QUARTER|YEAR|HALF/.test(precision) ? { month: 'long', year: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
  return d.toLocaleString(undefined, opts) + (precision && /DAY|MON|QUARTER|YEAR|HALF|WEEK/.test(precision) ? ' · date not final' : '');
};

export async function space(ctx) {
  document.title = 'Space — Arnav Movies';
  ctx.el.innerHTML = `<div class="view space"><div class="container">
    <header class="page-head"><div><div class="eyebrow">Space</div><h1 class="page-title">Live from orbit.</h1>
      <p class="page-sub">NASA’s live broadcast, every upcoming launch counting down in your time zone, and decades of NASA film.</p></div></header>
    <section class="space__top">
      <div class="live glass">
        <div class="live__frame" data-live>
          <button class="live__play" data-live-play aria-label="Watch NASA Live">${icon('play')}</button>
          <span class="live__badge"><i></i> NASA Live</span>
        </div>
        <div class="live__meta"><strong>NASA Live</strong><span>Launches, spacewalks and mission coverage from NASA’s official channel. When nothing is live, YouTube shows the next scheduled stream.</span></div>
      </div>
      <div class="next glass" data-next><div class="next__loading"><span class="spinner"></span></div></div>
    </section>
    <h2 class="section-title" style="margin-top:44px">Upcoming launches</h2>
    <div class="launches" data-launches>${Array.from({ length: 6 }, () => '<div class="skel skel--wide"></div>').join('')}</div>
    <p class="page-sub" style="font-size:13px;margin-top:14px">Launch data from <a href="https://thespacedevs.com/llapi" target="_blank" rel="noopener">The Space Devs Launch Library 2</a>; times update every 15 minutes.</p>
  </div>
  <div class="rows" style="margin-top:44px">
    <div data-slot="apollo">${skeletonRow('Apollo', 6, true)}</div>
    <div data-slot="mars">${skeletonRow('Mars', 6, true)}</div>
    <div data-slot="hubble">${skeletonRow('Hubble', 6, true)}</div>
    <div data-slot="iss">${skeletonRow('Space Station', 6, true)}</div>
  </div>
  ${footer()}</div>`;

  // Live: find what NASA is streaming now; tap to load, so the page doesn't start a stream (or spend data) on its own.
  const frame = ctx.el.querySelector('[data-live]');
  const meta = ctx.el.querySelector('.live__meta');
  let live = null;
  const startLive = async () => {
    live ??= await api.nasaLive();
    if (!ctx.alive()) return;
    if (!live?.id) {
      window.open('https://www.youtube.com/@NASA/streams', '_blank', 'noopener');
      return;
    }
    frame.innerHTML = `<iframe src="${esc(api.youtubeEmbed(live.id))}" title="${esc(live.title || 'NASA Live')}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
    frame.classList.add('is-on');
  };
  ctx.el.querySelector('[data-live-play]').addEventListener('click', startLive);
  api.nasaLive().then((l) => {
    live = l;
    if (!ctx.alive()) return;
    const badge = frame.querySelector('.live__badge');
    if (l?.id && l.live) {
      meta.innerHTML = `<strong>${esc(l.title || 'NASA Live')}</strong><span>Streaming now on NASA’s official channel. Muted to start — unmute in the player.</span>`;
    } else if (l?.id && l.upcoming) {
      badge.innerHTML = '<i class="is-soon"></i> Up next';
      meta.innerHTML = `<strong>${esc(l.title || 'NASA Live')}</strong><span>Scheduled${l.start ? ' for ' + esc(new Date(l.start).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })) : ''} on NASA’s official channel.</span>`;
    } else {
      badge.innerHTML = '<i class="is-off"></i> Off air';
      meta.innerHTML = `<strong>NASA isn’t streaming right now</strong><span>Tap play to see NASA’s recent and scheduled streams on YouTube.</span>`;
    }
  });

  const ticks = [];
  const timer = setInterval(() => ticks.forEach((fn) => fn()), 1000);
  ctx.onLeave(() => clearInterval(timer));

  api.launches().then((list) => {
    if (!ctx.alive()) return;
    const upcoming = (list || []).filter((l) => new Date(l.net) > Date.now() - 3 * 3600e3);
    const nextBox = ctx.el.querySelector('[data-next]');
    const grid = ctx.el.querySelector('[data-launches]');
    if (!upcoming.length) {
      nextBox.innerHTML = `<div class="next__empty">${icon('moon')}<strong>No launch data right now</strong><span>Launch Library is busy; try again in a few minutes.</span></div>`;
      grid.innerHTML = emptyState({ title: 'Launch schedule unavailable', text: 'The free launch feed allows a few calls an hour. Check back shortly.' });
      return;
    }
    const [n, ...rest] = upcoming;
    nextBox.innerHTML = `
      ${n.image && !dataSaver() ? `<div class="next__img"><img src="${esc(n.image)}" alt=""></div>` : ''}
      <div class="next__body">
        <div class="eyebrow">Next launch · <span class="status status--${STATUS[n.status] || 'tbd'}">${esc(n.statusName || n.status || 'Scheduled')}</span></div>
        <h2 class="next__name">${esc(n.name)}</h2>
        <p class="next__sub">${esc([n.provider, n.rocket].filter(Boolean).join(' · '))}</p>
        <div class="clock" data-clock="${esc(n.net)}" aria-live="off">
          <span class="clock__sign"></span>
          <div><b data-d>0</b><small>days</small></div><div><b data-h>00</b><small>hours</small></div><div><b data-m>00</b><small>min</small></div><div><b data-s>00</b><small>sec</small></div>
        </div>
        <p class="next__when">${icon('globe')} ${esc(when(n.net, n.precision))} · ${esc([n.pad, n.place].filter(Boolean).join(', '))}</p>
        ${n.about ? `<p class="next__about">${esc(n.about)}</p>` : ''}
        <div class="next__actions">
          ${n.video ? `<a class="btn btn--primary btn--sm" href="${esc(n.video)}" target="_blank" rel="noopener">${icon(n.live ? 'pulse' : 'play')} ${n.live ? 'Watch live' : 'Webcast'}</a>` : ''}
          <button class="btn btn--glass btn--sm" data-live-play>${icon('cast')} NASA Live</button>
          ${n.info ? `<a class="btn btn--glass btn--sm" href="${esc(n.info)}" target="_blank" rel="noopener">Mission ${icon('external')}</a>` : ''}
        </div>
      </div>`;
    nextBox.querySelector('[data-live-play]')?.addEventListener('click', () => {
      startLive();
      frame.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    const clock = nextBox.querySelector('[data-clock]');
    const paint = () => {
      const c = countdown(new Date(clock.dataset.clock) - Date.now());
      clock.querySelector('.clock__sign').textContent = c.sign;
      clock.querySelector('[data-d]').textContent = c.d;
      clock.querySelector('[data-h]').textContent = c.h;
      clock.querySelector('[data-m]').textContent = c.m;
      clock.querySelector('[data-s]').textContent = c.s;
    };
    paint();
    ticks.push(paint);

    grid.innerHTML = rest.map((l) => `<article class="launch glass">
      <div class="launch__img">${l.image && !dataSaver() ? `<img src="${esc(l.image)}" alt="" loading="lazy">` : ''}<span class="status status--${STATUS[l.status] || 'tbd'}">${esc(l.status || 'TBD')}</span></div>
      <div class="launch__body">
        <strong>${esc(l.name)}</strong>
        <span>${esc([l.provider, l.rocket].filter(Boolean).join(' · '))}</span>
        <span class="launch__when">${esc(when(l.net, l.precision))}</span>
        <span class="launch__count" data-count="${esc(l.net)}"></span>
        ${l.video ? `<a class="launch__link" href="${esc(l.video)}" target="_blank" rel="noopener">${icon('play')} Webcast</a>` : ''}
      </div>
    </article>`).join('');
    const counts = [...grid.querySelectorAll('[data-count]')];
    const paintAll = () => counts.forEach((el) => {
      const c = countdown(new Date(el.dataset.count) - Date.now());
      el.textContent = `${c.sign} ${c.d ? c.d + 'd ' : ''}${c.h}:${c.m}:${c.s}`;
    });
    paintAll();
    ticks.push(paintAll);
  }).catch(() => {
    if (!ctx.alive()) return;
    ctx.el.querySelector('[data-next]').innerHTML = `<div class="next__empty">${icon('moon')}<strong>Launch schedule unavailable</strong><span>Try again in a few minutes.</span></div>`;
    ctx.el.querySelector('[data-launches]').innerHTML = '';
  });

  const nasaRow = (slot, q, title, sub) =>
    api.nasaSearch(q, { rows: 24 }).then(({ items }) => {
      if (!ctx.alive()) return;
      const el = ctx.el.querySelector(`[data-slot="${slot}"]`);
      el.innerHTML = items.length ? row({ title, sub, more: `/movies?source=nasa&g=${encodeURIComponent(title)}`, variant: 'wide', cards: reg(items).map((f) => wideCard(f)).join('') }) : '';
      wireRows(el);
    }).catch(() => (ctx.el.querySelector(`[data-slot="${slot}"]`).innerHTML = ''));
  nasaRow('apollo', 'apollo', 'Apollo', 'The Moon missions, 1961–1972');
  nasaRow('mars', 'mars rover', 'Mars', 'Rovers, landings and the red planet');
  nasaRow('hubble', 'hubble', 'Hubble', 'Thirty years of the deep sky');
  nasaRow('iss', 'space station', 'Space Station', 'Life and work in orbit');
}
