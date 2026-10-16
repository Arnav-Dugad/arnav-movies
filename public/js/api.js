// Data layer. Every source here is free, keyless and CORS-enabled:
//   - /data/catalog.json  curated public-domain films (built by scripts/build-catalog.py)
//   - Internet Archive    28,000+ public-domain feature films and classic TV, streamable
//   - TVMaze              TV metadata, schedules, cast, episodes, where it airs
//   - Wikipedia           summaries and images for anything not in the catalog
// To add another source, write a provider with the same item shape (see `toItem*`).

const memory = new Map();
const inflight = new Map();

async function getJSON(url, { ttl = 30 * 60e3, persist = true } = {}) {
  const now = Date.now();
  const hit = memory.get(url);
  if (hit && now - hit.t < ttl) return hit.v;
  if (persist) {
    try {
      const stored = JSON.parse(sessionStorage.getItem('lc:' + url));
      if (stored && now - stored.t < ttl) {
        memory.set(url, stored);
        return stored.v;
      }
    } catch {}
  }
  if (inflight.has(url)) return inflight.get(url);
  const p = fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((v) => {
      const entry = { t: Date.now(), v };
      memory.set(url, entry);
      if (persist) {
        try { sessionStorage.setItem('lc:' + url, JSON.stringify(entry)); } catch {}
      }
      return v;
    })
    .finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p;
}

export const stripHtml = (s = '') => {
  const doc = new DOMParser().parseFromString(String(s), 'text/html');
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
};

/* ------------------------------------------------------------------ catalog */

let catalogPromise;
export function catalog() {
  catalogPromise ??= getJSON('/data/catalog.json', { ttl: Infinity, persist: false }).then((d) =>
    d.films.map(toItemFromCatalog)
  );
  return catalogPromise;
}

function toItemFromCatalog(f) {
  return {
    key: 'ia:' + f.id,
    kind: 'movie',
    source: 'catalog',
    id: f.id,
    file: f.file,
    title: f.title,
    year: f.year,
    poster: f.poster,
    posterHd: f.posterHd || f.poster,
    aspect: f.aspect,
    tagline: f.tagline,
    overview: f.overview,
    genres: f.genres || [],
    tags: f.tags || [],
    runtime: f.runtime,
    director: f.director || [],
    cast: f.cast || [],
    country: f.country || [],
    language: f.language || [],
    imdb: f.imdb,
    wiki: f.wiki,
    playable: true,
    href: '/title/' + encodeURIComponent(f.id),
  };
}

export async function catalogById(id) {
  return (await catalog()).find((f) => f.id === id);
}

/* ---------------------------------------------------------- internet archive */

const IA = 'https://archive.org';
export const iaThumb = (id) => `${IA}/services/img/${encodeURIComponent(id)}`;
export const iaStream = (id, file) =>
  `${IA}/download/${encodeURIComponent(id)}/${file.split('/').map(encodeURIComponent).join('/')}`;

const IA_FIELDS = ['identifier', 'title', 'year', 'date', 'downloads', 'avg_rating', 'num_reviews', 'subject', 'runtime', 'description', 'creator', 'collection'];

function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

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

function cleanTitle(t = '') {
  return String(t).replace(/\s*\((19|20)\d{2}\)\s*$/, '').replace(/_/g, ' ').trim();
}

function toItemFromIA(d) {
  const subjects = asArray(d.subject)
    .flatMap((s) => String(s).split(/[;,]/))
    .map((s) => s.trim())
    .filter((s) => s && s.length < 28);
  const year = +d.year || +(String(d.date || '').slice(0, 4)) || null;
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
    rating: d.avg_rating ? +d.avg_rating : null,
    downloads: d.downloads || 0,
    playable: true,
    href: '/title/' + encodeURIComponent(d.identifier),
  };
}

/**
 * Search the Archive. `q` is a Lucene query fragment; collection/mediatype constraints are added here.
 */
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

const bestMp4 = (files) => {
  const size = (f) => +(f.size || 0);
  const mp4 = files.filter((f) => /\.mp4$/i.test(f.name));
  if (!mp4.length) return null;
  const good = mp4.filter((f) => size(f) < 2.5e9);
  return (good.length ? good : mp4).sort((a, b) => size(b) - size(a))[0].name;
};

/** Full metadata for one Archive item, plus the best streamable file. */
export async function iaItem(id) {
  const d = await getJSON(`${IA}/metadata/${encodeURIComponent(id)}`, { ttl: 24 * 3600e3, persist: false });
  if (!d || !d.metadata) throw new Error('Not found');
  const md = d.metadata;
  const item = toItemFromIA({ ...md, identifier: id });
  item.file = bestMp4(d.files || []);
  // Every MP4 encode, best first, so the player can fall back when a storage node hiccups.
  item.alts = (d.files || [])
    .filter((f) => /\.mp4$/i.test(f.name))
    .sort((x, y) => +(y.size || 0) - +(x.size || 0))
    .map((f) => f.name)
    .filter((n) => n !== item.file);
  item.playable = !!item.file;
  item.overview = stripHtml(asArray(md.description).join(' '));
  item.license = md.licenseurl || null;
  const subs = (d.files || []).filter((f) => /\.(srt|vtt)$/i.test(f.name)).map((f) => f.name);
  item.subtitles = subs;
  return item;
}

export async function resolveTitle(id) {
  const curated = await catalogById(id);
  if (curated) return curated;
  const item = await iaItem(id);
  // Try to give non-curated films a proper poster and summary from Wikipedia.
  const wiki = await wikiLookup(item.title, item.year).catch(() => null);
  if (wiki) {
    if (wiki.poster) Object.assign(item, { poster: wiki.poster, posterHd: wiki.posterHd, thumbOnly: false });
    if (wiki.extract && (!item.overview || item.overview.length < 80)) item.overview = wiki.extract;
    item.wiki = wiki.url;
    item.tagline = wiki.description;
  }
  return item;
}

