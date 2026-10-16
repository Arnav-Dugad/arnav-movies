// Full-screen glass player for Internet Archive streams.
// Resume · subtitles · scene thumbnails on the scrubber · skip intro · up next / autoplay ·
// cinema mode · picture tuning · sleep timer · Chromecast · AirPlay · PiP · swipe-down to close ·
// keyboard shortcuts · lock-screen controls · stream-failure reporting with automatic fallback.
import { iaItem, iaStream, catalog, nextEpisode, subtitleTrack, report, deadFiles, config } from './api.js';
import { store } from './store.js';
import { esc, icon, fmtTime, toast, haptic } from './ui.js';
import { similar } from './recs.js';
import { dragDismiss } from './gestures.js';
import { castAvailable, castMedia, onCastEnd } from './cast.js';

let el = null;
let current = null;
let cleanup = [];

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
const SLEEP = [0, 15, 30, 45, 60, -1]; // minutes; -1 = end of title
const LOOKS = {
  original: { label: 'Original', b: 1, c: 1, s: 1 },
  restore: { label: 'Restore old print', b: 1.06, c: 1.16, s: 1.05 },
  vivid: { label: 'Vivid', b: 1.03, c: 1.1, s: 1.3 },
  night: { label: 'Night', b: 0.88, c: 0.95, s: 0.9 },
};

const seriesKey = (title) => title.split(/\s[-–|:]\s|\s(?:S\d+|Season|Episode|Ep\.?)\s*\d/i)[0].trim().toLowerCase();

export async function play(item) {
  haptic();
  if (!item.file) {
    try {
      const full = await iaItem(item.id);
      item = { ...full, ...item, file: full.file, alts: full.alts, genres: item.genres?.length ? item.genres : full.genres };
    } catch {
      return toast('This title is unavailable right now', 'info');
    }
  }
  if (!item.file) return toast('No streamable file for this title', 'info');
  // Skip files the health checker has flagged as dead.
  const dead = await deadFiles();
  if (dead.has(item.id + '|' + item.file)) {
    const full = await iaItem(item.id).catch(() => null);
    const alt = full?.alts?.find((f) => !dead.has(item.id + '|' + f));
    if (alt) item = { ...item, file: alt };
  }
  open(item);
}

