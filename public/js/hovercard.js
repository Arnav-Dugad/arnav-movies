// Desktop hover cards: linger on a poster and it expands into a glass card with a muted trailer
// (or a preview clip, or a Ken Burns slideshow), scores, a blurb and quick actions.
import { previewsOn } from './prefs.js';
import { catalogDetail, iaStream, iaItem } from './api.js';
import { store } from './store.js';
import { esc, icon, ratingBadges, metaLine, ytEmbed, kenBurns, toast, haptic } from './ui.js';

const DELAY = 650;
let lookup = () => null;
let card = null, hc = null, openTimer = 0, closeTimer = 0, mediaTimer = 0, stopKb = () => {};

export function initHoverCards(find) {
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  lookup = find;
  document.addEventListener('pointerover', (e) => {
    if (e.target.closest?.('.hcard')) return clearTimeout(closeTimer);
    const c = e.target.closest?.('.row__track .card:not(.card--rank), .grid .card');
    if (!c || document.querySelector('.player, .modal, .palette.is-open')) return;
    if (c === card) return clearTimeout(closeTimer);
    clearTimeout(openTimer);
    openTimer = setTimeout(() => c.matches(':hover') && show(c), DELAY);
  });
  document.addEventListener('pointerout', (e) => {
    const to = e.relatedTarget;
    if (to?.closest?.('.hcard') || (card && card.contains(to))) return;
    if (e.target.closest?.('.card')) clearTimeout(openTimer);
    if (hc) closeTimer = setTimeout(hide, 140);
  });
  addEventListener('scroll', () => hc && hide(), { passive: true, capture: true });
  addEventListener('blur', () => hc && hide());
  document.addEventListener('player:open', hide);
}

function position(rect, w, h) {
  const m = 16;
  let left = rect.left + rect.width / 2 - w / 2;
  let top = rect.top + rect.height / 2 - h / 2;
  left = Math.max(m, Math.min(innerWidth - w - m, left));
  top = Math.max(76, Math.min(innerHeight - h - m, top));
  return { left, top };
}

