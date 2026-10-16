// Full-screen glass player for Internet Archive streams.
// Resume, keyboard shortcuts, double-tap seek, PiP, AirPlay, speed, lock-screen controls.
import { iaItem, iaStream } from './api.js';
import { store } from './store.js';
import { esc, icon, fmtTime, toast } from './ui.js';

let el = null;
let current = null;
let cleanup = [];

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

export async function play(item) {
  if (!item.file) {
    try {
      const full = await iaItem(item.id);
      item = { ...full, ...item, file: full.file, genres: item.genres?.length ? item.genres : full.genres };
    } catch {
      return toast('This title is unavailable right now', 'info');
    }
  }
  if (!item.file) return toast('No streamable file for this title', 'info');
  open(item);
}

function open(item) {
  item = { ...item };
  close(true);
  current = item;
  el = document.createElement('div');
  el.className = 'player is-loading show-ui';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', `Playing ${item.title}`);
  el.innerHTML = `
    <video playsinline preload="auto" x-webkit-airplay="allow"></video>
    <div class="player__spinner"></div>
    <div class="player__tap player__tap--l">${icon('back10')}</div>
    <div class="player__tap player__tap--r">${icon('fwd10')}</div>
    <div class="player__toast"></div>
    <div class="player__error"><div><h3>Couldn’t load this stream</h3><p style="color:var(--text-2)">The Internet Archive may be busy. Try again in a moment.</p>
      <button class="btn btn--primary" data-act="retry">Try again</button></div></div>
    <div class="player__ui">
      <div class="player__top">
        <button class="p-btn" data-act="close" aria-label="Close player">${icon('x')}</button>
        <div class="player__title"><strong>${esc(item.title)}</strong><span>${esc([item.year, item.director?.[0]].filter(Boolean).join(' · '))}</span></div>
      </div>
      <div class="player__center">
        <button class="p-btn" data-act="back" aria-label="Back 10 seconds">${icon('back10')}</button>
        <button class="p-btn p-btn--big" data-act="toggle" aria-label="Play or pause">${icon('pause')}</button>
        <button class="p-btn" data-act="fwd" aria-label="Forward 10 seconds">${icon('fwd10')}</button>
      </div>
      <div class="player__bottom">
        <div class="player__bar">
          <span data-cur>0:00</span>
          <div class="scrub" role="slider" aria-label="Seek" tabindex="0" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
            <div class="scrub__track"><div class="scrub__buf"></div><div class="scrub__fill"></div></div>
            <div class="scrub__tip">0:00</div>
          </div>
          <span data-left>-0:00</span>
        </div>
        <div class="player__controls">
          <div class="vol"><button class="p-btn p-btn--ghost" data-act="mute" aria-label="Mute">${icon('volume')}</button><input type="range" min="0" max="1" step="0.05" value="1" aria-label="Volume"></div>
          <div class="spacer"></div>
          <button class="speed" data-act="speed" aria-label="Playback speed">1×</button>
          ${'webkitShowPlaybackTargetPicker' in HTMLVideoElement.prototype ? `<button class="p-btn p-btn--ghost" data-act="airplay" aria-label="AirPlay">${icon('airplay')}</button>` : ''}
          ${document.pictureInPictureEnabled ? `<button class="p-btn p-btn--ghost" data-act="pip" aria-label="Picture in picture">${icon('pip')}</button>` : ''}
          <button class="p-btn p-btn--ghost" data-act="fs" aria-label="Full screen">${icon('expand')}</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(el);
  const root = el;
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => root.classList.add('is-open'));

  const v = root.querySelector('video');
  const $ = (s) => root.querySelector(s);
  const scrub = $('.scrub');
  const toggleBtn = $('[data-act="toggle"]');
  const muteBtn = $('[data-act="mute"]');
  const volInput = $('.vol input');

  v.src = iaStream(item.id, item.file);
  v.volume = store.pref('volume', 1);
  volInput.value = v.volume;
  v.playbackRate = store.pref('speed', 1);
  $('[data-act="speed"]').textContent = `${v.playbackRate}×`;

  const saved = store.progress(item.key);
  const resumeAt = saved && saved.t / saved.d < 0.95 ? saved.t : 0;
  v.addEventListener('loadedmetadata', () => {
    if (resumeAt > 5) {
      v.currentTime = resumeAt;
      flash(`Resuming at ${fmtTime(resumeAt)}`);
    }
  }, { once: true });
  v.play().catch(() => root.classList.add('is-paused'));

  // --- UI auto-hide
  let hideTimer;
  const poke = () => {
    root.classList.add('show-ui');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => !v.paused && root.classList.remove('show-ui'), 2800);
  };
  root.addEventListener('pointermove', poke);
  poke();

  // --- state sync
  const sync = () => {
    const d = v.duration || 0;
    const pct = d ? (v.currentTime / d) * 100 : 0;
    $('.scrub__fill').style.width = pct + '%';
    $('[data-cur]').textContent = fmtTime(v.currentTime);
    $('[data-left]').textContent = '-' + fmtTime(d - v.currentTime);
    scrub.setAttribute('aria-valuenow', pct.toFixed(0));
    if (v.buffered.length) $('.scrub__buf').style.width = (v.buffered.end(v.buffered.length - 1) / (d || 1)) * 100 + '%';
  };
  let lastLog = 0, lastSave = 0;
  v.addEventListener('timeupdate', () => {
    sync();
    const now = performance.now();
    if (!v.paused && lastLog) store.logWatch(item, Math.min(2, (now - lastLog) / 1000) * v.playbackRate);
    lastLog = now;
    if (now - lastSave > 5000) {
      store.setProgress(item, v.currentTime, v.duration);
      lastSave = now;
    }
  });
  v.addEventListener('pause', () => { lastLog = 0; root.classList.add('is-paused'); toggleBtn.innerHTML = icon('play'); store.setProgress(item, v.currentTime, v.duration); });
  v.addEventListener('play', () => { root.classList.remove('is-paused'); toggleBtn.innerHTML = icon('pause'); poke(); });
  v.addEventListener('waiting', () => root.classList.add('is-loading'));
  v.addEventListener('playing', () => root.classList.remove('is-loading', 'is-error'));
  v.addEventListener('canplay', () => root.classList.remove('is-loading'));
  v.addEventListener('progress', sync);
  // Archive storage nodes fail intermittently: retry with backoff, then try other encodes.
  let attempts = 0;
  let alts = null;
  const files = [item.file];
  v.addEventListener('error', async () => {
    const t = v.currentTime || resumeAt;
    attempts++;
    if (attempts > 3) {
      alts ??= item.alts || (await iaItem(item.id).then((x) => x.alts || []).catch(() => []));
      const next = alts.find((f) => !files.includes(f));
      if (!next) return root.classList.add('is-error');
      files.push(next);
      attempts = 0;
      item = { ...item, file: next };
    }
    setTimeout(() => {
      if (!el || root.querySelector('video') !== v) return;
      v.src = iaStream(item.id, item.file) + (attempts ? `?retry=${attempts}` : '');
      v.addEventListener('loadedmetadata', () => (v.currentTime = t), { once: true });
      v.play().catch(() => {});
    }, 600 * Math.max(1, attempts));
  });
  v.addEventListener('ended', () => { store.setProgress(item, v.duration, v.duration); flash('Finished'); });
  v.addEventListener('volumechange', () => {
    muteBtn.innerHTML = icon(v.muted || v.volume === 0 ? 'mute' : 'volume');
    volInput.value = v.muted ? 0 : v.volume;
    store.setPref('volume', v.volume);
  });

  // --- actions
  const seek = (delta) => {
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + delta));
    poke();
  };
  const actions = {
    close: () => close(),
    toggle: () => (v.paused ? v.play() : v.pause()),
    back: () => seek(-10),
    fwd: () => seek(10),
    mute: () => (v.muted = !v.muted),
    retry: () => { root.classList.remove('is-error'); attempts = 0; const t = v.currentTime || resumeAt; v.src = iaStream(item.id, item.file) + '?retry=' + Date.now(); v.addEventListener('loadedmetadata', () => (v.currentTime = t), { once: true }); v.play().catch(() => {}); },
    speed: (btn) => {
      const next = SPEEDS[(SPEEDS.indexOf(v.playbackRate) + 1) % SPEEDS.length] || 1;
      v.playbackRate = next;
      btn.textContent = `${next}×`;
      store.setPref('speed', next);
      flash(`${next}× speed`);
    },
    pip: async () => {
      try {
        if (document.pictureInPictureElement) await document.exitPictureInPicture();
        else await v.requestPictureInPicture();
      } catch { toast('Picture in Picture isn’t available here', 'info'); }
    },
    airplay: () => v.webkitShowPlaybackTargetPicker?.(),
    fs: () => toggleFullscreen(v),
  };
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (btn) return actions[btn.dataset.act]?.(btn);
    if (e.target === v && matchMedia('(hover: hover)').matches) actions.toggle();
  });
  volInput.addEventListener('input', () => { v.volume = +volInput.value; v.muted = v.volume === 0; });

  // double-tap left/right to seek on touch
  let lastTap = 0;
  v.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'touch') return;
    const now = Date.now();
    const x = e.clientX / window.innerWidth;
    if (now - lastTap < 300 && (x < 0.34 || x > 0.66)) {
      const right = x > 0.66;
      seek(right ? 10 : -10);
      const tap = root.querySelector(right ? '.player__tap--r' : '.player__tap--l');
      tap.classList.add('is-on');
      setTimeout(() => tap.classList.remove('is-on'), 450);
      lastTap = 0;
    } else {
      lastTap = now;
      root.classList.contains('show-ui') && !v.paused ? root.classList.remove('show-ui') : poke();
    }
  });

  // scrubbing
  const pctFrom = (e) => {
    const r = scrub.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };
  scrub.addEventListener('pointermove', (e) => {
    const p = pctFrom(e);
    const tip = $('.scrub__tip');
    tip.style.left = p * 100 + '%';
    tip.textContent = fmtTime(p * (v.duration || 0));
  });
  scrub.addEventListener('pointerdown', (e) => {
    scrub.setPointerCapture(e.pointerId);
    scrub.classList.add('is-drag');
    const move = (ev) => {
      v.currentTime = pctFrom(ev) * (v.duration || 0);
      sync();
    };
    move(e);
    const up = () => {
      scrub.classList.remove('is-drag');
      scrub.removeEventListener('pointermove', move);
    };
    scrub.addEventListener('pointermove', move);
    scrub.addEventListener('pointerup', up, { once: true });
  });

  // keyboard
  const onKey = (e) => {
    if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
    const k = e.key.toLowerCase();
    const map = {
      ' ': actions.toggle, k: actions.toggle, arrowleft: () => seek(-5), arrowright: () => seek(5), j: () => seek(-10), l: () => seek(10),
      f: actions.fs, m: actions.mute, p: actions.pip, escape: () => !document.fullscreenElement && close(),
      arrowup: () => { v.volume = Math.min(1, v.volume + 0.1); flash(`Volume ${Math.round(v.volume * 100)}%`); },
      arrowdown: () => { v.volume = Math.max(0, v.volume - 0.1); flash(`Volume ${Math.round(v.volume * 100)}%`); },
    };
    if (map[k]) {
      e.preventDefault();
      e.stopPropagation();
      map[k]();
      poke();
    } else if (/^[0-9]$/.test(k) && v.duration) {
      v.currentTime = (v.duration * +k) / 10;
    }
  };
  document.addEventListener('keydown', onKey, true);
  cleanup.push(() => document.removeEventListener('keydown', onKey, true));

  // lock screen / hardware media keys
  if ('mediaSession' in navigator) {
    const art = item.posterHd || item.poster;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: item.title,
      artist: (item.director || []).join(', ') || 'Lumen',
      album: item.year ? String(item.year) : 'Lumen',
      artwork: art ? [{ src: art, sizes: '512x768', type: 'image/jpeg' }] : [],
    });
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', () => v.play());
    ms.setActionHandler('pause', () => v.pause());
    ms.setActionHandler('seekbackward', () => seek(-10));
    ms.setActionHandler('seekforward', () => seek(10));
    try { ms.setActionHandler('seekto', (d) => (v.currentTime = d.seekTime)); } catch {}
  }

  const onPop = () => close(true);
  history.pushState({ player: true }, '', location.href);
  window.addEventListener('popstate', onPop, { once: true });
  cleanup.push(() => window.removeEventListener('popstate', onPop));

  function flash(msg) {
    const t = $('.player__toast');
    t.textContent = msg;
    t.classList.add('is-on');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('is-on'), 1100);
  }
}

function toggleFullscreen(v) {
  const target = v.closest('.player');
  if (document.fullscreenElement) return document.exitFullscreen();
  if (target.requestFullscreen) return target.requestFullscreen().catch(() => {});
  if (v.webkitEnterFullscreen) v.webkitEnterFullscreen(); // iOS Safari
}

export function close(fromHistory = false) {
  if (!el) return;
  const v = el.querySelector('video');
  if (current && v.duration) store.setProgress(current, v.currentTime, v.duration);
  v.pause();
  v.removeAttribute('src');
  v.load();
  cleanup.forEach((fn) => fn());
  cleanup = [];
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  const dead = el;
  el = null;
  current = null;
  dead.classList.remove('is-open');
  setTimeout(() => dead.remove(), 400);
  document.body.style.overflow = '';
  if (!fromHistory && history.state?.player) history.back();
  document.dispatchEvent(new CustomEvent('player:closed'));
}
