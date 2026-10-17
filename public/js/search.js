// ⌘K search palette. Everything it finds can be streamed: curated films, classic TV series,
// the Archive's collections, NASA — and "what's said", a full-text search through captions
// that jumps straight to the moment a line is spoken.
import { catalog, series, iaSearchText, nasaSearch, quoteSearch } from './api.js';
import { esc, icon, fmtTime } from './ui.js';

let root, input, results, items = [], selected = 0, timer, seq = 0;
let navigate = () => {};
let playQuote = () => {};

const SUGGEST = ['Hitchcock', 'Chaplin', 'Film noir', 'Buster Keaton', 'Popeye', 'The Lucy Show', 'Apollo 11', '“round up the usual”', '“I’ll be back”'];

export function initSearch(nav, { onQuote } = {}) {
  navigate = nav;
  playQuote = onQuote || playQuote;
  root = document.createElement('div');
  root.className = 'palette';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Search');
  root.innerHTML = `<div class="palette__scrim" data-close></div>
    <div class="palette__box">
      <div class="palette__field">${icon('search')}
        <input type="search" placeholder="Search films, classic TV, NASA — or a line someone says" autocomplete="off" spellcheck="false" aria-label="Search" aria-controls="palette-results">
        <button class="icon-btn" data-close aria-label="Close search">${icon('x')}</button></div>
      <div class="palette__results" id="palette-results" role="listbox"></div>
      <div class="palette__hint"><span><span class="kbd">↑</span> <span class="kbd">↓</span> to move</span><span><span class="kbd">↵</span> to open</span><span><span class="kbd">"…"</span> for exact lines</span><span><span class="kbd">esc</span> to close</span></div>
    </div>`;
  document.body.appendChild(root);
  input = root.querySelector('input');
  results = root.querySelector('.palette__results');

  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) return closeSearch();
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
}

function open(it) {
  if (!it) return;
  closeSearch();
  if (it.quote) return playQuote(it.quote);
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
  n.split(/\s+/).forEach((w) => w && hay.includes(w) && (s += 15));
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
  const local = quoted ? [] : films.map((f) => [f, score(f, q)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([f]) => f);
  const tv = quoted ? [] : shows.map((s) => [s, score(s, q)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([s]) => s);
  render([{ label: 'Films', list: local }, { label: 'Classic TV', list: tv }, { label: 'Searching…', loading: true }], q);
  if (q.length < 2) return;
  const [ia, nasa, lines] = await Promise.allSettled([
    quoted ? Promise.resolve([]) : iaSearchText(q, 10),
    quoted ? Promise.resolve({ items: [] }) : nasaSearch(q, { rows: 6 }),
    q.length >= 4 ? quoteSearch(q) : Promise.resolve([]),
  ]);
  if (my !== seq) return;
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
  render([
    { label: 'What’s said', list: said, quotes: true },
    { label: 'Films', list: local },
    { label: 'Classic TV', list: tv },
    { label: 'From the Internet Archive', list: vault },
    { label: 'NASA', list: space },
  ].sort((a, b) => (quoted && a.quotes ? -1 : 0) - (quoted && b.quotes ? -1 : 0)), q);
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
            const sub = it.kind === 'series'
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
