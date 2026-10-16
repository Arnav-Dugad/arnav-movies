# Lumen

A glassy, Apple-style streaming site for **free, legal** classic cinema, plus discovery for modern TV and anime. Mobile-first, installable as an app, and it runs on Cloudflare's free plan.

**Live:** https://lumen-cinema.arnavrival12.workers.dev

## What's inside

- **Watch free:** about 1,500 public-domain films. Each is verified by Wikidata's copyright status and linked to a streamable Internet Archive file, with TMDB posters, backdrops, logo title art, trailers, cast photos and Rotten Tomatoes / Metacritic / TMDB scores. Also the 28,000-film Archive Vault, classic TV and classic cartoons.
- **Player:** resume, subtitles (the Archive's own `.srt` files; OpenSubtitles when a key is set), scene thumbnails on the scrubber, a scenes strip, skip intro (learns each series), up next / autoplay, cinema mode, picture tuning for old prints, sleep timer, Chromecast, AirPlay, Picture-in-Picture, swipe down to close, keyboard shortcuts and lock-screen controls.
- **Discover:** trending TV, popular shows in your country, airing tonight, new on streaming, where to watch in your country (TMDB / JustWatch), and anime from AniList with official streaming links.
- **People:** actor and director pages built from Wikidata and Wikipedia, with the titles you can watch free marked.
- **Smart:** nightly "Lumen Picks", "Because you watched…", a taste-based "For You", mood shortcuts and Surprise me. It's all computed on the device.
- **Feel:** posters that morph into the detail page, muted trailers on hover, hover-to-preview clips, parallax rank numerals, spring-physics sheets, haptics and a shimmer splash.
- **Reliability:** the player reports stream failures and recoveries to a Worker + D1 database. A cron job re-checks every catalog file every 30 minutes, dead files are skipped automatically, and `/status` shows the dashboard.

## Data sources (all free)

| Source | Used for |
|---|---|
| [Internet Archive](https://archive.org) | Streams, scene thumbnails, subtitles, the Vault, classic TV and cartoons |
| [Wikidata](https://www.wikidata.org) | Public-domain status, directors and cast IDs, review scores, people pages |
| [TMDB](https://www.themoviedb.org) | Art, trailers, cast photos, trending TV, where to watch. This product uses the TMDB API but is not endorsed or certified by TMDB. |
| [TVMaze](https://www.tvmaze.com/api) | Schedules, episodes, cast |
| [AniList](https://anilist.co) | Anime |
| [Wikipedia](https://en.wikipedia.org) | Biographies and summaries |

## Setup

```bash
echo "TMDB_KEY=your_key" > .dev.vars                 # free key from themoviedb.org
python scripts/build-catalog.py                       # builds public/data (about 15 min first run, cached afterwards)
npx wrangler d1 execute lumen-health --local --file schema.sql
npx wrangler dev                                      # http://localhost:8787
```

## Deploy (Cloudflare free plan)

```bash
npx wrangler secret put TMDB_KEY
npx wrangler secret put OPENSUBTITLES_KEY            # optional; enables OpenSubtitles in the player
npx wrangler d1 execute lumen-health --remote --file schema.sql
npx wrangler deploy
```

## Add films

Add `archive_id | Wikipedia_Title | tag1,tag2` to `scripts/films.txt` and rebuild. Hand-picked films are listed first. Everything else comes from Wikidata automatically.

## Legal

Lumen hosts no video files. Curated titles are U.S. public domain per Wikidata; everything plays directly from the Internet Archive, which handles rights and takedowns. TV and anime pages link only to official services.
