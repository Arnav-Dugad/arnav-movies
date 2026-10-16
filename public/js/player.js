// Full-screen glass player for Internet Archive streams.
// App-icon launch · smart resume recap · subtitles in many languages (OpenSubtitles + AI translation of
// English captions) with remembered styling · scene thumbnails · skip intro · up next / autoplay ·
// series queues · cinema mode · picture tuning · de-flicker / steady restoration · sleep timer ·
// Chromecast · AirPlay · PiP · swipe-down to close · keyboard shortcuts · lock-screen controls ·
// stream-failure reporting with automatic fallback.
import { iaItem, iaStream, catalog, nextEpisode, subtitleText, subtitleLangs, report, deadFiles, config } from './api.js';
import { store } from './store.js';
import { esc, icon, fmtTime, toast, haptic } from './ui.js';
import { similar } from './recs.js';
import { dragDismiss } from './gestures.js';
import { castAvailable, castMedia, onCastEnd } from './cast.js';
import { parseVTT, SubtitleRenderer, Translator, subStyle, applySubStyle, SUB_SIZES, SUB_FONTS, SUB_BACKS, SUB_COLORS, TRANSLATE_TO, langName } from './subs.js';

let el = null;
let current = null;
let cleanup = [];
let origin = null; // { key, rect } of the element the player launched from

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
const SLEEP = [0, 15, 30, 45, 60, -1]; // minutes; -1 = end of title
const LOOKS = {
  original: { label: 'Original', b: 1, c: 1, s: 1 },
  restore: { label: 'Restore old print', b: 1.06, c: 1.16, s: 1.05 },
  vivid: { label: 'Vivid', b: 1.03, c: 1.1, s: 1.3 },
  night: { label: 'Night', b: 0.88, c: 0.95, s: 0.9 },
};
const RESTORE = { off: 'Off', deflicker: 'De-flicker', steady: 'Steady + de-flicker' };

