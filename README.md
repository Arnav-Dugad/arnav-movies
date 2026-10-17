# Arnav Movies

A glassy, Apple-style streaming site for **free, legal** classic cinema, classic TV, newsreels and NASA footage. Everything on it can be streamed. It's mobile-first, installable as an app, and runs on Cloudflare's free plan.

**Live:** https://arnav-movies.arnavrival12.workers.dev

## What's inside

- **Films:** about 1,500 public-domain films. Each is verified by Wikidata's copyright status and linked to a streamable Internet Archive file, with TMDB posters, backdrops, logo title art, trailers, cast photos and Rotten Tomatoes / Metacritic / TMDB scores.
- **More free sources:** The Vault (the Archive's 28,000 feature films), Universal Newsreels (1929–1967), the Prelinger Archives, FedFlix government films, NASA's video library and Creative Commons open movies.
- **Classic TV:** 26 public-domain-era series in real seasons, matched to TMDB, with progress tracked per episode.
- **Player:**
  - subtitles in 40+ languages (Archive captions, OpenSubtitles and Workers AI translation), with two languages at once for learners;
  - scene thumbnails on the scrubber, with haptic ticks as you pass each scene;
  - exact Skip intro and Skip credits;
  - Smart Speed, which skims long silences;
  - playback speed remembered per film;
  - a sleep timer that fades the picture to black;
  - a cinema-curtain opening;
  - old-print restoration;
  - Chromecast, AirPlay, Picture-in-Picture and lock-screen controls.
- **Full programme:** press it on a feature and you get a newsreel from the film's era, then a cartoon, then the feature, like a 1940s picture house. Between reels and episodes there are "Did you know…" trivia cards from Wikipedia.
- **Search what's said:** full-text search through about 52,000 caption windows from 2,300 films and episodes. Put a line in quotes and playback jumps to the moment it's spoken.
- **Feel:**
  - page colours that shift to match each poster;
  - a parallax hero;
  - posters that morph into the detail page;
  - hover cards and previews;
  - spatial sound cues and haptics on mobile;
  - ‹ › scroll buttons on desktop;
  - a keyboard cheat sheet (press `?`).
- **Smart:** nightly "Arnav's Picks", "Because you watched…", "Because you liked {actor}", a taste-based "For You", moods, seasonal home pages and Surprise me. All of it is computed on the device.
- **Reliability:** stream failures are reported to the Worker and stored in D1. A cron job re-checks catalog files every 30 minutes, dead files are skipped automatically, and `/status` shows the dashboard.

## How Skip intro and Skip credits are found

Each film's skip points come from whichever of these signals is best, in this order:

1. **Crowd marks:** the median of what at least 3 viewers skipped to.
2. **Captions:** the first and last sustained dialogue.
3. **Scene frames:** title cards detected in the Archive's scene thumbnails.
4. **Per series:** what the series has learned from its earlier episodes.

## Data sources (all free)

| Source | Used for |
|---|---|
| [Internet Archive](https://archive.org) | Streams, scene thumbnails, subtitles, the Vault, classic TV, newsreels, Prelinger, FedFlix, Creative Commons films |
| [NASA Image and Video Library](https://images.nasa.gov) | NASA footage (public domain) |
| [Wikidata](https://www.wikidata.org) | Public-domain status, directors and cast IDs, review scores, people pages |
| [TMDB](https://www.themoviedb.org) | Art, trailers, cast photos, episode guides. This product uses the TMDB API but is not endorsed or certified by TMDB. |
| [Wikipedia](https://en.wikipedia.org) | Biographies, summaries and trivia |
| [OpenSubtitles](https://www.opensubtitles.com) | Human-made subtitles |

## Setup

```bash
echo "TMDB_KEY=your_key" > .dev.vars                 # free key from themoviedb.org
python scripts/build-catalog.py                       # builds public/data (about 15 min first run, cached afterwards)
python scripts/build-stills.py && python scripts/compress-stills.py   # best-scene art
python scripts/build-tv.py                            # classic TV series and episode guides
python scripts/build-quotes.py                        # caption search index -> .cache/quotes/*.sql
python scripts/build-marks.py                         # intro and credits points -> .cache/marks.json
python scripts/split_catalog.py                       # writes the lean index and per-film shards
npx wrangler d1 execute arnav-movies-db --local --file schema.sql
npx wrangler dev                                      # http://localhost:8787
```

## Deploy (Cloudflare free plan)

```bash
npx wrangler secret put TMDB_KEY
npx wrangler secret put OPENSUBTITLES_KEY            # enables OpenSubtitles languages in the player
npx wrangler d1 execute arnav-movies-db --remote --file schema.sql
for f in .cache/quotes/quotes-schema.sql .cache/quotes/quotes-0*.sql; do npx wrangler d1 execute arnav-movies-db --remote --file "$f" -y; done
npx wrangler deploy
```

## Add films

Add `archive_id | Wikipedia_Title | tag1,tag2` to `scripts/films.txt` and rebuild. Hand-picked films are listed first. Everything else comes from Wikidata automatically.

## Legal

Arnav Movies hosts no video files. It lists only titles that can be streamed free and legally:

- curated films that are U.S. public domain per Wikidata;
- public-domain collections on the Internet Archive, which handles rights and takedowns;
- NASA footage, which is public domain;
- openly licensed Creative Commons films.
