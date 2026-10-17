// Full-screen glass player for Internet Archive streams.
// App-icon launch · smart resume recap · subtitles in many languages (OpenSubtitles + AI translation of
// English captions) with remembered styling · scene thumbnails · skip intro · up next / autoplay ·
// series queues · cinema mode · picture tuning · de-flicker / steady restoration · sleep timer ·
// Chromecast · AirPlay · PiP · swipe-down to close · keyboard shortcuts · lock-screen controls ·
// stream-failure reporting with automatic fallback.
import { iaItem, iaStream, catalog, catalogDetail, nextEpisode, subtitleText, subtitleLangs, report, deadFiles, config, nasaStream, crowdMarks, postMark, trivia } from './api.js';
import { store } from './store.js';
import { esc, icon, fmtTime, toast, haptic, feedback } from './ui.js';
import { reducedMotion, dataSaver } from './prefs.js';
import { similar } from './recs.js';
import { dragDismiss } from './gestures.js';
import { castAvailable, castMedia, onCastEnd } from './cast.js';
import { parseVTT, SubtitleRenderer, Translator, subStyle, applySubStyle, SUB_SIZES, SUB_FONTS, SUB_BACKS, SUB_COLORS, TRANSLATE_TO, langName } from './subs.js';

let el = null;
let current = null;
let cleanup = [];
let origin = null; // { key, rect } of the element the player launched from

export const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
const SLEEP = [0, 15, 30, 45, 60, -1]; // minutes; -1 = end of title
export const LOOKS = {
  original: { label: 'Original', b: 1, c: 1, s: 1 },
  restore: { label: 'Restore old print', b: 1.06, c: 1.16, s: 1.05 },
  vivid: { label: 'Vivid', b: 1.03, c: 1.1, s: 1.3 },
  night: { label: 'Night', b: 0.88, c: 0.95, s: 0.9 },
};
export const RESTORE = { off: 'Off', deflicker: 'De-flicker', steady: 'Steady + de-flicker' };

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
export async function play(item, { from = null, queue = null, at = null, quote = null, mini = false } = {}) {
  feedback('play', from);
  const rect = from?.getBoundingClientRect?.();
  origin = rect && rect.width > 20 ? { key: item.key, rect } : null;
  if (item.source === 'nasa') {
    // NASA videos come straight from NASA's own asset store.
    try {
      const { src, srt } = await nasaStream(item);
      if (!src) throw new Error('no mp4');
      return open({ ...item, stream: src, srt }, queue, { at, quote, mini });
    } catch {
      return toast('This NASA video is unavailable right now', 'info');
    }
  }
  if (item.slug && !item.detailed) await catalogDetail(item).catch(() => {}); // skip points + extra info
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
  open(item, queue, { at, quote, mini });
}