/* ----------------------------------------------------------------- wikipedia */

async function wikiLookup(title, year) {
  const q = `${title} ${year || ''} film`.trim();
  const s = await getJSON(
    `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=1&srsearch=${encodeURIComponent(q)}`,
    { ttl: 7 * 86400e3 }
  );
  const hit = s?.query?.search?.[0];
  if (!hit || !/film|movie/i.test(hit.snippet + hit.title)) return null;
  const sum = await getJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.title)}`, { ttl: 7 * 86400e3 });
  if (!sum || sum.type !== 'standard') return null;
  const thumb = sum.thumbnail?.source?.split('?')[0];
  const orig = sum.originalimage;
  const sized = (w) => (orig && orig.width <= w ? orig.source.split('?')[0] : thumb?.replace(/\/\d+px-/, `/${w}px-`));
  return {
    url: sum.content_urls?.desktop?.page,
    extract: sum.extract,
    description: sum.description,
    poster: thumb ? sized(500) : null,
    posterHd: thumb ? sized(1280) : null,
  };
}

/* -------------------------------------------------------------------- tvmaze */

const TVM = 'https://api.tvmaze.com';

export function toShow(s) {
  if (!s) return null;
  return {
    key: 'tv:' + s.id,
    kind: 'show',
    source: 'tvmaze',
    id: s.id,
    title: s.name,
    year: s.premiered ? +s.premiered.slice(0, 4) : null,
    ended: s.ended,
    status: s.status,
    poster: s.image?.medium?.replace('http://', 'https://') || null,
    posterHd: s.image?.original?.replace('http://', 'https://') || null,
    overview: stripHtml(s.summary || ''),
    genres: s.genres || [],
    rating: s.rating?.average || null,
    weight: s.weight || 0,
    runtime: s.averageRuntime || s.runtime || null,
    network: s.network?.name || s.webChannel?.name || null,
    networkKind: s.network ? 'TV network' : s.webChannel ? 'Streaming' : null,
    country: s.network?.country?.name || s.webChannel?.country?.name || null,
    officialSite: s.officialSite,
    imdb: s.externals?.imdb || null,
    language: s.language,
    schedule: s.schedule,
    playable: false,
    href: '/show/' + s.id,
    raw: s,
  };
}

export async function popularShows() {
  const pages = await Promise.all([0, 1, 2].map((p) => getJSON(`${TVM}/shows?page=${p}`, { ttl: 24 * 3600e3, persist: false })));
  return pages.flat().filter((s) => s.image && s.rating?.average).map(toShow);
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function userCountry() {
  const region = (navigator.language || 'en-US').split('-')[1];
  return region && /^[A-Z]{2}$/.test(region) ? region : 'US';
}

function dedupeShows(episodes) {
  const seen = new Map();
  for (const ep of episodes) {
    const show = ep.show || ep._embedded?.show;
    if (!show || !show.image || seen.has(show.id)) continue;
    const item = toShow(show);
    item.airing = { name: ep.name, season: ep.season, number: ep.number, airtime: ep.airtime, airstamp: ep.airstamp };
    seen.set(show.id, item);
  }
  return [...seen.values()].sort((a, b) => b.weight - a.weight);
}

export async function airingTonight(country = userCountry()) {
  let eps = await getJSON(`${TVM}/schedule?country=${country}&date=${today()}`, { ttl: 3600e3, persist: false }).catch(() => []);
  if (eps.length < 8 && country !== 'US') eps = await getJSON(`${TVM}/schedule?country=US&date=${today()}`, { ttl: 3600e3, persist: false });
  return dedupeShows(eps);
}

export async function streamingToday() {
  const eps = await getJSON(`${TVM}/schedule/web?date=${today()}`, { ttl: 3600e3, persist: false });
  return dedupeShows(eps);
}

export async function searchShows(q) {
  const r = await getJSON(`${TVM}/search/shows?q=${encodeURIComponent(q)}`, { ttl: 3600e3 });
  return r.map((x) => toShow(x.show));
}

export async function showDetail(id) {
  const s = await getJSON(`${TVM}/shows/${id}?embed[]=cast&embed[]=seasons&embed[]=nextepisode&embed[]=previousepisode`, { ttl: 3600e3, persist: false });
  const show = toShow(s);
  show.cast = (s._embedded?.cast || []).slice(0, 18).map((c) => ({
    name: c.person.name,
    role: c.character?.name,
    image: c.character?.image?.medium || c.person.image?.medium || null,
  }));
  show.seasons = (s._embedded?.seasons || []).filter((x) => x.episodeOrder !== 0);
  show.next = s._embedded?.nextepisode || null;
  show.prev = s._embedded?.previousepisode || null;
  return show;
}

export async function showBackdrop(id) {
  const imgs = await getJSON(`${TVM}/shows/${id}/images`, { ttl: 24 * 3600e3 }).catch(() => []);
  const bg = imgs.filter((i) => i.type === 'background').sort((a, b) => (b.main ? 1 : 0) - (a.main ? 1 : 0))[0];
  return bg?.resolutions?.original?.url || null;
}

export const seasonEpisodes = (seasonId) => getJSON(`${TVM}/seasons/${seasonId}/episodes`, { ttl: 6 * 3600e3, persist: false });

export async function similarShows(show, pool) {
  const g = new Set(show.genres);
  return pool
    .filter((s) => s.id !== show.id)
    .map((s) => ({ s, score: s.genres.filter((x) => g.has(x)).length * 2 + (s.rating || 0) / 3 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 18)
    .map((x) => x.s);
}
