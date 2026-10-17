"""Builds the "search what's said" index: captions of every Internet Archive film / classic TV /
newsreel item that ships an .srt file, cut into ~3-minute windows, as SQL for a D1 FTS5 table.

Writes .cache/quotes/*.sql (import with scripts/import-quotes.sh) and .cache/captions-marks.json,
which records the first and last line of dialogue per item (used for exact skip-intro/credits).

Run: python scripts/build-quotes.py
"""
import hashlib
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache", "http")
SRT = os.path.join(ROOT, ".cache", "srt")
OUT = os.path.join(ROOT, ".cache", "quotes")
UA = {"User-Agent": "ArnavMoviesCatalog/3.0 (https://github.com/Arnav-Dugad/arnav-movies)"}
COLLECTIONS = "feature_films OR classic_tv OR universal_newsreels OR silent_films"
WINDOW = 180  # seconds of dialogue per searchable row
NOISE = re.compile(r"^[\[\(♪♫].*[\]\)♪♫]?$|^(music|applause|laughter|silence)$", re.I)


def fetch(url, binary=False, retries=4):
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                data = r.read()
                return data if binary else json.loads(data)
        except Exception:
            if attempt == retries - 1:
                return None
            time.sleep(1.5 * (attempt + 1))


def cached_json(url):
    p = os.path.join(CACHE, hashlib.sha1(url.encode()).hexdigest() + ".json")
    if os.path.exists(p):
        return json.load(open(p, encoding="utf-8"))
    d = fetch(url)
    if d is not None:
        json.dump(d, open(p, "w", encoding="utf-8"))
    return d


def search_all():
    items, page = [], 1
    while True:
        params = urllib.parse.urlencode([("q", f"collection:({COLLECTIONS}) AND mediatype:movies AND format:SubRip"), ("fl[]", "identifier"),
                                         ("fl[]", "title"), ("fl[]", "year"), ("fl[]", "collection"), ("rows", "1000"), ("page", page), ("output", "json")])
        d = fetch("https://archive.org/advancedsearch.php?" + params)
        docs = (d or {}).get("response", {}).get("docs", [])
        items += docs
        if len(docs) < 1000:
            return items
        page += 1


TIME = re.compile(r"(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})")


def parse_srt(text):
    cues = []
    for block in re.split(r"\n\s*\n", text.replace("\r", "")):
        lines = [l for l in block.split("\n") if l.strip()]
        i = next((k for k, l in enumerate(lines) if "-->" in l), None)
        if i is None:
            continue
        a, _, b = lines[i].partition("-->")
        m1, m2 = TIME.search(a), TIME.search(b)
        if not m1 or not m2:
            continue
        sec = lambda m: int(m[1]) * 3600 + int(m[2]) * 60 + int(m[3]) + int(m[4].ljust(3, "0")) / 1000
        body = re.sub(r"<[^>]+>", "", " ".join(lines[i + 1:])).strip()
        if body:
            cues.append((sec(m1), sec(m2), body))
    return cues


def process(doc):
    ident = doc["identifier"]
    meta = cached_json("https://archive.org/metadata/" + urllib.parse.quote(ident))
    if not meta:
        return None
    srts = sorted([f["name"] for f in meta.get("files", []) if f["name"].lower().endswith(".srt")], key=lambda n: ("512kb" in n.lower(), len(n)))
    if not srts:
        return None
    path = os.path.join(SRT, hashlib.sha1((ident + srts[0]).encode()).hexdigest() + ".srt")
    if os.path.exists(path):
        text = open(path, encoding="utf-8", errors="replace").read()
    else:
        raw = fetch(f"https://archive.org/download/{urllib.parse.quote(ident)}/{urllib.parse.quote(srts[0])}", binary=True)
        if not raw:
            return None
        text = raw.decode("utf-8", errors="replace")
        open(path, "w", encoding="utf-8").write(text)
    cues = [c for c in parse_srt(text) if not NOISE.match(c[2].strip())]
    if len(cues) < 15:
        return None
    # Dialogue windows.
    rows, start, buf = [], cues[0][0], []
    for s, e, t in cues:
        if s - start > WINDOW and buf:
            rows.append((int(start), " ".join(buf)))
            start, buf = s, []
        buf.append(t)
    if buf:
        rows.append((int(start), " ".join(buf)))
    # First sustained dialogue (3 lines within 90 s) and the end of the last dialogue.
    first = next((cues[i][0] for i in range(len(cues) - 2) if cues[i + 2][0] - cues[i][0] < 90), cues[0][0])
    last = next((cues[i][1] for i in range(len(cues) - 1, 1, -1) if cues[i][0] - cues[i - 2][0] < 90), cues[-1][1])
    title = str(doc.get("title") or ident)
    year = doc.get("year")
    return {"id": ident, "title": title, "year": int(year) if str(year or "").isdigit() else None, "rows": rows, "first": round(first, 1), "last": round(last, 1)}


def sql(s):
    return "'" + str(s).replace("'", "''") + "'"


def main():
    os.makedirs(SRT, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    docs = search_all()
    print(f"captioned items: {len(docs)}", file=sys.stderr)
    results, marks = [], {}
    with ThreadPoolExecutor(max_workers=12) as pool:
        for i, r in enumerate(pool.map(process, docs)):
            if r:
                results.append(r)
                marks[r["id"]] = [r["first"], r["last"]]
            if i % 200 == 0:
                print(f"  {i}/{len(docs)} (indexed {len(results)})", file=sys.stderr)
    for f in os.listdir(OUT):
        os.remove(os.path.join(OUT, f))
    head = ("DROP TABLE IF EXISTS quotes;\n"
            "CREATE VIRTUAL TABLE quotes USING fts5(body, item UNINDEXED, title UNINDEXED, year UNINDEXED, t UNINDEXED, tokenize = 'porter unicode61');\n")
    chunk, n, part = [], 0, 0
    def flush():
        nonlocal chunk, part
        if chunk:
            open(os.path.join(OUT, f"quotes-{part:03d}.sql"), "w", encoding="utf-8").write("\n".join(chunk) + "\n")
            part += 1
            chunk = []
    open(os.path.join(OUT, "quotes-schema.sql"), "w", encoding="utf-8").write(head)
    for r in results:
        for t, body in r["rows"]:
            chunk.append(f"INSERT INTO quotes (body, item, title, year, t) VALUES ({sql(body[:4000])}, {sql(r['id'])}, {sql(r['title'][:200])}, {r['year'] or 'NULL'}, {t});")
            n += 1
            if len(chunk) >= 2500:
                flush()
    flush()
    json.dump(marks, open(os.path.join(ROOT, ".cache", "captions-marks.json"), "w"), separators=(",", ":"))
    print(f"indexed {len(results)} items, {n} rows in {part} SQL files", file=sys.stderr)


if __name__ == "__main__":
    main()
