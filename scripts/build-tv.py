"""Builds public/data/tv.json: classic TV series grouped into seasons and episodes.

Only series widely documented as having U.S. public-domain episodes (mostly through copyright
non-renewal) are included, and only episodes the Internet Archive hosts in its classic_tv
collection. Episodes are matched to TMDB seasons/episodes for numbering, stills and synopses.

Run: python scripts/build-tv.py
"""
import hashlib
import json
import os
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache", "http")
UA = {"User-Agent": "ArnavMoviesCatalog/3.0 (https://github.com/Arnav-Dugad/arnav-movies)"}
TMDB = "https://arnav-movies.arnavrival12.workers.dev/api/tmdb/"  # our Worker proxy (key stays server-side)

# (display name, Archive title query, TMDB search name, first-air year hint)
SERIES = [
    ("One Step Beyond", '"One Step Beyond"', "One Step Beyond", 1959),
    ("You Bet Your Life", '"You Bet Your Life"', "You Bet Your Life", 1950),
    ("The Beverly Hillbillies", '"Beverly Hillbillies"', "The Beverly Hillbillies", 1962),
    ("The Lucy Show", '"Lucy Show"', "The Lucy Show", 1962),
    ("The Dick Van Dyke Show", '"Dick Van Dyke Show"', "The Dick Van Dyke Show", 1961),
    ("Bonanza", 'Bonanza', "Bonanza", 1959),
    ("The Andy Griffith Show", '"Andy Griffith"', "The Andy Griffith Show", 1960),
    ("Petticoat Junction", '"Petticoat Junction"', "Petticoat Junction", 1963),
    ("Flash Gordon", '"Flash Gordon"', "Flash Gordon", 1954),
    ("Sherlock Holmes", '"Sherlock Holmes" AND (1954 OR Ronald OR "TV series")', "Sherlock Holmes", 1954),
    ("Rocky Jones, Space Ranger", '"Rocky Jones"', "Rocky Jones, Space Ranger", 1954),
    ("Dragnet", 'Dragnet', "Dragnet", 1951),
    ("The George Burns and Gracie Allen Show", '"Burns and Allen" OR "Burns & Allen"', "The George Burns and Gracie Allen Show", 1950),
    ("The Jack Benny Program", '"Jack Benny"', "The Jack Benny Program", 1950),
    ("Decoy", 'Decoy AND (Beverly OR Garland OR Casey)', "Decoy", 1957),
    ("Annie Oakley", '"Annie Oakley"', "Annie Oakley", 1954),
    ("The Cisco Kid", '"Cisco Kid"', "The Cisco Kid", 1950),
    ("The Lone Ranger", '"Lone Ranger"', "The Lone Ranger", 1949),
    ("Space Patrol", '"Space Patrol"', "Space Patrol", 1950),
    ("Tom Corbett, Space Cadet", '"Tom Corbett"', "Tom Corbett, Space Cadet", 1950),
    ("Ramar of the Jungle", '"Ramar"', "Ramar of the Jungle", 1952),
    ("Racket Squad", '"Racket Squad"', "Racket Squad", 1951),
    ("Life with Elizabeth", '"Life with Elizabeth"', "Life with Elizabeth", 1953),
    ("The Abbott and Costello Show", '"Abbott and Costello Show"', "The Abbott and Costello Show", 1952),
    ("The Adventures of Ozzie and Harriet", '"Ozzie and Harriet"', "The Adventures of Ozzie and Harriet", 1952),
    ("Captain Video and His Video Rangers", '"Captain Video"', "Captain Video and His Video Rangers", 1949),
    ("Mr. & Mrs. North", '"Mr. and Mrs. North" OR "Mr. & Mrs. North"', "Mr. & Mrs. North", 1952),
    ("The Adventures of Kit Carson", '"Kit Carson"', "The Adventures of Kit Carson", 1951),
    ("The Adventures of Wild Bill Hickok", '"Wild Bill Hickok"', "The Adventures of Wild Bill Hickok", 1951),
]


def cached_json(url, key=None):
    path = os.path.join(CACHE, hashlib.sha1((key or url).encode()).hexdigest() + ".json")
    if os.path.exists(path):
        return json.load(open(path, encoding="utf-8"))
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90) as r:
                d = json.loads(r.read())
            os.makedirs(CACHE, exist_ok=True)
            json.dump(d, open(path, "w", encoding="utf-8"))
            return d
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
        except Exception:
            pass
        time.sleep(2 * (attempt + 1))
    return None


