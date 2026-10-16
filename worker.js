// Lumen edge worker (Cloudflare free plan).
//   /api/tmdb/*      cached TMDB proxy (key stays server-side)
//   /api/geo         viewer country from Cloudflare
//   /api/subs/ia     Internet Archive .srt -> WebVTT (Archive storage nodes send no CORS headers)
//   /api/subs/os     OpenSubtitles -> WebVTT (enabled when OPENSUBTITLES_KEY is set)
//   /api/report      playback events from the player (stream failures, recoveries)
//   /api/health      stream-health dashboard data; /api/health/dead feeds the player
//   scheduled()      checks every catalog file on a rolling basis and records dead streams
// Anything else is a static asset; page navigations that miss fall back to the app shell.

const TMDB = 'https://api.themoviedb.org/3/';
const TMDB_ALLOW =
  /^(trending\/(movie|tv|all)\/(day|week)|discover\/(movie|tv)|(movie|tv)\/\d+(\/(videos|images|credits|external_ids|recommendations|watch\/providers|season\/\d+))?|find\/tt\d+|search\/(movie|tv|multi|person)|person\/\d+(\/(combined_credits|images|external_ids))?)$/;
const EVENTS = new Set(['play', 'error', 'recovered', 'fallback', 'dead']);
const CHECKS_PER_RUN = 36; // free plan allows 50 subrequests per invocation (leaves room for retries)

const json = (data, status = 200, maxAge = 0) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': maxAge ? `public, max-age=${maxAge}` : 'no-store' },
  });

async function cached(request, ctx, ttl, produce) {
  const cache = caches.default;
  const key = new Request(new URL(request.url).toString(), { method: 'GET' });
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = await produce();
  if (res.ok) {
    const copy = new Response(res.body, res);
    copy.headers.set('cache-control', `public, max-age=${ttl}`);
    ctx.waitUntil(cache.put(key, copy.clone()));
    return copy;
  }
  return res;
}

const srtToVtt = (srt) =>
  'WEBVTT\n\n' +
  srt
    .replace(/^﻿/, '')
    .replace(/\r/g, '')
    // WebVTT wants hh:mm:ss.mmm; Archive's auto-generated SRTs sometimes use 1–2 digit milliseconds.
    .replace(/(\d{1,2}:\d{2}:\d{2})[,.](\d{1,3})(?!\d)/g, (_, t, ms) => `${t.padStart(8, '0')}.${ms.padEnd(3, '0')}`)
    .trim() +
  '\n';

const vtt = (text) => new Response(text, { headers: { 'content-type': 'text/vtt; charset=utf-8' } });

async function api(request, url, env, ctx) {
  const path = url.pathname.slice(5);

  if (path.startsWith('tmdb/')) {
    const sub = path.slice(5);
    if (!TMDB_ALLOW.test(sub)) return json({ error: 'not allowed' }, 400);
    if (!env.TMDB_KEY) return json({ error: 'TMDB not configured' }, 503);
    const ttl = sub.startsWith('trending') || sub.startsWith('discover') ? 3 * 3600 : 24 * 3600;
    return cached(request, ctx, ttl, async () => {
      const upstream = new URL(TMDB + sub);
      url.searchParams.forEach((v, k) => k !== 'api_key' && upstream.searchParams.set(k, v));
      upstream.searchParams.set('api_key', env.TMDB_KEY);
      const r = await fetch(upstream, { cf: { cacheTtl: ttl } });
      return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json; charset=utf-8' } });
    });
  }

  if (path === 'geo') {
    const cf = request.cf || {};
    return json({ country: cf.country || 'US', city: cf.city || null, timezone: cf.timezone || null, opensubtitles: !!env.OPENSUBTITLES_KEY });
  }

  if (path === 'subs/ia') {
    const id = url.searchParams.get('id') || '';
    const file = url.searchParams.get('file') || '';
    if (!/^[\w.\-]+$/.test(id) || !/\.(srt|vtt)$/i.test(file) || file.includes('..')) return json({ error: 'bad request' }, 400);
    return cached(request, ctx, 30 * 86400, async () => {
      const r = await fetch(`https://archive.org/download/${encodeURIComponent(id)}/${file.split('/').map(encodeURIComponent).join('/')}`);
      if (!r.ok) return json({ error: 'not found' }, 404);
      const text = await r.text();
      return vtt(/\.vtt$/i.test(file) ? text : srtToVtt(text));
    });
  }

  if (path === 'subs/os') {
    if (!env.OPENSUBTITLES_KEY) return json({ enabled: false }, 404);
    const imdb = (url.searchParams.get('imdb') || '').replace(/^tt/, '');
    const lang = (url.searchParams.get('lang') || 'en').slice(0, 5);
    if (!/^\d+$/.test(imdb)) return json({ error: 'bad request' }, 400);
    return cached(request, ctx, 30 * 86400, async () => {
      const headers = { 'Api-Key': env.OPENSUBTITLES_KEY, 'User-Agent': 'Lumen v1.0', Accept: 'application/json' };
      const s = await fetch(`https://api.opensubtitles.com/api/v1/subtitles?imdb_id=${imdb}&languages=${lang}&order_by=download_count`, { headers });
      const file = (await s.json()).data?.[0]?.attributes?.files?.[0]?.file_id;
      if (!file) return json({ error: 'none' }, 404);
      const d = await fetch('https://api.opensubtitles.com/api/v1/download', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_id: file, sub_format: 'webvtt' }),
      });
      const link = (await d.json()).link;
      if (!link) return json({ error: 'quota' }, 429);
      const text = await (await fetch(link)).text();
      return vtt(text.startsWith('WEBVTT') ? text : srtToVtt(text));
    });
  }

  if (path === 'report' && request.method === 'POST') {
    if (!env.DB) return json({ ok: false }, 503);
    const body = await request.json().catch(() => null);
    if (!body || !EVENTS.has(body.ev) || typeof body.id !== 'string' || body.id.length > 200) return json({ ok: false }, 400);
    ctx.waitUntil(
      env.DB.prepare('INSERT INTO events (ts, item, file, ev, code, country) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(Date.now(), body.id, String(body.file || '').slice(0, 300), body.ev, Number(body.code) || null, request.cf?.country || null)
        .run()
    );
    return json({ ok: true });
  }

  if (path === 'health/dead') {
    if (!env.DB) return json([], 200, 600);
    const { results } = await env.DB.prepare('SELECT item, file FROM file_health WHERE ok = 0').all();
    return json(results, 200, 600);
  }

  if (path === 'health') {
    if (!env.DB) return json({ error: 'not configured' }, 503);
    const since = Date.now() - 14 * 86400e3;
    const [totals, byDay, worst, checks, dead, lastRun] = await env.DB.batch([
      env.DB.prepare('SELECT ev, COUNT(*) AS n FROM events WHERE ts > ? GROUP BY ev').bind(since),
      env.DB.prepare(
        "SELECT CAST(ts / 86400000 AS INTEGER) AS day, SUM(ev = 'play') AS plays, SUM(ev = 'error') AS errors, SUM(ev IN ('recovered','fallback')) AS recovered FROM events WHERE ts > ? GROUP BY day ORDER BY day"
      ).bind(since),
      env.DB.prepare(
        "SELECT item, SUM(ev = 'error') AS errors, SUM(ev = 'play') AS plays, SUM(ev IN ('recovered','fallback')) AS recovered, MAX(ts) AS last FROM events WHERE ts > ? GROUP BY item HAVING errors > 0 ORDER BY errors DESC LIMIT 25"
      ).bind(since),
      env.DB.prepare('SELECT COUNT(*) AS checked, SUM(ok) AS ok, SUM(ok = 0) AS dead, AVG(CASE WHEN ok = 1 THEN ms END) AS avg_ms FROM file_health'),
      env.DB.prepare('SELECT item, file, status, checked_at FROM file_health WHERE ok = 0 ORDER BY checked_at DESC LIMIT 50'),
      env.DB.prepare("SELECT v FROM meta WHERE k = 'last_run'"),
    ]);
    return json(
      {
        generated: Date.now(),
        totals: Object.fromEntries(totals.results.map((r) => [r.ev, r.n])),
        byDay: byDay.results,
        worst: worst.results,
        checks: { ...checks.results[0], lastRun: Number(lastRun.results[0]?.v) || null },
        dead: dead.results,
      },
      200,
      60
    );
  }

  return json({ error: 'not found' }, 404);
}

