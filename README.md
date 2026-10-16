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

## New in v3

- **Subtitles in 40+ languages:** OpenSubtitles (human-made, cached in D1), plus live AI translation of the English captions with Workers AI. Indian languages use IndicTrans2; the rest use Llama 3.1. Translation starts at the chunk you're watching. Subtitle size, font (including Lexend and Atkinson Hyperlegible, which are easier to read for people with dyslexia), background and colour are all saved.
- **Smart resume:** rewinds 10 seconds and shows a "Previously" card with the last scenes and lines of dialogue.
- **Old-print restoration:** de-flicker (temporal frame blending) and Steady (also crops the gate-weave at the frame edges), drawn on a canvas.
- **App-icon launch:** the player grows out of the poster you tapped, and shrinks back into it on close.
- **Classic TV series:** 26 series grouped into real seasons and episodes, matched to TMDB. Each episode's progress is saved, with Resume S·E and autoplay of the next episode.
- **Shorts:** a vertical swipe feed of 35-second clips from cartoons and silent shorts.
- **Hover cards** on desktop: a muted trailer, preview clip or slideshow, plus scores and quick actions, including Not interested.
- **Ken Burns slideshows** on title pages for films without a trailer.
- **Best-scene card art:** picked from Archive scene frames for the ~570 films without a TMDB backdrop.
- **Seasonal home pages** (Halloween, Christmas, Valentine's Day). Preview with `?season=halloween|holidays|valentines`.
- **Collections:** Chaplin, Keaton, Lloyd, Cult Classics, Halloween Frights and Holiday Classics.
- **Release dates and certificates** for your country, falling back to the U.S.
- **Smarter recommendations:** titles you abandoned or dismissed count against their genres, plus a "Because you liked {actor}" row.

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
python scripts/build-stills.py && python scripts/compress-stills.py && python scripts/split_catalog.py   # best-scene art
python scripts/build-tv.py                            # classic TV series and episode guides
npx wrangler d1 execute lumen-health --local --file schema.sql
npx wrangler dev                                      # http://localhost:8787
```

## Deploy (Cloudflare free plan)

```bash
npx wrangler secret put TMDB_KEY
npx wrangler secret put OPENSUBTITLES_KEY            # enables OpenSubtitles languages in the player
npx wrangler d1 execute lumen-health --remote --file schema.sql
npx wrangler deploy
```

## Add films

Add `archive_id | Wikipedia_Title | tag1,tag2` to `scripts/films.txt` and rebuild. Hand-picked films are listed first. Everything else comes from Wikidata automatically.

## Legal

Lumen hosts no video files. Curated titles are U.S. public domain per Wikidata; everything plays directly from the Internet Archive, which handles rights and takedowns. TV and anime pages link only to official services.
