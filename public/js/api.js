// Data layer. Every source here is free:
//   /data/catalog.json  verified public-domain films (built by scripts/build-catalog.py)
//   /api/*              our Cloudflare Worker: TMDB proxy, subtitles, geo, stream-health
//   Internet Archive    streams, the 28,000-film Vault, classic TV and cartoons
//   TVMaze              TV schedules, cast, episodes
//   AniList             anime
//   Wikidata/Wikipedia  people pages and summaries
// To add a source, write a provider that returns the same item shape (see the `to*` mappers).

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
  configPromise ??= getJSON('/api/geo', { ttl: 6 * 3600e3 }).catch(() => ({ country: regionFromLocale() }));
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
  catalogPromise ??= getJSON('/data/catalog.json?v=2', { ttl: Infinity, persist: false }).then((d) => d.films.map(toItemFromCatalog));
  return catalogPromise;
}

function toItemFromCatalog(f) {
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
    backdropSm: tmdbImg(f.backdrop, 'w780'),
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
  });
}

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
  item.subtitles = files
    .filter((f) => /\.(srt|vtt)$/i.test(f.name))
    .map((f) => ({ file: f.name, label: /\.asr\./i.test(f.name) ? 'English (auto-generated)' : f.name.replace(/^.*[/\\]|\.(srt|vtt)$/gi, '').replace(/[_.-]+/g, ' ') }));
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

