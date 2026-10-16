"""Builds public/data/catalog.json: verified public-domain films you can stream free.

Sources (all free):
  - Wikidata    films marked copyright status = public domain that link to an Internet Archive item,
                plus director/cast IDs, genres and Rotten Tomatoes / Metacritic scores
  - scripts/films.txt   hand-picked extras and manual tags (always included, listed first)
  - Internet Archive    the streamable MP4s
  - TMDB        posters, backdrops, logo title art, trailers, cast photos, ratings (needs TMDB_KEY)

Run:  TMDB_KEY=... python scripts/build-catalog.py      (or put TMDB_KEY in .dev.vars)
"""
import json
import math
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = {"User-Agent": "LumenCatalog/2.0 (https://github.com/Arnav-Dugad/lumen-cinema; public-domain film catalog)"}
RT, METACRITIC = "Q105584", "Q150248"
FILM_TYPES = "wd:Q11424 wd:Q24862 wd:Q202866 wd:Q506240 wd:Q17517379"  # film, short, animated film, TV film, animated short


def tmdb_key():
    if os.environ.get("TMDB_KEY"):
        return os.environ["TMDB_KEY"]
    path = os.path.join(ROOT, ".dev.vars")
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            if line.startswith("TMDB_KEY="):
                return line.split("=", 1)[1].strip()
    sys.exit("TMDB_KEY is not set (env var or .dev.vars)")


KEY = tmdb_key()


CACHE = os.path.join(ROOT, ".cache", "http")


def get(url, data=None, retries=5, cache=False):
    """GET/POST JSON with retries. With cache=True, responses are kept on disk so re-runs are fast."""
    path = None
    if cache:
        import hashlib
        os.makedirs(CACHE, exist_ok=True)
        path = os.path.join(CACHE, hashlib.sha1(re.sub(r"api_key=\w+", "", url).encode()).hexdigest() + ".json")
        if os.path.exists(path):
            with open(path, encoding="utf-8") as fh:
                return json.load(fh)
    value = _get(url, data, retries)
    if path and value is not None:
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(value, fh)
    return value


def _get(url, data=None, retries=5):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=data, headers=UA)
            return json.load(urllib.request.urlopen(req, timeout=90))
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if attempt == retries - 1:
                raise
        except Exception:
            if attempt == retries - 1:
                raise
        time.sleep(2 * (attempt + 1))


def sparql(query):
    body = urllib.parse.urlencode({"query": query, "format": "json"}).encode()
    return get("https://query.wikidata.org/sparql", data=body)["results"]["bindings"]


def qid(uri):
    return uri.rsplit("/", 1)[-1]


def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


# ----------------------------------------------------------------- 1. candidates
def wikidata_candidates():
    rows = sparql(f"""
      SELECT ?f ?ia ?imdb ?article WHERE {{
        VALUES ?type {{ {FILM_TYPES} }}
        ?f wdt:P31 ?type ; wdt:P6216 wd:Q19652 ; wdt:P345 ?imdb ; wdt:P724 ?ia .
        FILTER(STRSTARTS(?imdb, "tt"))
        OPTIONAL {{ ?article schema:about ?f ; schema:isPartOf <https://en.wikipedia.org/> }}
      }}""")
    films = {}
    for r in rows:
        q = qid(r["f"]["value"])
        f = films.setdefault(q, {"qid": q, "imdb": r["imdb"]["value"], "ia": [], "wiki": r.get("article", {}).get("value"), "tags": [], "pick": None})
        if r["ia"]["value"] not in f["ia"]:
            f["ia"].append(r["ia"]["value"])
    print(f"wikidata: {len(films)} public-domain films with Archive IDs", file=sys.stderr)
    return films


