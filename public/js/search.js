// ⌘K search palette. Everything it finds can be streamed: curated films, classic TV series,
// the Archive's collections, NASA — and "what's said", a full-text search through captions
// that jumps straight to the moment a line is spoken. "The one where…" matches plots, and you can
// say it out loud: "play the one where the zombies attack the farmhouse".
import { catalog, series, iaSearchText, nasaSearch, quoteSearch, plotIndex } from './api.js';
import { esc, icon, fmtTime, feedback } from './ui.js';

let root, input, results, items = [], selected = 0, timer, seq = 0;
let navigate = () => {};
let playQuote = () => {};
let playItem = null;
let voiceIntent = null; // { play: true } when the spoken request starts with "play"/"watch"
const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;

const SUGGEST = ['Hitchcock', 'Chaplin', 'Film noir', 'Buster Keaton', 'Popeye', 'The Lucy Show', 'Apollo 11', '“round up the usual”', '“I’ll be back”'];

export function initSearch(nav, { onQuote, onPlay } = {}) {
  navigate = nav;
  playQuote = onQuote || playQuote;
  playItem = onPlay || null;
  root = document.createElement('div');
  root.className = 'palette';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Search');
  root.innerHTML = `<div class="palette__scrim" data-close></div>
    <div class="palette__box">
      <div class="palette__field">${icon('search')}
        <input type="search" placeholder="Search films, TV, NASA, a line, or “the one where…”" autocomplete="off" spellcheck="false" aria-label="Search" aria-controls="palette-results">
        ${Speech ? `<button class="icon-btn palette__mic" data-voice aria-label="Search by voice" title="Search by voice">${MIC}</button>` : ''}
        <button class="icon-btn" data-close aria-label="Close search">${icon('x')}</button></div>
      <div class="palette__voice" hidden><span class="palette__wave"><i></i><i></i><i></i><i></i><i></i></span><span data-voice-text>Listening…</span></div>
      <div class="palette__results" id="palette-results" role="listbox"></div>
      <div class="palette__hint"><span><span class="kbd">↑</span> <span class="kbd">↓</span> to move</span><span><span class="kbd">↵</span> to open</span><span><span class="kbd">"…"</span> for exact lines</span><span><span class="kbd">esc</span> to close</span></div>
    </div>`;
  document.body.appendChild(root);
  input = root.querySelector('input');
  results = root.querySelector('.palette__results');

  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) return closeSearch();
    if (e.target.closest('[data-voice]')) return listen();
    const s = e.target.closest('[data-suggest]');
    if (s) {
      input.value = s.dataset.suggest;
      run();
      input.focus();
    }
    const r = e.target.closest('.result');
    if (r) {
      e.preventDefault();
      open(items[+r.dataset.idx]);
    }
  });
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(run, 180);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      select(selected + (e.key === 'ArrowDown' ? 1 : -1));
    } else if (e.key === 'Enter' && items[selected]) {
      e.preventDefault();
      open(items[selected]);
    } else if (e.key === 'Escape') closeSearch();
  });
  input.addEventListener('keydown', () => (voiceIntent = null));
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      root.classList.contains('is-open') ? closeSearch() : openSearch();
    } else if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) && !document.querySelector('.player')) {
      e.preventDefault();
      openSearch();
    }
  });
}

export function openSearch(q = '') {
  root.classList.add('is-open');
  document.body.style.overflow = 'hidden';
  input.value = q;
  run();
  setTimeout(() => input.focus(), 30);
}

export function closeSearch() {
  root.classList.remove('is-open');
  document.body.style.overflow = '';
  recognizer?.abort();
}

