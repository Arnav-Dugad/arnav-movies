// Settings: every preference in one place, grouped, searchable, saved on this device as you change it.
import { store } from './store.js';
import { esc, icon, toast, footer } from './ui.js';
import { soundsOn, setSounds, cue } from './audio.js';
import { applyAppearance, UI_SIZES } from './prefs.js';
import { ACCENTS, reset as resetTheme } from './theme.js';
import { SPEEDS, LOOKS, RESTORE } from './player.js';
import { subStyle, applySubStyle, SUB_SIZES, SUB_FONTS, SUB_BACKS, SUB_COLORS, TRANSLATE_TO, langName } from './subs.js';
import { show as showShortcuts } from './shortcuts.js';

const HIDEABLE = [['horror', 'Horror'], ['war', 'War'], ['western', 'Westerns'], ['crime', 'Crime'], ['thriller', 'Thrillers'], ['romance', 'Romance'], ['musical', 'Musicals'], ['animation', 'Cartoons'], ['silent', 'Silent films'], ['short', 'Shorts'], ['documentary', 'Documentaries'], ['scifi', 'Sci-fi']];
const lookKey = () => {
  const l = store.pref('look', null);
  return l ? Object.keys(LOOKS).find((k) => LOOKS[k].label === l.label) || 'custom' : 'original';
};

// Each item: [type, key, default, label, sub, options]
const GROUPS = () => [
  ['playback', 'Playback', 'play', [
    ['switch', 'autoplay', true, 'Autoplay next', 'Next episode or programme reel, after a short countdown'],
    ['switch', 'autoSkipIntro', false, 'Skip opening titles automatically', 'From captions, title-card detection and what other viewers skip'],
    ['switch', 'autoSkipCredits', false, 'Skip end credits automatically', 'Goes straight to what’s next'],
    ['switch', 'recap', true, '“Previously” card when resuming', 'The last scenes and lines before you stopped'],
    ['chips', 'resumeRewind', 10, 'Rewind when resuming', '', [[0, 'Off'], [5, '5 s'], [10, '10 s'], [30, '30 s']]],
    ['chips', 'seekStep', 10, 'Skip buttons and double-tap jump', '', [[5, '5 s'], [10, '10 s'], [15, '15 s'], [30, '30 s']]],
    ['chips', 'speed', 1, 'Default speed', 'Every film also remembers its own speed', SPEEDS.map((s) => [s, s + '×'])],
    ['switch', 'smartSpeed', false, 'Smart Speed', 'Skims long silences between lines (needs captions)'],
    ['chips', 'smartFactor', 1.75, 'Smart Speed skims at', '', [[1.5, '1.5×'], [1.75, '1.75×'], [2, '2×'], [2.5, '2.5×']]],
    ['switch', 'curtain', true, 'Cinema curtain', 'Curtains part when the picture starts and fall at the end'],
    ['switch', 'cinema', false, 'Open the player in cinema mode', 'Letterboxed with dimmed edges'],
  ]],
  ['subtitles', 'Subtitles', 'cc', [
    ['select', 'subLang', null, 'Subtitles by default', 'Used whenever a title has them', [[null, 'Off'], ['ia', 'English'], ...TRANSLATE_TO.map((l) => ['tr:' + l, langName(l) + ' (translated)'])]],
    ['select', 'subLang2', null, 'Second language', 'A second line underneath, for language learners', [[null, 'Off'], ...TRANSLATE_TO.map((l) => ['tr:' + l, langName(l) + ' (translated)'])]],
    ['substyle'],
    ['chips', 'subPos', 'low', 'Position on screen', '', [['low', 'Low'], ['mid', 'Raised'], ['high', 'High']]],
  ]],
  ['picture', 'Picture', 'theater', [
    ['look'],
    ['chips', 'restore', 'off', 'Old-print restoration', 'Calms flicker and grain on silent-era prints', Object.entries(RESTORE)],
  ]],
  ['appearance', 'Appearance', 'sparkles', [
    ['switch', 'posterColors', true, 'Colours follow the poster', 'Buttons and glow take each film’s colours'],
    ['accent'],
    ['chips', 'uiSize', 'default', 'Interface size', '', Object.entries(UI_SIZES)],
    ['switch', 'parallax', true, 'Parallax hero', 'Depth as you move the pointer or scroll'],
    ['switch', 'kenBurns', true, 'Slow pans on title pages', 'For films without a trailer'],
    ['switch', 'seasonal', true, 'Seasonal home page', 'Halloween, the holidays and Valentine’s Day'],
    ['switch', 'filmGrain', true, 'Film grain', 'A faint grain over the whole site'],
    ['switch', 'reduceMotion', false, 'Reduce motion', 'Turns off animations, parallax and the curtain'],
    ['switch', 'reduceTransparency', false, 'Reduce transparency', 'Solid panels instead of glass'],
  ]],
  ['sound', 'Sound & touch', 'volume', [
    ['sounds'],
    ['chips', 'soundLevel', 'normal', 'Sound cue volume', '', [['soft', 'Soft'], ['normal', 'Normal'], ['loud', 'Loud']]],
    ['switch', 'haptics', true, 'Haptics', 'Taps, scene ticks on the scrubber, My List'],
  ]],
  ['browsing', 'Browsing', 'film', [
    ['switch', 'hoverPreviews', true, 'Previews on hover', 'Trailers and clips when you rest on a poster'],
    ['switch', 'heroTrailers', true, 'Trailers on the home page', 'Muted, behind the featured film'],
    ['switch', 'dataSaver', false, 'Data saver', 'No previews, trailers or launch images; captions only when asked'],
    ['switch', 'hideWatched', false, 'Hide films you’ve finished', 'From the home page and Movies'],
    ['tags'],
  ]],
  ['privacy', 'Privacy & data', 'gear', [
    ['switch', 'reports', true, 'Send stream-health reports', 'Anonymous: which files fail, so dead streams get skipped for everyone'],
    ['data'],
  ]],
];