async function show(c) {
  const item = lookup(c.dataset.key);
  if (!item) return;
  hide(true);
  card = c;
  const media = c.querySelector('.card__media');
  const rect = media.getBoundingClientRect();
  const w = Math.max(340, Math.min(420, rect.width * 1.6));
  const art = item.backdropSm || item.backdrop || item.still || item.posterHd || item.poster;
  hc = document.createElement('div');
  hc.className = 'hcard glass';
  hc.dataset.key = item.key;
  hc.style.width = w + 'px';
  hc.innerHTML = `
    <a class="hcard__media" href="${esc(item.href)}" data-key="${esc(item.key)}" data-launch-key="${esc(item.key)}">
      ${art ? `<img class="hcard__art" src="${esc(art)}" alt="">` : ''}
      <div class="hcard__layer"></div>
      ${item.logo ? `<img class="hcard__logo" src="${esc(item.logo)}" alt="${esc(item.title)}">` : ''}
    </a>
    <div class="hcard__body">
      <div class="hcard__actions">
        ${item.playable ? `<button class="btn btn--primary btn--sm" data-play="${esc(item.key)}">${icon('play')} Play</button>` : `<a class="btn btn--primary btn--sm" href="${esc(item.href)}">${icon('info')} Details</a>`}
        <button class="btn btn--glass btn--round btn--sm ${store.inList(item.key) ? 'is-on' : ''}" data-list="${esc(item.key)}" aria-label="My List">${icon(store.inList(item.key) ? 'check' : 'plus')}</button>
        <a class="btn btn--glass btn--round btn--sm" href="${esc(item.href)}" aria-label="Details">${icon('info')}</a>
        <span class="spacer"></span>
        <button class="btn btn--glass btn--round btn--sm" data-nope aria-label="Not interested" title="Not interested">${icon('x')}</button>
        <button class="btn btn--glass btn--round btn--sm" data-hc-mute aria-label="Unmute" hidden>${icon('mute')}</button>
      </div>
      <div class="hcard__title">${item.logo ? '' : esc(item.title)}</div>
      <div class="chips">${ratingBadges(item.rating, { small: true })}${metaLine(item, { max: 3 })}</div>
      <p class="hcard__blurb">${esc(item.overview || '')}</p>
    </div>`;
  document.body.appendChild(hc);
  const h = hc.offsetHeight;
  const { left, top } = position(rect, w, h);
  Object.assign(hc.style, { left: left + 'px', top: top + 'px' });
  // Grow out of the card.
  const sx = rect.width / w, sy = rect.height / (w * 9 / 16);
  hc.animate(
    [{ transform: `translate(${rect.left - left}px, ${rect.top - top}px) scale(${sx}, ${sy})`, opacity: 0.2, transformOrigin: 'top left' },
     { transform: 'none', opacity: 1, transformOrigin: 'top left' }],
    { duration: 320, easing: 'cubic-bezier(.2,.9,.25,1)' }
  );
  const mine = hc;
  hc.addEventListener('click', (e) => {
    if (e.target.closest('[data-nope]')) {
      e.preventDefault();
      store.dismiss(item);
      haptic();
      const gone = card;
      hide();
      gone?.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.9)' }], { duration: 260, fill: 'forwards' }).finished.then(() => gone.remove());
      toast('Got it — we’ll show fewer like this', 'check');
    }
    if (e.target.closest('[data-hc-mute]')) {
      const f = mine.querySelector('iframe');
      const v = mine.querySelector('video');
      const btn = mine.querySelector('[data-hc-mute]');
      const muted = btn.dataset.muted !== '0';
      if (f) f.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: muted ? 'unMute' : 'mute', args: [] }), '*');
      if (v) v.muted = !muted;
      btn.dataset.muted = muted ? '0' : '1';
      btn.innerHTML = icon(muted ? 'volume' : 'mute');
    }
  });
  hc.addEventListener('pointerleave', (e) => {
    if (card?.contains(e.relatedTarget)) return;
    closeTimer = setTimeout(hide, 140);
  });

  // Motion after a beat: trailer → preview clip → slideshow.
  mediaTimer = setTimeout(async () => {
    if (hc !== mine) return;
    if (!previewsOn()) return; // Settings → Browsing (or data saver)
    const layer = mine.querySelector('.hcard__layer');
    const mute = mine.querySelector('[data-hc-mute]');
    if (item.trailer) {
      layer.innerHTML = `<iframe src="${esc(ytEmbed(item.trailer, { muted: true, controls: false }))}&enablejsapi=1" allow="autoplay; encrypted-media" tabindex="-1" title=""></iframe>`;
      setTimeout(() => hc === mine && mine.classList.add('is-live'), 1500);
      mute.hidden = false;
      return;
    }
    if (item.playable && item.kind !== 'series') {
      let file = item.preview || item.file, t = item.length ? item.length * 0.2 : 240;
      if (!file) {
        const full = await iaItem(item.id).catch(() => null);
        file = full?.preview;
        t = full?.length ? full.length * 0.2 : 240;
      }
      if (file && hc === mine) {
        const v = document.createElement('video');
        Object.assign(v, { muted: true, playsInline: true, preload: 'auto', src: iaStream(item.id, file) });
        v.addEventListener('loadedmetadata', () => (v.currentTime = Math.min(t, (v.duration || 1) * 0.6)), { once: true });
        v.addEventListener('playing', () => mine.classList.add('is-live'), { once: true });
        layer.appendChild(v);
        v.play().catch(() => {});
        mute.hidden = false;
        return;
      }
    }
    if (item.source === 'catalog') {
      await catalogDetail(item);
      if (hc === mine && item.slides?.length > 1) {
        stopKb = kenBurns(layer, item.slides, { interval: 3200 });
        mine.classList.add('is-live');
      }
    }
  }, 500);
}

function hide(instant) {
  clearTimeout(openTimer);
  clearTimeout(closeTimer);
  clearTimeout(mediaTimer);
  stopKb();
  stopKb = () => {};
  const dead = hc;
  hc = null;
  card = null;
  if (!dead) return;
  dead.querySelectorAll('video').forEach((v) => { v.pause(); v.removeAttribute('src'); v.load(); });
  if (instant === true) return dead.remove();
  dead.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.96)' }], { duration: 160, fill: 'forwards' }).finished.then(() => dead.remove());
}