def hand_picked():
    picks = []
    with open(os.path.join(ROOT, "scripts", "films.txt"), encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line and not line.startswith("#"):
                ident, wiki, tags = [p.strip() for p in line.split("|")]
                picks.append((ident, wiki, [t.strip() for t in tags.split(",") if t.strip()]))
    # Wikipedia pageprops gives each article's Wikidata ID (50 titles per request).
    names = [w.replace("_", " ") for _, w, _ in picks]
    qmap = {}
    for i in range(0, len(names), 50):
        chunk = "|".join(names[i:i + 50])
        d = get("https://en.wikipedia.org/w/api.php?action=query&prop=pageprops&ppprop=wikibase_item&redirects=1&format=json&titles=" + urllib.parse.quote(chunk))
        hops = {n["from"]: n["to"] for n in d["query"].get("normalized", []) + d["query"].get("redirects", [])}
        by_title = {p["title"]: p.get("pageprops", {}).get("wikibase_item") for p in d["query"]["pages"].values()}
        for n in names[i:i + 50]:
            t = hops.get(n, n)
            t = hops.get(t, t)
            qmap[n] = by_title.get(t)
    out = []
    for order, (ident, wiki, tags) in enumerate(picks):
        q = qmap.get(wiki.replace("_", " "))
        if not q:
            print("  no wikidata id for", wiki, file=sys.stderr)
            continue
        out.append({"qid": q, "ia": [ident], "wiki": "https://en.wikipedia.org/wiki/" + urllib.parse.quote(wiki), "tags": tags, "pick": order})
    return out


# ------------------------------------------------------------------- 2. facts
def wikidata_facts(qids):
    facts = {}
    for i in range(0, len(qids), 120):
        values = " ".join("wd:" + q for q in qids[i:i + 120])
        rows = sparql(f"""
          SELECT ?f ?prop ?v ?vLabel ?by WHERE {{
            VALUES ?f {{ {values} }}
            {{ ?f wdt:P57 ?v . BIND("director" AS ?prop) }}
            UNION {{ ?f wdt:P161 ?v . BIND("cast" AS ?prop) }}
            UNION {{ ?f wdt:P136 ?v . BIND("genre" AS ?prop) }}
            UNION {{ ?f wdt:P2047 ?v . BIND("runtime" AS ?prop) }}
            UNION {{ ?f wdt:P345 ?v . BIND("imdb" AS ?prop) }}
            UNION {{ ?f wdt:P495 ?v . BIND("country" AS ?prop) }}
            UNION {{ ?f wdt:P364 ?v . BIND("language" AS ?prop) }}
            UNION {{ ?f wdt:P577 ?v . BIND("date" AS ?prop) }}
            UNION {{ ?f p:P444 ?st . ?st ps:P444 ?v ; pq:P447 ?by . BIND("score" AS ?prop) }}
            SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
          }}""")
        for b in rows:
            q = qid(b["f"]["value"])
            d = facts.setdefault(q, {"director": [], "cast": [], "genre": [], "country": [], "language": []})
            prop, raw = b["prop"]["value"], b["v"]["value"]
            label = b.get("vLabel", b["v"])["value"]
            if prop == "runtime":
                try:
                    d["runtime"] = int(float(raw))
                except ValueError:
                    pass
            elif prop == "imdb":
                d.setdefault("imdb", raw)
            elif prop == "date":
                if re.match(r"^\d{4}", raw):
                    d["year"] = min(d.get("year", 9999), int(raw[:4]))
            elif prop == "score":
                by = qid(b["by"]["value"])
                if by == RT and "%" in raw:
                    d["rt"] = int(re.sub(r"\D", "", raw.split("%")[0]) or 0)
                elif by == METACRITIC and "/" in raw:
                    d["mc"] = int(re.sub(r"\D", "", raw.split("/")[0]) or 0)
            elif prop in ("director", "cast"):
                entry = {"n": label, "q": qid(raw)}
                if not re.fullmatch(r"Q\d+", label) and entry not in d[prop]:
                    d[prop].append(entry)
            elif not re.fullmatch(r"Q\d+", label) and label not in d[prop]:
                d[prop].append(label)
        print(f"  wikidata facts {min(i + 120, len(qids))}/{len(qids)}", file=sys.stderr)
    return facts


# ---------------------------------------------------------------- 3. archive
def archive_files(ident):
    meta = get("https://archive.org/metadata/" + urllib.parse.quote(ident), cache=True)
    if not meta or "files" not in meta:
        return None
    size = lambda f: int(f.get("size", 0) or 0)
    mp4 = [f for f in meta["files"] if f["name"].lower().endswith(".mp4")]
    if not mp4:
        return None
    good = [f for f in mp4 if size(f) < 2.5e9] or mp4
    best = max(good, key=size)
    small = min(mp4, key=size)
    lengths = []
    for f in meta["files"]:
        try:
            lengths.append(float(f.get("length", 0) or 0))
        except ValueError:
            # Some items store length as "h:mm:ss".
            parts = str(f["length"]).split(":")
            if all(p.replace(".", "").isdigit() for p in parts):
                lengths.append(sum(float(p) * 60 ** i for i, p in enumerate(reversed(parts))))
    length = max(lengths, default=0)
    return {"id": ident, "file": best["name"], "pv": small["name"] if small["name"] != best["name"] else None, "len": round(length) or None}


def pick_archive(film):
    for ident in film["ia"][:4]:
        try:
            a = archive_files(ident)
        except Exception as e:
            print("  archive error", ident, e, file=sys.stderr)
            a = None
        if a:
            return a
    return None


# ------------------------------------------------------------------- 4. tmdb
def tmdb(path, **params):
    params["api_key"] = KEY
    return get(f"https://api.themoviedb.org/3/{path}?" + urllib.parse.urlencode(params), cache=True)


def tmdb_movie(imdb):
    found = tmdb(f"find/{imdb}", external_source="imdb_id")
    if not found:
        return None
    kind = "movie" if found.get("movie_results") else "tv" if found.get("tv_results") else None
    if not kind:
        return None
    first = found[f"{kind}_results"][0]
    m = tmdb(f"{kind}/{first['id']}", append_to_response="images,videos,credits", include_image_language="en,null", language="en-US")
    if not m:
        return None
    imgs = m.get("images", {})
    back = sorted(imgs.get("backdrops", []), key=lambda b: (b.get("iso_639_1") is None, b.get("vote_average", 0), b.get("width", 0)), reverse=True)
    logos = sorted([l for l in imgs.get("logos", []) if l.get("iso_639_1") in ("en", None)], key=lambda l: (l.get("iso_639_1") == "en", l.get("vote_average", 0)), reverse=True)
    vids = [v for v in m.get("videos", {}).get("results", []) if v.get("site") == "YouTube" and v.get("type") in ("Trailer", "Teaser")]
    vids.sort(key=lambda v: (v.get("type") != "Trailer", not v.get("official")))
    credits = m.get("credits", {})
    return {
        "tmdb": m["id"],
        "title": m.get("title") or m.get("name"),
        "year": int((m.get("release_date") or m.get("first_air_date") or "0")[:4] or 0) or None,
        "overview": m.get("overview"),
        "tagline": m.get("tagline"),
        "genres": [g["name"] for g in m.get("genres", [])],
        "runtime": m.get("runtime"),
        "vote": round(m.get("vote_average") or 0, 1),
        "votes": m.get("vote_count") or 0,
        "pop": round(m.get("popularity") or 0, 2),
        "poster": m.get("poster_path"),
        "backdrop": back[0]["file_path"] if back else m.get("backdrop_path"),
        "logo": logos[0]["file_path"] if logos else None,
        "trailer": vids[0]["key"] if vids else None,
        "cast": [{"n": c["name"], "c": c.get("character") or "", "p": c.get("profile_path")} for c in credits.get("cast", [])[:12]],
        "directors": [c["name"] for c in credits.get("crew", []) if c.get("job") == "Director"],
    }


# --------------------------------------------------------------------- tags
GENRE_TAGS = {"Horror": "horror", "Comedy": "comedy", "Thriller": "thriller", "Mystery": "thriller", "Romance": "romance", "Drama": "drama",
              "Western": "western", "Animation": "animation", "Science Fiction": "scifi", "Family": "family", "Music": "musical",
              "War": "war", "Documentary": "documentary", "Fantasy": "fantasy", "Adventure": "adventure", "Crime": "crime", "Action": "action"}
PEOPLE_TAGS = {"Alfred Hitchcock": "hitchcock", "Buster Keaton": "keaton", "Charlie Chaplin": "chaplin", "Harold Lloyd": "lloyd",
               "Fritz Lang": "lang", "Frank Capra": "capra", "Orson Welles": "welles", "Roger Corman": "cult", "Ed Wood": "cult"}


def derive_tags(base, wd, tm, year, runtime, directors, cast):
    tags = list(base)
    add = lambda t: t not in tags and tags.append(t)
    for g in tm["genres"]:
        if g in GENRE_TAGS:
            add(GENRE_TAGS[g])
    wd_genres = " ".join(wd.get("genre", [])).lower()
    if "noir" in wd_genres:
        add("noir")
    if "silent" in wd_genres or (year and year < 1928):
        add("silent")
    if any(k in wd_genres for k in ("b movie", "exploitation", "cult")):
        add("cult")
    if "musical" in wd_genres:
        add("musical")
    for name in directors + cast[:3]:
        if name in PEOPLE_TAGS and (name in directors or PEOPLE_TAGS[name] in ("keaton", "chaplin", "lloyd")):
            add(PEOPLE_TAGS[name])
    if runtime and runtime < 40:
        add("short")
    return tags


# --------------------------------------------------------------------- main
def build_one(f, facts):
    wd = facts.get(f["qid"], {})
    imdb = f.get("imdb") or wd.get("imdb")
    if not imdb:
        return None, "no-imdb"
    arc = pick_archive(f)
    if not arc:
        return None, "no-mp4"
    tm = tmdb_movie(imdb)
    if not tm or not tm["poster"]:
        return None, "no-tmdb"
    runtime = tm["runtime"] or wd.get("runtime")
    # Skip trailers, clips and fragments: the file must cover most of the film.
    if arc["len"] and runtime and arc["len"] < runtime * 60 * 0.55 and f["pick"] is None:
        return None, "fragment"
    tm_names = {norm(c["n"]) for c in tm["cast"]}
    wd_cast = {norm(c["n"]): c["q"] for c in wd.get("cast", [])}
    cast = [{"n": c["n"], "c": c["c"][:40], "p": c["p"], "q": wd_cast.get(norm(c["n"]))} for c in tm["cast"][:10]]
    for c in wd.get("cast", []):  # people Wikidata knows that TMDB didn't list
        if len(cast) >= 10:
            break
        if norm(c["n"]) not in tm_names:
            cast.append({"n": c["n"], "c": "", "p": None, "q": c["q"]})
    directors = wd.get("director") or [{"n": n, "q": None} for n in tm["directors"]]
    year = wd.get("year") or tm["year"]
    rating = {k: v for k, v in (("tmdb", tm["vote"] if tm["votes"] >= 10 else None), ("rt", wd.get("rt")), ("mc", wd.get("mc"))) if v}
    return {
        "id": arc["id"], "file": arc["file"], "pv": arc["pv"], "len": arc["len"],
        "title": tm["title"], "year": year, "tagline": tm["tagline"] or "", "overview": tm["overview"] or "",
        "poster": tm["poster"], "backdrop": tm["backdrop"], "logo": tm["logo"], "trailer": tm["trailer"],
        "genres": tm["genres"][:4], "runtime": runtime,
        "director": directors[:2], "cast": cast,
        "country": wd.get("country", [])[:2], "language": wd.get("language", [])[:1],
        "imdb": imdb, "tmdb": tm["tmdb"], "qid": f["qid"], "wiki": f.get("wiki"),
        "rating": rating, "votes": tm["votes"], "pop": tm["pop"], "pick": f["pick"],
        "tags": derive_tags(f["tags"], wd, tm, year, runtime, [d["n"] for d in directors], [c["n"] for c in cast]),
    }, None


def main():
    cands = wikidata_candidates()
    for p in hand_picked():
        if p["qid"] in cands:
            c = cands[p["qid"]]
            c.update({"ia": p["ia"] + [x for x in c["ia"] if x not in p["ia"]], "tags": p["tags"], "pick": p["pick"], "wiki": p["wiki"]})
        else:
            cands[p["qid"]] = {**p, "imdb": None}
    films = list(cands.values())
    facts = wikidata_facts([f["qid"] for f in films])

    results, skipped = [], {}
    with ThreadPoolExecutor(max_workers=6) as pool:
        def safe(f):
            try:
                return build_one(f, facts)
            except Exception as e:  # one flaky film must not sink the whole build
                print("  failed", f.get("qid"), type(e).__name__, file=sys.stderr)
                return None, "error"

        for i, (res, why) in enumerate(pool.map(safe, films)):
            if res:
                results.append(res)
            else:
                skipped[why] = skipped.get(why, 0) + 1
            if i % 50 == 0:
                print(f"  built {i}/{len(films)} (kept {len(results)})", file=sys.stderr)

    # De-duplicate by IMDb id and Archive id, keeping hand-picked entries first.
    seen, unique = set(), []
    for r in sorted(results, key=lambda r: (r["pick"] is None, r["pick"] or 0)):
        if r["imdb"] in seen or r["id"] in seen:
            continue
        seen.update((r["imdb"], r["id"]))
        unique.append(r)

    def score(r):
        return r["pop"] * 0.6 + math.log1p(r["votes"]) * 2 + (r["rating"].get("tmdb", 5) - 5)

    picks = sorted([r for r in unique if r["pick"] is not None], key=lambda r: r["pick"])
    rest = sorted([r for r in unique if r["pick"] is None], key=score, reverse=True)
    films = picks + rest
    for r in films:
        r.pop("pick")
        r.pop("pop")

    out = os.path.join(ROOT, ".cache", "catalog-full.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as fh:
        json.dump({"generated": time.strftime("%Y-%m-%d"), "img": "https://image.tmdb.org/t/p/", "films": films}, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"wrote {len(films)} films ({len(picks)} hand-picked) -> {out}; skipped {skipped}", file=sys.stderr)
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import split_catalog
    split_catalog.split()


if __name__ == "__main__":
    main()
