// Lumen edge worker (Cloudflare free plan).
//   /api/tmdb/*      cached TMDB proxy (key stays server-side)
//   /api/geo         viewer country from Cloudflare
//   /api/subs/ia     Internet Archive .srt -> WebVTT (Archive storage nodes send no CORS headers)
//   /api/subs/os     OpenSubtitles -> WebVTT, persisted in D1 (enabled when OPENSUBTITLES_KEY is set)
//   /api/subs/langs  languages OpenSubtitles has for a film
//   /api/subs/translate  Workers AI translation of caption chunks, persisted in D1
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
    const lang = (url.searchParams.get('lang') || 'en').toLowerCase().slice(0, 5);
    if (!/^\d+$/.test(imdb) || !/^[a-z]{2}(-[a-z]{2})?$/.test(lang)) return json({ error: 'bad request' }, 400);
    // D1 keeps downloads across all of Cloudflare's data centres, so the daily OpenSubtitles quota lasts.
    const key = `os:${imdb}:${lang}`;
    const hit = await d1Sub(env, key);
    if (hit) return vtt(hit);
    const headers = osHeaders(env);
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
    const raw = await (await fetch(link)).text();
    const text = raw.startsWith('WEBVTT') ? raw : srtToVtt(raw);
    ctx.waitUntil(d1PutSub(env, key, text));
    return vtt(text);
  }

  if (path === 'subs/langs') {
    // Which languages OpenSubtitles has for a film (one search call, cached for a week).
    if (!env.OPENSUBTITLES_KEY) return json([], 200, 3600);
    const imdb = (url.searchParams.get('imdb') || '').replace(/^tt/, '');
    if (!/^\d+$/.test(imdb)) return json({ error: 'bad request' }, 400);
    return cached(request, ctx, 7 * 86400, async () => {
      const r = await fetch(`https://api.opensubtitles.com/api/v1/subtitles?imdb_id=${imdb}&order_by=download_count`, { headers: osHeaders(env) });
      const data = (await r.json().catch(() => ({}))).data || [];
      const counts = {};
      for (const x of data) {
        const l = x.attributes?.language;
        if (l) counts[l] = (counts[l] || 0) + (x.attributes.download_count || 1);
      }
      return json(Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([l]) => l), 200, 7 * 86400);
    });
  }

  if (path === 'subs/translate' && request.method === 'POST') {
    // Translates one chunk of English captions with Workers AI; chunks are cached forever in D1,
    // so each line of each film is only ever translated once.
    if (!env.AI || !env.DB) return json({ error: 'not configured' }, 503);
    const body = await request.json().catch(() => null);
    const lines = body?.lines;
    const lang = String(body?.lang || '');
    const src = String(body?.src || '');
    if (!Array.isArray(lines) || !lines.length || lines.length > 60 || lines.some((l) => typeof l !== 'string' || l.length > 300)) return json({ error: 'bad lines' }, 400);
    if (!LANGS[lang] || !/^(ia|os):[\w.\-:/]{1,240}$/.test(src) || !Number.isInteger(body.chunk) || body.chunk < 0 || body.chunk > 5000) return json({ error: 'bad request' }, 400);
    const key = `tr:${src}:${lang}:${body.chunk}:${await shortHash(lines.join('\n'))}`;
    const hit = await d1Sub(env, key);
    if (hit) return json(JSON.parse(hit));
    if (!(await aiBudget(env))) return json({ error: 'daily translation budget used up' }, 429);
    const out = await translate(env, lines, lang);
    if (out) ctx.waitUntil(d1PutSub(env, key, JSON.stringify(out)));
    return out ? json(out) : json({ error: 'translation failed' }, 502);
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


/* ------------------------------------------------------------- subtitles */
const osHeaders = (env) => ({ 'Api-Key': env.OPENSUBTITLES_KEY, 'User-Agent': 'Lumen v1.0', Accept: 'application/json' });

async function d1Sub(env, key) {
  if (!env.DB) return null;
  const row = await env.DB.prepare('SELECT body FROM subs WHERE k = ?').bind(key).first().catch(() => null);
  return row?.body || null;
}
function d1PutSub(env, key, body) {
  if (!env.DB) return Promise.resolve();
  return env.DB.prepare('INSERT OR REPLACE INTO subs (k, body, ts) VALUES (?, ?, ?)').bind(key, body, Date.now()).run().catch(() => {});
}

async function shortHash(text) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Free plan: 10,000 neurons/day. Cap AI calls so the whole site stays inside it.
async function aiBudget(env, cap = 400) {
  const day = 'ai:' + new Date().toISOString().slice(0, 10);
  const row = await env.DB.prepare("INSERT INTO meta (k, v) VALUES (?, '1') ON CONFLICT(k) DO UPDATE SET v = CAST(v AS INTEGER) + 1 RETURNING v").bind(day).first();
  return Number(row?.v || 0) <= cap;
}

// Target languages: IndicTrans2 for Indian languages (far better than general models), Llama for the rest.
const LANGS = {
  es: { name: 'Spanish' }, fr: { name: 'French' }, de: { name: 'German' }, it: { name: 'Italian' }, pt: { name: 'Portuguese' },
  nl: { name: 'Dutch' }, ru: { name: 'Russian' }, tr: { name: 'Turkish' }, ar: { name: 'Arabic' }, ja: { name: 'Japanese' },
  ko: { name: 'Korean' }, zh: { name: 'Chinese (Simplified)' }, id: { name: 'Indonesian' }, pl: { name: 'Polish' },
  hi: { name: 'Hindi', indic: 'hin_Deva' }, bn: { name: 'Bengali', indic: 'ben_Beng' }, ta: { name: 'Tamil', indic: 'tam_Taml' },
  te: { name: 'Telugu', indic: 'tel_Telu' }, mr: { name: 'Marathi', indic: 'mar_Deva' }, kn: { name: 'Kannada', indic: 'kan_Knda' },
  ml: { name: 'Malayalam', indic: 'mal_Mlym' }, gu: { name: 'Gujarati', indic: 'guj_Gujr' }, pa: { name: 'Punjabi', indic: 'pan_Guru' },
  ur: { name: 'Urdu', indic: 'urd_Arab' },
};

async function translate(env, lines, lang) {
  const target = LANGS[lang];
  try {
    if (target.indic) {
      const r = await env.AI.run('@cf/ai4bharat/indictrans2-en-indic-1B', { text: lines, target_language: target.indic });
      const t = r?.translations;
      if (Array.isArray(t) && t.length === lines.length) return t.map(String);
    } else {
      const r = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fp8', {
        messages: [
          { role: 'system', content: `You translate film subtitles from English to ${target.name}. Keep each line short and natural and keep names unchanged. Reply with ONLY a JSON array of exactly ${lines.length} strings, one per input line, in the same order.` },
          { role: 'user', content: JSON.stringify(lines) },
        ],
        max_tokens: 2048,
        temperature: 0.2,
      });
      const text = typeof r?.response === 'string' ? r.response : JSON.stringify(r?.response ?? '');
      const arr = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1));
      if (Array.isArray(arr) && arr.length === lines.length) return arr.map(String);
    }
  } catch {}
  // Fallback: line by line with a dedicated translation model (alignment stays exact).
  try {
    return await Promise.all(lines.map((text) =>
      env.AI.run('@cf/meta/m2m100-1.2b', { text, source_lang: 'en', target_lang: lang }).then((r) => r?.translated_text || text).catch(() => text)
    ));
  } catch {
    return null;
  }
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
