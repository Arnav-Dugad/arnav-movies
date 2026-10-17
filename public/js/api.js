// Data layer. Every source here is free:
//   /data/catalog.json  verified public-domain films (built by scripts/build-catalog.py)
//   /api/*              our Cloudflare Worker: TMDB proxy, subtitles, geo, stream-health
//   Internet Archive    streams, the 28,000-film Vault, classic TV and cartoons
//   NASA Image & Video  public-domain NASA films and clips
//   Wikidata/Wikipedia  people pages and summaries
// To add a source, write a provider that returns the same item shape (see the `to*` mappers).

import { store } from './store.js';

const memory = new Map();
const inflight = new Map();

async function getJSON(url, { ttl = 30 * 60e3, persist = true, init } = {}) {
  const key = init?.body ? url + '#' + init.body : url;
  const now = Date.now();
  const hit = memory.get(key);
  if (hit && now - hit.t < ttl) return hit.v;
  if (persist) {
    try {
      const stored = JSON.parse(sessionStorage.getItem('lc:' + key));
      if (stored && now - stored.t < ttl) {
        memory.set(key, stored);
        return stored.v;
      }
    } catch {}
  }
  if (inflight.has(key)) return inflight.get(key);
  const p = fetch(url, init)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((v) => {
      const entry = { t: Date.now(), v };
      memory.set(key, entry);
      if (persist) {
        try { sessionStorage.setItem('lc:' + key, JSON.stringify(entry)); } catch {}
      }
      return v;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export const stripHtml = (s = '') => {
  const doc = new DOMParser().parseFromString(String(s), 'text/html');
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
};

const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

/* ------------------------------------------------------------------- tmdb */
const TMDB_IMG = 'https://image.tmdb.org/t/p/';
export const tmdbImg = (path, size = 'w500') => (path ? TMDB_IMG + size + path : null);
export const tmdb = (path, params = {}) => {
  const url = `/api/tmdb/${path}?${new URLSearchParams(params)}`;
  return getJSON(url, { ttl: 3 * 3600e3 }).catch(() => new Promise((r) => setTimeout(r, 800)).then(() => getJSON(url, { ttl: 3 * 3600e3 })));
};

/* ------------------------------------------------------------ worker config */
let configPromise;
export function config() {
  configPromise ??= getJSON('/api/geo', { ttl: 3600e3 }).catch(() => ({ country: regionFromLocale() }));
  return configPromise;
}
const regionFromLocale = () => {
  const r = (navigator.language || 'en-US').split('-')[1];
  return r && /^[A-Z]{2}$/.test(r) ? r : 'US';
};
export const countryName = (code) => {
  try { return new Intl.DisplayNames([navigator.language || 'en'], { type: 'region' }).of(code); } catch { return code; }
};

/* ------------------------------------------------------------------ catalog */
let catalogPromise;
export function catalog() {
  catalogPromise ??= Promise.all([
    getJSON('/data/catalog.json?v=2', { ttl: Infinity, persist: false }),
    getJSON('/data/text.json?v=1', { ttl: Infinity, persist: false }).catch(() => null),
  ]).then(([d, text]) => {
    const films = d.films.map(toItemFromCatalog);
    // Plot and dialogue model (scripts/build-themes.py): neighbours by what films are about, plus themes.
    if (text && text.n === films.length && text.first === d.films[0]?.id) {
      films.forEach((f, i) => {
        const nb = text.nb[i] || [];
        f.tx = new Map();
        for (let k = 0; k < nb.length; k += 2) f.tx.set(films[nb[k]]?.key, nb[k + 1] / 100);
        f.themes = text.th[i] || [];
      });
    }
    return films;
  });
  return catalogPromise;
}

/** Plot keywords for "the one where…" search, aligned with the catalog (loaded on first search). */
let plotsPromise;
export function plotIndex() {
  plotsPromise ??= Promise.all([catalog(), getJSON('/data/plots.json?v=1', { ttl: Infinity, persist: false })])
    .then(([films, p]) => (p.n === films.length && films[0]?.id === p.first ? films.map((f, i) => ({ film: f, kw: ` ${p.kw[i] || ''} ` })) : []))
    .catch(() => []);
  return plotsPromise;
}

function toItemFromCatalog(f) {
  const still = f.still ? '/data/stills/' + f.still : null; // best scene, for films without a TMDB backdrop
  return {
    key: 'ia:' + f.id,
    kind: 'movie',
    source: 'catalog',
    id: f.id,
    file: f.file,
    preview: f.pv || f.file,
    length: f.len,
    title: f.title,
    year: f.year,
    poster: tmdbImg(f.poster, 'w342'),
    posterHd: tmdbImg(f.poster, 'w780'),
    backdrop: tmdbImg(f.backdrop, 'w1280'),
    backdropSm: tmdbImg(f.backdrop, 'w780') || still,
    still,
    stillLow: !!f.stlo,
    logo: tmdbImg(f.logo, 'w500'),
    trailer: f.trailer,
    slug: f.s || f.id.replace(/[^A-Za-z0-9_-]/g, '_'),
    tagline: '',
    overview: f.blurb || '',
    genres: f.genres || [],
    tags: f.tags || [],
    runtime: f.runtime,
    director: (f.director || []).map((d) => d.n),
    directors: f.director || [],
    cast: (f.cast || []).map((c) => c.n),
    people: (f.cast || []).map((c) => ({ name: c.n, role: '', photo: null, qid: c.q })),
    country: [],
    language: [],
    imdb: f.imdb,
    tmdb: f.tmdb,
    rating: f.rating || {},
    votes: f.votes || 0,
    playable: true,
    href: '/title/' + encodeURIComponent(f.id),
  };
}

export async function catalogById(id) {
  return (await catalog()).find((f) => f.id === id);
}

/** Full overview, cast photos and facts for a catalog film (kept out of the index to keep it small). */
export async function catalogDetail(item) {
  if (!item.slug || item.detailed) return item;
  const d = await getJSON(`/data/f/${item.slug}.json`, { ttl: Infinity, persist: false }).catch(() => null);
  if (!d) return item;
  return Object.assign(item, {
    detailed: true,
    overview: d.overview || item.overview,
    tagline: d.tagline || '',
    people: (d.cast || []).map((c) => ({ name: c.n, role: c.c, photo: tmdbImg(c.p, 'w185'), qid: c.q })),
    cast: (d.cast || []).map((c) => c.n),
    country: d.country || [],
    language: d.language || [],
    wiki: d.wiki,
    qid: d.qid,
    release: d.rel || {},
    marks: d.mk || null, // where opening titles end / credits begin (captions or frame analysis)
    // Slideshow frames for films without a trailer: TMDB backdrops, else our best-scene stills.
    slides: [item.backdrop, ...(d.backdrops || []).map((p) => tmdbImg(p, 'w1280'))].filter(Boolean).concat((d.stills || []).map((s) => '/data/stills/' + s)),
  });
}

/** Release date and certificate for the viewer's country (falling back to the U.S., then any). */
export async function releaseFor(item) {
  const rel = item.release || {};
  const { country } = await config();
  const code = rel[country] ? country : rel.US ? 'US' : Object.keys(rel)[0];
  return code ? { country: code, date: rel[code].d, cert: rel[code].c || null, local: code === country } : null;
}

/* ------------------------------------------------------------ classic TV series */
let seriesPromise;
export function series() {
  seriesPromise ??= getJSON('/data/tv.json?v=1', { ttl: Infinity, persist: false })
    .then((d) => d.series.map(toSeries))
    .catch(() => []);
  return seriesPromise;
}

function toSeries(s) {
  const item = {
    key: 'series:' + s.sid,
    kind: 'series',
    source: 'archive-series',
    id: s.sid,
    title: s.name,
    year: s.year,
    poster: tmdbImg(s.poster, 'w342'),
    posterHd: tmdbImg(s.poster, 'w780'),
    backdrop: tmdbImg(s.backdrop, 'w1280'),
    backdropSm: tmdbImg(s.backdrop, 'w780'),
    logo: tmdbImg(s.logo, 'w500'),
    overview: s.overview || '',
    genres: s.genres || [],
    tags: [],
    network: s.network,
    rating: s.rating ? { tmdb: s.rating } : {},
    count: s.count,
    tmdb: s.tmdb,
    playable: true,
    href: '/series/' + s.sid,
  };
  item.nseasons = s.nseasons;
  return item;
}

/** Episode guide for one series (loaded on demand; the index stays tiny). */
export async function seriesEpisodes(item) {
  if (item.seasons) return item;
  const raw = await getJSON(`/data/tv/${item.id}.json?v=1`, { ttl: Infinity, persist: false }).catch(() => []);
  item.seasons = raw.map((season) => ({
    n: season.n,
    label: season.label,
    eps: season.eps.map((e) => ({
      key: `ep:${e.id}/${e.file}`,
      kind: 'episode',
      source: 'archive-series',
      id: e.id,
      file: e.file,
      length: e.len,
      title: e.t || 'Episode',
      s: e.s,
      e: e.e,
      overview: e.ov || '',
      air: e.air,
      still: e.still ? tmdbImg(e.still, 'w300') : iaThumb(e.id),
      poster: item.poster,
      posterHd: item.posterHd,
      backdrop: item.backdrop,
      backdropSm: e.still ? tmdbImg(e.still, 'w780') : item.backdropSm,
      series: item.id,
      seriesTitle: item.title,
      genres: item.genres,
      tags: [],
      rating: {},
      playable: true,
      href: '/series/' + item.id,
    })),
  }));
  item.episodes = item.seasons.flatMap((x) => x.eps);
  return item;
}

export async function seriesById(sid) {
  const s = (await series()).find((x) => x.id === sid);
  return s ? seriesEpisodes(s) : null;
}

/* ------------------------------------------------------------- subtitles */
export async function subtitleText(item, choice) {
  const url = choice.source === 'os'
    ? `/api/subs/os?imdb=${encodeURIComponent(item.imdb)}&lang=${encodeURIComponent(choice.lang || 'en')}`
    : `/api/subs/ia?id=${encodeURIComponent(item.id)}&file=${encodeURIComponent(choice.file)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('No subtitles');
  return res.text();
}

export const subtitleLangs = (imdb) =>
  imdb ? getJSON(`/api/subs/langs?imdb=${encodeURIComponent(imdb)}`, { ttl: 7 * 86400e3 }).catch(() => []) : Promise.resolve([]);

export async function catalogByImdb() {
  const films = await catalog();
  return new Map(films.filter((f) => f.imdb).map((f) => [f.imdb, f]));
}

/* ---------------------------------------------------------- internet archive */
const IA = 'https://archive.org';
export const iaThumb = (id) => `${IA}/services/img/${encodeURIComponent(id)}`;
export const iaFile = (id, file) => `${IA}/download/${encodeURIComponent(id)}/${file.split('/').map(encodeURIComponent).join('/')}`;
export const iaStream = iaFile;

const IA_FIELDS = ['identifier', 'title', 'year', 'date', 'downloads', 'avg_rating', 'subject', 'runtime', 'description', 'creator', 'collection'];

function parseRuntime(r) {
  if (!r) return null;
  const s = String(r);
  const parts = s.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (parts) {
    const [, a, b, c] = parts;
    return c != null ? +a * 60 + +b + Math.round(+c / 60) : +a + Math.round(+b / 60);
  }
  const min = s.match(/(\d+)\s*min/i);
  return min ? +min[1] : null;
}

const cleanTitle = (t = '') => String(t).replace(/\s*\((19|20)\d{2}\)\s*$/, '').replace(/_/g, ' ').trim();

function toItemFromIA(d) {
  const subjects = asArray(d.subject)
    .flatMap((s) => String(s).split(/[;,]/))
    .map((s) => s.trim())
    .filter((s) => s && s.length < 28);
  const year = +d.year || +String(d.date || '').slice(0, 4) || null;
  const collections = asArray(d.collection);
  return {
    key: 'ia:' + d.identifier,
    kind: collections.includes('classic_tv') ? 'episode' : 'movie',
    source: 'archive',
    id: d.identifier,
    title: cleanTitle(d.title || d.identifier),
    year,
    poster: iaThumb(d.identifier),
    posterHd: iaThumb(d.identifier),
    thumbOnly: true,
    overview: stripHtml(asArray(d.description)[0] || ''),
    genres: [...new Set(subjects.map((s) => s[0].toUpperCase() + s.slice(1).toLowerCase()))].slice(0, 4),
    tags: [],
    runtime: parseRuntime(d.runtime),
    director: asArray(d.creator).slice(0, 2),
    cast: [],
    rating: {},
    downloads: d.downloads || 0,
    playable: true,
    href: '/title/' + encodeURIComponent(d.identifier),
  };
}

export async function iaSearch({ q = '', collection = 'feature_films', sort = 'downloads desc', rows = 30, page = 1, filter = '' } = {}) {
  const parts = [`collection:(${collection})`, 'mediatype:movies'];
  if (q) parts.push(`(${q})`);
  if (filter) parts.push(`(${filter})`);
  const params = new URLSearchParams({ q: parts.join(' AND '), rows, page, output: 'json' });
  IA_FIELDS.forEach((f) => params.append('fl[]', f));
  if (sort) params.append('sort[]', sort);
  const d = await getJSON(`${IA}/advancedsearch.php?${params}`, { ttl: 6 * 3600e3 });
  return { total: d.response.numFound, items: d.response.docs.map(toItemFromIA) };
}

export async function iaSearchText(text, rows = 12) {
  const safe = text.replace(/[^\p{L}\p{N}\s'-]/gu, ' ').trim();
  if (!safe) return [];
  const words = safe.split(/\s+/).map((w) => `title:${w}*`).join(' AND ');
  const { items } = await iaSearch({ q: words, collection: 'feature_films OR classic_tv', rows });
  return items;
}

const bySize = (a, b) => +(b.size || 0) - +(a.size || 0);

/** Full metadata for one Archive item: best stream, alternates, preview, subtitles and scene thumbnails. */
export async function iaItem(id) {
  const d = await getJSON(`${IA}/metadata/${encodeURIComponent(id)}`, { ttl: 24 * 3600e3, persist: false });
  if (!d || !d.metadata) throw new Error('Not found');
  const md = d.metadata;
  const files = d.files || [];
  const item = toItemFromIA({ ...md, identifier: id });
  const mp4 = files.filter((f) => /\.mp4$/i.test(f.name)).sort(bySize);
  const good = mp4.filter((f) => +(f.size || 0) < 2.5e9);
  item.file = (good[0] || mp4[0])?.name || null;
  item.alts = mp4.map((f) => f.name).filter((n) => n !== item.file);
  item.preview = mp4[mp4.length - 1]?.name || item.file;
  item.length = Math.max(0, ...mp4.map((f) => +f.length || 0)) || null;
  item.playable = !!item.file;
  item.overview = stripHtml(asArray(md.description).join(' '));
  item.license = md.licenseurl || null;
  // Prefer captions made for the original encode over the 512kb copy; one entry per label.
  const seenLabels = new Set();
  item.subtitles = files
    .filter((f) => /\.(srt|vtt)$/i.test(f.name))
    .sort((a, b) => /512kb/i.test(a.name) - /512kb/i.test(b.name))
    .map((f) => ({
      file: f.name,
      label: /\.asr\.|auto.?generated/i.test(f.name) ? 'English (auto-generated)' : f.name.replace(/^.*[/\\]|\.(srt|vtt)$/gi, '').replace(/[_.-]+/g, ' ').trim(),
    }))
    .filter((s) => !seenLabels.has(s.label) && seenLabels.add(s.label));
  item.thumbs = files
    .map((f) => {
      const m = f.name.match(/\.thumbs\/.+_(\d{6})\.jpg$/i);
      return m ? { t: +m[1], url: iaFile(id, f.name) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.t - b.t);
  return item;
}

/** Same series in classic TV: the next item whose title shares this one's series prefix. */
export async function nextEpisode(item) {
  const prefix = item.title.split(/\s[-–|:]\s|\s(?:S\d+|Season|Episode|Ep\.?)\s*\d/i)[0].trim();
  if (prefix.length < 3 || prefix === item.title) return null;
  const words = prefix.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).slice(0, 5);
  const { items } = await iaSearch({ collection: 'classic_tv', q: words.map((w) => `title:${w}`).join(' AND '), sort: 'titleSorter asc', rows: 200 });
  const i = items.findIndex((x) => x.id === item.id);
  return i >= 0 ? items[i + 1] || null : null;
}

export async function resolveTitle(id) {
  const curated = await catalogById(id);
  if (curated) return catalogDetail(curated);
  const item = await iaItem(id);
  const wiki = await wikiLookup(item.title, item.year).catch(() => null);
  if (wiki) {
    if (wiki.poster) Object.assign(item, { poster: wiki.poster, posterHd: wiki.posterHd, thumbOnly: false });
    if (wiki.extract && (!item.overview || item.overview.length < 80)) item.overview = wiki.extract;
    item.wiki = wiki.url;
    item.tagline = wiki.description;
  }
  return item;
}


/* ------------------------------------------------------- stream health */
export function report(ev, item, extra = {}) {
  if (!store.pref('reports', true)) return; // Settings → Privacy
  try {
    const body = JSON.stringify({ ev, id: item.id, file: item.file, ...extra });
    if (!navigator.sendBeacon?.('/api/report', new Blob([body], { type: 'application/json' }))) {
      fetch('/api/report', { method: 'POST', body, headers: { 'content-type': 'application/json' }, keepalive: true }).catch(() => {});
    }
  } catch {}
}

let deadPromise;
export function deadFiles() {
  deadPromise ??= getJSON('/api/health/dead', { ttl: 10 * 60e3 })
    .then((rows) => new Set(rows.map((r) => r.item + '|' + r.file)))
    .catch(() => new Set());
  return deadPromise;
}

export const health = () => fetch('/api/health').then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))));

/* ----------------------------------------------------------------- wikipedia */
async function wikiLookup(title, year) {
  const q = `${title} ${year || ''} film`.trim();
  const s = await getJSON(`https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=1&srsearch=${encodeURIComponent(q)}`, { ttl: 7 * 86400e3 });
  const hit = s?.query?.search?.[0];
  if (!hit || !/film|movie/i.test(hit.snippet + hit.title)) return null;
  const sum = await wikiSummary(hit.title);
  if (!sum) return null;
  const thumb = sum.thumbnail?.source?.split('?')[0];
  const orig = sum.originalimage;
  const sized = (w) => (orig && orig.width <= w ? orig.source.split('?')[0] : thumb?.replace(/\/\d+px-/, `/${w}px-`));
  return { url: sum.content_urls?.desktop?.page, extract: sum.extract, description: sum.description, poster: thumb ? sized(500) : null, posterHd: thumb ? sized(1280) : null };
}

export async function wikiSummary(title) {
  const sum = await getJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, { ttl: 7 * 86400e3 });
  return sum && sum.type === 'standard' ? sum : null;
}

/* ------------------------------------------------------------------ wikidata */
const sparql = (q) =>
  // Direct from the browser: Wikidata's query service stalls requests coming from Cloudflare Workers.
  getJSON(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q.replace(/\s+/g, ' ').trim())}`, { ttl: 7 * 86400e3 }).then((d) => d.results.bindings);

const FILM_TYPES = 'wd:Q11424 wd:Q24862 wd:Q202866 wd:Q506240 wd:Q17517379';

export async function person(qid) {
  if (!/^Q\d+$/.test(qid)) throw new Error('bad id');
  const [facts, films] = await Promise.all([
    sparql(`SELECT ?label ?desc ?img ?born ?died ?placeLabel ?article (GROUP_CONCAT(DISTINCT ?occLabel; separator="|") AS ?occs) WHERE {
      BIND(wd:${qid} AS ?p)
      ?p rdfs:label ?label . FILTER(LANG(?label) = "en")
      OPTIONAL { ?p schema:description ?desc . FILTER(LANG(?desc) = "en") }
      OPTIONAL { ?p wdt:P18 ?img }
      OPTIONAL { ?p wdt:P569 ?born }
      OPTIONAL { ?p wdt:P570 ?died }
      OPTIONAL { ?p wdt:P19 ?place . ?place rdfs:label ?placeLabel . FILTER(LANG(?placeLabel) = "en") }
      OPTIONAL { ?p wdt:P106 ?occ . ?occ rdfs:label ?occLabel . FILTER(LANG(?occLabel) = "en") }
      OPTIONAL { ?article schema:about ?p ; schema:isPartOf <https://en.wikipedia.org/> }
    } GROUP BY ?label ?desc ?img ?born ?died ?placeLabel ?article LIMIT 1`),
    sparql(`SELECT ?film ?filmLabel (MIN(?date) AS ?d) (SAMPLE(?imdb) AS ?i) (GROUP_CONCAT(DISTINCT ?role; separator="|") AS ?roles) WHERE {
      VALUES ?type { ${FILM_TYPES} }
      { ?film wdt:P161 wd:${qid} . BIND("Actor" AS ?role) } UNION { ?film wdt:P57 wd:${qid} . BIND("Director" AS ?role) }
      UNION { ?film wdt:P58 wd:${qid} . BIND("Writer" AS ?role) } UNION { ?film wdt:P162 wd:${qid} . BIND("Producer" AS ?role) }
      ?film wdt:P31 ?type .
      OPTIONAL { ?film wdt:P577 ?date }
      OPTIONAL { ?film wdt:P345 ?imdb }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    } GROUP BY ?film ?filmLabel ORDER BY DESC(?d) LIMIT 400`),
  ]);
  const f = facts[0];
  if (!f) throw new Error('Not found');
  const article = f.article?.value;
  const summary = article ? await wikiSummary(decodeURIComponent(article.split('/wiki/')[1])).catch(() => null) : null;
  const img = f.img?.value;
  return {
    qid,
    name: f.label.value,
    description: f.desc?.value || summary?.description || '',
    // Wikipedia's thumbnail is CORS-enabled (ambient colour sampling); Commons FilePath redirects are not.
    photo: summary?.thumbnail?.source?.replace(/\/\d+px-/, '/500px-') || (img ? img.replace('http://', 'https://') + '?width=600' : null),
    born: f.born?.value?.slice(0, 10) || null,
    died: f.died?.value?.slice(0, 10) || null,
    birthplace: f.placeLabel?.value || null,
    occupations: (f.occs?.value || '').split('|').filter(Boolean).slice(0, 5),
    bio: summary?.extract || '',
    wiki: article,
    films: films
      .map((r) => ({ qid: r.film.value.split('/').pop(), title: r.filmLabel.value, year: r.d ? +r.d.value.slice(0, 4) : null, imdb: r.i?.value || null, roles: r.roles.value.split('|') }))
      .filter((x) => !/^Q\d+$/.test(x.title)),
  };
}

/* --------------------------------------------------------------- more sources */
// Everything here streams free and legally: NASA video is public domain; Universal Newsreels,
// Prelinger and FedFlix are public-domain collections; the Creative Commons picks are open movies.
export const SOURCES = {
  curated: { label: 'Curated', sub: 'Verified public-domain classics' },
  vault: { label: 'The Vault', sub: '28,000 films on the Internet Archive', collection: 'feature_films' },
  newsreels: { label: 'Newsreels', sub: 'Universal Newsreels, 1929–1967', collection: 'universal_newsreels' },
  prelinger: { label: 'Prelinger Archives', sub: 'Ads, educational and industrial films', collection: 'prelinger' },
  government: { label: 'Government Films', sub: 'FedFlix: films made by the U.S. government', collection: 'FedFlix' },
  nasa: { label: 'NASA', sub: 'Missions, launches and science from NASA', nasa: true },
  cc: { label: 'Creative Commons', sub: 'Open movies you’re free to watch and share', collection: 'open-film-trust' },
};

const NASA = 'https://images-api.nasa.gov';
const https = (u) => (u ? u.replace(/^http:\/\//, 'https://') : u);

function toNasa(it) {
  const d = it?.data?.[0];
  if (!d) return null;
  const links = it.links || [];
  const img = https((links.find((l) => /~(large|medium)\.jpg$/i.test(l.href)) || links[0])?.href);
  return {
    key: 'nasa:' + d.nasa_id,
    kind: 'clip',
    source: 'nasa',
    id: d.nasa_id,
    title: d.title,
    year: +String(d.date_created || '').slice(0, 4) || null,
    poster: img,
    posterHd: img,
    backdrop: img,
    backdropSm: img,
    overview: stripHtml(d.description || '').slice(0, 700),
    genres: ['Space'],
    tags: ['nasa'],
    credit: [d.center, 'NASA'].filter(Boolean).join(' · '),
    manifest: https(it.href),
    rating: {},
    playable: true,
    href: '/watch/nasa/' + encodeURIComponent(d.nasa_id),
  };
}

export async function nasaSearch(q = 'apollo', { page = 1, rows = 24 } = {}) {
  const d = await getJSON(`${NASA}/search?media_type=video&q=${encodeURIComponent(q)}&page=${page}&page_size=${rows}`, { ttl: 24 * 3600e3 });
  return { total: d.collection?.metadata?.total_hits || 0, items: (d.collection?.items || []).map(toNasa).filter(Boolean) };
}

export async function nasaItem(id) {
  const d = await getJSON(`${NASA}/search?nasa_id=${encodeURIComponent(id)}&media_type=video`, { ttl: 7 * 86400e3 });
  const item = toNasa(d.collection?.items?.[0]);
  if (!item) throw new Error('Not found');
  return item;
}

/** The best MP4 (and captions, if NASA published them) for a NASA video. */
export async function nasaStream(item) {
  const files = (await getJSON(item.manifest, { ttl: 7 * 86400e3 })).map(https);
  const pick = (re) => files.find((f) => re.test(f));
  return {
    src: pick(/~mobile\.mp4$/i) || pick(/~medium\.mp4$/i) || pick(/~small\.mp4$/i) || pick(/~orig\.mp4$/i) || pick(/\.mp4$/i),
    srt: pick(/\.srt$/i) || pick(/\.vtt$/i) || null,
  };
}

/** Items for one of the extra sources (Archive collections or NASA). */
export async function sourceItems(key, { page = 1, rows = 36, sort = 'downloads desc', filter = '' } = {}) {
  const s = SOURCES[key];
  if (s?.nasa) return nasaSearch(filter || 'apollo', { page, rows });
  return iaSearch({ collection: s.collection, page, rows, sort, filter });
}

/** A newsreel from the film's era, for the "full programme" before a feature. */
export async function newsreelFor(year) {
  const y = year || 1940;
  for (const span of [3, 8, 40]) {
    const { items } = await iaSearch({
      collection: 'universal_newsreels OR prelinger',
      filter: `(collection:universal_newsreels OR title:newsreel) AND year:[${y - span} TO ${y + span}]`,
      rows: 20,
    }).catch(() => ({ items: [] }));
    const fit = items.filter((x) => !x.runtime || x.runtime <= 14);
    if (fit.length) return fit[Math.floor(Math.random() * Math.min(6, fit.length))];
  }
  return null;
}

/* ------------------------------------------------------------ space */
// Launch Library's free tier allows 15 calls an hour per IP. Cloudflare's shared IPs run out, so each
// viewer's browser asks directly (with CORS, cached 15 minutes) and the Worker is only a fallback.
const trimLaunch = (l) => {
  const v = [...(l.vid_urls || [])].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  return {
    id: l.id,
    name: l.mission?.name || l.name,
    full: l.name,
    net: l.net,
    precision: l.net_precision?.abbrev || null,
    status: l.status?.abbrev || null,
    statusName: l.status?.name || null,
    provider: l.launch_service_provider?.name || null,
    rocket: l.rocket?.configuration?.full_name || null,
    type: l.mission?.type || null,
    orbit: l.mission?.orbit?.name || null,
    about: (l.mission?.description || '').slice(0, 420),
    pad: l.pad?.name || null,
    place: l.pad?.location?.name || null,
    image: typeof l.image === 'string' ? l.image : l.image?.image_url || null,
    live: !!l.webcast_live,
    video: (v.find((u) => /youtube\.com|youtu\.be/.test(u.url)) || v[0])?.url || null,
    info: l.info_urls?.[0]?.url || null,
  };
};
export async function launches() {
  try {
    const d = await getJSON('https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=14&mode=detailed&hide_recent_previous=true', { ttl: 15 * 60e3 });
    if (d?.results?.length) return d.results.map(trimLaunch);
  } catch {}
  return getJSON('/api/launches', { ttl: 10 * 60e3, persist: false });
}

// NASA's long-running 24/7 streams, used when the live lookup can't reach YouTube.
const NASA_STREAMS = ['M3HKLzjvKPc'];
/** What NASA's official YouTube channel is streaming: { id, title, live, upcoming, start }. */
export async function nasaLive() {
  const w = await getJSON('/api/nasa-live', { ttl: 5 * 60e3, persist: false }).catch(() => null);
  if (w?.id) return w;
  for (const id of NASA_STREAMS) {
    // oEmbed answers only for videos that exist and can be embedded.
    const o = await getJSON(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}`, { ttl: 30 * 60e3 }).catch(() => null);
    if (o?.title) return { id, title: o.title, live: true, upcoming: false, start: null };
  }
  return { id: null };
}
export const youtubeEmbed = (id) => `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&mute=1&playsinline=1&rel=0&modestbranding=1`;

/* --------------------------------------------------------- newsreel timeline */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DATE_LINE = new RegExp(`^(${MONTHS.join('|')})(?: (\\d{1,2})(?:[–-]\\d{1,2})?)?\\s*(?:[–—-]\\s*(.*))?$`);

/** "What happened that year": dated events from the Wikipedia article for the year, spread across the months. */
export async function yearEvents(year) {
  const d = await getJSON(`https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exsectionformat=wiki&redirects=1&format=json&origin=*&titles=${year}`, { ttl: 30 * 86400e3 });
  const text = Object.values(d?.query?.pages || {})[0]?.extract || '';
  const start = text.indexOf('== Events ==');
  if (start < 0) return [];
  const end = text.indexOf('\n== ', start + 12);
  const lines = text.slice(start, end > 0 ? end : undefined).split('\n').map((l) => l.trim()).filter(Boolean);
  const events = [];
  let date = null;
  for (const line of lines) {
    if (line.startsWith('=')) continue;
    const m = line.match(DATE_LINE);
    if (m) {
      date = { month: MONTHS.indexOf(m[1]), day: m[2] ? +m[2] : null };
      const rest = (m[3] || '').trim();
      if (rest.length > 30 && !rest.endsWith(':')) events.push({ ...date, text: rest });
      else date.label = rest.replace(/:$/, '');
    } else if (date && line.length > 30 && !events.some((e) => e.month === date.month && e.day === date.day)) {
      events.push({ month: date.month, day: date.day, text: (date.label ? date.label + ': ' : '') + line });
    }
  }
  // Up to two per month, so the whole year shows.
  const byMonth = new Map();
  events.forEach((e) => byMonth.set(e.month, [...(byMonth.get(e.month) || []), e]));
  const picked = [];
  for (let round = 0; round < 2; round++) for (const [, list] of [...byMonth].sort((a, b) => a[0] - b[0])) list[round] && picked.push(list[round]);
  return picked
    .sort((a, b) => a.month - b.month || (a.day || 0) - (b.day || 0))
    .slice(0, 16)
    .map((e) => ({ ...e, when: MONTHS[e.month].slice(0, 3) + (e.day ? ' ' + e.day : ''), text: e.text.replace(/\s*\[\d+\]/g, '').slice(0, 240) }));
}

/** Universal Newsreels released in a given year. */
export const newsreelsOf = (year, rows = 18) =>
  iaSearch({ collection: 'universal_newsreels', filter: `year:${year}`, sort: 'downloads desc', rows }).then((r) => r.items);

/* --------------------------------------------------------- search what's said */
export const quoteSearch = (q) => getJSON(`/api/quote?v=2&q=${encodeURIComponent(q)}`, { ttl: 3600e3 }).catch(() => []);

/* ------------------------------------------------------- crowd skip points */
export const crowdMarks = (id) => getJSON(`/api/marks?id=${encodeURIComponent(id)}`, { ttl: 600e3, persist: false }).catch(() => ({}));
export function postMark(id, kind, t) {
  try {
    fetch('/api/marks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, kind, t }), keepalive: true }).catch(() => {});
  } catch {}
}

/* ------------------------------------------------------------- trivia */
const INTERESTING = /\b(first|only|originally|never|record|award|oscar|emmy|banned|censor|budget|lost|restored|rediscovered|inspired|based on|filmed|shot|cameo|improvis|remake|sequel|debut|final|famous|nominated|won|premiere|reissued|copyright)\b/i;

/** "Did you know…" facts: interesting sentences from the Wikipedia article. */
export async function trivia(title, wikiUrl) {
  let page = wikiUrl ? decodeURIComponent(wikiUrl.split('/wiki/')[1] || '') : '';
  if (!page) {
    const s = await getJSON(`https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=3&srsearch=${encodeURIComponent(title)}`, { ttl: 7 * 86400e3 }).catch(() => null);
    // Only trust an article that is actually about this title (not a list or a namesake).
    const norm = (x) => String(x).toLowerCase().replace(/\(.*?\)|[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    const want = norm(title);
    page = (s?.query?.search || []).map((r) => r.title).find((t) => !/^List of/i.test(t) && want && (norm(t) === want || norm(t).startsWith(want) || (norm(t).length > 8 && want.startsWith(norm(t))))) || '';
  }
  if (!page) return [];
  const d = await getJSON(`https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exsectionformat=plain&redirects=1&format=json&origin=*&titles=${encodeURIComponent(page)}`, { ttl: 7 * 86400e3 }).catch(() => null);
  const text = Object.values(d?.query?.pages || {})[0]?.extract || '';
  const body = text.split(/\n(?:References|See also|External links|Notes|Further reading)\n/)[0];
  const sentences = body.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+(?=\s|$)/g) || [];
  return sentences
    .slice(1)
    .map((s) => s.trim())
    .filter((s) => s.length > 60 && s.length < 260 && INTERESTING.test(s) && !/[{}=]/.test(s))
    .slice(0, 8);
}