/* ------------------------------------------------------------------ voice */
const MIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>';
let recognizer = null;
function listen() {
  if (!Speech) return;
  if (recognizer) return recognizer.stop();
  const bar = root.querySelector('.palette__voice');
  const label = root.querySelector('[data-voice-text]');
  const mic = root.querySelector('[data-voice]');
  recognizer = new Speech();
  recognizer.lang = navigator.language || 'en-US';
  recognizer.interimResults = true;
  recognizer.maxAlternatives = 1;
  bar.hidden = false;
  mic.classList.add('is-listening');
  label.textContent = 'Listening… try “play the one where the zombies attack the farmhouse”';
  feedback('tap', mic);
  recognizer.onresult = (e) => {
    const text = [...e.results].map((r) => r[0].transcript).join(' ').trim();
    label.textContent = `“${text}”`;
    input.value = text;
    if (e.results[e.results.length - 1].isFinal) {
      voiceIntent = { play: /^(please\s+)?(play|watch|put on|start|show me)\b/i.test(text) };
      run();
    }
  };
  recognizer.onerror = (e) => {
    label.textContent = e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'Microphone access is off for this site' : e.error === 'no-speech' ? 'Didn’t catch that — tap the mic and try again' : 'Voice search isn’t available right now';
  };
  recognizer.onend = () => {
    mic.classList.remove('is-listening');
    recognizer = null;
    setTimeout(() => !recognizer && (bar.hidden = true), 2600);
  };
  try { recognizer.start(); } catch { recognizer = null; }
}

/* ------------------------------------------------------- "the one where…" */
const FILLER = /^(?:please\s+)?(?:play|watch|put on|start|show me|find|search for|search)?\s*(?:me\s+)?(?:(?:the|a|that)\s+)?(?:(?:one|film|movie|picture|episode|cartoon|show|short)\s+)?(?:where|in which|about|with|that has|that|when)?\s*/i;
const QSTOP = new Set('the a an and or of to in on at by for with from into onto is are was were be been it its this that these those there their they them he she his her him who whom which what when where while one ones film movie some someone somebody guy girl man woman people get gets got has have had do does did very really just like about'.split(' '));
const intentOf = (raw) => {
  const plain = raw.replace(/^["“”']+|["“”']+$/g, '').trim();
  const rest = plain.replace(FILLER, '').trim();
  const words = rest.toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).filter((w) => w.length > 2 && !QSTOP.has(w));
  const described = rest !== plain || words.length >= 3;
  return { title: rest || plain, words, described };
};
// Word forms to try ("zombies" → zombies, zombie; "parties" → party), plus the words plots actually use.
const SYNONYMS = {
  zombie: ['ghoul', 'undead'], ghoul: ['zombie'], vampire: ['dracula', 'count'], ghost: ['spirit', 'haunted', 'phantom'], haunted: ['ghost'],
  alien: ['martian', 'saucer', 'spaceship'], martian: ['alien'], robot: ['machine', 'android'], monster: ['creature', 'beast'], creature: ['monster'],
  detective: ['inspector', 'sleuth', 'investigator'], cop: ['police', 'policeman', 'detective'], police: ['cop', 'policeman'], gangster: ['mobster', 'gang', 'racketeer'],
  reporter: ['journalist', 'newspaper'], journalist: ['reporter'], cowboy: ['rancher', 'outlaw', 'sheriff'], sheriff: ['marshal'], train: ['railroad', 'locomotive'],
  ship: ['boat', 'vessel'], plane: ['airplane', 'aircraft', 'pilot'], killer: ['murderer', 'strangler'], murder: ['killing', 'murdered'], doctor: ['scientist', 'physician'],
  scientist: ['professor', 'doctor'], wife: ['husband', 'marriage'], wedding: ['marriage', 'bride'], heist: ['robbery', 'bank'], robbery: ['heist', 'robber'],
  mansion: ['house', 'estate'], farmhouse: ['farm'], island: ['castaway'], ape: ['gorilla'], gorilla: ['ape'], spaceship: ['rocket', 'spacecraft'], rocket: ['spaceship'],
};
const forms = (w) => {
  const base = w.replace(/'s$/, '');
  const out = new Set([base]);
  if (base.endsWith('ies') && base.length > 4) out.add(base.slice(0, -3) + 'y');
  if (base.endsWith('es') && base.length > 4) out.add(base.slice(0, -2));
  if (base.endsWith('s') && !base.endsWith('ss')) out.add(base.slice(0, -1));
  [...out].forEach((f) => (SYNONYMS[f] || []).forEach((x) => out.add(x)));
  return [...out];
};
function plotMatches(index, words) {
  if (!words.length || !index.length) return [];
  // Words no plot uses as a keyword (too common, like "house") don't count toward the match.
  const variants = words.map(forms).filter((vs) => index.some(({ kw }) => vs.some((v) => kw.includes(` ${v} `))));
  if (!variants.length) return [];
  words = variants.map((vs) => vs[0]);
  return index
    .map(({ film, kw }) => {
      let s = 0, lead = 1;
      const hit = [];
      variants.forEach((vs, i) => {
        let at = -1;
        for (const v of vs) {
          const exact = kw.indexOf(` ${v} `);
          const pos = exact >= 0 ? exact : v.length > 4 ? kw.indexOf(` ${v}`) : -1;
          if (pos >= 0 && (at < 0 || pos < at)) at = pos;
        }
        if (at >= 0) {
          s += 1 + (1 - at / kw.length) ** 3 * 5; // the first keywords are what the film is most about
          if (` ${film.title.toLowerCase()} `.includes(` ${words[i]}`)) s += 4; // …and a title that says it
          hit.push(words[i]);
          lead = Math.min(lead, at / kw.length);
        }
      });
      return [film, s, hit, lead];
    })
    // Enough of the words, or one word that's among the very first things the film is about.
    .filter(([, s, hit, lead]) => s > 0 && (hit.length >= Math.min(2, words.length) || (hit.length && lead < 0.12)))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([film, , hit]) => ({ ...film, why: hit.join(' · ') }));
}

function open(it) {
  if (!it) return;
  closeSearch();
  if (it.quote) return playQuote(it.quote);
  if (voiceIntent?.play && playItem && it.playable !== false && it.kind !== 'series') return playItem(it);
  navigate(it.href);
}

const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function highlight(text, q) {
  const i = norm(text).indexOf(norm(q));
  if (!q || i < 0) return esc(text);
  return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length));
}