const chips = (key, cur, options) =>
  `<div class="seg" role="radiogroup">${options.map(([v, l]) => `<button class="seg__opt ${String(cur) === String(v) ? 'is-active' : ''}" role="radio" aria-checked="${String(cur) === String(v)}" data-pref="${key}" data-val='${esc(JSON.stringify(v))}'>${esc(l)}</button>`).join('')}</div>`;
const rowHtml = (label, sub, control, extra = '') => `<div class="setting ${extra}" data-label="${esc((label + ' ' + (sub || '')).toLowerCase())}"><span><strong>${esc(label)}</strong>${sub ? `<small>${esc(sub)}</small>` : ''}</span>${control}</div>`;

function item(it) {
  const [type, key, def, label, sub, options] = it;
  if (type === 'switch') return rowHtml(label, sub, `<input type="checkbox" switch data-pref="${key}" ${store.pref(key, def) ? 'checked' : ''} aria-label="${esc(label)}">`);
  if (type === 'chips') return rowHtml(label, sub, chips(key, store.pref(key, def), options), 'setting--stack');
  if (type === 'select') {
    const cur = store.pref(key, def);
    return rowHtml(label, sub, `<label class="panel__select"><select data-pref="${key}" data-json aria-label="${esc(label)}">${options.map(([v, l]) => `<option value='${esc(JSON.stringify(v))}' ${JSON.stringify(cur) === JSON.stringify(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`);
  }
  if (type === 'substyle') {
    const st = subStyle();
    const pick = (k, opts) => `<div class="seg">${opts.map(([v, l]) => `<button class="seg__opt ${st[k] === v ? 'is-active' : ''}" data-substyle="${k}" data-v="${v}">${esc(l)}</button>`).join('')}</div>`;
    return `<div class="setting setting--stack" data-label="subtitle style size font background colour"><span><strong>Style</strong><small>Size, font, background and colour</small></span>
      <div class="substyle">
        ${pick('size', Object.keys(SUB_SIZES).map((k) => [k, k.toUpperCase()]))}
        ${pick('font', Object.entries(SUB_FONTS).map(([k, f]) => [k, f.label]))}
        ${pick('back', Object.entries(SUB_BACKS))}
        <div class="seg">${Object.entries(SUB_COLORS).map(([k, c]) => `<button class="swatch ${st.color === k ? 'is-active' : ''}" data-substyle="color" data-v="${k}" style="--c:${c}" aria-label="${k}"></button>`).join('')}</div>
        <div class="sub-preview" data-back="${st.back}"><span class="cue">Round up the usual suspects.</span></div>
      </div></div>`;
  }
  if (type === 'look') {
    const cur = lookKey();
    return rowHtml('Default picture', 'Applied to every film; adjust per film in the player', `<div class="seg">${Object.entries(LOOKS).map(([k, l]) => `<button class="seg__opt ${cur === k ? 'is-active' : ''}" data-look="${k}">${esc(l.label)}</button>`).join('')}${cur === 'custom' ? '<button class="seg__opt is-active" disabled>Custom</button>' : ''}</div>`, 'setting--stack');
  }
  if (type === 'accent') {
    const cur = store.pref('accent', 'amber');
    return rowHtml('Accent colour', 'Used when a poster has no strong colour, or when poster colours are off', `<div class="seg">${Object.entries(ACCENTS).map(([k, h]) => `<button class="swatch swatch--lg ${cur === k ? 'is-active' : ''}" data-pref="accent" data-val='${JSON.stringify(k)}' style="--c:${h == null ? '#ffb340' : `hsl(${h} 78% 64%)`}" aria-label="${k}" title="${k[0].toUpperCase() + k.slice(1)}"></button>`).join('')}</div>`, 'setting--stack');
  }
  if (type === 'sounds') return rowHtml('Sound cues', 'Soft taps, panned to where you touch', `<input type="checkbox" switch data-sounds ${soundsOn() ? 'checked' : ''} aria-label="Sound cues">`);
  if (type === 'tags') {
    const hidden = new Set(store.pref('hideTags', []));
    return rowHtml('Hide from browsing', 'These won’t appear in rows, collections or picks (search still finds them)', `<div class="seg seg--wrap">${HIDEABLE.map(([t, l]) => `<button class="seg__opt ${hidden.has(t) ? 'is-active' : ''}" data-hide="${t}" aria-pressed="${hidden.has(t)}">${hidden.has(t) ? icon('check') : ''}${esc(l)}</button>`).join('')}</div>`, 'setting--stack');
  }
  if (type === 'data') {
    const c = store.counts();
    return `<div class="setting setting--stack" data-label="export import backup clear history list reset storage">
      <span><strong>Your data</strong><small>Stored only in this browser · ${(store.bytes() / 1024).toFixed(1)} KB · ${c.list} in My List · ${c.progress} titles in history</small></span>
      <div class="data-actions">
        <button class="btn btn--glass btn--sm" data-do="export">Export backup</button>
        <label class="btn btn--glass btn--sm">Import backup<input type="file" accept="application/json,.json" data-import hidden></label>
        <button class="btn btn--glass btn--sm" data-do="history">Clear watch history</button>
        <button class="btn btn--glass btn--sm" data-do="list">Clear My List</button>
        <button class="btn btn--glass btn--sm" data-do="dismissed">Reset “Not interested”</button>
        <button class="btn btn--glass btn--sm btn--danger" data-do="prefs">Reset all settings</button>
      </div></div>`;
  }
  return '';
}

function sideEffects(key) {
  if (['reduceMotion', 'reduceTransparency', 'uiSize', 'filmGrain'].includes(key)) applyAppearance();
  if (['accent', 'posterColors'].includes(key)) resetTheme();
}

export function settingsView(ctx) {
  document.title = 'Settings — Arnav Movies';
  const groups = GROUPS();
  // Listeners live on this host (replaced when you leave), not on the shared view element.
  ctx.el.innerHTML = '<div class="settings-host"></div>';
  const host = ctx.el.firstElementChild;
  const render = () => {
    const scroll = scrollY;
    host.innerHTML = `<div class="view settings-page"><div class="container">
      <header class="page-head"><div><div class="eyebrow">Settings</div><h1 class="page-title">Make it yours.</h1>
        <p class="page-sub">Saved on this device as you change them.</p></div></header>
      <div class="settings-layout">
        <nav class="settings-nav glass" aria-label="Settings sections">
          <label class="settings-search">${icon('search')}<input type="search" placeholder="Search settings" data-filter aria-label="Search settings"></label>
          ${groups.map(([id, title, ic]) => `<a href="#s-${id}" data-jump="${id}">${icon(ic)}${esc(title)}</a>`).join('')}
          <a href="#s-about" data-jump="about">${icon('info')}About</a>
        </nav>
        <div class="settings-groups">
          ${groups.map(([id, title, ic, items]) => `<section class="settings-group" id="s-${id}"><h2 class="section-title">${icon(ic)} ${esc(title)}</h2><div class="settings glass">${items.map(item).join('')}</div></section>`).join('')}
          <section class="settings-group" id="s-about"><h2 class="section-title">${icon('info')} About</h2><div class="settings glass">
            <button class="setting setting--btn" data-shortcuts data-label="keyboard shortcuts"><span><strong>Keyboard shortcuts</strong><small>Press ? anywhere</small></span>${icon('right')}</button>
            <a class="setting setting--btn" href="/status" data-label="stream status health"><span><strong>Stream status</strong><small>Which films are playing reliably right now</small></span>${icon('right')}</a>
            <a class="setting setting--btn" href="https://github.com/Arnav-Dugad/arnav-movies" target="_blank" rel="noopener" data-label="source code github"><span><strong>Source code</strong><small>Arnav Movies on GitHub</small></span>${icon('external')}</a>
            <div class="setting" data-label="about legal"><span><strong>Arnav Movies</strong><small>Public-domain and openly licensed film, streamed from the Internet Archive and NASA. No account, no ads, no tracking cookies.</small></span></div>
          </div></section>
          <p class="settings-empty" hidden>No settings match.</p>
        </div>
      </div>
    </div>${footer()}</div>`;
    applySubStyle(host.querySelector('.sub-preview'), subStyle());
    window.scrollTo({ top: scroll, behavior: 'instant' });
  };
  render();

  const set = (key, value, label) => {
    store.setPref(key, value);
    sideEffects(key);
    cue('tap');
    if (label) toast(label);
  };

  host.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-sounds]')) return setSounds(t.checked), t.checked && cue('add', t);
    if (t.matches('[data-import]')) {
      const file = t.files?.[0];
      if (!file) return;
      file.text().then((txt) => {
        store.importData(txt);
        applyAppearance();
        resetTheme();
        toast('Backup restored');
        render();
      }).catch(() => toast('That file isn’t an Arnav Movies backup', 'x'));
      return;
    }
    const key = t.dataset.pref;
    if (!key) return;
    if (t.type === 'checkbox') set(key, t.checked, `${t.closest('.setting').querySelector('strong').textContent} ${t.checked ? 'on' : 'off'}`);
    else if (t.matches('[data-json]')) set(key, JSON.parse(t.value), 'Saved');
  });

  host.addEventListener('click', (e) => {
    const b = e.target.closest('button, a[data-jump]');
    if (!b) return;
    if (b.dataset.jump) {
      e.preventDefault();
      host.querySelector('#s-' + b.dataset.jump)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (b.matches('[data-shortcuts]')) return showShortcuts();
    if (b.dataset.pref) {
      set(b.dataset.pref, JSON.parse(b.dataset.val));
      return render();
    }
    if (b.dataset.substyle) {
      store.setPref('subStyle', { ...subStyle(), [b.dataset.substyle]: b.dataset.v });
      cue('tap');
      return render();
    }
    if (b.dataset.look) {
      store.setPref('look', b.dataset.look === 'original' ? null : LOOKS[b.dataset.look]);
      cue('tap');
      return render();
    }
    if (b.dataset.hide) {
      const hidden = new Set(store.pref('hideTags', []));
      hidden.has(b.dataset.hide) ? hidden.delete(b.dataset.hide) : hidden.add(b.dataset.hide);
      store.setPref('hideTags', [...hidden]);
      cue('tap');
      return render();
    }
    const act = b.dataset.do;
    if (!act) return;
    if (act === 'export') {
      const url = URL.createObjectURL(new Blob([store.exportData()], { type: 'application/json' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: `arnav-movies-backup-${new Date().toISOString().slice(0, 10)}.json` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      return toast('Backup saved');
    }
    const confirmText = { history: 'Clear your watch history and progress?', list: 'Remove everything from My List?', dismissed: 'Show titles you marked “Not interested” again?', prefs: 'Reset every setting to its default?' }[act];
    if (!confirm(confirmText)) return;
    if (act === 'history') store.clearHistory();
    if (act === 'list') store.clearList();
    if (act === 'dismissed') store.clearDismissed();
    if (act === 'prefs') {
      store.resetPrefs();
      applyAppearance();
      resetTheme();
    }
    toast('Done');
    render();
  });

  host.addEventListener('input', (e) => {
    if (!e.target.matches('[data-filter]')) return;
    const q = e.target.value.trim().toLowerCase();
    let shown = 0;
    host.querySelectorAll('.settings-group').forEach((g) => {
      let any = false;
      g.querySelectorAll('.setting').forEach((s) => {
        const ok = !q || (s.dataset.label || '').includes(q) || g.querySelector('.section-title').textContent.toLowerCase().includes(q);
        s.hidden = !ok;
        any ||= ok;
      });
      g.hidden = !any;
      shown += any;
    });
    host.querySelector('.settings-empty').hidden = !!shown;
  });
}