const seriesKey = (item) => item.series || item.title.split(/\s[-–|:]\s|\s(?:S\d+|Season|Episode|Ep\.?)\s*\d/i)[0].trim().toLowerCase();
const hash = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7).toString(16);
const ago = (ts) => {
  const h = (Date.now() - ts) / 3600e3;
  return h < 1 ? 'just now' : h < 24 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} day${h >= 48 ? 's' : ''} ago`;
};

/**
 * Play an item. `from` is the element tapped (the player grows out of it like an app icon);
 * `queue` is an ordered list of episodes so "next" follows the series.
 */
export async function play(item, { from = null, queue = null } = {}) {
  haptic();
  const rect = from?.getBoundingClientRect?.();
  origin = rect && rect.width > 20 ? { key: item.key, rect } : null;
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
  open(item, queue);
}

function open(item, queue) {
  close(true, true);
  item = { ...item };
  current = item;
  const isEp = item.kind === 'episode';
  const art = item.backdrop || item.posterHd || item.poster || '';
  const subtitle = isEp
    ? [item.seriesTitle, item.s && item.e ? `S${item.s} · E${item.e}` : null].filter(Boolean).join(' · ')
    : [item.year, item.director?.[0]].filter(Boolean).join(' · ');
  el = document.createElement('div');
  el.className = 'player is-loading show-ui';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', `Playing ${item.title}`);
  el.innerHTML = `
    <div class="player__bg" aria-hidden="true">${art ? `<img src="${esc(art)}" alt="">` : ''}</div>
    <div class="player__stage">
      <video playsinline preload="auto" x-webkit-airplay="allow"></video>
      <canvas class="player__canvas" hidden></canvas>
      <div class="player__launch" aria-hidden="true">${item.backdropSm || item.posterHd ? `<img src="${esc(item.backdropSm || item.posterHd)}" alt="">` : ''}</div>
      <div class="player__cues" aria-live="off"></div>
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
        <div class="player__title"><strong>${esc(item.title)}</strong><span>${esc(subtitle)}</span></div>
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
          <button class="p-btn p-btn--ghost" data-act="panel" data-panel="cc" aria-label="Subtitles and languages">${icon('cc')}</button>
          <button class="p-btn p-btn--ghost" data-act="scenes" aria-label="Scenes" hidden>${icon('scenes')}</button>
          <button class="p-btn p-btn--ghost" data-act="panel" data-panel="settings" aria-label="Picture, restoration and sleep timer">${icon('gear')}</button>
          <button class="p-btn p-btn--ghost" data-act="cinema" aria-label="Cinema mode">${icon('theater')}</button>
          ${document.pictureInPictureEnabled ? `<button class="p-btn p-btn--ghost" data-act="pip" aria-label="Picture in picture">${icon('pip')}</button>` : ''}
          <button class="p-btn p-btn--ghost" data-act="fs" aria-label="Full screen">${icon('expand')}</button>
        </div>
      </div>
      <div class="player__panel glass" data-no-drag hidden></div>
      <div class="scenes glass" data-no-drag hidden><div class="scenes__head"><strong>Scenes</strong><button class="icon-btn" data-act="scenes" aria-label="Close scenes">${icon('x')}</button></div><div class="scenes__strip"></div></div>
      <div class="upnext glass" data-no-drag hidden></div>
      <div class="recap glass" data-no-drag hidden></div>
    </div>`;
  document.body.appendChild(el);
  const root = el;
  document.body.style.overflow = 'hidden';
  launch(root);

  const v = root.querySelector('video');
  const $ = (s) => root.querySelector(s);
  const scrub = $('.scrub');
  const toggleBtn = $('[data-act="toggle"]');
  const muteBtn = $('[data-act="mute"]');
  const volInput = $('.vol input');
  const panel = $('.player__panel');
  const canvas = $('.player__canvas');
  const subs = new SubtitleRenderer(v, $('.player__cues'));
  cleanup.push(() => subs.destroy());
  let full = null; // full Archive metadata (thumbs, subtitles, alternates), loaded in the background
  let casting = false;

  v.src = iaStream(item.id, item.file);
  v.volume = store.pref('volume', 1);
  volInput.value = v.volume;
  v.playbackRate = store.pref('speed', 1);
  $('[data-act="speed"]').textContent = `${v.playbackRate}×`;
  if (store.pref('cinema', false)) root.classList.add('player--cinema');
  applyLook(store.pref('look', null));

  /* ------------------------------------------------------------ smart resume */
  const saved = store.progress(item.key);
  const resumeAt = saved && saved.t / saved.d < 0.95 && saved.t > 20 ? saved.t : 0;
  const startAt = resumeAt ? Math.max(0, resumeAt - 10) : 0; // back up 10 s so you catch the thread
  v.addEventListener('loadedmetadata', () => {
    if (startAt) v.currentTime = startAt;
  }, { once: true });
  v.addEventListener('playing', () => root.classList.add('is-started'), { once: true });
  v.play().catch(() => root.classList.add('is-paused'));
  if (resumeAt > 30) showRecap();

  iaItem(item.id).then((f) => {
    if (el !== root) return;
    full = f;
    item.alts ??= f.alts;
    item.subtitles = f.subtitles;
    setupScenes(f.thumbs);
    restoreSubtitles();
    if (resumeAt > 30) fillRecap();
  }).catch(() => {});

  // --- UI auto-hide
  let hideTimer;
  const poke = () => {
    root.classList.add('show-ui');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => !v.paused && panel.hidden && $('.recap').hidden && root.classList.remove('show-ui'), 3000);
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
    const t = v.currentTime || startAt;
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

  /* ------------------------------------------------------------ resume recap */
  function showRecap() {
    const box = $('.recap');
    box.hidden = false;
    box.innerHTML = `<div class="recap__head"><small>Previously</small><strong>You stopped at ${fmtTime(resumeAt)}</strong><span>${esc(ago(saved.at))} · rewound 10 seconds</span></div>
      <div class="recap__scenes"></div><div class="recap__lines"></div>
      <div class="recap__actions"><button class="btn btn--glass btn--sm" data-act="restart">Start over</button><button class="btn btn--primary btn--sm" data-act="recap-close">Keep watching</button></div>
      <i class="recap__timer"></i>`;
    const hide = setTimeout(() => (box.hidden = true), 10000);
    cleanup.push(() => clearTimeout(hide));
  }
  async function fillRecap() {
    const box = $('.recap');
    if (box.hidden) return;
    const shots = [resumeAt - 240, resumeAt - 120, resumeAt - 30].map((t) => thumbAt(Math.max(0, t))).filter((x, i, a) => x && a.indexOf(x) === i);
    box.querySelector('.recap__scenes').innerHTML = shots.map((s) => `<img src="${esc(s.url)}" alt="">`).join('');
    // Last few lines of dialogue before you stopped, from the captions.
    const src = full?.subtitles?.[0];
    if (!src) return;
    try {
      const cues = parseVTT(await subtitleText(item, { source: 'ia', ...src }));
      const tmp = new SubtitleRenderer({ currentTime: 0 }, document.createElement('div'));
      tmp.cues = cues;
      const lines = tmp.linesBefore(resumeAt, 3);
      tmp.destroy();
      if (lines.length && !box.hidden) box.querySelector('.recap__lines').innerHTML = lines.map((l) => `<p>“${esc(l)}”</p>`).join('');
    } catch {}
  }

  /* --------------------------------------------------------------- skip intro */
  const sKey = 'intro:' + seriesKey(item);
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
      if (queue?.length) {
        const i = queue.findIndex((x) => x.key === item.key);
        nextItem = i >= 0 ? queue[i + 1] || null : null;
      } else if (isEp) nextItem = await nextEpisode(item);
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
    const label = n.kind === 'episode' && n.s && n.e ? `S${n.s} · E${n.e}` : isEp ? 'Next episode' : 'Up next';
    upBox.hidden = false;
    upBox.innerHTML = `<div class="upnext__img">${n.still || n.backdropSm || n.poster ? `<img src="${esc(n.still || n.backdropSm || n.poster)}" alt="">` : ''}</div>
      <div class="upnext__body"><small>${esc(label)}</small><strong>${esc(n.title)}</strong>
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
  function lookFilter(look) {
    const l = look || LOOKS.original;
    return l.b === 1 && l.c === 1 && l.s === 1 ? '' : `brightness(${l.b}) contrast(${l.c}) saturate(${l.s})`;
  }
  function applyLook(look) {
    v.style.filter = canvas.style.filter = lookFilter(look);
  }

  /* --------------------------------------------- restoration (de-flicker / steady) */
  // Archive streams can't be read pixel by pixel (no CORS), but they can be *drawn*. Blending each new
  // frame over the last smooths frame-to-frame brightness flicker and grain; "steady" also crops the
  // jittery frame edges (gate weave) and blends more strongly.
  let restoreMode = store.pref('restore', 'off');
  let frameReq = 0, fresh = true;
  const ctx2d = canvas.getContext('2d', { alpha: false });
  const stopRestore = () => {
    if (frameReq) (v.cancelVideoFrameCallback ? v.cancelVideoFrameCallback(frameReq) : cancelAnimationFrame(frameReq));
    frameReq = 0;
  };
  function drawFrame() {
    frameReq = 0;
    if (restoreMode === 'off' || el !== root) return;
    const w = v.videoWidth, h = v.videoHeight;
    if (w && h) {
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        fresh = true;
      }
      const crop = restoreMode === 'steady' ? 0.035 : 0;
      ctx2d.globalAlpha = fresh ? 1 : restoreMode === 'steady' ? 0.38 : 0.55;
      ctx2d.drawImage(v, w * crop, h * crop, w * (1 - 2 * crop), h * (1 - 2 * crop), 0, 0, w, h);
      fresh = false;
    }
    frameReq = v.requestVideoFrameCallback ? v.requestVideoFrameCallback(drawFrame) : requestAnimationFrame(drawFrame);
  }
  function setRestore(mode) {
    restoreMode = mode;
    store.setPref('restore', mode);
    stopRestore();
    const on = mode !== 'off';
    canvas.hidden = !on;
    v.classList.toggle('is-hidden', on);
    fresh = true;
    if (on) drawFrame();
  }
  v.addEventListener('seeked', () => (fresh = true)); // don't ghost across a jump
  if (restoreMode !== 'off') v.addEventListener('loadeddata', () => setRestore(restoreMode), { once: true });
  cleanup.push(stopRestore);

  /* --------------------------------------------------------------- subtitles */
  let activeSub = null; // { kind: 'ia' | 'os' | 'tr', label, ... }
  let english = null; // { cues, src } — the English source used for translation
  const subStatus = (msg) => {
    const badge = $('.player__cues');
    badge.dataset.status = msg || '';
  };

  async function loadEnglish() {
    if (english) return english;
    const { opensubtitles } = await config();
    const tries = [];
    if (opensubtitles && item.imdb) tries.push(['os', { source: 'os', lang: 'en' }, `os:${item.imdb}:en`]);
    (full?.subtitles || []).forEach((s) => tries.push(['ia', { source: 'ia', ...s }, `ia:${item.id}:${hash(s.file)}`]));
    for (const [, choice, src] of tries) {
      try {
        const cues = parseVTT(await subtitleText(item, choice));
        if (cues.length > 20) return (english = { cues, src });
      } catch {}
    }
    return null;
  }

  async function chooseSubs(choice, announce = true) {
    subs.translator?.stop();
    subs.translator = null;
    subStatus('');
    activeSub = choice;
    store.setPref('subLang', choice ? choice.pref : null);
    if (!choice) {
      subs.set([]);
      return announce && flash('Subtitles off');
    }
    try {
      if (choice.kind === 'tr') {
        const en = await loadEnglish();
        if (!en) throw new Error('no source');
        if (el !== root) return;
        new Translator(subs, en.cues, {
          lang: choice.lang,
          src: en.src,
          onStatus: (s) => subStatus(s === 'working' ? 'Translating…' : s === 'budget' ? 'Translation paused for today' : ''),
        });
      } else {
        const cues = parseVTT(await subtitleText(item, choice.kind === 'os' ? { source: 'os', lang: choice.lang } : { source: 'ia', ...choice.file }));
        if (!cues.length) throw new Error('empty');
        if (el !== root) return;
        subs.set(cues);
        if (choice.lang === 'en' || choice.kind === 'ia') english ??= { cues, src: choice.kind === 'os' ? `os:${item.imdb}:en` : `ia:${item.id}:${hash(choice.file.file)}` };
      }
      announce && flash(choice.label);
    } catch {
      activeSub = null;
      subs.set([]);
      announce && toast('Subtitles aren’t available in that language for this title', 'info');
    }
  }

  async function subtitleOptions() {
    const { opensubtitles } = await config();
    const archive = (full?.subtitles || item.subtitles || []).map((s) => ({ kind: 'ia', label: `${s.label}`, file: s, pref: 'ia' }));
    const osLangs = opensubtitles && item.imdb ? await subtitleLangs(item.imdb) : [];
    const os = osLangs.slice(0, 14).map((l) => ({ kind: 'os', lang: l, label: langName(l), pref: 'os:' + l }));
    const canTranslate = archive.length || osLangs.includes('en');
    const native = new Set(osLangs.map((l) => l.split('-')[0]));
    const tr = canTranslate ? TRANSLATE_TO.filter((l) => !native.has(l)).map((l) => ({ kind: 'tr', lang: l, label: `${langName(l)} (translated)`, pref: 'tr:' + l })) : [];
    return { archive, os, tr };
  }

  async function restoreSubtitles() {
    const want = store.pref('subLang', null);
    if (!want) return;
    const { archive, os, tr } = await subtitleOptions();
    // Same language as last time; English captions stand in for each other, other languages don't.
    const pick = [...os, ...archive, ...tr].find((o) => o.pref === want) || (want === 'ia' || want === 'os:en' ? archive[0] || os.find((o) => o.lang === 'en') : null);
    if (pick && el === root) chooseSubs(pick, false);
  }

  async function renderPanel(kind) {
    panel.hidden = false;
    panel.dataset.kind = kind;
    if (kind === 'cc') {
      panel.innerHTML = `<div class="panel__title">Subtitles</div><div class="panel__loading"><span class="spinner"></span></div>`;
      const { archive, os, tr } = await subtitleOptions();
      if (el !== root || panel.dataset.kind !== 'cc') return;
      const all = [{ kind: 'off', label: 'Off', pref: null }, ...os, ...archive];
      const isOn = (o) => (activeSub?.pref || null) === o.pref;
      const st = subStyle();
      panel.innerHTML = `<div class="panel__title">Subtitles</div>
        ${all.map((o, i) => `<button class="panel__opt ${isOn(o) ? 'is-on' : ''}" data-sub="${i}">${esc(o.label)}${o.kind === 'ia' ? ' <small>Archive</small>' : o.kind === 'os' ? ' <small>OpenSubtitles</small>' : ''}${isOn(o) ? icon('check') : ''}</button>`).join('')}
        ${all.length === 1 && !tr.length ? `<p class="panel__note">No subtitles found for this title.</p>` : ''}
        ${tr.length ? `<div class="panel__title">Translate captions</div>
          <label class="panel__select"><select data-tr aria-label="Translate captions into">
            <option value="">Choose a language…</option>${tr.map((o, i) => `<option value="${i}" ${isOn(o) ? 'selected' : ''}>${esc(o.label.replace(' (translated)', ''))}</option>`).join('')}
          </select></label><p class="panel__note">Translated live from the English captions with Workers AI, starting where you are.</p>` : ''}
        <div class="panel__title">Style</div>
        <div class="panel__row"><span>Size</span><div class="panel__chips">${Object.keys(SUB_SIZES).map((k) => `<button class="pill ${st.size === k ? 'is-active' : ''}" data-st="size" data-v="${k}">${k.toUpperCase()}</button>`).join('')}</div></div>
        <div class="panel__row"><span>Font</span><div class="panel__chips">${Object.entries(SUB_FONTS).map(([k, f]) => `<button class="pill ${st.font === k ? 'is-active' : ''}" data-st="font" data-v="${k}">${esc(f.label)}</button>`).join('')}</div></div>
        <div class="panel__row"><span>Background</span><div class="panel__chips">${Object.entries(SUB_BACKS).map(([k, l]) => `<button class="pill ${st.back === k ? 'is-active' : ''}" data-st="back" data-v="${k}">${l}</button>`).join('')}</div></div>
        <div class="panel__row"><span>Colour</span><div class="panel__chips">${Object.entries(SUB_COLORS).map(([k, c]) => `<button class="swatch ${st.color === k ? 'is-active' : ''}" data-st="color" data-v="${k}" style="--c:${c}" aria-label="${k}"></button>`).join('')}</div></div>
        <div class="sub-preview" data-back="${st.back}"><span class="cue">The quick brown fox jumps over the lazy dog.</span></div>`;
      const preview = panel.querySelector('.sub-preview');
      applySubStyle(preview, st);
      panel.onclick = (e) => {
        const b = e.target.closest('[data-sub]');
        if (b) {
          const o = all[+b.dataset.sub];
          chooseSubs(o.kind === 'off' ? null : o);
          return hidePanel();
        }
        const s = e.target.closest('[data-st]');
        if (s) {
          const next = { ...subStyle(), [s.dataset.st]: s.dataset.v };
          store.setPref('subStyle', next);
          applySubStyle($('.player__cues'), next);
          renderPanel('cc');
        }
      };
      panel.onchange = (e) => {
        if (e.target.matches('[data-tr]') && e.target.value !== '') {
          chooseSubs(tr[+e.target.value]);
          hidePanel();
        }
      };
      panel.oninput = null;
    } else {
      const look = store.pref('look', null);
      const lookName = Object.keys(LOOKS).find((k) => LOOKS[k].label === look?.label) || (look ? 'custom' : 'original');
      const l = look || LOOKS.original;
      panel.innerHTML = `<div class="panel__title">Picture</div>
        <div class="panel__chips">${Object.entries(LOOKS).map(([k, x]) => `<button class="pill ${lookName === k ? 'is-active' : ''}" data-look="${k}">${esc(x.label)}</button>`).join('')}</div>
        <label class="panel__range">Brightness<input type="range" min="0.6" max="1.5" step="0.02" value="${l.b}" data-k="b"></label>
        <label class="panel__range">Contrast<input type="range" min="0.6" max="1.6" step="0.02" value="${l.c}" data-k="c"></label>
        <label class="panel__range">Color<input type="range" min="0" max="1.6" step="0.05" value="${l.s}" data-k="s"></label>
        <div class="panel__title">Old-print restoration</div>
        <div class="panel__chips">${Object.entries(RESTORE).map(([k, x]) => `<button class="pill ${restoreMode === k ? 'is-active' : ''}" data-restore="${k}">${x}</button>`).join('')}</div>
        <p class="panel__note">Blends frames to calm flicker and grain; Steady also trims the wobbling frame edges.</p>
        <div class="panel__title">Sleep timer</div>
        <div class="panel__chips">${SLEEP.map((m) => `<button class="pill ${sleepMode === m ? 'is-active' : ''}" data-sleep="${m}">${m === 0 ? 'Off' : m === -1 ? 'End of title' : m + ' min'}</button>`).join('')}</div>
        ${isEp ? `<label class="panel__toggle"><span>Autoplay next episode</span><input type="checkbox" ${store.pref('autoplay', true) ? 'checked' : ''} data-autoplay switch></label>` : ''}`;
      panel.onclick = (e) => {
        const lk = e.target.closest('[data-look]');
        const sl = e.target.closest('[data-sleep]');
        const rs = e.target.closest('[data-restore]');
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
        if (rs) {
          setRestore(rs.dataset.restore);
          flash(RESTORE[rs.dataset.restore]);
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
    restart: () => { v.currentTime = 0; $('.recap').hidden = true; v.play().catch(() => {}); },
    'recap-close': () => { $('.recap').hidden = true; v.play().catch(() => {}); },
    retry: () => { root.classList.remove('is-error'); attempts = 0; const t = v.currentTime || startAt; v.src = iaStream(item.id, item.file) + '?retry=' + Date.now(); v.addEventListener('loadedmetadata', () => (v.currentTime = t), { once: true }); v.play().catch(() => {}); },
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
      close(true, true);
      history.replaceState({ scroll: 0 }, '', location.href); // the player's entry becomes a normal one
      play(n, { queue });
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
      const ok = await castMedia({ url: iaStream(item.id, item.file), title: item.title, subtitle, image: item.posterHd || item.poster, time: v.currentTime });
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
  cleanup.push(dragDismiss(root, { onDismiss: () => close(false, true), ignore: '.scrub, .player__panel, .scenes, .upnext, .recap, input, select, .vol', scale: true }));

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
    if ((e.target.tagName === 'INPUT' && e.target.type !== 'range') || e.target.tagName === 'SELECT') return;
    const k = e.key.toLowerCase();
    const map = {
      ' ': actions.toggle, k: actions.toggle, arrowleft: () => seek(-5), arrowright: () => seek(5), j: () => seek(-10), l: () => seek(10),
      f: actions.fs, m: actions.mute, p: actions.pip, t: actions.cinema, s: actions.scenes,
      c: () => (activeSub ? chooseSubs(null) : renderPanel('cc')),
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

  // lock screen / hardware media keys
  if ('mediaSession' in navigator) {
    const artwork = item.posterHd || item.poster;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: item.title,
      artist: isEp ? item.seriesTitle || 'Lumen' : (item.director || []).join(', ') || 'Lumen',
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

/* ------------------------------------------------- app-icon launch / collapse */
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const insetFor = (r) => `inset(${r.top}px ${Math.max(0, innerWidth - r.right)}px ${Math.max(0, innerHeight - r.bottom)}px ${r.left}px round 22px)`;

function launch(root) {
  document.dispatchEvent(new CustomEvent('player:open'));
  if (!origin || reduced() || !root.animate) {
    requestAnimationFrame(() => root.classList.add('is-open'));
    return;
  }
  root.classList.add('is-open', 'is-launching');
  const a = root.animate(
    [{ clipPath: insetFor(origin.rect), opacity: 0.6 }, { clipPath: 'inset(0px 0px 0px 0px round 0px)', opacity: 1 }],
    { duration: 620, easing: 'cubic-bezier(.2, .9, .2, 1)' }
  );
  a.onfinish = () => root.classList.remove('is-launching');
}

function collapse(dead) {
  // Shrink back into the card we came from if it's still on screen; otherwise fade out.
  const sel = origin?.key && document.querySelector(`.card[data-key="${CSS.escape(origin.key)}"] .card__media, [data-launch-key="${CSS.escape(origin.key)}"]`);
  const r = sel?.getBoundingClientRect();
  if (r && r.width && !reduced() && dead.animate && r.bottom > 0 && r.top < innerHeight) {
    dead.classList.add('is-launching');
    dead.animate([{ clipPath: 'inset(0px 0px 0px 0px round 0px)', opacity: 1 }, { clipPath: insetFor(r), opacity: 0.4 }], { duration: 480, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'forwards' });
    setTimeout(() => dead.remove(), 470);
  } else {
    dead.classList.remove('is-open');
    setTimeout(() => dead.remove(), 400);
  }
}

function toggleFullscreen(v) {
  const target = v.closest('.player');
  if (document.fullscreenElement) return document.exitFullscreen();
  if (target.requestFullscreen) return target.requestFullscreen().catch(() => {});
  if (v.webkitEnterFullscreen) v.webkitEnterFullscreen(); // iOS Safari
}

export function close(fromHistory = false, instant = false) {
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
  if (instant) {
    dead.remove();
  } else collapse(dead);
  document.body.style.overflow = '';
  if (!fromHistory && history.state?.player) history.back();
  document.dispatchEvent(new CustomEvent('player:closed'));
}