function score(f, q) {
  const n = norm(q);
  const t = norm(f.title);
  let s = 0;
  if (t === n) s += 100;
  else if (t.startsWith(n)) s += 60;
  else if (t.includes(n)) s += 40;
  const hay = norm([...(f.director || []), ...(f.cast || []), ...(f.genres || []), ...(f.tags || []), f.year, f.network].join(' '));
  const tw = ` ${t} `;
  n.split(/\s+/).forEach((w) => {
    if (w.length > 2 && !QSTOP.has(w) && tw.includes(` ${w}`)) s += 12; // a word of the title ("gorilla" → The Gorilla)
    if (w.length > 2 && !QSTOP.has(w) && hay.includes(w)) s += 15;
  });
  return s;
}

async function run() {
  const raw = input.value.trim();
  const q = raw.replace(/^["“”']+|["“”']+$/g, '');
  const quoted = /^["“]/.test(raw);
  const my = ++seq;
  const [films, shows] = await Promise.all([catalog(), series()]);
  if (!q) {
    items = films.slice().sort(() => Math.random() - 0.5).slice(0, 5);
    render([{ label: 'Try', suggest: true }, { label: 'Classics to start with', list: items }], q);
    return;
  }
  const intent = intentOf(raw);
  const tq = intent.described ? intent.title : q; // "play casablanca" searches titles for "casablanca"
  const scored = quoted ? [] : films.map((f) => [f, score(f, tq)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]);
  const local = scored.slice(0, 8).map(([f]) => f);
  const tv = quoted ? [] : shows.map((s) => [s, score(s, tq)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([s]) => s);
  render([{ label: 'Films', list: local }, { label: 'Classic TV', list: tv }, { label: 'Searching…', loading: true }], q);
  if (q.length < 2) return;
  const [ia, nasa, lines, plots] = await Promise.allSettled([
    quoted ? Promise.resolve([]) : iaSearchText(tq, 10),
    quoted ? Promise.resolve({ items: [] }) : nasaSearch(tq, { rows: 6 }),
    q.length >= 4 ? quoteSearch(intent.described && !quoted ? intent.words.join(' ') || q : q) : Promise.resolve([]),
    !quoted && intent.words.length && (intent.described || intent.words.length >= 2) ? plotIndex() : Promise.resolve([]),
  ]);
  if (my !== seq) return;
  const plotList = plotMatches(plots.value || [], intent.words);
  const seen = new Set(local.map((f) => f.id));
  const vault = (ia.value || []).filter((x) => !seen.has(x.id)).slice(0, 8);
  const space = (nasa.value?.items || []).slice(0, 5);
  const byId = new Map(films.map((f) => [f.id, f]));
  const said = (lines.value || []).map((r) => {
    const film = byId.get(r.item);
    return {
      quote: { id: r.item, t: r.t, q },
      href: film?.href || '/title/' + encodeURIComponent(r.item),
      title: film?.title || r.title,
      poster: film?.poster || `https://archive.org/services/img/${encodeURIComponent(r.item)}`,
      sub: [film?.year || r.year, `around ${fmtTime(r.t)}`].filter(Boolean).join(' · '),
      snippet: r.snip,
    };
  });
  const strongTitle = scored[0] && scored[0][1] >= 60;
  const groups = [
    { label: 'What’s said', list: said, quotes: true, rank: quoted ? 0 : 2 },
    { label: 'The one where…', list: plotList, plot: true, rank: intent.described && !strongTitle ? 1 : 3 },
    { label: 'Films', list: local, rank: strongTitle ? 0 : intent.described ? 4 : 1 },
    { label: 'Classic TV', list: tv, rank: 5 },
    { label: 'From the Internet Archive', list: vault, rank: 6 },
    { label: 'NASA', list: space, rank: 7 },
  ].sort((a, b) => a.rank - b.rank);
  render(groups, q);
  // Spoken "play …": start the best match straight away.
  if (voiceIntent?.play) {
    const best = groups.find((g) => g.list.length);
    voiceIntent = null;
    if (best) {
      const it = best.list[0];
      closeSearch();
      if (it.quote) return playQuote(it.quote);
      if (playItem && it.playable !== false && it.kind !== 'series') return playItem(it);
      navigate(it.href);
    }
  }
}

// Caption snippets arrive with \u0001 … \u0002 around the match; escape, then mark.
const snippetHtml = (s) => esc(s || '').replace(/\u0001/g, '<mark>').replace(/\u0002/g, '</mark>');

function render(groups, q) {
  items = groups.flatMap((g) => g.list || []);
  selected = 0;
  let i = 0;
  const html = groups
    .map((g) => {
      if (g.suggest) return `<div class="palette__group">${esc(g.label)}</div><div class="palette__suggest">${SUGGEST.map((s) => `<button class="pill" data-suggest="${esc(s)}">${esc(s)}</button>`).join('')}</div>`;
      if (g.loading) return `<div class="palette__group">${esc(g.label)}<span class="spinner" style="width:14px;height:14px;border-width:2px"></span></div>`;
      if (!g.list.length) return '';
      return `<div class="palette__group">${esc(g.label)}<span>${g.list.length}</span></div>` +
        g.list
          .map((it) => {
            const idx = i++;
            if (g.quotes) {
              return `<a class="result result--quote" role="option" href="${esc(it.href)}" data-idx="${idx}">
                <div class="result__img">${it.poster ? `<img src="${esc(it.poster)}" alt="" loading="lazy">` : ''}</div>
                <div><div class="result__quote">“${snippetHtml(it.snippet)}”</div><div class="result__sub">${esc(it.title)} · ${esc(it.sub)}</div></div>
                <span class="badge">${icon('play')} Play</span></a>`;
            }
            const sub = g.plot ? [it.year, it.why].filter(Boolean).join(' · ') : it.kind === 'series'
              ? [it.year, it.network, `${it.count} episodes`].filter(Boolean).join(' · ')
              : it.kind === 'clip' ? [it.year, it.credit].filter(Boolean).join(' · ') : [it.year, it.director?.[0], it.genres?.[0]].filter(Boolean).join(' · ');
            const tag = it.kind === 'series' ? 'Series' : it.kind === 'clip' ? 'NASA' : it.kind === 'episode' ? 'TV' : '';
            return `<a class="result" role="option" href="${esc(it.href)}" data-idx="${idx}">
              <div class="result__img">${it.poster ? `<img src="${esc(it.poster)}" alt="" loading="lazy">` : ''}</div>
              <div><div class="result__title">${highlight(it.title, q)}</div><div class="result__sub">${esc(sub)}</div></div>
              ${tag ? `<span class="badge">${tag}</span>` : ''}
            </a>`;
          })
          .join('');
    })
    .join('');
  results.innerHTML = html || `<div class="palette__empty">No matches for “${esc(q)}”. Try a director, actor, decade — or a line of dialogue in quotes.</div>`;
  select(0);
}

function select(n) {
  const els = results.querySelectorAll('.result');
  if (!els.length) return;
  selected = (n + els.length) % els.length;
  els.forEach((e, i) => {
    e.classList.toggle('is-selected', i === selected);
    e.setAttribute('aria-selected', i === selected);
  });
  els[selected].scrollIntoView({ block: 'nearest' });
}
