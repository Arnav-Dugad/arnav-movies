// ⌘K search palette: instant local matches from the curated catalog,
// then live results from the Internet Archive and TVMaze.
import { catalog, iaSearchText, searchShows } from './api.js';
import { esc, icon } from './ui.js';

let root, input, results, items = [], selected = 0, timer, seq = 0;
let navigate = () => {};

const SUGGEST = ['Hitchcock', 'Nosferatu', 'Film noir', 'Buster Keaton', 'Breaking Bad', 'The Office', 'Severance', 'Twilight Zone'];

export function initSearch(nav) {
  navigate = nav;
  root = document.createElement('div');
  root.className = 'palette';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Search');
  root.innerHTML = `<div class="palette__scrim" data-close></div>
    <div class="palette__box">
      <div class="palette__field">${icon('search')}
        <input type="search" placeholder="Search films, classic TV and shows" autocomplete="off" spellcheck="false" aria-label="Search" aria-controls="palette-results">
        <button class="icon-btn" data-close aria-label="Close search">${icon('x')}</button></div>
      <div class="palette__results" id="palette-results" role="listbox"></div>
      <div class="palette__hint"><span><span class="kbd">↑</span> <span class="kbd">↓</span> to move</span><span><span class="kbd">↵</span> to open</span><span><span class="kbd">esc</span> to close</span></div>
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
      go(r.getAttribute('href'));
    }
  });
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(run, 160);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      select(selected + (e.key === 'ArrowDown' ? 1 : -1));
    } else if (e.key === 'Enter' && items[selected]) {
      e.preventDefault();
      go(items[selected].href);
    } else if (e.key === 'Escape') closeSearch();
  });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      root.classList.contains('is-open') ? closeSearch() : openSearch();
    } else if (e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName) && !document.querySelector('.player')) {
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

function go(href) {
  closeSearch();
  navigate(href);
}

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

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
  const hay = norm([...f.director, ...f.cast, ...f.genres, ...f.tags, f.year].join(' '));
  n.split(/\s+/).forEach((w) => w && hay.includes(w) && (s += 15));
  return s;
}

async function run() {
  const q = input.value.trim();
  const my = ++seq;
  const films = await catalog();
  if (!q) {
    items = films.slice().sort(() => Math.random() - 0.5).slice(0, 5);
    render([{ label: 'Try', suggest: true }, { label: 'Trending free classics', list: items }], q);
    return;
  }
  const local = films.map((f) => [f, score(f, q)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([f]) => f);
  render([{ label: 'Free to watch', list: local }, { label: 'Searching…', loading: true }], q);
  if (q.length < 2) return;
  const [ia, tv] = await Promise.allSettled([iaSearchText(q, 10), searchShows(q)]);
  if (my !== seq) return;
  const seen = new Set(local.map((f) => f.id));
  const vault = (ia.value || []).filter((x) => !seen.has(x.id)).slice(0, 8);
  const shows = (tv.value || []).slice(0, 8);
  render([
    { label: 'Free to watch', list: local },
    { label: 'From the Internet Archive', list: vault },
    { label: 'TV shows', list: shows },
  ], q);
}

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
            const sub = it.kind === 'show'
              ? [it.year, it.network, it.genres[0]].filter(Boolean).join(' · ')
              : [it.year, it.director?.[0], it.genres?.[0]].filter(Boolean).join(' · ');
            return `<a class="result" role="option" href="${esc(it.href)}" data-idx="${idx}">
              <div class="result__img">${it.poster ? `<img src="${esc(it.poster)}" alt="" loading="lazy">` : ''}</div>
              <div><div class="result__title">${highlight(it.title, q)}</div><div class="result__sub">${esc(sub)}</div></div>
              ${it.playable ? '<span class="badge badge--free">Free</span>' : `<span class="badge">${it.kind === 'show' ? 'TV' : 'Info'}</span>`}
            </a>`;
          })
          .join('');
    })
    .join('');
  results.innerHTML = html || `<div class="palette__empty">No matches for “${esc(q)}”. Try a director, actor or decade.</div>`;
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
