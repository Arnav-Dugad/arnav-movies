// Shorts: a full-screen, swipeable feed of 35-second clips from cartoons and silent shorts.
// One clip plays at a time (muted until you tap); neighbours preload; "Watch full" opens the player.
import * as api from './api.js';
import { store } from './store.js';
import { esc, icon, haptic, toast } from './ui.js';
import { dailyShuffle } from './recs.js';
import { reg } from './views.js';

const CLIP = 35; // seconds

export async function shorts(ctx) {
  const films = await api.catalog();
  const rejected = store.rejected();
  const pool = films.filter((f) => f.tags.includes('short') && (f.tags.includes('animation') || f.tags.includes('silent') || f.tags.includes('comedy')) && !rejected.has(f.key));
  // Fresh order every visit, but keep favourites (taste) a little more likely near the top.
  const taste = store.taste();
  const order = dailyShuffle(pool, String(Date.now()))
    .map((f, i) => [f, i - [...f.genres, ...f.tags].reduce((s, g) => s + Math.max(0, taste[g] || 0), 0) * 2])
    .sort((a, b) => a[1] - b[1])
    .map(([f]) => f);
  reg(order);
  let shown = 0;
  let muted = store.pref('shortsMuted', true);

  ctx.el.innerHTML = `<div class="shorts" role="feed" aria-label="Shorts">
    <div class="shorts__hint glass" ${store.pref('shortsHint', false) ? 'hidden' : ''}>${icon('down')} Swipe for the next clip</div>
  </div>`;
  document.body.classList.add('is-shorts');
  ctx.onLeave(() => document.body.classList.remove('is-shorts'));
  const feed = ctx.el.querySelector('.shorts');

  const slide = (f) => {
    const start = f.length ? Math.round(f.length * (0.15 + Math.random() * 0.45)) : 30;
    return `<article class="short" data-key="${esc(f.key)}" data-start="${start}" aria-label="${esc(f.title)}">
      <div class="short__bg"><img src="${esc(f.posterHd || f.poster)}" alt=""></div>
      <div class="short__frame"><img class="short__poster" src="${esc(f.still || f.backdropSm || f.posterHd)}" alt=""><div class="short__video"></div><div class="short__spinner spinner"></div></div>
      <div class="short__meta">
        <div class="eyebrow">${esc([f.year, f.director?.[0]].filter(Boolean).join(' · '))}</div>
        <h2>${esc(f.title)}</h2>
        <p>${esc([f.genres?.[0], f.runtime ? `${f.runtime} min` : '', `Clip from ${Math.floor(start / 60)}:${String(start % 60).padStart(2, '0')}`].filter(Boolean).join(' · '))}</p>
        <button class="btn btn--primary btn--sm" data-play="${esc(f.key)}">${icon('play')} Watch full</button>
      </div>
      <div class="short__rail">
        <button class="short__act ${store.inList(f.key) ? 'is-on' : ''}" data-list="${esc(f.key)}" aria-label="My List">${icon(store.inList(f.key) ? 'check' : 'plus')}<span>My List</span></button>
        <button class="short__act" data-share-short aria-label="Share">${icon('share')}<span>Share</span></button>
        <button class="short__act" data-mute aria-label="Sound">${icon(muted ? 'mute' : 'volume')}<span>${muted ? 'Muted' : 'Sound'}</span></button>
        <a class="short__act" href="${esc(f.href)}" aria-label="Details">${icon('info')}<span>Info</span></a>
      </div>
      <div class="short__progress"><i></i></div>
    </article>`;
  };

  const more = (n = 8) => {
    feed.insertAdjacentHTML('beforeend', order.slice(shown, shown + n).map(slide).join(''));
    shown += n;
    feed.querySelectorAll('.short:not([data-io])').forEach((s) => {
      s.dataset.io = '1';
      io.observe(s);
    });
  };

  // Play whichever slide is mostly on screen; keep one video element per neighbour.
  let active = null;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting && e.intersectionRatio > 0.6) activate(e.target);
    }
  }, { root: feed, threshold: [0.6] });

  function videoFor(s) {
    let v = s.querySelector('video');
    if (v) return v;
    const f = order.find((x) => x.key === s.dataset.key);
    v = document.createElement('video');
    Object.assign(v, { muted, playsInline: true, loop: false, preload: 'metadata' });
    v.src = api.iaStream(f.id, f.preview || f.file);
    const start = +s.dataset.start;
    v.addEventListener('loadedmetadata', () => (v.currentTime = Math.min(start, Math.max(0, (v.duration || start) - CLIP - 1))), { once: true });
    // Archive storage nodes blip: retry once, then the full-size encode, then move on to the next clip.
    let tries = 0;
    v.addEventListener('error', () => {
      tries++;
      if (tries === 1) v.src = api.iaStream(f.id, f.preview || f.file) + '?retry=1';
      else if (tries === 2 && f.preview && f.preview !== f.file) v.src = api.iaStream(f.id, f.file);
      else {
        s.classList.add('is-failed');
        if (active === s) setTimeout(() => active === s && feed.scrollBy({ top: feed.clientHeight, behavior: 'smooth' }), 900);
        return;
      }
      if (active === s) v.play().catch(() => {});
    });
    v.addEventListener('playing', () => s.classList.add('is-playing'));
    v.addEventListener('waiting', () => s.classList.remove('is-playing'));
    v.addEventListener('timeupdate', () => {
      const from = Math.min(start, Math.max(0, (v.duration || start) - CLIP - 1));
      const p = (v.currentTime - from) / CLIP;
      s.querySelector('.short__progress i').style.transform = `scaleX(${Math.max(0, Math.min(1, p))})`;
      if (p >= 1) v.currentTime = from; // loop the clip, not the film
    });
    s.querySelector('.short__video').appendChild(v);
    return v;
  }

  function activate(s) {
    if (active === s) return;
    active = s;
    const slides = [...feed.querySelectorAll('.short')];
    const i = slides.indexOf(s);
    slides.forEach((x, k) => {
      const v = x.querySelector('video');
      if (Math.abs(k - i) > 1 && v) { v.pause(); v.removeAttribute('src'); v.load(); v.remove(); x.classList.remove('is-playing'); }
      else if (k !== i && v) v.pause();
    });
    const v = videoFor(s);
    v.muted = muted;
    v.play().catch(() => {});
    if (slides[i + 1]) videoFor(slides[i + 1]).preload = 'auto';
    if (i > shown - 4) more();
    if (i > 0 && !store.pref('shortsHint', false)) {
      store.setPref('shortsHint', true);
      feed.querySelector('.shorts__hint')?.setAttribute('hidden', '');
    }
  }

  feed.addEventListener('click', async (e) => {
    const m = e.target.closest('[data-mute]');
    if (m) {
      muted = !muted;
      store.setPref('shortsMuted', muted);
      feed.querySelectorAll('video').forEach((v) => (v.muted = muted));
      feed.querySelectorAll('[data-mute]').forEach((b) => (b.innerHTML = `${icon(muted ? 'mute' : 'volume')}<span>${muted ? 'Muted' : 'Sound'}</span>`));
      return haptic();
    }
    if (e.target.closest('[data-share-short]')) {
      const f = order.find((x) => x.key === e.target.closest('.short').dataset.key);
      const url = location.origin + f.href;
      try {
        if (navigator.share) await navigator.share({ title: f.title, text: `Watch ${f.title} free on Lumen`, url });
        else { await navigator.clipboard.writeText(url); toast('Link copied'); }
      } catch {}
      return;
    }
    // Tap the clip itself: first tap turns the sound on, later taps pause/play.
    if (e.target.closest('.short__frame')) {
      const v = e.target.closest('.short').querySelector('video');
      if (!v) return;
      if (muted) {
        feed.querySelector('[data-mute]')?.click();
      } else v.paused ? v.play() : v.pause();
    }
  });

  const onKey = (e) => {
    if (!['ArrowDown', 'ArrowUp', 'j', 'k'].includes(e.key) || document.querySelector('.player, .palette.is-open')) return;
    e.preventDefault();
    feed.scrollBy({ top: (e.key === 'ArrowDown' || e.key === 'j' ? 1 : -1) * feed.clientHeight, behavior: 'smooth' });
  };
  document.addEventListener('keydown', onKey);
  ctx.onLeave(() => {
    document.removeEventListener('keydown', onKey);
    io.disconnect();
    feed.querySelectorAll('video').forEach((v) => { v.pause(); v.removeAttribute('src'); v.load(); });
  });
  const pauseAll = () => feed.querySelectorAll('video').forEach((v) => v.pause());
  const resume = () => ctx.alive() && active?.querySelector('video')?.play().catch(() => {});
  document.addEventListener('player:open', pauseAll);
  document.addEventListener('player:closed', resume);
  ctx.onLeave(() => {
    document.removeEventListener('player:open', pauseAll);
    document.removeEventListener('player:closed', resume);
  });

  more(6);
}