def tmdb(path, **params):
    return cached_json(TMDB + path + ("?" + urllib.parse.urlencode(params) if params else ""))


def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\b(the|a|an|and|episode|ep|show|tv)\b", " ", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


SE_PATTERNS = [
    re.compile(r"\bS(\d{1,2})\s*[._-]?\s*E(\d{1,3})\b", re.I),
    re.compile(r"\b(\d{1,2})x(\d{1,3})\b"),
    re.compile(r"season\s*(\d{1,2})\D{0,12}?(?:episode|ep)\.?\s*(\d{1,3})", re.I),
]
EP_ONLY = re.compile(r"(?:episode|\bep\.?|#)\s*(\d{1,3})\b", re.I)


def parse_se(text):
    for p in SE_PATTERNS:
        m = p.search(text)
        if m:
            return int(m.group(1)), int(m.group(2))
    m = EP_ONLY.search(text)
    return (None, int(m.group(1))) if m else (None, None)


def clean_episode_title(raw, series_words):
    t = re.sub(r"\.(mp4|ogv|avi|mpe?g|mkv)$", "", raw, flags=re.I)
    t = re.sub(r"_512kb$|_ipod$|\.ia$", "", t, flags=re.I)
    t = t.replace("_", " ").replace(".", " ")
    for p in SE_PATTERNS + [EP_ONLY]:
        t = p.sub(" ", t)
    for w in sorted(series_words, key=len, reverse=True):
        t = re.sub(re.escape(w), " ", t, flags=re.I)
    t = re.sub(r"\b(19[4-7]\d)\b", " ", t)
    t = re.sub(r"[\s\-–:|]+", " ", t).strip(" -–:|")
    return t[:1].upper() + t[1:] if t else ""


def archive_items(query):
    params = urllib.parse.urlencode([("q", f"collection:classic_tv AND mediatype:movies AND title:({query})"), ("fl[]", "identifier"), ("fl[]", "title"),
                                     ("fl[]", "downloads"), ("fl[]", "year"), ("rows", "250"), ("sort[]", "downloads desc"), ("output", "json")])
    d = cached_json("https://archive.org/advancedsearch.php?" + params)
    return (d or {}).get("response", {}).get("docs", [])


def episodes_from_item(doc, series_words):
    meta = cached_json("https://archive.org/metadata/" + urllib.parse.quote(doc["identifier"]))
    if not meta:
        return []
    size = lambda f: int(f.get("size", 0) or 0)
    groups = {}
    for f in meta.get("files", []):
        if not f["name"].lower().endswith(".mp4"):
            continue
        base = re.sub(r"(_512kb|_ipod|\.ia)?\.mp4$", "", f["name"], flags=re.I)
        groups.setdefault(base, []).append(f)
    eps = []
    for base, files in groups.items():
        good = [f for f in files if size(f) < 2.5e9] or files
        best = max(good, key=size)
        try:
            length = float(best.get("length") or 0)
        except ValueError:
            length = 0
        if length and length < 300:  # skip trailers, promos and clips
            continue
        title_src = (doc.get("title") or doc["identifier"]) if len(groups) == 1 else base.split("/")[-1]
        s, e = parse_se(title_src if len(groups) == 1 else base)
        eps.append({
            "id": doc["identifier"], "file": best["name"], "len": round(length) or None,
            "t": clean_episode_title(title_src, series_words) or clean_episode_title(base, series_words),
            "s": s, "e": e, "dl": doc.get("downloads", 0) / max(1, len(groups)),
        })
    return eps


