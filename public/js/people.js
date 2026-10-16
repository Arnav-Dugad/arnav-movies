// Actor & director pages built from Wikidata + Wikipedia, with the titles you can watch free marked.
import * as api from './api.js';
import { esc, icon, posterCard, row, wireRows, setAmbient, footer, emptyState } from './ui.js';
import { reg, notFound } from './views.js';

const fmtDate = (d) => {
  if (!d) return '';
  const dt = new Date(d + 'T00:00:00Z');
  return isNaN(dt) ? d.slice(0, 4) : dt.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
};
const age = (born, died) => {
  if (!born) return null;
  const a = new Date(born), b = died ? new Date(died) : new Date();
  let y = b.getUTCFullYear() - a.getUTCFullYear();
  if (b.getUTCMonth() < a.getUTCMonth() || (b.getUTCMonth() === a.getUTCMonth() && b.getUTCDate() < a.getUTCDate())) y--;
  return isNaN(y) ? null : y;
};

export async function personView(ctx, qid) {
  ctx.el.innerHTML = `<div class="view"><div class="container"><div class="person-hero"><div class="skel" style="width:180px;height:180px;border-radius:50%"></div><div style="flex:1"><div class="skel" style="height:56px;width:60%"></div><div class="skel skel--line"></div><div class="skel skel--line" style="width:40%"></div></div></div></div></div>`;
  let p, films;
  try {
    [p, films] = await Promise.all([api.person(qid), api.catalog()]);
  } catch {
    return ctx.alive() && notFound(ctx);
  }
  if (!ctx.alive()) return;
  document.title = `${p.name} — Lumen`;
  const byImdb = new Map(films.filter((f) => f.imdb).map((f) => [f.imdb, f]));
  const free = new Map();
  p.films.forEach((f) => f.imdb && byImdb.has(f.imdb) && free.set(byImdb.get(f.imdb).key, byImdb.get(f.imdb)));
  films.forEach((f) => (f.people.some((x) => x.qid === qid) || f.directors.some((d) => d.q === qid)) && free.set(f.key, f));
  const freeList = reg([...free.values()].sort((a, b) => (a.year || 0) - (b.year || 0)));
  const freeImdb = new Set(freeList.map((f) => f.imdb));
  const a = age(p.born, p.died);
  const decades = new Map();
  p.films.forEach((f) => {
    const d = f.year ? Math.floor(f.year / 10) * 10 + 's' : 'Undated';
    if (!decades.has(d)) decades.set(d, []);
    decades.get(d).push(f);
  });
  const photo = p.photo || freeList.flatMap((f) => f.people).find((x) => x.qid === qid && x.photo)?.photo;

  ctx.el.innerHTML = `<div class="view"><div class="container">
    <header class="person-hero">
      <div class="person-hero__photo">${photo ? `<img src="${esc(photo)}" alt="${esc(p.name)}">` : `<span>${esc(p.name.split(' ').map((w) => w[0]).slice(0, 2).join(''))}</span>`}</div>
      <div class="person-hero__body">
        <div class="eyebrow">${esc(p.occupations.slice(0, 3).join(' · ') || 'Person')}</div>
        <h1 class="page-title">${esc(p.name)}</h1>
        <p class="page-sub">${esc(p.description)}</p>
        <div class="chips" style="margin-top:14px">
          ${p.born ? `<span>Born ${esc(fmtDate(p.born))}${p.birthplace ? ` in ${esc(p.birthplace)}` : ''}</span>` : ''}
          ${p.died ? `<span class="dot"></span><span>Died ${esc(fmtDate(p.died))}${a != null ? ` (aged ${a})` : ''}</span>` : a != null ? `<span class="dot"></span><span>Age ${a}</span>` : ''}
        </div>
        <div class="links">
          ${freeList.length ? `<span class="badge badge--free">${freeList.length} free to watch</span>` : ''}
          ${p.wiki ? `<a class="btn btn--glass btn--sm" href="${esc(p.wiki)}" target="_blank" rel="noopener">Wikipedia ${icon('external')}</a>` : ''}
          <a class="btn btn--glass btn--sm" href="https://www.wikidata.org/wiki/${esc(qid)}" target="_blank" rel="noopener">Wikidata ${icon('external')}</a>
        </div>
      </div>
    </header>
    ${p.bio ? `<p class="prose" style="max-width:72ch;margin-top:28px">${esc(p.bio)}</p>` : ''}
  </div>
  <div class="rows" style="margin-top:44px">
    ${freeList.length ? row({ title: 'Watch Free on Lumen', sub: `${freeList.length} public-domain title${freeList.length > 1 ? 's' : ''}`, cards: freeList.map((f) => posterCard(f)).join('') }) : ''}
    <div class="container">
      <h2 class="section-title">Filmography <small style="color:var(--text-3);font-weight:500;font-size:14px">${p.films.length} titles</small></h2>
      ${p.films.length ? [...decades].map(([d, list]) => `<section class="filmo"><h3>${esc(d)}</h3><ul>${list.map((f) => {
        const isFree = f.imdb && freeImdb.has(f.imdb);
        const href = isFree ? byImdb.get(f.imdb).href : f.imdb ? `https://www.imdb.com/title/${f.imdb}/` : `https://www.wikidata.org/wiki/${f.qid}`;
        return `<li><a href="${esc(href)}" ${isFree ? '' : 'target="_blank" rel="noopener"'}><span class="filmo__year">${f.year || '—'}</span><span class="filmo__title">${esc(f.title)}</span><span class="filmo__roles">${esc(f.roles.join(', '))}</span>${isFree ? '<span class="badge badge--free">Free</span>' : `<span class="filmo__ext">${icon('external')}</span>`}</a></li>`;
      }).join('')}</ul></section>`).join('') : emptyState({ title: 'No filmography yet', text: 'Wikidata doesn’t list any films for this person.' })}
    </div>
  </div>${footer()}</div>`;
  if (photo) setAmbient(photo);
  wireRows(ctx.el);
}