function open(item, queue, { at = null, quote = null, mini = false } = {}) {
  close(true, true);
  item = { ...item };
  current = item;
  const isEp = item.kind === 'episode';
  const art = item.backdrop || item.posterHd || item.poster || '';
  const seekStep = store.pref('seekStep', 10); // Settings → Playback
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
      <div class="player__subs"><div class="player__cues" aria-live="off"></div><div class="player__cues player__cues--second" aria-live="off"></div></div>
      <div class="player__sleep" aria-hidden="true"></div>
      <div class="player__curtain" aria-hidden="true">
        <i class="curtain curtain--l"></i><i class="curtain curtain--r"></i><b class="curtain__valance"></b>
        <div class="player__marquee"><small>${esc(item.programmeLabel || 'Now showing')}</small><span>${esc(item.title)}</span>${item.year ? `<em>${esc(item.year)}</em>` : ''}</div>
      </div>
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
        <button class="p-btn p-btn--ghost" data-act="mini" aria-label="Keep playing while you browse" title="Mini player">${icon('down')}</button>
        <div class="player__title"><strong>${esc(item.title)}</strong><span>${esc(subtitle)}</span></div>
        <div class="spacer"></div>
        ${castAvailable() ? `<button class="p-btn p-btn--ghost" data-act="cast" aria-label="Cast to TV">${icon('cast')}</button>` : ''}
        ${'webkitShowPlaybackTargetPicker' in HTMLVideoElement.prototype ? `<button class="p-btn p-btn--ghost" data-act="airplay" aria-label="AirPlay">${icon('airplay')}</button>` : ''}
      </div>
      <div class="player__bottom">
        <button class="skip-pill glass" data-act="skip" hidden><span data-skip-label>Skip intro</span> ${icon('right')}</button>
        <span class="smart-chip glass" hidden>${icon('bolt')} <span data-smart>Smart Speed</span></span>
        <div class="player__bar">
          <span data-cur>0:00</span>
          <div class="scrub" role="slider" aria-label="Seek" tabindex="0" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
            <div class="scrub__track"><div class="scrub__buf"></div><div class="scrub__fill"></div></div>
            <div class="scrub__ticks"></div>
            <div class="scrub__tip"><div class="scrub__thumb"></div><span>0:00</span><p class="scrub__line" hidden></p></div>
          </div>
          <span data-left>-0:00</span>
        </div>
        <div class="player__controls">
          <button class="p-btn p-btn--ghost" data-act="back" aria-label="Back ${seekStep} seconds">${icon('back10')}</button>
          <button class="p-btn p-btn--ghost p-btn--play" data-act="toggle" aria-label="Play or pause">${icon('pause')}</button>
          <button class="p-btn p-btn--ghost" data-act="fwd" aria-label="Forward ${seekStep} seconds">${icon('fwd10')}</button>
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
    </div>
    <div class="player__mini" data-no-drag>
      <button class="mini__body" data-act="expand" aria-label="Back to full screen"><strong>${esc(item.title)}</strong><span>${esc(subtitle || 'Now playing')}</span></button>
      <button class="p-btn p-btn--ghost" data-act="toggle" aria-label="Play or pause">${icon('pause')}</button>
      <button class="p-btn p-btn--ghost" data-act="expand" aria-label="Full screen">${icon('expand')}</button>
      <button class="p-btn p-btn--ghost" data-act="close" aria-label="Close">${icon('x')}</button>
      <i class="mini__progress"><b></b></i>
    </div>`;
  document.body.appendChild(el);
  const root = el;
  document.body.style.overflow = 'hidden';
  launch(root);

  const v = root.querySelector('video');
  const $ = (s) => root.querySelector(s);
  const scrub = $('.scrub');
  const setToggle = (name) => root.querySelectorAll('[data-act="toggle"]').forEach((b) => (b.innerHTML = icon(name)));
  const muteBtn = $('[data-act="mute"]');
  const volInput = $('.vol input');
  const panel = $('.player__panel');
  const canvas = $('.player__canvas');
  const subs = new SubtitleRenderer(v, $('.player__cues'));
  const subs2 = new SubtitleRenderer(v, $('.player__cues--second')); // second language, for learners
  cleanup.push(() => subs.destroy(), () => subs2.destroy());
  let full = null; // full Archive metadata (thumbs, subtitles, alternates), loaded in the background
  let casting = false;

  const streamUrl = () => item.stream || iaStream(item.id, item.file);
  v.src = streamUrl();
  v.volume = store.pref('volume', 1);
  volInput.value = v.volume;
  // Speed is remembered per title (falls back to your last speed anywhere).
  const speedKey = 'speed:' + item.key;
  let baseRate = store.pref(speedKey, store.pref('speed', 1));
  v.playbackRate = baseRate;
  $('[data-act="speed"]').textContent = `${v.playbackRate}×`;
  if (store.pref('cinema', false)) root.classList.add('player--cinema');
  applyLook(store.pref('look', null));

  /* ------------------------------------------------------------ smart resume */
  const saved = store.progress(item.key);
  const resumeAt = saved && saved.t / saved.d < 0.95 && saved.t > 20 ? saved.t : 0;
  const rewind = store.pref('resumeRewind', 10); // back up a little so you catch the thread
  const startAt = at != null ? Math.max(0, at) : resumeAt ? Math.max(0, resumeAt - rewind) : 0;
  v.addEventListener('loadedmetadata', () => {
    if (startAt) v.currentTime = startAt;
  }, { once: true });
  v.addEventListener('playing', () => {
    root.classList.add('is-started');
    // The cinema curtain parts once the picture is actually running (and again if you replay after it falls).
    root.classList.remove('is-curtain-closing');
    setTimeout(() => root.classList.add('is-curtain-open'), root.classList.contains('is-curtain-open') ? 0 : 160);
  });
  if (!store.pref('curtain', true) || reducedMotion()) root.classList.add('no-curtain');
  root.style.setProperty('--sub-lift', { low: '0%', mid: '6%', high: '14%' }[store.pref('subPos', 'low')] || '0%');
  v.play().catch(() => root.classList.add('is-paused'));
  const recapOn = resumeAt > 30 && at == null && store.pref('recap', true);
  if (recapOn) showRecap();

  (item.source === 'nasa' ? Promise.resolve({ subtitles: [], thumbs: [], alts: [] }) : iaItem(item.id)).then((f) => {
    if (el !== root) return;
    full = f;
    item.alts ??= f.alts;
    item.subtitles = f.subtitles;
    setupScenes(f.thumbs);
    restoreSubtitles();
    if (recapOn) fillRecap();
    detectMarks();
    if (quote) seekToQuote();
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
    $('.mini__progress b').style.width = pct + '%';
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
  v.addEventListener('pause', () => { lastLog = 0; root.classList.add('is-paused'); setToggle('play'); store.setProgress(item, v.currentTime, v.duration); });
  v.addEventListener('play', () => { root.classList.remove('is-paused'); setToggle('pause'); poke(); });
  v.addEventListener('waiting', () => root.classList.add('is-loading'));
  v.addEventListener('playing', () => {
    root.classList.remove('is-loading', 'is-error');
    if (!reported) { reported = true; report('play', item); }
    if (errored) { errored = false; report('recovered', item); }
  });
  v.addEventListener('canplay', () => root.classList.remove('is-loading'));
  v.addEventListener('progress', sync);
  v.addEventListener('ended', () => {
    store.setProgress(item, v.duration, v.duration);
    root.classList.remove('is-curtain-open'); // the curtain falls at the end, like a picture house
    root.classList.add('is-curtain-closing');
    showUpNext(true);
  });
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
      v.src = streamUrl() + (attempts ? `?retry=${attempts}` : '');
      v.addEventListener('loadedmetadata', () => (v.currentTime = t), { once: true });
      v.play().catch(() => {});
    }, 600 * Math.max(1, attempts));
  });

  /* ----------------------------------------------------------- scenes & thumbs */
  let thumbs = [];
  let sceneTimes = [];
  function setupScenes(list) {
    thumbs = list || [];
    if (thumbs.length < 4) return;
    $('[data-act="scenes"]').hidden = false;
    // Skip the black opening frames; spread up to 14 scenes evenly across the rest.
    const pool = thumbs.filter((x) => x.t >= 20).length >= 4 ? thumbs.filter((x) => x.t >= 20) : thumbs;
    const want = Math.min(14, pool.length);
    const step = (pool.length - 1) / (want - 1);
    const scenes = Array.from({ length: want }, (_, i) => pool[Math.round(i * step)]);
    sceneTimes = scenes.map((x) => x.t);
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
    box.innerHTML = `<div class="recap__head"><small>Previously</small><strong>You stopped at ${fmtTime(resumeAt)}</strong><span>${esc(ago(saved.at))}${rewind ? ` · rewound ${rewind} seconds` : ''}</span></div>
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

  /* ------------------------------------------------- skip intro / skip credits */
  // Best signal wins: viewers' agreed skips (crowd) > captions (first/last dialogue, exact) >
  // frame analysis of the opening titles and end credits (to about a minute) > your own past skips.
  const sKey = 'intro:' + seriesKey(item);
  const marks = { ti: item.marks?.ti ?? null, tc: item.marks?.tc ?? null, src: item.marks?.src || null };
  if (marks.ti == null && isEp && store.pref(sKey, null)) Object.assign(marks, { ti: store.pref(sKey), src: 'you' });
  crowdMarks(item.id).then((c) => {
    if (c.intro) Object.assign(marks, { ti: c.intro.t, src: 'crowd' });
    if (c.credits) marks.tc = c.credits.t;
  });
  async function detectMarks() {
    // Exact points from the English captions when the title has them.
    if (marks.src === 'captions' || marks.src === 'crowd') return;
    const src = full?.subtitles?.[0];
    if (!src) return;
    try {
      const cues = parseVTT(await subtitleText(item, { source: 'ia', ...src })).filter((c) => !/^[\[(♪]/.test(c.text));
      if (cues.length < 20 || el !== root) return;
      const first = cues.find((c, i) => cues[i + 2] && cues[i + 2].start - c.start < 90)?.start;
      const lastI = [...cues.keys()].reverse().find((i) => i >= 2 && cues[i].start - cues[i - 2].start < 90);
      if (first > 20) marks.ti = Math.max(0, first - 1.5);
      if (lastI != null && v.duration && v.duration - cues[lastI].end > 25) marks.tc = cues[lastI].end + 2;
      marks.src = 'captions';
      captionCues = cues;
    } catch {}
  }
  const skipBtn = $('.skip-pill');
  const skipLabel = $('[data-skip-label]');
  let skipKind = null;
  function intro() {
    const t = v.currentTime, d = v.duration || 0;
    let kind = null;
    if (marks.ti && t > 2 && t < marks.ti - 2) kind = 'intro';
    else if (marks.tc && d && t >= marks.tc && d - t > 8) kind = 'credits';
    if (kind !== skipKind) {
      skipKind = kind;
      skipBtn.hidden = !kind;
      if (kind) skipLabel.textContent = kind === 'intro' ? (isEp ? 'Skip intro' : 'Skip titles') : 'Skip credits';
      // Settings → Playback: skip automatically (once per kind, so you can still go back and watch).
      if (kind && !autoSkipped.has(kind) && store.pref(kind === 'intro' ? 'autoSkipIntro' : 'autoSkipCredits', false)) {
        autoSkipped.add(kind);
        flash(kind === 'intro' ? 'Skipped the opening titles' : 'Skipped the credits');
        actions.skip();
      }
    }
  }
  const autoSkipped = new Set();
  // Learn from manual skips: a jump forward early on marks where the opening ends.
  let lastT = 0;
  v.addEventListener('seeking', () => {
    const nt = v.currentTime;
    if (lastT < 30 && nt > 20 && nt < 600 && nt - lastT > 15 && skipKind !== 'intro') {
      if (isEp) store.setPref(sKey, Math.round(nt));
      postMark(item.id, 'intro', nt);
    }
  });
  v.addEventListener('timeupdate', () => (lastT = v.currentTime));
  const noteCredits = () => {
    const t = v.currentTime, d = v.duration || 0;
    if (d && t > d * 0.85 && d - t > 15 && skipKind !== 'credits') postMark(item.id, 'credits', t);
  };

  /* -------------------------------------------------------- jump to a quote */
  let captionCues = null;
  async function seekToQuote() {
    // The search index is cut into ~3-minute windows; find the exact line inside it.
    const src = full?.subtitles?.[0];
    if (!src) return;
    try {
      const cues = captionCues || parseVTT(await subtitleText(item, { source: 'ia', ...src }));
      const words = quote.q.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').split(/\s+/).filter((w) => w.length > 1);
      const near = cues.filter((c) => c.start >= quote.t - 30 && c.start <= quote.t + 240);
      let best = null, bestScore = 0;
      for (let i = 0; i < near.length; i++) {
        const text = (near[i].text + ' ' + (near[i + 1]?.text || '')).toLowerCase();
        const sc = words.filter((w) => text.includes(w)).length;
        if (sc > bestScore) { best = near[i]; bestScore = sc; }
      }
      if (best && el === root) {
        v.currentTime = Math.max(0, best.start - 2);
        flash(`“${best.text.slice(0, 60)}${best.text.length > 60 ? '…' : ''}”`);
      }
    } catch {}
  }

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
    if (!d || (d < 120 && !item.programme)) return;
    if (d - v.currentTime < 150) loadNext();
    if ((isEp || item.programme) && !upShown && d - v.currentTime < 25) showUpNext(false);
  }
  async function showUpNext(ended) {
    const n = await loadNext();
    if (!n || el !== root || (upShown && !ended)) return;
    upShown = true;
    const auto = (isEp || item.programme) && store.pref('autoplay', true) && sleepMode !== -1;
    const label = n.programmeLabel ? n.programmeLabel : n.kind === 'episode' && n.s && n.e ? `S${n.s} · E${n.e}` : isEp ? 'Next episode' : 'Up next';
    upBox.hidden = false;
    upBox.innerHTML = `<div class="upnext__img">${n.still || n.backdropSm || n.poster ? `<img src="${esc(n.still || n.backdropSm || n.poster)}" alt="">` : ''}</div>
      <div class="upnext__body"><small>${esc(label)}</small><strong>${esc(n.title)}</strong>
      <div class="upnext__actions"><button class="btn btn--primary btn--sm" data-act="next">${icon('play')} Play${auto ? ' <span data-count></span>' : ''}</button>
      <button class="btn btn--glass btn--sm" data-act="dismiss-next">Not now</button></div></div>
      <div class="upnext__trivia" hidden></div>`;
    // "Did you know…" between episodes and reels, from Wikipedia.
    trivia(isEp ? item.seriesTitle : (n.programme ? n.title : item.title), isEp ? null : item.wiki).then((facts) => {
      const box = upBox.querySelector('.upnext__trivia');
      if (!facts.length || !box || el !== root) return;
      box.hidden = false;
      box.innerHTML = `<small>${icon('sparkles')} Did you know…</small><p>${esc(facts[Math.floor(Math.random() * facts.length)])}</p>`;
    });
    if (auto && ended) {
      countdown = item.programme ? 6 : 8;
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
    const veil = $('.player__sleep');
    if (left < 30000 && left > 0) {
      // Picture and sound fade out together over the last 30 seconds.
      baseVolume = baseVolume || v.volume;
      v.volume = Math.max(0, baseVolume * (left / 30000));
      veil.style.opacity = String(1 - left / 30000);
    } else if (left <= 0) {
      sleepAt = 0;
      sleepMode = 0;
      v.pause();
      v.volume = baseVolume || 1;
      veil.style.opacity = '1';
      toast('Sleep timer: paused playback. Tap to wake.', 'moon');
      root.addEventListener('pointerdown', () => (veil.style.opacity = '0'), { once: true });
    }
  }

  /* -------------------------------------------------------------- smart speed */
  // Speeds through long pauses between lines of dialogue (using the captions), then drops back.
  let smart = store.pref('smartSpeed', false), timeSaved = 0, lastTick = 0, inGap = false;
  const smartChip = $('.smart-chip');
  const smartCues = () => (subs.cues.length > 20 ? subs.cues : captionCues || english?.cues || []);
  function smartTick() {
    const cues = smartCues();
    const now = performance.now();
    const dt = lastTick ? (now - lastTick) / 1000 : 0;
    lastTick = now;
    if (!smart || v.paused || cues.length < 20) {
      if (inGap) { inGap = false; v.playbackRate = baseRate; }
      return;
    }
    const t = v.currentTime;
    let lo = 0, hi = cues.length - 1, i = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (cues[m].start <= t) { i = m; lo = m + 1; } else hi = m - 1; }
    const speaking = i >= 0 && cues[i].end > t;
    const nextStart = cues[i + 1]?.start ?? Infinity;
    const gap = !speaking && nextStart - t > 2.5 && (i < 0 || t - cues[i].end > 0.8) && (!marks.tc || t < marks.tc);
    const factor = store.pref('smartFactor', 1.75);
    if (gap !== inGap) {
      inGap = gap;
      v.playbackRate = gap ? Math.min(4, baseRate * factor) : baseRate;
    }
    if (gap) timeSaved += dt * (1 - 1 / factor);
    smartChip.hidden = !smart;
    smartChip.classList.toggle('is-active', gap);
    $('[data-smart]').textContent = timeSaved > 5 ? `Smart Speed · saved ${fmtTime(timeSaved)}` : 'Smart Speed';
  }
  const smartTimer = setInterval(smartTick, 250);
  cleanup.push(() => clearInterval(smartTimer));
  function setSmart(on) {
    smart = on;
    store.setPref('smartSpeed', on);
    smartChip.hidden = !on;
    if (!on) v.playbackRate = baseRate;
    else if (smartCues().length < 20) {
      loadEnglish().then((en) => !en && el === root && toast('Smart Speed needs captions — none for this title', 'info'));
    }
    flash(on ? 'Smart Speed on' : 'Smart Speed off');
  }
  if (smart) loadEnglish().catch(() => {});

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

  let secondSub = null;
  async function chooseSecond(choice) {
    subs2.translator?.stop();
    subs2.translator = null;
    secondSub = choice;
    store.setPref('subLang2', choice ? choice.pref : null);
    if (!choice) return subs2.set([]);
    try {
      if (choice.kind === 'tr') {
        const en = await loadEnglish();
        if (!en) throw new Error('no source');
        new Translator(subs2, en.cues, { lang: choice.lang, src: en.src });
      } else {
        subs2.set(parseVTT(await subtitleText(item, choice.kind === 'os' ? { source: 'os', lang: choice.lang } : { source: 'ia', ...choice.file })));
      }
      flash(`Second line: ${choice.label.replace(' (translated)', '')}`);
    } catch {
      secondSub = null;
      subs2.set([]);
      toast('That language isn’t available for this title', 'info');
    }
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
        const text = choice.kind === 'url' ? await fetch(choice.url).then((r) => r.text()) : await subtitleText(item, choice.kind === 'os' ? { source: 'os', lang: choice.lang } : { source: 'ia', ...choice.file });
        const cues = parseVTT(text);
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
    if (item.srt) archive.push({ kind: 'url', label: 'English (NASA)', url: item.srt, pref: 'ia' });
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
    if (pick && el === root) await chooseSubs(pick, false);
    const want2 = store.pref('subLang2', null);
    const pick2 = want2 && [...os, ...archive, ...tr].find((o) => o.pref === want2);
    if (pick2 && el === root) chooseSecond(pick2);
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
        ${all.length > 1 || tr.length ? `<div class="panel__title">Second language <small>for learners</small></div>
          <label class="panel__select"><select data-second aria-label="Show a second subtitle language">
            <option value="">Off</option>${[...os, ...archive, ...tr].map((o, i) => `<option value="${i}" ${(secondSub?.pref || null) === o.pref ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
          </select></label><p class="panel__note">Shows a second line underneath, so you can follow along in two languages.</p>` : ''}
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
          applySubStyle($('.player__cues--second'), next);
          renderPanel('cc');
        }
      };
      const both = [...os, ...archive, ...tr];
      panel.onchange = (e) => {
        if (e.target.matches('[data-tr]') && e.target.value !== '') {
          chooseSubs(tr[+e.target.value]);
          hidePanel();
        }
        if (e.target.matches('[data-second]')) chooseSecond(e.target.value === '' ? null : both[+e.target.value]);
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
        <div class="panel__title">Playback</div>
        <label class="panel__toggle"><span>Smart Speed <small>skims long silences using the captions</small></span><input type="checkbox" ${smart ? 'checked' : ''} data-smart-toggle switch></label>
        <label class="panel__toggle"><span>Cinema curtain</span><input type="checkbox" ${store.pref('curtain', true) ? 'checked' : ''} data-curtain-toggle switch></label>
        <label class="panel__toggle"><span>Cinema mode <small>letterboxed, dimmed edges</small></span><input type="checkbox" ${root.classList.contains('player--cinema') ? 'checked' : ''} data-cinema-toggle switch></label>
        <label class="panel__toggle"><span>Skip titles &amp; intros automatically</span><input type="checkbox" ${store.pref('autoSkipIntro', false) ? 'checked' : ''} data-autoskip switch></label>
        <div class="panel__title">Sleep timer <small>fades picture and sound</small></div>
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
      panel.onchange = (e) => {
        if (e.target.matches('[data-autoplay]')) store.setPref('autoplay', e.target.checked);
        if (e.target.matches('[data-smart-toggle]')) setSmart(e.target.checked);
        if (e.target.matches('[data-curtain-toggle]')) store.setPref('curtain', e.target.checked);
        if (e.target.matches('[data-cinema-toggle]') && e.target.checked !== root.classList.contains('player--cinema')) actions.cinema();
        if (e.target.matches('[data-autoskip]')) store.setPref('autoSkipIntro', e.target.checked);
      };
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
    close: () => { noteCredits(); feedback('close', $('[data-act="close"]')); close(); },
    toggle: () => {
      haptic(6);
      if (casting) return remoteToggle();
      v.paused ? v.play() : v.pause();
    },
    back: () => seek(-seekStep),
    fwd: () => seek(seekStep),
    mini: () => (history.state?.player ? history.back() : minimize()),
    expand: () => expand(),
    mute: () => (v.muted = !v.muted),
    skip: () => {
      feedback('tap', skipBtn);
      if (skipKind === 'intro') v.currentTime = marks.ti;
      else if (skipKind === 'credits') {
        loadNext().then((n) => (n ? actions.next() : (v.currentTime = Math.max(0, (v.duration || 0) - 0.5))));
      }
      skipBtn.hidden = true;
      skipKind = null;
    },
    restart: () => { v.currentTime = 0; $('.recap').hidden = true; v.play().catch(() => {}); },
    'recap-close': () => { $('.recap').hidden = true; v.play().catch(() => {}); },
    retry: () => { root.classList.remove('is-error'); attempts = 0; const t = v.currentTime || startAt; v.src = streamUrl() + '?retry=' + Date.now(); v.addEventListener('loadedmetadata', () => (v.currentTime = t), { once: true }); v.play().catch(() => {}); },
    speed: (btn, dir = 1) => {
      const i = SPEEDS.indexOf(baseRate);
      const next = SPEEDS[(i + dir + SPEEDS.length) % SPEEDS.length] || 1;
      baseRate = next;
      v.playbackRate = next;
      $('[data-act="speed"]').textContent = `${next}×`;
      store.setPref(speedKey, next);
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
      noteCredits();
      close(true, true);
      const wasMini = root.classList.contains('player--mini');
      if (history.state?.player) history.replaceState({ ...(history.state || {}), player: false, scroll: 0 }, '', location.href); // the player's entry becomes a normal one
      play(n, { queue, mini: wasMini });
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
    if (root.classList.contains('player--mini')) return expand(); // tap the mini picture to go back to full screen
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
    if (root.classList.contains('player--mini')) return;
    if (now - lastTap < 300 && (x < 0.34 || x > 0.66)) {
      const right = x > 0.66;
      seek(right ? seekStep : -seekStep);
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

  // swipe down to shrink into the mini player (mobile)
  cleanup.push(dragDismiss(root, {
    onDismiss: () => actions.mini(),
    canStart: () => !root.classList.contains('player--mini'),
    ignore: '.scrub, .player__panel, .scenes, .upnext, .recap, .player__mini, input, select, .vol',
    scale: true,
  }));

  // scrubbing with thumbnail preview
  const pctFrom = (e) => {
    const r = scrub.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };
  const showTip = (p) => {
    const tip = $('.scrub__tip');
    const r = scrub.getBoundingClientRect();
    const t = p * (v.duration || 0);
    const half = Math.max(thumbs.length ? 84 : 24, lineAt(t) ? 120 : 0);
    tip.style.left = Math.min(r.width - half, Math.max(half, p * r.width)) + 'px';
    tip.querySelector('span').textContent = fmtTime(t);
    const th = thumbAt(t);
    const box = tip.querySelector('.scrub__thumb');
    box.hidden = !th;
    if (th && box.dataset.src !== th.url) {
      box.dataset.src = th.url;
      box.style.backgroundImage = `url("${th.url}")`;
    }
    // The line being spoken at that moment, under the thumbnail.
    const line = tip.querySelector('.scrub__line');
    const said = lineAt(t);
    line.hidden = !said;
    if (said && line.textContent !== said) line.textContent = said;
    tip.classList.toggle('has-line', !!said);
  };
  // Captions for the scrubber: whatever is on screen, else the English captions (fetched on first touch).
  function lineAt(t) {
    const cues = subs.cues.length > 20 ? subs.cues : captionCues || english?.cues || null;
    if (!cues?.length) return '';
    let lo = 0, hi = cues.length - 1, i = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (cues[m].start <= t) { i = m; lo = m + 1; } else hi = m - 1; }
    // Nearest line within a few seconds, so silent gaps still show what was just said.
    const c = i >= 0 && t - cues[i].end < 4 ? cues[i] : cues[i + 1] && cues[i + 1].start - t < 2 ? cues[i + 1] : null;
    const text = c?.text?.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() || '';
    return text.length > 90 ? text.slice(0, 88) + '…' : text;
  }
  let captionsWanted = false;
  scrub.addEventListener('pointerenter', () => {
    if (captionsWanted || subs.cues.length > 20 || captionCues || dataSaver()) return;
    captionsWanted = true;
    loadEnglish().catch(() => {});
  });
  scrub.addEventListener('pointermove', (e) => showTip(pctFrom(e)));
  scrub.addEventListener('pointerdown', (e) => {
    scrub.setPointerCapture(e.pointerId);
    scrub.classList.add('is-drag');
    let lastScene = -1;
    const move = (ev) => {
      const p = pctFrom(ev);
      const t = p * (v.duration || 0);
      // A tick you can feel (and hear) each time the scrubber crosses a scene marker.
      const scene = sceneTimes.findIndex((x, k) => t >= x && (sceneTimes[k + 1] ?? Infinity) > t);
      if (scene !== lastScene && lastScene !== -1) feedback('tick', ev.clientX, 6);
      lastScene = scene;
      v.currentTime = t;
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
    if ((e.target.tagName === 'INPUT' && e.target.type !== 'range') || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
    const k = e.key.toLowerCase();
    // While browsing with the mini player, only its own keys; everything else belongs to the page.
    if (root.classList.contains('player--mini') && !['k', 'i'].includes(k)) return;
    const map = {
      ' ': actions.toggle, k: actions.toggle, arrowleft: () => seek(-5), arrowright: () => seek(5), j: () => seek(-seekStep), l: () => seek(seekStep),
      i: () => (root.classList.contains('player--mini') ? expand() : actions.mini()),
      f: actions.fs, m: actions.mute, p: actions.pip, t: actions.cinema, s: actions.scenes,
      c: () => (activeSub ? chooseSubs(null) : renderPanel('cc')),
      n: () => skipKind && actions.skip(),
      g: () => setSmart(!smart),
      '<': () => actions.speed(null, -1),
      '>': () => actions.speed(null, 1),
      ',': () => actions.speed(null, -1),
      '.': () => actions.speed(null, 1),
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
      artist: isEp ? item.seriesTitle || 'Arnav Movies' : (item.director || []).join(', ') || 'Arnav Movies',
      album: item.year ? String(item.year) : 'Arnav Movies',
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

  /* -------------------------------------------------------------- mini player */
  // Back (or swipe down, or the chevron) shrinks the player into a corner so it keeps playing while you browse.
  const onPop = () => minimize();
  const enterFull = () => {
    history.pushState({ player: true }, '', location.href);
    window.addEventListener('popstate', onPop, { once: true });
  };
  if (mini) {
    // Autoplay from the mini player stays mini.
    root.classList.add('player--mini', 'no-curtain');
    document.body.style.overflow = '';
    document.body.classList.add('has-mini');
  } else enterFull();
  cleanup.push(() => window.removeEventListener('popstate', onPop));

  function flip(change) {
    const first = root.getBoundingClientRect();
    change();
    const last = root.getBoundingClientRect();
    if (reducedMotion() || !root.animate || !last.width) return;
    const sx = first.width / last.width, sy = first.height / last.height;
    root.animate(
      [{ transformOrigin: '0 0', transform: `translate(${first.left - last.left}px, ${first.top - last.top}px) scale(${sx}, ${sy})`, borderRadius: '0px' }, { transformOrigin: '0 0', transform: 'none' }],
      { duration: 460, easing: 'cubic-bezier(.2, .9, .2, 1)' }
    );
  }
  function minimize() {
    if (el !== root || root.classList.contains('player--mini')) return;
    window.removeEventListener('popstate', onPop);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    hidePanel();
    $('.scenes').hidden = true;
    flip(() => root.classList.add('player--mini'));
    root.classList.remove('show-ui');
    document.body.style.overflow = '';
    document.body.classList.add('has-mini');
    document.dispatchEvent(new CustomEvent('player:mini'));
  }
  function expand() {
    if (el !== root || !root.classList.contains('player--mini')) return;
    flip(() => root.classList.remove('player--mini'));
    document.body.style.overflow = 'hidden';
    document.body.classList.remove('has-mini');
    enterFull();
    poke();
  }
  cleanup.push(() => document.body.classList.remove('has-mini'));

  function flash(msg) {
    const t = $('.player__toast');
    t.textContent = msg;
    t.classList.add('is-on');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('is-on'), 1100);
  }
}

/* ------------------------------------------------- app-icon launch / collapse */
const reduced = reducedMotion;
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