/* Rolling health check: a 2-byte range request against each catalog file. */
async function checkHealth(env) {
  if (!env.DB) return;
  const res = await env.ASSETS.fetch('https://assets.local/data/catalog.json');
  const { films } = await res.json();
  const cursorRow = await env.DB.prepare("SELECT v FROM meta WHERE k = 'cursor'").first();
  let cursor = Number(cursorRow?.v) || 0;
  if (cursor >= films.length) cursor = 0;
  const batch = films.slice(cursor, cursor + CHECKS_PER_RUN);
  const probe = async (f) => {
    const t0 = Date.now();
    try {
      const r = await fetch(`https://archive.org/download/${encodeURIComponent(f.id)}/${f.file.split('/').map(encodeURIComponent).join('/')}`, {
        headers: { Range: 'bytes=0-1' },
        redirect: 'follow',
      });
      r.body?.cancel();
      return { f, ok: r.status === 206 || r.status === 200, status: r.status, ms: Date.now() - t0 };
    } catch {
      return { f, ok: false, status: 0, ms: Date.now() - t0 };
    }
  };
  let results = await Promise.all(batch.map(probe));
  // Archive storage nodes blip; retry failures once before counting them.
  let retries = 12;
  results = await Promise.all(results.map((r) => (r.ok || retries-- <= 0 ? r : probe(r.f))));
  const now = Date.now();
  await env.DB.batch([
    ...results.map((r) =>
      // A file is only "dead" (ok = 0) after failing two runs in a row; `fails` counts consecutive failures.
      env.DB.prepare(
        `INSERT INTO file_health (item, file, ok, status, ms, checked_at, fails) VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6)
         ON CONFLICT(item, file) DO UPDATE SET
           fails = CASE WHEN ?6 = 0 THEN 0 ELSE file_health.fails + 1 END,
           ok = CASE WHEN ?6 = 0 THEN 1 WHEN file_health.fails + 1 >= 2 THEN 0 ELSE 1 END,
           status = excluded.status, ms = excluded.ms, checked_at = excluded.checked_at`
      ).bind(r.f.id, r.f.file, r.status, r.ms, now, r.ok ? 0 : 1)
    ),
    env.DB.prepare("INSERT INTO meta (k, v) VALUES ('cursor', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(String(cursor + batch.length)),
    env.DB.prepare("INSERT INTO meta (k, v) VALUES ('last_run', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(String(now)),
    env.DB.prepare('DELETE FROM events WHERE ts < ?').bind(now - 30 * 86400e3),
  ]);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await api(request, url, env, ctx);
      } catch (err) {
        return json({ error: 'upstream failure' }, 502);
      }
    }
    const res = await env.ASSETS.fetch(request);
    const wantsPage = request.method === 'GET' && (request.headers.get('accept') || '').includes('text/html');
    if (res.status === 404 && wantsPage) {
      const shell = await env.ASSETS.fetch(new Request(new URL('/', request.url), request));
      return new Response(shell.body, { status: 200, headers: shell.headers });
    }
    return res;
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkHealth(env));
  },
};
