// Newsreel timeline: scroll 1929–1967 a year at a time. Each year shows the Universal Newsreels
// released that year next to what was happening in the world (dated events from Wikipedia).
import * as api from './api.js';
import { esc, icon, wideCard, footer } from './ui.js';
import { reg } from './views.js';

const FIRST = 1929, LAST = 1967;
const YEARS = Array.from({ length: LAST - FIRST + 1 }, (_, i) => FIRST + i);

export async function timeline(ctx) {
  document.title = 'Newsreel Timeline — Arnav Movies';
  const want = +new URLSearchParams(location.search).get('y');
  ctx.el.innerHTML = `<div class="view timeline"><div class="container">
    <header class="page-head"><div><div class="eyebrow">Newsreels</div><h1 class="page-title">The world, as it happened.</h1>
      <p class="page-sub">Universal Newsreels from ${FIRST} to ${LAST}, a year at a time, alongside what was making history. Events from Wikipedia.</p></div></header>
  </div>
  <nav class="years glass" aria-label="Years"><div class="years__track pills">${YEARS.map((y) => `<button class="pill" data-year="${y}">${y}</button>`).join('')}</div></nav>
  <div class="container">
    ${YEARS.map((y) => `<section class="tl-year" id="y${y}" data-y="${y}">
      <div class="tl-year__label"><span>${y}</span></div>
      <div class="tl-year__body">
        <div class="tl-events" data-events><div class="skel skel--line"></div><div class="skel skel--line"></div><div class="skel skel--line" style="width:70%"></div></div>
        <div class="tl-reels" data-reels><div class="skel skel--wide"></div><div class="skel skel--wide"></div></div>
      </div>
    </section>`).join('')}
  </div>${footer()}</div>`;

  const rail = ctx.el.querySelector('.years__track');
  const setActive = (y) => {
    rail.querySelectorAll('[data-year]').forEach((b) => {
      const on = +b.dataset.year === y;
      b.classList.toggle('is-active', on);
      // Scroll only the rail (scrollIntoView would also move, and interrupt, the page's own scroll).
      if (on) rail.scrollTo({ left: b.offsetLeft - rail.clientWidth / 2 + b.offsetWidth / 2, behavior: 'smooth' });
    });
  };
  rail.addEventListener('click', (e) => {
    const b = e.target.closest('[data-year]');
    if (!b) return;
    const sec = ctx.el.querySelector('#y' + b.dataset.year);
    const prev = ctx.el.querySelector('#y' + (+b.dataset.year - 1));
    Promise.all([load(sec), prev && load(prev)]).then(() => sec.scrollIntoView({ behavior: 'instant', block: 'start' }));
    history.replaceState(history.state, '', '/newsreels?y=' + b.dataset.year);
  });

  const loaded = new WeakSet();
  async function load(sec) {
    if (loaded.has(sec)) return;
    loaded.add(sec);
    const y = +sec.dataset.y;
    const [events, reels] = await Promise.all([api.yearEvents(y).catch(() => []), api.newsreelsOf(y).catch(() => [])]);
    if (!ctx.alive()) return;
    sec.querySelector('[data-events]').innerHTML = events.length
      ? `<h3 class="tl-head">${icon('globe')} In the world</h3><ol class="tl-list">${events.map((e) => `<li><time>${esc(e.when)}</time><p>${esc(e.text)}</p></li>`).join('')}</ol>
         <a class="tl-more" href="https://en.wikipedia.org/wiki/${y}" target="_blank" rel="noopener">More from ${y} on Wikipedia ${icon('external')}</a>`
      : `<p class="page-sub">No events found for ${y}.</p>`;
    sec.querySelector('[data-reels]').innerHTML = reels.length
      ? `<h3 class="tl-head">${icon('film')} On the newsreel <small>${reels.length}${reels.length >= 18 ? '+' : ''}</small></h3><div class="tl-grid">${reg(reels).map((f) => wideCard(f)).join('')}</div>`
      : `<h3 class="tl-head">${icon('film')} On the newsreel</h3><p class="page-sub">No Universal Newsreels from ${y} are on the Archive yet.</p>`;
  }

  // Load a year as it approaches; highlight the year in view.
  const near = new IntersectionObserver((entries) => entries.forEach((e) => e.isIntersecting && load(e.target)), { rootMargin: '900px 0px' });
  const spy = new IntersectionObserver((entries) => {
    const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (vis) setActive(+vis.target.dataset.y);
  }, { rootMargin: '-35% 0px -60% 0px' });
  ctx.el.querySelectorAll('.tl-year').forEach((s) => (near.observe(s), spy.observe(s)));
  ctx.onLeave(() => (near.disconnect(), spy.disconnect()));

  if (YEARS.includes(want)) {
    // Load the year (and the one above it) first, so nothing shifts once we land.
    const sec = ctx.el.querySelector('#y' + want);
    const prev = ctx.el.querySelector('#y' + (want - 1));
    await Promise.all([load(sec), prev && load(prev)]);
    if (!ctx.alive()) return;
    requestAnimationFrame(() => {
      sec.scrollIntoView({ block: 'start', behavior: 'instant' });
      setActive(want);
    });
  } else setActive(FIRST);
}
