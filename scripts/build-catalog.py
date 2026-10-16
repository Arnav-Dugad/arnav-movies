"""Builds public/data/catalog.json from scripts/films.txt.

Enriches each Internet Archive film with Wikipedia (summary, poster) and
Wikidata (director, cast, genres, runtime, IMDb id). All sources are free and keyless.

Run: python scripts/build-catalog.py
"""
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = {"User-Agent": "LumenCatalog/1.0 (https://github.com/Arnav-Dugad; public-domain film catalog builder) python-urllib"}


def get(url):
    for attempt in range(6):
        try:
            req = urllib.request.Request(url, headers=UA)
            data = json.load(urllib.request.urlopen(req, timeout=60))
            time.sleep(0.4)  # stay polite with the free APIs
            return data
        except Exception:
            if attempt == 5:
                raise
            time.sleep(3 * (attempt + 1))


def pick_mp4(files):
    size = lambda f: int(f.get("size", 0) or 0)
    mp4 = [f for f in files if f["name"].lower().endswith(".mp4")]
    if not mp4:
        return None
    # Prefer the best file under ~2.5 GB so streaming stays snappy on mobile.
    good = [f for f in mp4 if size(f) < 2.5e9] or mp4
    return max(good, key=size)["name"]


def sized(summary, width):
    """Wikimedia thumbnail of the poster at `width` px (or the original if smaller)."""
    orig, thumb = summary.get("originalimage"), summary.get("thumbnail")
    if not orig:
        return None
    if orig.get("width", 0) <= width or not thumb:
        return orig["source"].split("?")[0]
    return re.sub(r"/\d+px-", f"/{width}px-", thumb["source"].split("?")[0])


def sparql(qids):
    q = """
    SELECT ?item ?prop ?val ?valLabel WHERE {
      VALUES ?item { %s }
      { ?item wdt:P57 ?val . BIND("director" AS ?prop) }
      UNION { ?item wdt:P161 ?val . BIND("cast" AS ?prop) }
      UNION { ?item wdt:P136 ?val . BIND("genre" AS ?prop) }
      UNION { ?item wdt:P2047 ?val . BIND("runtime" AS ?prop) }
      UNION { ?item wdt:P345 ?val . BIND("imdb" AS ?prop) }
      UNION { ?item wdt:P495 ?val . BIND("country" AS ?prop) }
      UNION { ?item wdt:P364 ?val . BIND("language" AS ?prop) }
      UNION { ?item wdt:P577 ?val . BIND("date" AS ?prop) }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }""" % " ".join("wd:" + q for q in qids)
    url = "https://query.wikidata.org/sparql?format=json&query=" + urllib.parse.quote(q)
    return get(url)["results"]["bindings"]


def clean_genre(g):
    g = re.sub(r"\b(film|movie)s?\b", "", g, flags=re.I).strip(" -")
    return g[:1].upper() + g[1:] if g else g


def main():
    rows = []
    with open(os.path.join(ROOT, "scripts", "films.txt"), encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            ident, wiki, tags = [p.strip() for p in line.split("|")]
            rows.append((ident, wiki, [t.strip() for t in tags.split(",") if t.strip()]))

    films = []
    for ident, wiki, tags in rows:
        meta = get("https://archive.org/metadata/" + urllib.parse.quote(ident))
        file = pick_mp4(meta.get("files", []))
        if not file:
            print("skip (no mp4):", ident, file=sys.stderr)
            continue
        s = get("https://en.wikipedia.org/api/rest_v1/page/summary/" + urllib.parse.quote(wiki, safe="(),!'"))
        films.append({
            "id": ident,
            "file": file,
            "title": re.sub(r"\s*\((\d{4} )?film\)$", "", s.get("title", wiki).replace("_", " ")),
            "tagline": s.get("description", ""),
            "overview": s.get("extract", ""),
            "poster": sized(s, 500),
            "posterHd": sized(s, 1280),
            "aspect": round(s["originalimage"]["width"] / s["originalimage"]["height"], 3) if s.get("originalimage") else None,
            "wiki": s.get("content_urls", {}).get("desktop", {}).get("page"),
            "qid": s.get("wikibase_item"),
            "tags": tags,
        })
        print("ok:", films[-1]["title"], file=sys.stderr)

    facts = {}
    for b in sparql([f["qid"] for f in films if f["qid"]]):
        qid = b["item"]["value"].rsplit("/", 1)[-1]
        prop, raw = b["prop"]["value"], b["val"]["value"]
        label = b.get("valLabel", b["val"])["value"]
        d = facts.setdefault(qid, {})
        if prop == "runtime":
            d["runtime"] = int(float(raw))
        elif prop == "imdb":
            d["imdb"] = raw
        elif prop == "date":
            y = int(raw[:4])
            d["year"] = min(d.get("year", 9999), y)
        else:
            lst = d.setdefault(prop, [])
            if label not in lst and not re.fullmatch(r"Q\d+", label):
                lst.append(label)

    for f in films:
        d = facts.get(f.pop("qid") or "", {})
        f["year"] = d.get("year")
        f["director"] = d.get("director", [])[:2]
        f["cast"] = d.get("cast", [])[:8]
        f["genres"] = list(dict.fromkeys(g for g in (clean_genre(x) for x in d.get("genre", [])) if g))[:4]
        f["runtime"] = d.get("runtime")
        f["imdb"] = d.get("imdb")
        f["country"] = d.get("country", [])[:2]
        f["language"] = d.get("language", [])[:1]

    out = os.path.join(ROOT, "public", "data", "catalog.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump({"generated": time.strftime("%Y-%m-%d"), "films": films}, fh, ensure_ascii=False, indent=1)
    print(f"wrote {len(films)} films -> {out}", file=sys.stderr)


if __name__ == "__main__":
    main()