/* ------------------------------------------------------------ subtitles */
export async function subtitleTrack(item, choice) {
  const url = choice.source === 'os'
    ? `/api/subs/os?imdb=${encodeURIComponent(item.imdb)}&lang=${choice.lang || 'en'}`
    : `/api/subs/ia?id=${encodeURIComponent(item.id)}&file=${encodeURIComponent(choice.file)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('No subtitles');
  return URL.createObjectURL(new Blob([await res.text()], { type: 'text/vtt' }));
}

/* ------------------------------------------------------- stream health */
export function report(ev, item, extra = {}) {
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
    rating: s.rating?.average ? { tvmaze: s.rating.average } : {},
    score: s.rating?.average || 0,
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

export async function airingTonight() {
  const { country } = await config();
  let eps = await getJSON(`${TVM}/schedule?country=${country}&date=${today()}`, { ttl: 3600e3, persist: false }).catch(() => []);
  let used = country;
  if (eps.length < 8 && country !== 'US') {
    eps = await getJSON(`${TVM}/schedule?country=US&date=${today()}`, { ttl: 3600e3, persist: false });
    used = 'US';
  }
  const shows = dedupeShows(eps);
  shows.country = used;
  return shows;
}

export async function streamingToday() {
  return dedupeShows(await getJSON(`${TVM}/schedule/web?date=${today()}`, { ttl: 3600e3, persist: false }));
}

export async function searchShows(q) {
  const r = await getJSON(`${TVM}/search/shows?q=${encodeURIComponent(q)}`, { ttl: 3600e3 });
  return r.map((x) => toShow(x.show));
}

export async function showDetail(id) {
  const s = await getJSON(`${TVM}/shows/${id}?embed[]=cast&embed[]=seasons&embed[]=nextepisode&embed[]=previousepisode`, { ttl: 3600e3, persist: false });
  const show = toShow(s);
  show.people = (s._embedded?.cast || []).slice(0, 18).map((c) => ({
    name: c.person.name,
    role: c.character?.name,
    photo: (c.character?.image?.medium || c.person.image?.medium || '').replace('http://', 'https://') || null,
  }));
  show.seasons = (s._embedded?.seasons || []).filter((x) => x.episodeOrder !== 0);
  show.next = s._embedded?.nextepisode || null;
  show.externals = s.externals || {};
  return show;
}

export const seasonEpisodes = (seasonId) => getJSON(`${TVM}/seasons/${seasonId}/episodes`, { ttl: 6 * 3600e3, persist: false });

/** Map a TMDB TV id to TVMaze through IMDb / TheTVDB ids. */
export async function tvmazeFromTmdb(tmdbId) {
  const ext = await tmdb(`tv/${tmdbId}/external_ids`);
  for (const [k, v] of [['imdb', ext.imdb_id], ['thetvdb', ext.tvdb_id]]) {
    if (!v) continue;
    const s = await getJSON(`${TVM}/lookup/shows?${k}=${v}`, { ttl: 7 * 86400e3 }).catch(() => null);
    if (s?.id) return s.id;
  }
  return null;
}

/** TMDB extras for a TVMaze show: backdrop, logo, trailer and where-to-watch in the viewer's country. */
export async function showExtras(show) {
  const ids = show.externals || {};
  let tv = null;
  if (ids.imdb) tv = (await tmdb(`find/${ids.imdb}`, { external_source: 'imdb_id' }).catch(() => null))?.tv_results?.[0];
  if (!tv && ids.thetvdb) tv = (await tmdb(`find/${ids.thetvdb}`, { external_source: 'tvdb_id' }).catch(() => null))?.tv_results?.[0];
  if (!tv) return {};
  const [images, videos, providers, { country }] = await Promise.all([
    tmdb(`tv/${tv.id}/images`, { include_image_language: 'en,null' }).catch(() => ({})),
    tmdb(`tv/${tv.id}/videos`).catch(() => ({})),
    tmdb(`tv/${tv.id}/watch/providers`).catch(() => ({})),
    config(),
  ]);
  const logo = (images.logos || []).sort((a, b) => (b.iso_639_1 === 'en') - (a.iso_639_1 === 'en') || b.vote_average - a.vote_average)[0];
  const trailer = (videos.results || []).find((v) => v.site === 'YouTube' && v.type === 'Trailer') || (videos.results || []).find((v) => v.site === 'YouTube');
  const region = providers.results?.[country] || providers.results?.US || null;
  return {
    tmdb: tv.id,
    backdrop: tmdbImg(tv.backdrop_path, 'w1280'),
    logo: logo ? tmdbImg(logo.file_path, 'w500') : null,
    trailer: trailer?.key || null,
    providers: region,
    providerCountry: providers.results?.[country] ? country : 'US',
    vote: tv.vote_average,
  };
}

export async function similarShows(show, pool) {
  const g = new Set(show.genres);
  return pool
    .filter((s) => s.id !== show.id)
    .map((s) => ({ s, score: s.genres.filter((x) => g.has(x)).length * 2 + (s.score || 0) / 3 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 18)
    .map((x) => x.s);
}

/* ------------------------------------------------------------- tmdb tv rows */
const toTmdbShow = (t) => ({
  key: 'tmdbtv:' + t.id,
  kind: 'show',
  source: 'tmdb',
  id: t.id,
  title: t.name,
  year: t.first_air_date ? +t.first_air_date.slice(0, 4) : null,
  poster: tmdbImg(t.poster_path, 'w342'),
  posterHd: tmdbImg(t.poster_path, 'w780'),
  backdrop: tmdbImg(t.backdrop_path, 'w1280'),
  overview: t.overview,
  genres: [],
  rating: t.vote_average ? { tmdb: Math.round(t.vote_average * 10) / 10 } : {},
  playable: false,
  href: '/show/t' + t.id,
});

export async function trendingTv() {
  const d = await tmdb('trending/tv/week');
  return d.results.filter((t) => t.poster_path).map(toTmdbShow);
}

export async function popularInCountry() {
  const { country } = await config();
  const d = await tmdb('discover/tv', { with_origin_country: country, sort_by: 'popularity.desc', 'vote_count.gte': 20 });
  const shows = d.results.filter((t) => t.poster_path).map(toTmdbShow);
  shows.country = country;
  return shows;
}

/* -------------------------------------------------------------------- anilist */
const ANILIST = 'https://graphql.anilist.co';
const anilist = (query, variables = {}) =>
  getJSON(ANILIST, {
    ttl: 3 * 3600e3,
    init: { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ query, variables }) },
  }).then((d) => d.data);

const MEDIA_CARD = 'id title { english romaji } coverImage { large extraLarge color } bannerImage averageScore genres seasonYear format episodes';

const toAnime = (m) => ({
  key: 'anime:' + m.id,
  kind: 'anime',
  source: 'anilist',
  id: m.id,
  title: m.title.english || m.title.romaji,
  year: m.seasonYear,
  poster: m.coverImage.large,
  posterHd: m.coverImage.extraLarge,
  color: m.coverImage.color,
  backdrop: m.bannerImage,
  genres: m.genres || [],
  rating: m.averageScore ? { anilist: m.averageScore } : {},
  format: m.format,
  episodes: m.episodes,
  playable: false,
  href: '/anime/' + m.id,
});

export async function animeRows() {
  const season = (() => {
    const m = new Date().getMonth();
    return ['WINTER', 'WINTER', 'SPRING', 'SPRING', 'SPRING', 'SUMMER', 'SUMMER', 'SUMMER', 'FALL', 'FALL', 'FALL', 'WINTER'][m];
  })();
  const year = new Date().getMonth() === 11 ? new Date().getFullYear() + 1 : new Date().getFullYear();
  const d = await anilist(`query ($season: MediaSeason, $year: Int) {
    trending: Page(perPage: 24) { media(type: ANIME, sort: TRENDING_DESC, isAdult: false) { ${MEDIA_CARD} } }
    season: Page(perPage: 24) { media(type: ANIME, season: $season, seasonYear: $year, sort: POPULARITY_DESC, isAdult: false) { ${MEDIA_CARD} } }
    top: Page(perPage: 10) { media(type: ANIME, sort: SCORE_DESC, isAdult: false) { ${MEDIA_CARD} } }
  }`, { season, year });
  return { trending: d.trending.media.map(toAnime), season: d.season.media.map(toAnime), top: d.top.media.map(toAnime), seasonName: `${season[0]}${season.slice(1).toLowerCase()} ${year}` };
}

export async function animeSearch(q) {
  const d = await anilist(`query ($q: String) { Page(perPage: 8) { media(type: ANIME, search: $q, isAdult: false) { ${MEDIA_CARD} } } }`, { q });
  return d.Page.media.map(toAnime);
}

export async function animeDetail(id) {
  const d = await anilist(`query ($id: Int) { Media(id: $id, type: ANIME) {
    ${MEDIA_CARD} description(asHtml: false) duration status season source countryOfOrigin
    studios(isMain: true) { nodes { name } }
    trailer { id site }
    nextAiringEpisode { episode airingAt }
    externalLinks { site url type color icon language }
    characters(perPage: 16, sort: [ROLE, RELEVANCE]) { edges { role node { name { full } image { medium } } voiceActors(language: JAPANESE) { name { full } } } }
    recommendations(perPage: 14, sort: RATING_DESC) { nodes { mediaRecommendation { ${MEDIA_CARD} } } }
  } }`, { id: +id });
  const m = d.Media;
  const a = toAnime(m);
  return {
    ...a,
    overview: stripHtml((m.description || '').replace(/<br\s*\/?>/g, ' ')),
    runtime: m.duration,
    status: m.status,
    season: m.season,
    source: m.source,
    studios: m.studios.nodes.map((s) => s.name),
    trailer: m.trailer?.site === 'youtube' ? m.trailer.id : null,
    next: m.nextAiringEpisode,
    streaming: (m.externalLinks || []).filter((l) => l.type === 'STREAMING'),
    links: (m.externalLinks || []).filter((l) => l.type === 'INFO'),
    people: m.characters.edges.map((e) => ({ name: e.node.name.full, role: e.voiceActors?.[0]?.name?.full ? `CV: ${e.voiceActors[0].name.full}` : e.role, photo: e.node.image.medium })),
    recs: m.recommendations.nodes.map((n) => n.mediaRecommendation).filter(Boolean).map(toAnime),
  };
}
