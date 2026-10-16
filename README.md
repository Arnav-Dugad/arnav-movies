# Lumen

A glassy, Apple-style streaming site for **free, legal** classic cinema and TV. Mobile-first, installable as an app, no accounts, no API keys, no build step.

- **Watch:** 41 hand-picked U.S. public-domain films (Hitchcock, Keaton, Nosferatu, film noir…), plus 28,000+ films and 11,000+ classic TV items streamed straight from the Internet Archive.
- **Discover TV:** what's airing tonight, what's new on streaming services today, cast, episode guides, next-episode countdowns and where to watch. Data comes from TVMaze.
- **Yours:** My List, resume where you left off, a 7-day watch-time chart, streaks and favourite genres. All of it is stored privately in the browser.

## Data sources (all free and keyless)

| Source | Used for |
|---|---|
| [Internet Archive](https://archive.org) | Video streams, the Vault catalog, classic TV |
| [Wikipedia REST](https://en.wikipedia.org/api/rest_v1/) | Posters and summaries |
| [Wikidata SPARQL](https://query.wikidata.org) | Director, cast, genres, runtime, IMDb IDs (at build time) |
| [TVMaze](https://www.tvmaze.com/api) | Shows, schedules, cast, episodes, networks |

## Run locally

```bash
npx wrangler dev
```

## Add films to the curated catalog

1. Find a public-domain film on archive.org with an MP4 file.
2. Add a line to `scripts/films.txt`: `archive_id | Wikipedia_Title | tag1,tag2`.
3. Run `python scripts/build-catalog.py`. It rewrites `public/data/catalog.json`.

Tags drive the collections: `horror noir hitchcock silent keaton scifi cult comedy thriller romance drama western animation`.

## Add a new source

Every provider in `public/js/api.js` returns the same item shape (`key, kind, id, title, year, poster, posterHd, overview, genres, href, playable`). A new legal source, such as an open-licensed library or a service's official embed API, only needs a function that returns that shape.

## Deploy

Hosted free on Cloudflare Workers static assets: **https://lumen-cinema.arnavrival12.workers.dev**

```bash
npx wrangler deploy
```

`worker.js` serves the static files and falls back to the app shell for client-side routes, including Archive IDs that contain dots.

## Legal

Lumen hosts no video files. Curated titles are U.S. public domain; everything else plays directly from the Internet Archive, which handles rights and takedowns.