function open(item) {
  close(true);
  item = { ...item };
  current = item;
  const isEp = item.kind === 'episode';
  const art = item.backdrop || item.posterHd || item.poster || '';
  el = document.createElement('div');
  el.className = 'player is-loading show-ui';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', `Playing ${item.title}`);
  el.innerHTML = `
    <div class="player__bg" aria-hidden="true">${art ? `<img src="${esc(art)}" alt="">` : ''}</div>
    <div class="player__stage">
      <video playsinline preload="auto" x-webkit-airplay="allow"></video>
      <div class="player__spinner"></div>
      <div class="player__tap player__tap--l">${icon('back10')}</div>
      <div class="player__tap player__tap--r">${icon('fwd10')}</div>
      <div class="player__toast"></div>
      <div class="player__casting"><div>${icon('cast')}<strong>Casting to your TV</strong><span>Use the controls here to play, pause and seek.</span></div></div>
      <div class="player__error"><div><h3>Couldn’t load this stream</h3><p style="color:var(--text-2)">The Internet Archive may be busy. Try again in a moment.</p>
        <button class="btn btn--primary" data-act="retry">Try again</button></div></div>
    </div>
    <div class="player__ui">
      <div class="player__top">
        <button class="p-btn" data-act="close" aria-label="Close player">${icon('x')}</button>
        <div class="player__title"><strong>${esc(item.title)}</strong><span>${esc([item.year, item.director?.[0]].filter(Boolean).join(' · '))}</span></div>
        <div class="spacer"></div>
        ${castAvailable() ? `<button class="p-btn p-btn--ghost" data-act="cast" aria-label="Cast to TV">${icon('cast')}</button>` : ''}
        ${'webkitShowPlaybackTargetPicker' in HTMLVideoElement.prototype ? `<button class="p-btn p-btn--ghost" data-act="airplay" aria-label="AirPlay">${icon('airplay')}</button>` : ''}
      </div>
      <div class="player__center">
        <button class="p-btn" data-act="back" aria-label="Back 10 seconds">${icon('back10')}</button>
        <button class="p-btn p-btn--big" data-act="toggle" aria-label="Play or pause">${icon('pause')}</button>
        <button class="p-btn" data-act="fwd" aria-label="Forward 10 seconds">${icon('fwd10')}</button>
      </div>
      <div class="player__bottom">
        <button class="skip-pill glass" data-act="skip" hidden>Skip intro ${icon('right')}</button>
        <div class="player__bar">
          <span data-cur>0:00</span>
          <div class="scrub" role="slider" aria-label="Seek" tabindex="0" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
            <div class="scrub__track"><div class="scrub__buf"></div><div class="scrub__fill"></div></div>
            <div class="scrub__ticks"></div>
            <div class="scrub__tip"><div class="scrub__thumb"></div><span>0:00</span></div>
          </div>
          <span data-left>-0:00</span>
        </div>
        <div class="player__controls">
          <div class="vol"><button class="p-btn p-btn--ghost" data-act="mute" aria-label="Mute">${icon('volume')}</button><input type="range" min="0" max="1" step="0.05" value="1" aria-label="Volume"></div>
          <div class="spacer"></div>
          <button class="speed" data-act="speed" aria-label="Playback speed">1×</button>
          <button class="p-btn p-btn--ghost" data-act="panel" data-panel="cc" aria-label="Subtitles">${icon('cc')}</button>
          <button class="p-btn p-btn--ghost" data-act="scenes" aria-label="Scenes" hidden>${icon('scenes')}</button>
          <button class="p-btn p-btn--ghost" data-act="panel" data-panel="settings" aria-label="Picture and sleep timer">${icon('gear')}</button>
          <button class="p-btn p-btn--ghost" data-act="cinema" aria-label="Cinema mode">${icon('theater')}</button>
          ${document.pictureInPictureEnabled ? `<button class="p-btn p-btn--ghost" data-act="pip" aria-label="Picture in picture">${icon('pip')}</button>` : ''}
          <button class="p-btn p-btn--ghost" data-act="fs" aria-label="Full screen">${icon('expand')}</button>
        </div>
      </div>
      <div class="player__panel glass" data-no-drag hidden></div>
      <div class="scenes glass" data-no-drag hidden><div class="scenes__head"><strong>Scenes</strong><button class="icon-btn" data-act="scenes" aria-label="Close scenes">${icon('x')}</button></div><div class="scenes__strip"></div></div>
      <div class="upnext glass" data-no-drag hidden></div>
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
  const panel = $('.player__panel');
  let full = null; // full Archive metadata (thumbs, subtitles, alternates), loaded in the background
  let casting = false;

  v.src = iaStream(item.id, item.file);
  v.volume = store.pref('volume', 1);
  volInput.value = v.volume;
  v.playbackRate = store.pref('speed', 1);
  $('[data-act="speed"]').textContent = `${v.playbackRate}×`;
  if (store.pref('cinema', false)) root.classList.add('player--cinema');
  applyLook(store.pref('look', null));

  const saved = store.progress(item.key);
  const resumeAt = saved && saved.t / saved.d < 0.95 ? saved.t : 0;
  v.addEventListener('loadedmetadata', () => {
    if (resumeAt > 5) {
      v.currentTime = resumeAt;
      flash(`Resuming at ${fmtTime(resumeAt)}`);
    }
  }, { once: true });
  v.play().catch(() => root.classList.add('is-paused'));

  iaItem(item.id).then((f) => {
    if (el !== root) return;
    full = f;
    item.alts ??= f.alts;
    item.subtitles = f.subtitles;
    setupScenes(f.thumbs);
    const want = store.pref('subs', null);
    if (want && f.subtitles?.length) chooseSubs({ source: 'ia', ...f.subtitles[0] }, false);
  }).catch(() => {});

  // --- UI auto-hide
  let hideTimer;
  const poke = () => {
    root.classList.add('show-ui');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => !v.paused && panel.hidden && root.classList.remove('show-ui'), 3000);
  };
  root.addEventListener('pointermove', (e) => e.pointerType === 'mouse' && poke());
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

  let lastLog = 0, lastSave = 0, reported = false, errored = false;
  v.addEventListener('timeupdate', () => {
    sync();
    const now = performance.now();
    if (!v.paused && lastLog) store.logWatch(item, Math.min(2, (now - lastLog) / 1000) * v.playbackRate);
    lastLog = now;
    if (now - lastSave > 5000) {
      store.setProgress(item, v.currentTime, v.duration);
      lastSave = now;
    }
    intro();
    upNextTick();
    sleepTick();
  });
  v.addEventListener('pause', () => { lastLog = 0; root.classList.add('is-paused'); toggleBtn.innerHTML = icon('play'); store.setProgress(item, v.currentTime, v.duration); });
  v.addEventListener('play', () => { root.classList.remove('is-paused'); toggleBtn.innerHTML = icon('pause'); poke(); });
  v.addEventListener('waiting', () => root.classList.add('is-loading'));
  v.addEventListener('playing', () => {
    root.classList.remove('is-loading', 'is-error');
    if (!reported) { reported = true; report('play', item); }
    if (errored) { errored = false; report('recovered', item); }
  });
  v.addEventListener('canplay', () => root.classList.remove('is-loading'));
  v.addEventListener('progress', sync);
  v.addEventListener('ended', () => { store.setProgress(item, v.duration, v.duration); showUpNext(true); });
  v.addEventListener('volumechange', () => {
    muteBtn.innerHTML = icon(v.muted || v.volume === 0 ? 'mute' : 'volume');
    volInput.value = v.muted ? 0 : v.volume;
    store.setPref('volume', v.volume);
  });

  // Archive storage nodes fail intermittently: retry with backoff, then try other encodes.
  let attempts = 0;
  let alts = null;
  const files = [item.file];
  v.addEventListener('error', async () => {
    const t = v.currentTime || resumeAt;
    errored = true;
    attempts++;
    report('error', item, { code: v.error?.code });
    if (attempts > 3) {
      alts ??= item.alts || (await iaItem(item.id).then((x) => x.alts || []).catch(() => []));
      const next = alts.find((f) => !files.includes(f));
      if (!next) {
        report('dead', item);
        return root.classList.add('is-error');
      }
      files.push(next);
      attempts = 0;
      item.file = next;
      report('fallback', item);
    }
    setTimeout(() => {
      if (el !== root) return;
      v.src = iaStream(item.id, item.file) + (attempts ? `?retry=${attempts}` : '');
      v.addEventListener('loadedmetadata', () => (v.currentTime = t), { once: true });
      v.play().catch(() => {});
    }, 600 * Math.max(1, attempts));
  });

  /* ----------------------------------------------------------- scenes & thumbs */
  let thumbs = [];
  function setupScenes(list) {
    thumbs = list || [];
    if (thumbs.length < 4) return;
    $('[data-act="scenes"]').hidden = false;
    // Skip the black opening frames; spread up to 14 scenes evenly across the rest.
    const pool = thumbs.filter((x) => x.t >= 20).length >= 4 ? thumbs.filter((x) => x.t >= 20) : thumbs;
    const want = Math.min(14, pool.length);
    const step = (pool.length - 1) / (want - 1);
    const scenes = Array.from({ length: want }, (_, i) => pool[Math.round(i * step)]);
    $('.scenes__strip').innerHTML = scenes
      .map((s, i) => `<button class="scene" data-seek="${s.t}"><img src="${esc(s.url)}" alt="" loading="lazy"><span>${i + 1} · ${fmtTime(s.t)}</span></button>`)
      .join('');
    const drawTicks = () => {
      if (!v.duration) return;
      $('.scrub__ticks').innerHTML = scenes.slice(1).map((s) => `<i style="left:${(s.t / v.duration) * 100}%"></i>`).join('');
    };
    v.duration ? drawTicks() : v.addEventListener('loadedmetadata', drawTicks, { once: true });
  }
  const thumbAt = (t) => {
    let best = null;
    for (const th of thumbs) {
      if (th.t <= t) best = th;
      else break;
    }
    return best;
  };

  /* --------------------------------------------------------------- skip intro */
  const sKey = 'intro:' + seriesKey(item.title);
  const introEnd = () => store.pref(sKey, 75);
  const skipBtn = $('.skip-pill');
  function intro() {
    if (!isEp) return;
    const t = v.currentTime;
    skipBtn.hidden = !(t > 3 && t < introEnd() - 3);
  }
  // Learn each series' intro length from manual skips in the first few minutes.
  let lastT = 0;
  v.addEventListener('seeking', () => {
    if (isEp && lastT < 25 && v.currentTime > 30 && v.currentTime < 240) store.setPref(sKey, Math.round(v.currentTime));
  });
  v.addEventListener('timeupdate', () => (lastT = v.currentTime));

  /* ------------------------------------------------------------------ up next */
  let nextItem, nextLoading = false, upShown = false, countdown = 0;
  const upBox = $('.upnext');
  async function loadNext() {
    if (nextItem !== undefined || nextLoading) return nextItem;
    nextLoading = true;
    try {
      if (isEp) nextItem = await nextEpisode(item);
      else {
        const films = await catalog();
        const me = films.find((f) => f.id === item.id) || item;
        nextItem = similar(me, films, 1)[0] || null;
      }
    } catch {
      nextItem = null;
    }
    nextLoading = false;
    return nextItem;
  }
  function upNextTick() {
    const d = v.duration;
    if (!d || d < 120) return;
    if (d - v.currentTime < 150) loadNext();
    if (isEp && !upShown && d - v.currentTime < 25) showUpNext(false);
  }
  async function showUpNext(ended) {
    const n = await loadNext();
    if (!n || el !== root || (upShown && !ended)) return;
    upShown = true;
    const auto = isEp && store.pref('autoplay', true) && sleepMode !== -1;
    upBox.hidden = false;
    upBox.innerHTML = `<div class="upnext__img">${n.backdropSm || n.poster ? `<img src="${esc(n.backdropSm || n.poster)}" alt="">` : ''}</div>
      <div class="upnext__body"><small>${isEp ? 'Next episode' : 'Up next'}</small><strong>${esc(n.title)}</strong>
      <div class="upnext__actions"><button class="btn btn--primary btn--sm" data-act="next">${icon('play')} Play${auto ? ' <span data-count></span>' : ''}</button>
      <button class="btn btn--glass btn--sm" data-act="dismiss-next">Not now</button></div></div>`;
    if (auto && ended) {
      countdown = 8;
      const tick = () => {
        if (el !== root || upBox.hidden) return;
        const c = upBox.querySelector('[data-count]');
        if (c) c.textContent = `in ${countdown}`;
        if (countdown-- <= 0) return actions.next();
        setTimeout(tick, 1000);
      };
      tick();
    }
  }

  /* -------------------------------------------------------------- sleep timer */
  let sleepMode = 0, sleepAt = 0, baseVolume = v.volume;
  function setSleep(min) {
    sleepMode = min;
    sleepAt = min > 0 ? Date.now() + min * 60e3 : 0;
    flash(min === 0 ? 'Sleep timer off' : min === -1 ? 'Stops at end of title' : `Sleep in ${min} min`);
  }
  function sleepTick() {
    if (!sleepAt) return;
    const left = sleepAt - Date.now();
    if (left < 10000 && left > 0) {
      baseVolume = baseVolume || v.volume;
      v.volume = Math.max(0, baseVolume * (left / 10000));
    } else if (left <= 0) {
      sleepAt = 0;
      sleepMode = 0;
      v.pause();
      v.volume = baseVolume || 1;
      toast('Sleep timer: paused playback', 'moon');
    }
  }

  /* ------------------------------------------------------------------ picture */
  function applyLook(look) {
    const l = look || LOOKS.original;
    v.style.filter = l.b === 1 && l.c === 1 && l.s === 1 ? '' : `brightness(${l.b}) contrast(${l.c}) saturate(${l.s})`;
  }

  /* --------------------------------------------------------------- subtitles */
  let trackUrl = null, activeSub = null;
  async function chooseSubs(choice, announce = true) {
    [...v.querySelectorAll('track')].forEach((t) => t.remove());
    if (trackUrl) URL.revokeObjectURL(trackUrl);
    trackUrl = null;
    activeSub = choice;
    store.setPref('subs', choice ? 'on' : null);
    if (!choice) return announce && flash('Subtitles off');
    try {
      trackUrl = await subtitleTrack(item, choice);
      if (el !== root) return;
      const t = document.createElement('track');
      Object.assign(t, { kind: 'subtitles', label: choice.label, srclang: 'en', src: trackUrl, default: true });
      v.appendChild(t);
      t.track.mode = 'showing';
      announce && flash(choice.label);
    } catch {
      activeSub = null;
      announce && toast('Subtitles aren’t available for this title', 'info');
    }
  }

  async function renderPanel(kind) {
    if (kind === 'cc') {
      const { opensubtitles } = await config();
      const opts = [{ label: 'Off', choice: null }, ...(full?.subtitles || item.subtitles || []).map((s) => ({ label: s.label, choice: { source: 'ia', ...s } }))];
      if (opensubtitles && item.imdb) opts.push({ label: 'English (OpenSubtitles)', choice: { source: 'os', lang: 'en', label: 'English (OpenSubtitles)' } });
      panel.innerHTML = `<div class="panel__title">Subtitles</div>` +
        opts.map((o, i) => `<button class="panel__opt ${(activeSub?.label || 'Off') === o.label ? 'is-on' : ''}" data-sub="${i}">${esc(o.label)}${(activeSub?.label || 'Off') === o.label ? icon('check') : ''}</button>`).join('') +
        (opts.length === 1 ? `<p class="panel__note">No subtitle files for this title.</p>` : '');
      panel.onclick = (e) => {
        const b = e.target.closest('[data-sub]');
        if (!b) return;
        chooseSubs(opts[+b.dataset.sub].choice);
        hidePanel();
      };
    } else {
      const look = store.pref('look', null);
      const lookName = Object.keys(LOOKS).find((k) => LOOKS[k].label === look?.label) || (look ? 'custom' : 'original');
      const l = look || LOOKS.original;
      panel.innerHTML = `<div class="panel__title">Picture</div>
        <div class="panel__chips">${Object.entries(LOOKS).map(([k, x]) => `<button class="pill ${lookName === k ? 'is-active' : ''}" data-look="${k}">${esc(x.label)}</button>`).join('')}</div>
        <label class="panel__range">Brightness<input type="range" min="0.6" max="1.5" step="0.02" value="${l.b}" data-k="b"></label>
        <label class="panel__range">Contrast<input type="range" min="0.6" max="1.6" step="0.02" value="${l.c}" data-k="c"></label>
        <label class="panel__range">Color<input type="range" min="0" max="1.6" step="0.05" value="${l.s}" data-k="s"></label>
        <div class="panel__title">Sleep timer</div>
        <div class="panel__chips">${SLEEP.map((m) => `<button class="pill ${sleepMode === m ? 'is-active' : ''}" data-sleep="${m}">${m === 0 ? 'Off' : m === -1 ? 'End of title' : m + ' min'}</button>`).join('')}</div>
        ${isEp ? `<label class="panel__toggle"><span>Autoplay next episode</span><input type="checkbox" ${store.pref('autoplay', true) ? 'checked' : ''} data-autoplay switch></label>` : ''}`;
      panel.onclick = (e) => {
        const lk = e.target.closest('[data-look]');
        const sl = e.target.closest('[data-sleep]');
        if (lk) {
          const x = LOOKS[lk.dataset.look];
          store.setPref('look', lk.dataset.look === 'original' ? null : x);
          applyLook(x);
          renderPanel('settings');
        }
        if (sl) {
          setSleep(+sl.dataset.sleep);
          renderPanel('settings');
        }
      };
      panel.oninput = (e) => {
        const k = e.target.dataset.k;
        if (!k) return;
        const cur = { ...(store.pref('look', null) || LOOKS.original), label: 'Custom' };
        cur[k] = +e.target.value;
        store.setPref('look', cur);
        applyLook(cur);
      };
      panel.onchange = (e) => e.target.matches('[data-autoplay]') && store.setPref('autoplay', e.target.checked);
    }
    panel.hidden = false;
    panel.dataset.kind = kind;
  }
  const hidePanel = () => {
    panel.hidden = true;
    panel.dataset.kind = '';
  };

  /* ------------------------------------------------------------------ actions */
  const seek = (delta) => {
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + delta));
    poke();
  };
  const actions = {
    close: () => close(),
    toggle: () => {
      haptic(6);
      if (casting) return remoteToggle();
      v.paused ? v.play() : v.pause();
    },
    back: () => seek(-10),
    fwd: () => seek(10),
    mute: () => (v.muted = !v.muted),
    skip: () => { v.currentTime = introEnd(); skipBtn.hidden = true; haptic(); },
    retry: () => { root.classList.remove('is-error'); attempts = 0; const t = v.currentTime || resumeAt; v.src = iaStream(item.id, item.file) + '?retry=' + Date.now(); v.addEventListener('loadedmetadata', () => (v.currentTime = t), { once: true }); v.play().catch(() => {}); },
    speed: (btn) => {
      const next = SPEEDS[(SPEEDS.indexOf(v.playbackRate) + 1) % SPEEDS.length] || 1;
      v.playbackRate = next;
      btn.textContent = `${next}×`;
      store.setPref('speed', next);
      flash(`${next}× speed`);
    },
    panel: (btn) => (panel.dataset.kind === btn.dataset.panel ? hidePanel() : renderPanel(btn.dataset.panel)),
    scenes: () => {
      const s = $('.scenes');
      s.hidden = !s.hidden;
      hidePanel();
    },
    cinema: () => {
      const on = root.classList.toggle('player--cinema');
      store.setPref('cinema', on);
      flash(on ? 'Cinema mode' : 'Full bleed');
      haptic();
    },
    next: () => {
      const n = nextItem;
      if (!n) return;
      close(true);
      history.replaceState({ scroll: 0 }, '', location.href); // the player's entry becomes a normal one
      play(n);
    },
    'dismiss-next': () => (upBox.hidden = true),
    pip: async () => {
      try {
        if (document.pictureInPictureElement) await document.exitPictureInPicture();
        else await v.requestPictureInPicture();
      } catch { toast('Picture in Picture isn’t available here', 'info'); }
    },
    airplay: () => v.webkitShowPlaybackTargetPicker?.(),
    cast: async () => {
      flash('Looking for TVs…');
      const ok = await castMedia({ url: iaStream(item.id, item.file), title: item.title, subtitle: [item.year, item.director?.[0]].filter(Boolean).join(' · '), image: item.posterHd || item.poster, time: v.currentTime });
      if (!ok) return toast('No Cast device connected', 'info');
      casting = true;
      v.pause();
      root.classList.add('is-casting');
      const off = onCastEnd(() => { casting = false; root.classList.remove('is-casting'); off(); });
      cleanup.push(off);
    },
    fs: () => toggleFullscreen(v),
  };
  function remoteToggle() {
    try {
      const rp = new cast.framework.RemotePlayer();
      new cast.framework.RemotePlayerController(rp).playOrPause();
    } catch {}
  }

  root.addEventListener('click', (e) => {
    const sceneBtn = e.target.closest('[data-seek]');
    if (sceneBtn) {
      v.currentTime = +sceneBtn.dataset.seek;
      $('.scenes').hidden = true;
      return v.play().catch(() => {});
    }
    const btn = e.target.closest('[data-act]');
    if (btn) return actions[btn.dataset.act]?.(btn);
    if (!e.target.closest('.player__panel')) hidePanel();
    if (e.target.closest('.player__stage') && matchMedia('(hover: hover)').matches) actions.toggle();
  });
  volInput.addEventListener('input', () => { v.volume = +volInput.value; v.muted = v.volume === 0; });

  // double-tap left/right to seek on touch; single tap toggles the UI
  let lastTap = 0;
  $('.player__stage').addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'touch') return;
    const now = Date.now();
    const x = e.clientX / innerWidth;
    if (now - lastTap < 300 && (x < 0.34 || x > 0.66)) {
      const right = x > 0.66;
      seek(right ? 10 : -10);
      const tap = root.querySelector(right ? '.player__tap--r' : '.player__tap--l');
      tap.classList.add('is-on');
      haptic(6);
      setTimeout(() => tap.classList.remove('is-on'), 450);
      lastTap = 0;
    } else {
      lastTap = now;
      root.classList.contains('show-ui') && !v.paused ? root.classList.remove('show-ui') : poke();
    }
  });

  // swipe down to close (mobile)
  cleanup.push(dragDismiss(root, { onDismiss: () => close(), ignore: '.scrub, .player__panel, .scenes, .upnext, input, .vol' , scale: true }));

  // scrubbing with thumbnail preview
  const pctFrom = (e) => {
    const r = scrub.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };
  const showTip = (p) => {
    const tip = $('.scrub__tip');
    const r = scrub.getBoundingClientRect();
    const t = p * (v.duration || 0);
    const half = thumbs.length ? 84 : 24;
    tip.style.left = Math.min(r.width - half, Math.max(half, p * r.width)) + 'px';
    tip.querySelector('span').textContent = fmtTime(t);
    const th = thumbAt(t);
    const box = tip.querySelector('.scrub__thumb');
    box.hidden = !th;
    if (th && box.dataset.src !== th.url) {
      box.dataset.src = th.url;
      box.style.backgroundImage = `url("${th.url}")`;
    }
  };
  scrub.addEventListener('pointermove', (e) => showTip(pctFrom(e)));
  scrub.addEventListener('pointerdown', (e) => {
    scrub.setPointerCapture(e.pointerId);
    scrub.classList.add('is-drag');
    const move = (ev) => {
      const p = pctFrom(ev);
      v.currentTime = p * (v.duration || 0);
      showTip(p);
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
  scrub.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') e.stopPropagation();
  });

  // keyboard
  const onKey = (e) => {
    if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
    const k = e.key.toLowerCase();
    const map = {
      ' ': actions.toggle, k: actions.toggle, arrowleft: () => seek(-5), arrowright: () => seek(5), j: () => seek(-10), l: () => seek(10),
      f: actions.fs, m: actions.mute, p: actions.pip, t: actions.cinema, s: actions.scenes,
      c: () => (activeSub ? chooseSubs(null) : (full?.subtitles?.length ? chooseSubs({ source: 'ia', ...full.subtitles[0] }) : renderPanel('cc'))),
      escape: () => (!panel.hidden ? hidePanel() : !$('.scenes').hidden ? ($('.scenes').hidden = true) : !document.fullscreenElement && close()),
      arrowup: () => { v.volume = Math.min(1, v.volume + 0.1); flash(`Volume ${Math.round(v.volume * 100)}%`); },
      arrowdown: () => { v.volume = Math.max(0, v.volume - 0.1); flash(`Volume ${Math.round(v.volume * 100)}%`); },
    };
    if (map[k]) {
      e.preventDefault();
      e.stopPropagation();
      map[k]();
      if (el === root) poke();
    } else if (/^[0-9]$/.test(k) && v.duration) {
      v.currentTime = (v.duration * +k) / 10;
    }
  };
  document.addEventListener('keydown', onKey, true);
  cleanup.push(() => document.removeEventListener('keydown', onKey, true));
  cleanup.push(() => trackUrl && URL.revokeObjectURL(trackUrl));

  // lock screen / hardware media keys
  if ('mediaSession' in navigator) {
    const artwork = item.posterHd || item.poster;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: item.title,
      artist: (item.director || []).join(', ') || 'Lumen',
      album: item.year ? String(item.year) : 'Lumen',
      artwork: artwork ? [{ src: artwork, sizes: '512x768', type: 'image/jpeg' }] : [],
    });
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', () => v.play());
    ms.setActionHandler('pause', () => v.pause());
    ms.setActionHandler('seekbackward', () => seek(-10));
    ms.setActionHandler('seekforward', () => seek(10));
    try { ms.setActionHandler('seekto', (d) => (v.currentTime = d.seekTime)); } catch {}
    try { ms.setActionHandler('nexttrack', isEp ? async () => { await loadNext(); actions.next(); } : null); } catch {}
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