def tmdb_series(name, year):
    res = (tmdb("search/tv", query=name) or {}).get("results", [])
    res = [r for r in res if r.get("first_air_date") and abs(int(r["first_air_date"][:4]) - year) <= 3] or res[:1]
    if not res:
        return None, []
    tv = tmdb(f"tv/{res[0]['id']}") or {}
    images = tmdb(f"tv/{res[0]['id']}/images", include_image_language="en,null") or {}
    logo = next((l["file_path"] for l in images.get("logos", []) if l.get("iso_639_1") == "en"), None)
    seasons = []
    for s in tv.get("seasons", []):
        if s.get("season_number", 0) < 1:
            continue
        sd = tmdb(f"tv/{tv['id']}/season/{s['season_number']}") or {}
        for ep in sd.get("episodes", []):
            seasons.append({"s": ep["season_number"], "e": ep["episode_number"], "name": ep.get("name") or "", "still": ep.get("still_path"),
                            "overview": ep.get("overview") or "", "air": ep.get("air_date")})
    info = {
        "tmdb": tv.get("id"), "poster": tv.get("poster_path"), "backdrop": tv.get("backdrop_path"), "logo": logo,
        "overview": tv.get("overview") or "", "year": int((tv.get("first_air_date") or "0")[:4]) or None,
        "genres": [g["name"] for g in tv.get("genres", [])][:3], "rating": round(tv.get("vote_average") or 0, 1) if tv.get("vote_count", 0) >= 5 else None,
        "network": (tv.get("networks") or [{}])[0].get("name"),
    }
    return info, seasons


def build_series(entry):
    name, query, tmdb_name, year = entry
    words = [name, tmdb_name, re.sub(r"^The ", "", name)] + [w.strip('"') for w in re.findall(r'"([^"]+)"', query)]
    docs = archive_items(query)
    eps = []
    for d in docs[:120]:
        eps.extend(episodes_from_item(d, words))
    info, tm_eps = tmdb_series(tmdb_name, year)
    by_title = {norm(t["name"]): t for t in tm_eps if norm(t["name"])}
    by_se = {(t["s"], t["e"]): t for t in tm_eps}
    seen, out = set(), []
    for ep in sorted(eps, key=lambda x: -x["dl"]):
        match = by_se.get((ep["s"], ep["e"])) if ep["s"] else None
        if not match and norm(ep["t"]):
            match = by_title.get(norm(ep["t"]))
            if not match:  # fuzzy: a TMDB title contained in the Archive title
                nt = norm(ep["t"])
                match = next((t for k, t in by_title.items() if len(k) > 5 and (k in nt or nt in k)), None)
        if match:
            ep.update({"s": match["s"], "e": match["e"], "t": match["name"] or ep["t"], "still": match["still"], "ov": match["overview"][:240], "air": match["air"]})
        key = (ep["s"], ep["e"]) if ep["s"] and ep["e"] else norm(ep["t"]) or ep["file"]
        if key in seen:
            continue
        seen.add(key)
        ep.pop("dl", None)
        out.append(ep)
    # When TMDB recognises the series, keep only matched episodes: unmatched uploads are often a
    # different (later, still-copyrighted) production with the same name.
    matched = [e for e in out if e.get("still") is not None or e.get("air")]
    if len(matched) >= 5:
        out = matched
    if len(out) < 3:
        return None
    seasons = {}
    for ep in out:
        seasons.setdefault(ep["s"] or 0, []).append(ep)
    season_list = []
    for n in sorted(seasons, key=lambda k: (k == 0, k)):
        items = sorted(seasons[n], key=lambda x: (x["e"] is None, x["e"] or 0, x["t"]))
        season_list.append({"n": n or None, "label": f"Season {n}" if n else "More episodes", "eps": [{k: v for k, v in e.items() if v not in (None, "")} for e in items]})
    sid = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return {"sid": sid, "name": name, **(info or {}), "count": len(out), "seasons": season_list}


def main():
    with ThreadPoolExecutor(max_workers=6) as pool:
        series = [s for s in pool.map(build_series, SERIES) if s]
    series.sort(key=lambda s: -s["count"])
    for s in series:
        print(f"  {s['name']}: {s['count']} episodes in {len(s['seasons'])} groups", file=sys.stderr)
    # Small index for rows and cards; each series' episode guide loads with its page.
    d = os.path.join(ROOT, "public", "data", "tv")
    os.makedirs(d, exist_ok=True)
    for f in os.listdir(d):
        os.remove(os.path.join(d, f))
    index = []
    for s in series:
        json.dump(s["seasons"], open(os.path.join(d, s["sid"] + ".json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        index.append({k: v for k, v in s.items() if k != "seasons"} | {"nseasons": sum(1 for x in s["seasons"] if x["n"])})
    out = os.path.join(ROOT, "public", "data", "tv.json")
    json.dump({"generated": time.strftime("%Y-%m-%d"), "series": index}, open(out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"wrote {len(series)} series -> {out} ({os.path.getsize(out) / 1024:.0f} KB index)", file=sys.stderr)


if __name__ == "__main__":
    main()
